// 【这个文件干什么】把课表写成手机系统日历里的事件，也能把之前写入的事件删掉。
// 【什么时候会用到它】网页点“同步到日历”“移除日历事件”“检查日历权限”时。
// 【它和谁配合】iOS 的 EventKit（系统日历框架）、网页的 calendar 按钮。
// 【小白提示】相当于让 App 当“抄写员”，把课程一条条抄进系统日历；不会反过来改课表。
// 【注意】iOS 的日历事件 ID 是字符串，Android 是数据库行号；JSON 字段形状仍保持一致。
import Foundation
import EventKit

/// Port of android/app/src/main/java/cn/local/tomorrow/CalendarSync.java.
/// Android talks to a system calendar provider; iOS uses EventKit. The JSON shape and CALENDAR_*
/// codes are preserved. eventIds are EKEvent.eventIdentifier strings, not Android row ids.
/// 系统日历同步器：检查权限、创建“江水课表”日历、按事件去重写入/删除。
final class CalendarService: CalendarSyncing {
    // 在系统日历里新建的日历名字；用户会在日历 App 的账户列表里看到它。
    static let calendarName = "江水课表"
    // 课程时间统一按北京时间解释，避免手机时区变化后课程漂移。
    static let timeZoneName = "Asia/Shanghai"
    // 一次最多写 5000 条课程；超过就拒绝，防止网页传异常数据把系统日历塞爆。
    static let eventLimit = 5000

    // EventKit 的入口对象，所有日历/事件操作都通过它完成。
    private let store = EKEventStore()
    private let defaults: UserDefaults
    // UserDefaults 键：记录是否弹过权限框、上次写入的事件 ID、日历 ID 和同步统计。
    private let askedKey = "calendar-sync.permissionAsked"
    private let idsKey = "calendar-sync.eventIds"
    private let calendarIdKey = "calendar-sync.calendarId"
    private let lastSyncKey = "calendar-sync.lastSyncAt"
    private let lastCountKey = "calendar-sync.lastEventCount"
    private let lastSemesterKey = "calendar-sync.lastSemesterId"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: - Status

    /// 返回日历状态：是否可用/可写、权限、上次同步时间、事件数、学期和日历 ID。
    func status() -> JSONObject {
        let calendar = findCalendar()
        let permission = permissionState()
        return ["available": true,
                "writable": calendar?.allowsContentModifications ?? false,
                "permission": permission,
                "lastSyncAt": textOrNull(defaults.string(forKey: lastSyncKey)),
                "lastEventCount": defaults.integer(forKey: lastCountKey),
                "lastSemesterId": textOrNull(defaults.string(forKey: lastSemesterKey)),
                "calendarId": textOrNull(calendar?.calendarIdentifier)]
    }

    /// 构造 Android 同款错误对象 {ok:false, code, message}，网页按 code 做判断。
    func error(code: String, message: String) -> JSONObject {
        return ["ok": false, "code": code, "message": message]
    }

    // MARK: - Sync

    /// 同步课表：先校验最多 5000 条和每条字段，再申请权限、找/建日历。
    /// 然后删掉上次写入的旧事件，逐条写入新事件；中途失败会尽量回滚已写部分。
    /// 成功返回 written/deleted/failed/skipped/calendarId/lastSyncAt/lastEventCount。
    func sync(payload: JSONObject) async throws -> JSONObject {
        let eventsValue = payload["events"]
        guard let rows = JSONCompat.array(eventsValue), rows.count <= CalendarService.eventLimit else {
            return error(code: "CALENDAR_INVALID_EVENT", message: "写入数据无效或课程数量过多")
        }
        var parsed: [RawEvent] = []
        for row in rows {
            guard let object = JSONCompat.object(row) else {
                return error(code: "CALENDAR_INVALID_EVENT", message: "写入数据中有无效课程")
            }
            let title = object.optString("title").trimmingCharacters(in: .whitespacesAndNewlines)
            let location = object.optString("location").trimmingCharacters(in: .whitespacesAndNewlines)
            let description = object.optString("description").trimmingCharacters(in: .whitespacesAndNewlines)
            let start = object.optInt64("startMillis", Int64.min)
            let end = object.optInt64("endMillis", Int64.min)
            if title.isEmpty || javaLength(title) > 200 || javaLength(location) > 200 ||
                javaLength(description) > 1000 || start == Int64.min || end <= start {
                return error(code: "CALENDAR_INVALID_EVENT", message: "写入数据中有无效课程")
            }
            parsed.append(RawEvent(title: title, location: location, notes: description, start: start, end: end))
        }
        let semesterId = payload.optString("semesterId")

        guard await ensureAccess(writeMessage: "需要日历权限才能写入，请在系统设置中允许") else {
            return error(code: "CALENDAR_PERMISSION_DENIED", message: "需要日历权限才能写入，请在系统设置中允许")
        }
        guard let calendar = ensureCalendar() else {
            return error(code: "CALENDAR_UNAVAILABLE", message: "本机没有可用的系统日历应用")
        }
        guard calendar.allowsContentModifications else {
            return error(code: "CALENDAR_NOT_WRITABLE", message: "系统日历当前不可写，请换一个本地日历账户")
        }

        let oldIds = savedEventIds()
        let removal = removeEvents(oldIds)
        if removal.failed > 0 {
            saveEventIds(removal.remaining)
            return errorWithCounts(code: "CALENDAR_WRITE_FAILED",
                                   message: "清理旧事件失败：成功 " + String(removal.success) + " 条，失败 " +
                                       String(removal.failed) + " 条，请稍后重试",
                                   written: 0, deleted: removal.success, failed: removal.failed,
                                   extra: ["remainingEventIds": removal.remaining.count])
        }

        var writtenIds: [String] = []
        for event in parsed {
            guard let stored = makeEvent(event, calendar: calendar) else {
                let rollback = removeEvents(writtenIds)
                _ = rollback
                return error(code: "CALENDAR_WRITE_FAILED", message: "写入系统日历失败，请稍后重试")
            }
            writtenIds.append(stored)
        }
        let syncAt = CalendarService.timestamp()
        defaults.set(writtenIds, forKey: idsKey)
        defaults.set(calendar.calendarIdentifier, forKey: calendarIdKey)
        defaults.set(syncAt, forKey: lastSyncKey)
        defaults.set(writtenIds.count, forKey: lastCountKey)
        defaults.set(semesterId, forKey: lastSemesterKey)
        _ = defaults.synchronize()
        return ["ok": true, "written": writtenIds.count, "deleted": removal.success, "failed": 0, "skipped": 0,
                "calendarId": calendar.calendarIdentifier, "lastSyncAt": syncAt,
                "lastEventCount": writtenIds.count]
    }

    /// 移除上次同步写入的所有事件；部分失败会保留失败的事件 ID，方便下次重试。
    func remove() async throws -> JSONObject {
        guard await ensureAccess(writeMessage: "需要日历权限才能移除，请在系统设置中允许") else {
            return error(code: "CALENDAR_PERMISSION_DENIED", message: "需要日历权限才能移除，请在系统设置中允许")
        }
        let ids = savedEventIds()
        let result = removeEvents(ids)
        let calendarId = textOrNull(findCalendar()?.calendarIdentifier)
        if result.failed > 0 {
            saveEventIds(result.remaining)
            defaults.set(result.remaining.count, forKey: lastCountKey)
            var value = errorWithCounts(code: "CALENDAR_WRITE_FAILED",
                                        message: "移除部分失败：成功 " + String(result.success) + " 条，失败 " +
                                            String(result.failed) + " 条，请稍后重试",
                                        written: 0, deleted: result.success, failed: result.failed,
                                        extra: ["removed": result.success, "remaining": result.failed])
            value["calendarId"] = calendarId
            return value
        }
        saveEventIds([])
        defaults.removeObject(forKey: lastSyncKey)
        defaults.set(0, forKey: lastCountKey)
        defaults.removeObject(forKey: lastSemesterKey)
        _ = defaults.synchronize()
        return ["ok": true, "removed": result.success, "failed": 0, "calendarId": calendarId,
                "lastSyncAt": NSNull(), "lastEventCount": 0]
    }

    // MARK: - Permission

    /// 把 EventKit 的数字权限状态翻译成网页认识的 granted/denied/prompt。
    /// 0 是“还没问过”；如果问过但仍是 0，就按 denied 处理，避免网页反复弹框。
    private func permissionState() -> String {
        let raw = EKEventStore.authorizationStatus(for: .event).rawValue
        // EKAuthorizationStatus: 0 notDetermined, 1 restricted, 2 denied, 3 authorized, 4 fullAccess, 5 writeOnly.
        if raw == 3 || raw == 4 { return "granted" }
        if raw == 1 || raw == 2 { return "denied" }
        return defaults.bool(forKey: askedKey) ? "denied" : "prompt"
    }

    /// 是否已拿到日历读写权限；3=authorized，4=fullAccess。
    private func authorized() -> Bool {
        let raw = EKEventStore.authorizationStatus(for: .event).rawValue
        return raw == 3 || raw == 4
    }

    /// 是否被用户拒绝或受系统限制；1=restricted，2=denied。
    private func denied() -> Bool {
        let raw = EKEventStore.authorizationStatus(for: .event).rawValue
        return raw == 1 || raw == 2
    }

    /// 确保有日历权限：已授权直接放行，已拒绝返回 false，没问过才弹系统框。
    /// 这里用 continuation 把老式回调包成 async/await，调用方可以直接 await。
    private func ensureAccess(writeMessage: String) async -> Bool {
        if authorized() { return true }
        if denied() { return false }
        defaults.set(true, forKey: askedKey)
        return await withCheckedContinuation { continuation in
            // iOS 16 API. requestFullAccessToEvents is the iOS 17 replacement, but the deployment
            // target is iOS 16 so requestAccess(to:) is the supported call here.
            store.requestAccess(to: .event) { granted, _ in
                continuation.resume(returning: granted)
            }
        }
    }

    // MARK: - Calendars / events

    /// 找本机“本地账户”下名为“江水课表”的日历；找不到返回 nil。
    private func findCalendar() -> EKCalendar? {
        let calendars = store.calendars(for: .event)
        for calendar in calendars {
            if calendar.title == CalendarService.calendarName && calendar.source.sourceType == .local {
                return calendar
            }
        }
        return nil
    }

    /// 找已有日历，找不到就新建一个本地日历；没有本地账户或保存失败返回 nil。
    private func ensureCalendar() -> EKCalendar? {
        if let existing = findCalendar() { return existing }
        guard let source = store.sources.first(where: { $0.sourceType == .local }) else { return nil }
        let calendar = EKCalendar(for: .event, eventStore: store)
        calendar.title = CalendarService.calendarName
        calendar.source = source
        do {
            try store.saveCalendar(calendar, commit: true)
            return calendar
        } catch {
            return nil
        }
    }

    /// 把一条课程写进系统日历，成功返回事件 ID；失败返回 nil，由上层决定回滚。
    private func makeEvent(_ raw: RawEvent, calendar: EKCalendar) -> String? {
        let event = EKEvent(eventStore: store)
        event.calendar = calendar
        event.title = raw.title
        event.location = raw.location
        event.notes = raw.notes
        event.startDate = Date(timeIntervalSince1970: Double(raw.start) / 1000)
        event.endDate = Date(timeIntervalSince1970: Double(raw.end) / 1000)
        event.timeZone = TimeZone(identifier: CalendarService.timeZoneName)
        do {
            try store.save(event, span: .thisEvent, commit: true)
            return event.eventIdentifier
        } catch {
            return nil
        }
    }

    /// 按事件 ID 批量删除；已经不存在的算“删成功”，和 Android 的宽容语义一致。
    /// 返回成功数、失败数和仍需重试的 ID。
    private func removeEvents(_ ids: [String]) -> (success: Int, failed: Int, remaining: [String]) {
        var success = 0
        var failed = 0
        var remaining: [String] = []
        for identifier in ids {
            guard let event = store.event(withIdentifier: identifier) else {
                // Already gone counts as removed, matching Android's "deleted 0 rows is fine".
                success += 1
                continue
            }
            do {
                try store.remove(event, span: .thisEvent, commit: true)
                success += 1
            } catch {
                failed += 1
                remaining.append(identifier)
            }
        }
        return (success: success, failed: failed, remaining: remaining)
    }

    /// 从 UserDefaults 读上次写入的事件 ID 列表；没有就返回空数组。
    private func savedEventIds() -> [String] {
        guard let array = defaults.array(forKey: idsKey) else { return [] }
        return array.compactMap { $0 as? String }
    }

    /// 记住本次写入的事件 ID，下次同步时先删这些旧事件，避免重复。
    private func saveEventIds(_ ids: [String]) {
        defaults.set(ids, forKey: idsKey)
    }

    /// 在错误对象上附加 written/deleted/failed 等计数，方便网页显示“成功几条、失败几条”。
    private func errorWithCounts(code: String, message: String, written: Int, deleted: Int, failed: Int,
                                 extra: [String: Int]) -> JSONObject {
        var value = error(code: code, message: message)
        value["written"] = written
        value["deleted"] = deleted
        value["failed"] = failed
        for (key, number) in extra { value[key] = number }
        return value
    }

    /// 把可选字符串转成 JSON 值：有值用字符串，没值用 NSNull（JSON 的 null）。
    private func textOrNull(_ value: String?) -> Any {
        if let value = value { return value }
        return NSNull()
    }

    /// 按 Java 的规则数长度（UTF-16 单元），保证和 Android 的 200/1000 字符限制一致。
    private func javaLength(_ value: String) -> Int {
        // Java String.length() counts UTF-16 units; keep validation identical for emoji and CJK.
        return value.utf16.count
    }

    /// 生成带毫秒的 ISO8601 时间字符串，例如 2026-10-27T14:05:33.123Z。
    private static func timestamp() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }

    /// 校验通过后的一条课程，字段已经转成写入 EventKit 需要的格式。
    private struct RawEvent {
        var title: String
        var location: String
        var notes: String
        var start: Int64
        var end: Int64
    }
}