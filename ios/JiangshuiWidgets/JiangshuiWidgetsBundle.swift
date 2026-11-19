import SwiftUI
import WidgetKit

/// Widget Extension 的唯一入口。
/// 当前只挂了「上课实时活动」一个 Widget；以后要加桌面小组件时在这里追加。
@main
struct JiangshuiWidgetsBundle: WidgetBundle {
    var body: some Widget {
        ClassActivityWidget()
    }
}
