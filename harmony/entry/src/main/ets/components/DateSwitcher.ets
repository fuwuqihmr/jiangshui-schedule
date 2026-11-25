// 职责：日期切换控件。
// 依赖方向：components -> ArkUI only。
// 阶段：P2；DatePickerDialog 待真机确认。
@Component
export struct DateSwitcher {
  dateKey: string = '';
  label: string = '';
  onPrev: () => void = () => {};
  onNext: () => void = () => {};
  onPick: () => void = () => {};
  build() {
    Row({ space: 8 }) {
      Button($r('app.string.prev_day')).height($r('app.float.float_touch_min'))
        .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
        .backgroundColor($r('app.color.color_surface'))
        .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
        .borderRadius($r('app.float.float_radius_control'))
        .onClick(() => this.onPrev())
      Button(this.label + ' ' + this.dateKey).height($r('app.float.float_touch_min'))
        .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
        .backgroundColor($r('app.color.color_surface'))
        .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
        .borderRadius($r('app.float.float_radius_control'))
        .onClick(() => this.onPick())
      Button($r('app.string.next_day')).height($r('app.float.float_touch_min'))
        .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
        .backgroundColor($r('app.color.color_surface'))
        .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
        .borderRadius($r('app.float.float_radius_control'))
        .onClick(() => this.onNext())
    }.width('100%').justifyContent(FlexAlign.SpaceBetween)
  }
}
