// 【这个文件干什么】把网页选好的深浅色、背景色、卡片色应用到 iOS 原生窗口。
// 【什么时候会用到它】网页切换主题、跟随系统深浅色、启动时恢复主题时。
// 【它和谁配合】网页 app.mjs 的 setTheme、ThemeControlling 协议、UIWindow/UIViewController。
// 【小白提示】网页负责“配色”，这里负责把颜色刷到窗口和根视图上，避免网页和外壳颜色不一致。
import Foundation
import UIKit

/// Port of MainActivity.applyWindowTheme plus the setTheme validation. The web client sends the
/// resolved palette; the controller only validates and applies it to the window.
/// 主题控制器：校验颜色、记住最近一次配色，并在主线程把它应用到当前窗口。
final class ThemeController: ThemeControlling {
    // 只接受 #rgb 或 #rrggbb 两种十六进制颜色；其他写法一律判为非法。
    private let colorPattern = "^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$"
    // 记住最近一次应用的颜色，供窗口重建/启动恢复时重新刷上；nil 表示还没设置过。
    private var pendingBackground: UIColor?
    private var pendingSurface: UIColor?
    private var pendingDark: Bool?
    /// 桌面图标切换失败时写诊断日志；由 NativeServices 接到 StateStore.log。
    var log: ((String) -> Void)?

    /// 判断系统当前是不是深色模式；这里看屏幕的真实外观，不受 App 自己覆盖的影响。
    func isSystemDark() -> Bool {
        // UIScreen reports the system appearance; an app override set on the window does not affect it.
        return UIScreen.main.traitCollection.userInterfaceStyle == .dark
    }

    /// 校验并应用主题：两个颜色必须合法，dark 决定窗口用深色还是浅色外观。
    /// 颜色非法会抛“主题颜色无效”；真正改 UI 的操作切到主线程执行。
    func apply(background: String, surface: String, preference: String, dark: Bool) throws -> JSONObject {
        guard background.range(of: colorPattern, options: .regularExpression) != nil,
              surface.range(of: colorPattern, options: .regularExpression) != nil else {
            throw BridgeFailure.message("主题颜色无效")
        }
        guard let background_color = ThemeController.parseColor(background),
              let surface_color = ThemeController.parseColor(surface) else {
            throw BridgeFailure.message("主题颜色无效")
        }
        let style: UIUserInterfaceStyle = dark ? .dark : .light
        pendingBackground = background_color
        pendingSurface = surface_color
        pendingDark = dark
        DispatchQueue.main.async {
            self.applyToWindow(background: background_color, surface: surface_color, style: style)
        }
        return ["ok": true]
    }

    /// 切换桌面图标：water → AppIconWater，其它值 → 默认图标。
    /// 只在目标与当前不同时调用系统 API，避免每次启动都重复设置/弹系统提示。
    func applyIconTheme(_ value: String) {
        let desired: String? = value == "water" ? "AppIconWater" : nil
        DispatchQueue.main.async { [weak self] in
            // 系统图标 API 只在主线程调用；目标与当前一致时不重复设置，避免多余的系统提示。
            if UIApplication.shared.alternateIconName == desired { return }
            UIApplication.shared.setAlternateIconName(desired, completionHandler: { error in
                guard let error = error else { return }
                // 失败不抛给网页，也不阻断课表保存/启动；写一行诊断日志方便排查。
                self?.log?("icon-theme apply failed " + error.localizedDescription)
            })
        }
    }

    /// 注销或退出时恢复系统默认外观：清掉覆盖样式、背景色和根视图背景。
    func restore() {
        pendingBackground = nil
        pendingSurface = nil
        pendingDark = nil
        DispatchQueue.main.async {
            guard let window = ThemeController.keyWindow() else { return }
            window.overrideUserInterfaceStyle = .unspecified
            window.backgroundColor = nil
            window.rootViewController?.view.backgroundColor = nil
        }
    }

    /// 把背景色刷到窗口、卡片色刷到根视图，并设置窗口的深浅色外观。
    private func applyToWindow(background: UIColor, surface: UIColor, style: UIUserInterfaceStyle) {
        guard let window = ThemeController.keyWindow() else { return }
        window.overrideUserInterfaceStyle = style
        window.backgroundColor = background
        window.rootViewController?.view.backgroundColor = surface
    }

    /// 找当前正在使用的窗口；先找 keyWindow，找不到就退而求其次用第一个窗口。
    private static func keyWindow() -> UIWindow? {
        let scenes = UIApplication.shared.connectedScenes
        for scene in scenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            if let key = windowScene.windows.first(where: { $0.isKeyWindow }) { return key }
        }
        for scene in scenes {
            if let windowScene = scene as? UIWindowScene, let first = windowScene.windows.first { return first }
        }
        return nil
    }

    /// 把 #abc 或 #aabbcc 解析成 UIColor；格式不对返回 nil，由调用方统一报错。
    private static func parseColor(_ value: String) -> UIColor? {
        var hex = value
        if hex.hasPrefix("#") { hex.removeFirst() }
        if hex.count == 3 {
            var expanded = ""
            for character in hex { expanded.append(character); expanded.append(character) }
            hex = expanded
        }
        guard hex.count == 6, let number = UInt32(hex, radix: 16) else { return nil }
        let red = CGFloat((number >> 16) & 0xFF) / 255.0
        let green = CGFloat((number >> 8) & 0xFF) / 255.0
        let blue = CGFloat(number & 0xFF) / 255.0
        return UIColor(red: red, green: green, blue: blue, alpha: 1.0)
    }
}