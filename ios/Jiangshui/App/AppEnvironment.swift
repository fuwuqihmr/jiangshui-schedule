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
    }
}
