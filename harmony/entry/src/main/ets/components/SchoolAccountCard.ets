/**
 * 「教务系统」账号卡（P4 79c，规格 §6.1）。
 * 职责：只做展示与动作回调，不访问网络、Cookie、持久化；状态与错误码由页面上报。
 * 依赖方向：components -> core/types + 资源；文案全部来自 string.json。
 */
import type { PermissionState } from '../core/types/Common';

export type SchoolAccountState = 'unbound' | 'checking' | 'ready' | 'expired' | 'error';

export interface SchoolAccountCardProps {
  state: SchoolAccountState;
  permission: PermissionState;
  lastSuccessAt: number;
  lastAttemptAt: number;
  busy: boolean;
  progressText?: ResourceStr;
  errorCode?: string;
  canLogin: boolean;
  onLogin: () => void;
  onRead: () => void;
  onCancel: () => void;
}

/** 读取阶段 -> 阶段文案（§5.2 白名单：session-check→page-meta→weeks→rows→parse→save）。 */
export function schoolProgressText(stage: string): Resource {
  if (stage === 'session-check') {
    return $r('app.string.school_progress_session');
  }
  if (stage === 'page-meta' || stage === 'page') {
    return $r('app.string.school_progress_page');
  }
  if (stage === 'weeks') {
    return $r('app.string.school_progress_weeks');
  }
  if (stage === 'rows') {
    return $r('app.string.school_progress_rows');
  }
  if (stage === 'parse') {
    return $r('app.string.school_progress_parse');
  }
  if (stage === 'save') {
    return $r('app.string.school_progress_save');
  }
  return $r('app.string.school_progress_session');
}

/** 9 个稳定错误码 -> §4.2 文案资源（未知码兜底，不拼接服务器原文）。 */
export function schoolErrorText(code: string): Resource {
  if (code === 'SCHOOL_LOGIN_REQUIRED') {
    return $r('app.string.school_error_login_required');
  }
  if (code === 'SCHOOL_CAPTCHA_REQUIRED') {
    return $r('app.string.school_error_captcha');
  }
  if (code === 'SCHOOL_NETWORK_FAILED') {
    return $r('app.string.school_error_network');
  }
  if (code === 'SCHOOL_TIMEOUT') {
    return $r('app.string.school_error_timeout');
  }
  if (code === 'SCHOOL_SESSION_EXPIRED') {
    return $r('app.string.school_error_session_expired');
  }
  if (code === 'SCHOOL_PARSE_FAILED') {
    return $r('app.string.school_error_parse');
  }
  if (code === 'SCHOOL_EMPTY_TIMETABLE') {
    return $r('app.string.school_error_empty');
  }
  if (code === 'OFFICE_SESSION_REQUIRED') {
    return $r('app.string.office_error_session');
  }
  if (code === 'OFFICE_UNAVAILABLE') {
    return $r('app.string.office_error_unavailable');
  }
  if (code === 'WEB_UNAVAILABLE') {
    return $r('app.string.school_web_unavailable');
  }
  return $r('app.string.school_error_unknown');
}

/** 把读取异常归一为 9 个稳定错误码之一（未知码不把异常原文透给 UI）。 */
export function normalizeSchoolErrorCode(error: Error): string {
  const message: string = error instanceof Error ? error.message : '';
  const codes: string[] = [
    'SCHOOL_LOGIN_REQUIRED', 'SCHOOL_CAPTCHA_REQUIRED', 'SCHOOL_NETWORK_FAILED', 'SCHOOL_TIMEOUT',
    'SCHOOL_SESSION_EXPIRED', 'SCHOOL_PARSE_FAILED', 'SCHOOL_EMPTY_TIMETABLE',
    'OFFICE_SESSION_REQUIRED', 'OFFICE_UNAVAILABLE', 'WEB_UNAVAILABLE'
  ];
  for (const code of codes) {
    if (message === code || message.indexOf(code) >= 0) {
      return code;
    }
  }
  return 'ERROR_UNKNOWN';
}

/** 相对时间文案（分钟/小时/天三档，刚读取显示「刚刚」）。 */
export function schoolRelativeText(at: number, now: number = Date.now()): Resource {
  if (at <= 0) {
    return $r('app.string.school_last_never');
  }
  const delta: number = now - at;
  if (delta < 60000) {
    return $r('app.string.school_relative_just_now');
  }
  if (delta < 3600000) {
    return $r('app.string.school_relative_minutes', Math.floor(delta / 60000));
  }
  if (delta < 86400000) {
    return $r('app.string.school_relative_hours', Math.floor(delta / 3600000));
  }
  return $r('app.string.school_relative_days', Math.floor(delta / 86400000));
}

/** 绝对时间（YYYY-MM-DD HH:mm），仅用于无障碍描述里的完整时间。 */
export function schoolAbsoluteText(at: number): string {
  if (at <= 0) {
    return '';
  }
  const date = new Date(at);
  const month: string = pad2(date.getMonth() + 1);
  const day: string = pad2(date.getDate());
  const hour: string = pad2(date.getHours());
  const minute: string = pad2(date.getMinutes());
  return date.getFullYear().toString() + '-' + month + '-' + day + ' ' + hour + ':' + minute;
}

/** Short clock used in the ready status line: MM/DD HH:mm. */
export function schoolMonthDayText(at: number): string {
  if (at <= 0) {
    return '';
  }
  const date = new Date(at);
  return pad2(date.getMonth() + 1) + '/' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function pad2(value: number): string {
  return value < 10 ? '0' + value.toString() : value.toString();
}

@Component
export struct SchoolAccountCard {
  @Prop state: SchoolAccountState = 'unbound';
  @Prop permission: PermissionState = 'granted';
  @Prop lastSuccessAt: number = 0;
  @Prop lastAttemptAt: number = 0;
  @Prop busy: boolean = false;
  @Prop progressText: ResourceStr = '';
  @Prop errorCode: string = '';
  @Prop canLogin: boolean = false;
  @Prop demoMode: boolean = false;
  onLogin: () => void = () => {};
  onRead: () => void = () => {};
  onCancel: () => void = () => {};

  private statusText(): Resource {
    if (this.state === 'checking') {
      return $r('app.string.school_status_checking');
    }
    if (this.state === 'ready') {
      return $r('app.string.school_status_ready');
    }
    if (this.state === 'expired') {
      return $r('app.string.school_status_expired');
    }
    if (this.state === 'error') {
      return $r('app.string.school_status_error');
    }
    return $r('app.string.school_status_unbound');
  }

  private statusLine(): ResourceStr {
    if (this.state === 'ready' && this.lastSuccessAt > 0) {
      return $r('app.string.school_status_ready_at', schoolMonthDayText(this.lastSuccessAt));
    }
    return this.statusText();
  }

  private statusColor(): ResourceColor {
    if (this.state === 'ready') {
      return $r('app.color.color_success');
    }
    if (this.state === 'expired') {
      return $r('app.color.color_warning');
    }
    if (this.state === 'error') {
      return $r('app.color.color_danger');
    }
    return $r('app.color.color_text_secondary');
  }

  private successText(): ResourceStr {
    return this.lastSuccessAt > 0 ? schoolRelativeText(this.lastSuccessAt) : $r('app.string.school_last_never');
  }

  // accessibilityDescription 只有 (string) 与 (Resource) 两个重载，返回联合类型会两边都不匹配。
  private successAccessibility(): Resource {
    if (this.lastSuccessAt <= 0) {
      return $r('app.string.school_last_never');
    }
    return $r('app.string.school_last_success_absolute', schoolAbsoluteText(this.lastSuccessAt));
  }

  private attemptText(): ResourceStr {
    return this.lastAttemptAt > 0 ? schoolRelativeText(this.lastAttemptAt) : $r('app.string.school_last_never');
  }

  private progressLabel(): ResourceStr {
    return this.progressText === '' ? $r('app.string.school_progress_session') : this.progressText;
  }

  private readLabel(): Resource {
    return this.errorCode !== '' ? $r('app.string.school_btn_retry') : $r('app.string.school_btn_read');
  }

  private showError(): boolean {
    return !this.busy && this.errorCode !== '';
  }

  build() {
    Column({ space: $r('app.float.float_space_8') }) {
      Row() {
        Text($r('app.string.school_card_title'))
          .fontSize($r('app.float.float_font_13'))
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.color_text_primary'))
        Blank()
        Text(this.statusLine())
          .fontSize($r('app.float.float_font_11'))
          .fontColor(this.statusColor())
      }
      .width('100%')
      .constraintSize({ minHeight: $r('app.float.float_touch_min') })

      Text($r('app.string.school_card_intro'))
        .fontSize($r('app.float.float_font_11'))
        .fontColor($r('app.color.color_text_secondary'))
        .lineHeight($r('app.float.float_line_caption'))
        .width('100%')

      Row({ space: $r('app.float.float_space_4') }) {
        Text($r('app.string.school_last_success_relative'))
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_text_secondary'))
        Text(this.successText())
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_text_primary'))
      }
      .width('100%')
      .accessibilityText($r('app.string.school_last_success_relative'))
      .accessibilityDescription(this.successAccessibility())

      Row({ space: $r('app.float.float_space_4') }) {
        Text($r('app.string.school_last_attempt_label'))
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_text_secondary'))
        Text(this.attemptText())
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_text_secondary'))
      }
      .width('100%')

      if (this.busy) {
        Text(this.progressLabel())
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_accent'))
          .width('100%')
      }

      if (this.showError()) {
        Text(schoolErrorText(this.errorCode))
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_danger'))
          .lineHeight($r('app.float.float_line_caption'))
          .width('100%')
      }

      if (this.permission === 'denied') {
        Text($r('app.string.school_permission_denied'))
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_danger'))
          .lineHeight($r('app.float.float_line_caption'))
          .width('100%')
      }

      if (this.demoMode) {
        Text($r('app.string.school_demo_disabled'))
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_text_secondary'))
          .lineHeight($r('app.float.float_line_caption'))
          .width('100%')
      }

      if (!this.canLogin) {
        Text($r('app.string.school_web_unavailable'))
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_text_secondary'))
          .lineHeight($r('app.float.float_line_caption'))
          .width('100%')
      }

      if (this.canLogin) {
      Row({ space: $r('app.float.float_space_8') }) {
        Button($r('app.string.school_btn_login'))
          .height($r('app.float.float_touch_min'))
          .fontSize($r('app.float.float_font_13'))
          .fontColor($r('app.color.color_on_accent'))
          .backgroundColor($r('app.color.color_accent_button'))
          .borderRadius($r('app.float.float_radius_control'))
          .enabled(!this.busy && this.demoMode === false && this.permission !== 'denied')
          .accessibilityText($r('app.string.school_btn_login'))
          .onClick(() => {
            this.onLogin();
          })
        Button(this.readLabel())
          .height($r('app.float.float_touch_min'))
          .fontSize($r('app.float.float_font_13'))
          .fontColor($r('app.color.color_link'))
          .backgroundColor($r('app.color.color_accent_soft'))
          .borderRadius($r('app.float.float_radius_control'))
          .enabled(!this.busy && this.demoMode === false && this.permission !== 'denied')
          .onClick(() => {
            this.onRead();
          })
        if (this.busy) {
          Button($r('app.string.common_cancel'))
            .height($r('app.float.float_touch_min'))
            .fontSize($r('app.float.float_font_13'))
            .fontColor($r('app.color.color_text_primary'))
            .backgroundColor($r('app.color.color_neutral_soft'))
            .borderRadius($r('app.float.float_radius_control'))
            .onClick(() => {
              this.onCancel();
            })
        }
      }
      .width('100%')
      }
    }
    .width('100%')
    .padding($r('app.float.float_card_padding'))
    .backgroundColor($r('app.color.color_surface'))
    .borderRadius($r('app.float.float_radius_card'))
    .accessibilityText($r('app.string.school_account_accessibility'))
    .accessibilityDescription(this.successAccessibility())
  }
}
