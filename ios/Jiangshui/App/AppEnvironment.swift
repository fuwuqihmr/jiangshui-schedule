// 【这个文件干什么】把学校服务、原生服务、网页宿主这三个“零件”装到一起。
// 【什么时候会用到它】App 一启动就执行；整个 App 只装配一次。
// 【它和谁配合】SchoolProvider 负责教务，NativeServices 负责手机能力，WebHost 负责网页。
import Foundation
import SwiftUI
import UIKit

/// 全 App 唯一的服务装配点（契约 §7 接线决策 1）。
///
/// 这里是壳层唯一 import 具体实现（`NativeServices` / `SchoolProvider`）的文件；
/// BridgeDispatcher / WebHost 只依赖 `NativeServicesProviding` 协议。
///
/// 依赖的对外契约（由队友提供，若最终命名不同只需改本文件）：
/// - `SchoolProvider()`（ios/Jiangshui/School/SchoolProvider.swift，C 负责）
/// - `NativeServices(presenting: @escaping () -> UIViewController?, school: SchoolProviding)`
///   （ios/Jiangshui/Services/NativeServices.swift，B 负责）
/// - 注销：`NativeServices` 需实现 `LogoutHandling`（见 Web/BridgeDispatcher.swift）
final class ShellModel: ObservableObject {
    // 三根柱子：school 读教务、services 提供手机能力、host 负责显示网页。
    let school: SchoolProvider
    let services: NativeServices
    let host: WebHost
    // 图标校准只做一次；通知观察者要在退出时移除，避免内存泄漏。
    private var iconCalibrationObserver: NSObjectProtocol?
    private var iconCalibrated = false

    /// 按顺序创建三个对象并接好线；这里不会失败，真正出错在各自服务内部。
    init() {
        let school = SchoolProvider()
        let services = NativeServices(
            presenting: { PresentingViewControllerHolder.shared.topViewController },
            school: school
        )
        self.school = school
        self.services = services
        self.host = WebHost(services: services)
        // 服务装配完成后注册后台刷新并做一次提醒对账；此时通知权限可能还没查回来，
        // ClassReminderService 会先清理过期通知、保留现有 pending，等权限回调后再补排。
        BackgroundReminderScheduler.shared.configure(services: services)
        // 与 Android MainActivity.onCreate 一致：按已保存课表校准桌面图标。
        // setAlternateIconName 在 App 还没 active 时可能失败，所以等 didBecomeActive 再做，
        // 且只做一次；applyIconTheme 会先比较当前图标，相同则直接返回。
        iconCalibrationObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.calibrateIconTheme()
        }
    }

    deinit {
        if let observer = iconCalibrationObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    /// App 变为 active 后按已保存状态校准图标；只执行一次，避免每次回前台都读盘。
    private func calibrateIconTheme() {
        guard iconCalibrated == false else { return }
        iconCalibrated = true
        let saved = services.state.load()
        services.theme.applyIconTheme(saved?.optString("iconTheme", "whale") ?? "whale")
    }
}
