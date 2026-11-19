// 【这个文件干什么】它是「学校」能力的总调度：网页按下按钮后，最终由它决定打开学校页、读课表还是同步假条。
// 【什么时候会用到它】用户点「同步课表」「打开教务」「请假服务」「取消读取」时，桥接层会调用这里的方法。
// 【它和谁配合】上接 BridgeDispatcher（网页与原生之间的传话员），下接 SchoolWebViewHost（内置浏览器）。
// 再往下是 SchoolReadController（自动抄课表的流程）和 LeaveRecordsService（假条列表）。
// 读课表不是一次网络请求，而是「打开网页 → 等登录 → 注入脚本 → 取结果」的组合动作，本文件只负责调度。
// 所有方法都把失败翻译成 BridgeFailure；网页那边只看到一句中文提示，不会看到底层异常。
// 同一个时间只允许一个读取；自动读取时浏览器默认藏起来，只有需要用户输入账号密码才显示。
// 本机 Windows 没有 Xcode，无法编译；真机验证项见 ios/docs/P2-SCHOOL-READ.md。
import Foundation

// 学校（教务 / 请假）能力。
//
// 对照 Android：
// - MainActivity.java:718-758（Bridge case "openSchool" / "openWebApp" / "leaveRecordSync" /
//   "cancelRead" / "capture" / "sync"）
// - MainActivity.java:214-227（学校客户端装配、beginSchoolRead、cancelRead、show/hide）
// - MainActivity.java:395-404（openWebApp 的校验与打开顺序）
//
// P2 起实现真实教务读取：
// - openSchool(mobile:)：打开学校页面（桌面门户 / 移动门户），返回 {ok:true}；
// - capture()：打开学校容器 → SchoolReadController 状态机 → 返回 {rows,totalWeeks,semesterId,?studentProfile}；
// - leaveRecordSync()：LeaveRecordsService 直连 URLSession 取假条记录，返回 {ok,fetchedAt,records}
//   或 {ok:false,code}（不抛错，见 LeaveRecordsService 注释）；
// - cancelRead()：中止进行中的读取（失败文案「已取消读取，保留原课表」）；
// - reset()：注销时关闭容器并清空请假会话参数。
//
// 已知差异（写进 ios/docs/P2-SCHOOL-READ.md）：
// - 进度文案不转发给 web（Android 用 window.onNativeProgress 显示「正在检查学校会话…」等），
//   iOS 只把进度写到学校容器顶栏的 note 上；
// - 不读 StateStore 里缓存的 studentProfile，每次读取都重新解析年级页；
// - 读取失败的 HTTP 状态码/SSL 错误没有 Android 的 onReceivedHttpError 分支（iOS WKWebView
//   不提供同等回调），统一按导航失败或脚本内 error 文案处理。
//
// 本机 Windows 无 Xcode/swiftc，未编译验证；真机验证项见 ios/docs/P2-SCHOOL-READ.md。
/// 学校能力的大门：网页只能通过这里请求打开学校页面、读取课表或同步假条。
/// 它不直接碰网页内容，只把任务交给后面的浏览器容器和读取状态机。
public final class SchoolProvider: SchoolProviding, SchoolReadProgressReporting {

    // P1 的教务桩文案。P2 起不再返回它，保留常量是为了让静态门禁能断言它已从实现路径消失。
    // P1 的占位文案；P2 起真实实现不再返回它，只留作静态门禁的检查标记。
    public static let readUnavailableMessage = "iOS 端教务读取将在下一阶段提供"

    /// 读取阶段进度回调（S 档 onNativeProgress）：BridgeDispatcher 在 capture 前挂上、结束后摘掉。
    /// 直接转给 SchoolReadController，保证容器顶栏与网页显示同一句阶段文案。
    public var onReadProgress: ((String) -> Void)? {
        get { return controller.onProgress }
        set { controller.onProgress = newValue }
    }

    /// 从请假服务页回到网页主界面（S 档 onLeaveServiceReturn）；由 App 装配处接到 WebHost。
    public var onLeaveServiceReturn: (() -> Void)?
    /// 注销/清理时不发 onLeaveServiceReturn（对齐 Android logout 走 destroyWebApp，不发该回调）。
    private var suppressLeaveServiceReturn = false

    // 当前使用的学校浏览器；同一时间最多一个，避免两个页面抢同一份登录 Cookie。
    private var host: SchoolWebViewHost?
    // capture 从校验到 controller.start 之间可能有一次 0.4s 的重试等待，
    // 用这个标志挡住这期间的第二次 capture（此时 controller.isRunning 还是 false）。
    // 防止 0.4 秒重试等待期间用户又点一次同步，造成两个读取同时启动。
    private var capturePending = false
    // 自动读课表的状态机：恢复登录 → 进门户 → 读年级 → 读课表。
    private let controller = SchoolReadController()
    // 请假记录同步器：直接请求学校接口，不经过 WebView。
    private let leaveRecords = LeaveRecordsService()
    // 请假 WebView 的跳转状态机（对应 MainActivity.java:336-404）。
    // 请假页的导航状态机：负责从 SSO 预热页跳到具体的请假/销假/续假表单。
    private let leaveController = SchoolLeaveSessionController()

    /// 创建空壳；真正的浏览器和状态机在第一次使用时才创建，省内存。
    public init() {}

    // MARK: - SchoolProviding

    /// 打开学校门户：mobile 为 true 用手机版，false 用电脑版。
    /// 返回 {ok:true} 只表示已经发出打开请求，不代表登录或读取成功。
    public func openSchool(mobile: Bool) throws -> JSONObject {
        let target = mobile ? SchoolURLPolicy.schoolMobileURL : SchoolURLPolicy.schoolPortalURL
        try performOnMain {
            // 对应 Android openSchool 里的 hideWebApp()：切回学校页前先结束请假状态机，
            // 否则它的 30s 慢加载计时和重定向标志会在学校页上继续生效。
            // Android hideWebApp() 会顺带发 onLeaveServiceReturn（MainActivity.java:363），这里同语义。
            self.notifyLeaveServiceReturnIfVisible()
            self.leaveController.close()
            guard let presenter = SchoolWebViewHost.topPresenter() else {
                throw BridgeFailure.message("学校页面暂时无法打开，请稍后重试")
            }
            let sessionHost = self.ensureHost()
            sessionHost.show(from: presenter, mode: .school, urlString: target)
        }
        return ["ok": true]
    }

    /// 打开请假服务页：先检查目标地址和登录预热地址是否在学校白名单里。
    /// 校验不通过会抛「不允许的请假地址 / 不允许的登录地址」，不会打开任何网页。
    public func openWebApp(url: String, warmupUrl: String?) throws -> JSONObject {
        // 校验顺序与文案对齐 MainActivity.java:396-403。
        if SchoolURLPolicy.allowedOpenUrl(url) == false {
            throw BridgeFailure.message("不允许的请假地址")
        }
        if SchoolURLPolicy.allowedWarmupUrl(warmupUrl) == false {
            throw BridgeFailure.message("不允许的登录地址")
        }
        try performOnMain {
            if self.controller.isRunning {
                throw BridgeFailure.message("正在读取课表，请稍后再打开请假服务")
            }
            guard let presenter = SchoolWebViewHost.topPresenter() else {
                throw BridgeFailure.message("学校页面暂时无法打开，请稍后重试")
            }
            let sessionHost = self.ensureHost()
            // 先挂容器（空 URL 不触发加载），再由请假状态机决定 warmup / 目标深链；
            // 旧实现只 load warmup，登录完成会停在请假主界面，点不进具体表单。
            sessionHost.show(from: presenter, mode: .leaveApp, urlString: "")
            self.leaveController.open(url: url, warmupUrl: warmupUrl, host: sessionHost)
        }
        return ["ok": true]
    }

    // 对应 MainActivity.java:130-133（case "leaveRecordSync" → beginLeaveRecordSync）。
    // 不走 WebView：直接 URLSession 请求假条列表（Android 同样不经 WebView）。
    /// 同步请假记录：直接向学校请假接口发请求，不经过内置浏览器。
    /// 返回 {ok, fetchedAt, records} 或 {ok:false, code}；网络错误也写进结果的 code，不向外抛。
    public func leaveRecordSync() async throws -> JSONObject {
        return await leaveRecords.fetch()
    }

    // 对应 MainActivity.cancelRead（:223）/ SchoolClient.cancel：进行中才有效，否则静默。
    /// 取消正在进行的课表读取；没有读取在跑时也返回 {ok:true}，方便网页重复点击。
    public func cancelRead() throws -> JSONObject {
        try performOnMain {
            _ = self.controller.cancel()
        }
        return ["ok": true]
    }

    // 对应 MainActivity.beginSchoolRead / SchoolClient.start（:222 / :22-27）。
    // 返回形状必须满足 web/app.mjs:505-521 的 normalizeSchool 分支。
    /// 自动读取课表的总入口：先挂好隐藏浏览器，再交给 SchoolReadController 跑完整流程。
    /// 成功返回 {rows,totalWeeks,semesterId,studentProfile?}；失败抛 BridgeFailure 中文文案。
    /// 同一时间只允许一个读取；第二次点击会直接得到「正在读取课表，请稍候」。
    public func capture() async throws -> JSONObject {
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<JSONObject, Error>) in
            // controller.start 必须留在 capture 函数体内：静态门禁按 capture 函数体检查
            // 「capture 把 host 交给 SchoolReadController.start」。重试路径通过 startRead
            // 回调启动，避免状态机入口被藏进 helper 后门禁看不到。
            let startRead: (SchoolWebViewHost) -> Void = { sessionHost in
                self.controller.start(host: sessionHost) { result in
                    // 与 Android listener.success / failure 一致：两种情况都收起学校页面。
                    self.closeHostAfterRead()
                    switch result {
                    case .success(let payload):
                        continuation.resume(returning: payload)
                    case .failure(let failure):
                        continuation.resume(throwing: failure)
                    }
                }
            }
            let start = {
                // 对应 Android beginSchoolRead 的 activeReadId 检查：已有读取在跑时不要
                // 再创建/移动学校容器，否则会把正在等登录的页面关掉。
                if self.controller.isRunning {
                    continuation.resume(throwing: BridgeFailure.message("正在读取课表，请稍候"))
                    return
                }
                if self.capturePending {
                    continuation.resume(throwing: BridgeFailure.message("正在读取课表，请稍候"))
                    return
                }
                self.capturePending = true
                self.startCapture(continuation, startRead: startRead, allowRetry: true)
            }
            if Thread.isMainThread {
                start()
            } else {
                DispatchQueue.main.async(execute: start)
            }
        }
    }

    // 把「挂容器 → controller.start」拆出来，给 dismiss 动画窗口留一次 0.4s 重试：
    // hide(animated:true) 结束后有约 0.35s 的 dismiss 动画，此期间 attachHeadless 返回 false；
    // 如果直接 start，WKWebView 会停在未挂载状态，WebKit 挂起 JS，直到 90s 总超时。
    /// 真正开始读取前的准备：挂载隐藏浏览器，失败时在关闭动画结束后重试一次。
    /// allowRetry 为 true 表示还允许 0.4 秒后重试；重试仍失败就明确报「学校页面正在关闭」。
    private func startCapture(_ continuation: CheckedContinuation<JSONObject, Error>, startRead: @escaping (SchoolWebViewHost) -> Void, allowRetry: Bool) {
        if controller.isRunning {
            capturePending = false
            continuation.resume(throwing: BridgeFailure.message("正在读取课表，请稍候"))
            return
        }
        do {
            guard let sessionHost = try prepareHostForRead() else {
                if allowRetry {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                        guard let self = self else {
                            continuation.resume(throwing: BridgeFailure.message("学校页面正在关闭，请稍后再试"))
                            return
                        }
                        self.startCapture(continuation, startRead: startRead, allowRetry: false)
                    }
                } else {
                    capturePending = false
                    continuation.resume(throwing: BridgeFailure.message("学校页面正在关闭，请稍后再试"))
                }
                return
            }
            capturePending = false
            startRead(sessionHost)
        } catch {
            capturePending = false
            continuation.resume(throwing: error)
        }
    }

    // MARK: - 生命周期

    // 注销时清空请假页会话参数（uid / pageEnc 属于登录态，必须随注销一起清掉）。
    /// 注销时清掉请假页临时记下的 uid/pageEnc，防止下一个人复用上一个人的登录痕迹。
    public func clearLeaveSession() {
        leaveRecords.clearSession()
    }

    // 登录注销（action 35 logout）时调用，关闭学校容器并清空请假会话参数。
    /// 注销时的总清理：停掉读取、关掉学校浏览器、清空请假会话参数。
    /// 界面操作会切到主线程；这个函数不等待关闭动画完成。
    public func reset() {
        // 显式标注 () -> Void：闭包里若以可选链调用结尾，Swift 会推断成 () -> ()?，
        // 传给 DispatchQueue.main.async(execute:) 会报 cannot convert '() -> ()?'。
        let work: () -> Void = {
            self.controller.cancel()
            self.leaveController.close()
            self.leaveRecords.clearSession()
            if let existing = self.host {
                // 注销清理不触发 onLeaveServiceReturn：Android logout 走 destroyWebApp，不发该回调。
                // 只有请假页真的挂在屏幕上时 hide 才会回调 onDismissed，才需要这个 suppress 标记。
                let attached = existing.presentingViewController != nil || existing.parent != nil
                self.suppressLeaveServiceReturn = attached && existing.mode == .leaveApp && existing.isUserVisible
                _ = existing.hide(animated: false)
            } else {
                self.suppressLeaveServiceReturn = false
            }
            self.host = nil
        }
        if Thread.isMainThread {
            work()
            return
        }
        DispatchQueue.main.async(execute: work)
    }

    // MARK: - 内部

    // 读取必须有可运行 JS 的学校容器（对应 Android beginSchoolRead 里的 ensureSchool + showSchool）。
    // 返回 nil 表示容器正处于 dismiss 动画窗口，attachHeadless 拒绝了本次挂载；
    // capture 会等 0.4s 再试一次，仍失败则明确报错（不能静默空转到 90s 超时）。
    /// 准备一个能执行 JS 的隐藏浏览器；返回 nil 表示它正处在关闭动画中，暂时挂不上。
    /// 自动核对不会复用用户正看着的页面，避免把用户的操作打断。
    private func prepareHostForRead() throws -> SchoolWebViewHost? {
        guard let topPresenter = SchoolWebViewHost.topPresenter() else {
            throw BridgeFailure.message("学校页面暂时无法打开，请稍后重试")
        }
        var presenter = topPresenter
        // 对应 Android beginSchoolRead 开头的 hideWebApp()：自动核对不能复用用户正看着的
        // 学校/请假容器，否则界面会留在屏幕上，而且 pageFinished 会按旧的 mode 分流到请假状态机。
        if let existing = host, existing.isUserVisible || existing.mode == .leaveApp {
            // 学校容器自己 present 时 topPresenter() 会返回它；新容器必须挂到它的
            // presentingViewController / parent 上，不能挂到正在关闭的旧容器上。
            presenter = existing.presentingViewController ?? existing.parent ?? topPresenter
            leaveController.close()
            existing.detachCallbacks()
            _ = existing.hide(animated: false)
            host = nil
        }
        let sessionHost = ensureHost()
        if sessionHost.isHeadless == false && sessionHost.isUserVisible == false {
            // 自动核对默认无头：挂在当前页面最底层，WebKit 仍会执行 JS，但用户看不见。
            // 先落在教务根路径，具体目标页由 SchoolReadController 按 cookie 状态决定。
            let attached = sessionHost.attachHeadless(to: presenter, mode: .school, urlString: SchoolURLPolicy.schoolAcademicRootURL)
            if attached == false { return nil }
        }
        return sessionHost
    }

    /// 读取成功或失败后收起学校浏览器；成功时带动画，失败也要保证界面回到课表。
    private func closeHostAfterRead() {
        // 同上：必须显式标注 () -> Void，并丢弃 optional-chaining 的返回值。
        let work: () -> Void = {
            _ = self.host?.hide(animated: true)
        }
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.async(execute: work)
        }
    }

    /// 懒创建学校浏览器，并把页面加载完成、跳转、失败等回调接到正确的状态机。
    /// 学校页交给 SchoolReadController，请假页交给 SchoolLeaveSessionController。
    private func ensureHost() -> SchoolWebViewHost {
        if let existing = host { return existing }
        let created = SchoolWebViewHost()
        // 自动核对默认无头；只有状态机发现需要登录表单时才把容器转成可见，自动 SSO 恢复不打扰用户。
        self.controller.onNeedsVisiblePresentation = { [weak self] in
            guard let self = self, let sessionHost = self.host else { return }
            // 优先用无头容器自己的 parent（就是它的挂载页），避免旧容器还在 dismiss 时
            // topPresenter() 返回旧容器，导致 present(from:) 打到一个正在关闭的控制器上。
            guard let presenter = sessionHost.parent ?? SchoolWebViewHost.topPresenter() else { return }
            sessionHost.presentForUser(from: presenter)
        }
        // 页面回调按容器用途分流：学校页交给 SchoolReadController，请假页交给 SchoolLeaveSessionController。
        let pageFinished: (String) -> Void = { [weak self, weak created] url in
            guard let self = self else { return }
            // 请假页 URL 里带 uid / pageEnc；先记住，leaveRecordSync 才能直接请求列表。
            self.leaveRecords.rememberSession(url: url)
            if created?.mode == .leaveApp {
                self.leaveController.pageFinished(url)
            } else {
                self.controller.page(url)
            }
        }
        created.onPageFinished = pageFinished
        created.onNavigate = { [weak self] url in
            // 请假页 URL 里带 uid / pageEnc，记住后 leaveRecordSync 才能直接请求列表。
            self?.leaveRecords.rememberSession(url: url)
        }
        created.onNavigationFailure = { [weak self, weak created] error in
            guard let self = self else { return }
            if created?.mode == .leaveApp {
                self.leaveController.navigationFailed()
            } else {
                self.controller.navigationFailed(error: error)
            }
        }
        created.onProcessTerminated = { [weak self, weak created] in
            guard let self = self else { return }
            if created?.mode == .leaveApp {
                self.leaveController.processTerminated()
            } else {
                self.controller.processTerminated()
            }
        }
        // 对齐 Android cancelRead（MainActivity.java:223）：用户点「返回课表」关闭学校页时立即结束读取，
        // 否则要空等到 90 秒总超时才收尾。显式标注 () -> Void，避免可选链返回值被推断成 ()?。
        let dismissed: () -> Void = { [weak self, weak created] in
            guard let self = self else { return }
            if created?.mode == .leaveApp {
                self.leaveController.close()
                // S 档 onLeaveServiceReturn：请假页真的被用户关掉时，让 web 立刻刷新假条状态。
                // 注销清理走 reset() 的 suppress 标记，与 Android（logout 不经过 hideWebApp）一致。
                if self.suppressLeaveServiceReturn == false {
                    self.onLeaveServiceReturn?()
                }
                self.suppressLeaveServiceReturn = false
            } else {
                _ = self.controller.cancel()
            }
        }
        created.onDismissed = dismissed
        host = created
        return created
    }

    // MARK: - 回调与线程

    /// 用户离开请假页回到网页主界面时通知 web（对应 Android hideWebApp 的 onLeaveServiceReturn）。
    /// 只在请假容器确实被用户看着时发；注销清理由 suppressLeaveServiceReturn 拦住。
    private func notifyLeaveServiceReturnIfVisible() {
        guard suppressLeaveServiceReturn == false else { return }
        guard let host = host, host.mode == .leaveApp, host.isUserVisible else { return }
        onLeaveServiceReturn?()
    }

    /// UIKit/WebKit 必须在主线程操作；调用方已在主线程就直接执行，否则同步切过去。
    private func performOnMain(_ work: () throws -> Void) throws {
        if Thread.isMainThread {
            try work()
            return
        }
        try DispatchQueue.main.sync(execute: work)
    }
}
