// 【这个文件干什么】把同意、课表存储、主题、通知、提醒、日历、文件、诊断等服务组装成一个“工具箱”。
// 【什么时候会用到它】App 启动时创建一次；网页发来的每个桥接请求都从这个工具箱里取服务。
// 【它和谁配合】Web/BridgeDispatcher.swift 只认 NativeServicesProviding 协议，不关心具体实现。
// 【小白提示】这里像插线板：各个服务是电器，统一插好后，网页只需要说“我要用哪个”。
// 【注意】本文件不依赖 App/ 或 Web/ 的具体类型，方便单独测试和替换。
import Foundation
import UIKit

/// Logout entry point used by Web/BridgeDispatcher.swift (same target, single declaration).
/// 注销入口协议；单独抽出来，避免 Web 层直接依赖 LogoutController 的具体类型。
public protocol LogoutHandling: AnyObject {
    func handleLogout() -> JSONObject
}

/// Container for every native service. A's AppEnvironment constructs it with the school provider;
/// the dispatcher only depends on NativeServicesProviding.
/// 所有原生服务的容器；持有强引用，保证服务在 App 生命周期内一直可用。
public final class NativeServices: NativeServicesProviding, LogoutHandling {
    private let consentImpl: ConsentStore
    private let stateImpl: StateStore
    private let themeImpl: ThemeController
    private let notificationsImpl: SystemNotificationService
    private let settingsImpl: SystemNotificationService
    private let remindersImpl: ClassReminderService
    private let calendarImpl: CalendarService
    private let filesImpl: FileExchangeService
    private let diagnosticsImpl: DiagnosticsService
    private let permissionsImpl: PermissionReporter
    private let runtimeImpl: RuntimeStatusService
    private let vaultImpl: SchoolSession
    private let schoolImpl: SchoolProviding
    private let logoutImpl: LogoutController

    /// 创建并连接所有服务。presenting 用来在需要时找到“当前最上层的页面”（弹文件选择框用）。
    /// school 由 App 层注入，因为教务读取依赖 WebView 和登录态；这里只保存协议引用。
    public init(presenting: @escaping () -> UIViewController?, school: SchoolProviding) {
        let consent = ConsentStore()
        let state = StateStore()
        let theme = ThemeController()
        // 图标切换失败只写诊断日志，不影响课表保存和启动。
        theme.log = { state.log($0) }
        let notifications = SystemNotificationService()
        let reminders = ClassReminderService(state: state, consent: consent)
        let calendar = CalendarService()
        let files = FileExchangeService(presenting: presenting)
        let diagnostics = DiagnosticsService(state: state, reminders: reminders)
        let permissions = PermissionReporter()
        let runtime = RuntimeStatusService(consent: consent)
        // 学校会话用 Keychain 保存；SchoolSession 是当前工程里唯一的 SessionVaulting 实现。
        // C's SchoolSession is the single SessionVaulting implementation in this target.
        let vault = SchoolSession()
        let logout = LogoutController(consent: consent, state: state, reminders: reminders,
                                      vault: vault, school: school, theme: theme)
        self.consentImpl = consent
        self.stateImpl = state
        self.themeImpl = theme
        self.notificationsImpl = notifications
        self.settingsImpl = notifications
        self.remindersImpl = reminders
        self.calendarImpl = calendar
        self.filesImpl = files
        self.diagnosticsImpl = diagnostics
        self.permissionsImpl = permissions
        self.runtimeImpl = runtime
        self.vaultImpl = vault
        self.schoolImpl = school
        self.logoutImpl = logout
        // 课表保存成功后自动重排上课提醒；对应 Android StateStore 保存后调用 onStateChanged。
        // Mirrors StateStore.java calling ClassReminders.onStateChanged after a successful save.
        state.onChange = { [weak reminders] in reminders?.reconcile() }
    }

    // 下面 13 个 getter 对应 ServiceProtocols.swift 里的 NativeServicesProviding。
    // 网页桥接层只通过它们拿服务，不直接碰具体类。
    public var consent: ConsentStoring { return consentImpl }
    public var state: StateStoring { return stateImpl }
    public var theme: ThemeControlling { return themeImpl }
    public var notifications: NotificationPermissions { return notificationsImpl }
    public var settings: SystemSettingsOpening { return settingsImpl }
    public var classReminders: ClassReminding { return remindersImpl }
    public var calendar: CalendarSyncing { return calendarImpl }
    public var files: FileExchanging { return filesImpl }
    public var diagnostics: DiagnosticsRecording { return diagnosticsImpl }
    public var permissions: PermissionReporting { return permissionsImpl }
    public var runtime: RuntimeStatusProviding { return runtimeImpl }
    public var vault: SessionVaulting { return vaultImpl }
    public var school: SchoolProviding { return schoolImpl }

    /// 桥接 action logout 的入口：转交给注销清理器。
    public func handleLogout() -> JSONObject {
        return logoutImpl.logout()
    }
}
