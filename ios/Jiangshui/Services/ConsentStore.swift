// 【这个文件干什么】记住用户有没有同意《用户协议》，以及同意的是哪个版本、什么时候同意的。
// 【什么时候会用到它】首次启动弹协议、网页查询同意状态、点“同意/拒绝”、注销账号时。
// 【它和谁配合】网页的 consent.mjs 通过桥调用；协议版本来自安装包里的 web/agreement.json。
// 【存在哪里】手机本地的 UserDefaults（系统自带的小记事本），不联网、不上传。
// 【小白提示】协议版本像合同编号：编号变了，旧同意就作废，必须重新确认。
import Foundation

/// Port of android/app/src/main/java/cn/local/tomorrow/UserConsent.java.
/// The agreement version is read from the bundled web/agreement.json, never hard coded.
/// 用户同意记录管家：读协议版本、写/清同意记录、给受保护功能当“门卫”。
/// 失败会抛出中文 BridgeFailure，网页会把这句话直接显示给用户。
final class ConsentStore: ConsentStoring {
    // UserDefaults 的键名：一个存协议版本，一个存同意时间（毫秒时间戳）。
    private let versionKey = "user-consent.version"
    private let acceptedKey = "user-consent.acceptedAt"

    private var defaults: UserDefaults { return UserDefaults.standard }

    /// 从 App 安装包里读 agreement.json 的 version 字段；读不到或文件异常就返回空串。
    /// 版本号不写死在代码里，换协议时只改那个 JSON 文件即可。
    func agreementVersion() -> String {
        var url = Bundle.main.url(forResource: "agreement", withExtension: "json", subdirectory: "web")
        if url == nil { url = Bundle.main.url(forResource: "agreement", withExtension: "json") }
        guard let location = url, let data = try? Data(contentsOf: location), data.count > 0, data.count <= 100000 else { return "" }
        guard let root = try? JSONSerialization.jsonObject(with: data, options: []), let object = JSONCompat.object(root) else { return "" }
        return object.optString("version")
    }

    // 同意时间存成毫秒；0 表示“从没同意过”。
    private var acceptedAt: Int64 { return Int64(defaults.double(forKey: acceptedKey)) }

    /// 三个条件同时满足才算已同意：版本有效、和保存版本相同、同意时间大于 0。
    private var granted: Bool {
        let version = agreementVersion()
        return version.isEmpty == false && version == defaults.string(forKey: versionKey) && acceptedAt > 0
    }

    /// 返回网页要的 {version, acceptedAt}；没同意过时 version 为空串、acceptedAt 为 0。
    func status() -> JSONObject {
        return ["version": defaults.string(forKey: versionKey) ?? "", "acceptedAt": acceptedAt]
    }

    /// 用户点“同意”时调用：先核对版本，再写入版本号和当前时间。
    /// 版本对不上会提示“协议已更新…”；保存失败会提示“协议确认无法保存…”。
    func accept(version: String) throws -> JSONObject {
        guard agreementVersion() == version else {
            throw BridgeFailure.message("协议已更新，请重新打开应用确认")
        }
        defaults.set(version, forKey: versionKey)
        defaults.set(Double(Date().timeIntervalSince1970 * 1000), forKey: acceptedKey)
        // UserDefaults has no reliable synchronous failure channel; synchronize() flushes to disk.
        let saved = defaults.synchronize()
        if saved == false { throw BridgeFailure.message("协议确认无法保存，请重试") }
        return status()
    }

    /// 用户点“拒绝”：只回 ok，不保存同意；是否退出网页由外层壳决定。
    func decline() -> JSONObject {
        // Android finishes the activity after declining; the shell decides when to stop the web view.
        return ["ok": true]
    }

    /// 注销时抹掉同意记录，下次启动会重新要求确认协议。
    func revoke() {
        defaults.removeObject(forKey: versionKey)
        defaults.removeObject(forKey: acceptedKey)
        _ = defaults.synchronize()
    }

    /// 受保护功能前的“门卫”：没同意就抛“请先阅读并同意用户协议”。
    func requireAgreed() throws {
        if granted == false { throw BridgeFailure.message("请先阅读并同意用户协议") }
    }
}
