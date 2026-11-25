// 职责：日历同步展示卡，Phase 6 未接入时禁用，不伪造可用。
// 依赖：现有 string/color/float token；页面不向他传业务状态。
// 阶段：P3；待 Phase 6 接 CalendarKit，权限说明待官方文档确认。
// 新增 string 键：calendar_card_title/calendar_phase_status/calendar_desc/calendar_permission_hint/calendar_action_disabled
@Component
export struct CalendarCard {
  @Prop enabled: boolean = false;
  @Prop status: string = 'unavailable';
  onAction: () => void = () => {};
  @Prop lastSyncText: string = '';
  onOpenPermissionHelp: () => void = () => {};
  onWrite: () => void = () => {};
  onRemove: () => void = () => {};
  onOpenCalendar: () => void = () => {};

  build() {
    Column({ space: $r('app.float.float_space_8') }) {
      Row({ space: $r('app.float.float_space_8') }) {
        Text($r('app.string.calendar_card_title'))
          .fontSize($r('app.float.float_font_16'))
          .fontColor($r('app.color.color_text_primary'))
          .fontWeight(FontWeight.Medium)
        Text($r('app.string.calendar_phase_status'))
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_text_secondary'))
          .backgroundColor($r('app.color.color_neutral_soft'))
          .borderRadius($r('app.float.float_radius_pill'))
          .padding({ left: $r('app.float.float_space_8'), right: $r('app.float.float_space_8') })
      }
      .width('100%')

      Text($r('app.string.calendar_last_sync') + this.lastSyncText).fontSize($r('app.float.float_font_12')).fontColor($r('app.color.color_text_secondary')).width('100%')
      Text($r('app.string.calendar_desc'))
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_text_secondary'))
        .width('100%')

      Button($r('app.string.calendar_action_write'))
        .height($r('app.float.float_touch_min'))
        .width('100%')
        .backgroundColor($r('app.color.color_accent_button'))
        .fontColor($r('app.color.color_on_accent'))
        .enabled(this.enabled)
        .onClick(() => { this.onWrite(); })
      Button($r('app.string.calendar_action_remove'))
        .height($r('app.float.float_touch_min'))
        .width('100%')
        .backgroundColor($r('app.color.color_neutral_soft'))
        .enabled(this.enabled)
        .onClick(() => { this.onRemove(); })
      Button($r('app.string.calendar_action_open'))
        .height($r('app.float.float_touch_min'))
        .width('100%')
        .onClick(() => { this.onOpenCalendar(); })
        .height($r('app.float.float_touch_min'))
        .width('100%')
        .fontSize($r('app.float.float_font_13'))
        .enabled(this.enabled)
        .backgroundColor($r('app.color.color_neutral_soft'))
        .fontColor($r('app.color.color_text_disabled'))

      Text($r('app.string.calendar_permission_hint'))
        .fontSize($r('app.float.float_font_12'))
        .fontColor($r('app.color.color_text_secondary'))
        .width('100%')
        .onClick(() => { this.onOpenPermissionHelp(); })
    }
    .width('100%')
    .padding($r('app.float.float_card_padding'))
    .backgroundColor($r('app.color.color_surface'))
    .borderRadius($r('app.float.float_radius_card'))
    .alignItems(HorizontalAlign.Start)
  }
}



