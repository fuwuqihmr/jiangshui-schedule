// 【这个文件干什么】native → web 的“事件通道”：把读取进度、从请假页返回这两类通知发给网页。
// 【什么时候会用到它】学校课表读取过程中（进度文案）、用户从请假服务页回到主界面时。
// 【它和谁配合】JSBridge 实现它；BridgeDispatcher / WebHost 通过 as? 探测后使用。
// 【小白提示】请求回包是“你问我答”（每个 id 只答一次）；事件是“我主动喊你一声”，没有 Promise 可答，
// 所以单独走一条通道，不占用回包的“同一 id 只回一次”名额。
import Foundation

/// native → web 的事件通道（S 档）。
///
/// 与 `BridgeTransport`（请求回包）分开：
/// - 回包：`window.onNativeResult(id, {value|error})`，每个请求 id 恰好一次；
/// - 事件：`window.onNativeProgress(id, text)` / `window.onLeaveServiceReturn()`，可以 0 次或多次。
///
/// 由 `JSBridge` 实现；`BridgeDispatcher` 只做 `transport as? BridgeEventSending` 探测，
/// 因此测试替身（只实现 BridgeTransport）不会因为缺少事件能力而编译失败或运行报错。
protocol BridgeEventSending: AnyObject {
    /// 学校读取阶段文案（对应 web/app.mjs 的 window.onNativeProgress）。
    /// - Parameters:
    ///   - id: 正在等待回包的桥接请求 id；web 用它判断是否还在读取。
    ///   - text: 可直接展示的中文阶段文案。
    func sendReadProgress(id: String, text: String)
    /// 从请假服务页回到网页主界面（对应 web/app.mjs 的 window.onLeaveServiceReturn）。
    func sendLeaveServiceReturn()
}
