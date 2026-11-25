// 职责：教务数据同步卡，展示来源/最近读取与三个入口，不实现同步逻辑。
// 依赖：pages 回调与现有 string/color/float token。
// 阶段：P3；待官方文档确认登录入口能力。
// 新增 string 键：data_sync_title/data_source_line/data_last_success/data_not_read/data_action_portal/data_action_mobile/data_action_read/data_sync_hint/data_reading
@Component
export struct DataSyncCard {
  @Prop sourceText: string = '';
  @Prop lastSuccessText: string = '';
  @Prop reading: boolean = false;
  @Prop mode: string = 'real';
  @Prop sourceLabel: ResourceStr = '';
  @Prop lastSuccessLabel: ResourceStr = '';
  @Prop busy: boolean = false;
  onModeChange: (mode: string) => void = () => {};
  onSync: () => void = () => {};
  onPortal: () => void = () => {};
  onMobile: () => void = () => {};
  onRead: () => void = () => {};
  @State confirmMode: boolean = false;

  build() {
    Column({ space: $r('app.float.float_space_8') }) {
      Text($r('app.string.data_sync_title')).fontSize($r('app.float.float_font_16')).fontColor($r('app.color.color_text_primary')).fontWeight(FontWeight.Medium).width('100%')
      Row() {
        Text($r('app.string.data_source_line')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary')).layoutWeight(1)
        Text(this.sourceText.length > 0 ? this.sourceText : $r('app.string.data_not_configured')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
      }.width('100%')
      Row() {
        Text($r('app.string.data_last_success')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary')).layoutWeight(1)
        Text(this.lastSuccessText.length > 0 ? this.lastSuccessText : $r('app.string.data_not_read')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
      }.width('100%')
      Button(this.mode === 'demo' ? $r('app.string.settings_demo_badge') : $r('app.string.data_switch_demo')).height($r('app.float.float_touch_min')).width('100%').fontColor($r('app.color.color_link')).backgroundColor($r('app.color.color_neutral_soft')).onClick(() => { this.confirmMode = true; })
      if (this.confirmMode) {
        Column({ space: $r('app.float.float_space_8') }) {
          Text($r('app.string.data_switch_confirm')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary')).width('100%')
          Row({ space: $r('app.float.float_space_8') }) {
            Button($r('app.string.common_cancel')).height($r('app.float.float_touch_min')).layoutWeight(1).backgroundColor($r('app.color.color_neutral_soft')).onClick(() => { this.confirmMode = false; })
            Button($r('app.string.data_switch_demo_confirm')).height($r('app.float.float_touch_min')).layoutWeight(1).backgroundColor($r('app.color.color_accent_button')).fontColor($r('app.color.color_on_accent')).onClick(() => { this.confirmMode = false; this.onModeChange(this.mode === 'demo' ? 'real' : 'demo'); })
          }.width('100%')
        }.width('100%')
      }
      Column({ space: $r('app.float.float_space_8') }) {
        Button($r('app.string.data_action_portal')).height($r('app.float.float_touch_min')).width('100%').fontSize($r('app.float.float_font_13')).backgroundColor($r('app.color.color_accent_button')).fontColor($r('app.color.color_on_accent')).onClick(() => { this.onPortal(); })
        Button($r('app.string.data_action_mobile')).height($r('app.float.float_touch_min')).width('100%').fontSize($r('app.float.float_font_13')).backgroundColor($r('app.color.color_accent_button')).fontColor($r('app.color.color_on_accent')).onClick(() => { this.onMobile(); })
        Button($r('app.string.data_action_read')).height($r('app.float.float_touch_min')).width('100%').fontSize($r('app.float.float_font_13')).backgroundColor($r('app.color.color_accent_button')).fontColor($r('app.color.color_on_accent')).enabled(!this.reading).onClick(() => { this.onRead(); })
      }.width('100%')
      Text($r('app.string.data_sync_hint')).fontSize($r('app.float.float_font_12')).fontColor($r('app.color.color_text_secondary')).width('100%')
    }.width('100%').padding($r('app.float.float_card_padding')).backgroundColor($r('app.color.color_surface'))
      .borderRadius($r('app.float.float_radius_card')).alignItems(HorizontalAlign.Start)
  }
}





