// 职责：单日休假新增/编辑表单（是否同时停晚自习）；日期与冲突校验交 CustomFormLogic。
// 依赖方向：features/custom -> core/custom 纯逻辑 + core/types + ArkUI 资源；不直接写 AppState。
// 阶段：P4；编辑时日期固定，只允许改 skipStudy。
import type { AppState, HolidayDay } from '../../core/types/AppState';
import { submitHoliday } from './CustomFormLogic';
import { customFormErrorText } from './CustomFormErrorText';

@Component
export struct HolidayDaySheet {
  @Prop state: AppState;
  @Prop editing: HolidayDay | null = null;
  onSubmit: (day: HolidayDay) => void = () => {};
  onDelete: (date: string) => void = () => {};
  onClose: () => void = () => {};
  @State date: string = '';
  @State skipStudy: boolean = false;
  @State errors: string[] = [];

  aboutToAppear(): void {
    const day = this.editing;
    if (day === null) {
      return;
    }
    this.date = day.date;
    this.skipStudy = day.skipStudy;
  }

  private existingDates(): string[] {
    const dates: string[] = [];
    const settings = this.state.holidaySettings;
    if (settings === null || settings === undefined) {
      return dates;
    }
    const editing = this.editing;
    for (const item of settings.days) {
      if (editing !== null && item.date === editing.date) {
        continue;
      }
      dates.push(item.date);
    }
    return dates;
  }

  private save(): void {
    const editing = this.editing;
    const date = editing === null ? this.date.trim() : editing.date;
    const errors = submitHoliday(date, this.skipStudy, this.state.snapshot, this.existingDates(), (day: HolidayDay) => {
      this.onSubmit(day);
    });
    this.errors = errors;
    if (errors.length === 0) {
      this.onClose();
    }
  }

  build() {
    Column({ space: 10 }) {
      Row() {
        Text(this.editing === null ? $r('app.string.custom_holiday_sheet_title_add') : $r('app.string.custom_holiday_sheet_title_edit'))
          .fontSize(16).fontWeight(FontWeight.Medium)
        Blank()
        Text($r('app.string.custom_action_cancel')).fontSize(14).onClick(() => { this.onClose(); })
      }.width('100%')
      Column({ space: 4 }) {
        Text($r('app.string.custom_holiday_date')).fontSize(12)
        if (this.editing === null) {
          TextInput({ text: this.date, placeholder: 'YYYY-MM-DD' }).fontSize(14)
            .onChange((value: string) => { this.date = value; })
        } else {
          Text(this.date).fontSize(14)
        }
      }.alignItems(HorizontalAlign.Start).width('100%')
      Row({ space: 8 }) {
        Text($r('app.string.custom_holiday_skip_study')).fontSize(13)
        Blank()
        Toggle({ type: ToggleType.Switch, isOn: this.skipStudy })
          .onChange((value: boolean) => { this.skipStudy = value; })
      }.width('100%')
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
              const day = this.editing;
              if (day !== null) {
                this.onDelete(day.date);
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
