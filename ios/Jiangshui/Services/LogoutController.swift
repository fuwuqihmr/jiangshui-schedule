// 【这个文件干什么】用户点“注销”后，按固定顺序把本机保存的登录痕迹和课表数据清理干净。
// 【什么时候会用到它】网页调用 logout 这个桥接动作时。
// 【它和谁配合】同意记录、课表文件、上课提醒、学校会话、主题和网页数据存储。
// 【小白提示】清理顺序很重要：先撤同意、再删数据，避免清到一半留下“半登录”状态。
// 【注意】网页缓存（WKWebView）的清理是异步的，这里不阻塞等它；外层 WebHost 会再清一次。
import Foundation
import WebKit

/// Logout cleanup in the same order as MainActivity.java:755. Android destroys its WebView and
/// cookie manager synchronously; WKWebView removal is asynchronous, so this schedules the data
/// store cleanup without blocking the bridge thread and replies immediately. A's WebHost runs a
/// second clear + reload after the reply.
/// 注销清理器：把“这台手机上还认得你”的东西逐个删掉，最后回 {ok:true}。
/// 任何一步失败都不影响后面的步骤，保证能清多少清多少。
final class LogoutController {
    private let consent: ConsentStoring
    private let state: StateStoring
    private let reminders: ClassReminding
    private let vault: SessionVaulting
    private let school: SchoolProviding
    private let theme: ThemeControlling

    /// 构造时把要用到的服务“借”进来，方便测试时替换成假实现。
    init(consent: ConsentStoring, state: StateStoring, reminders: ClassReminding,
         vault: SessionVaulting, school: SchoolProviding, theme: ThemeControlling) {
        self.consent = consent
        self.state = state
        self.reminders = reminders
        self.vault = vault
        self.school = school
        self.theme = theme
    }

    /// 执行注销：撤同意 → 清提醒 → 取消教务读取 → 恢复主题 → 清请假会话。
    /// 然后删课表文件、清 Keychain 里的学校会话，最后异步清网页 Cookie/缓存。
    /// 顺序照抄 Android MainActivity 的注销分支，避免旧登录态残留。
    func logout() -> JSONObject {
        consent.revoke()
        reminders.clearAll()
        // Android also cancels the daily check and pending school reads.
        do { _ = try school.cancelRead() } catch { }
        theme.restore()
        // 对应 Android 注销时清 leave-session SharedPreferences：请假页的 uid / pageEnc
        // 属于登录态，不能留在设备上。
        school.clearLeaveSession()
        state.clear()
        do { try vault.clear() } catch { }
        removeWebsiteData()
        return ["ok": true]
    }

    /// 清掉 WKWebView 的 Cookie 和网站缓存；回调可能回到主线程，所以这里只“点火”不等待。
    /// 如果在这里死等回调，而桥接也在主线程，就会互相卡住（死锁）。
    private func removeWebsiteData() {
        let store = WKWebsiteDataStore.default()
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        // WKWebView cleanup callbacks land on the main thread and the bridge runs on the main
        // thread too, so blocking here would deadlock. Fire the cleanup and let A's WebHost run its
        // own clear + reload after the reply; Android's CookieManager callback is asynchronous too.
        store.removeData(ofTypes: types, modifiedSince: .distantPast, completionHandler: { })
        let cookies = store.httpCookieStore
        cookies.getAllCookies { list in
            for cookie in list { cookies.delete(cookie, completionHandler: nil) }
        }
    }
}