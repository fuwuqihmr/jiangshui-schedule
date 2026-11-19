// 【这个文件干什么】去学校教务系统把「请假记录」拉回来，整理成 App 课表页能直接显示的
//   清单（请假类型、事由、起止时间、审批状态）。它不打开网页，是后台直接发网络请求问接口。
// 【什么时候会用到它】用户点「同步请假记录」时；平时不工作，也不占用界面。
// 【它和谁配合】上级 SchoolProvider 收到 App 网页层的请求后调用它；它用 SchoolURLPolicy
//   里的固定网址（去哪问）和校园网登录后留下的 cookie（证明「我是已登录的学生」）。
// 【为什么手拼 Cookie】iOS 里「网页用的 cookie 罐子」和「网络请求用的 cookie 罐子」是
//   两个互不相通的口袋，网络请求不会自动带上门票，所以要先读出来、再手工贴到请求头上。
// 【失败怎么办】不给上层抛异常，只回一个 {ok:false, code:"TIMEOUT"} 这样的暗号，前端认它。
import Foundation
import WebKit

// 假条记录同步（P2）。
//
// 对照 android/app/src/main/java/cn/local/tomorrow/MainActivity.java：
// - :524-535 rememberLeaveSession（从请假页 URL 记忆 uid / pageEnc）
// - :536-543 leaveSyncError（{ok:false, code}）
// - :544-596 leaveFormFields / leaveStatus / leaveIsoTime / leaveSubmittedAt / leaveTrimmedRecord
// - :597-660 fetchLeaveRecords（URLSession 直连，不经 WebView）
// - :661-690 beginLeaveRecordSync（15s watchdog）
//
// 与 Android 的差异（写进 ios/docs/P2-SCHOOL-READ.md）：
// - Android 从 CookieManager 取 cookie；iOS 的 WKHTTPCookieStore 与 URLSession 的
//   HTTPCookieStorage 不共享，因此这里读 WKHTTPCookieStore 后手工拼 Cookie 头。
// - 失败一律返回 {ok:false, code}，不抛错误：前端 web/leave-status.mjs 只认 response.code，
//   抛错误会被归成 NETWORK。
/// 请假记录的「取数 + 清洗」小工：负责记住网页上的身份参数、发请求、把学校返回的
/// 一坨嵌套 JSON 削成固定字段（status / startAt / endAt…），失败时只回错误码、不抛异常。
final class LeaveRecordsService {

    // 下面这几行是「认人」用的小纸条：左边是存进 UserDefaults（手机上一个只属于本 App 的
    // 小抽屉）时用的标签；右边三条正则（格式模板）把参数限死成纯数字/字母下划线，
    // 防止拼请求时被塞进奇怪字符；最后两个是安全阀：响应最多 2 MB、单次最多等 12 秒。
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

    // 只在请假页 URL 上记忆会话参数；不保存 cookie、账号或密码。
    /// 用户打开请假页时，从网页地址里把 uid / pageEnc / formId 抄下来存好。
    /// 这三个是接口「认人」的凭据（相当于窗口办事时给你的受理号），缺一个后面都调不通。
    /// 只要网址不是 https、域名不是 xgxt、路径里没有 apply.html，或参数不合格式，就整条丢弃。
    func rememberSession(url rawURL: String) {
        guard let components = URLComponents(string: rawURL) else { return }
        guard let scheme = components.scheme?.lowercased(), scheme == "https" else { return }
        guard let host = components.host?.lowercased(), host == "xgxt.juwp.edu.cn" else { return }
        guard components.path.contains("/office/"), components.path.contains("apply.html") else { return }
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

    // MARK: - 同步（MainActivity.fetchLeaveRecords）

    /// 拉一次请假记录（异步：等网络回来才返回，期间不卡界面）。
    /// 成功回 ["ok": true, "records": [...]]；
    /// 失败回 ["ok": false, "code": "NEED_LOGIN" 这类错误码，见下方的错误常量]，
    /// 这里故意不抛异常，因为上层网页脚本只认 code 这个暗号。
    func fetch() async -> JSONObject {
        let cookie = await schoolCookieHeader()
        if cookie.isEmpty { return Self.error("NEED_LOGIN") }
        let uid = defaults.string(forKey: Self.uidKey) ?? ""
        let pageEnc = defaults.string(forKey: Self.pageEncPrefix + SchoolURLPolicy.leaveFormID) ?? ""
        guard matches(uid, Self.uidPattern), matches(pageEnc, Self.pageEncPattern) else {
            return Self.error("NEED_SESSION")
        }
        guard let url = URL(string: SchoolURLPolicy.leaveListURL) else { return Self.error("NETWORK") }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = Self.readTimeout
        // 字段顺序必须与 Android 逐字一致（服务端按顺序做了校验）。
        let body = "formId=" + SchoolURLPolicy.leaveFormID
            + "&uid=" + uid
            + "&formUserId=0&aprvAppId=" + SchoolURLPolicy.leaveFormID
            + "&pageEnc=" + pageEnc
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
            return Self.parse(data)
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
    /// 规则：域名要对得上（父域的也算）、已过期的丢掉、路径更具体的排前面。
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
    /// 判断某个 cookie 的域名能不能用在这个 host 上：要么完全一样，要么 host 以「.域名」结尾。
    /// 这样 juwp.edu.cn 发的大范围 cookie 能用，但 xxxgxt.juwp.edu.cn 这种相似后缀不会混进来。
    private static func sendsCookie(domain: String, to host: String) -> Bool {
        if domain == host { return true }
        return host.hasSuffix("." + domain)
    }

    // WKWebsiteDataStore / WKHTTPCookieStore 是 WebKit 的主线程对象，而 fetch() 由
    // BridgeDispatcher.runAsync 的 Task {} 发起（不保证在主线程）。这里显式切主线程再读，
    // resume 只在 getAllCookies 的 completion 里执行一次。
    /// 读出 WebKit 里保存的全部 cookie（网页登录后都躺在这里）。
    /// 这类对象只能在主线程碰，所以先切回主线程再读；读到结果后只交出去一次。
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

    // MARK: - 解析（MainActivity.leaveTrimmedRecord 及其依赖）

    /// 把学校返回的 JSON 拆开：data.formsUserList 是请假单数组，逐条削成固定字段。
    /// 实在解析不了就回 PARSE，不崩、不抛。
    private static func parse(_ data: Data) -> JSONObject {
        guard let decoded = try? JSONSerialization.jsonObject(with: data, options: []),
              let root = JSONCompat.object(decoded) else {
            return error("PARSE")
        }
        let dataObject = root.optObject("data")
        guard let list = dataObject?.optArray("formsUserList") else { return error("PARSE") }
        var records: [Any] = []
        for element in list {
            guard let item = JSONCompat.object(element) else { continue }
            if let record = trimmedRecord(item) { records.append(record) }
        }
        return ["ok": true, "fetchedAt": SchoolSession.nowMilliseconds(), "records": records]
    }

    /// 把一张请假单削成 App 要的十几个字段；连单号（id / autoId）都没有的脏数据直接丢掉。
    private static func trimmedRecord(_ item: JSONObject) -> JSONObject? {
        var identifier = item.optString("id").trimmed
        if identifier.isEmpty { identifier = item.optString("autoId").trimmed }
        if identifier.isEmpty { return nil }
        let fields = formFields(item)
        let statusText = item.optString("aprvStatusType").trimmed
        let statusId = item.optString("aprvStatusTypeId").trimmed
        var record: JSONObject = [
            "id": identifier,
            "status": status(text: statusText, statusId: statusId),
            "statusText": statusText,
            "statusId": statusId,
            "typeText": formValue(fields, ["请假类型"]),
            "reason": formValue(fields, ["请假原因"]),
            "startAt": isoTime(formValue(fields, ["请假开始时间"])),
            "endAt": isoTime(formValue(fields, ["请假结束时间"])),
            "submittedAt": submittedAt(item, fields),
            "approver": item.optString("allAprvUserList").trimmed,
            "number": formValue(fields, ["请假编号"]),
            "durationDays": formValue(fields, ["请假时长"]),
        ]
        record["id"] = identifier
        return record
    }

    /// 学校把「请假类型 / 事由 / 时间」这些放在 formData[].fields[] 里，标签是中文名
    /// （比如「请假原因」）。这里把它翻成「标签 → 值」的字典，方便后面按名字取；同名只取第一个。
    private static func formFields(_ item: JSONObject) -> [String: String] {
        var fields: [String: String] = [:]
        guard let blocks = item.optArray("formData") else { return fields }
        for element in blocks {
            guard let block = JSONCompat.object(element), let rows = block.optArray("fields") else { continue }
            for row in rows {
                guard let field = JSONCompat.object(row) else { continue }
                let label = field.optString("label").trimmed
                if label.isEmpty || fields[label] != nil { continue }
                var value = ""
                if let values = field.optArray("values"), let first = values.first,
                   let object = JSONCompat.object(first) {
                    value = object.optString("val")
                }
                fields[label] = value
            }
        }
        return fields
    }

    private static func formValue(_ fields: [String: String], _ labels: [String]) -> String {
        for label in labels {
            let value = (fields[label] ?? "").trimmed
            if value.isEmpty == false { return value }
        }
        return ""
    }

    /// 把学校那句中文审批状态翻成三种机器码：approved（通过）/ pending（审批中）/ rejected（驳回），
    /// 认不出来的算 unknown——宁可显示「未知」，也不要瞎猜。
    private static func status(text: String, statusId: String) -> String {
        if text.isEmpty == false {
            if matches(text, "驳回|退回|不通过|拒绝|不同意") { return "rejected" }
            if matches(text, "待|审批中|处理中|审核中") { return "pending" }
            if matches(text, "通过|批准|同意|已完成") { return "approved" }
            return "unknown"
        }
        return statusId == "2" ? "approved" : "unknown"
    }

    /// 把学校五花八门的时间（只有日期 / 到分钟 / 到秒）统一成带时区的标准写法，例如
    /// "2026-10-01 08:30" → "2026-10-01T08:30:00+08:00"，前端就能直接排序、显示。
    private static func isoTime(_ value: String) -> String {
        let text = value.trimmed
        if text.isEmpty { return "" }
        if matches(text, "^[0-9]{4}-[0-9]{2}-[0-9]{2}$") { return text }
        if matches(text, "^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}$") {
            return text.replacingOccurrences(of: " ", with: "T") + ":00+08:00"
        }
        if matches(text, "^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}$") {
            return text.replacingOccurrences(of: " ", with: "T") + "+08:00"
        }
        return text
    }

    /// 找「申请时间」：先看表单里有没有中文标签，没有就拿毫秒时间戳 inserttime 换算（学校用北京时间）。
    private static func submittedAt(_ item: JSONObject, _ fields: [String: String]) -> String {
        let fromForm = formValue(fields, ["请假申请时间", "申请时间"])
        if fromForm.isEmpty == false { return isoTime(fromForm) }
        let raw = item.optString("inserttime").trimmed
        guard let milliseconds = Int64(raw), milliseconds > 0 else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 8 * 60 * 60)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'+08:00'"
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000.0))
    }

    // MARK: - 工具

    /// 统一的失败暗号构造器：{"ok": false, "code": "..."}。前端只读 code，不读人话。
    private static func error(_ code: String) -> JSONObject {
        return ["ok": false, "code": code]
    }

    private func queryValue(_ items: [URLQueryItem], _ name: String) -> String {
        for item in items where item.name == name {
            return (item.value ?? "").trimmed
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

/// 给字符串补一个 trimmed：去掉首尾的空格和换行——网页抓来的值经常带多余的空白。
private extension String {
    var trimmed: String { return trimmingCharacters(in: .whitespacesAndNewlines) }
}
