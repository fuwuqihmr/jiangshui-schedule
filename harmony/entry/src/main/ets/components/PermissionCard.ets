// 职责：权限说明卡，展示通知/后台/日历的真实状态，不把未确认状态渲染为已授予。
// 依赖：现有 string/color/float token；状态与回调由页面传入。
// 阶段：P3；待官方文档确认系统设置跳转 API。
// 按钮始终可点（此前 granted/unavailable 时 .enabled(false)，真机点击事件根本不进 onClick，
// 造成「点去开启没反应」）；unverified 显示「无法确认」并引导去系统设置。
// 新增 string 键：permission_card_title/permission_card_desc/permission_notification/permission_background/permission_calendar/permission_state_granted/permission_state_denied/permission_state_prompt/permission_state_unavailable/permission_state_unverified/permission_action_open/permission_action_granted/permission_action_unavailable
// 日历行不再直接信任页面传入的 calendarState；先经 SystemIntegrationService.calendarView 读取「能力+授权」，
// 能力不可用/查询失败/授权未知一律显示「本机暂不可用」，杜绝「未知→已开启」。
import { SystemIntegrationService } from '../features/system/SystemIntegrationService';
import type { CalendarView } from '../features/system/SystemIntegrationService';
import { calendarDisplayState } from '../features/system/CalendarDisplay';

@Component
export struct PermissionCard {
  @Prop notificationState: string = 'unavailable';
  @Prop backgroundState: string = 'unavailable';
  @Prop calendarState: string = 'unavailable';
  @State calendarAvailable: boolean = false;
  @State calendarPermission: string = 'unavailable';
  @State calendarResolved: boolean = false;
  onOpenNotification: () => void = () => {};
  onOpenBackground: () => void = () => {};
  onOpenCalendar: () => void = () => {};

  aboutToAppear(): void {
    SystemIntegrationService.calendarView(getContext(this)).then((view: CalendarView) => {
      this.calendarAvailable = view.available;
      this.calendarPermission = view.permission;
      this.calendarResolved = true;
    }).catch(() => {
      this.calendarAvailable = false;
      this.calendarPermission = 'unavailable';
      this.calendarResolved = true;
    });
  }

  private calendarStateForDisplay(): string {
    if (!this.calendarResolved) {
      return 'unavailable';
    }
    return calendarDisplayState(this.calendarAvailable, this.calendarPermission);
  }

  private stateText(state: string): Resource {
    if (state === 'granted') { return $r('app.string.permission_state_granted'); }
    if (state === 'denied') { return $r('app.string.permission_state_denied'); }
    if (state === 'prompt') { return $r('app.string.permission_state_prompt'); }
    if (state === 'unverified') { return $r('app.string.permission_state_unverified'); }
    return $r('app.string.permission_state_unavailable');
  }

  private actionText(state: string): Resource {
    if (state === 'granted') { return $r('app.string.permission_action_granted'); }
    if (state === 'unavailable') { return $r('app.string.permission_action_unavailable'); }
    return $r('app.string.permission_action_open');
  }

  private stateColor(state: string): Resource { if (state === 'denied') { return $r('app.color.color_danger'); } if (state === 'prompt' || state === 'unverified') { return $r('app.color.color_warning'); } return $r('app.color.color_text_secondary'); }
  private stateBg(state: string): Resource { if (state === 'denied') { return $r('app.color.color_danger_soft'); } if (state === 'prompt' || state === 'unverified') { return $r('app.color.color_warning_soft'); } return $r('app.color.color_neutral_soft'); }

  @Builder
  permissionRow(name: string, label: Resource, state: string, onFix: () => void) {
    Row({ space: $r('app.float.float_space_8') }) {
      Text(label)
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_text_primary'))
        .layoutWeight(1)
      Text(this.stateText(state))
        .fontSize($r('app.float.float_font_12'))
        .fontColor(this.stateColor(state))
        .backgroundColor(this.stateBg(state))
        .borderRadius($r('app.float.float_radius_pill'))
        .padding({ left: $r('app.float.float_space_8'), right: $r('app.float.float_space_8'), top: 2, bottom: 2 })
      Button(this.actionText(state))
        .height($r('app.float.float_touch_min'))
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_link'))
        .backgroundColor($r('app.color.color_surface_soft'))
        .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
        .borderRadius($r('app.float.float_radius_control'))
        .onClick(() => {
          // 入口日志：真机取证用（此前点击被 enabled(false) 吃掉，hilog 里完全没有这一行）。
          console.info('permission-entry kind=' + name + ' state=' + state);
          onFix();
        })
    }
    .width('100%')
    .padding({ top: $r('app.float.float_space_8'), bottom: $r('app.float.float_space_8') })
    .alignItems(VerticalAlign.Center)
  }

  build() {
    Column({ space: $r('app.float.float_space_12') }) {
      Text($r('app.string.permission_card_title'))
        .fontSize($r('app.float.float_font_16'))
        .fontColor($r('app.color.color_text_primary'))
        .fontWeight(FontWeight.Medium)
        .width('100%')
      Text($r('app.string.permission_card_desc'))
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_text_secondary'))
        .width('100%')
      this.permissionRow('notification', $r('app.string.permission_notification'), this.notificationState, this.onOpenNotification)
      this.permissionRow('background', $r('app.string.permission_background'), this.backgroundState, this.onOpenBackground)
      this.permissionRow('calendar', $r('app.string.permission_calendar'), this.calendarStateForDisplay(), this.onOpenCalendar)
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
