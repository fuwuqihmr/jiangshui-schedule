// 【这个文件干什么】把手机当前的权限状态整理成网页认识的 JSON，供“权限检查”页面显示。
// 【什么时候会用到它】网页调用 permissionStatus 时。
// 【它和谁配合】通知服务、系统设置跳转；网页 app.mjs 要求同时有 notifications/exactAlarm/battery。
// 【小白提示】iOS 和 Android 的权限种类不同，这里保留 Android 的字段形状，缺的能力标记为不支持。
import Foundation
import UIKit

/// Port of MainActivity.permissionStatus() (MainActivity.java:464-483). The web client requires
/// notifications, exactAlarm and battery to be present; the Android-only autostart group is kept as
/// a documented iOS difference.
/// 权限快照器：只读当前状态，不主动弹系统授权框。
final class PermissionReporter: PermissionReporting {
    /// 返回四组权限：通知、精确闹钟、电池优化豁免、自启动。
    /// iOS 没有后三种能力，用 supported=false 告诉网页“这一行不用显示”。
    func snapshot() -> JSONObject {
        NotificationAuthorizationCache.shared.refresh()
        let granted = NotificationAuthorizationCache.shared.value()
        var notifications: JSONObject = [:]
        // 通知权限：iOS 只问一次，没有 Android 那种“运行时权限”重复申请流程。
        // Android reports runtime=false once the runtime permission is granted. iOS asks once and has
        // no runtime prompt to repeat, so this stays false: the web UI then opens system settings.
        notifications["runtime"] = false
        notifications["granted"] = granted
        notifications["systemEnabled"] = granted
        notifications["allowed"] = granted

        // 精确闹钟：iOS 没有这个开关，required=false 只是兼容旧网页的字段形状。
        // iOS 没有「精确闹钟」概念：supported=false 让 web 端整行不渲染，
        // required=false 保留给不认识 supported 的旧客户端（它会隐藏按钮、只留状态）。
        let exactAlarm: JSONObject = ["required": false, "allowed": true, "supported": false]
        // 电池优化：iOS 不需要用户手动把 App 加入白名单，所以始终算“已豁免”。
        // iOS has no battery-optimization exemption flow to request.
        // supported=false 让 web 端整行不渲染（iOS 没有电池优化豁免流程）。
        let battery: JSONObject = ["exempt": true, "supported": false]
        // 自启动：iOS 不允许 App 注册开机自启，这一组只为保持 JSON 形状一致。
        // iOS apps cannot register for autostart; the row is kept for shape compatibility.
        let autostart: JSONObject = ["supported": false, "known": false, "oem": "", "openedAt": 0]

        return ["notifications": notifications, "exactAlarm": exactAlarm,
                "battery": battery, "autostart": autostart]
    }
}
