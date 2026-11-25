// 【这个文件干什么】写「排查日志」：把学校页面相关的关键动作（恢复登录状态、注入脚本失败、
//   网络错误…）按时间追加进手机里的一个文本文件 applog.txt，出问题时可以导出分析。
// 【什么时候会用到它】读取课表失败、登录态恢复异常、页面打不开时会调用；正常使用不打扰你。
// 【它和谁配合】SchoolReadController / SchoolWebViewHost 出错时叫它写一行；设置页的「导出
//   诊断日志」再从同一个文件里挑白名单行，所以这里写的前缀词必须和那套规则对得上。
//   日志只存在本机，位置是 App 私有的「应用支持」目录，卸载 App 就一起清空。
// 【为什么过滤】写入前会去掉换行、截断到 480 字、并把网址参数抹掉，免得一条日志撑爆文件，
//   或者把不该外传的东西（学号、票据）带进导出文件。
import Foundation

// 学校线诊断日志。
//
// 为什么不复用 StateStore.log：Services/StateStore.swift 属于另一条写作用域，本任务只允许改
// ios/Jiangshui/School/**；这里按完全相同的 applog.txt 路径与 "MM-dd HH:mm:ss" 前缀追加，
// 便于设置页导出时与既有日志合并。以后若统一日志器，可把本文件替换成一次转发，不影响调用方。
//
// 输出的前几类固定行（session-cookie-state / session-cookie-restore / session-store ... /
// reader-error / school-page network-error）与 DiagnosticsService.matchesAllowList 的现有模式
// 完全一致，保证真机导出的日志里能看到；带 domain/message 的详细行只留在本机 applog.txt。
/// 学校线日志的「记账员」：所有方法都是「往 applog.txt 追加一行」，写不了就静默放弃、
/// 不会报错，所以调用方可以放心在错误分支里随手调用，不用处理返回值。
enum SchoolDiagnosticLog {

    // 单行最长 480 字：日志是给人看的，太长没人读、导出也慢，超长直接截断。
    private static let maxLineLength = 480

    /// 往 applog.txt 追加一行，自动加「月-日 时:分:秒」前缀。
    /// 目录不存在会先创建；任何一步失败都安静放弃——诊断日志坏了绝不能影响主流程。
    static func write(_ line: String) {
        let cleaned = sanitize(line)
        guard cleaned.isEmpty == false else { return }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "MM-dd HH:mm:ss"
        let text = formatter.string(from: Date()) + " " + cleaned + "\n"
        guard let data = text.data(using: .utf8) else { return }
        let fileManager = FileManager.default
        guard let directory = try? fileManager.url(for: .applicationSupportDirectory,
                                                   in: .userDomainMask,
                                                   appropriateFor: nil,
                                                   create: true) else { return }
        let url = directory.appendingPathComponent("applog.txt")
        if fileManager.fileExists(atPath: url.path) == false {
            try? data.write(to: url, options: [])
            return
        }
        guard let handle = try? FileHandle(forWritingTo: url) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
    }

    // 下面这批叫「固定白名单行」：设置页导出时只保留事先约定好的开头词（比如 session-cookie-state），
    // 其余详细行留在本机。要改这些词，得先确认导出规则也认得，否则导出文件里会看不到。
    // MARK: - 固定白名单行（可被设置页导出）

    /// 记下「现在手里有没有两种票据」：tgc 是统一身份认证的票据，academic 是教务系统的票据。
    /// 排查登录问题时先看这一行——哪一个 false，就知道该重新登录哪一层。
    static func cookieState(tgc: Bool, academic: Bool) {
        write("session-cookie-state tgc=\(flag(tgc)) academic=\(flag(academic))")
    }

    /// 记录本次启动时「从保险箱（Keychain，iOS 存密码/票据的加密仓库）恢复到了哪些票据」。
    static func cookieRestore(tgc: Bool, academic: Bool) {
        write("session-cookie-restore tgc=\(flag(tgc)) academic=\(flag(academic))")
    }

    /// 记录某一张票据恢复成功。只认 tgc / academic 两个名字，别的名字直接忽略（防止拼错混进日志）。
    static func cookieRestored(name: String) {
        guard name == "tgc" || name == "academic" else { return }
        write("session-cookie-restored name=\(name)")
    }

    /// 保险箱读取失败：先写一行固定的失败标记，再写一行带具体原因（domain/code/message）。
    static func sessionStoreReadFailed(_ error: Error) {
        write("session-store read-failed")
        write("session-store-read-error " + shortError(error))
    }

    /// 保险箱写入失败（比如保存票据时出错），同样写两行：标记行 + 原因行。
    static func sessionStoreWriteFailed(_ error: Error) {
        write("session-store write-failed")
        write("session-store-write-error " + shortError(error))
    }

    /// 记录开始「续期登录」：reason 只允许 missing-school-cookie（本地没票据）或
    /// expired-school-cookie（票据过期被学校拒绝），其它值一律记成后者。
    static func sessionRenewalStart(reason: String) {
        let allowed = reason == "missing-school-cookie" ? "missing-school-cookie" : "expired-school-cookie"
        write("session-renewal start reason=\(allowed)")
    }

    /// 续期又被触发了一次，说明上一次续期没救回来——这条是「反复失败」的证据。
    static func sessionRenewalRepeat() {
        write("session-renewal failed reason=repeat")
    }

    /// 统一身份认证的票据被学校判定过期了，需要重新走一次登录。
    static func tgcExpired() {
        write("school-session tgc-expired")
    }

    // MARK: - 注入 / 导航失败（C 项：下一轮真机能确认 WKErrorDomain）

    /// 网页里那段读取脚本没能跑起来（注入失败）时记账：stage 是阶段，attempt 是第几次尝试，
    /// error 是 WebKit 给的错误。这里特意把错误码塞进 http-status 字段，是为了让设置页的白名单
    /// 规则能认出来——真机上就靠它区分是哪一类 WebKit 错误。
    static func readerInjectionFailed(stage: String, attempt: Int, error: NSError) {
        let normalizedStage: String
        if stage == "weeks" || stage == "courses" {
            normalizedStage = stage
        } else {
            normalizedStage = "unknown"
        }
        let status = min(599, abs(error.code))
        write("reader-error stage=\(normalizedStage) http-status=\(status) kind=other")
        write("reader-inject-failed stage=\(normalizedStage) attempt=\(attempt)"
            + " domain=\(error.domain) code=\(error.code) message=\(error.localizedDescription)")
    }

    /// 学校页面打不开（断网、域名解析失败、被系统拦）时记账：phase 表示卡在哪一步，
    /// url 会先「抹掉参数」再写，避免把票据带进日志。
    static func navigationFailed(phase: String, error: NSError, url: String?) {
        // 白名单只接受 page=school 的 network-error 行；入口/CAS 的具体阶段留在下一行。
        write("school-page network-error=\(error.code) page=school method=GET")
        write("school-nav-failed phase=\(phase) domain=\(error.domain) code=\(error.code)"
            + " url=\(redactedURL(url)) message=\(error.localizedDescription)")
    }

    // MARK: - 工具

    /// 把 true/false 变成小写文字，写进日志里格式统一、好搜。
    private static func flag(_ value: Bool) -> String {
        return value ? "true" : "false"
    }

    /// 把任意错误压成「domain=… code=… message=…」一句话，一眼看出是哪一层出的问题。
    private static func shortError(_ error: Error) -> String {
        let nsError = error as NSError
        return "domain=\(nsError.domain) code=\(nsError.code) message=\(nsError.localizedDescription)"
    }

    /// 把网址洗一遍：只留「协议 + 域名 + 端口 + 路径」，问号后面的参数（常含票据、学号）全丢掉。
    private static func redactedURL(_ raw: String?) -> String {
        guard let raw = raw, let url = URL(string: raw) else { return "" }
        let scheme = url.scheme ?? ""
        let host = url.host ?? ""
        let port = url.port == nil ? "" : ":" + String(url.port ?? 0)
        return scheme + "://" + host + port + url.path
    }

    /// 单行化 + 截断：回车/换行/制表符都换成空格，防止一条日志被拆成多行；超长就截到 480 字。
    private static func sanitize(_ raw: String) -> String {
        let flattened = raw.replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\t", with: " ")
        if flattened.count <= maxLineLength { return flattened }
        return String(flattened.prefix(maxLineLength))
    }
}
