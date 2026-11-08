// 职责：教务数据同步卡，展示来源/最近读取与三个入口，不实现同步逻辑。
// 依赖：pages 回调与现有 string/color/float token。
// 阶段：P3；待官方文档确认登录入口能力。
// 新增 string 键：data_sync_title/data_source_line/data_last_success/data_not_read/data_action_portal/data_action_mobile/data_action_read/data_sync_hint/data_reading
@Component
export struct DataSyncCard {
  @Prop sourceText: string = '';
  @Prop lastSuccessText: string = '';
  @Prop reading: boolean = false;
  @Prop @Watch('syncMode') mode: string = 'real';
  @Prop sourceLabel: ResourceStr = '';
  @Prop lastSuccessLabel: ResourceStr = '';
  @Prop busy: boolean = false;
  // 读取按钮就近反馈：读中/失败提示直接显示在这张卡上，避免只更新上方教务卡导致“点了没反应”。
  @Prop statusText: ResourceStr = '';
  @Prop statusError: boolean = false;
  // 未登录教务时在读取按钮旁直接给登录入口，避免用户只能看到远处教务卡上的按钮。
  @Prop schoolLoginRequired: boolean = false;
  onModeChange: (mode: string) => void = () => {};
  onSync: () => void = () => {};
  onPortal: () => void = () => {};
  onMobile: () => void = () => {};
  onSchoolLogin: () => void = () => {};
  onRead: () => void = () => {};
  @State confirmMode: boolean = false;
  @State switchOn: boolean = false;
  // 待确认的目标模式：'demo' 或 'real'；两个方向都要确认，避免误切。
  @State private pendingMode: string = '';

  aboutToAppear(): void {
    this.syncMode();
  }

  syncMode(): void {
    this.switchOn = this.mode === 'demo';
    this.confirmMode = false;
    this.pendingMode = '';
  }

  private onToggle(isOn: boolean): void {
    const target: string = isOn ? 'demo' : 'real';
    if (target === this.mode) {
      this.switchOn = this.mode === 'demo';
      return;
    }
    // 先只移动开关并弹确认，父状态保持不变；取消时 syncMode 会恢复开关。
    this.switchOn = isOn;
    this.pendingMode = target;
    this.confirmMode = true;
  }

  private cancelDemo(): void {
    this.confirmMode = false;
    this.pendingMode = '';
    this.switchOn = this.mode === 'demo';
  }

  private confirmDemo(): void {
    this.confirmMode = false;
    this.pendingMode = '';
    this.switchOn = true;
    this.onModeChange('demo');
  }

  private confirmReal(): void {
    this.confirmMode = false;
    this.pendingMode = '';
    this.switchOn = false;
    this.onModeChange('real');
  }

  build() {
    Column({ space: $r('app.float.float_space_12') }) {
      Text($r('app.string.data_sync_title')).fontSize($r('app.float.float_font_16')).fontColor($r('app.color.color_text_primary')).fontWeight(FontWeight.Medium).width('100%')
      Row() {
        Text($r('app.string.data_source_line')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary')).layoutWeight(1)
        Text(this.sourceText.length > 0 ? this.sourceText : $r('app.string.data_not_configured')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%')
      Row() {
        Text($r('app.string.data_last_success')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary')).layoutWeight(1)
        Text(this.lastSuccessText.length > 0 ? this.lastSuccessText : $r('app.string.data_not_read')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%')
      Row({ space: $r('app.float.float_space_8') }) {
        Column({ space: 2 }) {
          Text($r('app.string.settings_demo_mode')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary')).width('100%')
          if (this.mode === 'demo') {
            Text($r('app.string.settings_demo_badge')).fontSize($r('app.float.float_font_11')).fontColor($r('app.color.color_text_secondary')).width('100%')
          } else {
            Text($r('app.string.data_switch_demo')).fontSize($r('app.float.float_font_11')).fontColor($r('app.color.color_text_secondary')).width('100%')
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Toggle({ type: ToggleType.Switch, isOn: this.switchOn }).selectedColor($r('app.color.color_accent_button'))
          .onChange((isOn: boolean) => { this.onToggle(isOn); })
      }.width('100%')
      if (this.confirmMode) {
        Column({ space: $r('app.float.float_space_8') }) {
          Text(this.pendingMode === 'real' ? $r('app.string.data_switch_real_confirm') : $r('app.string.data_switch_confirm')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary')).width('100%')
          Row({ space: $r('app.float.float_space_8') }) {
            Button($r('app.string.common_cancel')).height($r('app.float.float_touch_min')).layoutWeight(1).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary')).backgroundColor($r('app.color.color_surface_soft')).border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') }).borderRadius($r('app.float.float_radius_control')).onClick(() => { this.cancelDemo(); })
            Button(this.pendingMode === 'real' ? $r('app.string.data_switch_real') : $r('app.string.data_switch_demo_confirm')).height($r('app.float.float_touch_min')).layoutWeight(1).fontSize($r('app.float.float_font_13')).backgroundColor($r('app.color.color_accent_button')).fontColor($r('app.color.color_on_accent')).borderRadius($r('app.float.float_radius_control')).onClick(() => { if (this.pendingMode === 'real') { this.confirmReal(); } else { this.confirmDemo(); } })
          }.width('100%')
        }.width('100%')
      }
      Text($r('app.string.data_sync_school_label')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary')).fontWeight(FontWeight.Medium).width('100%')
      Button($r('app.string.data_action_read')).height($r('app.float.float_touch_min')).width('100%').fontSize($r('app.float.float_font_13')).backgroundColor($r('app.color.color_surface_soft')).fontColor($r('app.color.color_link')).border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') }).borderRadius($r('app.float.float_radius_control')).enabled(!this.reading).onClick(() => { this.onRead(); })
      if (this.statusText !== '') {
        Text(this.statusText)
          .fontSize($r('app.float.float_font_12'))
          .fontColor(this.statusError ? $r('app.color.color_danger') : $r('app.color.color_accent'))
          .lineHeight($r('app.float.float_line_caption'))
          .width('100%')
      }
      if (this.schoolLoginRequired) {
        Button($r('app.string.school_login_required_action')).height($r('app.float.float_touch_min')).width('100%').fontSize($r('app.float.float_font_13')).backgroundColor($r('app.color.color_accent_button')).fontColor($r('app.color.color_on_accent')).borderRadius($r('app.float.float_radius_control')).onClick(() => { this.onSchoolLogin(); })
      }
      Text($r('app.string.data_sync_office_label')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary')).fontWeight(FontWeight.Medium).width('100%')
      Button($r('app.string.data_action_portal')).height($r('app.float.float_touch_min')).width('100%').fontSize($r('app.float.float_font_13')).backgroundColor($r('app.color.color_accent_button')).fontColor($r('app.color.color_on_accent')).borderRadius($r('app.float.float_radius_control')).onClick(() => { this.onPortal(); })
      Button($r('app.string.data_action_mobile')).height($r('app.float.float_touch_min')).width('100%').fontSize($r('app.float.float_font_13')).backgroundColor($r('app.color.color_surface_soft')).fontColor($r('app.color.color_link')).border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') }).borderRadius($r('app.float.float_radius_control')).onClick(() => { this.onMobile(); })
      Text($r('app.string.data_sync_hint')).fontSize($r('app.float.float_font_12')).fontColor($r('app.color.color_text_secondary')).width('100%')
    }.width('100%').padding($r('app.float.float_card_padding')).backgroundColor($r('app.color.color_surface'))
      .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') })
      .borderRadius($r('app.float.float_radius_card'))
      .shadow({ radius: 12, color: $r('app.color.color_shadow'), offsetX: 0, offsetY: 4 })
      .alignItems(HorizontalAlign.Start)
  }
}





