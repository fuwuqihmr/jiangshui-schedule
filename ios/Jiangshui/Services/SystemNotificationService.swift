// 【这个文件干什么】向系统申请通知权限、发本地通知，并打开系统的通知设置页。
// 【什么时候会用到它】网页点“开启通知”、测试通知，或需要跳到系统设置时。
// 【它和谁配合】上课提醒服务也会发通知；权限缓存给桥接的同步查询提供最近一次结果。
// 【小白提示】iOS 的通知权限是异步查询的，桥接是同步的，所以先缓存上次结果，读不到就先用 false。
import Foundation
import UIKit
import UserNotifications

/// Mirrors the authorization state iOS exposes so synchronous bridge calls can read it.
/// 通知权限缓存：把系统异步返回的授权状态记下来，供同步代码随时读取。
/// 第一次查询可能还没回来，此时 value() 返回 false；下一次调用就会更新。
final class NotificationAuthorizationCache {
    static let shared = NotificationAuthorizationCache()
    // 系统回调可能在别的线程，用锁保护这几个变量，避免读写撞车。
    private let lock = NSLock()
    private var authorized = false
    private var known = false
    private var refreshing = false
    // 权限查询还没回来时先在这里排队；等系统回调后统一通知，避免调用方反复轮询。
    private var waiters: [(Bool) -> Void] = []

    private init() { refresh() }

    func value() -> Bool {
        lock.lock()
        let current = authorized
        lock.unlock()
        return current
    }

    func isKnown() -> Bool {
        lock.lock()
        let current = known
        lock.unlock()
        return current
    }

    /// 权限已知时立刻回调；未知时排队，等系统查询完成后回调。
    /// 上课提醒用它在“第一次启动、权限还没查回来”时补跑一次 reconcile，避免错过预排。
    func whenKnown(_ callback: @escaping (Bool) -> Void) {
        lock.lock()
        if known {
            let current = authorized
            lock.unlock()
            callback(current)
            return
        }
        waiters.append(callback)
        lock.unlock()
        refresh()
    }

    /// UNUserNotificationCenter reports asynchronously; the bridge stays synchronous and reads the
    /// last known value, so the first permissionStatus call may still report not-authorized.
    /// 向系统重新查询一次权限；如果已经有一个查询在跑，就直接返回，避免重复请求。
    /// 查询结果会在系统回调里更新缓存，调用方不必等待。
    func refresh() {
        lock.lock()
        if refreshing {
            lock.unlock()
            return
        }
        refreshing = true
        lock.unlock()
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let status = settings.authorizationStatus
            let allowed = status == .authorized || status == .provisional || status == .ephemeral
            self.lock.lock()
            self.authorized = allowed
            self.known = true
            self.refreshing = false
            let callbacks = self.waiters
            self.waiters.removeAll()
            self.lock.unlock()
            for callback in callbacks { callback(allowed) }
        }
    }
}

/// Port of the notification actions from MainActivity.java (requestNotifications/notify) and
/// SystemSettingsOpening. iOS has no per-channel importance, so the authorization status is the
/// only signal behind the Android "areNotificationsEnabled" checks.
/// 通知服务：申请权限、发通知、打开设置页。
/// 失败时的行为与 Android 对齐：没权限就返回 false，不抛异常打断网页。
final class SystemNotificationService: NotificationPermissions, SystemSettingsOpening {
    private let center = UNUserNotificationCenter.current()

    /// 弹系统授权框并等待用户选择；返回是否拿到通知权限。
    func requestAuthorization() async -> Bool {
        return await withCheckedContinuation { continuation in
            center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
                NotificationAuthorizationCache.shared.refresh()
                continuation.resume(returning: granted)
            }
        }
    }

    /// 发一条立即显示的本地通知；没有权限时返回 false，不报错。
    /// 这里把通知交给系统后就返回，和 Android notify 的“入队即成功”行为一致。
    func post(title: String, body: String) -> Bool {
        NotificationAuthorizationCache.shared.refresh()
        guard NotificationAuthorizationCache.shared.value() else { return false }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        // Android posts to the "changes" channel; the channel concept does not exist on iOS.
        let request = UNNotificationRequest(identifier: "changes-" + UUID().uuidString,
                                           content: content, trigger: nil)
        // Android's notify() returns once the notification is enqueued; do the same instead of
        // waiting (the completion may be delivered on the main thread, which the bridge uses).
        center.add(request, withCompletionHandler: nil)
        return true
    }

    /// 给权限页用的简要通知状态；iOS 只有一个总开关，所以 enabled 和 granted 相同。
    func permissionSummary() -> JSONObject {
        NotificationAuthorizationCache.shared.refresh()
        let granted = NotificationAuthorizationCache.shared.value()
        // iOS exposes one authorization state; there is no separate "system enabled" switch.
        return ["enabled": granted, "granted": granted]
    }

    /// 打开本 App 的通知设置页；iOS 16 起有专用 URL，旧系统退回 App 设置页。
    func openNotificationSettings() {
        if #available(iOS 16.0, *) {
            openSettingsURL(UIApplication.openNotificationSettingsURLString)
        } else {
            openSettingsURL(UIApplication.openSettingsURLString)
        }
    }

    /// 打开本 App 的系统设置总页（日历、电池等入口都跳这里）。
    func openAppSettings() {
        openSettingsURL(UIApplication.openSettingsURLString)
    }

    /// 把字符串转成 URL 并让系统打开；切主线程是 iOS 对打开设置页的要求。
    private func openSettingsURL(_ value: String) {
        guard let url = URL(string: value) else { return }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
    }
}