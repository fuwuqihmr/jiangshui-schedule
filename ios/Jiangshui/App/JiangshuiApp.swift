// 【这个文件干什么】App 的启动入口，相当于整个程序的“点火开关”。
// 【什么时候会用到它】用户点开 App 图标时，系统会从这里开始运行。
// 【它和谁配合】创建 ShellModel（装配服务），再把 RootView（网页界面）放进窗口。
import Foundation
import SwiftUI
import UIKit
import UserNotifications
import BackgroundTasks

/// 江水课表 iOS 壳（iOS 16.0，SwiftUI App 生命周期）。
///
/// 页面本体是 WKWebView 里的 web/（与 Android 共用同一份 ES Module 前端）。
@main
struct JiangshuiApp: App {
    // 只创建一次；它内部装着本地服务器和网页，后面的界面都靠它。
    @StateObject private var shell = ShellModel()

    /// App 启动时先挂通知展示员；不挂的话，前台收到提醒会“静悄悄”。
    init() {
        // delegate 是 weak；NotificationPresenter.shared 负责强持有。
        // 不设置它，App 在前台时通知横幅不会显示（预览提醒会「看不到东西」）。
        UNUserNotificationCenter.current().delegate = NotificationPresenter.shared
        // 必须尽早注册；注册失败（例如 Info.plist 没配 id）时内部会静默降级，不影响前台提醒。
        BackgroundReminderScheduler.shared.register()
    }

    /// 整个 App 只有一个窗口；窗口内容就是 RootView。
    var body: some Scene {
        WindowGroup {
            RootView(host: shell.host)
                .preferredColorScheme(nil)
        }
    }
}

/// 管理上课提醒的 BGAppRefreshTask：只负责“叫醒 App 补做 reconcile/清理”，不负责准时。
/// iOS 的后台刷新是 best-effort：系统可能延后、合并，省电模式下甚至完全不执行。
/// 真正的提醒已经由 UNCalendarNotificationTrigger 预排给系统，所以这里缺席也不会漏掉通知本身。
final class BackgroundReminderScheduler {
    static let shared = BackgroundReminderScheduler()
    static let taskIdentifier = "cn.local.tomorrow.class-reminder"

    // 弱引用服务容器：BGTask 回调时 App 可能还没完成装配，拿不到就安全失败。
    private weak var services: NativeServices?
    private var registrationAttempted = false
    private var registered = false

    private init() {}

    /// 向系统登记后台任务；必须在 App 启动完成前调用。重复调用会被内部标志挡住。
    func register() {
        guard registrationAttempted == false else { return }
        registrationAttempted = true
        registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: BackgroundReminderScheduler.taskIdentifier,
                                                     using: nil) { [weak self] task in
            self?.handle(task)
        }
    }

    /// ShellModel 创建好服务后调用：记住服务并立刻做一次 reconcile + 排下一次唤醒。
    /// 登记动作只放在 JiangshuiApp.init：那时才确定 App 启动流程已经开始。
    func configure(services: NativeServices) {
        self.services = services
        reconcileAndSchedule()
    }

    /// 回到前台时调用：补做一次对账（含过期通知清理），并更新后台任务时间。
    func handleForeground() {
        reconcileAndSchedule()
    }

    /// 只更新下一次 BGTask 的时间，不碰通知。
    func schedule() {
        guard registered else { return }
        let now = Date()
        var earliest = now.addingTimeInterval(15 * 60)
        if let next = nextWakeAt() {
            earliest = Date(timeIntervalSince1970: Double(next) / 1000)
        }
        let minimum = now.addingTimeInterval(60)
        if earliest < minimum { earliest = minimum }
        let request = BGAppRefreshTaskRequest(identifier: BackgroundReminderScheduler.taskIdentifier)
        request.earliestBeginDate = earliest
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // 失败不影响已经预排的本地通知；下一次前台/保存课表时会再试。
        }
    }

    /// 从 ClassReminderService 读取下一次唤醒时间；服务还没装配好时返回 nil。
    private func nextWakeAt() -> Int64? {
        guard let services = services,
              let reminders = services.classReminders as? ClassReminderService else { return nil }
        let value = reminders.nextWakeAt()
        return value > 0 ? value : nil
    }

    /// 先对账再排下一次；对账会写 class-reminders.next，schedule 读它。
    private func reconcileAndSchedule() {
        services?.classReminders.reconcile()
        schedule()
    }

    /// 系统给到执行窗口时：先排下一次，再做一次 reconcile，最后必须调用 setTaskCompleted。
    private func handle(_ task: BGTask) {
        guard let refreshTask = task as? BGAppRefreshTask else {
            task.setTaskCompleted(success: false)
            return
        }
        schedule()
        let lock = NSLock()
        var completed = false
        func finish(_ success: Bool) {
            lock.lock()
            if completed {
                lock.unlock()
                return
            }
            completed = true
            lock.unlock()
            refreshTask.setTaskCompleted(success: success)
        }
        refreshTask.expirationHandler = { finish(false) }
        guard let services = services else {
            finish(false)
            return
        }
        services.classReminders.reconcile()
        finish(true)
    }
}
