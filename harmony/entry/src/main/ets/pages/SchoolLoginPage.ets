/**
 * 教务系统登录页（P4 79c，规格 §3.1/§6.2）。
 * 职责：NavDestination 内承载 SchoolLoginWebView；无 Web 能力时展示说明与可复制登录地址，不出现空白页。
 * 安全口径：页面不读取 cookie、不拼 service、不填账号密码；地址只读展示，复制走 ClipboardGateway。
 */
import { copyText } from '../platform/clipboard/ClipboardGateway';
import { SchoolLoginWebView } from '../platform/web/SchoolLoginWebView';

@Component
export struct SchoolLoginPage {
  @Prop entryUrl: string = '';
  @Prop webAvailable: boolean = false;
  onSuccess: () => void = () => {};
  onCancel: () => void = () => {};
  onWebError: (code: string) => void = () => {};

  @State copyStatus: number = 0;
  @State notice: string = '';
  @State webErrorCode: string = '';

  private async copyEntry(): Promise<void> {
    const ok: boolean = await copyText(this.entryUrl);
    this.copyStatus = ok ? 1 : 2;
  }

  @Builder titleBar() {
    Row({ space: $r('app.float.float_space_8') }) {
      Button($r('app.string.common_back'))
        .height($r('app.float.float_touch_min'))
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_link'))
        .backgroundColor($r('app.color.color_surface'))
        .borderRadius($r('app.float.float_radius_control'))
        .onClick(() => {
          this.onCancel();
        })
      Text($r('app.string.school_login_title'))
        .fontSize($r('app.float.float_font_20'))
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.color_text_primary'))
        .layoutWeight(1)
    }
    .width('100%')
    .constraintSize({ minHeight: $r('app.float.float_touch_min') })
  }

  @Builder unavailableBody() {
    Column({ space: $r('app.float.float_space_8') }) {
      Text($r('app.string.school_web_unavailable'))
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_text_secondary'))
        .lineHeight($r('app.float.float_line_body'))
        .width('100%')
      Text($r('app.string.school_login_entry_label'))
        .fontSize($r('app.float.float_font_12'))
        .fontColor($r('app.color.color_text_secondary'))
        .width('100%')
      Row({ space: $r('app.float.float_space_8') }) {
        TextInput({ text: this.entryUrl })
          .enabled(false)
          .layoutWeight(1)
          .height($r('app.float.float_touch_min'))
          .fontSize($r('app.float.float_font_12'))
          .backgroundColor($r('app.color.color_surface_soft'))
          .borderRadius($r('app.float.float_radius_control'))
        Button($r('app.string.school_login_copy'))
          .height($r('app.float.float_touch_min'))
          .fontSize($r('app.float.float_font_13'))
          .fontColor($r('app.color.color_on_accent'))
          .backgroundColor($r('app.color.color_accent_button'))
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => {
            this.copyEntry();
          })
      }
      .width('100%')
      if (this.copyStatus === 1) {
        Text($r('app.string.web_office_copied'))
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_success'))
          .width('100%')
      }
      if (this.copyStatus === 2) {
        Text($r('app.string.web_office_copy_failed'))
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_danger'))
          .width('100%')
      }
    }
    .width('100%')
    .padding($r('app.float.float_card_padding'))
    .backgroundColor($r('app.color.color_surface'))
    .borderRadius($r('app.float.float_radius_card'))
  }

  @Builder errorBody() {
    Column({ space: $r('app.float.float_space_8') }) {
      Text(this.webErrorCode === 'WEB_UNAVAILABLE' ? $r('app.string.school_error_web_page_error') : $r('app.string.school_login_load_error'))
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_danger'))
        .width('100%')
      Text($r('app.string.school_login_entry_label'))
        .fontSize($r('app.float.float_font_12'))
        .fontColor($r('app.color.color_text_secondary'))
        .width('100%')
      Row({ space: $r('app.float.float_space_8') }) {
        TextInput({ text: this.entryUrl })
          .enabled(false)
          .layoutWeight(1)
          .height($r('app.float.float_touch_min'))
          .fontSize($r('app.float.float_font_12'))
          .backgroundColor($r('app.color.color_surface_soft'))
          .borderRadius($r('app.float.float_radius_control'))
        Button($r('app.string.school_login_copy'))
          .height($r('app.float.float_touch_min'))
          .fontSize($r('app.float.float_font_13'))
          .fontColor($r('app.color.color_on_accent'))
          .backgroundColor($r('app.color.color_accent_button'))
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => {
            this.copyEntry();
          })
      }
      .width('100%')
      Button($r('app.string.school_btn_retry'))
        .height($r('app.float.float_touch_min'))
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_on_accent'))
        .backgroundColor($r('app.color.color_accent_button'))
        .borderRadius($r('app.float.float_radius_control'))
        .onClick(() => {
          // 清空错误态后重建 Web 分支，由新的 WebviewController 重新加载登录入口。
          this.webErrorCode = '';
          this.notice = '';
        })
    }
    .width('100%')
    .padding($r('app.float.float_card_padding'))
    .backgroundColor($r('app.color.color_surface'))
    .borderRadius($r('app.float.float_radius_card'))
  }

  build() {
    NavDestination() {
      Column({ space: $r('app.float.float_space_8') }) {
        this.titleBar()
        Text($r('app.string.school_login_intro'))
          .fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_text_secondary'))
          .lineHeight($r('app.float.float_line_caption'))
          .width('100%')
        if (!this.webAvailable) {
          this.unavailableBody()
        } else if (this.webErrorCode.length > 0) {
          this.errorBody()
        } else {
          if (this.notice === 'login') {
            Text($r('app.string.school_login_wait'))
              .fontSize($r('app.float.float_font_12'))
              .fontColor($r('app.color.color_text_secondary'))
              .width('100%')
          }
          if (this.notice === 'captcha') {
            Text($r('app.string.school_login_captcha_hint'))
              .fontSize($r('app.float.float_font_12'))
              .fontColor($r('app.color.color_text_secondary'))
              .width('100%')
          }
          SchoolLoginWebView({
            entryUrl: this.entryUrl,
            onSuccess: () => {
              this.onSuccess();
            },
            onWebError: (code: string) => {
              this.webErrorCode = code;
              this.onWebError(code);
            },
            onPageNotice: (kind: string) => {
              this.notice = kind;
            }
          })
            .layoutWeight(1)
        }
      }
      .width('100%')
      .height('100%')
      .padding($r('app.float.float_page_padding'))
      .backgroundColor($r('app.color.color_background'))
    }
    .hideTitleBar(true)
  }
}
