import Foundation
import ActivityKit

/// 实时活动的共享数据契约。
///
/// 这个文件会被同时编译进主 App target 与 Widget Extension target：
/// - 主 App 用它在 task-33 里启动/更新/结束 Activity；
/// - Widget Extension 用它渲染锁屏卡片与灵动岛。
/// 两个 target 各自编译一份，所以这里不要引入任何跨模块可见性假设，
/// 字段名与类型一旦改动必须两边一起改。
///
/// 最低系统为 iOS 16.1（ActivityKit 的起始版本），主 App 仍是 iOS 15.0，
/// 因此整个类型标注 @available(iOS 16.1, *)；主 App 在低版本上只做编译，
/// 不会在运行时触碰这个类型。
@available(iOS 16.1, *)
struct ClassActivityAttributes: ActivityAttributes {
    /// 会随时间变化的部分：这节课的开始/结束时间。
    /// ContentState 必须同时满足 Codable 与 Hashable（ActivityKit 协议要求）。
    struct ContentState: Codable, Hashable {
        let startDate: Date
        let endDate: Date

        init(startDate: Date, endDate: Date) {
            self.startDate = startDate
            self.endDate = endDate
        }
    }

    /// 整节活动期间不变的部分。
    let courseName: String
    let location: String
    let startDate: Date
    let endDate: Date

    init(courseName: String, location: String, startDate: Date, endDate: Date) {
        self.courseName = courseName
        self.location = location
        self.startDate = startDate
        self.endDate = endDate
    }
}
