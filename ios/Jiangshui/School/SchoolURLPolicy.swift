// 【这个文件干什么】它是学校网址的「门卫」：只允许名单里的学校网站进入内置浏览器，其他一律拒绝。
// 【什么时候会用到它】打开学校页、请假页，网页里点链接，或学校服务器重定向时，每个地址都要先问它。
// 【它和谁配合】SchoolWebViewHost 在加载前调用它，SchoolReadController 用它判断当前是哪一类学校页面。
// 门卫的规则是「默认拒绝」：只要协议、域名、端口、路径有一项拿不准，就当作坏地址，避免被带去钓鱼网站。
// 网址里如果藏了换行、反斜杠或控制字符，可能把一行请求头拆成两行，所以这类字符直接拒绝。
// Cookie（服务器发给浏览器的登录票据）也会做类似字符检查，防止票据里混入分号/换行篡改请求头。
// 本文件只依赖 Foundation，可在任何线程调用；本机无 Xcode，selfCheck() 只能靠静态断言。
import Foundation

// 学校 / 请假页面的 URL 安全策略。
//
// 逐条移植自：
// - android/app/src/main/java/cn/local/tomorrow/MainActivity.java:62-67（HOSTS / XGXT_ORIGIN /
//   LEAVE_SSO / LEAVE_PREFS / LEAVE_FORM_ID / LEAVE_LIST_URL）
// - MainActivity.java:79-107（allowedOpenUrl / allowedWarmupUrl / allowedNav / isXgxtUrl /
//   isCasUrl / isOfficePath）
// - android/app/src/main/java/cn/local/tomorrow/SchoolClient.java:11,14（jsxsd 判定与学校
//   WebView 的 HOSTS 导航白名单）
//
// 入口 URL 是 JS/用户可传的攻击面：scheme/host 必须精确小写 equals。
// 内部导航来自学校服务器重定向，scheme/host 按 RFC 大小写不敏感；
// 用忽略大小写比较，以免把学校偶发的大写重定向挡掉，导致登录链中断。
//
// 硬规则：所有入口默认拒绝（fail-closed）。本文件只依赖 Foundation，可在任意线程调用。
// 注意：本机是 Windows、无 Xcode/swiftc，本文件未编译验证；selfCheck() 是纯 Swift 断言，
// 供 ios/tools/check-ios.mjs（或将来 XCTest）调用，返回失败项列表（空数组 = 全部通过）。
/// 学校网址门卫：集中存放白名单常量和所有「这个地址能不能去」的判断。
/// 所有判断都返回 Bool，false 代表拒绝；调用方不得因为赶时间自行放宽。
public enum SchoolURLPolicy {

    // MARK: - 常量（MainActivity.java:62-67 / SchoolClient.java:5）

    // 学校 WebView 内部导航白名单（SchoolClient.java:6）。
    // 允许内置浏览器打开的学校域名；少一个会导致登录链中断，多一个会扩大被钓鱼的风险。
    public static let hosts: Set<String> = [
        "portal.juwp.edu.cn",
        "eapp2.juwp.edu.cn",
        "jiaowu.juwp.edu.cn",
        "jiaowuh5.juwp.edu.cn",
        "eapp2.nit.edu.cn",
    ]

    // 请假（学工）系统源（MainActivity.java:63）。
    // 请假系统的主地址；后面拼接接口时都从这里出发。
    public static let xgxtOrigin = "https://xgxt.juwp.edu.cn"
    // 请假系统统一身份认证预热地址（MainActivity.java:64）。
    // 请假系统的统一身份认证入口；只允许这一个预热地址，防止被换成钓鱼页。
    public static let leaveSSO = "https://xgxt.juwp.edu.cn/sfrz/login343962"
    // 请假会话参数（uid / pageEnc）的保存位置（MainActivity.java:65）。
    // 请假会话参数的保存名；只记录 uid/pageEnc，不保存密码和 Cookie。
    public static let leavePreferencesName = "leave-session"
    // 请假表单 ID（MainActivity.java:66）。
    // 请假表单编号；学校接口用 278616 区分「请假」这张表。
    public static let leaveFormID = "278616"
    // 请假列表接口（MainActivity.java:67）。
    // 请假记录列表接口；请求体里的表单 ID 必须和上面保持一致。
    public static let leaveListURL = "https://xgxt.juwp.edu.cn/office/data/approve/apps/forms/fore/user/list"

    // 入口 URL 长度上限（UTF-16 码元，等价 Android String.length()）。
    // 网址最长 2048 个字符；超长地址可能藏着绕过检查的尾巴，直接拒绝。
    public static let maximumURLUTF16Length = 2048

    // 学校门户（学校 WebView 默认页，MainActivity.java:227）。
    // 电脑版学校门户；openSchool(mobile:false) 打开它。
    public static let schoolPortalURL = "http://portal.juwp.edu.cn"
    // 学校移动教务首页（openSchool(mobile:true)，MainActivity.java:227）。
    // 手机版教务首页；openSchool(mobile:true) 打开它。
    public static let schoolMobileURL = "http://jiaowuh5.juwp.edu.cn/"
    // 学校教务 WebView origin（P2 读取流程，SchoolClient.java:5）。
    // 教务系统根地址；端口 8080 是学校固定的 HTTP 端口，不能省。
    public static let schoolAcademicRootURL = "http://jiaowu.juwp.edu.cn:8080"
    // 学校统一身份认证入口（SchoolClient.java:5）。
    // 统一身份认证入口；已保存的学校会话失效时，读取流程先来这里续期。
    public static let schoolSSOEntryURL = "https://jiaowu.juwp.edu.cn:81/sso.jsp"
    // CAS 登录页（SchoolClient.java:5）。
    // CAS 登录页；出现密码输入框时，说明需要用户手动登录。
    public static let schoolCASLoginURL = "https://eapp2.juwp.edu.cn:9443/cas/login"

    // WebView 的两种用途：学校教务页 / 请假服务页。
    /// 浏览器的两种用途：school 看教务，leaveApp 看请假；用途不同，白名单也不同。
    public enum WebMode: Equatable {
        // 学校教务模式：允许学校门户、教务系统和统一身份认证。
        case school
        // 请假模式：只允许请假系统与 CAS 登录页，比学校模式更窄。
        case leaveApp
    }

    // 按用途选择导航策略（默认拒绝）。
    /// 按用途选门卫规则：学校页用宽一点的学校白名单，请假页用更严格的请假白名单。
    public static func allowedNavigation(_ raw: String?, mode: WebMode) -> Bool {
        if mode == .school { return allowedSchoolNav(raw) }
        return allowedNav(raw)
    }

    // MARK: - 对外判定（MainActivity.java:79-107）

    // 对应 MainActivity.allowedOpenUrl：只放行 https://xgxt.juwp.edu.cn[:443]/... 。
    /// 请假深链的入口检查：必须是 https、精确的 xgxt 域名、没有用户名密码、端口为空或 443。
    public static func allowedOpenUrl(_ raw: String?) -> Bool {
        guard let raw = raw else { return false }
        guard raw.utf16.count <= maximumURLUTF16Length else { return false }
        guard raw.contains("\\") == false else { return false }
        guard containsControlCharacter(raw) == false else { return false }
        guard let parsed = parse(raw) else { return false }
        guard parsed.scheme == "https" else { return false }
        guard parsed.host == "xgxt.juwp.edu.cn" else { return false }
        guard parsed.userInfo == nil else { return false }
        guard parsed.port == nil || parsed.port == 443 else { return false }
        return parsed.path.hasPrefix("/")
    }

    // 对应 MainActivity.allowedWarmupUrl：只放行空值或官方 SSO 预热地址（逐字相等）。
    /// 登录预热地址检查：只接受空值或官方 SSO 地址，而且必须逐字相等。
    public static func allowedWarmupUrl(_ raw: String?) -> Bool {
        guard let raw = raw else { return true }
        return raw == leaveSSO
    }

    // 对应 MainActivity.allowedNav：请假 WebView 的导航白名单（大小写不敏感）。
    /// 请假页导航白名单：xgxt 只走 443，CAS 可以走 443 或 9443；大小写不敏感。
    public static func allowedNav(_ raw: String?) -> Bool {
        guard let raw = raw else { return false }
        guard raw.utf16.count <= maximumURLUTF16Length else { return false }
        guard raw.contains("\\") == false else { return false }
        guard containsControlCharacter(raw) == false else { return false }
        guard let parsed = parse(raw) else { return false }
        guard parsed.scheme.lowercased() == "https" else { return false }
        guard parsed.userInfo == nil else { return false }
        guard let host = parsed.host else { return false }
        let normalizedHost = host.lowercased()
        if normalizedHost == "xgxt.juwp.edu.cn" { return parsed.port == nil || parsed.port == 443 }
        if normalizedHost == "eapp2.juwp.edu.cn" || normalizedHost == "eapp2.nit.edu.cn" {
            return parsed.port == nil || parsed.port == 443 || parsed.port == 9443
        }
        return false
    }

    // 学校 WebView 导航（SchoolClient.java:14）：host 在 HOSTS 内且 scheme 为 http/https。
    // 本实现按字面大小写敏感比较（fail-closed）。Android Uri 是否规范化大小写尚未真机对拍；
    // P2 若发现学校的大写重定向被误拦，再改为忽略大小写并同步更新 selfCheck。
    // 额外加严：userInfo 与控制字符一律拒绝。
    /// 学校页导航白名单：域名必须在 5 个学校域名里，协议只允许 http/https。
    /// 这里故意严格区分大小写：宁可挡住一次大写重定向，也不放进来路不明的站点。
    public static func allowedSchoolNav(_ raw: String?) -> Bool {
        guard let raw = raw else { return false }
        guard raw.contains("\\") == false else { return false }
        guard containsControlCharacter(raw) == false else { return false }
        guard let parsed = parse(raw) else { return false }
        guard parsed.userInfo == nil else { return false }
        guard parsed.scheme == "http" || parsed.scheme == "https" else { return false }
        guard let host = parsed.host else { return false }
        return hosts.contains(host)
    }

    // 对应 MainActivity.isXgxtUrl（大小写不敏感，不校验端口 / userInfo，逐条一致）。
    /// 判断是不是请假系统（xgxt）的 https 地址；只看协议和域名，不看端口和路径。
    public static func isXgxtUrl(_ raw: String?) -> Bool {
        guard let raw = raw, let parsed = parse(raw) else { return false }
        guard parsed.scheme.lowercased() == "https" else { return false }
        guard let host = parsed.host else { return false }
        return host.lowercased() == "xgxt.juwp.edu.cn"
    }

    // 对应 MainActivity.isCasUrl（大小写不敏感，不校验端口 / userInfo，逐条一致）。
    /// 判断是不是 CAS 统一身份认证地址；学校有两个 CAS 域名，两个都认。
    public static func isCasUrl(_ raw: String?) -> Bool {
        guard let raw = raw, let parsed = parse(raw) else { return false }
        guard parsed.scheme.lowercased() == "https" else { return false }
        guard let host = parsed.host else { return false }
        let normalizedHost = host.lowercased()
        return normalizedHost == "eapp2.juwp.edu.cn" || normalizedHost == "eapp2.nit.edu.cn"
    }

    // 对应 MainActivity.isOfficePath：xgxt 且路径含 "/office/"。
    /// 判断是不是请假系统的 /office/ 业务页面；只有这里才会出现请假表单。
    public static func isOfficePath(_ raw: String?) -> Bool {
        guard let raw = raw, isXgxtUrl(raw) else { return false }
        guard let parsed = parse(raw) else { return false }
        return parsed.path.contains("/office/")
    }

    // SSO 入口页判定（schoolSSOEntryURL 及 CAS 回跳的 http://jiaowu.juwp.edu.cn/sso.jsp）。
    // 只用于状态机区分「入口不可达」与普通学校页面失败，不改变导航白名单。
    /// 判断是不是统一身份认证入口 /sso.jsp；用来区分「认证入口打不开」和普通学校页失败。
    public static func isSSOEntryURL(_ raw: String?) -> Bool {
        guard let raw = raw, let parsed = parse(raw) else { return false }
        guard parsed.scheme == "http" || parsed.scheme == "https" else { return false }
        guard parsed.host?.lowercased() == "jiaowu.juwp.edu.cn" else { return false }
        return parsed.path == "/sso.jsp"
    }

    // 对应 SchoolClient.jsxsd（SchoolClient.java:11）：http://jiaowu.juwp.edu.cn:8080/jsxsd/ 。
    /// 判断是不是教务系统的 jsxsd 页面；必须同时满足 http、8080 端口和 /jsxsd/ 路径。
    public static func isAcademicURL(_ raw: String?) -> Bool {
        guard let raw = raw, let parsed = parse(raw) else { return false }
        guard parsed.scheme == "http" else { return false }
        guard parsed.host == "jiaowu.juwp.edu.cn" else { return false }
        guard parsed.port == 8080 else { return false }
        return parsed.path.hasPrefix("/jsxsd/")
    }

    // MARK: - URL 解析（对齐 Android Uri 的相关语义；任何异常一律返回 nil = 拒绝）

    /// 自己解析出来的网址零件；不用系统 URL 是为了把「看不懂就拒绝」牢牢握在手里。
    private struct ParsedURL {
        // 协议名，例如 https；入口网址比较时区分大小写，防止 HTTPS 混过去。
        let scheme: String
        // 域名，例如 xgxt.juwp.edu.cn；解析不出来时是 nil。
        let host: String?
        // 端口号；nil 表示网址没写端口，https 默认走 443。
        let port: Int?
        // 网址里 @ 前面的用户名密码；正常学校网址不该有，出现就拒绝。
        let userInfo: String?
        // 域名后面的路径；入口地址必须以 / 开头才算合法。
        let path: String
    }

    /// 把网址拆成协议、域名、端口、用户信息、路径；任何一步看不懂都返回 nil（拒绝）。
    private static func parse(_ raw: String) -> ParsedURL? {
        if raw.isEmpty { return nil }
        // 学校域名均为 DNS 名称；IPv6 字面量（方括号）不在攻击面内，直接拒绝（fail-closed）。
        if raw.contains("[") || raw.contains("]") { return nil }
        guard let schemeEnd = raw.firstIndex(of: ":") else { return nil }
        let scheme = String(raw[raw.startIndex..<schemeEnd])
        if scheme.isEmpty { return nil }
        let afterScheme = raw.index(after: schemeEnd)
        var rest = String(raw[afterScheme...])
        if rest.hasPrefix("//") == false {
            // "https:/path" 这类没有 authority 的写法：host = nil，由调用方拒绝。
            return ParsedURL(scheme: scheme, host: nil, port: nil, userInfo: nil, path: pathPart(rest))
        }
        rest = String(rest.dropFirst(2))
        var authority = ""
        var cursor = rest.startIndex
        while cursor < rest.endIndex {
            let character = rest[cursor]
            if character == "/" || character == "?" || character == "#" { break }
            authority.append(character)
            cursor = rest.index(after: cursor)
        }
        let remainder = String(rest[cursor...])
        var userInfo: String?
        var hostPort = authority
        if let at = authority.lastIndex(of: "@") {
            userInfo = String(authority[authority.startIndex..<at])
            hostPort = String(authority[authority.index(after: at)...])
        }
        var host = hostPort
        var port: Int?
        if let portSeparator = hostPort.lastIndex(of: ":") {
            host = String(hostPort[hostPort.startIndex..<portSeparator])
            let portText = String(hostPort[hostPort.index(after: portSeparator)...])
            guard let parsedPort = Int(portText), parsedPort >= 0, parsedPort <= 65535 else { return nil }
            port = parsedPort
        }
        if host.isEmpty { return nil }
        return ParsedURL(scheme: scheme, host: host, port: port, userInfo: userInfo, path: pathPart(remainder))
    }

    /// 只取问号/井号前面的路径部分；查询参数和锚点不参与路径判断。
    private static func pathPart(_ text: String) -> String {
        var path = ""
        for character in text {
            if character == "?" || character == "#" { break }
            path.append(character)
        }
        return path
    }

    // 对应 Java 的 c < 0x20 || c == 0x7f（按 UTF-16 码元扫描）。
    /// 检查换行、回车、制表符等控制字符；它们可能把请求头拆行，属于常见攻击手法。
    /// Cookie 值也要做同样的事：票据里混进分号或换行，就能伪造出额外的请求字段。
    private static func containsControlCharacter(_ text: String) -> Bool {
        for unit in text.utf16 where unit < 0x20 || unit == 0x7F {
            return true
        }
        return false
    }

    // MARK: - 纯 Swift 断言（不依赖 XCTest；返回失败项列表，空数组 = 全部通过）

    /// 自带的自检清单：不依赖 XCTest，返回失败项文字；空数组表示所有规则都符合预期。
    public static func selfCheck() -> [String] {
        var failures: [String] = []
        /// 小助手：比较实际值和期望值，不一致就把这条规则记进失败清单。
        func expect(_ name: String, _ actual: Bool, _ expected: Bool) {
            if actual == expected { return }
            failures.append(name + "（期望 " + (expected ? "true" : "false") + "，实际 " + (actual ? "true" : "false") + "）")
        }
        let longOpenURL = "https://xgxt.juwp.edu.cn/" + String(repeating: "a", count: maximumURLUTF16Length)
        let longNavURL = "https://xgxt.juwp.edu.cn/office/" + String(repeating: "a", count: maximumURLUTF16Length)

        // allowedOpenUrl（MainActivity.java:80-90）
        expect("open/合法请假深链", allowedOpenUrl("https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425"), true)
        expect("open/合法列表接口", allowedOpenUrl(leaveListURL), true)
        expect("open/根路径缺斜杠", allowedOpenUrl("https://xgxt.juwp.edu.cn"), false)
        expect("open/http 拒绝", allowedOpenUrl("http://xgxt.juwp.edu.cn/x"), false)
        expect("open/大写 scheme 拒绝", allowedOpenUrl("HTTPS://xgxt.juwp.edu.cn/x"), false)
        expect("open/大写 host 拒绝", allowedOpenUrl("https://XGXT.JUWP.EDU.CN/x"), false)
        expect("open/443 放行", allowedOpenUrl("https://xgxt.juwp.edu.cn:443/x"), true)
        expect("open/非 443 拒绝", allowedOpenUrl("https://xgxt.juwp.edu.cn:8443/x"), false)
        expect("open/非数字端口拒绝", allowedOpenUrl("https://xgxt.juwp.edu.cn:abc/x"), false)
        expect("open/userInfo 拒绝", allowedOpenUrl("https://uid@xgxt.juwp.edu.cn/x"), false)
        expect("open/其他 host 拒绝", allowedOpenUrl("https://evil.example.com/x"), false)
        expect("open/反斜杠拒绝", allowedOpenUrl("https://xgxt.juwp.edu.cn\\x"), false)
        expect("open/换行拒绝", allowedOpenUrl("https://xgxt.juwp.edu.cn/x\ny"), false)
        expect("open/制表符拒绝", allowedOpenUrl("https://xgxt.juwp.edu.cn/x\ty"), false)
        expect("open/超长拒绝", allowedOpenUrl(longOpenURL), false)
        expect("open/空串拒绝", allowedOpenUrl(""), false)
        expect("open/nil 拒绝", allowedOpenUrl(nil), false)

        // allowedWarmupUrl（MainActivity.java:91）
        expect("warmup/nil 放行", allowedWarmupUrl(nil), true)
        expect("warmup/官方 SSO 放行", allowedWarmupUrl(leaveSSO), true)
        expect("warmup/尾斜杠拒绝", allowedWarmupUrl(leaveSSO + "/"), false)
        expect("warmup/空串拒绝", allowedWarmupUrl(""), false)
        expect("warmup/http 拒绝", allowedWarmupUrl("http://xgxt.juwp.edu.cn/sfrz/login343962"), false)

        // allowedNav（MainActivity.java:94-104）
        expect("nav/xgxt 放行", allowedNav("https://xgxt.juwp.edu.cn/office/x"), true)
        expect("nav/xgxt 443 放行", allowedNav("https://xgxt.juwp.edu.cn:443/office/x"), true)
        expect("nav/xgxt 444 拒绝", allowedNav("https://xgxt.juwp.edu.cn:444/office/x"), false)
        expect("nav/CAS 9443 放行", allowedNav(schoolCASLoginURL), true)
        expect("nav/CAS 8443 拒绝", allowedNav("https://eapp2.juwp.edu.cn:8443/cas/login"), false)
        expect("nav/nit CAS 放行", allowedNav("https://eapp2.nit.edu.cn/cas/login"), true)
        expect("nav/大写 host 放行", allowedNav("https://XGXT.JUWP.EDU.CN/office/x"), true)
        expect("nav/http 拒绝", allowedNav("http://xgxt.juwp.edu.cn/x"), false)
        expect("nav/userInfo 拒绝", allowedNav("https://uid@xgxt.juwp.edu.cn/x"), false)
        expect("nav/门户不在请假白名单", allowedNav("https://portal.juwp.edu.cn/"), false)
        expect("nav/教务不在请假白名单", allowedNav("https://jiaowu.juwp.edu.cn:8080/jsxsd/"), false)
        expect("nav/超长拒绝", allowedNav(longNavURL), false)
        expect("nav/反斜杠拒绝", allowedNav("https://xgxt.juwp.edu.cn\\office"), false)

        // allowedSchoolNav（SchoolClient.java:14）
        expect("school/门户 http 放行", allowedSchoolNav(schoolPortalURL), true)
        expect("school/移动教务 http 放行", allowedSchoolNav(schoolMobileURL), true)
        expect("school/教务 8080 放行", allowedSchoolNav("http://jiaowu.juwp.edu.cn:8080/jsxsd/framework/xsMainV.htmlx"), true)
        expect("school/CAS 9443 放行", allowedSchoolNav(schoolCASLoginURL), true)
        expect("school/xgxt 不在白名单", allowedSchoolNav("https://xgxt.juwp.edu.cn/office/x"), false)
        expect("school/仿冒后缀拒绝", allowedSchoolNav("https://portal.juwp.edu.cn.evil.com/"), false)
        expect("school/ftp 拒绝", allowedSchoolNav("ftp://portal.juwp.edu.cn/"), false)
        expect("school/大写 scheme 拒绝", allowedSchoolNav("HTTPS://portal.juwp.edu.cn/"), false)
        expect("school/userInfo 拒绝", allowedSchoolNav("https://uid@portal.juwp.edu.cn/"), false)
        expect("school/nil 拒绝", allowedSchoolNav(nil), false)

        // isXgxtUrl / isCasUrl / isOfficePath / isAcademicURL（MainActivity.java:105-107、SchoolClient.java:11）
        expect("xgxt/合法", isXgxtUrl("https://xgxt.juwp.edu.cn/office/x"), true)
        expect("xgxt/大写 host", isXgxtUrl("https://XGXT.juwp.edu.cn/x"), true)
        expect("xgxt/http 拒绝", isXgxtUrl("http://xgxt.juwp.edu.cn/x"), false)
        expect("xgxt/仿冒后缀拒绝", isXgxtUrl("https://xgxt.juwp.edu.cn.evil.com/x"), false)
        expect("xgxt/nil 拒绝", isXgxtUrl(nil), false)
        expect("cas/合法", isCasUrl(schoolCASLoginURL), true)
        expect("cas/nit 大写", isCasUrl("https://EAPP2.NIT.EDU.CN/cas/login"), true)
        expect("cas/仿冒后缀拒绝", isCasUrl("https://eapp2.juwp.edu.cn.evil.com/cas"), false)
        expect("cas/http 拒绝", isCasUrl("http://eapp2.juwp.edu.cn/cas"), false)
        expect("office/合法", isOfficePath("https://xgxt.juwp.edu.cn/office/data/x"), true)
        expect("office/缺尾斜杠", isOfficePath("https://xgxt.juwp.edu.cn/office"), false)
        expect("office/尾斜杠", isOfficePath("https://xgxt.juwp.edu.cn/office/"), true)
        expect("office/其他 host 拒绝", isOfficePath("https://eapp2.juwp.edu.cn/office/x"), false)
        expect("academic/合法", isAcademicURL("http://jiaowu.juwp.edu.cn:8080/jsxsd/xskb/xskb_list.do"), true)
        expect("academic/缺端口", isAcademicURL("http://jiaowu.juwp.edu.cn/jsxsd/xskb/xskb_list.do"), false)
        expect("academic/非 jsxsd 路径", isAcademicURL("http://jiaowu.juwp.edu.cn:8080/other"), false)
        expect("academic/https 拒绝", isAcademicURL("https://jiaowu.juwp.edu.cn:8080/jsxsd/x"), false)
        expect("sso/入口", isSSOEntryURL(schoolSSOEntryURL), true)
        expect("sso/http 回跳", isSSOEntryURL("http://jiaowu.juwp.edu.cn/sso.jsp"), true)
        expect("sso/其他 host 拒绝", isSSOEntryURL("https://portal.juwp.edu.cn/sso.jsp"), false)
        expect("sso/其他路径拒绝", isSSOEntryURL("https://jiaowu.juwp.edu.cn:81/login.jsp"), false)
        expect("sso/nil 拒绝", isSSOEntryURL(nil), false)

        // 常量（MainActivity.java:63-67）
        expect("常量/SSO 地址", leaveSSO == "https://xgxt.juwp.edu.cn/sfrz/login343962", true)
        expect("常量/表单 ID", leaveFormID == "278616", true)
        expect("常量/列表接口", leaveListURL == "https://xgxt.juwp.edu.cn/office/data/approve/apps/forms/fore/user/list", true)
        expect("常量/HOSTS 数量", hosts.count == 5, true)

        return failures
    }
}
