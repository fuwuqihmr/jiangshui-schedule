// 【这个文件干什么】去学校教务系统把「请假 / 销假 / 续假记录」拉回来，整理成 App 课表页能直接显示
//   的清单（类型、事由、起止时间、审批状态）。它不打开网页，是后台直接发网络请求问接口。
// 【什么时候会用到它】用户点「同步请假记录」或销假页要求刷新时；平时不工作，也不占用界面。
// 【它和谁配合】上级 SchoolProvider 收到 App 网页层的请求后调用它；它用 SchoolURLPolicy
//   里的固定网址（去哪问）和校园网登录后留下的 cookie（证明「我是已登录的学生」）。
// 【为什么手拼 Cookie】iOS 里「网页用的 cookie 罐子」和「网络请求用的 cookie 罐子」是
//   两个互不相通的口袋，网络请求不会自动带上门票，所以要先读出来、再手工贴到请求头上。
// 【失败怎么办】不给上层抛异常，只回一个 {ok:false, code:"TIMEOUT"} 这样的暗号，前端认它。
import Foundation
import WebKit

// 假条记录同步（P3，对齐 Android v1.5.0 MainActivity.java:786-848）。
//
// 对照 android/app/src/main/java/cn/local/tomorrow/MainActivity.java：
// - :696-708 rememberLeaveSession（从任意 /office/ 表单页记忆 uid / pageEnc）
// - :709 leaveSyncError（{ok:false, code}）
// - :710-785 leaveFormFields / leaveStatus / leaveIsoTime / leaveSubmittedAt / leaveTrimmedRecord
//   （已拆到 LeaveRecordParser.swift，本文件只保留「取数」）
// - :786-840 fetchLeaveRecords（URLSession 直连，不经 WebView）
// - :841-848 fetchCancelRecords / fetchRenewRecords（278615 / 278618）
// - :918-938 beginLeaveRecordSync（15s watchdog，见 LeaveSyncCoordinator.swift）
//
// 与 Android 的差异（写进 ios/docs/P2-SCHOOL-READ.md）：
// - Android 从 CookieManager 取 cookie；iOS 的 WKHTTPCookieStore 与 URLSession 的
//   HTTPCookieStorage 不共享，因此这里读 WKHTTPCookieStore 后手工拼 Cookie 头。
// - 失败一律返回 {ok:false, code}，不抛错误：前端 web/leave-status.mjs 只认 response.code，
//   抛错误会被归成 NETWORK。
/// 请假记录的「取数」小工：记住网页上的身份参数、发请求、把响应交给 LeaveRecordParser 清洗。
final class LeaveRecordsService {

    // 「认人」用的小纸条：左边是存进 UserDefaults（手机上一个只属于本 App 的小抽屉）时用的
    // 标签；右边三条正则把参数限死成纯数字/字母下划线，防止拼请求时被塞进奇怪字符；
    // 最后两个是安全阀：响应最多 2 MB、单次最多等 12 秒。
    private static let uidKey = "leave.uid"
    private static let pageEncPrefix = "leave.pageEnc."
    private static let uidPattern = "^[0-9]{1,30}$"
    private static let pageEncPattern = "^[A-Za-z0-9_-]{8,256}$"
    private static let formIdPattern = "^[0-9]{1,20}$"
    private static let maximumResponseBytes = 2_000_000
    private static let readTimeout: TimeInterval = 12

    private let defaults: UserDefaults

    /// 造一个服务对象。参数 defaults 是存小纸条的抽屉，默认用系统给本 App 私有的那个，
    /// 测试时可以换成临时抽屉，互相不干扰。
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: - 会话参数（MainActivity.rememberLeaveSession）

    // v1.5.0 明确：请假与销假表单路径可能不同，不能只认 apply.html；只要在任意 /office/
    // 页面且带合法 uid / pageEnc / formId，就记下来。不保存 cookie、账号或密码。
    /// 用户打开请假/销假/续假页时，从网页地址里把 uid / pageEnc / formId 抄下来存好。
    /// 这三个是接口「认人」的凭据（相当于窗口办事时给你的受理号），缺一个后面都调不通。
    func rememberSession(url rawURL: String) {
        guard let components = URLComponents(string: rawURL) else { return }
        guard let scheme = components.scheme?.lowercased(), scheme == "https" else { return }
        guard components.port == nil || components.port == 443 else { return }
        guard SchoolURLPolicy.isXgxtUrl(rawURL) else { return }
        guard components.path.contains("/office/") else { return }
        let items = components.queryItems ?? []
        let uid = queryValue(items, "uid")
        let pageEnc = queryValue(items, "pageEnc")
        var formId = queryValue(items, "formid")
        if formId.isEmpty { formId = queryValue(items, "formId") }
        guard matches(uid, Self.uidPattern) else { return }
        guard matches(pageEnc, Self.pageEncPattern) else { return }
        guard matches(formId, Self.formIdPattern) else { return }
        defaults.set(uid, forKey: Self.uidKey)
        defaults.set(pageEnc, forKey: Self.pageEncPrefix + formId)
    }

    /// 退出登录时把小纸条全擦掉（只擦 "leave." 开头的那几个，不动用户别的设置）。
    func clearSession() {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("leave.") {
            defaults.removeObject(forKey: key)
        }
    }

    // MARK: - 同步入口（MainActivity.fetchLeaveRecords / fetchCancelRecords / fetchRenewRecords）

    /// 请假记录（278616）。
    func fetchLeave() async -> JSONObject {
        return await fetch(formId: SchoolURLPolicy.leaveFormID,
                           prefsFormId: SchoolURLPolicy.leaveFormID,
                           type: "leave")
    }

    /// 销假记录（278615，v1.5.0 新增）。
    func fetchCancel() async -> JSONObject {
        return await fetch(formId: SchoolURLPolicy.cancelFormID,
                           prefsFormId: SchoolURLPolicy.cancelFormID,
                           type: "cancel")
    }

    /// 续假记录（278618，v1.5.0 新增）；由 LeaveSyncCoordinator 与请假并行抓取。
    func fetchRenew() async -> JSONObject {
        return await fetch(formId: SchoolURLPolicy.renewFormID,
                           prefsFormId: SchoolURLPolicy.renewFormID,
                           type: "renew")
    }

    /// 拉一次表单记录（异步：等网络回来才返回，期间不卡界面）。
    /// 成功回 ["ok": true, "records": [...]]；
    /// 失败回 ["ok": false, "code": "NEED_LOGIN" 这类错误码]，
    /// 这里故意不抛异常，因为上层网页脚本只认 code 这个暗号。
    private func fetch(formId: String, prefsFormId: String, type: String) async -> JSONObject {
        let sessionCode = Self.sessionCode(for: type)
        let cookie = await schoolCookieHeader()
        if cookie.isEmpty { return Self.error("NEED_LOGIN") }
        let uid = defaults.string(forKey: Self.uidKey) ?? ""
        let pageEnc = defaults.string(forKey: Self.pageEncPrefix + prefsFormId) ?? ""
        guard matches(uid, Self.uidPattern), matches(pageEnc, Self.pageEncPattern) else {
            return Self.error(sessionCode)
        }
        guard let url = URL(string: SchoolURLPolicy.leaveListURL) else { return Self.error("NETWORK") }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = Self.readTimeout
        // 字段顺序必须与 Android v1.5.0 :803-808 逐字一致（服务端按顺序做了校验）；
        // formId 与 aprvAppId 用当前表单，pageEnc 用该表单记住的那一份。
        let body = "formId=" + formId
            + "&uid=" + Self.formEncode(uid)
            + "&formUserId=0&aprvAppId=" + formId
            + "&pageEnc=" + Self.formEncode(pageEnc)
            + "&cpage=1&pageSize=50&desensitization=&startTime=&endTime="
        request.httpBody = body.data(using: .utf8)
        request.setValue("application/x-www-form-urlencoded; charset=UTF-8", forHTTPHeaderField: "Content-Type")
        request.setValue("XMLHttpRequest", forHTTPHeaderField: "X-Requested-With")
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        // ephemeral 是「不存缓存的临时会话」：不落盘 cookie、不写缓存，每次同步都像一双
        // 用完就丢的一次性筷子，不会把上一次的状态带到下一次。
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Self.readTimeout
        configuration.timeoutIntervalForResource = Self.readTimeout + 1
        // 不让 URLSession 自行管理 cookie：认证信息只来自上面手工拼的 Cookie 头。
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { return Self.error("NETWORK") }
            if http.statusCode != 200 { return Self.error("HTTP_" + String(http.statusCode)) }
            if data.count > Self.maximumResponseBytes { return Self.error("PARSE") }
            return LeaveRecordParser.parse(data, type: type)
        } catch {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorTimedOut {
                return Self.error("TIMEOUT")
            }
            return Self.error("NETWORK")
        }
    }

    // WKHTTPCookieStore 与 URLSession 不共享 cookie，只能读出后手工拼成请求头。
    // 对齐 Android 的 CookieManager.getCookie(XGXT_ORIGIN)：
    // - 域名按 RFC 6265 §5.1.3 domain-match（含父域 cookie，但不命中 xxxgxt.juwp.edu.cn 这类相似域）；
    // - 已过期的 cookie 不发（浏览器语义，Android 的 CookieManager 同样按有效期过滤）；
    // - 同名时路径更具体者优先（RFC 6265 §5.4；Android CookieManager 也按 path 长度降序）。
    /// 把网页登录后留下的 cookie 拼成一条请求头字符串（形如 "a=1; b=2"）。
    /// cookie 是网站发给浏览器的「临时通行证」，问接口时必须原样带上，否则会被当成没登录。
    private func schoolCookieHeader() async -> String {
        let cookies = await allCookies()
        let now = Date()
        var parts: [String] = []
        for cookie in cookies.sorted(by: { $0.path.count > $1.path.count }) {
            var domain = cookie.domain.lowercased()
            if domain.hasPrefix(".") { domain = String(domain.dropFirst()) }
            // 域名匹配按 RFC 6265 §5.1.3：host 完全相同，或 host 以 "." + domain 结尾。
            // 父域 cookie 也要带上（Android 的 CookieManager.getCookie(XGXT_ORIGIN) 同样会返回
            // juwp.edu.cn 上的 cookie）；只接受点边界后缀，避免命中 xxxgxt.juwp.edu.cn 这类相似域。
            guard Self.sendsCookie(domain: domain, to: "xgxt.juwp.edu.cn"),
                  cookie.value.isEmpty == false else { continue }
            if let expires = cookie.expiresDate, expires <= now { continue }
            parts.append(cookie.name + "=" + cookie.value)
        }
        return parts.joined(separator: "; ")
    }

    // RFC 6265 §5.1.3 domain-match：相等，或以 "." + 域结尾（父域 cookie 对子域有效）。
    private static func sendsCookie(domain: String, to host: String) -> Bool {
        if domain == host { return true }
        return host.hasSuffix("." + domain)
    }

    // WKWebsiteDataStore / WKHTTPCookieStore 是 WebKit 的主线程对象，而 fetch() 由
    // BridgeDispatcher 的 Task {} 发起（不保证在主线程）。这里显式切主线程再读，
    // resume 只在 getAllCookies 的 completion 里执行一次。
    private func allCookies() async -> [HTTPCookie] {
        return await withCheckedContinuation { continuation in
            let read: () -> Void = {
                WKWebsiteDataStore.default().httpCookieStore.getAllCookies { list in
                    continuation.resume(returning: list)
                }
            }
            if Thread.isMainThread { read() } else { DispatchQueue.main.async(execute: read) }
        }
    }

    // MARK: - 工具

    /// 不同表单缺会话参数时回不同的 code；销假在前端有专门文案，续假只进诊断日志。
    private static func sessionCode(for type: String) -> String {
        if type == "cancel" { return "NEED_CANCEL_SESSION" }
        if type == "renew" { return "NEED_RENEW_SESSION" }
        return "NEED_SESSION"
    }

    /// Java URLEncoder 的等价写法（只针对已被正则限死的安全字符）。
    /// 保留 A-Z a-z 0-9 - . _，其余百分号编码；uid/pageEnc 不含空格，因此不需要 "+" 语义。
    private static func formEncode(_ value: String) -> String {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    /// 统一的失败暗号构造器：{"ok": false, "code": "..."}。前端只读 code，不读人话。
    private static func error(_ code: String) -> JSONObject {
        return ["ok": false, "code": code]
    }

    private func queryValue(_ items: [URLQueryItem], _ name: String) -> String {
        for item in items where item.name == name {
            return (item.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return ""
    }

    private func matches(_ value: String, _ pattern: String) -> Bool {
        return LeaveRecordsService.matches(value, pattern)
    }

    /// 正则匹配：看一段文字是否符合某个格式模板（比如 ^[0-9]+$ 表示「全是数字」）。
    private static func matches(_ value: String, _ pattern: String) -> Bool {
        return value.range(of: pattern, options: .regularExpression) != nil
    }
}
