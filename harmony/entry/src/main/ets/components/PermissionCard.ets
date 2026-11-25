// 职责：权限说明卡，三态展示通知/后台/日历，不把未确认状态渲染为已授予。
// 依赖：现有 string/color/float token；状态与回调由页面传入。
// 阶段：P3；待官方文档确认系统设置跳转 API。
// 新增 string 键：permission_card_title/permission_card_desc/permission_notification/permission_background/permission_calendar/permission_state_granted/permission_state_denied/permission_state_unavailable/permission_action_open/permission_action_granted/permission_action_unavailable
@Component
export struct PermissionCard {
  @Prop notificationState: string = 'unavailable';
  @Prop backgroundState: string = 'unavailable';
  @Prop calendarState: string = 'unavailable';
  onOpenNotification: () => void = () => {};
  onOpenBackground: () => void = () => {};
  onOpenCalendar: () => void = () => {};

  private stateText(state: string): Resource {
    if (state === 'granted') { return $r('app.string.permission_state_granted'); }
    if (state === 'denied') { return $r('app.string.permission_state_denied'); }
    if (state === 'prompt') { return $r('app.string.permission_state_prompt'); }
    return $r('app.string.permission_state_unavailable');
  }

  private actionText(state: string): Resource {
    if (state === 'granted') { return $r('app.string.permission_action_granted'); }
    if (state === 'unavailable') { return $r('app.string.permission_action_unavailable'); }
    return $r('app.string.permission_action_open');
  }

  private stateColor(state: string): Resource { if (state === 'denied') { return $r('app.color.color_danger'); } if (state === 'prompt') { return $r('app.color.color_warning'); } return $r('app.color.color_text_secondary'); }
  private stateBg(state: string): Resource { if (state === 'denied') { return $r('app.color.color_danger_soft'); } if (state === 'prompt') { return $r('app.color.color_warning_soft'); } return $r('app.color.color_neutral_soft'); }
  private blocked(state: string): boolean {
    return state === 'granted' || state === 'unavailable';
  }

  @Builder
  permissionRow(label: Resource, state: string, onFix: () => void) {
    Row({ space: $r('app.float.float_space_8') }) {
      Text(label)
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_text_primary'))
        .layoutWeight(1)
      Text(this.stateText(state))
        .fontSize($r('app.float.float_font_12'))
        .fontColor(this.stateColor(state))
        .backgroundColor(this.stateBg(state))
      Button(this.actionText(state))
        .height($r('app.float.float_touch_min'))
        .fontSize($r('app.float.float_font_12'))
        .enabled(!this.blocked(state))
        .onClick(() => { onFix(); })
    }
    .width('100%')
    .padding({ top: $r('app.float.float_space_8'), bottom: $r('app.float.float_space_8') })
    .alignItems(VerticalAlign.Center)
  }

  build() {
    Column({ space: $r('app.float.float_space_8') }) {
      Text($r('app.string.permission_card_title'))
        .fontSize($r('app.float.float_font_16'))
        .fontColor($r('app.color.color_text_primary'))
        .fontWeight(FontWeight.Medium)
        .width('100%')
      Text($r('app.string.permission_card_desc'))
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_text_secondary'))
        .width('100%')
      this.permissionRow($r('app.string.permission_notification'), this.notificationState, this.onOpenNotification)
      this.permissionRow($r('app.string.permission_background'), this.backgroundState, this.onOpenBackground)
      this.permissionRow($r('app.string.permission_calendar'), this.calendarState, this.onOpenCalendar)
    }
    .width('100%')
    .padding($r('app.float.float_card_padding'))
    .backgroundColor($r('app.color.color_surface'))
    .borderRadius($r('app.float.float_radius_card'))
    .alignItems(HorizontalAlign.Start)
  }
}



