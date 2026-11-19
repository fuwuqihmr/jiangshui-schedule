// 【这个文件干什么】它是自动读课表的「接力赛」总指挥：恢复登录 → 补登录 → 找到教务 → 抄下课表。
// 【什么时候会用到它】用户点「同步课表」或 App 自动核对时，SchoolProvider 会启动它。
// 【它和谁配合】借用 SchoolWebViewHost 这台内置浏览器，按页面变化一步步推进；结果交回 SchoolProvider。
// 它不会猜课表内容：解析课表的脚本来自 web/school-reader.js，本文件只负责在正确时机注入。
// 每一步都要等网页真正加载完成，不能抢跑；总共最多 90 秒，登录后进入教务最多再等 60 秒。
// 超时或失败都保留旧课表，只把一句中文原因交给界面；成功结果只会回调一次。
// 本机 Windows 没有 Xcode，无法编译；真实登录链必须用测试账号在真机验证。
import Foundation
import WebKit

// 教务课表读取状态机（P2）。
//
// 对照 android/app/src/main/java/cn/local/tomorrow/SchoolClient.java 的整条链路：
//   restoreCookies → continueStart → (portal / readProfile) → read → success / failure。
// 读取脚本 web/school-reader.js（课表）与 web/profile-reader.js（年级）属于共享层，iOS 侧只负责
// 从 bundle 读出并注入，脚本内容一行不改。
//
// 线程模型：本类所有方法都必须在主线程调用（WKWebView API 与计时器同线程）。
// 回包保证只触发一次：任何路径最终都走 finish()。
// 本机 Windows 无 Xcode/swiftc，未编译验证；真机验证项见 ios/docs/P2-SCHOOL-READ.md。
/// 自动读课表的流程指挥；一个实例同一时间只跑一次，结束或取消后才能再启动。
/// 所有方法都要求在主线程调用，因为它直接操作 WKWebView 和计时器。
final class SchoolReadController {

    /// 读取结束时的回包格式：成功带课表 JSON，失败带一句中文原因。
    // 用 Result 表示「要么成功、要么失败」，调用方必须显式处理失败，不能假装没看见。
    typealias Completion = (Result<JSONObject, BridgeFailure>) -> Void

    // Android SchoolClient.java:5 的三个地址（常量集中在 SchoolURLPolicy）。
    /// 教务系统首页；没有年级信息时先打开这里，再去找课表入口。
    private static let frameURL = SchoolURLPolicy.schoolAcademicRootURL + "/jsxsd/framework/xsMainV.htmlx"
    /// 课表页面；已经知道年级后直接打开这里，少走一步。
    private static let tableURL = SchoolURLPolicy.schoolAcademicRootURL + "/jsxsd/xskb/xskb_list.do?viweType=1"

    // 整场读取最多 90 秒；时间一到就放弃并保留旧课表，避免用户无限等待。
    private static let totalDeadline: TimeInterval = 90        // SchoolClient.java 的 timeout(90000)
    // 用户登录完成后，进入教务最多再等 60 秒；和上面的总时限分开，不要混用。
    private static let leaveLoginDeadline: TimeInterval = 60   // SchoolClient.java:49 的 timeout(60000)
    // 每 200 毫秒看一次结果；间隔太短会卡界面，太长会显得慢。
    private static let pollInterval: TimeInterval = 0.2        // pollRead / pollProfile 的 200ms
    // 最多看 450 次，200ms × 450 正好约 90 秒，和总时限对齐。
    private static let pollLimit = 450                         // 200ms × 450 ≈ 90s
    // 门户页里找教务入口最多试 20 次，避免页面一直不出现时永久等待。
    private static let portalRetryLimit = 20                    // inspectPortal 的 20 次
    // 每次找入口间隔 400 毫秒；20 次大约 8 秒。
    private static let portalRetryInterval: TimeInterval = 0.4  // 400ms
    // 考试段失败类别白名单：与 Android SchoolClient.java:79 的 5 类逐一相同，未知类别归 other。
    private static let examErrorKinds: Set<String> = ["http", "session", "timeout", "format", "other"]

    // 借来干活的浏览器；用弱引用，避免两者互相抓住不放导致内存泄漏。
    private weak var host: SchoolWebViewHost?
    // 保存学校登录票据的保险箱；退出登录时会清空。
    private let vault: SchoolSession

    // 读完后要通知的回调；只保存一份，结束时清空，保证只通知一次。
    private var completion: Completion?
    // 是否已经结束；true 表示当前没有读取在跑。
    private var finished = true
    // 每次读取的编号；旧页面带着旧编号回来时可以识别并忽略。
    private var generation = 0
    // 自动续期是否已经试过；只允许一次，防止学校页面把流程带进死循环。
    private var ssoUsed = false
    // 是否正在等用户手动输入账号密码。
    private var awaitingLogin = false
    // 年级/学生信息；拿到后会和课表一起回传，没有就是 nil。
    private var profile: JSONObject?
    // 总倒计时闹钟；每次重新挂时限前先按掉旧的。
    private var deadlineTimer: DispatchWorkItem?
    // restoreCookies 完成前，show() 的初始页面可能先 didFinish；此时不参与状态机，避免和恢复流程抢跑。
    // 登录票据是否准备好；没好之前，页面加载完成也不参与流程。
    private var sessionReady = false
    // 正在载入 SSO 入口 / CAS 登录页；用于把「统一身份认证入口不可达」和普通学校页面失败区分开。
    // 是否正在打开统一身份认证入口；用来区分「入口打不开」和普通页面失败。
    private var ssoEntryLoading = false

    /// 创建流程指挥；vault 是保存登录票据的保险箱，默认用真实 Keychain。
    init(vault: SchoolSession = SchoolSession()) {
        self.vault = vault
    }

    /// 是否还有读取在跑；true 时不能再次 start。
    var isRunning: Bool { return finished == false }

    // 供 SchoolProvider 判断失败后是否保持学校页面打开（登录中要保持，其它失败关闭）。
    /// 是否正在等用户登录；provider 用它决定失败后要不要保留学校页面。
    var isAwaitingLogin: Bool { return awaitingLogin }

    // 自动核对默认无头；只有真的需要用户登录（CAS/门户登录表单出现）才请求 provider 把
    // 容器转成可见。SSO 自动恢复成功时不触发，避免“全自动也弹一下浏览器”。
    /// 需要用户登录时拨打这个电话，让 provider 把隐形页面变成可见页面。
    var onNeedsVisiblePresentation: (() -> Void)?

    /// 读取阶段文案回调（S 档 window.onNativeProgress）。
    /// 与容器顶栏的 note 同时更新：网页看到的文案与学校页顶栏完全一致，不另造文案。
    /// 由 SchoolProvider 接给桥接层；读取结束（成功/失败/取消）后桥接层会摘掉。
    var onProgress: ((String) -> Void)?

    // MARK: - 入口（对应 SchoolClient.start）

    /// 开始一次读取；host 是浏览器，completion 是读完后回电。
    /// 已经在读时立即失败「正在读取课表，请稍候」，不会启动第二个流程。
    func start(host: SchoolWebViewHost, completion: @escaping Completion) {
        assertMainThread()
        guard finished else {
            completion(.failure(.message("正在读取课表，请稍候")))
            return
        }
        self.host = host
        self.completion = completion
        finished = false
        generation += 1
        ssoUsed = false
        awaitingLogin = false
        profile = nil
        sessionReady = false
        ssoEntryLoading = false
        scheduleDeadline(Self.totalDeadline)
        note("正在检查学校会话…")
        restoreCookies()
    }

    // 对应 SchoolClient.cancel：fail("已取消读取，保留原课表")。
    /// 取消读取；返回 true 表示确实取消了一个正在跑的流程，false 表示本来就没在跑。
    @discardableResult
    func cancel() -> Bool {
        assertMainThread()
        guard finished == false else { return false }
        fail("已取消读取，保留原课表")
        return true
    }

    // MARK: - 页面回调（对应 SchoolClient.page）

    // 由 SchoolProvider 在 SchoolWebViewHost.onPageFinished 里转交（主线程）。
    /// 网页每次加载完成都会把地址送进来；这里像交通指挥，根据地址决定下一步。
    /// 如果登录票据还没准备好，就先不处理，避免恢复流程和页面回调抢跑。
    func page(_ rawURL: String) {
        assertMainThread()
        guard finished == false else { return }
        guard sessionReady else { return }
        if SchoolURLPolicy.isSSOEntryURL(rawURL) {
            ssoEntryLoading = true
            return
        }
        // 只有真正到达 CAS 或教务页，才代表 SSO 入口已经跳转成功；初始根页面的迟到回调不能清掉标记。
        if SchoolURLPolicy.isCasUrl(rawURL) || SchoolURLPolicy.isAcademicURL(rawURL) {
            ssoEntryLoading = false
        }
        if SchoolURLPolicy.isAcademicURL(rawURL) {
            academicPage(rawURL)
            return
        }
        if isPortalURL(rawURL) {
            inspectPortal(attempt: 1)
            return
        }
        if SchoolURLPolicy.isCasUrl(rawURL) {
            inspectLoginForm()
        }
    }

    /// 网页加载失败时调用；用户自己取消不算失败，登录等待期间也先不打断。
    func navigationFailed(error: Error) {
        assertMainThread()
        guard finished == false else { return }
        guard sessionReady else { return }
        // 对齐 SchoolClient.java:47-48：登录等待期间由登录表单自己处理错误（Android 不响应
        // onReceivedError）。一次导航失败（例如用户取消输入）不应收走学校页，可继续登录或手动返回。
        if awaitingLogin { return }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        if ssoEntryLoading {
            ssoEntryLoading = false
            SchoolDiagnosticLog.navigationFailed(phase: "sso-entry", error: nsError, url: host?.currentURLString)
            fail("统一身份认证入口暂时无法打开，请检查网络后重试（原课表已保留）")
            return
        }
        SchoolDiagnosticLog.navigationFailed(phase: "school", error: nsError, url: host?.currentURLString)
        fail("学校页面暂时无法连接（错误码 " + String(nsError.code) + "），原课表已保留。可在设置页导出排查日志")
    }

    /// 网页进程被系统回收时调用；读取直接失败并保留旧课表。
    func processTerminated() {
        assertMainThread()
        guard finished == false else { return }
        fail("学校页面进程已回收，保留上次课表")
    }

    // MARK: - Cookie（对应 restoreCookies / persistSessionCookies / clearExpiredTgc）

    /// 第一步：先看浏览器里有没有登录票据，没有再打开保险箱读保存的票据。
    /// 找到教务票据就直接进教务；没有就先走统一身份认证续期。
    private func restoreCookies() {
        let store = WKWebsiteDataStore.default().httpCookieStore
        store.getAllCookies { [weak self] cookies in
            guard let self = self, self.isRunning else { return }
            let hasTGC = cookies.contains { cookie in
                cookie.name == "TGC" && cookie.domain.lowercased().hasSuffix("juwp.edu.cn") && cookie.value.isEmpty == false
            }
            let currentAcademic = self.academicCookie(in: cookies)
            SchoolDiagnosticLog.cookieState(tgc: hasTGC, academic: currentAcademic != nil)
            if currentAcademic != nil {
                self.sessionReady = true
                self.beginPageLoad()
                return
            }
            let envelope: JSONObject?
            do {
                envelope = try self.vault.loadSession()
            } catch {
                SchoolDiagnosticLog.sessionStoreReadFailed(error)
                envelope = nil
            }
            let tgc = envelope?.optString("tgc") ?? ""
            let academic = envelope?.optString("academic") ?? ""
            let safeTGC = SchoolSession.isSafeCookieValue(tgc)
            let safeAcademic = SchoolSession.isSafeCookieValue(academic)
            SchoolDiagnosticLog.cookieRestore(tgc: safeTGC, academic: safeAcademic)
            guard safeTGC || safeAcademic else {
                self.sessionReady = true
                self.sso(reason: "missing-academic-cookie")
                return
            }
            self.writeCookies(tgc: tgc, academic: academic) {
                guard self.isRunning else { return }
                self.sessionReady = true
                self.beginPageLoad()
            }
        }
    }

    /// 第二步：确认教务票据可用后，决定先打开「首页」还是直接打开「课表页」。
    /// 有年级信息时直接读课表；没有时先读年级，成功后再读课表。
    private func beginPageLoad() {
        let store = WKWebsiteDataStore.default().httpCookieStore
        store.getAllCookies { [weak self] cookies in
            guard let self = self, self.isRunning else { return }
            if self.academicCookie(in: cookies) == nil {
                self.sso(reason: "missing-academic-cookie")
                return
            }
            let target = self.profile == nil ? Self.frameURL : Self.tableURL
            self.host?.load(urlString: target)
        }
    }

    /// 把保险箱里的票据写回浏览器，像把钥匙插回锁里；写完再继续流程。
    private func writeCookies(tgc: String, academic: String, completion: @escaping () -> Void) {
        let store = WKWebsiteDataStore.default().httpCookieStore
        let tgcCookie = makeCookie(name: "TGC", value: tgc, domain: "eapp2.juwp.edu.cn", path: "/cas/", secure: true)
        let academicCookie = makeCookie(name: "bzb_jsxsd", value: academic,
                                        domain: "jiaowu.juwp.edu.cn", path: "/jsxsd", secure: false)
        setCookie(tgcCookie, on: store) {
            // 逃逸闭包内调用本类方法必须写 self.（CI 首轮编译踩过同类错误）。
            self.setCookie(academicCookie, on: store) {
                completion()
            }
        }
    }

    /// 写入一张 Cookie；cookie 为空时直接继续，不报错。
    private func setCookie(_ cookie: HTTPCookie?, on store: WKHTTPCookieStore, then: @escaping () -> Void) {
        guard let cookie = cookie else { then(); return }
        store.setCookie(cookie, completionHandler: { then() })
    }

    // HTTPCookie 没有公开的 HttpOnly 属性键：写回时只能保留 domain/path/secure/expires，
    // 服务端只关心 cookie 是否随请求发送，HttpOnly 是浏览器侧的脚本保护标记，不影响读取。
    /// 手工制作一张 Cookie；值不安全（含控制字符等）时返回 nil，宁可少写也不冒险。
    private func makeCookie(name: String, value: String, domain: String, path: String, secure: Bool) -> HTTPCookie? {
        guard SchoolSession.isSafeCookieValue(value) else { return nil }
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: name,
            .value: value,
            .domain: domain,
            .path: path,
            .expires: Date().addingTimeInterval(60 * 60 * 24 * 7),
        ]
        if secure { properties[.secure] = "TRUE" }
        return HTTPCookie(properties: properties)
    }

    /// 从浏览器的一堆 Cookie 里挑出可用的教务票据；已经过期的跳过。
    private func academicCookie(in cookies: [HTTPCookie]) -> HTTPCookie? {
        for cookie in cookies where cookie.name == "bzb_jsxsd" {
            // 本地 makeCookie 写的是 7 天过期；若不做这个判断，服务端会话已死时仍会跳过 SSO。
            if let expires = cookie.expiresDate, expires.timeIntervalSinceNow <= 0 { continue }
            if cookie.domain.lowercased().hasSuffix("jiaowu.juwp.edu.cn") && cookie.value.isEmpty == false {
                return cookie
            }
        }
        return nil
    }

    // 对应 SchoolClient.persistSessionCookies：读取成功后把 TGC 与教务 cookie 存进 Keychain。
    /// 读取成功后把最新票据存进保险箱；写失败只记日志，不影响本次课表结果。
    private func persistSessionCookies() {
        let store = WKWebsiteDataStore.default().httpCookieStore
        store.getAllCookies { [weak self] cookies in
            guard let self = self else { return }
            var tgc = ""
            var academic = ""
            for cookie in cookies {
                let domain = cookie.domain.lowercased()
                if cookie.name == "TGC" && domain.hasSuffix("juwp.edu.cn") && cookie.value.isEmpty == false {
                    tgc = cookie.value
                }
                if cookie.name == "bzb_jsxsd" && domain.hasSuffix("jiaowu.juwp.edu.cn") && cookie.value.isEmpty == false {
                    academic = cookie.value
                }
            }
            guard SchoolSession.isSafeCookieValue(tgc) || SchoolSession.isSafeCookieValue(academic) else { return }
            do {
                try self.vault.saveSession(tgc: tgc, academic: academic)
                if SchoolSession.isSafeCookieValue(tgc) { SchoolDiagnosticLog.cookieRestored(name: "tgc") }
                if SchoolSession.isSafeCookieValue(academic) { SchoolDiagnosticLog.cookieRestored(name: "academic") }
            } catch {
                SchoolDiagnosticLog.sessionStoreWriteFailed(error)
            }
        }
    }

    // 对应 SchoolClient.clearExpiredTgc：CAS 登录页出现时把过期 TGC 清掉，避免反复失败。
    /// 把过期的统一身份认证票据清掉；像扔掉一张作废的门票，避免反复被拒。
    private func clearExpiredTGC() {
        let store = WKWebsiteDataStore.default().httpCookieStore
        if let expired = HTTPCookie(properties: [
            .name: "TGC",
            .value: "",
            .domain: "eapp2.juwp.edu.cn",
            .path: "/cas/",
            .expires: Date().addingTimeInterval(-60),
        ]) {
            store.setCookie(expired, completionHandler: nil)
        }
        try? vault.clearTGC()
        SchoolDiagnosticLog.tgcExpired()
    }

    // MARK: - 页面分支（对应 SchoolClient.page 的 jsxsd 分支）

    /// 教务页面到达后的分拣中心：首页、课表页、登录页各有不同的下一步。
    private func academicPage(_ rawURL: String) {
        let path = URL(string: rawURL)?.path ?? ""
        if path.hasPrefix("/jsxsd/framework/") {
            leaveLogin()
            let proceed: () -> Void = { [weak self] in
                guard let self = self, self.isRunning else { return }
                // 只有确认不是登录页后才持久化，避免把服务端下发的失效 cookie 写回 Keychain。
                self.persistSessionCookies()
                if self.profile == nil {
                    self.readProfile()
                } else {
                    self.host?.load(urlString: Self.tableURL)
                }
            }
            inspectAcademicLogin(proceed)
            return
        }
        if path.hasPrefix("/jsxsd/xskb/") {
            // 用户正在学校页面手动登录时，登录表单拥有导航权，不在登录页上强行注入读取。
            if awaitingLogin { return }
            leaveLogin()
            inspectAcademicLogin { [weak self] in self?.read() }
            return
        }
        if path.contains("/jsxsd/xk/LoginToXk") {
            // Android 这里直接 return，命中登录页时既不 sso 也不 needLogin；登录等待中仍交给表单。
            if awaitingLogin { return }
            if ssoUsed {
                fail("学校读取失败，请重新确认登录")
            } else {
                sso(reason: "expired-school-cookie")
            }
            return
        }
        if path.lowercased().contains("login") {
            if awaitingLogin { return }
            if ssoUsed {
                fail("学校读取失败，请重新确认登录")
            } else {
                sso(reason: "login-page")
            }
        }
    }

    // 对应 SchoolClient.readProfile：先取年级信息，取不到也继续读课表。
    /// 先读年级信息（可选）；脚本缺失或失败时跳过，直接去读课表，不耽误主任务。
    private func readProfile() {
        guard let source = SchoolReadScripts.profileReader() else {
            host?.load(urlString: Self.tableURL)
            return
        }
        note("正在读取学校年级信息…")
        // 追加 ;0;：profile-reader.js 是 async IIFE，最后表达式的 Promise 不能作为 evaluateJavaScript 的返回值。
        host?.evaluate(script: source + "\n;0;") { [weak self] _, error in
            guard let self = self, self.isRunning else { return }
            if let error = error {
                SchoolDiagnosticLog.readerInjectionFailed(stage: "profile", attempt: 1, error: error as NSError)
                self.host?.load(urlString: Self.tableURL)
                return
            }
            self.pollProfile(remaining: 90)
        }
    }

    /// 每隔 200 毫秒问一次网页「年级信息好了吗」；最多问 90 次，约 18 秒。
    private func pollProfile(remaining: Int) {
        guard isRunning else { return }
        guard remaining > 0 else {
            host?.load(urlString: Self.tableURL)
            return
        }
        let script = "(function(){try{var p=window.__jiangshuiProfile;return JSON.stringify(p||null)}catch(e){return null}})()"
        host?.evaluate(script: script) { [weak self] value, _ in
            guard let self = self, self.isRunning else { return }
            if let result = self.jsonObject(from: value), result.optBool("done", false) {
                self.profile = result.optObject("profile")
                self.host?.load(urlString: Self.tableURL)
                return
            }
            self.after(Self.pollInterval) { [weak self] in self?.pollProfile(remaining: remaining - 1) }
        }
    }

    // MARK: - 读取（对应 SchoolClient.read + pollRead）

    /// 开始读课表；内部真正干活的是 read(attempt:)。
    private func read() {
        read(attempt: 1)
    }

    /// 注入课表读取脚本；失败最多重试一次，仍失败再走「结果可能已经写入」的兜底检查。
    private func read(attempt: Int) {
        guard let source = SchoolReadScripts.timetableReader() else {
            fail("课表读取脚本缺失，请重新安装应用后再试")
            return
        }
        guard let host = host else {
            fail("学校页面已关闭，请重新打开")
            return
        }
        note("正在读取学校课表…")
        let requestId = "read-" + String(generation) + "-" + String(Int(Date().timeIntervalSince1970 * 1000))
        let prefix = "window.__tomorrowRequestId=" + jsLiteral(requestId) + ";\n"
        // 追加 ;0;：school-reader.js 是 async IIFE，返回的 Promise 会让 evaluateJavaScript 的
        // completion 收到 WKErrorDomain unsupported type，而 JS 本身其实已经执行。
        host.evaluate(script: prefix + source + "\n;0;") { [weak self] _, error in
            guard let self = self, self.isRunning else { return }
            if let error = error {
                let nsError = error as NSError
                SchoolDiagnosticLog.readerInjectionFailed(stage: "courses", attempt: attempt, error: nsError)
                if attempt < 2 {
                    self.note("学校页面尚未就绪，正在重试…")
                    self.after(0.25) { [weak self] in self?.read(attempt: attempt + 1) }
                    return
                }
                self.recoverRead(requestId: requestId)
                return
            }
            self.pollRead(requestId: requestId, remaining: Self.pollLimit)
        }
    }

    // 第二次注入仍报 completion error 时，JS 可能已经写入了本轮结果（Promise 序列化失败并不等于脚本没跑）。
    // 用一个可序列化的轻量脚本探查，有本轮结果就继续轮询，没有才保留原文案失败。
    /// 兜底检查：注入报错并不代表脚本没跑，先看看网页里有没有本轮结果。
    private func recoverRead(requestId: String) {
        after(0.4) { [weak self] in
            guard let self = self, self.isRunning else { return }
            let script = "(function(){try{var r=window.__tomorrowRead;"
                + "return r?JSON.stringify({id:r.id,done:!!r.done}):null}catch(e){return null}})()"
            self.host?.evaluate(script: script) { [weak self] value, error in
                guard let self = self, self.isRunning else { return }
                if error == nil, let info = self.jsonObject(from: value), info.optString("id") == requestId {
                    self.pollRead(requestId: requestId, remaining: Self.pollLimit)
                    return
                }
                self.fail("学校页面脚本执行失败，请稍后重试")
            }
        }
    }

    /// 每隔 200 毫秒取一次读取结果；拿到本轮完成的结果才继续，旧结果直接忽略。
    private func pollRead(requestId: String, remaining: Int) {
        guard isRunning else { return }
        guard remaining > 0 else {
            fail("学校响应超时，保留上次课表")
            return
        }
        let script = "(function(){try{var r=window.__tomorrowRead;return JSON.stringify(r||null)}catch(e){return null}})()"
        host?.evaluate(script: script) { [weak self] value, _ in
            guard let self = self, self.isRunning else { return }
            guard let result = self.jsonObject(from: value) else {
                self.retryPollRead(requestId: requestId, remaining: remaining)
                return
            }
            // 脚本上一轮的产物（id 不同）直接忽略，继续等本轮。
            if result.optString("id") != requestId || result.optBool("done", false) == false {
                self.retryPollRead(requestId: requestId, remaining: remaining)
                return
            }
            self.handleReadResult(result)
        }
    }

    /// 等 200 毫秒后再问一次，并把剩余次数减一。
    private func retryPollRead(requestId: String, remaining: Int) {
        after(Self.pollInterval) { [weak self] in
            self?.pollRead(requestId: requestId, remaining: remaining - 1)
        }
    }

    // 对应 SchoolClient.read 里对结果的分支：login → sso；error → fail；rows/weeks 不合法 → fail。
    /// 解读读取结果：要登录就续期/等登录，报错就失败，课表不完整也失败，正常就打包回传。
    private func handleReadResult(_ result: JSONObject) {
        if result.optBool("login", false) {
            if awaitingLogin {
                // 用户正在手动登录，表单自己拥有导航权；不抢走页面，等下一次 didFinish 再继续。
                needLogin()
            } else {
                sso(reason: "reader-login")
            }
            return
        }
        let error = result.optString("error")
        if error.isEmpty == false {
            fail(error)
            return
        }
        let rows = result.optArray("rows") ?? []
        let weeks = result.optInt("weeks", 0)
        if rows.isEmpty || weeks < 1 || weeks > 60 {
            fail("学校课表不完整，保留上次课表")
            return
        }
        var semesterId = result.optString("sem")
        if semesterId.range(of: "^[0-9]{4}-[0-9]{4}-[12]$", options: .regularExpression) == nil {
            semesterId = "unknown"
        }
        var payload: JSONObject = [
            "rows": rows,
            "totalWeeks": weeks,
            "semesterId": semesterId,
        ]
        if let profile = profile {
            payload["studentProfile"] = profile
        }
        // 考试三字段透传（S 档）：读取脚本 web/school-reader.js 已把考试列表/时间/失败类别带在结果里，
        // 这里与 Android SchoolClient.java:78-80 逐字段对齐——存在才透传，失败类别做 5 类白名单归一；
        // 考试的规范化、容错与“无数据保留旧快照”全部留给共享 web 层（web/jiaowu-exam.mjs），原生不做业务解析。
        if let exams = result.optArray("exams") {
            payload["exams"] = exams
        }
        let examFetchedAt = result.optString("examFetchedAt")
        if examFetchedAt.isEmpty == false {
            payload["examFetchedAt"] = examFetchedAt
        }
        var examError = result.optString("examError")
        if examError.isEmpty == false {
            if Self.examErrorKinds.contains(examError) == false {
                examError = "other"
            }
            payload["examError"] = examError
        }
        persistSessionCookies()
        finish(.success(payload))
    }

    // MARK: - 门户 / 登录（对应 inspectPortal / needLogin / leaveLogin）

    /// 在门户页里找「教务入口」；找不到就每 400 毫秒再找，最多 20 次。
    private func inspectPortal(attempt: Int) {
        guard isRunning else { return }
        let script = "(function(){try{"
            + "var out={login:false,href:null};"
            + "out.login=!!document.querySelector('input[type=password],input[name=userAccount]');"
            + "var links=document.querySelectorAll('a[href]');"
            + "for(var i=0;i<links.length;i++){var href=links[i].href||'';"
            + "if(href.indexOf('jiaowu.juwp.edu.cn')>=0){out.href=href;break;}}"
            + "return JSON.stringify(out)}catch(e){return null}})()"
        host?.evaluate(script: script) { [weak self] value, _ in
            guard let self = self, self.isRunning else { return }
            let info = self.jsonObject(from: value)
            let needsLogin = info?.optBool("login", false) ?? false
            let href = info?.optString("href") ?? ""
            if needsLogin {
                self.needLogin()
                return
            }
            if self.isAcademicEntry(href) {
                self.leaveLogin()
                // 对齐 SchoolClient.java:61：门户点进教务时 Android 在 leaveLogin() 之后又显式 timeout(60000)，
                // 即使当时不在登录等待中也要挂 60s 兜底。
                self.scheduleDeadline(Self.leaveLoginDeadline)
                self.note("正在连接教务系统…")
                self.host?.load(urlString: href)
                return
            }
            if attempt >= Self.portalRetryLimit {
                self.fail("门户页面未提供教务入口，保留原课表")
                return
            }
            self.after(Self.portalRetryInterval) { [weak self] in self?.inspectPortal(attempt: attempt + 1) }
        }
    }

    // 对应 SchoolClient.page 的 eapp2 分支：CAS 登录表单出现 → 清过期 TGC + 等待用户登录。
    /// 检查当前是不是统一身份认证的登录页；是就清掉过期票据并请用户登录。
    private func inspectLoginForm() {
        let script = "(function(){try{return !!document.querySelector("
            + "'input[type=password],input[name=userAccount],input[name=execution]')}catch(e){return false}})()"
        host?.evaluate(script: script) { [weak self] value, _ in
            guard let self = self, self.isRunning else { return }
            let hasForm = JSONCompat.bool(value) ?? false
            guard hasForm else { return }
            self.clearExpiredTGC()
            self.needLogin()
        }
    }

    // 教务系统会话失效时不一定 302，而是 200 返回自带登录页（实测见 ios/docs/P2-SSO-DIAGNOSIS.md）。
    // FRAME/TABLE 注入读取前先探测登录表单；命中就走 SSO，避免把登录 HTML 当课表页。
    /// 教务页有时会伪装成正常页面返回登录框；先检查，避免把登录页当课表读。
    private func inspectAcademicLogin(_ proceed: @escaping () -> Void) {
        guard let host = host else { return }
        let script = "(function(){try{return !!document.querySelector("
            + "'input[type=password],input[name=userAccount],input[name=execution]')}catch(e){return false}})()"
        host.evaluate(script: script) { [weak self] value, error in
            guard let self = self, self.isRunning else { return }
            if error == nil, JSONCompat.bool(value) == true {
                // 手动登录等待中不打断表单；SSO 已试过一次才失败，避免无限循环。
                if self.awaitingLogin { return }
                if self.ssoUsed {
                    self.fail("学校读取失败，请重新确认登录")
                } else {
                    self.sso(reason: "expired-school-cookie")
                }
                return
            }
            proceed()
        }
    }

    // 对应 SchoolClient.needLogin：交给用户在学校页面登录，登录完成后页面回调会继续流程。
    /// 需要用户手动登录：显示页面、提示登录、暂停倒计时，等登录完成再继续。
    private func needLogin() {
        guard finished == false else { return }
        guard awaitingLogin == false else { return }
        awaitingLogin = true
        note("请在学校页面完成登录")
        // 用户必须在这个页面输入账号密码；无头容器用户看不见，交给 provider detach 后 present。
        onNeedsVisiblePresentation?()
        // 对齐 SchoolClient.java:47-48：登录表单自己拥有错误，只取消旧计时器（Android 的 deadlineVersion++），
        // 不再另设截止时间；用户完成登录（leaveLogin）或主动取消才结束等待。
        cancelDeadline()
    }

    /// 用户登录完成、离开登录页时调用；只有确实在等登录才重新挂 60 秒倒计时。
    private func leaveLogin() {
        // 对齐 SchoolClient.java:49 开头的 if(!awaitingLogin)return：只有登录等待中的页面跳转才挂 60s 兜底，
        // 已保存 cookie 直接进教务时保留 start() 的 90s 总时限。
        guard awaitingLogin else { return }
        awaitingLogin = false
        // 对齐 SchoolClient.java:49：登录后到进入教务的等待上限是 60s，不与 needLogin 的取消语义混用。
        scheduleDeadline(Self.leaveLoginDeadline)
    }

    // 对应 SchoolClient.sso：只重试一次。
    /// 用已保存的登录状态自动续期；只允许试一次，第二次失败就明确报错。
    private func sso(reason: String) {
        guard finished == false else { return }
        if ssoUsed {
            SchoolDiagnosticLog.sessionRenewalRepeat()
            fail("学校会话自动恢复未成功，原课表已保留。请稍后重试；如统一身份认证已过期，系统会要求重新登录")
            return
        }
        ssoUsed = true
        ssoEntryLoading = true
        // 诊断白名单只接受这两个 reason；其余登录页/读取器触发统一归为 expired-school-cookie。
        let diagnosticReason = reason == "missing-academic-cookie" ? "missing-school-cookie" : "expired-school-cookie"
        SchoolDiagnosticLog.sessionRenewalStart(reason: diagnosticReason)
        // 对齐 SchoolClient.java:46：SSO 恢复阶段重新挂 90 秒总时限（Android 此处 timeout(90000)）。
        scheduleDeadline(Self.totalDeadline)
        note("正在使用已保存的学校登录状态恢复教务会话…")
        host?.load(urlString: SchoolURLPolicy.schoolSSOEntryURL)
    }

    // MARK: - 收尾

    /// 统一的失败收尾：停止加载、只回一次中文原因，并保留旧课表。
    private func fail(_ message: String) {
        guard finished == false else { return }
        host?.stopLoading()
        finish(.failure(.message(message)))
    }

    /// 统一的结束收尾：保证回包只发一次，并通知网页停止后台读取脚本。
    private func finish(_ result: Result<JSONObject, BridgeFailure>) {
        guard finished == false else { return }
        finished = true
        awaitingLogin = false
        sessionReady = false
        ssoEntryLoading = false
        deadlineTimer?.cancel()
        deadlineTimer = nil
        host?.evaluate(script: "window.__tomorrowAbort&&window.__tomorrowAbort.abort&&window.__tomorrowAbort.abort();", completion: { _, _ in })
        let callback = completion
        completion = nil
        callback?(result)
    }

    // 对应 SchoolClient.java:47-48 的 deadlineVersion++：取消当前挂起的截止计时。
    /// 取消当前倒计时；像把已经上好的闹钟按掉。
    private func cancelDeadline() {
        deadlineTimer?.cancel()
        deadlineTimer = nil
    }

    /// 重新挂一个倒计时；时间一到，若还在等 SSO 入口就报入口错误，否则报超时。
    private func scheduleDeadline(_ seconds: TimeInterval) {
        deadlineTimer?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.isRunning else { return }
            if self.ssoEntryLoading {
                self.ssoEntryLoading = false
                self.fail("统一身份认证入口暂时无法打开，请检查网络后重试（原课表已保留）")
                return
            }
            self.fail("学校响应超时，保留上次课表")
        }
        deadlineTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    /// 延迟一小段时间再执行；所有等待都走主线程，避免界面和数据打架。
    private func after(_ seconds: TimeInterval, _ work: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    /// 更新浏览器顶部的提示文字；host 不在了就什么也不做。
    /// S 档：同一句阶段文案同时交给网页（window.onNativeProgress），由桥接层按当前请求 id 转发。
    private func note(_ text: String) {
        host?.updateNote(text)
        onProgress?(text)
    }

    // MARK: - 工具

    /// 判断是不是学校门户（电脑版或手机版）。
    private func isPortalURL(_ rawURL: String) -> Bool {
        guard let host = URL(string: rawURL)?.host?.lowercased() else { return false }
        return host == "portal.juwp.edu.cn" || host == "jiaowuh5.juwp.edu.cn"
    }

    /// 判断门户里的链接是不是教务系统入口；只认 jiaowu 域名和 http/https。
    private func isAcademicEntry(_ rawURL: String) -> Bool {
        guard let url = URL(string: rawURL), let host = url.host?.lowercased() else { return false }
        guard host == "jiaowu.juwp.edu.cn" else { return false }
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return false }
        return true
    }

    // WKWebView 的 evaluateJavaScript 返回类型不确定（String / NSNumber / NSDictionary / nil），
    // 全部统一成 JSONObject，禁止强转。
    /// 把网页返回的任意值安全地变成 JSON 对象；类型不对就返回 nil，绝不强转。
    private func jsonObject(from value: Any?) -> JSONObject? {
        guard let value = value, (value is NSNull) == false else { return nil }
        if let text = value as? String {
            guard let data = text.data(using: .utf8),
                  let decoded = try? JSONSerialization.jsonObject(with: data, options: []) else { return nil }
            return JSONCompat.object(decoded)
        }
        return JSONCompat.object(value)
    }

    /// 把普通字符串变成可以塞进 JavaScript 的字符串字面量，防止引号破坏脚本。
    private func jsLiteral(_ value: String) -> String {
        if let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
           let text = String(data: data, encoding: .utf8), text.count >= 2 {
            return String(text.dropFirst().dropLast())
        }
        let escaped = value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "\"" + escaped + "\""
    }

    /// 调试版检查：如果不在主线程就立刻停下来，方便早发现线程错误。
    private func assertMainThread() {
        #if DEBUG
        dispatchPrecondition(condition: .onQueue(.main))
        #endif
    }
}

// 读取脚本来自共享层 web/，随 folder reference 复制进 App bundle 的 web/ 目录。
// 找不到脚本时不做任何伪造：课表读取直接失败，年级信息（可选）跳过。
/// 读取脚本的取用处；脚本本身在共享层 web/，这里只负责从 App 包里找出来。
enum SchoolReadScripts {

    /// 取课表读取脚本；找不到返回 nil，调用方会明确失败，不会伪造课表。
    static func timetableReader() -> String? { return source(named: "school-reader") }

    /// 取年级读取脚本；找不到返回 nil，调用方会跳过年级继续读课表。
    static func profileReader() -> String? { return source(named: "profile-reader") }

    /// 从 App 包的 web/ 目录或根目录找脚本；读不到或内容为空都返回 nil。
    private static func source(named name: String) -> String? {
        let bundle = Bundle.main
        let candidates: [URL?] = [
            bundle.url(forResource: name, withExtension: "js", subdirectory: "web"),
            bundle.url(forResource: name, withExtension: "js"),
        ]
        for candidate in candidates {
            guard let url = candidate else { continue }
            if let text = try? String(contentsOf: url, encoding: .utf8), text.isEmpty == false {
                return text
            }
        }
        return nil
    }
}
