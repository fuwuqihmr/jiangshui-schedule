// 【这个文件干什么】网页的“大管家”：开本地网站、装传话筒、显示页面、处理前后台和返回。
// 【什么时候会用到它】App 启动后一直用；回前台、切深色、点返回、注销都会经过这里。
// 【它和谁配合】LocalServer 提供网页，JSBridge/BridgeDispatcher 接原生能力，RootView 负责显示。
import Foundation
import SwiftUI
import UIKit
import WebKit

/// 管住一个 WKWebView（iOS 里显示网页的控件）的完整生命周期；页面本身还是 web/ 里的网页。
///
/// 承载页面的 WKWebView 宿主（契约 §1/§2）。
///
/// 职责：
/// - 启动 loopback 静态服务，把 http://127.0.0.1:<port>/index.html 载入 WKWebView
/// - 安装桥接 shim + WKScriptMessageHandler(`jiangshuiBridge`)
/// - 前后台：回前台确保服务存活并 `window.onNativeResume()`
/// - 外观：系统深浅色变化时同步 `window.onNativeSystemThemeChanged`
/// - 返回：调用 web 的 `window.__dsjOnBack()`（与 Android onBackPressed 同一逻辑）
/// - 注销：回包后清 WKWebsiteDataStore 并重新加载出同意页
final class WebHost: NSObject, ObservableObject {
    /// 错误遮罩标题：服务起不来 vs 页面导航失败，文案不同。
    @Published private(set) var serverErrorTitle: String = "页面服务未启动"
    /// 主线程持有；nil 表示还没创建（首次 UI 渲染时创建）。
    @Published private(set) var serverError: String?
    /// JS 拒绝协议后显示覆盖页（Android 是 finish 掉 Activity，这里只遮罩）。
    @Published private(set) var consentDeclined = false
    // 网页是否已经加载完成；只有完成了，回前台才会叫 onNativeResume。
    @Published private(set) var pageLoaded = false

    // 原生能力集合（通知、日历、文件等），网页通过桥调用它们。
    private let services: NativeServicesProviding
    // 本地小网站，负责把 App 包里的网页文件发给 WKWebView。
    private let server: LocalServer
    // 网页和原生之间的收发器。
    private let bridge = JSBridge()
    // 接收网页背景色，供顶部安全区色条使用。
    private let shellThemeHandler = ShellThemeHandler()
    /// 页面 `--bg` 的当前值（由注入脚本回传），供 RootView 顶部安全区色条使用。
    @Published var shellBackgroundColor: UIColor = .systemBackground
    // 35 个 action 的路由器。
    private let dispatcher: BridgeDispatcher
    // 只创建一次的 WKWebView；RootView 每次刷新都复用它。
    private var webViewStorage: WKWebView?
    // 页面加载中标志；onReady 与 scenePhase .active 可能连续触发，避免自己取消自己。
    private var isLoading = false
    // 最近一次请求加载的端口。
    private var currentLoadPort: UInt16?
    // 已经加载完成的端口；端口变化必须重新加载。
    private var loadedPort: UInt16?
    // 最近一次 webView.load 返回的导航，用来忽略旧导航迟到的回调。
    private var currentNavigation: WKNavigation?
    // 本次加载是否已经自动重试过；最多一次，成功/手动重试才复位。
    private var autoRetryUsed = false
    // 0.4 秒后执行的自动重试任务；手动重试/加载成功时取消。
    private var autoRetryWorkItem: DispatchWorkItem?
    // 当前这一轮是不是自动重试：是的话 loadIndex 不能清零 autoRetryUsed，否则会无限重试。
    private var isAutoRetryRound = false

    /// 注销后延迟清数据，保证 logout 的回包先到 JS（web/app.mjs:595 随后 location.reload()）。
    private static let logoutCleanupDelay: TimeInterval = 0.8

    /// 把服务、服务器、桥和路由器接好；真正的页面要等 makeWebView() 才出现。
    init(services: NativeServicesProviding) {
        self.services = services
        self.server = LocalServer(assets: WebAssets())
        self.dispatcher = BridgeDispatcher(services: services, transport: bridge)
        super.init()

        shellThemeHandler.host = self
        bridge.dispatcher = dispatcher
        dispatcher.onLogout = { [weak self] in self?.performLogoutCleanup() }
        dispatcher.onConsentDeclined = { [weak self] in self?.consentDeclined = true }

        server.onReady = { [weak self] port in
            guard let self = self else { return }
            self.serverError = nil
            // 自动重试终于等到端口：先记一笔，再交给 loadIndex 真正加载。
            if self.isAutoRetryRound {
                self.services.state.log("page-load-retry port=\(port)")
            }
            self.loadIndex(port: port)
        }
        server.onFailure = { [weak self] message in
            guard let self = self else { return }
            self.isLoading = false
            self.pageLoaded = false
            self.loadedPort = nil
            self.currentLoadPort = nil
            self.currentNavigation = nil
            self.isAutoRetryRound = false
            self.serverErrorTitle = "页面服务未启动"
            self.serverError = message
        }
        server.onInterrupted = { [weak self] in
            guard let self = self else { return }
            // 端口已不可用：丢掉旧地址，等自动重启的 onReady 重新加载。
            self.isLoading = false
            self.pageLoaded = false
            self.loadedPort = nil
            self.currentLoadPort = nil
            self.currentNavigation = nil
        }
    }

    /// App 退出或宿主销毁时关掉本地服务，避免端口一直被占着。
    deinit {
        server.stop()
    }

    // MARK: - WebView

    /// 第一次调用时创建网页控件并装好所有注入脚本和手势；之后直接返回同一个。
    ///
    /// 首次调用创建 WKWebView；之后复用（RootView 的 UIViewRepresentable 调用）。
    func makeWebView() -> WKWebView {
        if let webView = webViewStorage { return webView }
        // 网页配置：持久化存储、允许 JS、禁止自动弹新窗口。
        let configuration = WKWebViewConfiguration()
        // 默认持久化 store：localStorage 跨启动保留（同意状态/课表都在这里）。
        configuration.websiteDataStore = WKWebsiteDataStore.default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.allowsInlineMediaPlayback = true
        // 用户脚本和消息处理器都挂在 controller 上；页面每次加载都会用到。
        let controller = WKUserContentController()
        installUserScripts(on: controller)
        controller.add(bridge, name: JSBridge.handlerName)
        controller.add(shellThemeHandler, name: ShellThemeHandler.name)
        configuration.userContentController = controller

        // 真正显示网页的控件；透明背景让下面的色条能透出来。
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.isOpaque = false
        // 顶部色条在 WebView 外：显式裁剪，滚动内容不可能绘制到状态栏/灵动岛区域。
        webView.clipsToBounds = true
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        // iOS 没有系统返回键：用左边缘右划手势代替（不占屏幕空间，不会压住页面标题）。
        // 页面内每个可退状态本身都有按钮（假条页 leave-page-back、弹窗 ×、底部 tab），手势只是顺手的补充。
        // 从左边缘往右划，等价于 Android 的返回键。
        let edgePan = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(handleEdgePan(_:)))
        edgePan.edges = .left
        edgePan.cancelsTouchesInView = false
        webView.addGestureRecognizer(edgePan)

        webViewStorage = webView
        bridge.attach(webView: webView)
        return webView
    }

    /// 页面每次加载前重装三个脚本：桥、安全区样式、主题颜色上报。
    ///
    /// 每次（重新）加载都要重装：`loadIndex` 会先 removeAllUserScripts()。
    private func installUserScripts(on controller: WKUserContentController) {
        controller.removeAllUserScripts()
        controller.addUserScript(JSBridge.userScript(systemDark: isSystemDark()))
        controller.addUserScript(Self.safeAreaUserScript())
        controller.addUserScript(Self.shellThemeUserScript())
    }

    /// iOS 专属安全区样式（F10 门禁逐字要求保留）。
    /// A 方案下 WebView 顶部已从安全区下沿开始，env(safe-area-inset-top) 通常为 0，
    /// 这里退化为基础内边距；横屏左右刘海/底部 home indicator 仍靠它，协议页/请假页也随 WebView 下移。
    /// Android 的 WebView 由系统栏内缩，不注入这段样式。
    static let safeAreaCSS = """
    @media (max-width:720px){
      .main{padding-top:calc(27px + env(safe-area-inset-top))!important;padding-left:max(18px,env(safe-area-inset-left))!important;padding-right:max(18px,env(safe-area-inset-right))!important}
      .agreement-screen{padding-top:calc(14px + env(safe-area-inset-top))!important;padding-bottom:calc(14px + env(safe-area-inset-bottom))!important}
      .leave-page-topbar{padding-top:calc(14px + env(safe-area-inset-top))!important}
    }
    """

    /// 把安全区 CSS 在页面刚开始加载时塞进去，让内容避开刘海和底部横条。
    static func safeAreaUserScript() -> WKUserScript {
        // CSS 里有换行和引号，先 JSON 编码成合法的 JS 字符串字面量，避免手写转义。
        let cssLiteral = jsStringLiteral(safeAreaCSS)
        let source = """
        (function(){
          try {
            var style = document.createElement('style');
            style.setAttribute('data-jiangshui','safe-area');
            style.textContent = \(cssLiteral);
            var parent = document.head || document.documentElement;
            if (parent) { parent.appendChild(style); }
            else if (document.addEventListener) {
              document.addEventListener('DOMContentLoaded', function(){ (document.head || document.documentElement).appendChild(style); });
            }
          } catch (e) {}
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    /// 页面主题一变就把 --bg 的颜色回传原生，顶部色条跟着换色。
    ///
    /// 读取页面 `--bg` 并回传原生，让顶部色条跟随浅色/深色/蓝/紫主题（web 共享层不用改）。
    static func shellThemeUserScript() -> WKUserScript {
        let source = """
        (function(){
          var last='';
          function report(){
            try{
              var value=String(getComputedStyle(document.documentElement).getPropertyValue('--bg')||'').trim();
              if(!value||value===last)return;
              last=value;
              window.webkit.messageHandlers.\(ShellThemeHandler.name).postMessage(value);
            }catch(e){}
          }
          function start(){
            report();
            try{ new MutationObserver(report).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class','style']}); }catch(e){}
          }
          if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
          window.addEventListener('load',report);
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    /// Swift 字符串 → JS 字符串字面量（带引号）。
    static func jsStringLiteral(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
              let text = String(data: data, encoding: .utf8) else { return "\"\"" }
        return text
    }

    /// 解析 web `--bg` 的 #rgb/#rrggbb；解析失败返回 nil，顶部色条保留系统色兜底。
    fileprivate static func cssColor(_ raw: String) -> UIColor? {
        var hex = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if hex.hasPrefix("#") { hex.removeFirst() }
        if hex.count == 3 {
            var expanded = ""
            for character in hex { expanded.append(character); expanded.append(character) }
            hex = expanded
        }
        guard hex.count == 6, let value = UInt32(hex, radix: 16) else { return nil }
        return UIColor(red: CGFloat((value >> 16) & 0xFF) / 255.0,
                       green: CGFloat((value >> 8) & 0xFF) / 255.0,
                       blue: CGFloat(value & 0xFF) / 255.0,
                       alpha: 1.0)
    }

    // MARK: - 生命周期

    /// 开启一轮全新的页面加载：清零自动重试次数，并取消还没执行的自动重试。
    /// 自动重试那一轮不能调这里，否则失败后还会再自动重试，变成无限循环。
    private func beginLoadSession() {
        autoRetryUsed = false
        isAutoRetryRound = false
        autoRetryWorkItem?.cancel()
        autoRetryWorkItem = nil
    }

    /// App 前台/启动时调用：服务没起就起，起了就直接加载页面。
    func startIfNeeded() {
        if let port = server.port {
            // 端口还在但 listener 已死：不能继续用旧地址，必须 stop→start。
            guard server.isHealthy else {
                retryPage()
                return
            }
            if pageLoaded && loadedPort == port { return }
            if isLoading && currentLoadPort == port { return }
            loadIndex(port: port)
            return
        }
        // 正在启动/重启：等 onReady 统一触发加载。
        if server.isRunning { return }
        server.start()
    }

    /// App 回到前台时调用：确保服务还在，并叫网页执行 onNativeResume。
    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            // 长时间在后台可能已经失败过一轮；回前台先当全新会话，第一次失败仍静默重试。
            beginLoadSession()
            startIfNeeded()
            resumePageIfReady()
        default:
            break
        }
    }

    /// 系统深色/浅色切换时调用：通知网页更新主题。
    func colorSchemeChanged(_ dark: Bool) {
        guard let webView = webViewStorage else { return }
        let value = dark ? "true" : "false"
        let script = """
        window.__jiangshuiDark = \(value);
        if (window.onNativeSystemThemeChanged) { window.onNativeSystemThemeChanged(\(value)); }
        """
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    /// 返回：与 Android 返回键走同一份 JS 逻辑；true 表示 JS 已消费。
    func navigateBack() {
        guard let webView = webViewStorage else { return }
        let script = "(function(){try{return window.__dsjOnBack?window.__dsjOnBack()===true:false}catch(e){return false}})()"
        webView.evaluateJavaScript(script) { [weak self] value, _ in
            guard let self = self else { return }
            if let consumed = value as? Bool, consumed { return }
            // iOS 没有任务栈可退：页面未消费返回键时保持现状（与 Android moveTaskToBack 等价）。
            _ = self
        }
    }

    /// 左边缘右划 ≈ Android 返回键。
    @objc private func handleEdgePan(_ gesture: UIScreenEdgePanGestureRecognizer) {
        guard gesture.state == .ended else { return }
        navigateBack()
    }

    // MARK: - 页面加载

    /// 重试整条链路：先停掉可能已死的监听器，再从 47851 重新启动。
    /// 手动重试会取消尚未执行的自动重试；自动重试不重置计数，保证每轮最多一次。
    func retryPage() {
        retryPage(autoRetry: false)
    }

    private func retryPage(autoRetry: Bool) {
        if !autoRetry {
            // 手动重试 = 新会话：清零计数，取消可能还在排队的自动重试。
            autoRetryUsed = false
            autoRetryWorkItem?.cancel()
            autoRetryWorkItem = nil
            isAutoRetryRound = false
        } else {
            // 自动重试轮：保留 autoRetryUsed=true，并告诉下一轮 loadIndex 不要当新会话。
            autoRetryUsed = true
            isAutoRetryRound = true
        }
        serverError = nil
        isLoading = false
        pageLoaded = false
        loadedPort = nil
        currentLoadPort = nil
        currentNavigation = nil
        server.stop()
        server.start()
    }

    /// 让 WKWebView 打开本地服务地址；同时重置桥和页面状态。
    private func loadIndex(port: UInt16, force: Bool = false) {
        guard let webView = webViewStorage else { return }
        // 开始一次（或确认一次）页面加载时先收起旧错误，避免成功重载后遮罩不退。
        serverError = nil
        // 同一端口已经在加载，或已经加载完成：不要重复 load，否则第一次导航会被取消。
        if !force {
            if isLoading && currentLoadPort == port { return }
            if pageLoaded && loadedPort == port { return }
        }
        guard let url = URL(string: "http://127.0.0.1:\(port)/index.html") else {
            serverErrorTitle = "页面加载失败"
            serverError = "页面地址无效"
            return
        }
        // 先判断这一轮是不是自动重试；只有真正的新加载才清零计数。
        let autoRound = isAutoRetryRound
        if autoRound {
            // 自动重试已经真正开始：保留 autoRetryUsed=true，第二次失败就直接报错。
            isAutoRetryRound = false
        } else {
            beginLoadSession()
        }
        services.state.log("page-load-start port=\(port) force=\(force ? 1 : 0) auto=\(autoRound ? 1 : 0)")
        // 重新生成 shim，让页面模块求值时读到当前系统外观。
        installUserScripts(on: webView.configuration.userContentController)
        bridge.reset()
        isLoading = true
        currentLoadPort = port
        pageLoaded = false
        loadedPort = nil
        serverError = nil
        consentDeclined = false
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        currentNavigation = webView.load(request)
    }

    /// 页面已加载时执行 window.onNativeResume()；没加载就什么都不做。
    private func resumePageIfReady() {
        guard pageLoaded, let webView = webViewStorage else { return }
        let script = "window.onNativeResume&&window.onNativeResume()"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    /// 注销清完网页数据后强制重新加载当前本地页面。
    private func reloadFromServer() {
        if let port = server.port, server.isHealthy {
            loadIndex(port: port, force: true)
        } else {
            retryPage()
        }
    }

    /// 页面导航失败：每轮加载最多自动重试一次，第二次才显示错误遮罩。
    private func handleLoadFailure(_ error: Error) {
        guard isLoading, webViewStorage != nil else { return }
        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled else { return }
        let retryLabel = autoRetryUsed ? "第二次" : "used"
        services.state.log("page-load-failed code=\(nsError.code) retry=\(retryLabel)")
        isLoading = false
        pageLoaded = false
        loadedPort = nil
        if !autoRetryUsed {
            autoRetryUsed = true
            serverError = nil
            let work = DispatchWorkItem { [weak self] in
                guard let self = self else { return }
                self.autoRetryWorkItem = nil
                self.retryPage(autoRetry: true)
            }
            autoRetryWorkItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
        } else {
            serverErrorTitle = "页面加载失败"
            let message = nsError.localizedDescription
            serverError = message.isEmpty ? "无法连接服务器。" : message
        }
    }

    /// 只接受最近一次 load 的导航回调，忽略旧导航迟到的回调。
    /// currentNavigation 为空（如 retryPage 刚清空）时一律拒绝旧回调；非空而 navigation 为空时仍视为当前导航。
    private func isCurrentNavigation(_ navigation: WKNavigation?) -> Bool {
        guard let current = currentNavigation else { return false }
        guard let navigation = navigation else { return true }
        return current === navigation
    }

    /// 问主题服务当前系统是不是深色；注入桥脚本时要靠它给初值。
    private func isSystemDark() -> Bool {
        return services.theme.isSystemDark()
    }

    // MARK: - 注销

    /// 注销后等一小会儿再清网页数据，确保 logout 的回包已经送到 JS。
    private func performLogoutCleanup() {
        DispatchQueue.main.asyncAfter(deadline: .now() + WebHost.logoutCleanupDelay) { [weak self] in
            guard let self = self else { return }
            let store = WKWebsiteDataStore.default()
            let types = WKWebsiteDataStore.allWebsiteDataTypes()
            store.removeData(ofTypes: types, modifiedSince: .distantPast) {
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    self.bridge.reset()
                    self.reloadFromServer()
                }
            }
        }
    }

    // MARK: - 导航策略

    /// 只允许 http://127.0.0.1:<当前端口>/ 开头的地址。
    private func allowedPrefix() -> String? {
        guard let port = server.port else { return nil }
        return "http://127.0.0.1:\(port)/"
    }

    /// 判断一个地址能不能在当前网页里打开；about:blank 例外放行。
    private func isAllowed(_ url: URL) -> Bool {
        if url.absoluteString == "about:blank" { return true }
        guard let prefix = allowedPrefix() else { return false }
        return url.absoluteString.hasPrefix(prefix)
    }
}

/// 只做一件事：把网页发来的颜色字符串校验后交给 WebHost。
///
/// 接收注入脚本回传的页面背景色（消息体是 `#rrggbb` 字符串）。
private final class ShellThemeHandler: NSObject, WKScriptMessageHandler {
    // 消息名，必须和注入脚本里的 postMessage 一致。
    static let name = "jiangshuiShellTheme"
    // weak：WebHost 已经强持有 handler，这里反向引用不能强。
    weak var host: WebHost?

    /// 收到颜色消息：校验名字/类型/格式，再回主线程改色。
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == ShellThemeHandler.name,
              let raw = message.body as? String,
              let color = WebHost.cssColor(raw) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.host?.shellBackgroundColor = color
        }
    }
}

// MARK: - WKNavigationDelegate

/// 导航策略：只让本机页面在壳里打开，其它一律取消。
extension WebHost: WKNavigationDelegate {
    /// 每次要跳转前问这里：允许本机地址，其余取消。
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if isAllowed(url) {
            decisionHandler(.allow)
            return
        }
        // 只允许本机页面；外链/自定义 scheme 一律留在壳内，不交给 Safari（P1 无外链需求）。
        decisionHandler(.cancel)
    }

    /// 页面加载完成：标记 pageLoaded，回前台时才会叫 onNativeResume。
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        guard webViewStorage === webView, isCurrentNavigation(navigation) else { return }
        isLoading = false
        pageLoaded = true
        loadedPort = currentLoadPort
        serverError = nil
        autoRetryUsed = false
        isAutoRetryRound = false
        autoRetryWorkItem?.cancel()
        autoRetryWorkItem = nil
        services.state.log("page-loaded port=\(loadedPort ?? 0)")
    }

    /// 加载失败：每轮自动重试一次；第二次失败才显示错误遮罩。
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
        guard webViewStorage === webView, isCurrentNavigation(navigation) else { return }
        handleLoadFailure(error)
    }

    /// 还没真正开始加载就失败（比如服务没起来）：同样先自动重试一次。
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
        guard webViewStorage === webView, isCurrentNavigation(navigation) else { return }
        handleLoadFailure(error)
    }

    /// WebKit 的网页进程被系统杀掉：重新加载本地页面，数据不会丢。
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webViewStorage === webView else { return }
        // WebKit 进程被系统回收：重新加载本地页面（数据在 localStorage/原生里，不丢）。
        pageLoaded = false
        services.state.log("page-terminate")
        // 页面进程被回收后，这轮加载可能已经死了，但 WebKit 不一定补 didFail，补的也可能是 cancelled。
        // 那样 isLoading 会一直 true，startIfNeeded 永远被同端口 loading 挡住，白屏且没有遮罩。
        // 所以先挂一个只执行一次的 1.5 秒看门狗：认准触发回收时的端口和导航，期间有任何变化就不动。
        let pendingNavigation = currentNavigation
        if let port = server.port, isLoading, currentLoadPort == port {
            let work = DispatchWorkItem { [weak self] in
                guard let self = self else { return }
                guard self.pageLoaded == false,
                      self.isLoading,
                      self.currentLoadPort == port,
                      self.currentNavigation === pendingNavigation else { return }
                self.isLoading = false
                self.services.state.log("page-terminate-recover port=\(port)")
                self.loadIndex(port: port, force: true)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: work)
        }
        // 同一端口已经有一轮加载在飞（可能正是 startIfNeeded 刚发起的）：别再发一次，
        // 否则会把那次导航取消；换端口或没在加载则交给 startIfNeeded 统一处理。
        if let port = server.port, isLoading, currentLoadPort == port { return }
        startIfNeeded()
    }
}

// MARK: - WKUIDelegate（target=_blank / window.open）

/// 处理网页里 target=_blank / window.open 的新窗口请求。
extension WebHost: WKUIDelegate {
    /// 不弹新窗口；是本机地址就在当前页打开，其它丢弃。
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // 不弹新窗口：把允许的本机链接在当前页打开，其余丢弃。
        if let url = navigationAction.request.url, isAllowed(url) {
            webView.load(URLRequest(url: url))
        }
        return nil
    }
}

// MARK: - 当前可用来 present 的 VC（B 的服务需要弹文件选择器/通知授权）

/// 全局记一个“当前最上层页面”，原生弹窗/文件选择器需要它。
///
/// 用弱引用持有「当前最上层 VC」，避免服务层直接依赖 SwiftUI 的视图层级。
final class PresentingViewControllerHolder {
    // 单例：整个 App 共用同一个“最上层页面”指针。
    static let shared = PresentingViewControllerHolder()
    // weak：页面控制器由系统持有，这里只是借用。
    weak var topViewController: UIViewController?
    /// 私有构造：外面只能用 shared。
    private init() {}
}

extension UIViewController {
    /// 从 root VC 找到最上层可 present 的 VC（穿透 presented/navigation）。
    /// 递归往下找：优先 presented，其次导航/标签栏的可见页面。
    var jsjTopMost: UIViewController {
        if let presented = presentedViewController {
            return presented.jsjTopMost
        }
        if let navigation = self as? UINavigationController, let visible = navigation.visibleViewController {
            return visible.jsjTopMost
        }
        if let tab = self as? UITabBarController, let selected = tab.selectedViewController {
            return selected.jsjTopMost
        }
        return self
    }
}
