// 【这个文件干什么】把学校请假接口返回的一大坨 JSON，削成 App 能直接显示的固定字段。
// 【什么时候会用到它】请假、销假、续假三种记录同步时；三种表单位置不同，但字段形状一样。
// 【它和谁配合】LeaveRecordsService 负责发网络请求，本文件只负责「解析 + 清洗」，不碰网络和界面。
// 【为什么单独拆出来】三种表单的标签和状态词表在 v1.5.0 有变化，集中放在这里避免主文件超长。
// 【安全边界】只读学校返回的字段，不执行网页脚本，也不拼 URL；解析失败统一回 PARSE。
import Foundation

// 学校请假/销假/续假的记录解析器（P3，对齐 Android v1.5.0 MainActivity.java:731-785）。
//
// 字段名与 Android leaveTrimmedRecord 逐字一致：
// id / status / statusText / statusId / typeText / reason / startAt / endAt /
// submittedAt / approver / number / durationDays，另外补 Android 在 fetchLeaveRecords
// 里统一追加的 type（leave / cancel / renew）。
//
// 本机 Windows 无 Xcode/swiftc，未编译；解析规则只能用静态检查与真机日志验证。
/// 请假记录解析器：只做纯函数转换，不持有状态，方便单元测试与复用。
enum LeaveRecordParser {

    /// 解析接口响应：成功回 {ok:true, fetchedAt, records}，结构不对回 {ok:false, code:"PARSE"}。
    static func parse(_ data: Data, type: String) -> JSONObject {
        guard let decoded = try? JSONSerialization.jsonObject(with: data, options: []),
              let root = JSONCompat.object(decoded) else {
            return error("PARSE")
        }
        let dataObject = root.optObject("data")
        guard let list = dataObject?.optArray("formsUserList") else { return error("PARSE") }
        var records: [Any] = []
        for element in list {
            guard let item = JSONCompat.object(element) else { continue }
            if let record = trimmedRecord(item, type: type) { records.append(record) }
        }
        return ["ok": true, "fetchedAt": SchoolSession.nowMilliseconds(), "records": records]
    }

    /// 把一张表单削成固定字段；没有单号（id/autoId）的脏数据直接丢掉。
    static func trimmedRecord(_ item: JSONObject, type: String) -> JSONObject? {
        var identifier = item.optString("id").trimmed
        if identifier.isEmpty { identifier = item.optString("autoId").trimmed }
        if identifier.isEmpty { return nil }
        let fields = formFields(item)
        let statusText = item.optString("aprvStatusType").trimmed
        let statusId = item.optString("aprvStatusTypeId").trimmed
        return [
            "id": identifier,
            "status": status(text: statusText, statusId: statusId),
            "statusText": statusText,
            "statusId": statusId,
            "typeText": formValue(fields, ["请假类型", "销假类型", "续假类型"]),
            "reason": formValue(fields, ["请假原因", "销假原因", "续假原因", "离校原因"]),
            "startAt": isoTime(formValue(fields, ["请假开始时间", "销假开始时间", "续假开始时间", "离校时间"])),
            "endAt": isoTime(formValue(fields, ["请假结束时间", "销假结束时间", "续假结束时间", "返校时间"])),
            "submittedAt": submittedAt(item, fields),
            "approver": item.optString("allAprvUserList").trimmed,
            "number": formValue(fields, ["请假编号", "销假编号", "续假编号"]),
            "durationDays": formValue(fields, ["请假时长", "销假时长", "续假时长"]),
            "type": type,
        ]
    }

    /// 学校的动态表单把值放在 formData[].fields[] 里，按中文 label 建索引；同名只取第一个。
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

    /// 按候选标签依次取第一个非空值（Android leaveFormValue）。
    private static func formValue(_ fields: [String: String], _ labels: [String]) -> String {
        for label in labels {
            let value = (fields[label] ?? "").trimmed
            if value.isEmpty == false { return value }
        }
        return ""
    }

    /// 状态文本 → approved / pending / rejected / unknown。
    /// 先判否定再判通过，避免「未通过」命中「通过」；文本为空一律 unknown（v1.5.0 规则）。
    private static func status(text: String, statusId: String) -> String {
        let value = text.trimmed
        if value.isEmpty { return "unknown" }
        if matches(value, "驳回|退回|不通过|未通过|未批准|未同意|未审核通过|未获通过|不予通过|拒绝|不同意") {
            return "rejected"
        }
        if matches(value, "待|审批中|处理中|审核中") { return "pending" }
        if matches(value, "通过|批准|同意|已完成") { return "approved" }
        return "unknown"
    }

    /// 学校时间统一成带 +08:00 的 ISO 字符串；认不出的原样返回，不猜。
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

    /// 申请时间：表单里的「请假/销假/续假申请时间」优先，否则用 inserttime 毫秒按北京时间换算。
    private static func submittedAt(_ item: JSONObject, _ fields: [String: String]) -> String {
        let fromForm = formValue(fields, ["请假申请时间", "销假申请时间", "续假申请时间", "申请时间"])
        if fromForm.isEmpty == false { return isoTime(fromForm) }
        let raw = item.optString("inserttime").trimmed
        guard let milliseconds = Int64(raw), milliseconds > 0 else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 8 * 60 * 60)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'+08:00'"
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000.0))
    }

    /// 统一失败暗号；前端只认 code。
    private static func error(_ code: String) -> JSONObject {
        return ["ok": false, "code": code]
    }

    /// 正则匹配封装，避免每处都写 options。
    private static func matches(_ value: String, _ pattern: String) -> Bool {
        return value.range(of: pattern, options: .regularExpression) != nil
    }
}

/// 去掉首尾空白；学校接口的值经常带多余空格/换行。
private extension String {
    var trimmed: String { return trimmingCharacters(in: .whitespacesAndNewlines) }
}
