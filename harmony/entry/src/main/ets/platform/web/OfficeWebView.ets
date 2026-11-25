// 职责：教务/学工网页容器：Web 组件 + 白名单二次校验 + 降级复制链接。
// 依赖方向：platform -> core/viewmodel + platform/clipboard；pages 只传 url 与回调。
// 阶段：P3；待官方文档确认 @kit.ArkWeb 导入名、WebviewController 构造与 onLoadIntercept 返回签名。
import { webview } from '@ohos.web.webview';
import { copyText } from '../clipboard/ClipboardGateway';
import { isAllowedWebUrl } from '../../core/viewmodel/WebEntryViewModel';

export interface OfficeWebCapability { available: boolean; }
export function officeWebCapability(): OfficeWebCapability { return { available: false }; }
export function officeWebUnavailableCode(): string { return 'WEB_UNAVAILABLE'; }

@Component
export struct OfficeWebView {
  url: string = '';
  warmupUrl: string = '';
  onStateChange: (state: string) => void = () => {};
  closed: () => void = () => {};
  @State copyStatus: number = 0;
  @State errorText: string = '';
  private controller: webview.WebviewController = new webview.WebviewController();

  private urlAllowed(): boolean { return isAllowedWebUrl(this.url); }

  private async copyLink(): Promise<void> {
    const ok: boolean = await copyText(this.url);
    this.copyStatus = ok ? 1 : 2;
  }

  build() {
    Column() {
      if (!this.urlAllowed()) {
        Text($r('app.string.web_office_invalid_url')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_danger')).width('100%').textAlign(TextAlign.Center)
      } else if (!officeWebCapability().available) {
        Text($r('app.string.web_office_unavailable_title')).fontSize($r('app.float.float_font_20')).fontColor($r('app.color.color_text_primary')).fontWeight(FontWeight.Medium).width('100%').textAlign(TextAlign.Center)
        Text($r('app.string.web_unavailable_hint')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary')).width('100%').textAlign(TextAlign.Center)
        Button($r('app.string.web_office_copy_link')).width('100%').height($r('app.float.float_touch_min')).backgroundColor($r('app.color.color_accent_button')).fontColor($r('app.color.color_on_accent')).onClick(() => { this.copyLink(); })
        if (this.copyStatus === 2) { Text($r('app.string.web_office_copy_failed')).fontSize($r('app.float.float_font_12')).fontColor($r('app.color.color_danger')).width('100%').textAlign(TextAlign.Center) }
      } else {
        if (this.errorText.length > 0) {
          Text($r('app.string.web_office_error_hint')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_danger')).width('100%').textAlign(TextAlign.Center)
        }
        Web({ src: this.url, controller: this.controller })
          .width('100%').layoutWeight(1)
          .onControllerAttached(() => {
            // 待官方文档确认：warmupUrl 是否需要先 loadUrl 再 load url。
            if (this.warmupUrl.length > 0 && isAllowedWebUrl(this.warmupUrl)) { this.controller.loadUrl(this.warmupUrl); }
          })
          .onLoadIntercept((event) => {
            // 待官方文档确认：event.data.getRequestUrl() 与返回 true=拦截 的签名。
            const target: string = event.data.getRequestUrl();
            if (!isAllowedWebUrl(target)) { this.onStateChange('blocked'); return true; }
            return false;
          })
          .onPageEnd(() => { this.onStateChange('loaded'); })
          .onErrorReceive(() => { this.errorText = 'web_office_error_hint'; this.onStateChange('error'); })
      }
    }.width('100%').height('100%').padding($r('app.float.float_page_padding')).backgroundColor($r('app.color.color_background'))
  }
}



