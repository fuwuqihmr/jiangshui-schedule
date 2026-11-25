// 【这个文件干什么】请假页是网页，而网页自带的定位（navigator.geolocation）在 iOS 的
//   WebView 里是坏的；本文件往网页里塞一个「假定位零件」，把定位请求转给原生去办。
// 【什么时候会用到它】只在请假页面（xgxt 域名）打开时生效；别的页面注入也不认。
// 【它和谁配合】SchoolWebViewHost 创建它、把它注册成网页和原生之间的「信箱」；真正去
//   申请权限、取坐标的是 SchoolLocationPermission。
// 【安全边界】只给 https + xgxt.juwp.edu.cn（默认端口或 443）的页面回坐标，其它一律拒绝——
//   就算有人在别的网站塞同样的脚本，也拿不到你的位置。
// 【比喻】它像公司前台：网页递条子说要位置，前台核对工牌（来源域名）无误才转给安保（系统定位）。
import Foundation
import WebKit
import CoreLocation

// 请假页的定位桥。
//
// 为什么需要它：iOS 15–26 的 WKUIDelegate 没有公开的 geolocation 授权回调
// （requestGeolocationPermissionForOrigin 是 iOS 27.0 才加入的）；没有 shim 时
// 请假页里的 navigator.geolocation 在 WKWebView 中会一直失败。
//
// 做法：
// 1. 在 documentStart 向页面注入 shim，替换 navigator.geolocation；
// 2. JS 通过 window.webkit.messageHandlers.jiangshuiGeo 把请求发给原生；
// 3. 原生校验 frame 的 securityOrigin 必须是 xgxt 的 https（默认端口/443），
//    再申请系统定位授权、取一次坐标；
// 4. 用 window.__jiangshuiGeoResult 回填结果。
//
// 安全边界与 Android allowedGeoOrigin 一致；页面即使被注入脚本也无法让原生
// 向非 xgxt 页面返回坐标。watchPosition 目前只回填一次（请假页只用 getCurrentPosition）。
// 本机 Windows 无 Xcode/swiftc，未编译验证。
/// 网页与原生之间的「定位信箱」。网页把请求写成一条消息投进信箱（jiangshuiGeo），
/// 本类核对来源、去要坐标，再把结果用 window.__jiangshuiGeoResult(...) 送回网页。
final class SchoolGeolocationBridge: NSObject, WKScriptMessageHandler {

    // 信箱的名字：网页端用 window.webkit.messageHandlers.jiangshuiGeo 投信，原生按同名字收信。
    // 两边必须一模一样，改名网页就投不进来了。
    static let handlerName = "jiangshuiGeo"

    // 由 SchoolWebViewHost 强持有；这里弱引用，避免与 WKUserContentController 形成环。
    weak var host: SchoolWebViewHost?

    // 记着「是谁在用它」——用来取当前页面模式、弹提示、以及把结果写回页面。
    // pendingID 是当前正在处理的那一次请求的编号（一次只服务一个）；
    // timeoutWork 是超时闹钟，结果回来时要取消它，否则闹钟到点会再回一次错误。
    private var pendingID: String?
    private var timeoutWork: DispatchWorkItem?

    // 只注入到页面上下文；页面自己定义的 geolocation 若存在会被替换。
    /// 要注入进网页的那段 JavaScript——打包好的「假定位零件」。
    /// 作用：把 navigator.geolocation 换掉，网页一调 getCurrentPosition 就改成给原生发消息；
    /// 原生算完再回调网页当初登记的成功/失败函数。
    /// 注意：下面 #""" 与 """# 之间是 JS 代码（不是 Swift），改它等于改网页行为。
    static let injectionScript: String = #"""
    (function () {
        if (!window.webkit || !window.webkit.messageHandlers || !window.webkit.messageHandlers.jiangshuiGeo) {
            return;
        }
        var handler = window.webkit.messageHandlers.jiangshuiGeo;
        // shim 注入到所有 frame（forMainFrameOnly:false），但原生回填只在主 frame 求值。
        // 无论 top 还是 iframe，都统一用 root.__jiangshuiGeoCallbacks 作为唯一注册表：
        // 主 frame 的 root 就是 window，iframe 的 root 是 top。这样 iframe 注入时不会
        // 新建一张与主 frame 隔离的表，主 frame 自己的请求也能在主 frame 回填时查到。
        // 跨域访问 top 会抛 SecurityError，退化为当前 window。
        var root = window;
        try { if (window.top) { root = window.top; } } catch (ignore) { root = window; }
        var callbacks = null;
        try {
            if (!root.__jiangshuiGeoCallbacks || typeof root.__jiangshuiGeoCallbacks !== "object") {
                root.__jiangshuiGeoCallbacks = {};
            }
            callbacks = root.__jiangshuiGeoCallbacks;
        } catch (ignore) {
            root = window;
            callbacks = {};
        }

        function nextId() {
            var current = 0;
            try { current = Number(root.__jiangshuiGeoSeq) || 0; } catch (ignore) {}
            current += 1;
            try { root.__jiangshuiGeoSeq = current; } catch (ignore) {}
            return "jiangshui-geo-" + current;
        }

        function makeError(code, message) {
            return {
                code: code,
                message: message,
                PERMISSION_DENIED: 1,
                POSITION_UNAVAILABLE: 2,
                TIMEOUT: 3
            };
        }

        root.__jiangshuiGeoResult = function (result) {
            if (!result || !result.id) { return; }
            var entry = callbacks[result.id];
            if (!entry) { return; }
            delete callbacks[result.id];
            if (result.ok) {
                var c = result.payload && result.payload.coords ? result.payload.coords : {};
                var position = {
                    coords: {
                        latitude: Number(c.latitude) || 0,
                        longitude: Number(c.longitude) || 0,
                        accuracy: Number(c.accuracy) || 0,
                        altitude: null,
                        altitudeAccuracy: null,
                        heading: null,
                        speed: null
                    },
                    timestamp: Number(result.payload && result.payload.timestamp) || Date.now()
                };
                if (typeof entry.success === "function") {
                    try { entry.success(position); } catch (ignore) {}
                }
            } else if (typeof entry.error === "function") {
                var code = Number(result.code) || 2;
                var message = result.message || "无法获取当前位置";
                try { entry.error(makeError(code, message)); } catch (ignore) {}
            }
        };

        function request(success, error, options, isWatch) {
            var id = nextId();
            var timeout = options && typeof options.timeout === "number" && options.timeout > 0
                ? options.timeout
                : 15000;
            if (timeout > 30000) { timeout = 30000; }
            callbacks[id] = { success: success, error: error };
            try {
                handler.postMessage({
                    id: id,
                    timeout: timeout,
                    enableHighAccuracy: !!(options && options.enableHighAccuracy),
                    watch: !!isWatch
                });
            } catch (e) {
                delete callbacks[id];
                if (typeof error === "function") {
                    error(makeError(2, "无法发起定位请求"));
                }
                return id;
            }
            if (!isWatch) {
                setTimeout(function () {
                    if (!callbacks[id]) { return; }
                    delete callbacks[id];
                    if (typeof error === "function") {
                        error(makeError(3, "定位超时"));
                    }
                }, timeout + 1000);
            }
            return id;
        }

        var shim = {
            getCurrentPosition: function (success, error, options) {
                request(success, error, options, false);
            },
            watchPosition: function (success, error, options) {
                return request(success, error, options, true);
            },
            clearWatch: function (id) {
                if (id) { delete callbacks[id]; }
            }
        };

        try {
            Object.defineProperty(navigator, "geolocation", {
                value: shim,
                configurable: true
            });
        } catch (e) {
            try {
                navigator.geolocation.getCurrentPosition = shim.getCurrentPosition;
                navigator.geolocation.watchPosition = shim.watchPosition;
                navigator.geolocation.clearWatch = shim.clearWatch;
            } catch (ignore) {}
        }
    })();
    """#

    /// 收到网页投来的定位请求。WebKit 可能从任意线程回调，所以先切回主线程再处理。
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if Thread.isMainThread {
            handle(message)
        } else {
            DispatchQueue.main.async { [weak self] in
                self?.handle(message)
            }
        }
    }

    /// 真正处理一条定位请求：校验消息格式 → 校验来源页面 → 取消上一个没完成的请求 →
    /// 设一个超时闹钟 → 请定位代办员去申请权限并取一次坐标。
    /// 任何一步不通过都会立刻回一条失败，绝不让网页一直干等。
    private func handle(_ message: WKScriptMessage) {
        guard message.name == Self.handlerName else { return }
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              id.isEmpty == false else {
            return
        }
        guard allowedOrigin(message.frameInfo.securityOrigin),
              let host = host,
              host.mode == .leaveApp,
              host.isUserVisible || host.presentingViewController != nil else {
            respond(id: id, ok: false, code: 1, message: "当前页面不允许获取位置")
            return
        }

        // 同一时间只处理一个定位请求；旧请求先收到失败，避免 callback 永久悬挂。
        if let old = pendingID {
            timeoutWork?.cancel()
            timeoutWork = nil
            respond(id: old, ok: false, code: 2, message: "定位请求已被新的请求替代")
        }
        pendingID = id

        let requested = (body["timeout"] as? NSNumber)?.doubleValue ?? 15000.0
        let timeoutMs = min(max(requested, 3000.0), 30000.0)
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.pendingID == id else { return }
            self.finish(id: id, result: .failure(NSError(domain: "SchoolLocation", code: 3,
                                                         userInfo: [NSLocalizedDescriptionKey: "定位超时"])))
        }
        timeoutWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + timeoutMs / 1000.0, execute: work)

        SchoolLocationPermission.shared.requestLocation(prompt: { [weak host] in
            host?.updateNote("请假表单需要位置信息，请允许定位权限")
        }, completion: { [weak self] result in
            self?.finish(id: id, result: result)
        })
    }

    /// 结束一次定位：先确认回来的还是当前这一次请求（防止旧请求的结果串台），
    /// 再按成功 / 失败拼成网页认识的结构送回去。
    private func finish(id: String, result: Result<CLLocation, Error>) {
        guard pendingID == id else { return }
        pendingID = nil
        timeoutWork?.cancel()
        timeoutWork = nil

        switch result {
        case .success(let location):
            let coords: [String: Any] = [
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy,
                "altitude": NSNull(),
                "altitudeAccuracy": NSNull(),
                "heading": NSNull(),
                "speed": NSNull()
            ]
            let payload: [String: Any] = [
                "coords": coords,
                "timestamp": Date().timeIntervalSince1970 * 1000.0
            ]
            respond(id: id, ok: true, code: 0, message: "", payload: payload)
        case .failure(let error):
            let nsError = error as NSError
            let code: Int
            if nsError.domain == "SchoolLocation" && (nsError.code == 1 || nsError.code == 2 || nsError.code == 3) {
                code = nsError.code
            } else {
                code = 2
            }
            let text = nsError.localizedDescription.isEmpty ? "无法获取当前位置" : nsError.localizedDescription
            respond(id: id, ok: false, code: code, message: text)
        }
    }

    /// 把结果送回网页：拼成 JSON 后调用页面里的 window.__jiangshuiGeoResult(...)。
    /// JSON 由系统序列化生成、不手工拼字符串，免得页面内容把脚本带坏。
    private func respond(id: String, ok: Bool, code: Int, message: String, payload: [String: Any] = [:]) {
        guard let host = host else { return }
        var result: [String: Any] = [
            "id": id,
            "ok": ok,
            "payload": payload
        ]
        if ok == false {
            result["code"] = code
            result["message"] = message
        }
        guard JSONSerialization.isValidJSONObject(result),
              let data = try? JSONSerialization.data(withJSONObject: result, options: []),
              let json = String(data: data, encoding: .utf8) else {
            return
        }
        // 只调用固定函数名；JSON 由 JSONSerialization 生成，不拼接页面内容。
        let script = "window.__jiangshuiGeoResult && window.__jiangshuiGeoResult(" + json + ");"
        host.evaluate(script: script, completion: { _, _ in })
    }

    // 与 Android MainActivity.allowedGeoOrigin 一致：https + xgxt + 默认端口/443。
    /// 核对请求来自哪个页面：必须 https、必须 xgxt 域名、端口必须是默认或 443。
    /// 这一条就是「只给自家请假页定位」的闸门，和 Android 的 allowedGeoOrigin 对齐。
    private func allowedOrigin(_ origin: WKSecurityOrigin) -> Bool {
        let scheme = origin.`protocol`.lowercased()
        guard scheme == "https" else { return false }
        guard SchoolURLPolicy.isXgxtUrl("https://" + origin.host) else { return false }
        return origin.port == 0 || origin.port == 443
    }
}
