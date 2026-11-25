// 【这个文件干什么】处理契约里 9 个 OPTIONAL action：反馈入口与应用内更新。
// 【什么时候会用到它】网页设置页查询反馈/更新状态，或用户点「检查更新」时。
// 【它和谁配合】BridgeDispatcher 把 OPTIONAL action 转进来；这里只依赖 BridgeTransport。
// 【小白提示】iOS 不做应用内更新，所以统一回「不支持」的失败信封，绝不假装成功。
import Foundation

/// 9 个 OPTIONAL action 的处理器（runtimeStatus 已在 BridgeDispatcher 里，不重复）。
///
/// 这些 action 在契约里是 OPTIONAL：Android 已实现，iOS 只提供稳定的降级形状。
/// - feedbackInfo/openFeedback：本阶段没有反馈问卷配置，回禁用值 / 失败文案；
/// - updateInfo：回 supported=false 能力位，让网页把「应用版本」整块隐藏；
/// - updateCheck/Download/Cancel/Skip/Settings/Install：一律回 unsupported 失败信封。
final class OptionalBridgeActions {
    /// 更新类失败统一文案；errorCode 固定 unsupported，网页 updateErrorText 会回退到这条 message。
    static let unsupportedMessage = "iOS 版暂不支持应用内更新，请通过安装渠道获取新版本"

    private let transport: BridgeTransport

    init(transport: BridgeTransport) {
        self.transport = transport
    }

    /// 处理一个 OPTIONAL action；调用方保证 action 一定是这 9 个之一。
    func handle(id: String, action: String, payload: JSONObject) {
        switch action {
        case "feedbackInfo":
            transport.reply(id, value: feedbackInfo())
        case "openFeedback":
            // 契约 required 是 {ok}；没有问卷地址，回 ok:false 表示未打开（不是桥接失败）。
            transport.reply(id, value: ["ok": false])
        case "updateInfo":
            transport.reply(id, value: updateInfo())
        case "updateSettings":
            // 不写偏好、不假装保存；同时补上契约 required 的 enabled=false。
            transport.reply(id, value: updateSettingsResponse())
        case "updateCheck", "updateDownload", "updateCancel", "updateSkip", "updateInstall":
            // 统一失败信封：{ok:false,errorCode:"unsupported",message:"..."}。
            // 不抛 BridgeFailure，因为网页要读 errorCode 来决定提示文案。
            transport.reply(id, value: OptionalBridgeActions.unsupportedUpdateResponse())
        default:
            // 理论上不会走到；保持静默，避免把未知 action 当成功。
            transport.replyFailure(id, message: "不支持的操作")
        }
    }

    /// feedbackInfo 的降级值：字段与 Android 一致，enabled=false 表示不显示入口。
    private func feedbackInfo() -> JSONObject {
        return [
            "enabled": false,
            "title": "意见反馈",
            "intro": "",
            "url": ""
        ]
    }

    /// updateInfo：契约 required 四字段 + iOS 扩展能力位 supported=false。
    /// currentVersion 取主 Bundle 的 CFBundleShortVersionString，取不到就回空串。
    private func updateInfo() -> JSONObject {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        return [
            "enabled": false,
            "currentVersion": version,
            "skippedVersion": "",
            "lastAutoCheckAt": 0,
            "supported": false
        ]
    }

    /// updateSettings 的降级值：失败信封 + enabled=false（有能力升级时必须真读写）。
    private func updateSettingsResponse() -> JSONObject {
        return [
            "ok": false,
            "enabled": false,
            "errorCode": "unsupported",
            "message": OptionalBridgeActions.unsupportedMessage
        ]
    }

    /// 所有更新操作的统一失败信封（updateSettings 另有 enabled 字段）。
    private static func unsupportedUpdateResponse() -> JSONObject {
        return [
            "ok": false,
            "errorCode": "unsupported",
            "message": unsupportedMessage
        ]
    }
}
