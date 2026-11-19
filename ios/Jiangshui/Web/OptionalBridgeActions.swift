// 【这个文件干什么】1.4.x 新增、但 iOS 还没有对应系统能力的桥接动作（应用内更新/反馈/取消销假）。
// 【什么时候会用到它】网页调用这些 action，而 iOS 壳给不出真实实现时。
// 【它和谁配合】BridgeDispatcher 的 default 分支先问这里；这里只回“诚实失败/能力不可用”，绝不假装成功。
// 【小白提示】能做的不是把功能做出来，而是老实告诉网页“iOS 没有这个能力”，让网页按降级显示，
// 而不是让用户看到“网络连接失败”这种假故障。
import Foundation

/// 可选能力 action 的降级路由（S 档，契约 v0 D3 的 OPTIONAL 级）。
///
/// 为什么放在 `default` 分支而不是主 switch：
/// - iOS 契约 §3 的 MUST 集合仍是 35 个；`check-ios.mjs` 的 B1-B5 用 35 做契约/Android/iOS 三向对齐。
///   这 9 个是 1.4.x 新增、iOS 尚未实现的可选能力，先放在扩展层，门禁语义保持“MUST 35 个”；
/// - 等 M 档真正实现某个能力（如 cancelRecordSync 走销假表单 278615）时，把它提升进主 switch 即可。
///
/// 回包一律沿用桥接信封：`transport.reply(id, value:)` → `{value:...}`，
/// `transport.replyFailure(id, message:)` → `{error:"..."}`，不发明新格式。
///
/// 9 个 action 的“诚实”口径（与 web 1.4.1 的消费方式逐条对齐）：
/// - feedbackInfo：`{enabled:false}` → web/feedback.mjs 隐藏反馈入口（不显示“打开失败”）；
/// - openFeedback：失败信封（入口本来就不会渲染，真被调用也不会假装打开）；
/// - updateInfo：`{enabled:false, currentVersion:...}` → 自动检查更新按“关闭”显示；
/// - updateSettings：失败信封 → 网页开关回弹并提示原因（不能静默无视用户操作）；
/// - updateCheck / updateDownload：`{ok:false, errorCode:"unsupported", message:...}`
///   → web/update.mjs normalizeRelease 走失败分支，提示真实原因而不是“网络连接失败”；
/// - updateCancel / updateSkip：失败信封。web 对这两个 action 的成功回包会直接提示“已取消/已跳过”，
///   值回包等于假装成功，所以必须走失败信封（正常流程里它们也不可达：updateCheck 不会返回“有新版本”）；
/// - cancelRecordSync：`{ok:false, code:"UNSUPPORTED_PLATFORM", message:...}`。
///   web 的假条 provider 只看 `ok` 与 `code`，不会再把它误映射成“请先打开一次请假服务完成登录”；
///   M1 实现后改成真实抓取即可（web 侧建议同时识别 UNSUPPORTED_PLATFORM，见交付说明的 web 清单）。
enum OptionalBridgeActions {

    /// 应用内更新在 iOS 上不提供：侧载/TestFlight 渠道与 App Store 审核都不适合“下载安装包自更新”。
    static let unsupportedUpdate = "iOS 版暂不支持应用内更新，请通过安装渠道获取新版本"
    /// 应用内反馈入口在 iOS 上不提供（问卷星页面由 Android 原生容器承载）。
    static let unsupportedFeedback = "iOS 版暂不支持应用内反馈，请通过项目反馈渠道提交"
    /// 取消销假（销假表单 278615）属 M 档，S 档先明确“能力缺口”。
    static let unsupportedCancelRecord = "iOS 版暂不支持取消销假，请在学校页面查看销假记录"

    /// 处理一个可选 action；返回 true 表示已回包（调用方不要再回“不支持的操作”）。
    static func handle(id: String, action: String, payload: JSONObject, transport: BridgeTransport) -> Bool {
        switch action {
        case "cancelRecordSync":
            // 与 SchoolProviding.leaveRecordSync 的失败形状一致（{ok:false, code}），不抛异常、不伪造记录。
            transport.reply(id, value: [
                "ok": false,
                "code": "UNSUPPORTED_PLATFORM",
                "message": unsupportedCancelRecord,
            ])
        case "feedbackInfo":
            // 形状对齐 Android FeedbackConfig（enabled/title/intro/url），只是永久 disabled。
            transport.reply(id, value: [
                "enabled": false,
                "title": "意见反馈",
                "intro": "",
                "url": "",
            ])
        case "openFeedback":
            transport.replyFailure(id, message: unsupportedFeedback)
        case "updateInfo":
            // 形状对齐 Android UpdateChecker.info()：enabled/currentVersion/skippedVersion/lastAutoCheckAt。
            // iOS 没有应用内更新与自动检查，所以 enabled 恒为 false；currentVersion 是 App 的真实版本。
            transport.reply(id, value: [
                "enabled": false,
                "currentVersion": appVersion(),
                "skippedVersion": "",
                "lastAutoCheckAt": 0,
            ])
        case "updateSettings":
            // 用户手动拨了“自动检查更新”开关：必须让开关回弹并给出原因，不能静默忽略。
            transport.replyFailure(id, message: unsupportedUpdate)
        case "updateCheck", "updateDownload":
            // 失败信封形状对齐 Android UpdateChecker 的 error()：{ok:false, errorCode, message}。
            transport.reply(id, value: [
                "ok": false,
                "errorCode": "unsupported",
                "message": unsupportedUpdate,
            ])
        case "updateCancel", "updateSkip":
            // 这两个动作如果回成功值，web 会直接提示“已取消/已跳过”= 假装成功，因此必须回失败信封。
            transport.replyFailure(id, message: unsupportedUpdate)
        default:
            return false
        }
        return true
    }

    /// 读取 App 的真实版本号（Info.plist 的 CFBundleShortVersionString，由 MARKETING_VERSION 展开）。
    /// 读不到时回空串，交给 web normalizeUpdateInfo 显示“未知”，不编造版本。
    private static func appVersion() -> String {
        let value = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        return value
    }
}
