// 职责：单日修改表单：选日期 -> 读当日课程 -> 改时间/地点或取消该节；校验交 CustomFormLogic。
// 依赖方向：features/custom -> core/custom 纯逻辑 + core/timetable resolveDay + core/types + ArkUI 资源；不直接写 AppState。
// 阶段：P4；编辑时日期与基准课程固定，仅允许改 patch。
import type { AppState, CourseExceptionPatch, CourseRow, DayOverride } from '../../core/types/AppState';
import { resolveDay } from '../../core/timetable/TimetableCore';
import { submitOverride } from './CustomFormLogic';
import { customFormErrorText } from './CustomFormErrorText';

@Component
export struct DayOverrideSheet {
  @Prop state: AppState;
  @Prop editing: DayOverride | null = null;
  onSubmit: (override: DayOverride) => void = () => {};
  onDelete: (id: string) => void = () => {};
  onClose: () => void = () => {};
  @State date: string = '';
  @State rows: CourseRow[] = [];
  @State selectedKey: string = '';
  @State startTime: string = '';
  @State endTime: string = '';
  @State room: string = '';
  @State cancelled: boolean = false;
  @State loaded: boolean = false;
  @State errors: string[] = [];

  aboutToAppear(): void {
    const item = this.editing;
    if (item === null) {
      return;
    }
    this.date = item.date;
    this.cancelled = item.patch.cancelled === true;
    this.room = item.patch.room === undefined ? item.base.room : item.patch.room;
    this.startTime = item.patch.startTime === undefined ? item.base.startTime : item.patch.startTime;
    this.endTime = item.patch.endTime === undefined ? item.base.endTime : item.patch.endTime;
    this.selectedKey = item.base.key;
    this.loaded = true;
  }

  private loadRows(): void {
    this.rows = resolveDay(this.state, this.date.trim());
    this.selectedKey = '';
    this.loaded = true;
    if (this.rows.length > 0) {
      this.selectRow(this.rows[0]);
    }
  }

  private selectRow(row: CourseRow): void {
    this.selectedKey = row.key;
    this.startTime = row.startTime;
    this.endTime = row.endTime;
    this.room = row.room;
  }

  private baseRow(): CourseRow | null {
    const item = this.editing;
    if (item !== null) {
      return item.base;
    }
    for (const row of this.rows) {
      if (row.key === this.selectedKey) {
        return row;
      }
    }
    return null;
  }

  private save(): void {
    const base = this.baseRow();
    if (base === null) {
      this.errors = ['override-base-required'];
      return;
    }
    const patch: CourseExceptionPatch = { cancelled: this.cancelled };
    if (!this.cancelled) {
      patch.startTime = this.startTime.trim();
      patch.endTime = this.endTime.trim();
      const room = this.room.trim();
      if (room.length > 0) {
        patch.room = room;
      }
    }
    const editingId = this.editing === null ? '' : this.editing.id;
    const errors = submitOverride(this.date.trim(), base, patch, Date.now(), editingId, (override: DayOverride) => {
      this.onSubmit(override);
    });
    this.errors = errors;
    if (errors.length === 0) {
      this.onClose();
    }
  }

  build() {
    Column({ space: 10 }) {
      Row() {
        Text(this.editing === null ? $r('app.string.custom_override_sheet_title_add') : $r('app.string.custom_override_sheet_title_edit'))
          .fontSize(16).fontWeight(FontWeight.Medium)
        Blank()
        Text($r('app.string.custom_action_cancel')).fontSize(14).onClick(() => { this.onClose(); })
      }.width('100%')
      Column({ space: 4 }) {
        Text($r('app.string.custom_field_date')).fontSize(12)
        if (this.editing === null) {
          Row({ space: 8 }) {
            TextInput({ text: this.date, placeholder: 'YYYY-MM-DD' }).fontSize(14).layoutWeight(1)
              .onChange((value: string) => { this.date = value; })
            Text($r('app.string.custom_override_load')).fontSize(13)
              .onClick(() => { this.loadRows(); })
          }.width('100%')
        } else {
          Text(this.date).fontSize(14)
        }
      }.alignItems(HorizontalAlign.Start).width('100%')
      if (this.editing !== null) {
        Text(this.editing.base.name).fontSize(13).fontWeight(FontWeight.Medium)
      } else if (this.loaded && this.rows.length === 0) {
        Text($r('app.string.custom_override_no_rows')).fontSize(12)
      } else if (this.rows.length > 0) {
        Column({ space: 4 }) {
          Text($r('app.string.custom_override_pick_course')).fontSize(12)
          ForEach(this.rows, (row: CourseRow) => {
            Row({ space: 6 }) {
              Text(row.name).fontSize(13)
              Text(row.startTime + '-' + row.endTime).fontSize(11)
              Text(row.room).fontSize(11)
            }.width('100%')
            .onClick(() => { this.selectRow(row); })
          }, (row: CourseRow) => row.key)
        }.alignItems(HorizontalAlign.Start).width('100%')
      }
      if (this.editing !== null || this.selectedKey.length > 0) {
        Row({ space: 8 }) {
          Column({ space: 4 }) {
            Text($r('app.string.custom_field_start')).fontSize(12)
            TextInput({ text: this.startTime }).fontSize(14).enabled(!this.cancelled)
              .onChange((value: string) => { this.startTime = value; })
          }.layoutWeight(1)
          Column({ space: 4 }) {
            Text($r('app.string.custom_field_end')).fontSize(12)
            TextInput({ text: this.endTime }).fontSize(14).enabled(!this.cancelled)
              .onChange((value: string) => { this.endTime = value; })
          }.layoutWeight(1)
        }.width('100%')
        Column({ space: 4 }) {
          Text($r('app.string.custom_field_room')).fontSize(12)
          TextInput({ text: this.room }).fontSize(14).enabled(!this.cancelled)
            .onChange((value: string) => { this.room = value; })
        }.alignItems(HorizontalAlign.Start).width('100%')
        Row({ space: 8 }) {
          Text($r('app.string.custom_override_cancel_lesson')).fontSize(13)
          Blank()
          Toggle({ type: ToggleType.Switch, isOn: this.cancelled })
            .onChange((value: boolean) => { this.cancelled = value; })
        }.width('100%')
      }
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
              const item = this.editing;
              if (item !== null) {
                this.onDelete(item.id);
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
