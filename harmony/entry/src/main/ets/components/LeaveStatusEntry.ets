// 职责：今日页底部假条状态入口。
// 依赖方向：components -> ArkUI only。
// 阶段：P2 入口；P3 接内容。
@Component
export struct LeaveStatusEntry {
  onOpen: () => void = () => {};
  build() {
    Button($r('app.string.day_leave_status_entry')).width('100%').height($r('app.float.float_touch_min'))
      .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_link'))
      .backgroundColor($r('app.color.color_surface'))
      .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
      .borderRadius($r('app.float.float_radius_control'))
      .onClick(() => this.onOpen())
  }
}

