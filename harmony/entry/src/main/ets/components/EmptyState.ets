// 职责：无业务逻辑的空态组件。
// 依赖方向：components -> ArkUI only。
// 阶段：P2。
@Component
export struct EmptyState {
  title: ResourceStr = '';
  hint?: ResourceStr;
  build() {
    Column({ space: 8 }) {
      Text(this.title).fontSize($r('app.float.float_font_16')).fontColor($r('app.color.color_text_primary')).fontWeight(FontWeight.Medium)
      if (this.hint !== undefined) {
        Text(this.hint).fontSize($r('app.float.float_font_12')).fontColor($r('app.color.color_text_secondary'))
      }
    }.width('100%').padding($r('app.float.float_card_padding_wide'))
      .backgroundColor($r('app.color.color_surface'))
      .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') })
      .borderRadius($r('app.float.float_radius_card'))
      .shadow({ radius: 12, color: $r('app.color.color_shadow'), offsetX: 0, offsetY: 4 })
  }
}
