// 【这个文件干什么】主界面：上面一条纯色“挡板”，下面是一整页本地网页。
// 【什么时候会用到它】App 启动后一直显示；服务报错或拒绝协议时会盖上提示层。
// 【它和谁配合】WebHost 管网页和本地服务；这里只负责摆放和转发前后台事件。
import SwiftUI
import UIKit
import WebKit

/// 主界面：WKWebView + 顶部安全区色条 + 服务错误/拒绝协议覆盖层。返回键由 WebHost 的左边缘手势接管。
struct RootView: View {
    // host 是网页的“总遥控器”；它的状态一变，这里就重新画。
    @ObservedObject var host: WebHost

    // 监听 App 是前台还是后台；回到前台要叫醒网页。
    @Environment(\.scenePhase) private var scenePhase
    // 监听系统深色/浅色；网页和顶部色条都要跟着换。
    @Environment(\.colorScheme) private var colorScheme

    /// 页面骨架：底层铺一条不透明色带，中间盖网页，最上层是错误/拒绝协议的提示。
    var body: some View {
        ZStack(alignment: .topLeading) {
            // 顶部白条（对齐 Android MainActivity 的 appBackground 思路）：
            // WebView 只忽略底部安全区，顶部从安全区下沿开始；状态栏/灵动岛区域由这层不透明色填充。
            // 内容在 WebView 内滚动，clipsToBounds 保证它不会绘制到色条上，所以是「挡住」而不是「重叠」。
            Color(uiColor: host.shellBackgroundColor)
                .ignoresSafeArea()

            WebViewContainer(host: host)
                .ignoresSafeArea(.container, edges: .bottom)

            // 不再叠浮动返回按钮：它会压住页面标题（run #9 截图问题）。
            // 返回走左边缘右划手势（WebHost 的 UIScreenEdgePanGestureRecognizer），页面内各状态也都有自带按钮。

            if host.consentDeclined {
                declinedOverlay
            }
            if let message = host.serverError {
                serverErrorOverlay(message)
            }
        }
        .onAppear {
            host.startIfNeeded()
            // 首次显示时补一次提醒对账（含过期通知清理），并安排下一次后台刷新。
            BackgroundReminderScheduler.shared.handleForeground()
        }
        .onChange(of: scenePhase) { phase in
            host.scenePhaseChanged(phase)
            if phase == .active {
                BackgroundReminderScheduler.shared.handleForeground()
            } else if phase == .background {
                // 退后台前把下一次 BGTask 时间交给系统；执行时机由系统决定，不保证准时。
                BackgroundReminderScheduler.shared.schedule()
            }
        }
        .onChange(of: colorScheme) { scheme in
            host.colorSchemeChanged(scheme == .dark)
        }
    }

    // MARK: - 覆盖层

    /// 用户拒绝协议后的遮罩：提示“重开 App 才能再同意”，不提供继续使用入口。
    private var declinedOverlay: some View {
        ZStack {
            Color.black.opacity(0.45).ignoresSafeArea()
            VStack(spacing: 12) {
                Text("已拒绝用户协议")
                    .font(.headline)
                Text("重新打开 App 后可再次阅读并确认协议。")
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundColor(.secondary)
            }
            .padding(24)
            // 覆盖层卡片跟随页面背景色；固定 systemBackground 会在主题页面上出现第二种白。
            .background(Color(uiColor: host.shellBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .padding(32)
        }
        .transition(.opacity)
    }

    /// 服务起不来或页面加载失败时的遮罩；标题/正文由 WebHost 区分。
    private func serverErrorOverlay(_ message: String) -> some View {
        ZStack {
            Color.black.opacity(0.45).ignoresSafeArea()
            VStack(spacing: 14) {
                Text(host.serverErrorTitle)
                    .font(.headline)
                Text(message)
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundColor(.secondary)
                Button("重试") {
                    host.retryPage()
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(24)
            .background(Color(uiColor: host.shellBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .padding(32)
        }
    }
}

/// UIViewRepresentable 只是把 WebHost 里那一个 WKWebView 挂进 SwiftUI。
struct WebViewContainer: UIViewRepresentable {
    // 只传 host，不传 WebView 本身；这样 SwiftUI 刷新时不会误建第二个网页。
    let host: WebHost

    /// SwiftUI 第一次要显示网页时调用；这里只创建一次 WKWebView，以后都复用。
    func makeUIView(context: Context) -> WKWebView {
        let webView = host.makeWebView()
        WebViewContainer.attachPresentingController(webView)
        return webView
    }

    /// SwiftUI 每次刷新界面时调用；只重新挂弹窗用的页面控制器，不重新加载网页。
    func updateUIView(_ webView: WKWebView, context: Context) {
        WebViewContainer.attachPresentingController(webView)
    }

    /// WKWebView 挂进 window 之后才能拿到 rootViewController（用于原生弹窗/文件选择器）。
    /// window 在 makeUIView 阶段还是 nil，因此异步重试若干次（最多约 1 秒）。
    private static func attachPresentingController(_ webView: WKWebView, attempt: Int = 0) {
        DispatchQueue.main.async {
            if let root = webView.window?.rootViewController {
                PresentingViewControllerHolder.shared.topViewController = root.jsjTopMost
                return
            }
            if attempt < 5 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    attachPresentingController(webView, attempt: attempt + 1)
                }
            }
        }
    }
}
