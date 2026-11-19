// 【这个文件干什么】定义 iOS 原生服务和网页桥接层之间的“合同”：有哪些方法、参数、返回什么。
// 【什么时候会用到它】写服务实现时（必须 conform 这些协议）、网页桥接分发请求时。
// 【它和谁配合】Services/ 下所有实现类，以及 Web/BridgeDispatcher.swift。
// 【小白提示】协议像餐厅菜单：只规定“能点什么”，不规定“厨房怎么做”。
// 【注意】本文件由 Lead 写定，只能加说明注释，不能改协议签名或 JSON 字段。
import Foundation

// 江水课表 iOS 原生服务契约（Lead 写定，任何人不得修改本文件）。
// 规则：所有对外 JSON 形状必须与 Android 现有实现逐字段一致，禁止发明字段。
// 对照：android/app/src/main/java/cn/local/tomorrow/{UserConsent,StateStore,CalendarSync,
//        ClassReminders,CheckScheduler,Diagnostics,MainActivity}.java

/// 桥接层的 JSON 对象。所有服务用字典返回，保证与 Android 的 org.json.JSONObject 形状一致。
// JSONObject 就是 Swift 的字符串字典，等价于 Android 的 org.json.JSONObject。
public typealias JSONObject = [String: Any]

/// 桥接失败。message 必须是可直接展示给用户的中文文案（照抄 Android 文案）。
public enum BridgeFailure: Error {
    /// message 会被原样塞进 { error: "..." } 交给 JS。
    case message(String)

    public var text: String {
        switch self {
        case .message(let value): return value.isEmpty ? "操作失败" : value
        }
    }
}

/// 桥接回包通道（由 WebHost/JSBridge 实现，服务只依赖协议）。
/// 桥接回包通道：服务只负责调 reply/replyFailure，不关心 WebView 怎么把消息送回网页。
public protocol BridgeTransport: AnyObject {
    /// 成功回包：JS 侧收到 { value: ... }
    func reply(_ id: String, value: Any?)
    /// 失败回包：JS 侧收到 { error: "..." }，Promise reject
    func replyFailure(_ id: String, message: String)
}

// MARK: - 1) 同意（对应 UserConsent.java）

/// 同意记录服务：查询/保存/撤回用户对协议的同意，并提供受保护功能前的检查。
public protocol ConsentStoring: AnyObject {
    /// action consentStatus
    func status() -> JSONObject
    /// action acceptConsent，payload.version；返回必须含 version 与 acceptedAt。
    /// 版本不一致时抛 BridgeFailure.message("协议已更新，请重新打开应用确认")（照抄 Android UserConsent.accept 的异常语义）。
    func accept(version: String) throws -> JSONObject
    /// action declineConsent
    func decline() -> JSONObject
    /// logout 用：撤销同意
    func revoke()
    /// 除 consentStatus/acceptConsent/declineConsent/setTheme 外，任何 action 前必须校验；
    /// 未同意 → 抛 BridgeFailure.message(...)，文案照抄 Android UserConsent.require。
    func requireAgreed() throws
}

// MARK: - 2) 状态存储（对应 StateStore.java）

/// 课表存储服务：读、写、清空整份课表，带版本号防并发覆盖，并能写诊断日志。
public protocol StateStoring: AnyObject {
    /// action loadState；无数据返回 nil
    func load() -> JSONObject?
    /// action saveState；revision 冲突语义照抄 Android（expectedRevision 不匹配时如何处理）
    func save(_ state: JSONObject, expectedRevision: Int64) throws -> Int64
    /// logout / 测试用
    func clear()
    /// 诊断日志（对应 StateStore.log）
    func log(_ line: String)
}

// MARK: - 3) 主题（对应 setTheme + systemDarkMode）

/// 主题服务：判断系统深浅色、把网页配色应用到原生窗口、启动时恢复。
public protocol ThemeControlling: AnyObject {
    /// 对应 Android Bridge.systemDarkMode()（同步布尔）
    func isSystemDark() -> Bool
    /// action setTheme；必须校验颜色是 #[0-9a-fA-F]{3} 或 #[0-9a-fA-F]{6}
    func apply(background: String, surface: String, preference: String, dark: Bool) throws -> JSONObject
    /// 启动时按已保存状态恢复窗口配色
    func restore()
}

// MARK: - 4) 系统通知（对应 requestNotifications / notify / notificationSettings）

/// 通知服务：申请权限、发本地通知、给权限页返回摘要。
public protocol NotificationPermissions: AnyObject {
    /// action requestNotifications → {ok: <是否有权限>}
    func requestAuthorization() async -> Bool
    /// action notify → {ok: bool}；无权限返回 false，不抛错
    func post(title: String, body: String) -> Bool
    /// action permissionStatus 的一部分
    func permissionSummary() -> JSONObject
}

/// 系统设置跳转：通知设置页和 App 总设置页。
public protocol SystemSettingsOpening: AnyObject {
    /// action notificationSettings / classReminderSystemSettings
    func openNotificationSettings()
    /// action autostartSettings / batterySettings / requestExactAlarm / calendarOpenSettings
    func openAppSettings()
}

// MARK: - 5) 上课提醒（对应 ClassReminders.java + iOS 版本）

/// 上课提醒服务：根据课表排提醒、查状态、发预览、关闭单条提醒。
public protocol ClassReminding: AnyObject {
    /// action classReminderStatus 前先 reconcile
    func reconcile()
    /// action classReminderStatus
    func status() -> JSONObject
    /// action previewClassReminder（lockedTest=true 时 5 秒后发一条锁屏示例）
    func preview(lockedTest: Bool) throws -> JSONObject
    /// action closeClassReminder
    func close(id: String) throws -> JSONObject
    /// logout 用
    func clearAll()
}

// MARK: - 6) 系统日历（对应 CalendarSync.java + EventKit）

/// 系统日历服务：查状态、把课表写成日历事件、移除已写入的事件。
public protocol CalendarSyncing: AnyObject {
    /// action calendarStatus
    func status() -> JSONObject
    /// action calendarSync；payload 含 semesterId / events（形状照抄 Android）
    func sync(payload: JSONObject) async throws -> JSONObject
    /// action calendarRemove
    func remove() async throws -> JSONObject
    /// 构造 Android 同款错误对象（CALENDAR_* code）
    func error(code: String, message: String) -> JSONObject
}

// MARK: - 7) 文件交换（对应 SAF：import / export / exportFile / exportDiagnostics）

/// 文件交换服务：导入课表 JSON、导出快照/图片/PDF/诊断日志。
public protocol FileExchanging: AnyObject {
    /// action import：返回 {text: String}；用户取消返回空字典
    func importTextFile() async throws -> JSONObject
    /// action export：写 课表快照.json
    func exportText(_ text: String, filename: String) async throws -> Bool
    /// action exportFile：mime 白名单 + base64 校验必须在服务内做
    func exportBase64(mime: String, filename: String, base64: String) async throws -> Bool
    /// action exportDiagnostics：文件名/长度校验必须在服务内做
    func exportDiagnostics(filename: String, text: String) async throws -> Bool
}

// MARK: - 8) 诊断（对应 Diagnostics.java）

/// 诊断服务：汇总 App 信息，并记录网页上报的导入错误。
public protocol DiagnosticsRecording: AnyObject {
    /// action getDiagnostics
    func read() -> String
    /// action recordDiagnostic；kind 白名单 http/cancelled/session/timeout/structure/network/other，status 0..599
    func record(kind: String, httpStatus: Int) throws
}

// MARK: - 9) 权限快照 / 运行时状态（对应 MainActivity.permissionStatus() / CheckScheduler.status()）

/// 权限快照：一次返回网页需要的通知、闹钟、电池、自启动状态。
public protocol PermissionReporting: AnyObject {
    /// action permissionStatus
    func snapshot() -> JSONObject
}

/// 运行时状态：报告每日自动检查课表的开关、时间和上次执行结果。
public protocol RuntimeStatusProviding: AnyObject {
    /// action runtimeStatus
    func status() -> JSONObject
}

// MARK: - 10) 教务线（P2：真实读取，见 SchoolProvider / SchoolReadController / LeaveRecordsService）

/// 学校会话保险库：把登录凭证（Cookie/TGC）以二进制块存取，注销时清空。
/// 具体存 Keychain 还是文件由实现决定；协议只保证“存、取、清”。
public protocol SessionVaulting: AnyObject {
    func save(_ data: Data) throws
    func load() throws -> Data?
    func clear() throws
}

/// 教务读取服务：打开学校页面、读取课表、同步请假记录（P2 实现）。
/// 这些方法依赖 WebView 登录态，所以由 App 层注入具体实现。
public protocol SchoolProviding: AnyObject {
    /// action openSchool，mobile=true 时直接 {ok:true} 并打开学校移动页
    func openSchool(mobile: Bool) throws -> JSONObject
    /// action openWebApp
    func openWebApp(url: String, warmupUrl: String?) throws -> JSONObject
    /// action leaveRecordSync
    func leaveRecordSync() async throws -> JSONObject
    /// action cancelRead
    func cancelRead() throws -> JSONObject
    /// action capture / sync / openSchool(mobile=false)：真实读取一次课表
    func capture() async throws -> JSONObject
    /// 注销时清空请假页会话参数（UserDefaults 的 leave.uid / leave.pageEnc.*）
    func clearLeaveSession()
}

// MARK: - 11) 服务容器（B 负责实现 wiring，A 的 dispatcher 只依赖本协议）

/// 服务容器协议：网页桥接层只依赖这 13 个 getter，不直接创建任何服务。
public protocol NativeServicesProviding: AnyObject {
    var consent: ConsentStoring { get }
    var state: StateStoring { get }
    var theme: ThemeControlling { get }
    var notifications: NotificationPermissions { get }
    var settings: SystemSettingsOpening { get }
    var classReminders: ClassReminding { get }
    var calendar: CalendarSyncing { get }
    var files: FileExchanging { get }
    var diagnostics: DiagnosticsRecording { get }
    var permissions: PermissionReporting { get }
    var runtime: RuntimeStatusProviding { get }
    var vault: SessionVaulting { get }
    var school: SchoolProviding { get }
}
