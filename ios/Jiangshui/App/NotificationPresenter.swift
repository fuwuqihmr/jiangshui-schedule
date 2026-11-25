// 【这个文件干什么】决定 App 在前台时，通知要不要显示成横幅、要不要响铃。
// 【什么时候会用到它】用户点“预览提醒”或课程提醒到点时，系统会来这里问一句。
// 【它和谁配合】JiangshuiApp 启动时把它挂到 UNUserNotificationCenter（系统通知中心）。
import Foundation
import UserNotifications

/// 前台通知展示（App 层唯一持有者）。
///
/// 系统默认在前台不展示横幅，而 UNUserNotificationCenter.delegate 是 weak：
/// 不设置或没有人强持有，用户点「预览提醒」时前台什么都看不到。
/// 因此这里提供单例 shared，并在 JiangshuiApp.init() 里挂到通知中心。
final class NotificationPresenter: NSObject, UNUserNotificationCenterDelegate {
    // 单例：全 App 只有这一份，活到 App 退出，防止 delegate 因没人持有而被释放。
    static let shared = NotificationPresenter()

    /// 私有构造：外部只能通过 shared 使用，避免创建出多个展示器。
    private override init() {
        super.init()
    }

    /// P1：前台一律展示横幅 + 声音 + 通知中心列表。
    ///
    /// B 的本地通知（ClassReminderService / SystemNotificationService）目前既没有
    /// categoryIdentifier，也没有 jiangshui.foreground 标记，所以这里不做分支；
    /// P2 接入提醒分类后，再按这些标记决定是否降级为「仅横幅」。
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list])
    }

    /// P1 只关闭系统回调；P2 再在这里接通知点击深链。
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        completionHandler()
    }
}
