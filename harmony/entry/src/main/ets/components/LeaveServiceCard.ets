// 职责：请假服务展示卡，只渲染入口与能力说明，不直接打开 Web。
// 依赖：pages 传入回调；依赖资源 string/color/float。
// 阶段：P3；待官方文档确认 Web 能力状态来源。
// 新增 string 键：leave_card_title/leave_card_badge/leave_card_desc_1/leave_card_desc_2/leave_action_leave/leave_action_cancel/leave_action_renew/leave_unavailable_hint
@Component
export struct LeaveServiceCard {
  @Prop webAvailable: boolean = false;
  @Prop leaveCount: number = 0;
  @Prop statusText: ResourceStr = '';
  @Prop unavailableHint: ResourceStr = $r('app.string.leave_unavailable_hint');
  onOpen: (key: string) => void = () => {};
  onLeave: () => void = () => {};
  onCancel: () => void = () => {};
  onRenew: () => void = () => {};

  build() {
    Column({ space: $r('app.float.float_space_8') }) {
      Row({ space: $r('app.float.float_space_8') }) {
        Text($r('app.string.leave_card_title'))
          .fontSize($r('app.float.float_font_16')).fontColor($r('app.color.color_text_primary')).fontWeight(FontWeight.Medium)
        Text($r('app.string.leave_card_badge'))
          .fontSize($r('app.float.float_font_11')).fontColor($r('app.color.color_link'))
          .backgroundColor($r('app.color.color_accent_soft'))
          .borderRadius($r('app.float.float_radius_pill'))
          .padding({ left: $r('app.float.float_space_8'), right: $r('app.float.float_space_8') })
      }.width('100%')
      Text($r('app.string.leave_card_desc_1')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary')).width('100%')
      Text($r('app.string.leave_card_desc_2')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary')).width('100%')
      Row() { Text(this.statusText).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary')).layoutWeight(1); Text(this.leaveCount.toString()).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary')) }.width('100%')
      Row({ space: $r('app.float.float_space_8') }) {
        Button($r('app.string.leave_action_leave')).height($r('app.float.float_touch_min')).layoutWeight(1)
          .fontSize($r('app.float.float_font_13')).enabled(this.webAvailable).backgroundColor($r('app.color.color_accent_button')).fontColor($r('app.color.color_on_accent')).onClick(() => { this.onOpen('leave'); })
        Button($r('app.string.leave_action_cancel')).height($r('app.float.float_touch_min')).layoutWeight(1)
          .fontSize($r('app.float.float_font_13')).enabled(this.webAvailable).backgroundColor($r('app.color.color_accent_button')).fontColor($r('app.color.color_on_accent')).onClick(() => { this.onOpen('cancel'); })
        Button($r('app.string.leave_action_renew')).height($r('app.float.float_touch_min')).layoutWeight(1)
          .fontSize($r('app.float.float_font_13')).enabled(this.webAvailable).backgroundColor($r('app.color.color_accent_button')).fontColor($r('app.color.color_on_accent')).onClick(() => { this.onOpen('renew'); })
      }.width('100%')
      if (!this.webAvailable) {
        Text(this.unavailableHint).fontSize($r('app.float.float_font_12')).fontColor($r('app.color.color_text_secondary')).width('100%')
      }
    }.width('100%').padding($r('app.float.float_card_padding')).backgroundColor($r('app.color.color_surface'))
      .borderRadius($r('app.float.float_radius_card')).alignItems(HorizontalAlign.Start)
  }
}




