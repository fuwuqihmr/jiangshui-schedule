// 职责：关于卡，展示版本、协议（可展开隐私摘要）与开源致谢。
// 依赖：pages 传入版本 props 与 privacySummary；现有 string/color/float token。
// 阶段：P3 收口；协议展开为本地状态，不依赖跳转能力。
// 新增 string 键：about_card_title/about_version_line/about_version_value/about_agreement/about_oss/about_version_format
@Component
export struct AboutCard {
  @Prop versionName: string = '';
  @Prop versionCode: number = 0;
  @Prop privacySummary: ResourceStr = '';
  @State showAgreement: boolean = false;
  onOpenAgreement: () => void = () => {};
  onAgreement: () => void = () => {};
  onOpenSource: () => void = () => {};
  onVersion: () => void = () => {};

  build() {
    Column({ space: $r('app.float.float_space_8') }) {
      Text($r('app.string.about_card_title')).fontSize($r('app.float.float_font_16')).fontColor($r('app.color.color_text_primary')).fontWeight(FontWeight.Medium).width('100%')
      Button({ type: ButtonType.Normal }) {
        Row() {
          Text($r('app.string.about_version_line')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary')).layoutWeight(1)
          Text(this.versionName + ' (' + this.versionCode.toString() + ')').fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary'))
        }.width('100%')
      }.backgroundColor($r('app.color.color_surface_soft')).border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') }).height($r('app.float.float_touch_min')).width('100%').borderRadius($r('app.float.float_radius_control')).onClick(() => { this.onVersion(); }).visibility(this.versionName.length > 0 ? Visibility.Visible : Visibility.None)
      Button({ type: ButtonType.Normal }) {
        Row() {
          Text($r('app.string.about_agreement')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary')).layoutWeight(1)
          Text(this.showAgreement ? $r('app.string.settings_arrow_collapsed') : $r('app.string.settings_arrow_expanded')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary'))
        }.width('100%')
      }.backgroundColor($r('app.color.color_surface_soft')).border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') }).height($r('app.float.float_touch_min')).width('100%').borderRadius($r('app.float.float_radius_control')).onClick(() => { this.onOpenAgreement(); this.showAgreement = !this.showAgreement; this.onAgreement(); })
      if (this.showAgreement) {
        Text(this.privacySummary).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary'))
          .width('100%').padding({ top: $r('app.float.float_space_8'), bottom: $r('app.float.float_space_8') })
      }
      Button({ type: ButtonType.Normal }) {
        Row() {
          Text($r('app.string.about_oss')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary')).layoutWeight(1)
          Text($r('app.string.settings_arrow_expanded')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary'))
        }.width('100%')
      }.backgroundColor($r('app.color.color_surface_soft')).border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') }).height($r('app.float.float_touch_min')).width('100%').borderRadius($r('app.float.float_radius_control')).onClick(() => { this.onOpenSource(); })
    }.width('100%').padding($r('app.float.float_card_padding')).backgroundColor($r('app.color.color_surface'))
      .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') })
      .borderRadius($r('app.float.float_radius_card'))
      .shadow({ radius: 12, color: $r('app.color.color_shadow'), offsetX: 0, offsetY: 4 })
      .alignItems(HorizontalAlign.Start)
  }
}


