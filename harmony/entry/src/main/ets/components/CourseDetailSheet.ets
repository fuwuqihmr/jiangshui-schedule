// 职责：课程详情底部面板。
// 依赖方向：components -> core/viewmodel 类型 only。
// 阶段：P2；bindSheet 行为待 Previewer。
import type { CourseDetailView } from '../core/viewmodel/DayViewModel';

@Component
export struct CourseDetailSheet {
  detail: CourseDetailView = {} as CourseDetailView;
  onClose: () => void = () => {};
  build() {
    Column({ space: 8 }) {
      Text($r('app.string.detail_title')).fontSize($r('app.float.float_font_20')).fontColor($r('app.color.color_text_primary')).fontWeight(FontWeight.Medium)
      Text(this.detail.name).fontSize($r('app.float.float_font_16')).fontColor($r('app.color.color_text_primary'))
      Text(this.detail.timeText).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary'))
      Text(this.detail.room).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary'))
      Text(this.detail.teacher).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary'))
      Text(this.detail.statusLabel).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
      Button($r('app.string.detail_close')).width('100%').height($r('app.float.float_touch_min'))
        .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
        .backgroundColor($r('app.color.color_surface'))
        .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
        .borderRadius($r('app.float.float_radius_control'))
        .onClick(() => this.onClose())
    }.padding($r('app.float.float_card_padding')).width('100%')
      .backgroundColor($r('app.color.color_surface'))
      .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') })
      .borderRadius($r('app.float.float_radius_modal'))
      .shadow({ radius: 16, color: $r('app.color.color_shadow'), offsetX: 0, offsetY: 6 })
  }
}
