// 【这个文件干什么】根据课表安排“上课提醒”，到点由系统发本地通知，并管理提醒的开关/预览/关闭。
// 【什么时候会用到它】保存课表后、网页打开提醒设置、点“预览提醒”、关闭某条提醒时。
// 【它和谁配合】StateStore 里的课表、ScheduleDayResolver 算出的每日课程、系统通知中心。
// 【小白提示】Android 用 AlarmManager 闹钟；iOS 不允许后台随便起闹钟，所以 App 把未来 7 天的提醒一次性交给系统预排。
// 【注意】iOS 没有通知渠道、没有 ongoing 常驻通知；已投递的通知到期后靠 reconcile/BGTask 清理，
// 系统不保证 BGTask 准时，可能延后或完全不执行。
import Foundation
import UIKit
import UserNotifications
import CryptoKit
/// Port of android/app/src/main/java/cn/local/tomorrow/ClassReminders.java and ClassReminderPlan.java.
/// iOS cannot use AlarmManager; ClassReminderService pre-schedules one UNCalendarNotificationTrigger for
/// every event in the next 7 days, and uses BGAppRefreshTask as a best-effort cleanup. There is no
/// notification channel, no timeoutAfter and no ongoing status: a delivered notification is removed on
/// the next reconcile / background task once its expiresAt has passed.
/// 上课提醒管家：算出哪些课该提醒、把通知排进系统、记录哪些已提醒/已关闭。
final class ClassReminderService: ClassReminding {
    // 所有课程提醒的通知 ID 都加这个前缀，便于和“通知测试”等其他通知区分、批量取消。
    static let prefix = "class/"
    // 依赖课表存储、同意记录、UserDefaults（记提醒账本）和系统通知中心。
    private let state: StateStoring
    private let consent: ConsentStoring
    private let defaults: UserDefaults
    private let center = UNUserNotificationCenter.current()
    init(state: StateStoring, consent: ConsentStoring) {
        self.state = state
        self.consent = consent
        self.defaults = UserDefaults.standard
    }
    // MARK: - Settings
    /// 提醒设置：总开关、提前多少分钟提醒、上课后多久内仍可提醒。
    private struct Settings {
        var enabled = true
        var leadMinutes = 30
        var afterStartMinutes = 5
    }
    /// 从课表 JSON 的 classReminders 字段读设置；没设置过时默认开启、提前 30 分钟。
    private func settings(_ state: JSONObject?) -> Settings {
        var result = Settings()
        guard let object = state?.optObject("classReminders") else { return result }
        let preferenceSet = state?.optBool("classReminderPreferenceSet", false) ?? false
        result.enabled = preferenceSet == false || object.optBool("enabled", false)
        result.leadMinutes = minutes(object, "leadMinutes", 30, 180)
        result.afterStartMinutes = minutes(object, "afterStartMinutes", 5, 120)
        return result
    }
    /// 读取分钟数并限制范围；超出范围或不是数字就用默认值，防止网页传入负数。
    private func minutes(_ object: JSONObject, _ key: String, _ fallback: Int, _ maximum: Int) -> Int {
        guard let value = JSONCompat.int(object[key]) else { return fallback }
        if value < 0 || value > maximum { return fallback }
        return value
    }
    // MARK: - Events
    /// 一条“已排好时间”的提醒事件：课程信息 + 开始/结束/显示/过期时间（毫秒）。
    struct Event {
        var course: DayCourse
        var id: String
        var showAt: Int64
        var startAt: Int64
        var endAt: Int64
        var expiresAt: Int64
        /// 当前时刻是否落在“该显示提醒”的窗口内。
        func active(_ now: Int64) -> Bool { return showAt <= now && now < expiresAt }
        /// 转成网页要的事件 JSON；字段名与 Android 的 active 事件一致。
        func json() -> JSONObject {
            return ["id": id, "date": course.date, "name": course.name, "room": course.room,
                    "teacher": course.teacher, "startTime": course.start, "endTime": course.end,
                    "startAt": startAt, "showAt": showAt, "expiresAt": expiresAt]
        }
    }
    /// 算出今天前后 8 天（-1..7）的提醒事件：跳过已取消、样例课的普通条目。
    /// showAt = 上课时间 - 提前分钟；expiresAt = 上课时间 + 课后分钟；按开始时间排序。
    private func events(_ state: JSONObject?, _ now: Int64) -> [Event] {
        guard let state = state, let snapshot = state.optObject("snapshot") else { return [] }
        let settingsValue = settings(state)
        guard settingsValue.enabled else { return [] }
        let sourceKind = snapshot.optObject("source")?.optString("kind") ?? ""
        let today = ScheduleDayResolver.dayFormatter().string(from: Date(timeIntervalSince1970: Double(now) / 1000))
        var result: [Event] = []
        for offset in -1...7 {
            let day = ScheduleDayResolver.addDays(today, offset)
            for item in ScheduleDayResolver.effectiveDay(state: state, snapshot: snapshot, date: day) {
                if item.cancelled { continue }
                if sourceKind == "sample" && item.customCourse == false { continue }
                guard let startAt = ScheduleDayResolver.timestamp(day: item.date, time: item.start) else { continue }
                let endAt = ScheduleDayResolver.timestamp(day: item.date, time: item.end) ?? startAt
                let showAt = startAt - Int64(settingsValue.leadMinutes) * 60000
                let expiresAt = startAt + Int64(settingsValue.afterStartMinutes) * 60000
                if expiresAt <= showAt { continue }
                result.append(Event(course: item, id: item.date + "|" + item.key, showAt: showAt,
                                   startAt: startAt, endAt: endAt, expiresAt: expiresAt))
            }
        }
        return result.sorted { left, right in
            if left.startAt != right.startAt { return left.startAt < right.startAt }
            return left.id < right.id
        }
    }
    /// 给事件算一个 SHA256 指纹；内容没变就不重复排通知，避免每次保存都重发。
    /// 指纹里不能放“即将上课/课程进行中”这类会随时间变化的字段，否则预排后每次 reconcile 都会重发。
    private func fingerprint(_ event: Event) -> String {
        let mode = "checked:0:false"
        let value = event.id + "|" + event.course.name + "|" + event.course.room + "|" + event.course.teacher + "|" +
            event.course.start + "|" + event.course.end + "|" + String(event.showAt) + "|" + String(event.startAt) + "|" +
            String(event.endAt) + "|" + String(event.expiresAt) + "|" + mode + "|beta9"
        let digest = SHA256.hash(data: Data(value.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
    /// 算出下一次需要“醒来处理”的时间（明天零点/下条提醒/下课/过期，取最早）。
    private func next(_ events: [Event], _ now: Int64) -> Int64 {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? TimeZone.current
        let startOfTomorrow = calendar.startOfDay(for: Date(timeIntervalSince1970: Double(now) / 1000).addingTimeInterval(86400))
        var result = Int64(startOfTomorrow.timeIntervalSince1970 * 1000)
        for event in events {
            if event.showAt > now { result = min(result, event.showAt) }
            if event.active(now) {
                if event.startAt > now { result = min(result, event.startAt) }
                if event.endAt > now { result = min(result, event.endAt) }
            }
            if event.expiresAt > now { result = min(result, event.expiresAt) }
        }
        return result
    }
    // MARK: - Ledger
    /// 读提醒账本（closed/posted/rendered）；账本存成 UserDefaults 里的 JSON 文本。
    private func ledger(_ key: String) -> JSONObject {
        guard let text = defaults.string(forKey: "class-reminders." + key),
              let data = text.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data, options: []),
              let object = JSONCompat.object(root) else { return [:] }
        return object
    }
    /// 保存提醒账本；编码失败就存 "{}"，保证不会因为一条坏数据卡死。
    private func saveLedger(_ key: String, _ value: JSONObject) {
        defaults.set(JSONCompat.jsonString(value) ?? "{}", forKey: "class-reminders." + key)
    }
    /// 读账本里的毫秒时间戳；没有这个键就当作 0（很早以前）。
    private func ledgerNumber(_ object: JSONObject, _ key: String) -> Int64 {
        return object.optInt64(key, 0)
    }
    /// 清掉账本里已经过期很久的记录，防止 UserDefaults 越存越大。
    private func prune(_ object: inout JSONObject, _ now: Int64) {
        for key in object.keys {
            if ledgerNumber(object, key) <= now { object.removeValue(forKey: key) }
        }
    }
    /// 读“已经排进系统通知中心”的提醒 ID 列表。
    private func scheduled() -> [String] {
        guard let text = defaults.string(forKey: "class-reminders.scheduled"),
              let data = text.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data, options: []),
              let array = JSONCompat.array(root) else { return [] }
        return array.compactMap { JSONCompat.string($0) }
    }
    /// 保存当前已排程的提醒 ID，下次用来找出需要取消的旧通知。
    private func saveScheduled(_ ids: [String]) {
        defaults.set(JSONCompat.jsonString(ids) ?? "[]", forKey: "class-reminders.scheduled")
    }
    // MARK: - ClassReminding
    /// 核心对账：重算未来 7 天内所有事件，把通知预排进系统，并清掉过期/失效的旧通知。
    /// 用指纹判断内容是否变化；权限还没查回来时先不取消、不重排，避免启动首帧误删全部提醒。
    /// 最后把下一次处理时间写进 UserDefaults，供 App 层的 BGAppRefreshTask 参考。
    func reconcile() {
        NotificationAuthorizationCache.shared.refresh()
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let state = self.state.load()
        var closed = ledger("closed")
        var posted = ledger("posted")
        var rendered = ledger("rendered")
        // 先清理已投递且超过 expiresAt 的通知；posted 的值是 expiresAt + 3 天。
        cleanupExpiredDelivered(now: now, posted: posted)
        prune(&closed, now)
        prune(&posted, now)
        let enabled = consent.grantedForReminders() && settings(state).enabled
        let plan = events(enabled ? state : nil, now)
        defaults.set(Int(enabled ? next(plan, now) : 0), forKey: "class-reminders.next")
        let candidates = plan.filter { $0.expiresAt > now && ledgerNumber(closed, $0.id) <= now }.sorted { $0.showAt < $1.showAt }
        if candidates.count > 60 { self.state.log("import-error kind=other http-status=0") }
        if #available(iOS 16.1, *) { ClassActivityController.shared.reconcile(events: enabled ? Array(candidates.prefix(60)) : [], now: now, log: { [weak self] line in self?.state.log(line) }) }
        // 授权查询是异步的：第一次读通常是 false。此时只做清理并保留现有 pending，
        // 等系统回调回来后再跑一次，避免把刚预排好的通知全部取消。
        if NotificationAuthorizationCache.shared.isKnown() == false {
            saveLedger("closed", closed)
            saveLedger("posted", posted)
            NotificationAuthorizationCache.shared.whenKnown { [weak self] _ in
                // 权限回调可能在后台线程；切回主线程，和桥接调用串行，避免同时改账本。
                DispatchQueue.main.async { self?.reconcile() }
            }
            _ = defaults.synchronize()
            return
        }
        var wanted: [String] = []
        if enabled && allowed() {
            for event in candidates.prefix(60) {
                wanted.append(event.id)
                let signature = fingerprint(event)
                if signature.isEmpty || rendered.optString(event.id) != signature {
                    show(event, now)
                    rendered[event.id] = signature
                }
                posted[event.id] = event.expiresAt + 3 * 86400000
            }
        }
        rendered = rendered.filter { wanted.contains($0.key) }
        let stale = scheduled().filter { wanted.contains($0) == false }
        cancel(ids: stale)
        saveScheduled(wanted)
        saveLedger("closed", closed)
        saveLedger("posted", posted)
        saveLedger("rendered", rendered)
        _ = defaults.synchronize()
    }
    /// 把已经过期（expiresAt <= now）的已投递通知从通知中心移除。
    /// posted 里存的是 expiresAt + 3 天的保留截止时间，所以减回去得到真正的 expiresAt。
    private func cleanupExpiredDelivered(now: Int64, posted: JSONObject) {
        let expired = posted.keys.filter { key in
            let keepUntil = ledgerNumber(posted, key)
            guard keepUntil > 0 else { return false }
            return keepUntil - 3 * 86400000 <= now
        }
        guard expired.isEmpty == false else { return }
        center.removeDeliveredNotifications(withIdentifiers: expired.map { ClassReminderService.prefix + $0 })
    }
    /// 供 App 层的 BGTaskScheduler 读取下一次应该唤醒的时间（毫秒）；0 表示当前没有可排的提醒。
    func nextWakeAt() -> Int64 {
        let value = defaults.integer(forKey: "class-reminders.next")
        return value > 0 ? Int64(value) : 0
    }
    /// 返回网页要的提醒状态：设置、当前活跃事件、下次时间、通知权限和通知概况。
    func status() -> JSONObject {
        NotificationAuthorizationCache.shared.refresh()
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let state = self.state.load()
        let settingsValue = settings(state)
        let closed = ledger("closed")
        var active: [JSONObject] = []
        if consent.grantedForReminders() && settingsValue.enabled {
            for event in events(state, now) where event.active(now) && ledgerNumber(closed, event.id) <= now {
                active.append(event.json())
            }
        }
        return ["enabled": settingsValue.enabled, "leadMinutes": settingsValue.leadMinutes,
                "afterStartMinutes": settingsValue.afterStartMinutes, "active": active,
                "next": defaults.integer(forKey: "class-reminders.next"),
                "exact": ClassReminderService.exact(),
                "notificationsAllowed": allowed(),
                "notificationStatus": notificationStatus(activeCount: active.count)]
    }
    /// 发一条示例提醒；没通知权限返回 {ok:false}，不弹错误框。
    /// lockedTest=true 时延迟 5 秒发，方便用户锁屏后看效果。
    func preview(lockedTest: Bool) throws -> JSONObject {
        NotificationAuthorizationCache.shared.refresh()
        if allowed() == false { return ["ok": false] }
        if lockedTest {
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            let content = lessonContent(sample(now), now)
            let request = UNNotificationRequest(identifier: "class/preview",
                                               content: content,
                                               trigger: UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false))
            center.add(request, withCompletionHandler: nil)
            return ["ok": true, "delayed": true]
        }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let content = lessonContent(sample(now), now)
        let request = UNNotificationRequest(identifier: "class/preview", content: content, trigger: nil)
        center.add(request, withCompletionHandler: nil)
        return ["ok": true]
    }
    /// 关闭某条提醒：记下“到过期后 3 天都别再提醒”，取消已排通知并重新对账。
    /// 保存关闭状态失败会抛“提醒关闭状态无法保存，请重试”。
    func close(id: String) throws -> JSONObject {
        try consent.requireAgreed()
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var closed = ledger("closed")
        if let found = events(state.load(), now).first(where: { $0.id == id && $0.active(now) }) {
            closed[id] = found.expiresAt + 3 * 86400000
            saveLedger("closed", closed)
            if defaults.synchronize() == false {
                throw BridgeFailure.message("提醒关闭状态无法保存，请重试")
            }
        }
        cancel(ids: [id])
        reconcile()
        return status()
    }
    /// 注销时清空：取消所有课程通知、测试通知和已投递通知，删掉全部提醒账本。
    func clearAll() {
        var ids = scheduled()
        ids.append(contentsOf: ["preview"] + Array(ledger("posted").keys))
        cancel(ids: Array(Set(ids)))
        if #available(iOS 16.1, *) { ClassActivityController.shared.endAll() }
        saveScheduled([])
        for key in ["closed", "posted", "rendered", "next"] {
            defaults.removeObject(forKey: "class-reminders." + key)
        }
        _ = defaults.synchronize()
    }
    // MARK: - Notifications
    /// 当前是否允许发通知（读系统授权缓存）。
    private func allowed() -> Bool {
        return NotificationAuthorizationCache.shared.value()
    }
    /// 按 ID 取消“还没发”和“已经发到通知中心”的提醒，两种都要清。
    private func cancel(ids: [String]) {
        guard ids.isEmpty == false else { return }
        let identifiers = ids.map { ClassReminderService.prefix + $0 }
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }
    /// 把一条提醒排进系统：未来时间用日历触发器，已经到点则 1 秒后立即发。
    private func show(_ event: Event, _ now: Int64) {
        let content = lessonContent(event, now)
        let identifier = ClassReminderService.prefix + event.id
        var trigger: UNNotificationTrigger?
        if event.showAt > now + 1000 {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? TimeZone.current
            let fireDate = Date(timeIntervalSince1970: Double(event.showAt) / 1000)
            var components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: fireDate)
            components.timeZone = calendar.timeZone
            trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        } else {
            // The event is already inside its window; show it now rather than scheduling a past date.
            trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        }
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
        // 同一个 identifier 在 iOS 里会覆盖旧请求；这里仍先显式移除 pending，避免升级/重排时出现两份。
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.add(request, withCompletionHandler: nil)
    }
    /// 组装通知内容：标题=时间+地点，副标题=“上课提醒”，正文=课程+老师。
    /// 地点/老师为空时用“地点待确认/老师待确认”，文案与 Android 保持一致。
    private func lessonContent(_ event: Event, _ now: Int64) -> UNMutableNotificationContent {
        let room = ClassReminderService.field(event.course.room, "地点待确认")
        let teacher = ClassReminderService.field(event.course.teacher, event.course.localActivity ? "无任课老师" : "老师待确认")
        let content = UNMutableNotificationContent()
        content.title = event.course.start + "–" + event.course.end + "  " + room
        content.subtitle = "上课提醒"
        content.body = event.course.name + " · " + teacher
        content.sound = .default
        content.userInfo = ["id": event.id, "date": event.course.date]
        return content
    }
    /// 造一条 19 分钟后的示例课程，用于“预览提醒”；不会写进真实课表。
    private func sample(_ now: Int64) -> Event {
        let start = now + 19 * 60000
        let shanghai = TimeZone(identifier: "Asia/Shanghai") ?? TimeZone.current
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = shanghai
        formatter.dateFormat = "HH:mm"
        let startDate = Date(timeIntervalSince1970: Double(start) / 1000)
        let endDate = startDate.addingTimeInterval(85 * 60)
        var course = DayCourse()
        course.date = ScheduleDayResolver.dayFormatter().string(from: startDate)
        course.name = "示例课程 · 工程图学C"
        course.room = "教学南大楼（南C101）"
        course.teacher = "示例老师"
        course.start = formatter.string(from: startDate)
        course.end = formatter.string(from: endDate)
        return Event(course: course, id: "preview", showAt: now, startAt: start,
                     endAt: start + 85 * 60000, expiresAt: now + 60000)
    }
    /// 字段为空或是破折号“—”时换成兜底文案，避免通知里出现空白。
    private static func field(_ value: String, _ fallback: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || value == "—" { return fallback }
        return value
    }
    // MARK: - Permission / scheduler mapping
    /// 模拟 Android 的通知渠道状态；iOS 没有渠道，用固定值和授权状态拼出同样字段。
    private func notificationStatus(activeCount: Int) -> JSONObject {
        let authorized = allowed()
        let focus: JSONObject = ["xiaomi": false, "checked": true, "protocol": 0,
                                 "permission": false, "configured": false, "allowed": false]
        return ["enabled": authorized,
                // Android reports channel importance (IMPORTANCE_HIGH=4); iOS has no channel.
                "importance": 4,
                // Android lockscreen visibility VISIBILITY_PUBLIC=1; iOS notifications are public by default.
                "lockVisibility": 1,
                // iOS does not expose whether the device is currently locked.
                "deviceLocked": false,
                "activeCount": activeCount,
                "groupedCount": 0,
                "focus": focus]
    }
    /// iOS 没有“精确闹钟”权限，用“后台刷新是否可用”作为最接近的替代信号。
    static func exact() -> Bool {
        // iOS has no exact alarms; background refresh availability is the closest equivalent.
        return UIApplication.shared.backgroundRefreshStatus == .available
    }
}
/// 给同意服务加一个小工具：能通过 requireAgreed() 就说明用户已同意。
private extension ConsentStoring {
    func grantedForReminders() -> Bool {
        do { try requireAgreed(); return true } catch { return false }
    }
}