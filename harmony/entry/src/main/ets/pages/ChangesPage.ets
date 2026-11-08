// 职责：变更记录页，只消费 ChangeViewModel。
// 依赖方向：pages -> core/viewmodel/components。
// 阶段：P2；P3/P4 再接真实记录。
import type { ChangeRecord } from '../core/types/AppState';
import type { ChangeViewModel, ChangeGroupView, ChangeViewItem } from '../core/viewmodel/ChangeViewModel';
import { buildChangeViewModel } from '../core/viewmodel/ChangeViewModel';
import { createViewModelCopy } from '../platform/format/ViewModelCopyFactory';
import { EmptyState } from '../components/EmptyState';

@Component
export struct ChangesPage {
  @Prop @Watch('refresh') records: ChangeRecord[];
  todayKey: string = '';
  onRead: (id: string) => void = () => {};
  onReadAll: () => void = () => {};
  onOpenDay: (date: string) => void = () => {};
  @State vm: ChangeViewModel = { isEmpty: true, total: 0, unreadCount: 0, groups: [] };
  // 资源文案在 refresh 时解成 string，避免把 Resource 对象直接拼进 Text（会显示 [object Object]）。
  @State private unreadLabel: string = '';
  aboutToAppear(): void { this.refresh(); }
  refresh(): void {
    const copy = createViewModelCopy(getContext(this));
    this.unreadLabel = copy.changes.unread;
    this.vm = buildChangeViewModel(this.records, this.todayKey, copy);
  }
  build() {
    Column({ space: 12 }) {
      Row() {
        Text($r('app.string.tab_changes')).fontSize($r('app.float.float_font_20')).fontColor($r('app.color.color_text_primary'))
        Text(this.unreadLabel + ' ' + this.vm.unreadCount.toString()).fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_danger')).fontWeight(FontWeight.Medium)
          .visibility(this.vm.unreadCount > 0 ? Visibility.Visible : Visibility.None)
        Button($r('app.string.change_all_read')).height($r('app.float.float_touch_min'))
          .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
          .backgroundColor($r('app.color.color_surface'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
          .borderRadius($r('app.float.float_radius_control'))
          .visibility(this.vm.unreadCount > 0 ? Visibility.Visible : Visibility.None)
          .onClick(() => this.onReadAll())
      }.width('100%').justifyContent(FlexAlign.SpaceBetween)
      if (this.vm.isEmpty) {
        EmptyState({ title: $r('app.string.change_empty_title'), hint: $r('app.string.change_empty_hint') })
      } else {
        ForEach(this.vm.groups, (group: ChangeGroupView) => {
          Column({ space: 8 }) {
            Text(group.title).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary'))
            ForEach(group.items, (item: ChangeViewItem) => {
              Row({ space: 8 }) {
                Column({ space: 4 }) {
                  Text(item.title).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
                    .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text(item.dateText + ' · ' + item.typeLabel).fontSize($r('app.float.float_font_12')).fontColor($r('app.color.color_text_secondary'))
                  Text(item.detailText + (item.fieldsText.length > 0 ? ' · ' + item.fieldsText : '')).fontSize($r('app.float.float_font_12')).fontColor($r('app.color.color_text_secondary'))
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                Button($r('app.string.change_open_day')).height($r('app.float.float_touch_min'))
                  .fontSize($r('app.float.float_font_12')).fontColor($r('app.color.color_text_primary'))
                  .backgroundColor($r('app.color.color_surface'))
                  .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
                  .borderRadius($r('app.float.float_radius_control'))
                  .onClick(() => this.onOpenDay(item.record.date))
                Button($r('app.string.change_mark_read')).height($r('app.float.float_touch_min'))
                  .fontSize($r('app.float.float_font_12')).fontColor($r('app.color.color_text_primary'))
                  .backgroundColor($r('app.color.color_surface'))
                  .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
                  .borderRadius($r('app.float.float_radius_control'))
                  .onClick(() => this.onRead(item.record.id))
              }.width('100%')
                .padding($r('app.float.float_space_12'))
                .backgroundColor($r('app.color.color_surface'))
                .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') })
                .borderRadius($r('app.float.float_radius_card'))
                .alignItems(VerticalAlign.Center)
            }, (item: ChangeViewItem) => item.record.id)
          }.width('100%')
        }, (group: ChangeGroupView) => group.key)
      }
    }.padding($r('app.float.float_page_padding')).width('100%').height('100%').backgroundColor($r('app.color.color_background'))
  }
}



