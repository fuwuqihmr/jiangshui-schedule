// 【这个文件干什么】把学校登录凭证（CAS 的 TGC 和教务 Cookie）安全地存进 iOS Keychain。
// 【什么时候会用到它】登录成功保存会话、下次启动恢复登录、注销时清空。
// 【它和谁配合】SchoolProvider / SchoolReadController 读写会话；LogoutController 负责清空。
// 【为什么放 Keychain】Keychain 是系统加密的“保险箱”，比普通文件更难被别的 App 或备份偷看。
// 【小白提示】Keychain 像手机里的带锁抽屉；即使 App 被卸载，抽屉有时还在，所以注销必须主动清。
import Foundation
import Security

// 学校会话保险库：Keychain 版 SessionVault（P1 交付；P2 的 CAS/教务 cookie 恢复依赖它）。
//
// 对照 Android：
// - android/app/src/main/java/cn/local/tomorrow/SessionVault.java（AES-GCM + 文件 school-cookies.enc）
// - android/app/src/main/java/cn/local/tomorrow/MainActivity.java:190（unprotect）
// - android/app/src/main/java/cn/local/tomorrow/MainActivity.java:512（protect）
//
// iOS 直接用 Keychain（kSecClassGenericPassword, kSecAttrAccessibleAfterFirstUnlock），
// 不写明文文件，也不依赖 B 的 SessionVault.swift（避免与另一实现者冲突）。
//
// 与 Android 的差异（必须写进交付说明，不允许静默降级）：
// - Android 卸载应用会删除 files 目录；iOS Keychain 条目在卸载重装后仍可能残留，
//   因此 logout（IOS-PORT-CONTRACT.md action 35）必须显式调用 clear()。
// - JSON 信封字段名与 Android 逐字一致：{version, savedAt, tgc, academic}，
//   savedAt 为毫秒时间戳；P2 可直接复用 SchoolClient.java 的读取顺序。
// - 单条数据上限 100000 字节（对齐 SessionVault.java:22 的 read(in,100000)）。
// - 本机 Windows 无 Xcode/swiftc，未编译验证；Keychain 的真实行为（首次解锁前读取、
//   卸载重装残留、模拟器/真机差异）只能在真机或模拟器验证，见 ios/docs/PHASE2-SCHOOL.md。
/// 学校会话保险库：用 Keychain 保存一段 JSON 二进制，失败时回中文提示。
public final class SchoolSession: SessionVaulting {

    public static let defaultService = "cn.local.tomorrow.school-session"
    public static let defaultAccount = "school-session-v1"
    // 与 SessionVault.java:22 的 100000 字节读取上限一致。
    public static let maximumSessionBytes = 100_000
    // SchoolClient.java:28 的 safeCookieValue 上限（单个 cookie 值最长 4096）。
    public static let maximumCookieValueLength = 4096

    private let service: String
    private let account: String

    public init(service: String = SchoolSession.defaultService, account: String = SchoolSession.defaultAccount) {
        self.service = service
        self.account = account
    }

    // MARK: - SessionVaulting

    /// 保存会话数据；空数据或超过 100000 字节视为异常，抛“学校会话保存失败”。
    /// 先尝试更新旧条目，旧条目不存在才新建，避免重复写入。
    public func save(_ data: Data) throws {
        if data.isEmpty { throw BridgeFailure.message("学校会话保存失败") }
        if data.count > SchoolSession.maximumSessionBytes { throw BridgeFailure.message("学校会话保存失败") }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        if updateStatus != errSecItemNotFound { throw BridgeFailure.message("学校会话保存失败") }
        var insert: [String: Any] = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let addStatus = SecItemAdd(insert as CFDictionary, nil)
        if addStatus != errSecSuccess { throw BridgeFailure.message("学校会话保存失败") }
    }

    /// 读取会话；Keychain 里没有就返回 nil（表示还没登录），读取失败则抛错。
    public func load() throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        if status != errSecSuccess { throw BridgeFailure.message("学校会话读取失败") }
        guard let data = result as? Data else { throw BridgeFailure.message("学校会话读取失败") }
        return data
    }

    /// 删除整条会话；本来就不存在也算成功，只有真正的系统错误才抛错。
    public func clear() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { return }
        throw BridgeFailure.message("学校会话清除失败")
    }

    // MARK: - Android 同形状的 JSON 信封（SessionVault.java:24-27）

    // 保存 CAS TGC 与教务 cookie（bzb_jsxsd）。空值不覆盖旧值；两者都为空时不写。
    /// 保存 CAS TGC 和教务 Cookie：空字符串不覆盖旧值，两者都为空时不写。
    /// 同时写入 version 和 savedAt（毫秒），字段名与 Android 的 JSON 信封一致。
    public func saveSession(tgc: String?, academic: String?) throws {
        var payload: JSONObject = [:]
        if let existing = try loadSession() { payload = existing }
        payload["version"] = 1
        payload["savedAt"] = SchoolSession.nowMilliseconds()
        if let tgc = tgc, tgc.isEmpty == false { payload["tgc"] = tgc }
        if let academic = academic, academic.isEmpty == false { payload["academic"] = academic }
        if payload["tgc"] == nil && payload["academic"] == nil { return }
        try save(try encode(payload))
    }

    /// 读回会话 JSON；没有数据或 JSON 不是对象时返回 nil，避免上层拿到坏数据。
    public func loadSession() throws -> JSONObject? {
        guard let data = try load() else { return nil }
        guard let object = try? JSONSerialization.jsonObject(with: data, options: []) else { return nil }
        guard let dictionary = object as? JSONObject else { return nil }
        return dictionary
    }

    // 对应 SessionVault.clearTgc：只清 TGC，保留教务 cookie；两者都空则删掉整条。
    /// 只清 TGC，保留教务 Cookie；如果两者都没了，就连整条 Keychain 记录一起删。
    public func clearTGC() throws {
        guard var payload = try loadSession() else { return }
        payload.removeValue(forKey: "tgc")
        if payload["academic"] == nil {
            try clear()
            return
        }
        payload["savedAt"] = SchoolSession.nowMilliseconds()
        try save(try encode(payload))
    }

    // MARK: - 工具

    // 对应 SchoolClient.java:28 的 safeCookieValue：长度与字符集双重限制。
    /// 检查 Cookie 值是否安全：不能为空、不能超过 4096 个 UTF-16 单元、不能含特殊字符。
    public static func isSafeCookieValue(_ value: String?) -> Bool {
        guard let value = value else { return false }
        if value.isEmpty { return false }
        if value.utf16.count > maximumCookieValueLength { return false }
        let pattern = "^[A-Za-z0-9._~+/%=-]+$"
        return value.range(of: pattern, options: .regularExpression) != nil
    }

    /// 当前时间的毫秒时间戳；和 Android System.currentTimeMillis() 对齐。
    public static func nowMilliseconds() -> Int64 {
        return Int64(Date().timeIntervalSince1970 * 1000)
    }

    /// 把会话字典编码成 JSON 二进制；编码失败统一转成“学校会话保存失败”。
    private func encode(_ payload: JSONObject) throws -> Data {
        do {
            return try JSONSerialization.data(withJSONObject: payload, options: [])
        } catch {
            throw BridgeFailure.message("学校会话保存失败")
        }
    }
}
