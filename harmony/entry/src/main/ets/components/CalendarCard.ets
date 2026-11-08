// 职责：日历同步展示卡，Phase 6 未接入时禁用，不伪造可用。
// 依赖：现有 string/color/float token；页面不向他传业务状态。
// 阶段：P3；待 Phase 6 接 CalendarKit，权限说明待官方文档确认。
// 新增 string 键：calendar_card_title/calendar_phase_status/calendar_desc/calendar_permission_hint/calendar_action_disabled
@Component
export struct CalendarCard {
  // 注意：`enabled` 与 `borderColor` 等是 CustomComponent 的内置属性名，作为 @Prop 会与基类签名冲突，
  // 故日历动作开关改名为 actionsEnabled。
  @Prop actionsEnabled: boolean = false;
  @Prop status: string = 'unavailable';
  onAction: () => void = () => {};
  @Prop lastSyncText: ResourceStr = '';
  onOpenPermissionHelp: () => void = () => {};
  onWrite: () => void = () => {};
  onRemove: () => void = () => {};
  onOpenCalendar: () => void = () => {};

  build() {
    Column({ space: $r('app.float.float_space_12') }) {
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
          .padding({ left: $r('app.float.float_space_8'), right: $r('app.float.float_space_8'), top: 2, bottom: 2 })
      }
      .width('100%')

      Text() {
        Span($r('app.string.calendar_last_sync'))
        Span(this.lastSyncText)
      }.fontSize($r('app.float.float_font_12')).fontColor($r('app.color.color_text_secondary')).width('100%')
      Text($r('app.string.calendar_desc'))
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_text_secondary'))
        .width('100%')

      Column({ space: $r('app.float.float_space_8') }) {
        Button($r('app.string.calendar_action_write'))
          .height($r('app.float.float_touch_min'))
          .width('100%')
          .fontSize($r('app.float.float_font_13'))
          .backgroundColor($r('app.color.color_accent_button'))
          .fontColor($r('app.color.color_on_accent'))
          .borderRadius($r('app.float.float_radius_control'))
          .enabled(this.actionsEnabled)
          .onClick(() => { this.onWrite(); })
        Button($r('app.string.calendar_action_remove'))
          .height($r('app.float.float_touch_min'))
          .width('100%')
          .fontSize($r('app.float.float_font_13'))
          .backgroundColor($r('app.color.color_surface_soft'))
          .fontColor($r('app.color.color_text_primary'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
          .borderRadius($r('app.float.float_radius_control'))
          .enabled(this.actionsEnabled)
          .onClick(() => { this.onRemove(); })
        Button($r('app.string.calendar_action_open'))
          .height($r('app.float.float_touch_min'))
          .width('100%')
          .fontSize($r('app.float.float_font_13'))
          .backgroundColor($r('app.color.color_surface_soft'))
          .fontColor($r('app.color.color_text_primary'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
          .borderRadius($r('app.float.float_radius_control'))
          .enabled(this.actionsEnabled)
          .onClick(() => { this.onOpenCalendar(); })
      }.width('100%')

      Text($r('app.string.calendar_permission_hint'))
        .fontSize($r('app.float.float_font_12'))
        .fontColor($r('app.color.color_text_secondary'))
        .width('100%')
        .onClick(() => { this.onOpenPermissionHelp(); })
    }
    .width('100%')
    .padding($r('app.float.float_card_padding'))
    .backgroundColor($r('app.color.color_surface'))
    .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') })
    .borderRadius($r('app.float.float_radius_card'))
    .shadow({ radius: 12, color: $r('app.color.color_shadow'), offsetX: 0, offsetY: 4 })
    .alignItems(HorizontalAlign.Start)
  }
}



