// 【这个文件干什么】记录「请假页面是否真的被用户看见过、是否加载完成」，并在关闭时通知网页。
// 【为什么要单独一个文件】iOS 的 SchoolWebViewHost.hide 会先把 isUserVisible 置 false，
//   所以不能等关闭后再问页面可不可见；必须在页面加载完成的那一刻就把状态记下来。
// 【对照 Android】MainActivity.java:355-364 的 hideWebApp：
//   只有 wasVisible && webApp != null && pageReady 时才执行 window.onLeaveServiceReturn。
// 【什么时候会用到它】打开/关闭请假、销假、续假页面；自动读课表（无头）关闭时不应触发。
import Foundation

/// 请假服务的「返回网页」一次性状态记录器。
/// 所有方法都必须在主线程调用；本类不加锁，避免和 WebKit 回调顺序打架。
final class SchoolLeaveServiceReturnTracker {
    // 用户是否真的看到过请假页面（页面加载完成时容器处于可见状态）。
    private var wasVisible = false
    // 请假页面是否至少完成过一次加载（Android 的 pageReady）。
    private var pageReady = false
    // 本次打开是否已经回调过，防止 dismiss 动画/重复 close 触发多次。
    private var sent = false
    // 注销或重登期间抑制回调，避免把「注销关闭」误当成「从请假服务返回」。
    private var suppressed = false

    /// 打开或关闭一次请假服务时清空三个一次性标志。
    func reset() {
        wasVisible = false
        pageReady = false
        sent = false
    }

    /// 注销开始时调用：在关闭容器之前先关掉回调出口。
    func suppress() {
        suppressed = true
    }

    /// 注销结束后恢复；此时旧容器已经被拆掉，不会再有迟到的回调。
    func resume() {
        suppressed = false
    }

    /// 请假页面加载完成时调用；isVisible 取容器当时的真实可见状态。
    func pageDidFinish(isVisible: Bool) {
        pageReady = true
        if isVisible {
            wasVisible = true
        }
    }

    /// 满足 Android 的 wasVisible && pageReady 时，只回调一次。
    /// - Parameters:
    ///   - hostIsLeaveApp: 当前容器是否仍是请假容器（学校页不能误触发）。
    ///   - callback: 网页的 onLeaveServiceReturn 出口。
    func notifyIfNeeded(hostIsLeaveApp: Bool, callback: (() -> Void)?) {
        guard suppressed == false else { return }
        guard sent == false else { return }
        guard wasVisible, pageReady else { return }
        guard hostIsLeaveApp else { return }
        // 先置位再回调：回调里若再次关闭页面，也不会递归触发第二次。
        sent = true
        callback?()
    }
}
