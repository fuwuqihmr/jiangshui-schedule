// 【这个文件干什么】给“学校读取”加一个可选的进度回调能力，让网页能显示“正在检查会话/正在读课表”。
// 【什么时候会用到它】BridgeDispatcher 启动一次 capture 时挂上，读取结束（成功/失败/取消）后摘掉。
// 【它和谁配合】SchoolProvider 实现它（把回调转给 SchoolReadController），BridgeDispatcher 用 as? 探测。
// 【小白提示】这是“可插拔”的小接口：测试替身不实现它也不会坏，只是网页看不到阶段文案。
import Foundation

/// 学校读取阶段进度回调能力（S 档，对应 Android MainActivity.progress(String)）。
///
/// 不放进 Lead 写定的 `ServiceProtocols.swift`（那份契约不允许改签名），而是单独的可选能力：
/// 桥接层 `services.school as? SchoolReadProgressReporting` 探测，只有真正的 SchoolProvider 会实现。
public protocol SchoolReadProgressReporting: AnyObject {
    /// 读取阶段文案回调；nil 表示当前没有读取在等进度（不再转发）。
    var onReadProgress: ((String) -> Void)? { get set }
}
