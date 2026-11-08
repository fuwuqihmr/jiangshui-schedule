// 职责：设置页「清除数据」卡；提供网页数据与本地登录会话两个清理动作。
// 依赖：platform/web 清理门面；本卡不读取 cookie/TGC，不接触 @kit/@ohos，不声称删除系统密码。
// 阶段：P4；待确认：各 API 在目标设备的运行时清理结果、无痕 jar 是否被清。
// 新增 string 键：web_credential_clear_title/web_credential_clear_desc/web_credential_clear_action/
//               web_credential_clearing/web_credential_cookies_label/web_credential_storage_label/
//               web_credential_httpauth_label/web_credential_cleared/web_credential_clear_failed/
//               web_credential_clear_hint/login_session_clear_action/login_session_clear_hint/
//               login_session_clear_success/login_session_clear_failed/
//               login_session_clear_session_label/login_session_clear_ticket_label
import { clearWebBrowsingData } from '../platform/web/WebDataCleaner';
import { clearLoginSessionData } from '../platform/web/WebDataCleaner';
import type { WebDataClearResult, LoginSessionClearResult } from '../platform/web/WebDataCleaner';

@Component
export struct WebDataClearCard {
  @State private busy: boolean = false;
  @State private hasResult: boolean = false;
  @State private cookiesCleared: boolean = false;
  @State private storageCleared: boolean = false;
  @State private httpAuthCleared: boolean = false;
  @State private loginBusy: boolean = false;
  @State private loginHasResult: boolean = false;
  @State private loginSessionCleared: boolean = false;
  @State private loginTicketCleared: boolean = false;
  @State private loginCookiesCleared: boolean = false;
  @State private loginStorageCleared: boolean = false;
  @State private loginHttpAuthCleared: boolean = false;
  @State private loginAllCleared: boolean = false;

  private clearAll(): void {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.hasResult = false;
    clearWebBrowsingData().then((result: WebDataClearResult) => {
      this.cookiesCleared = result.cookiesCleared;
      this.storageCleared = result.storageCleared;
      this.httpAuthCleared = result.httpAuthCleared;
      this.hasResult = true;
      this.busy = false;
    }).catch((error: Error) => {
      this.cookiesCleared = false;
      this.storageCleared = false;
      this.httpAuthCleared = false;
      this.hasResult = true;
      this.busy = false;
    });
  }

  private clearLogin(): void {
    if (this.loginBusy) {
      return;
    }
    this.loginBusy = true;
    this.loginHasResult = false;
    clearLoginSessionData(getContext(this)).then((result: LoginSessionClearResult) => {
      this.loginSessionCleared = result.sessionCleared;
      this.loginTicketCleared = result.ticketCleared;
      this.loginCookiesCleared = result.cookiesCleared;
      this.loginStorageCleared = result.storageCleared;
      this.loginHttpAuthCleared = result.httpAuthCleared;
      this.loginAllCleared = result.sessionCleared && result.ticketCleared && result.cookiesCleared
        && result.storageCleared && result.httpAuthCleared;
      this.loginHasResult = true;
      this.loginBusy = false;
    }).catch((error: Error) => {
      this.loginSessionCleared = false;
      this.loginTicketCleared = false;
      this.loginCookiesCleared = false;
      this.loginStorageCleared = false;
      this.loginHttpAuthCleared = false;
      this.loginAllCleared = false;
      this.loginHasResult = true;
      this.loginBusy = false;
    });
  }

  private resultText(cleared: boolean): Resource {
    return cleared ? $r('app.string.web_credential_cleared') : $r('app.string.web_credential_clear_failed');
  }

  @Builder resultRow(label: Resource, cleared: boolean) {
    Row() {
      Text(label)
        .fontSize($r('app.float.float_font_12'))
        .fontColor($r('app.color.color_text_secondary'))
        .layoutWeight(1)
      Text(this.resultText(cleared))
        .fontSize($r('app.float.float_font_12'))
        .fontColor(cleared ? $r('app.color.color_success') : $r('app.color.color_danger'))
    }
    .width('100%')
  }

  build() {
    Column({ space: $r('app.float.float_space_8') }) {
      Text($r('app.string.web_credential_clear_title'))
        .fontSize($r('app.float.float_font_16'))
        .fontColor($r('app.color.color_text_primary'))
        .fontWeight(FontWeight.Medium)
        .width('100%')
      Text($r('app.string.web_credential_clear_desc'))
        .fontSize($r('app.float.float_font_12'))
        .fontColor($r('app.color.color_text_secondary'))
        .lineHeight($r('app.float.float_line_caption'))
        .width('100%')
      Button(this.busy ? $r('app.string.web_credential_clearing') : $r('app.string.web_credential_clear_action'))
        .height($r('app.float.float_touch_min'))
        .width('100%')
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_on_accent'))
        .backgroundColor($r('app.color.color_accent_button'))
        .borderRadius($r('app.float.float_radius_control'))
        .enabled(!this.busy)
        .onClick(() => {
          this.clearAll();
        })
      if (this.hasResult) {
        this.resultRow($r('app.string.web_credential_cookies_label'), this.cookiesCleared)
        this.resultRow($r('app.string.web_credential_storage_label'), this.storageCleared)
        this.resultRow($r('app.string.web_credential_httpauth_label'), this.httpAuthCleared)
      }
      Text($r('app.string.web_credential_clear_hint'))
        .fontSize($r('app.float.float_font_12'))
        .fontColor($r('app.color.color_text_secondary'))
        .lineHeight($r('app.float.float_line_caption'))
        .width('100%')
      Button(this.loginBusy ? $r('app.string.web_credential_clearing') : $r('app.string.login_session_clear_action'))
        .height($r('app.float.float_touch_min'))
        .width('100%')
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_on_accent'))
        .backgroundColor($r('app.color.color_accent_button'))
        .borderRadius($r('app.float.float_radius_control'))
        .enabled(!this.loginBusy)
        .onClick(() => {
          this.clearLogin();
        })
      if (this.loginHasResult) {
        Text(this.loginAllCleared ? $r('app.string.login_session_clear_success') : $r('app.string.login_session_clear_failed'))
          .fontSize($r('app.float.float_font_12'))
          .fontColor(this.loginAllCleared ? $r('app.color.color_success') : $r('app.color.color_danger'))
          .lineHeight($r('app.float.float_line_caption'))
          .width('100%')
        this.resultRow($r('app.string.login_session_clear_session_label'), this.loginSessionCleared)
        this.resultRow($r('app.string.login_session_clear_ticket_label'), this.loginTicketCleared)
        this.resultRow($r('app.string.web_credential_cookies_label'), this.loginCookiesCleared)
        this.resultRow($r('app.string.web_credential_storage_label'), this.loginStorageCleared)
        this.resultRow($r('app.string.web_credential_httpauth_label'), this.loginHttpAuthCleared)
      }
      Text($r('app.string.login_session_clear_hint'))
        .fontSize($r('app.float.float_font_12'))
        .fontColor($r('app.color.color_text_secondary'))
        .lineHeight($r('app.float.float_line_caption'))
        .width('100%')
    }
    .width('100%')
    .padding($r('app.float.float_card_padding'))
    .backgroundColor($r('app.color.color_surface'))
    .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') })
    .borderRadius($r('app.float.float_radius_card'))
    .alignItems(HorizontalAlign.Start)
  }
}
