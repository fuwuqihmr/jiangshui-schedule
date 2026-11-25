// 【这个文件干什么】生成“排查日志”：App 版本、系统版本、通知状态，以及最近的白名单日志行。
// 【什么时候会用到它】网页调用 getDiagnostics/exportDiagnostics，或用户反馈问题时导出日志。
// 【它和谁配合】StateStore 的 applog.txt、上课提醒的状态、网页 diagnostics.mjs 的二次过滤。
// 【小白提示】只保留固定格式的“安全行”，不把完整网页内容或个人信息带出去。
import Foundation
import UIKit

/// Port of android/app/src/main/java/cn/local/tomorrow/Diagnostics.java.
/// Events are filtered by the same allow list; the web formatter filters again before export.
/// 诊断信息读取器：把本机状态整理成 JSON 字符串，供网页显示或导出。
final class DiagnosticsService: DiagnosticsRecording {
    private let state: StateStoring
    private let reminders: ClassReminding
    private let systemVersion: String

    /// 注入日志存储和提醒服务；系统版本在创建时读一次，之后不变。
    init(state: StateStoring, reminders: ClassReminding) {
        self.state = state
        self.reminders = reminders
        self.systemVersion = UIDevice.current.systemVersion
    }

    /// 汇总诊断 JSON：platform/appVersion/systemVersion/androidApi/notificationStatus/events。
    /// 编码失败时返回 "{}"，保证网页不会因为一个坏字符而崩掉。
    func read() -> String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        var result: JSONObject = [:]
        // The web formatter only understands android/windows/browser; iOS data shows as browser.
        result["platform"] = "ios"
        result["appVersion"] = version
        result["systemVersion"] = systemVersion
        result["androidApi"] = 0
        let notificationStatus: JSONObject = reminders.status().optObject("notificationStatus") ?? [:]
        result["notificationStatus"] = notificationStatus
        // Android reports the WebView engine version; WKWebView does not expose an equivalent.
        let events = readEvents()
        result["events"] = events
        guard let data = JSONCompat.jsonData(result), let text = String(data: data, encoding: .utf8) else { return "{}" }
        return text
    }

    /// 记录网页上报的导入错误；kind 必须是白名单，状态码必须在 0..599。
    /// 参数不合法会抛“排查记录无效”，避免把任意文本写进日志。
    func record(kind: String, httpStatus: Int) throws {
        let allowed = ["http", "cancelled", "session", "timeout", "structure", "network", "other"]
        guard allowed.contains(kind), httpStatus >= 0, httpStatus <= 599 else {
            throw BridgeFailure.message("排查记录无效")
        }
        state.log("import-error kind=" + kind + " http-status=" + String(httpStatus))
    }

    /// 从 applog.txt 末尾读最多 128KB，按行过滤；文件不存在或读失败就返回空数组。
    private func readEvents() -> [String] {
        guard let directory = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false) else { return [] }
        let url = directory.appendingPathComponent("applog.txt")
        guard let handle = try? FileHandle(forReadingFrom: url) else { return [] }
        defer { try? handle.close() }
        let length = (try? handle.seekToEnd()) ?? 0
        let offset = length > 131072 ? length - 131072 : 0
        do { try handle.seek(toOffset: offset) } catch { return [] }
        let data = handle.readDataToEndOfFile()
        guard let text = String(data: data, encoding: .utf8) else { return [] }
        var lines: [String] = []
        for raw in text.components(separatedBy: CharacterSet.newlines) {
            let line = raw
            if line.isEmpty || line.count > 600 { continue }
            if matchesAllowList(line) {
                lines.append(line)
                continue
            }
            if let normalized = normalizeProfileRead(line) { lines.append(normalized) }
        }
        return lines
    }

    /// 用一条大正则匹配“允许离开设备”的固定格式日志，和 Android 的白名单保持一致。
    private func matchesAllowList(_ line: String) -> Bool {
        // Same alternation as Diagnostics.java: only fixed scalar records leave the device.
        let pattern = "(?:school-page http-error=\\d{3}|school-page network-error=-?\\d+|read-start background=(?:true|false) profile-known=(?:true|false)|read-failed background=(?:true|false)|school-login (?:awaiting-user|accepted)|school-session expired; recovery-used=(?:true|false)|school-session tgc-expired|school-ssl-error page=(?:portal|school-login|academic-home|timetable|academic|mobile-academic|school)|session-cookie-state tgc=(?:true|false) academic=(?:true|false)|session-cookie-restore tgc=(?:true|false) academic=(?:true|false)|session-cookie-restored name=(?:tgc|academic)|session-store (?:read-failed|write-failed|clear-failed)|session-renewal start reason=(?:expired-school-cookie|missing-school-cookie)|session-renewal reached-academic-home|session-renewal failed reason=repeat|web-read ok weeks=\\d+ rows=\\d+ elapsed-ms=\\d+ sso=(?:true|false) background=(?:true|false)|reader-selection semester=(?:\\d{4}-\\d{4}-[12]|unknown) mode-known=(?:true|false) calendar-cached=(?:true|false)|school-page (?:http-error=\\d{3}|network-error=-?\\d+) page=(?:portal|school-login|academic-home|timetable|academic|mobile-academic|school) method=(?:GET|POST|OTHER)|reader-error stage=(?:weeks|courses|unknown) http-status=\\d{1,3} kind=(?:http|session|timeout|format|other)|import-error kind=(?:http|cancelled|session|timeout|structure|network|other) http-status=\\d{1,3})"
        let full = "^\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2} " + pattern + "$"
        return line.range(of: full, options: .regularExpression) != nil
    }

    /// 把带 path=... 的 profile-read 行削成固定格式，去掉可能含个人信息的路径。
    private func normalizeProfileRead(_ line: String) -> String? {
        let pattern = "^(\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}) profile-read recognized=(true|false) links=(\\d+)(?: path=.*)?$"
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(location: 0, length: (line as NSString).length)
        guard let match = expression.firstMatch(in: line, options: [], range: range) else { return nil }
        guard match.numberOfRanges >= 4 else { return nil }
        let stamp = (line as NSString).substring(with: match.range(at: 1))
        let recognized = (line as NSString).substring(with: match.range(at: 2))
        let links = (line as NSString).substring(with: match.range(at: 3))
        return stamp + " profile-read recognized=" + recognized + " links=" + links
    }
}