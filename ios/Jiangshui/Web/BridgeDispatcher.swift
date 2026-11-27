// 【这个文件干什么】网页请求的“总机”：按 action 名字把活分给手机上的各项服务。
// 【什么时候会用到它】网页每发一个请求（读课表、发通知、导出文件等）都会进来。
// 【它和谁配合】JSBridge 把消息交给它；它只认 NativeServicesProviding 协议，不碰具体实现。
import Foundation

/// 注销：`LogoutHandling` 由 B 在 ios/Jiangshui/Services/NativeServices.swift 声明
/// （NativeServices 同时 conform `NativeServicesProviding` 与 `LogoutHandling`，
/// `handleLogout()` 返回 {ok:true}）。这里只做 `as?` 转换，不重复声明
/// （同一 target 内重复声明同名协议会编译失败）。
/// 网页请求的“总机”：先查协议同不同意，再按 action 分给对应服务。
///
/// 45 个 action 的路由层（35 MUST + 10 OPTIONAL；MUST 与 MainActivity switch 顺序 1:1）。
///
/// 规则：
/// - 只依赖 `NativeServicesProviding`，不 import 具体实现
/// - 除 4 个白名单 action 外先 `consent.requireAgreed()`
/// - 未知 action → `{error:"不支持的操作"}`；所有异常 → `{error:<中文文案>}`
/// - 每个 action 只回一次包（去重由 JSBridge 兜底）
final class BridgeDispatcher: BridgeDispatching {
    /// 契约版本（public v1.5.0 的 bridge-actions.json）；M2 门禁读取。
    static let contractVersion = "v0-2026-11-18"
    // 这四个 action 在用户同意协议前也必须能用，否则连协议页都打不开。
    static let consentFreeActions: Set<String> = ["consentStatus", "acceptConsent", "declineConsent", "setTheme"]
    // 只拿协议，不认具体实现；方便测试和替换。
    private let services: NativeServicesProviding
    // 回包通道；真正把结果发回网页的是 JSBridge。
    private let transport: BridgeTransport
    // 9 个 OPTIONAL action 的降级处理器（反馈/更新）。
    private let optionalActions: OptionalBridgeActions

    /// 注销完成后通知 App 层清理 WebView 缓存（由 WebHost 设置）。
    var onLogout: (() -> Void)?
    /// 拒绝协议后通知 App 层显示「已拒绝」覆盖页。
    var onConsentDeclined: (() -> Void)?

    /// 注入服务集合和回包通道；构造时不做任何耗时操作。
    init(services: NativeServicesProviding, transport: BridgeTransport) {
        self.services = services
        self.transport = transport
        self.optionalActions = OptionalBridgeActions(transport: transport)
        // 请假服务返回是 MUST 回调：school 侧负责在可见页面返回时触发。
        // 这里用局部常量捕获 transport，避免在 init 里强捕获 self。
        let bridge = transport
        services.school.onLeaveServiceReturn = { [weak bridge] in
            bridge?.leaveServiceReturn()
        }
    }

    /// 收到一个网页请求：先过同意门，再按 action 分发；每个分支只回一次包。
    func handle(id: String, action: String, payload: JSONObject) {
        // 先过“同意门”：没同意协议时，除白名单外一律拒绝。
        if !BridgeDispatcher.consentFreeActions.contains(action) {
            do {
                try services.consent.requireAgreed()
            } catch {
                fail(id, error)
                return
            }
        }
        // 下面按 Android 的 action 编号分组；字符串就是 web/bridge.mjs 传来的名字，不能改。
        switch action {
        // 1-3 同意
        case "consentStatus":
            reply(id, services.consent.status())
        case "acceptConsent":
            do {
                reply(id, try services.consent.accept(version: text(payload["version"])))
            } catch {
                fail(id, error)
            }
        case "declineConsent":
            reply(id, services.consent.decline())
            onConsentDeclined?()
        // 课表状态的读/写；网页启动时先 loadState，保存时带 expectedRevision。
        // 4-5 状态
        case "loadState":
            // load() 返回 JSONObject?。这里显式区分「有数据」与「无数据」：有数据回对象，
            // 无数据回 NSNull（JS 侧收到 {value:null}，与 Android 一致），让回包形状一目了然。
            // 注：传给 Any? 形参时 Swift 会保留 Optional 的 nil（不会装箱成 Any）；原直接传参
            // 本身就能正确回 null/对象，这不是「课表已在后台更新」死循环的根因。此写法只是显式化，
            // 并为将来有人把 reply 的 Any? 改成 Any 时留一道保护。
            if let saved = services.state.load() {
                reply(id, saved)
            } else {
                reply(id, NSNull())
            }
        case "saveState":
            guard let state = payload["state"] as? JSONObject else { transport.replyFailure(id, message: "操作失败"); return }
            do {
                let revision = try services.state.save(state, expectedRevision: int64(payload["expectedRevision"], fallback: -1))
                // 与 Android MainActivity.java:1015 一致：payload 带 iconTheme 才切换，失败不影响保存。
                if state.hasKey("iconTheme") { services.theme.applyIconTheme(state.optString("iconTheme", "whale")) }
                reply(id, ["revision": revision])
            } catch {
                fail(id, error)
            }
        // 网页换主题时把颜色告诉原生，并把偏好记下来。
        // 6 主题
        case "setTheme":
            do {
                let value = try services.theme.apply(
                    background: text(payload["background"]),
                    surface: text(payload["surface"]),
                    preference: text(payload["preference"]).isEmpty ? "system" : text(payload["preference"]),
                    dark: flag(payload["dark"])
                )
                reply(id, value)
            } catch {
                fail(id, error)
            }
        // 上课提醒的查询、预览、跳系统设置和关闭。
        // 7-10 上课提醒
        case "classReminderStatus":
            services.classReminders.reconcile()
            reply(id, services.classReminders.status())
        case "previewClassReminder":
            do {
                reply(id, try services.classReminders.preview(lockedTest: flag(payload["lockedTest"])))
            } catch {
                // Android: previewClassReminder 任何异常统一回这句（MainActivity.java:728）。
                transport.replyFailure(id, message: "预览通知暂时无法发送")
            }
        case "classReminderSystemSettings":
            services.settings.openNotificationSettings()
            reply(id, ["ok": true])
        case "closeClassReminder":
            do {
                reply(id, try services.classReminders.close(id: text(payload["id"])))
            } catch {
                fail(id, error)
            }
        // 通知权限、后台运行限制等系统设置入口。
        // 11-16 通知/权限/后台
        case "notificationSettings":
            services.settings.openNotificationSettings()
            reply(id, ["ok": true])
        case "permissionStatus":
            reply(id, services.permissions.snapshot())
        case "autostartSettings":
            services.settings.openAppSettings()
            reply(id, ["ok": true])
        case "runtimeStatus":
            reply(id, services.runtime.status())
        case "requestExactAlarm":
            services.settings.openAppSettings()
            reply(id, ["ok": true])
        case "batterySettings":
            services.settings.openAppSettings()
            reply(id, ["ok": true])
        // 打开教务网页、读取课表、同步请假记录。
        // 17-19 教务（P2：真实读取，见 SchoolProvider / SchoolReadController）
        case "openSchool":
            // 与 Android 一致（MainActivity.java:737）：
            // mobile=true 只打开移动端门户页；mobile=false 等价 beginSchoolRead，真正读取一次课表。
            if flag(payload["mobile"]) {
                do {
                    reply(id, try services.school.openSchool(mobile: true))
                } catch {
                    fail(id, error)
                }
            } else {
                runSchoolRead(id) {
                    try await self.services.school.capture()
                }
            }
        case "openWebApp":
            do {
                reply(id, try services.school.openWebApp(url: text(payload["url"]), warmupUrl: optionalText(payload["warmupUrl"])))
            } catch {
                fail(id, error)
            }
        case "leaveRecordSync":
            runAsync(id) {
                try await self.services.school.leaveRecordSync()
            }
        case "cancelRecordSync":
            runAsync(id) {
                try await self.services.school.cancelRecordSync()
            }
        // 把课表写进系统日历，或从日历移除。
        // 20-23 系统日历
        case "calendarStatus":
            reply(id, services.calendar.status())
        case "calendarSync":
            runAsync(id) {
                try await self.services.calendar.sync(payload: payload)
            }
        case "calendarRemove":
            runAsync(id) {
                try await self.services.calendar.remove()
            }
        case "calendarOpenSettings":
            services.settings.openAppSettings()
            reply(id, ["ok": true])
        // 取消读取、重新抓取、同步。
        // 24-26 教务读取（P2：真实读取 / 假条直连同步，见 SchoolProvider）
        case "cancelRead":
            do {
                reply(id, try services.school.cancelRead())
            } catch {
                fail(id, error)
            }
        case "capture":
            runSchoolRead(id) {
                try await self.services.school.capture()
            }
        case "sync":
            runSchoolRead(id) {
                try await self.services.school.capture()
            }
        // 请求通知权限、立即发一条本地通知。
        // 27-28 通知
        case "requestNotifications":
            Task {
                let granted = await self.services.notifications.requestAuthorization()
                self.reply(id, ["ok": granted])
            }
        case "notify":
            let posted = services.notifications.post(title: text(payload["title"]), body: text(payload["body"]))
            reply(id, ["ok": posted])
        // 导入/导出课表文件。
        // 29-30 文件
        case "import":
            runAsync(id) {
                try await self.services.files.importTextFile()
            }
        case "export":
            guard let text = payload["text"] as? String else {
                transport.replyFailure(id, message: "操作失败")
                return
            }
            runBoolAction(id, written: {
                try await self.services.files.exportText(text, filename: "课表快照.json")
            })
        // 读诊断日志、记一条诊断、导出诊断或文件。
        // 31-34 诊断/导出
        case "getDiagnostics":
            reply(id, diagnosticsObject())
        case "recordDiagnostic":
            do {
                try services.diagnostics.record(kind: text(payload["kind"]), httpStatus: integer(payload["httpStatus"]))
                reply(id, ["ok": true])
            } catch {
                fail(id, error)
            }
        case "exportDiagnostics":
            runBoolAction(id, written: {
                try await self.services.files.exportDiagnostics(
                    filename: self.text(payload["filename"]),
                    text: self.text(payload["text"])
                )
            })
        case "exportFile":
            runBoolAction(id, written: {
                try await self.services.files.exportBase64(
                    mime: self.text(payload["mime"]),
                    filename: self.text(payload["filename"]),
                    base64: self.text(payload["base64"])
                )
            })
        // 注销账号：清本地数据并回到同意页。
        // 35 注销
        case "logout":
            performLogout(id)
        case "feedbackInfo": optionalActions.handle(id: id, action: action, payload: payload)
        case "openFeedback": optionalActions.handle(id: id, action: action, payload: payload)
        case "updateInfo": optionalActions.handle(id: id, action: action, payload: payload)
        case "updateSettings": optionalActions.handle(id: id, action: action, payload: payload)
        case "updateCheck": optionalActions.handle(id: id, action: action, payload: payload)
        case "updateDownload": optionalActions.handle(id: id, action: action, payload: payload)
        case "updateCancel": optionalActions.handle(id: id, action: action, payload: payload)
        case "updateSkip": optionalActions.handle(id: id, action: action, payload: payload)
        case "updateInstall": optionalActions.handle(id: id, action: action, payload: payload)
        default:
            transport.replyFailure(id, message: "不支持的操作")
        }
    }

    // MARK: - 注销

    /// 注销：优先交给 NativeServices 的统一清理；没有实现时退回协议层能做的清理。
    private func performLogout(_ id: String) {
        if let handler = services as? LogoutHandling {
            let value = handler.handleLogout()
            reply(id, value.isEmpty ? ["ok": true] : value)
        } else {
            // 兜底：只做协议层能保证的清理（B 的 NativeServices 实现了 LogoutHandling 时不应发生）。
            services.consent.revoke()
            services.state.clear()
            services.classReminders.clearAll()
            do { try services.vault.clear() } catch { }
            reply(id, ["ok": true])
        }
        onLogout?()
    }

    /// Android 的 getDiagnostics 回的是 JSONObject；iOS 协议给的是 JSON 字符串，这里解析回对象。
    private func diagnosticsObject() -> JSONObject {
        let text = services.diagnostics.read()
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let value = object as? JSONObject else {
            return JSONObject()
        }
        return value
    }

    // MARK: - 回包

    /// 统一成功回包；value 为 nil 时 JSBridge 会回 null。
    private func reply(_ id: String, _ value: Any?) {
        transport.reply(id, value: value)
    }

    /// 统一失败回包：BridgeFailure 用它自带的中文文案，其它错误用系统描述。
    private func fail(_ id: String, _ error: Error) {
        if let failure = error as? BridgeFailure {
            transport.replyFailure(id, message: failure.text)
            return
        }
        let text = error.localizedDescription
        transport.replyFailure(id, message: text.isEmpty ? "操作失败" : text)
    }

    /// 教务读取类 action：进入时挂进度回调，结束（含失败）一定摘掉。
    private func runSchoolRead(_ id: String, operation: @escaping () async throws -> Any?) {
        Task {
            self.services.school.onProgress = { [weak self] text in
                guard let self = self, !text.isEmpty else { return }
                self.transport.progress(id, text: text)
            }
            defer { self.services.school.onProgress = nil }
            do {
                let value = try await operation()
                self.reply(id, value)
            } catch { self.fail(id, error) }
        }
    }

    /// async 服务：成功回 `{value}`，失败回 `{error}`。
    private func runAsync(_ id: String, operation: @escaping () async throws -> Any?) {
        Task {
            do {
                let value = try await operation()
                self.reply(id, value)
            } catch {
                self.fail(id, error)
            }
        }
    }

    /// 文件写入类：true → `{ok:true}`；false（用户取消）→ `{}`（对齐 MainActivity.java:786）。
    /// 文件导出专用：用户取消（false）回空对象，成功回 {"ok":true}，与 Android 一致。
    private func runBoolAction(_ id: String, written: @escaping () async throws -> Bool) {
        Task {
            do {
                let done = try await written()
                self.reply(id, done ? ["ok": true] : [:])
            } catch {
                self.fail(id, error)
            }
        }
    }

    // MARK: - payload 取值（对应 Android 的 opt*）

    /// 从 payload 里取字符串；取不到就当空串，避免崩。
    private func text(_ value: Any?) -> String {
        if let text = value as? String { return text }
        return ""
    }

    /// 取可空字符串；没有就返回 nil，让调用方自己决定默认值。
    private func optionalText(_ value: Any?) -> String? {
        if let text = value as? String { return text }
        return nil
    }

    /// 取布尔值；JS 可能传 true/false 或数字 0/1，都兼容。
    private func flag(_ value: Any?) -> Bool {
        if let value = value as? Bool { return value }
        if let value = value as? NSNumber { return value.boolValue }
        return false
    }
    /// 取整数；字符串数字也接受，实在没有就 0。
    private func integer(_ value: Any?) -> Int {
        if let value = value as? NSNumber { return value.intValue }
        if let value = value as? String, let parsed = Int(value) { return parsed }
        return 0
    }

    /// 取 64 位整数；expectedRevision 这类大数字要用它，避免溢出。
    private func int64(_ value: Any?, fallback: Int64) -> Int64 {
        if let value = value as? NSNumber { return value.int64Value }
        if let value = value as? String, let parsed = Int64(value) { return parsed }
        return fallback
    }
}
