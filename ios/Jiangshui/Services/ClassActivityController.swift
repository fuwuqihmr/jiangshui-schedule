// 【这个文件干什么】在 iOS 16.1 及以上把“正在上课/即将上课”的课程做成实时活动（Live Activity），显示在锁屏和灵动岛。
// 【什么时候会用到它】ClassReminderService 对账时调用；App 在前台到点由计时器启动，App 从后台/冷启动回到前台时补启动。
// 【它和谁配合】ClassReminderService 提供课程事件；Shared/ClassActivityAttributes.swift 是主 App 与 Widget 共用的数据契约。
// 【小白提示】实时活动不是普通通知：苹果不允许 App 在后台“定时启动”它，只有 App 进程活着时才能 request；
// 杀掉 App 后只能靠已经排好的普通本地通知提醒，所以实时活动是“尽力而为”，通知才是“到点必达”。
// 【注意】这里不提供任何关闭/删除按钮；用户仍可在 iOS 16.2+ 长按实时活动主动结束，结束后的同一节课不再自动补起。
// 【注意】超过“上课开始 + 10 分钟”由 dismissalPolicy: .after 自动删除；普通通知完全不受实时活动失败影响。
import Foundation
import ActivityKit

/// 实时活动管理器：只负责启动/更新/结束 Activity，通知排期仍由 ClassReminderService 负责。
/// 整个类型只在 iOS 16.1+ 可见，调用点必须用 if #available(iOS 16.1, *) 包起来。
@available(iOS 16.1, *)
final class ClassActivityController {
    /// 全局单例：计时器要跨 reconcile 保留，不能每次调用都新建。
    static let shared = ClassActivityController()
    /// 记录已经成功启动过的课程，防止用户长按划掉后 App 回前台又把它补起来。
    private let startedKey = "class-activity.started"
    private let defaults = UserDefaults.standard
    /// 按课程事件 id 保存“到 showAt 时启动”的计时器；只在前台可靠。
    private var timers: [String: Timer] = [:]

    private init() {}

    /// 对账入口：active 里的课程立即补启动；future 里的课程用主线程 Timer 等到 showAt 再启动。
    /// - Parameters:
    ///   - events: ClassReminderService 已经过滤掉“已关闭/已过期”的事件。
    ///   - now: 当前毫秒时间戳，由调用方传入，保证同一次对账使用同一个时间。
    ///   - log: 写诊断日志的回调；失败只记日志，绝不抛错影响通知。
    func reconcile(events: [ClassReminderService.Event], now: Int64, log: @escaping (String) -> Void) {
        // 用户关闭了“实时活动”权限时直接返回，普通通知路径完全不受影响。
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let active = events.filter { $0.active(now) }
        let future = events.filter { $0.showAt > now }
        // Timer 必须挂在主线程的 RunLoop 上；桥接/BGTask 可能在别的线程调用 reconcile。
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.pruneStarted(now)
            self.schedule(future, now: now, log: log)
            for event in active {
                self.start(event, log: log)
            }
        }
    }

    /// 注销/清空提醒时调用：取消所有计时器、结束本 App 的全部实时活动、清掉“已启动”账本。
    /// 这是 App 内部的清理，不是给用户的关闭入口；实时活动本身仍然没有关闭按钮。
    func endAll() {
        defaults.removeObject(forKey: startedKey)
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            for timer in self.timers.values { timer.invalidate() }
            self.timers.removeAll()
            Task {
                for activity in Activity<ClassActivityAttributes>.activities {
                    await activity.end(using: nil, dismissalPolicy: .immediate)
                }
            }
        }
    }

    /// 为未来事件安排 showAt 计时器；先取消已经不在计划里的旧计时器，避免课程被取消后还启动。
    private func schedule(_ future: [ClassReminderService.Event], now: Int64, log: @escaping (String) -> Void) {
        let keep = Set(future.map { $0.id })
        for id in Array(timers.keys) where keep.contains(id) == false {
            timers[id]?.invalidate()
            timers.removeValue(forKey: id)
        }
        for event in future {
            timers[event.id]?.invalidate()
            // 至少等 0.5 秒，避免 showAt 刚好等于 now 时 Timer 立刻触发两次。
            let delay = max(0.5, Double(event.showAt - now) / 1000)
            guard delay <= 7 * 86400 else { continue }
            timers[event.id] = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
                self?.start(event, log: log)
            }
        }
    }

    /// 启动（或更新）一条实时活动。
    /// 已经成功启动过的课程直接跳过：即使用户长按结束，也不会在回前台时被强行补起来。
    private func start(_ event: ClassReminderService.Event, log: @escaping (String) -> Void) {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        guard event.active(now) else { return }
        guard wasStarted(event, now: now) == false else { return }
        let startDate = Date(timeIntervalSince1970: Double(event.startAt) / 1000)
        let endDate = Date(timeIntervalSince1970: Double(event.endAt) / 1000)
        let state = ClassActivityAttributes.ContentState(startDate: startDate, endDate: endDate)
        // 极少见：账本没写成功但系统里已有同课程的活动，直接更新内容，避免重复 request。
        if let activity = existing(event) {
            markStarted(event)
            Task { await activity.update(using: state) }
            return
        }
        let attributes = ClassActivityAttributes(courseName: event.course.name,
                                                  location: location(event.course.room),
                                                  startDate: startDate, endDate: endDate)
        // 用户要求“超过上课时间十分钟自动删除”；这里一次性设置 dismissalPolicy，
        // 不依赖 App 在 T+10 还活着（iOS 会按这个时间自动移除）。
        let dismissal = startDate.addingTimeInterval(600)
        do {
            // 注意：iOS 16.1 的 request(attributes:contentState:pushType:) 是同步 throws 方法，不是 async。
            // 它必须在主线程调用；本方法由 reconcile/Timer 在主线程触发。
            let activity = try Activity<ClassActivityAttributes>.request(attributes: attributes,
                                                                         contentState: state,
                                                                         pushType: nil)
            markStarted(event)
            // end 是 async 方法；在 request 之后立即 end，并把 dismissalPolicy 设为 T+10：
            // 活动仍会显示到 T+10，但不再需要 App 在 T+10 醒来做删除。
            Task { await activity.end(using: state, dismissalPolicy: .after(dismissal)) }
        } catch {
            // 权限被关闭、系统限流、请求过频等都可能失败；只记一条现有白名单格式的诊断。
            log("import-error kind=other http-status=0")
        }
    }

    /// 在系统现有活动里找同一门课（课程名 + 开始时间，误差 1 秒内）。
    private func existing(_ event: ClassReminderService.Event) -> Activity<ClassActivityAttributes>? {
        let target = Date(timeIntervalSince1970: Double(event.startAt) / 1000)
        for activity in Activity<ClassActivityAttributes>.activities {
            if activity.attributes.courseName == event.course.name &&
                abs(activity.attributes.startDate.timeIntervalSince(target)) < 1 {
                return activity
            }
        }
        return nil
    }

    /// 记录“这节课已经启动过”，保留到 expiresAt + 3 天，和通知账本的清理节奏一致。
    private func markStarted(_ event: ClassReminderService.Event) {
        var map = startedUntil()
        map[event.id] = event.expiresAt + 3 * 86400000
        defaults.set(map, forKey: startedKey)
    }

    /// 是否已经启动过；返回 true 时不再重复 request。
    private func wasStarted(_ event: ClassReminderService.Event, now: Int64) -> Bool {
        return (JSONCompat.int64(startedUntil()[event.id]) ?? 0) > now
    }

    /// 读取“已启动”账本；UserDefaults 返回的是属性列表字典，值是 NSNumber。
    private func startedUntil() -> [String: Any] {
        return defaults.dictionary(forKey: startedKey) ?? [:]
    }

    /// 清掉过期的“已启动”记录，防止 UserDefaults 无限增长。
    private func pruneStarted(_ now: Int64) {
        var map = startedUntil()
        let expired = map.keys.filter { (JSONCompat.int64(map[$0]) ?? 0) <= now }
        for key in expired { map.removeValue(forKey: key) }
        if expired.isEmpty == false { defaults.set(map, forKey: startedKey) }
    }

    /// 地点为空或破折号时显示“地点待确认”，和通知文案保持一致。
    private func location(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || value == "—" { return "地点待确认" }
        return value
    }
}
