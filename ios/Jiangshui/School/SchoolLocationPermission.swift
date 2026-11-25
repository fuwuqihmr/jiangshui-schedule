// 【这个文件干什么】向 iOS 申请「定位权限」，并取一次用户当前坐标，交给网页使用。
// 【什么时候会用到它】请假页需要定位打卡或自动填地点时；用一次就结束，不持续跟踪。
// 【它和谁配合】网页里的 navigator.geolocation 被 SchoolGeolocationBridge 换成了一个
//   「假零件」，假零件收到网页的定位请求就转给本类去问系统，拿到坐标再塞回网页。
// 【为什么绕这么一圈】iOS 15–26 的 WKWebView 没给 App 开放「网页定位授权」的入口（Apple 的
//   requestGeolocationPermissionForOrigin 要到 iOS 27 才有），网页自己拿不到定位，只能原生代劳。
// 【关键约束】授权和定位这两条回调都必须、而且只能调用一次，重复调用会让网页那边逻辑错乱。
import Foundation
import CoreLocation

// 定位授权 + 取一次坐标。
//
// 背景（必须写清楚，防止后来者误以为系统回调可用）：
// - Apple 文档标明 WKUIDelegate 的 requestGeolocationPermissionForOrigin 是 iOS 27.0 才引入；
//   iOS 15–26 的 WKWebView 不会调用它，WebKit Bug 304148 也确认当前没有公开的定位授权入口。
// - 因此实际定位走 SchoolGeolocationBridge 注入的 navigator.geolocation shim：JS 把请求
//   转给原生，原生用本类申请系统授权并取一次坐标，再回填给页面。
// - request(prompt:completion:) 只保留给未来 iOS 27 的系统回调（当前不会走到），
//   requestLocation 才是现在真正使用的路径。
//
// decisionHandler / completion 必须且只能调用一次：用单例持有 pending 回调，
// 用户点「允许/不允许」后由 CLLocationManager 回调统一 finish。
// 本机 Windows 无 Xcode/swiftc，未编译验证。
/// 定位权限的「代办员」。它是单例：整个 App 只有一个，因为系统定位服务也只该有一个委托人。
/// 两条入口：request(prompt:completion:) 留给未来 iOS 27 的系统回调（现在走不到）；
/// requestLocation(prompt:completion:) 才是当前网页定位真正走的那条路。
final class SchoolLocationPermission: NSObject, CLLocationManagerDelegate {

    // 单例：定位权限是全局状态，多个对象各持一个 CLLocationManager 会互相打架。
    static let shared = SchoolLocationPermission()

    private let manager = CLLocationManager()
    // 下面四个是「等系统回话」时暂存的现场：谁在等授权、要不要弹说明、谁在等坐标，
    // 以及这次定位是否已经发出去过（防止重复 requestLocation）。
    private var authorizationCompletion: ((Bool) -> Void)?
    private var authorizationPrompt: (() -> Void)?
    private var locationCompletion: ((Result<CLLocation, Error>) -> Void)?
    private var locationRequestStarted = false

    private override init() {
        super.init()
        manager.delegate = self
    }

    // iOS 27+ 的 WKUIDelegate 授权回调使用；iOS 15–26 不会调用。
    /// 询问「网页能不能用定位」，回调 true / false（留给 iOS 27+ 的系统回调，当前走不到）。
    /// 若上一次还没回话，先给上一次回 false，保证每个回调都只被调用一次。
    func request(prompt: @escaping () -> Void, completion: @escaping (Bool) -> Void) {
        assert(Thread.isMainThread)
        // 理论上 WebKit 不会并发问两次；真发生时为上一个请求回 deny，保证回调只调一次。
        if let pending = authorizationCompletion {
            authorizationCompletion = nil
            authorizationPrompt = nil
            pending(false)
        }
        authorizationCompletion = completion
        authorizationPrompt = prompt
        guard CLLocationManager.locationServicesEnabled() else {
            finishAuthorization(false)
            return
        }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            finishAuthorization(true)
        case .denied, .restricted:
            finishAuthorization(false)
        case .notDetermined:
            prompt()
            manager.requestWhenInUseAuthorization()
        @unknown default:
            finishAuthorization(false)
        }
    }

    // 供 SchoolGeolocationBridge 调用（主线程）：申请授权并取一次当前位置。
    /// 网页要定位时走这里：没授权就先弹系统授权框，已授权就直接去取一次坐标。
    /// 结果以 Result（成功带坐标 / 失败带错误码）回给调用方，且只回一次。
    func requestLocation(prompt: (() -> Void)?, completion: @escaping (Result<CLLocation, Error>) -> Void) {
        assert(Thread.isMainThread)
        // 新的请求覆盖旧请求：旧请求先失败，避免 shim 的 JS 超时后原生仍永久挂起。
        if let pending = locationCompletion {
            locationCompletion = nil
            locationRequestStarted = false
            pending(.failure(locationError(code: 2, message: "已有新的定位请求")))
        }
        locationCompletion = completion
        guard CLLocationManager.locationServicesEnabled() else {
            finishLocation(.failure(locationError(code: 2, message: "系统定位服务未开启")))
            return
        }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            startLocation()
        case .denied:
            finishLocation(.failure(locationError(code: 1, message: "定位权限被拒绝")))
        case .restricted:
            finishLocation(.failure(locationError(code: 1, message: "定位权限受限")))
        case .notDetermined:
            prompt?()
            manager.requestWhenInUseAuthorization()
        @unknown default:
            finishLocation(.failure(locationError(code: 2, message: "无法获取定位权限")))
        }
    }

    /// 真正发起「取一次位置」。若已经有请求在跑就直接返回，免得反复打扰系统。
    /// desiredAccuracy 用百米级：请假定位不需要卫星级精度，省电也更快出结果。
    private func startLocation() {
        guard locationCompletion != nil, locationRequestStarted == false else { return }
        locationRequestStarted = true
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.requestLocation()
    }

    /// 系统授权状态变化（用户点了允许 / 不允许）时回调。这里要把「等授权的」和「等坐标的」
    /// 两种等待都照顾到：前者回 true / false，后者视情况继续取坐标或直接失败。
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if authorizationCompletion != nil {
            switch manager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways:
                finishAuthorization(true)
            case .denied, .restricted:
                finishAuthorization(false)
            case .notDetermined:
                // 系统授权弹窗还没结束，等下一次回调。
                break
            @unknown default:
                finishAuthorization(false)
            }
        }
        if locationCompletion != nil {
            switch manager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways:
                startLocation()
            case .denied:
                finishLocation(.failure(locationError(code: 1, message: "定位权限被拒绝")))
            case .restricted:
                finishLocation(.failure(locationError(code: 1, message: "定位权限受限")))
            case .notDetermined:
                break
            @unknown default:
                finishLocation(.failure(locationError(code: 2, message: "无法获取定位权限")))
            }
        }
    }

    /// 拿到坐标了（可能一次给多个，取最后一个最新的）。
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else {
            finishLocation(.failure(locationError(code: 2, message: "无法获取当前位置")))
            return
        }
        finishLocation(.success(location))
    }

    /// 取坐标失败（比如系统定位刚开还没热起来），把系统错误原样转给调用方。
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finishLocation(.failure(error))
    }

    /// 结束「等授权」：把暂存的回调取出来、清空现场，必要时切回主线程再调用，保证只调一次。
    private func finishAuthorization(_ granted: Bool) {
        guard let handler = authorizationCompletion else { return }
        authorizationCompletion = nil
        authorizationPrompt = nil
        if Thread.isMainThread {
            handler(granted)
        } else {
            DispatchQueue.main.async { handler(granted) }
        }
    }

    /// 结束「等坐标」：同样先清空现场再回调，顺带把「已发起」标记复位，方便下次再用。
    private func finishLocation(_ result: Result<CLLocation, Error>) {
        guard let handler = locationCompletion else { return }
        locationCompletion = nil
        locationRequestStarted = false
        if Thread.isMainThread {
            handler(result)
        } else {
            DispatchQueue.main.async { handler(result) }
        }
    }

    // 给 JS 的 GeolocationPositionError.code：1=PERMISSION_DENIED、2=POSITION_UNAVAILABLE、3=TIMEOUT。
    private func locationError(code: Int, message: String) -> NSError {
        return NSError(domain: "SchoolLocation", code: code,
                       userInfo: [NSLocalizedDescriptionKey: message])
    }
}
