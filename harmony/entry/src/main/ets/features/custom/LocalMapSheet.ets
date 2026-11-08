// 职责：调课（原上课日 -> 调至日期）新增/编辑表单；校验交 CustomFormLogic，成功回调 onSubmit。
// 依赖方向：features/custom -> core/custom 纯逻辑 + core/types + ArkUI 资源；不直接写 AppState。
// 阶段：P4；父页面接线见 NAV.md 与 custom-form-report.md。
import type { AppState, LocalMapRule } from '../../core/types/AppState';
import type { LocalMapDraft } from '../../core/custom/CustomScheduleService';
import { submitLocalMap } from './CustomFormLogic';
import { customFormErrorText } from './CustomFormErrorText';

@Component
export struct LocalMapSheet {
  @Prop state: AppState;
  @Prop editing: LocalMapRule | null = null;
  onSubmit: (rule: LocalMapRule) => void = () => {};
  onDelete: (id: string) => void = () => {};
  onClose: () => void = () => {};
  @State fromDate: string = '';
  @State date: string = '';
  @State errors: string[] = [];

  aboutToAppear(): void {
    const rule = this.editing;
    if (rule === null) {
      return;
    }
    this.fromDate = rule.fromDate;
    this.date = rule.date;
  }

  private save(): void {
    const draft: LocalMapDraft = {
      fromDate: this.fromDate.trim(),
      date: this.date.trim(),
      mode: 'replace'
    };
    const editingId = this.editing === null ? '' : this.editing.id;
    const errors = submitLocalMap(draft, this.state, Date.now(), editingId, (rule: LocalMapRule) => {
      this.onSubmit(rule);
    });
    this.errors = errors;
    if (errors.length === 0) {
      this.onClose();
    }
  }

  build() {
    Column({ space: 10 }) {
      Row() {
        Text(this.editing === null ? $r('app.string.custom_map_sheet_title_add') : $r('app.string.custom_map_sheet_title_edit'))
          .fontSize(16).fontWeight(FontWeight.Medium)
        Blank()
        Text($r('app.string.custom_action_cancel')).fontSize(14).onClick(() => { this.onClose(); })
      }.width('100%')
      Column({ space: 4 }) {
        Text($r('app.string.custom_map_from')).fontSize(12)
        TextInput({ text: this.fromDate, placeholder: 'YYYY-MM-DD' }).fontSize(14)
          .onChange((value: string) => { this.fromDate = value; })
      }.alignItems(HorizontalAlign.Start).width('100%')
      Column({ space: 4 }) {
        Text($r('app.string.custom_map_to')).fontSize(12)
        TextInput({ text: this.date, placeholder: 'YYYY-MM-DD' }).fontSize(14)
          .onChange((value: string) => { this.date = value; })
      }.alignItems(HorizontalAlign.Start).width('100%')
      if (this.errors.length > 0) {
        Column({ space: 2 }) {
          ForEach(this.errors, (code: string) => {
            Text(customFormErrorText(code)).fontSize(11)
          }, (code: string) => code)
        }.alignItems(HorizontalAlign.Start).width('100%')
      }
      Row({ space: 8 }) {
        Text($r('app.string.custom_action_save')).fontSize(14).fontWeight(FontWeight.Medium)
          .onClick(() => { this.save(); })
        Blank()
        if (this.editing !== null) {
          Text($r('app.string.custom_action_delete')).fontSize(14)
            .onClick(() => {
              const rule = this.editing;
              if (rule !== null) {
                this.onDelete(rule.id);
                this.onClose();
              }
            })
        }
      }.width('100%')
    }
    .padding(16)
    .width('100%')
  }
}
