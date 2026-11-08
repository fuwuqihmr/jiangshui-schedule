// 职责：系统集成卡片（features 层 UI），展示权限/日历/提醒/后台状态并提供可操作按钮。
// 依赖：只调用 SystemIntegrationService，不直接 import Kit；文案全走 string 资源，颜色走 color token。
// 阶段：P6 系统集成；接线入口在 pages/SettingsPage.ets，见同目录 NAV.md（负责挂载）。

import type { AppState } from '../../core/types/AppState';
import { createDefaultState } from '../../core/types/AppState';
import { SystemIntegrationService } from './SystemIntegrationService';
import type { SystemActionView, SystemStatusView } from './SystemIntegrationService';

function permissionLabel(value: string): Resource {
  if (value === 'granted') {
    // granted 已不允许由业务产出；保留分支仅用于兼容历史状态，绝不能靠它显示「已开启」。
    return $r('app.string.permission_state_granted');
  }
  if (value === 'unverified') {
    return $r('app.string.permission_state_unverified');
  }
  if (value === 'denied') {
    return $r('app.string.permission_state_denied');
  }
  if (value === 'unavailable') {
    return $r('app.string.permission_state_unavailable');
  }
  return $r('app.string.permission_state_prompt');
}

function permissionColor(value: string): Resource {
  if (value === 'granted') {
    return $r('app.color.color_success');
  }
  if (value === 'denied') {
    return $r('app.color.color_danger');
  }
  if (value === 'unavailable') {
    return $r('app.color.color_text_secondary');
  }
  return $r('app.color.color_warning');
}

function errorLabel(code: string, scope: string = ''): Resource {
  if (code === 'PERMISSION_DENIED' || code === 'PERMISSION_UNAVAILABLE') {
    return $r('app.string.system_error_permission');
  }
  if (code === 'CALENDAR_UNAVAILABLE' || code === 'CALENDAR_WRITE_FAILED') {
    return $r('app.string.system_error_calendar');
  }
  if (code === 'REMINDER_UNAVAILABLE') {
    return $r('app.string.system_error_reminder');
  }
  if (code === 'NOTIFY_UNAVAILABLE') {
    return $r('app.string.system_error_notify');
  }
  if (code === 'BACKGROUND_UNAVAILABLE') {
    return $r('app.string.system_error_background');
  }
  if (code === 'PREFERENCES_UNAVAILABLE') {
    return $r('app.string.system_error_preferences');
  }
  // 上课提醒链路的通知失败只能说「无法确认」，不能断言「未开启」；其他入口仍用原口径。
  if (scope === 'reminder' && (code === 'NOTIFY_PERMISSION_REQUIRED' || code === 'NOTIFY_PERMISSION_UNVERIFIED')) {
    return $r('app.string.system_error_reminder_notify_unverified');
  }
  if (code === 'NOTIFY_PERMISSION_REQUIRED') {
    return $r('app.string.system_error_notify_permission');
  }
  if (code === 'NOTIFY_PERMISSION_UNVERIFIED') {
    return $r('app.string.system_error_notify_unverified');
  }
  if (code === 'NOTIFY_SETTINGS_FAILED') {
    return $r('app.string.system_error_notify_settings_failed');
  }
  return $r('app.string.system_error_generic');
}

@Component
export struct SystemIntegrationCard {
  @Prop state: AppState = createDefaultState();
  @State calendarPermission: string = 'prompt';
  @State notificationPermission: string = 'prompt';
  @State notificationVerified: boolean = false;
  @State backgroundPermission: string = 'prompt';
  @State calendarAvailable: boolean = false;
  @State reminderCount: number = 0;
  @State reminderPermission: string = 'prompt';
  @State backgroundStarted: boolean = false;
  @State unread: number = 0;
  @State written: number = 0;
  @State deleted: number = 0;
  @State failed: number = 0;
  @State feedback: Resource = $r('app.string.system_feedback_idle');
  @State feedbackOk: boolean = true;

  aboutToAppear(): void {
    this.refreshStatus();
  }

  private contextValue(): object {
    return getContext(this) as object;
  }

  private refreshStatus(): void {
    SystemIntegrationService.loadStatus(this.contextValue(), this.state).then((view: SystemStatusView) => {
      this.calendarPermission = view.calendarPermission;
      this.notificationPermission = view.notificationPermission;
      this.notificationVerified = view.notificationVerified;
      this.backgroundPermission = view.backgroundPermission;
      this.calendarAvailable = view.calendarAvailable;
      this.reminderCount = view.reminderCount;
      this.reminderPermission = view.reminderPermission;
      this.backgroundStarted = view.backgroundStarted;
      this.unread = view.unread;
    }).catch(() => {
      this.feedback = $r('app.string.system_error_generic');
      this.feedbackOk = false;
    });
  }

  private apply(view: SystemActionView, successKey: Resource): void {
    this.feedback = view.ok ? successKey : errorLabel(view.code, view.scope);
    this.feedbackOk = view.ok;
    this.written = view.written;
    this.deleted = view.deleted;
    this.failed = view.failed;
    if (view.unread > 0) {
      this.unread = view.unread;
    }
    this.refreshStatus();
  }

  private writeCalendar(): void {
    SystemIntegrationService.writeCalendar(this.contextValue(), this.state).then((view: SystemActionView) => {
      this.apply(view, $r('app.string.system_feedback_written'));
    }).catch(() => {
      this.feedback = $r('app.string.system_error_calendar');
      this.feedbackOk = false;
    });
  }

  private removeCalendar(): void {
    SystemIntegrationService.removeCalendar(this.contextValue()).then((view: SystemActionView) => {
      this.apply(view, $r('app.string.system_feedback_removed'));
    }).catch(() => {
      this.feedback = $r('app.string.system_error_calendar');
      this.feedbackOk = false;
    });
  }

  private applyReminders(): void {
    SystemIntegrationService.applyReminders(this.contextValue(), this.state).then((view: SystemActionView) => {
      this.apply(view, $r('app.string.system_feedback_reminder'));
    }).catch(() => {
      this.feedback = $r('app.string.system_error_reminder');
      this.feedbackOk = false;
    });
  }

  private enableNotifications(): void {
    // 先留痕再 await：即使系统授权框不返回，日志与「正在申请」反馈也已可见。
    console.info('permission-request kind=notification entry=integration-card state=' + this.notificationPermission);
    this.feedback = $r('app.string.system_feedback_notify_requesting');
    this.feedbackOk = true;
    SystemIntegrationService.enableNotifications(this.contextValue()).then((view: SystemActionView) => {
      // 成功文案只在复验为已开启时出现；拒绝/未生效会走 errorLabel 的「去系统设置」提示。
      this.apply(view, $r('app.string.system_feedback_notify'));
    }).catch(() => {
      this.feedback = $r('app.string.system_error_notify');
      this.feedbackOk = false;
    });
  }

  private openNotificationSettings(): void {
    SystemIntegrationService.openNotificationSettings(this.contextValue()).then((view: SystemActionView) => {
      if (view.ok) {
        // 只说明「已打开设置」，最终是否开启以返回后的查询结果为准，不做乐观推断。
        this.feedback = $r('app.string.system_feedback_notify_settings');
        this.feedbackOk = true;
      } else {
        this.feedback = errorLabel(view.code, view.scope);
        this.feedbackOk = false;
      }
      this.refreshStatus();
    }).catch(() => {
      this.feedback = $r('app.string.system_error_notify_settings_failed');
      this.feedbackOk = false;
    });
  }

  private syncBadge(): void {
    SystemIntegrationService.syncBadge(this.contextValue(), this.state).then((view: SystemActionView) => {
      this.apply(view, $r('app.string.system_feedback_badge'));
    }).catch(() => {
      this.feedback = $r('app.string.system_error_notify');
      this.feedbackOk = false;
    });
  }

  private toggleBackground(): void {
    if (this.backgroundStarted) {
      SystemIntegrationService.stopBackground().then((view: SystemActionView) => {
        this.apply(view, $r('app.string.system_feedback_background'));
      }).catch(() => {
        this.feedback = $r('app.string.system_error_background');
        this.feedbackOk = false;
      });
      return;
    }
    SystemIntegrationService.startBackground(this.contextValue(), this.state).then((view: SystemActionView) => {
      this.apply(view, $r('app.string.system_feedback_background'));
    }).catch(() => {
      this.feedback = $r('app.string.system_error_background');
      this.feedbackOk = false;
    });
  }

  @Builder
  statusRow(label: Resource, value: string) {
    Row({ space: $r('app.float.float_space_8') }) {
      Text(label)
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_text_secondary'))
        .layoutWeight(1)
      Text(permissionLabel(value))
        .fontSize($r('app.float.float_font_13'))
        .fontColor(permissionColor(value))
    }
    .width('100%')
  }

  build() {
    Column({ space: $r('app.float.float_space_12') }) {
      Row({ space: $r('app.float.float_space_8') }) {
        Text($r('app.string.system_title'))
          .fontSize($r('app.float.float_font_16'))
          .fontColor($r('app.color.color_text_primary'))
          .fontWeight(FontWeight.Medium)
        Text(this.calendarAvailable ? $r('app.string.system_calendar_ready') : $r('app.string.system_calendar_unavailable'))
          .fontSize($r('app.float.float_font_12'))
          .fontColor(this.calendarAvailable ? $r('app.color.color_success') : $r('app.color.color_text_secondary'))
          .backgroundColor($r('app.color.color_neutral_soft'))
          .borderRadius($r('app.float.float_radius_pill'))
          .padding({ left: $r('app.float.float_space_8'), right: $r('app.float.float_space_8'), top: 2, bottom: 2 })
      }
      .width('100%')

      Column({ space: $r('app.float.float_space_8') }) {
        this.statusRow($r('app.string.permission_calendar'), this.calendarPermission)
        this.statusRow($r('app.string.permission_notification'), this.notificationPermission)
        this.statusRow($r('app.string.system_status_background'), this.backgroundStarted ? 'granted' : this.backgroundPermission)
        if (this.notificationPermission === 'unverified') {
          Text($r('app.string.system_notify_unverified_hint'))
            .fontSize($r('app.float.float_font_12'))
            .fontColor($r('app.color.color_warning'))
            .width('100%')
        }
      }
      .width('100%')
      .padding($r('app.float.float_space_12'))
      .backgroundColor($r('app.color.color_surface_soft'))
      .borderRadius($r('app.float.float_radius_card'))

      Row({ space: $r('app.float.float_space_16') }) {
        Text($r('app.string.system_unread_label'))
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_text_secondary'))
        Text(String(this.unread))
          .fontSize($r('app.float.float_font_14'))
          .fontColor($r('app.color.color_text_primary'))
          .fontWeight(FontWeight.Medium)
        Text($r('app.string.system_reminder_count'))
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_text_secondary'))
        Text(String(this.reminderCount))
          .fontSize($r('app.float.float_font_14'))
          .fontColor($r('app.color.color_text_primary'))
          .fontWeight(FontWeight.Medium)
      }
      .width('100%')

      Column({ space: $r('app.float.float_space_8') }) {
        Button($r('app.string.calendar_action_write'))
          .height($r('app.float.float_touch_min'))
          .width('100%')
          .fontSize($r('app.float.float_font_13'))
          .backgroundColor($r('app.color.color_accent_button'))
          .fontColor($r('app.color.color_on_accent'))
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => { this.writeCalendar(); })
        Button($r('app.string.calendar_action_remove'))
          .height($r('app.float.float_touch_min'))
          .width('100%')
          .fontSize($r('app.float.float_font_13'))
          .backgroundColor($r('app.color.color_surface_soft'))
          .fontColor($r('app.color.color_text_primary'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => { this.removeCalendar(); })
        Button($r('app.string.system_action_reminder'))
          .height($r('app.float.float_touch_min'))
          .width('100%')
          .fontSize($r('app.float.float_font_13'))
          .backgroundColor($r('app.color.color_surface_soft'))
          .fontColor($r('app.color.color_text_primary'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => { this.applyReminders(); })
        Button(this.backgroundStarted ? $r('app.string.system_action_background_stop') : $r('app.string.system_action_background_start'))
          .height($r('app.float.float_touch_min'))
          .width('100%')
          .fontSize($r('app.float.float_font_13'))
          .backgroundColor($r('app.color.color_surface_soft'))
          .fontColor($r('app.color.color_text_primary'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => { this.toggleBackground(); })
        Row({ space: $r('app.float.float_space_8') }) {
          Button($r('app.string.system_action_notify'))
            .layoutWeight(1)
            .height($r('app.float.float_touch_min'))
            .fontSize($r('app.float.float_font_13'))
            .backgroundColor($r('app.color.color_neutral_soft'))
            .fontColor($r('app.color.color_text_primary'))
            .borderRadius($r('app.float.float_radius_control'))
            .onClick(() => { this.enableNotifications(); })
          Button($r('app.string.system_action_badge'))
            .layoutWeight(1)
            .height($r('app.float.float_touch_min'))
            .fontSize($r('app.float.float_font_13'))
            .backgroundColor($r('app.color.color_neutral_soft'))
            .fontColor($r('app.color.color_text_primary'))
            .borderRadius($r('app.float.float_radius_control'))
            .onClick(() => { this.syncBadge(); })
        }
        .width('100%')
        // 设置入口无条件可见。此前被状态条件包裹，真机上容易看不到入口也点不进去；
        // 现在无论查询结果如何，用户都能一键进入通知设置自行确认。
        Button($r('app.string.system_action_notify_settings'))
          .height($r('app.float.float_touch_min'))
          .width('100%')
          .fontSize($r('app.float.float_font_13'))
          .backgroundColor($r('app.color.color_neutral_soft'))
          .fontColor($r('app.color.color_text_primary'))
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => {
            console.info('permission-entry kind=notification-settings entry=integration-card state=' +
              this.notificationPermission);
            this.openNotificationSettings();
          })
      }
      .width('100%')

      Text(this.feedback)
        .fontSize($r('app.float.float_font_12'))
        .fontColor(this.feedbackOk ? $r('app.color.color_success') : $r('app.color.color_danger'))
        .width('100%')

      Text($r('app.string.system_hint_permission'))
        .fontSize($r('app.float.float_font_12'))
        .fontColor($r('app.color.color_text_secondary'))
        .width('100%')
    }
    .width('100%')
    .padding($r('app.float.float_card_padding'))
    .backgroundColor($r('app.color.color_surface'))
    .borderRadius($r('app.float.float_radius_card'))
    .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') })
  }
}
