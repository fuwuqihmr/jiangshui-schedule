import ActivityKit
import SwiftUI
import WidgetKit

/// 上课实时活动的锁屏/灵动岛卡片。
///
/// 数据来自 ClassActivityAttributes（与主 App 共享源码），这里只负责展示，
/// 不做任何网络或存储访问，避免扩展进程被系统限制时出问题。
@available(iOS 16.1, *)
struct ClassActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ClassActivityAttributes.self) { context in
            lockScreenView(context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.courseName)
                        .font(.caption)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    remainingText(context.state)
                        .font(.caption)
                        .monospacedDigit()
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 8) {
                        if !context.attributes.location.isEmpty {
                            Text(context.attributes.location)
                                .lineLimit(1)
                        }
                        Text(context.attributes.startDate, style: .time)
                    }
                    .font(.caption2)
                }
            } compactLeading: {
                Text(context.attributes.courseName)
                    .font(.caption2)
                    .lineLimit(1)
            } compactTrailing: {
                remainingText(context.state)
                    .font(.caption2)
                    .monospacedDigit()
            } minimal: {
                Text("课")
                    .font(.caption2)
            }
        }
    }

    /// 锁屏与通知横幅共用的卡片；灵动岛区域空间小，用单独的精简布局。
    @ViewBuilder
    private func lockScreenView(_ context: ActivityViewContext<ClassActivityAttributes>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(context.attributes.courseName)
                    .font(.headline)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if !context.attributes.location.isEmpty {
                    Text(context.attributes.location)
                        .font(.caption)
                        .lineLimit(1)
                }
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(context.attributes.startDate, style: .time)
                    .font(.subheadline)
                    .monospacedDigit()
                Spacer(minLength: 4)
                remainingText(context.state)
                    .font(.subheadline)
                    .monospacedDigit()
            }
        }
        .foregroundColor(.white)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(red: 0.10, green: 0.14, blue: 0.20))
    }

    /// 结束时间还没到时显示系统倒计时；已结束就显示文案，避免
    /// Date()...endDate 在 endDate 已过去时触发 ClosedRange 的前置条件崩溃。
    @ViewBuilder
    private func remainingText(_ state: ClassActivityAttributes.ContentState) -> some View {
        if state.endDate > Date() {
            Text(timerInterval: Date()...state.endDate, countsDown: true)
        } else {
            Text("已结束")
        }
    }
}
