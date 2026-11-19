// 【这个文件干什么】报告“每日自动检查课表”功能的开关、时间和上次执行结果。
// 【什么时候会用到它】网页调用 runtimeStatus 时，用来显示后台任务状态。
// 【它和谁配合】用户同意记录（没同意就不启用）、UserDefaults 里的设置值。
// 【小白提示】iOS 没有 Android 的精确闹钟和电池豁免，这里用后台刷新能力做最接近的映射。
import Foundation
import UIKit

/// Port of CheckScheduler.status() from android/app/src/main/java/cn/local/tomorrow/CheckScheduler.java.
/// P1 only reports status; the BGTaskScheduler identifiers declared in Info.plist are not registered.
/// 运行时状态读取器：只报告状态，不负责真正启动后台任务。
final class RuntimeStatusService: RuntimeStatusProviding {
    private let consent: ConsentStoring
    private let defaults: UserDefaults
    // 用户没设置时间时的默认值；网页的设置页也用 22:00 作为默认。
    private let defaultTime = "22:00"

    /// 注入同意服务和存储；defaults 参数让测试可以换成临时存储。
    init(consent: ConsentStoring, defaults: UserDefaults = .standard) {
        self.consent = consent
        self.defaults = defaults
    }

    /// 汇总当前状态：是否启用、每天几点、下次/上次时间、精确闹钟和电池豁免的替代值。
    func status() -> JSONObject {
        var enabled = false
        do {
            try consent.requireAgreed()
            enabled = defaults.object(forKey: "daily-check.enabled") as? Bool ?? true
        } catch {
            enabled = false
        }
        let savedTime = defaults.string(forKey: "daily-check.time") ?? defaultTime
        let time = RuntimeStatusService.isValidTime(savedTime) ? savedTime : defaultTime
        let next = Int64(defaults.integer(forKey: "daily-check.next"))
        let lastAttempt = Int64(defaults.integer(forKey: "daily-check.lastAttempt"))
        let lastSuccess = Int64(defaults.integer(forKey: "daily-check.lastSuccess"))
        return ["enabled": enabled,
                "time": time,
                "next": next,
                // Android: exact = SDK<31 || canScheduleExactAlarms. iOS has no exact alarms; the
                // closest signal is whether background refresh is available.
                "exact": UIApplication.shared.backgroundRefreshStatus == .available,
                "lastAttempt": lastAttempt,
                "lastSuccess": lastSuccess,
                // Android: PowerManager.isIgnoringBatteryOptimizations. iOS has no such exemption.
                "batteryExempt": true]
    }

    /// 校验时间必须是 00:00 到 23:59 的 24 小时制，防止网页传入乱码。
    private static func isValidTime(_ value: String) -> Bool {
        return value.range(of: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", options: .regularExpression) != nil
    }
}
