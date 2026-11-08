// 职责：设置分组内的说明卡；文案由页面注入，不访问业务状态。
// 依赖：现有 string/color/float token。
// 阶段：P3；待官方文档确认提示文本的可访问性朗读方式。
// 新增 string 键：settings_hint_card_title
@Component
export struct SettingsHintCard {
  @Prop title: ResourceStr = $r('app.string.settings_hint_card_title');
  @Prop text: ResourceStr = '';

  build() {
    Column({ space: $r('app.float.float_space_4') }) {
      Text(this.title).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary')).fontWeight(FontWeight.Medium).width('100%')
      Text(this.text).fontSize($r('app.float.float_font_12')).fontColor($r('app.color.color_text_secondary')).width('100%')
    }.width('100%').padding($r('app.float.float_card_padding')).backgroundColor($r('app.color.color_surface'))
      .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') })
      .borderRadius($r('app.float.float_radius_card')).alignItems(HorizontalAlign.Start)
  }
}
