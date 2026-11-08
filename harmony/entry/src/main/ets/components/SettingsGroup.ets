// 职责：受控折叠头，渲染标题/摘要/箭头并回调，不持有展开状态。
// 依赖：core/types 资源；pages 传入 groupId/order/expanded/onToggle/内容。
// 阶段：P3；待官方文档确认 Button 内 BuilderParam 的布局约束。
// 新增 string 键：settings_group_toggle_hint
import type { SettingsGroupId } from '../core/viewmodel/SettingsViewModel';

@Component
export struct SettingsGroup {
  @Prop groupId: SettingsGroupId = 'auto';
  @Prop order: number = 0;
  @Prop title: Resource = $r('app.string.settings_title');
  @Prop summary: ResourceStr = '';
  @Prop expanded: boolean = false;
  onToggle: (id: SettingsGroupId) => void = () => {};
  @BuilderParam content: () => void = this.emptyContent;

  @Builder emptyContent() {}

  build() {
    Column() {
      Button() {
        Row() {
          Column({ space: $r('app.float.float_space_4') }) {
            Text(this.title).fontSize($r('app.float.float_font_16')).fontColor($r('app.color.color_text_primary')).fontWeight(FontWeight.Medium)
            if (!this.expanded && this.summary !== '') {
              Text(this.summary).fontSize($r('app.float.float_font_12')).fontColor($r('app.color.color_text_secondary')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            }
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          Text(this.expanded ? $r('app.string.settings_arrow_expanded') : $r('app.string.settings_arrow_collapsed')).fontSize($r('app.float.float_font_16')).fontColor($r('app.color.color_text_secondary'))
        }.width('100%').height($r('app.float.float_touch_min')).padding({ left: $r('app.float.float_card_padding'), right: $r('app.float.float_card_padding') }).alignItems(VerticalAlign.Center)
      }
      .type(ButtonType.Normal)
      .backgroundColor($r('app.color.color_surface'))
      .borderRadius(0)
      .focusable(true)
      .accessibilityText(this.title)
      .accessibilityDescription(this.expanded ? $r('app.string.settings_accessibility_collapsed') : $r('app.string.settings_accessibility_expanded'))
      .onClick(() => { this.onToggle(this.groupId); })
      if (this.expanded) { this.content() }
    }
    .width('100%')
    .backgroundColor($r('app.color.color_surface'))
    .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') })
    .borderRadius($r('app.float.float_radius_card'))
    .shadow({ radius: 12, color: $r('app.color.color_shadow'), offsetX: 0, offsetY: 4 })
  }
}
