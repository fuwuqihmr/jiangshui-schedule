// 职责：教务/学工 Web 入口全屏页，只承载 platform/web/OfficeWebView 并把白名单 URL 透传。
// 依赖方向：pages -> platform/web -> core/viewmodel；本页不得直接拼 cookie、不直接调用网络或 Kit。
// 阶段：P3；NavDestination 的 hideTitleBar 等导航属性待官方文档确认（已用自定义返回条降级）。
import { buildWebOfficeParam } from '../core/viewmodel/WebEntryViewModel';
import { webTitle } from '../platform/format/ViewModelCopyFactory';
import type { WebOfficeParam } from '../core/viewmodel/WebEntryViewModel';
import { OfficeWebView } from '../platform/web/OfficeWebView';

@Component
export struct WebOfficePage {
  param: WebOfficeParam = buildWebOfficeParam('leave');
  onBack: () => void = () => {};

  private titleText(): Resource { return webTitle(this.param.key); }

  build() {
    NavDestination() {
      Column() {
        Row({ space: 8 }) {
          Button($r('app.string.common_back'))
            .height($r('app.float.float_touch_min'))
            .fontSize($r('app.float.float_font_13'))
            .fontColor($r('app.color.color_link'))
            .backgroundColor($r('app.color.color_surface'))
            .borderRadius($r('app.float.float_radius_control'))
            .onClick(() => {
              this.onBack();
            })
          Text(this.titleText())
            .fontSize($r('app.float.float_font_20'))
            .fontColor($r('app.color.color_text_primary'))
            .fontWeight(FontWeight.Medium)
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
        .padding({
          left: $r('app.float.float_page_padding'),
          right: $r('app.float.float_page_padding'),
          top: $r('app.float.float_space_8'),
          bottom: $r('app.float.float_space_8')
        })
        .backgroundColor($r('app.color.color_background'))

        Column() {
          OfficeWebView({ url: this.param.url, warmupUrl: this.param.warmupUrl, onStateChange: (state: string) => {}, closed: () => { this.onBack(); } })
        }
        .width('100%')
        .layoutWeight(1)
      }
      .width('100%')
      .height('100%')
      .backgroundColor($r('app.color.color_background'))
    }
    // 待官方文档确认：NavDestination 隐藏系统标题栏的属性名与取值。
    .hideTitleBar(true)
  }
}


