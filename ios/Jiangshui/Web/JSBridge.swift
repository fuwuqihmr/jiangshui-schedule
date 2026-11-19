// 【这个文件干什么】网页和原生之间的“传话筒”：收 JS 请求、把结果按编号送回网页。
// 【什么时候会用到它】网页每次调用 window.Android.request(...) 时都会经过这里。
// 【它和谁配合】WebHost 安装它，BridgeDispatcher 处理具体业务，它只负责收发和去重。
import Foundation
import WebKit

/// 路由接口：JSBridge 只负责收发，35 个 action 的具体处理由 BridgeDispatcher 完成。
///
/// 桥接路由入口：由 WebHost 注入具体 dispatcher，JSBridge 不 import 业务实现。
protocol BridgeDispatching: AnyObject {
    func handle(id: String, action: String, payload: JSONObject)
}

/// 网页里的 window.Android.request(...) 最终会走到这里。
///
/// JS → 原生桥（契约 §2，逐字对齐 Android `JavascriptInterface`）。
///
/// - 消息处理器名固定 `jiangshuiBridge`（web/bridge.mjs 只认 `window.Android.request`）
/// - 回包：`window.onNativeResult(<id JSON>, {"value": ...})` / `{"error": "..."}`
/// - 同一 id 只回一次；id 用 JSONSerialization 编码后原样回传
final class JSBridge: NSObject, WKScriptMessageHandler, BridgeTransport {
    // 这个消息名必须和注入脚本、WebHost 注册处一致；改一处就会“喊话没人听”。
    static let handlerName = "jiangshuiBridge"
    // 记住最近 2000 个已回包的 id，防止同一个请求回两次；超过就清空重来。
    private static let answeredLimit = 2000

    // 真正的业务路由器；用 weak 避免两边互相强引用。
    weak var dispatcher: BridgeDispatching?

    // 用来执行 JS 回包的网页控件；weak 是因为 WebHost 已经强持有它。
    private weak var webView: WKWebView?
    // 多个线程可能同时回包，用锁保护下面的 answered 集合。
    private let lock = NSLock()
    // 已经回过的请求 id；同一个 id 第二次直接忽略。
    private var answered: Set<String> = []

    /// 把要回包的 WKWebView 交给桥；必须在页面加载前调用。
    func attach(webView: WKWebView) {
        self.webView = webView
    }

    /// 页面重载/注销时清空去重表。
    func reset() {
        lock.lock()
        answered.removeAll()
        lock.unlock()
    }

    // MARK: - shim（契约 §2）

    /// 生成注入到网页里的“翻译官”：把 JS 调用转成原生消息。
    ///
    /// documentStart 注入。`systemDark` 在 WebHost 每次 load 前按当前系统外观重新生成，
    /// 保证 web/theme.mjs 在模块求值阶段就能读到正确的值。
    static func userScript(systemDark: Bool) -> WKUserScript {
        let dark = systemDark ? "true" : "false"
        let source = """
        (function () {
          window.__jiangshuiDark = \(dark);
          window.Android = { request: function (id, action, payload) {
            window.webkit.messageHandlers.jiangshuiBridge.postMessage({ id: String(id), action: String(action), payload: String(payload) });
          } };
          window.Android.systemDarkMode = function () { return window.__jiangshuiDark === true; };
          window.__jiangshuiSystemDarkMode = function () { return window.__jiangshuiDark === true; };
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    // MARK: - WKScriptMessageHandler

    /// 网页发来消息时系统调用这里：拆出 id/action/payload，再交给路由器。
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == JSBridge.handlerName else { return }
        guard let body = message.body as? [String: Any] else { return }
        guard let id = JSBridge.identifier(body["id"]), !id.isEmpty else { return }
        let action = (body["action"] as? String) ?? ""
        let payloadText = (body["payload"] as? String) ?? "{}"
        // 网页传来的 payload 是字符串，这里当 JSON 解析；解析失败直接回“操作失败”。
        guard let data = payloadText.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]),
              let payload = object as? JSONObject else {
            replyFailure(id, message: "操作失败")
            return
        }
        // 路由器还没装好时也回失败，不能让 JS 一直干等。
        guard let dispatcher = dispatcher else {
            replyFailure(id, message: "操作失败")
            return
        }
        dispatcher.handle(id: id, action: action, payload: payload)
    }

    // MARK: - BridgeTransport

    /// 成功回包：把 value 包成 {"value":...} 发给 JS；同一个 id 只发一次。
    func reply(_ id: String, value: Any?) {
        guard markAnswered(id) else { return }
        // nil 要变成 JSON 的 null，不能变成“没有这个字段”。
        let payload: Any = value ?? NSNull()
        guard JSONSerialization.isValidJSONObject(["value": payload]) else {
            evaluate(result: ["error": "操作失败"], id: id)
            return
        }
        evaluate(result: ["value": payload], id: id)
    }

    /// 失败回包：把中文错误包成 {"error":"..."}；空文案统一成「操作失败」。
    func replyFailure(_ id: String, message: String) {
        guard markAnswered(id) else { return }
        let text = message.isEmpty ? "操作失败" : message
        evaluate(result: ["error": text], id: id)
    }

    // MARK: - 内部

    /// 登记这个 id 已回包；返回 false 表示之前已经回过了，本次忽略。
    private func markAnswered(_ id: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if answered.contains(id) { return false }
        if answered.count >= JSBridge.answeredLimit { answered.removeAll() }
        answered.insert(id)
        return true
    }

    /// 在主线程执行 window.onNativeResult(id, json)；webView 没了就安静放弃。
    private func evaluate(result: [String: Any], id: String) {
        guard let idJSON = JSBridge.jsonFragment(id),
              JSONSerialization.isValidJSONObject(result),
              let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else { return }
        // 拼成一条 JS 调用；id 和 json 都已经安全转义，直接执行即可。
        let script = "window.onNativeResult(\(idJSON),\(json));"
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let webView = self.webView else { return }
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    /// 兼容 JS 传字符串或数字 id；统一转成字符串。
    private static func identifier(_ value: Any?) -> String? {
        if let text = value as? String { return text }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    /// 把 id 安全地变成 JS 字符串字面量（自动加引号、转义特殊字符）。
    private static func jsonFragment(_ value: String) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }
}

// MARK: - native → web 事件（S 档：onNativeProgress / onLeaveServiceReturn）

/// 事件通道：与请求回包共用同一个 WebView 与主线程执行路径，但不占「同一 id 只回一次」的名额。
extension JSBridge: BridgeEventSending {
    /// 学校读取阶段文案：window.onNativeProgress(<id>, <text>)
    /// id 用 JSON 字面量回传，与 onNativeResult 的 id 处理保持一致（防注入）。
    func sendReadProgress(id: String, text: String) {
        guard let idJSON = JSBridge.jsonFragment(id),
              let textJSON = JSBridge.jsonFragment(text) else { return }
        sendEvent(script: "window.onNativeProgress&&window.onNativeProgress(\(idJSON),\(textJSON));")
    }

    /// 从请假服务页回到网页主界面：window.onLeaveServiceReturn()
    func sendLeaveServiceReturn() {
        sendEvent(script: "window.onLeaveServiceReturn&&window.onLeaveServiceReturn();")
    }

    /// 在主线程执行一条事件脚本；WebView 已释放或页面未装载时安静放弃（事件不是回包，不能补发）。
    private func sendEvent(script: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let webView = self.webView else { return }
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }
}
