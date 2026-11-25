// 【这个文件干什么】它是一台藏在 App 里的「第二浏览器」，专门打开学校和请假网页。
// 【什么时候会用到它】自动读课表、点「请假服务」、需要输入学校账号密码时，都会用到它。
// 【它和谁配合】SchoolProvider 决定什么时候打开；SchoolReadController 在里面读课表。
// 它默认可以「隐形」工作：放在屏幕最底层、透明度 1%、禁止点击，用户看不见也点不到。
// 但不能真的把网页藏起来（比如 isHidden），否则 WebKit 会以为 App 在后台，冻结网页脚本。
// 所有跳转都要先问 SchoolURLPolicy（网址门卫）；不在白名单里的地址一律拦下。
// 本机 Windows 没有 Xcode，无法编译；真机上的表现必须另行验证。
import UIKit
import WebKit

// 第二个 WKWebView 的容器（UIViewController 承载）。
//
// 对照 Android：
// - MainActivity.java:215-227（ensureSchool / showSchool / hideSchool / schoolVisible / openSchool）
// - MainActivity.java:228-304（ensureWebApp 的 WebView 配置、导航拦截与提示条；P2 才拆成独立请假容器）
// - SchoolClient.java:13-21（学校 WebView 的导航白名单与页面回调）
//
// P1 只保证“安全打开 + 可返回”，不实现课表读取（见 ios/docs/PHASE2-SCHOOL.md）。
// iOS 16 的 WKWebView 没有公开的 SSL 证书错误回调（Android onReceivedSslError 无法等价移植）：
// 学校证书异常时表现为加载失败，统一走 didFail 的提示文案。该差异见 P2 交接稿。
//
// Cookie：显式使用 WKWebsiteDataStore.default()，与 Android CookieManager 的持久化语义对齐
// （iOS 无 CookieManager.flush() 等价 API；WebKit 自行落盘）。
// 本机 Windows 无 Xcode/swiftc，未编译验证。
/// 学校与请假共用的内置浏览器窗口；外面看是一个普通页面，里面其实是一台小浏览器。
/// 它负责打开网址、拦截校外跳转、在网页里执行脚本；不负责解析课表内容。
public final class SchoolWebViewHost: UIViewController, WKNavigationDelegate, WKUIDelegate {

    // WebView 的用途决定导航策略（学校页 vs 请假页）。
    // 用途开关：school 看教务，leaveApp 看请假；两种模式的白名单和提示文字不同。
    public private(set) var mode: SchoolURLPolicy.WebMode = .school

    // 自动核对时容器以「离屏子控制器」方式挂在窗口里（不可见、不可点），只有需要用户登录时
    // 才 detach 后 present 成可见页面。isVisible 只表示「view 在窗口层级里」，不等于用户看得见；
    // 调用方判断用户是否看得见必须用 isUserVisible。
    /// 是否处于「隐形」状态：网页仍在运行，但用户看不到、点不到。
    public private(set) var isHeadless: Bool = false
    /// 用户此刻是否真的看得见页面；不能用 isVisible 代替（隐形时 isVisible 也可能是 true）。
    public private(set) var isUserVisible: Bool = false

    // 页面加载完成回调（参数为绝对 URL；P2 用它驱动 SchoolReadController 的状态机）。
    // 网页每次加载完成就通知外面；读取流程靠它判断「现在到了哪一步」。
    public var onPageFinished: ((String) -> Void)?
    // 即将导航到某个 URL（导航策略已放行后触发；请假页用它记忆 uid/pageEnc，对应
    // MainActivity.rememberLeaveSession，见 LeaveRecordsService.rememberSession）。
    // 网页即将跳转时先通知外面（例如顺手记下请假链接里的身份参数）。
    public var onNavigate: ((String) -> Void)?
    // 页面级提示/错误回调（文案已本地化，可直接展示）。
    // 页面提示文字变化时通知外面；外面的状态栏可以同步显示同一句话。
    public var onMessage: ((String) -> Void)?
    // 导航失败（已过滤 NSURLErrorCancelled）：P2 用它在读取中失败并保留原课表。
    // 页面加载失败时通知外面；读取流程收到后会保留旧课表，而不是清空。
    public var onNavigationFailure: ((Error) -> Void)?
    // WebContent 进程被回收（对应 Android onRenderProcessGone）。
    // iOS 内存紧张时会回收网页进程；这里通知外面重新准备页面。
    public var onProcessTerminated: (() -> Void)?
    // 容器关闭回调（对应 Android hideSchool 后 schoolVisible=false 的状态复位）。
    // 页面真正关闭后通知外面；用来复位「正在读取」「正在请假」等状态。
    public var onDismissed: (() -> Void)?

    // 真正干活的 WKWebView；第一次显示时才创建，延迟创建可以省内存。
    private var web: WKWebView?
    private var titleLabel: UILabel?
    private var noteLabel: UILabel?
    // dismiss(animated:) 的完成回调是异步的；用它挡住重复 dismiss / present。
    // 关闭动画还没播完时，禁止再打开或再关闭，避免两个转场打架。
    private var dismissing: Bool = false
    // 定位 shim 的消息处理器。host 强持有它，它弱引用 host，避免 WKUserContentController 形成环。
    // 定位功能的转接器：网页里的定位请求先到这里，再换成系统定位。
    private let geoBridge = SchoolGeolocationBridge()

    /// 只表示页面是否挂在窗口上；隐形模式也算 true，不代表用户看得见。
    public var isVisible: Bool {
        if isViewLoaded == false { return false }
        return view.window != nil
    }

    /// 当前网页地址；还没创建浏览器时返回 nil。
    public var currentURLString: String? {
        return web?.url?.absoluteString
    }

    /// 网页还能不能后退一页；没有浏览器或没有历史记录时是 false。
    public var canGoBack: Bool {
        return web?.canGoBack ?? false
    }

    // MARK: - 主线程兜底

    // UIKit/WebKit 的界面操作必须在主线程。调用方通常已在主线程；
    // 这里做防御性兜底：已在主线程时同步执行，保持原有调用顺序；否则投递到主队列。
    private func performOnMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
    }

    // MARK: - 生命周期

    /// 页面第一次显示时调用：搭好顶栏、浏览器和提示文字；系统保证只调用一次。
    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.white
        buildBar()
        buildWebView()
        applyModeText()
    }

    // 自动核对替换容器前断开旧页面回调：旧容器稍后才真正 dismiss，
    // 若保留 onDismissed，它会在新读取开始后调用 controller.cancel()，
    // 把刚启动的读取取消掉。必须在主线程调用。
    /// 断开所有回调，像拔掉电话线；旧页面稍后才关闭，避免它误伤新启动的读取。
    public func detachCallbacks() {
        onPageFinished = nil
        onNavigate = nil
        onNavigationFailure = nil
        onProcessTerminated = nil
        onDismissed = nil
    }

    // MARK: - 展示 / 关闭（对应 showSchool / hideSchool）

    // 可在任意线程调用：界面操作会兜底切到主线程。
    // 已展示时只切换模式并重新加载，不重复 present。
    /// 打开浏览器：presenter 是承接页面的控制器，mode 选用途，urlString 是首个地址。
    /// 已经打开时只切换模式和重新加载，不会叠出第二个页面。
    public func show(from presenter: UIViewController, mode: SchoolURLPolicy.WebMode, urlString: String) {
        performOnMain { [weak self] in
            self?.showOnMain(from: presenter, mode: mode, urlString: urlString)
        }
    }

    /// show 的实际执行体：只在主线程操作界面；关闭动画中则直接忽略本次打开。
    private func showOnMain(from presenter: UIViewController, mode: SchoolURLPolicy.WebMode, urlString: String) {
        if dismissing { return }
        self.mode = mode
        applyModeText()
        if isHeadless { detachHeadlessOnMain() }
        // presentingViewController 非空即已 present：present() 是异步转场，view.window 在
        // 转场开始前仍为 nil，单看 isVisible 会在转场窗口内二次 present
        // （UIKit 只打印 "Attempt to present … which is already presenting" 并忽略）。
        if isUserVisible || presentingViewController != nil {
            if urlString.isEmpty == false { load(urlString: urlString) }
            return
        }
        _ = view
        // 无头挂载时 view.alpha 被压到 0.01；转成可见前恢复，否则用户几乎看不见页面。
        view.alpha = 1.0
        view.isUserInteractionEnabled = true
        view.accessibilityElementsHidden = false
        if urlString.isEmpty == false { load(urlString: urlString) }
        isUserVisible = true
        modalPresentationStyle = .fullScreen
        presenter.present(self, animated: true, completion: nil)
    }

    // 对应 hideSchool：关闭容器并复位状态；优先走 dismiss，未 present 时移除子控制器。
    // 可在任意线程调用：界面操作会兜底切到主线程。
    /// 关闭浏览器并复位状态；animated 决定有没有收起动画。
    public func hide(animated: Bool = true) {
        performOnMain { [weak self] in
            self?.hideOnMain(animated: animated)
        }
    }

    /// hide 的实际执行体：优先关闭弹出的页面，其次是移除隐形子页面。
    /// 关闭成功后通过 onDismissed 通知外面；重复关闭不会重复通知。
    private func hideOnMain(animated: Bool) {
        if dismissing { return }
        let wasAttached = presentingViewController != nil || parent != nil
        isUserVisible = false
        isHeadless = false
        if let presenter = presentingViewController {
            dismissing = true
            presenter.dismiss(animated: animated) { [weak self] in
                guard let self = self else { return }
                self.dismissing = false
                self.onDismissed?()
            }
            return
        }
        if parent != nil {
            willMove(toParent: nil)
            view.removeFromSuperview()
            removeFromParent()
            onDismissed?()
            return
        }
        // 已经关闭过的容器再 hide 一次时不重复触发 onDismissed（调用方可能重复收尾）。
        if wasAttached { onDismissed?() }
    }

    // MARK: - 无头 / 可见切换

    // 自动核对时把 WebView 作为 child 挂在当前页面最底层：view.window 非空、isHidden=false、
    // alpha 不为 0，WebKit 不会把它当作后台页面冻结 JS；alpha=0.01 且禁用交互，
    // 用户既看不见也点不到。读完 hide() 或失败时由 provider 移除。
    // 返回 false 表示当前正处在 dismiss 动画中/已经被 present，不能直接 addChild。
    // 调用方（SchoolProvider）据此在 0.4s 后重试一次，避免静默把 WebView 留在未挂载状态。
    // 同一时间只允许主线程调用；非主线程时同步切到主队列，保证返回值可信。
    @discardableResult
    /// 把浏览器以「隐形小尾巴」挂到当前页面最底层，让网页脚本继续运行。
    /// 返回 false 表示正在关闭动画中，暂时挂不上；调用方稍后应重试一次。
    public func attachHeadless(to presenter: UIViewController, mode: SchoolURLPolicy.WebMode, urlString: String) -> Bool {
        if Thread.isMainThread {
            return attachHeadlessOnMain(to: presenter, mode: mode, urlString: urlString)
        }
        var attached = false
        DispatchQueue.main.sync {
            attached = attachHeadlessOnMain(to: presenter, mode: mode, urlString: urlString)
        }
        return attached
    }

    /// attachHeadless 的实际执行体；只在主线程跑，保证返回值可信。
    private func attachHeadlessOnMain(to presenter: UIViewController, mode: SchoolURLPolicy.WebMode, urlString: String) -> Bool {
        // 已经 present 的控制器不能直接 addChild，必须先走 hide/presentForUser 的正确转场；
        // dismiss 动画未结束时 parent 关系已经拆掉，此时 addChild 会让 WebKit 认为视图不在层级里。
        if presentingViewController != nil || dismissing { return false }
        self.mode = mode
        applyModeText()
        _ = view
        if parent == nil {
            view.frame = presenter.view.bounds
            view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.alpha = 0.01
            view.isHidden = false
            view.isUserInteractionEnabled = false
            view.accessibilityElementsHidden = true
            presenter.addChild(self)
            presenter.view.insertSubview(view, at: 0)
            didMove(toParent: presenter)
        } else {
            view.alpha = 0.01
            view.isUserInteractionEnabled = false
            view.accessibilityElementsHidden = true
        }
        isHeadless = true
        isUserVisible = false
        if urlString.isEmpty == false { load(urlString: urlString) }
        return true
    }

    // needLogin 时由 provider 调用：保留当前页面（不 reload），从无头 child 转成用户可见的 modal。
    /// 需要用户输入账号密码时调用：把隐形页面恢复成正常可见、可点击的页面。
    /// 会保留当前网页不重新加载；App 在后台时拒绝弹出，提示用户先回到前台。
    public func presentForUser(from presenter: UIViewController) {
        performOnMain { [weak self] in
            guard let self = self else { return }
            if self.isUserVisible || self.presentingViewController != nil || self.dismissing { return }
            // 后台时 UIKit 会忽略 present。此时若先置 isUserVisible=true，状态会永久卡住，
            // onDismissed 也不会回调，请假/登录状态机就会残留。先拒绝，等回到前台再触发。
            guard UIApplication.shared.applicationState == .active else {
                self.updateNote("请回到江水课表完成登录")
                return
            }
            self.detachHeadlessOnMain()
            _ = self.view
            self.view.alpha = 1.0
            self.view.isUserInteractionEnabled = true
            self.view.accessibilityElementsHidden = false
            self.modalPresentationStyle = .fullScreen
            presenter.present(self, animated: true) { [weak self] in
                guard let self = self else { return }
                // 以 present 完成后的实际状态为准：被系统忽略/目标控制器已消失时不要卡在“可见”。
                if self.presentingViewController != nil {
                    self.isUserVisible = true
                } else {
                    self.updateNote("学校页面暂时无法打开，请稍后重试")
                }
            }
        }
    }

    /// 把隐形子页面从父页面身上摘下来，但不触发关闭回调（因为马上要转成可见页面）。
    private func detachHeadlessOnMain() {
        guard parent != nil else {
            isHeadless = false
            return
        }
        willMove(toParent: nil)
        view.removeFromSuperview()
        removeFromParent()
        isHeadless = false
    }

    // MARK: - 导航

    // 对应 SchoolClient 的 shouldOverrideUrlLoading：只允许白名单，其余 fail-closed。
    // 可在任意线程调用：界面操作会兜底切到主线程。
    /// 让浏览器打开一个地址；先过白名单，被拒绝时只更新提示，不会跳转。
    public func load(urlString: String) {
        performOnMain { [weak self] in
            self?.loadOnMain(urlString: urlString)
        }
    }

    /// load 的实际执行体：白名单不通过或地址解析失败时，停在原页面并给出中文提示。
    private func loadOnMain(urlString: String) {
        if SchoolURLPolicy.allowedNavigation(urlString, mode: mode) == false {
            updateNote("已拦截校外页面跳转")
            return
        }
        guard let url = URL(string: urlString) else {
            updateNote("学校页面地址无效")
            return
        }
        guard let web = web else { return }
        web.load(URLRequest(url: url))
    }

    // 返回 true 表示已回退上一页；false 表示没有可回退的页面（调用方决定是否关闭）。
    // 同步返回结果，因此不做线程兜底：必须由主线程调用。
    @discardableResult
    /// 后退一页；返回 true 表示退成功，false 表示没有上一页（调用方决定是否关闭）。
    /// 这个函数同步返回结果，所以调用方必须自己保证在主线程。
    public func goBack() -> Bool {
        guard let web = web else { return false }
        if web.canGoBack {
            web.goBack()
            return true
        }
        return false
    }

    // 在页面里执行脚本（P2 注入读取脚本 / 轮询结果）。完成回调在主线程。
    // 可在任意线程调用：界面操作会兜底切到主线程。
    /// 在网页里执行一段 JavaScript；value 是网页返回值，error 是执行失败原因。
    /// 页面还没准备好时会直接回错误，不会卡住调用方。
    public func evaluate(script: String, completion: @escaping (Any?, Error?) -> Void) {
        performOnMain { [weak self] in
            guard let web = self?.web else {
                completion(nil, NSError(domain: "SchoolWebViewHost", code: -1,
                                        userInfo: [NSLocalizedDescriptionKey: "学校页面未就绪"]))
                return
            }
            web.evaluateJavaScript(script) { value, error in completion(value, error) }
        }
    }

    // 对应 Android WebView.stopLoading（读取失败或取消时停止加载）。
    // 可在任意线程调用：界面操作会兜底切到主线程。
    /// 停止加载当前网页；读取被取消或失败时调用，避免后台继续耗流量。
    public func stopLoading() {
        performOnMain { [weak self] in
            self?.web?.stopLoading()
        }
    }

    // 可在任意线程调用：界面操作会兜底切到主线程。
    /// 重新加载当前网页；相当于浏览器里的刷新按钮。
    public func reload() {
        performOnMain { [weak self] in
            self?.web?.reload()
        }
    }

    // 可在任意线程调用：提示文本与 onMessage 回调都在主线程执行。
    /// 更新浏览器顶部的提示文字，同时通知外面；参数 text 会原样显示给用户。
    public func updateNote(_ text: String) {
        performOnMain { [weak self] in
            self?.noteLabel?.text = text
            self?.onMessage?(text)
        }
    }

    /// 判断地址是不是普通网页地址（http 或 https）；其他协议不放给系统浏览器。
    private func isHttpURL(_ raw: String) -> Bool {
        guard let scheme = URL(string: raw)?.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }

    // 对应 Android 对「有手势的主框架外链」startActivity：只有 http(s) 才交给系统浏览器。
    /// 把校外链接交给系统浏览器打开；只接受 http(s)，打不开时给出拦截提示。
    private func openExternally(_ raw: String) {
        guard let url = URL(string: raw), isHttpURL(raw) else {
            updateNote("已拦截自动跳转到校外页面")
            return
        }
        if UIApplication.shared.canOpenURL(url) {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            updateNote("已用系统浏览器打开外部链接")
        } else {
            updateNote("已拦截自动跳转到校外页面")
        }
    }

    // 找到当前最上层、可 present 的控制器。必须在主线程调用。
    /// 从所有窗口里找当前最上层、能弹出页面的控制器；找不到时返回 nil。
    public static func topPresenter() -> UIViewController? {
        var windows: [UIWindow] = []
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            let state = windowScene.activationState
            if state != .foregroundActive && state != .foregroundInactive { continue }
            windows.append(contentsOf: windowScene.windows)
        }
        var root: UIViewController?
        for window in windows where window.isKeyWindow {
            root = window.rootViewController
            break
        }
        if root == nil {
            for window in windows {
                if let candidate = window.rootViewController {
                    root = candidate
                    break
                }
            }
        }
        guard var top = root else { return nil }
        while true {
            if let presented = top.presentedViewController {
                top = presented
                continue
            }
            if let navigation = top as? UINavigationController, let visible = navigation.visibleViewController {
                top = visible
                continue
            }
            if let tabs = top as? UITabBarController, let selected = tabs.selectedViewController {
                top = selected
                continue
            }
            return top
        }
    }

    // MARK: - 界面构建

    /// 搭顶栏：左边「返回课表」、中间标题、右边「刷新」，下面再放提示文字。
    private func buildBar() {
        let bar = UIView()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.backgroundColor = UIColor(white: 0.97, alpha: 1.0)
        view.addSubview(bar)

        let back = UIButton(type: .system)
        back.translatesAutoresizingMaskIntoConstraints = false
        back.setTitle("返回课表", for: .normal)
        back.titleLabel?.font = UIFont.systemFont(ofSize: 15.0)
        back.addTarget(self, action: #selector(handleBackTap), for: .touchUpInside)
        bar.addSubview(back)

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.textAlignment = .center
        title.font = UIFont.boldSystemFont(ofSize: 16.0)
        bar.addSubview(title)
        self.titleLabel = title

        let refresh = UIButton(type: .system)
        refresh.translatesAutoresizingMaskIntoConstraints = false
        refresh.setTitle("刷新", for: .normal)
        refresh.titleLabel?.font = UIFont.systemFont(ofSize: 15.0)
        refresh.addTarget(self, action: #selector(handleRefreshTap), for: .touchUpInside)
        bar.addSubview(refresh)

        let note = UILabel()
        note.translatesAutoresizingMaskIntoConstraints = false
        note.numberOfLines = 2
        note.font = UIFont.systemFont(ofSize: 12.0)
        note.textColor = UIColor.darkGray
        view.addSubview(note)
        self.noteLabel = note

        bar.leadingAnchor.constraint(equalTo: view.leadingAnchor).isActive = true
        bar.trailingAnchor.constraint(equalTo: view.trailingAnchor).isActive = true
        bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor).isActive = true
        bar.heightAnchor.constraint(equalToConstant: 44.0).isActive = true

        back.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 12.0).isActive = true
        back.centerYAnchor.constraint(equalTo: bar.centerYAnchor).isActive = true

        title.centerXAnchor.constraint(equalTo: bar.centerXAnchor).isActive = true
        title.centerYAnchor.constraint(equalTo: bar.centerYAnchor).isActive = true
        title.leadingAnchor.constraint(greaterThanOrEqualTo: back.trailingAnchor, constant: 8.0).isActive = true
        title.trailingAnchor.constraint(lessThanOrEqualTo: refresh.leadingAnchor, constant: -8.0).isActive = true

        refresh.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -12.0).isActive = true
        refresh.centerYAnchor.constraint(equalTo: bar.centerYAnchor).isActive = true

        note.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16.0).isActive = true
        note.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16.0).isActive = true
        note.topAnchor.constraint(equalTo: bar.bottomAnchor, constant: 6.0).isActive = true
    }

    /// 创建真正的 WKWebView，并装上 Cookie 存储、定位转接器和安全策略。
    private func buildWebView() {
        guard let note = noteLabel else { return }
        let configuration = WKWebViewConfiguration()
        // 与 Android CookieManager 的持久化语义对齐：显式使用默认数据存储。
        configuration.websiteDataStore = WKWebsiteDataStore.default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        // 定位 shim：iOS 15–26 没有公开的 WKWebView geolocation 授权回调，
        // 只能在文档开始替换 navigator.geolocation，再经原生取一次坐标。
        let userContentController = WKUserContentController()
        userContentController.addUserScript(WKUserScript(
            source: SchoolGeolocationBridge.injectionScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        ))
        geoBridge.host = self
        userContentController.add(geoBridge, name: SchoolGeolocationBridge.handlerName)
        configuration.userContentController = userContentController
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        // 与 Android 一致：关闭手势前进后退，导航只走白名单逻辑。
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.keyboardDismissMode = .onDrag
        view.addSubview(webView)
        self.web = webView

        webView.leadingAnchor.constraint(equalTo: view.leadingAnchor).isActive = true
        webView.trailingAnchor.constraint(equalTo: view.trailingAnchor).isActive = true
        webView.topAnchor.constraint(equalTo: note.bottomAnchor, constant: 6.0).isActive = true
        webView.bottomAnchor.constraint(equalTo: view.bottomAnchor).isActive = true
    }

    /// 按用途改标题和默认提示：教务页说登录，请假页说请假/销假/续假。
    private func applyModeText() {
        guard let title = titleLabel else { return }
        if mode == .school {
            title.text = "学校教务"
            noteLabel?.text = "请在学校页面完成登录"
        } else {
            title.text = "请假服务（实验）"
            noteLabel?.text = "请在学校页面完成请假、销假或续假操作"
        }
    }

    /// 用户点顶栏「返回课表」时执行：关闭浏览器，回到课表页面。
    @objc private func handleBackTap() {
        hide()
    }

    /// 用户点顶栏「刷新」时执行：先提示正在刷新，再重新加载网页。
    @objc private func handleRefreshTap() {
        updateNote("正在刷新…")
        reload()
    }
}

// MARK: - WKNavigationDelegate

extension SchoolWebViewHost {

    // 对应 Android 的 shouldOverrideUrlLoading：默认拒绝，只放行白名单页面。
    /// 每个跳转请求都会先到这里：子页面直接放行，主页面必须通过白名单。
    /// 不允许的地址会被取消；用户主动点的校外链接才交给系统浏览器。
    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // 子框架（iframe 等）不做白名单判定：Android 的 shouldOverrideUrlLoading 只拦主框架，
        // 教务/门户页用 iframe 承载登录或统计时一律 cancel 会让页面白屏（真机若白屏优先查这里）。
        // 子框架无法把顶层导航到白名单外：那种跳转会作为新的主框架 navigationAction 再走一遍本方法。
        if navigationAction.targetFrame?.isMainFrame == false {
            decisionHandler(.allow)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            updateNote("已拦截校外页面跳转")
            return
        }
        let raw = url.absoluteString
        if SchoolURLPolicy.allowedNavigation(raw, mode: mode) == false {
            decisionHandler(.cancel)
            if mode == .leaveApp {
                // Android 用「有用户手势」放行到系统浏览器；iOS 没有 hasGesture，
                // 用 .linkActivated 近似（用户点了链接，而不是脚本/重定向自动跳转）。
                if navigationAction.navigationType == .linkActivated, isHttpURL(raw) {
                    openExternally(raw)
                } else {
                    updateNote("已拦截自动跳转到校外页面")
                }
            } else {
                updateNote("已拦截校外页面跳转")
            }
            return
        }
        // window.open / target=_blank：不允许新窗口（Android 亦禁多窗口），改为当前页加载。
        if navigationAction.targetFrame == nil {
            decisionHandler(.cancel)
            load(urlString: raw)
            return
        }
        onNavigate?(raw)
        decisionHandler(.allow)
    }

    /// 网页加载完成时调用：先恢复默认提示，再通知外面「这一页好了」。
    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        let raw = webView.url?.absoluteString ?? ""
        if mode == .leaveApp {
            updateNote("请在学校页面完成请假、销假或续假操作")
        } else {
            updateNote("请在学校页面完成登录")
        }
        onPageFinished?(raw)
    }

    /// 网页还没真正开始加载就失败（例如域名解析不了）时调用。
    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
        handleNavigationFailure(error)
    }

    /// 网页加载到一半失败（例如网络断开）时调用。
    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
        handleNavigationFailure(error)
    }

    /// 网页进程被系统回收时调用；这里只提示重新打开，不自动重建页面。
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // 对应 Android onRenderProcessGone：保留容器但复位页面，提示用户重新打开。
        updateNote("学校页面已关闭，请重新打开")
        onProcessTerminated?()
    }

    /// 统一处理加载失败：用户主动取消不算错误，其余提示「检查网络」并通知外面。
    private func handleNavigationFailure(_ error: Error) {
        let nsError = error as NSError
        // 用户取消导航不是错误（例如被策略 cancel 或 goBack 打断）。
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
            return
        }
        // iOS 16 的 WKWebView 不暴露 SSL 证书错误，证书异常也会走到这里。
        updateNote("学校页面暂时无法连接，请检查网络后重试")
        onNavigationFailure?(error)
    }
}

// MARK: - WKUIDelegate

extension SchoolWebViewHost {

    // 文件上传：不实现 runOpenPanelWith。WebKit 的 WKUIDelegate.h 明确写着
    // 「iOS/visionOS 不实现该方法时，WebView 会采用 Safari 的文件上传行为」，
    // 所以 iOS 15+ 的 <input type=file> 仍会弹出系统选择器（照片/文件）。
    // 不在 delegate 上实现的原因：WKOpenPanelParameters 与该方法直到 iOS 18.4 才加入；
    // 本机用 Xcode 15.4（iOS 17.x SDK）构建时，iOS 目标下该类型可能不可用，会编译失败。
    // 自定义 SchoolFilePicker 暂留作 iOS 18.4+ 的可选实现（当前未接线），见 PHASE2 文档。

    // window.open / target=_blank：Android 关掉多窗口后会在原 WebView 打开；
    // 这里也返回 nil（不创建新 WebView），允许的 URL 直接在当前页加载。
    /// 网页想开新窗口（window.open / target=_blank）时调用；这里不建新窗口。
    /// 允许的地址在当前页打开，校外链接按模式拦截或交给系统浏览器。
    public func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        let raw = url.absoluteString
        if SchoolURLPolicy.allowedNavigation(raw, mode: mode) {
            load(urlString: raw)
        } else if mode == .leaveApp, isHttpURL(raw) {
            openExternally(raw)
        } else {
            updateNote(mode == .leaveApp ? "已拦截自动跳转到校外页面" : "已拦截校外页面跳转")
        }
        return nil
    }

    // 未来兼容：Apple 文档标明该回调 iOS 27.0 才引入，iOS 15–26 的 WebKit 不会调用。
    // 当前实际定位由 SchoolGeolocationBridge 的 navigator.geolocation shim 完成；
    // 这里保留方法只用于 iOS 27+，不要把它当成 iOS 15 可用的实现。
    /// iOS 27 才可能调用的定位授权入口；iOS 15–26 实际走 SchoolGeolocationBridge。
    public func webView(_ webView: WKWebView, requestGeolocationPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        guard mode == .leaveApp, allowedGeoOrigin(origin) else {
            decisionHandler(.deny)
            return
        }
        SchoolLocationPermission.shared.request(prompt: { [weak self] in
            self?.updateNote("请假表单需要位置信息，请允许定位权限")
        }, completion: { granted in
            decisionHandler(granted ? .grant : .deny)
        })
    }

    /// 判断定位请求来自哪里：只允许请假系统的 https 地址（443 端口）。
    private func allowedGeoOrigin(_ origin: WKSecurityOrigin) -> Bool {
        let scheme = origin.`protocol`.lowercased()
        guard scheme == "https" else { return false }
        guard SchoolURLPolicy.isXgxtUrl("https://" + origin.host) else { return false }
        return origin.port == 0 || origin.port == 443
    }

    /// 网页弹出 alert 时，用系统弹窗把文字显示给用户，点确定后回到网页。
    public func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        presentSimpleAlert(message: message, completionHandler: completionHandler)
    }

    /// 网页弹出 confirm 时，显示取消/确定两个按钮，并把用户选择回传给网页。
    public func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let top = SchoolWebViewHost.topPresenter() else {
            completionHandler(false)
            return
        }
        let alert = UIAlertController(title: "学校页面", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel, handler: { _ in completionHandler(false) }))
        alert.addAction(UIAlertAction(title: "确定", style: .default, handler: { _ in completionHandler(true) }))
        top.present(alert, animated: true, completion: nil)
    }

    /// 显示只有一个「确定」按钮的系统弹窗；找不到可弹窗的页面时直接放行。
    private func presentSimpleAlert(message: String, completionHandler: @escaping () -> Void) {
        guard let top = SchoolWebViewHost.topPresenter() else {
            completionHandler()
            return
        }
        let alert = UIAlertController(title: "学校页面", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "确定", style: .default, handler: { _ in completionHandler() }))
        top.present(alert, animated: true, completion: nil)
    }
}
