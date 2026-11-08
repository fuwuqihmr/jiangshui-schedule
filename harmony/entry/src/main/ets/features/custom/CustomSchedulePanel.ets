// 职责：自定义与调整列表（自定义课程 / 调课 / 单日休假 / 单日修改 + 撤销重做入口）。
// 依赖方向：features/custom -> core/types + ArkUI 资源；只发 onAdd*/onEdit*/onDelete* 回调，不写存储、不直接改 state。
// 阶段：P4建立，补新增/编辑入口与单日修改列表；父页面接线见 NAV.md。
import type { AppState, CustomCourse, DayOverride, HolidayDay, LocalMapRule } from '../../core/types/AppState';
import { LocalMapSheet } from './LocalMapSheet';
import { HolidayDaySheet } from './HolidayDaySheet';
import { DayOverrideSheet } from './DayOverrideSheet';

@Component
export struct CustomSchedulePanel {
  @Prop state: AppState;
  @Prop canUndo: boolean = false;
  @Prop canRedo: boolean = false;
  onAdd: () => void = () => {};
  onEdit: (course: CustomCourse) => void = () => {};
  onDeleteCourse: (id: string) => void = () => {};
  onAddMap: () => void = () => {};
  onEditMap: (rule: LocalMapRule) => void = () => {};
  onDeleteMap: (id: string) => void = () => {};
  onAddHoliday: () => void = () => {};
  onEditHoliday: (day: HolidayDay) => void = () => {};
  onDeleteHoliday: (date: string) => void = () => {};
  onAddOverride: () => void = () => {};
  onEditOverride: (item: DayOverride) => void = () => {};
  onDeleteOverride: (id: string) => void = () => {};
  onSubmitMap: (rule: LocalMapRule) => void = () => {};
  onSubmitHoliday: (day: HolidayDay) => void = () => {};
  onSubmitOverride: (item: DayOverride) => void = () => {};
  onUndo: () => void = () => {};
  onRedo: () => void = () => {};
  @State mapSheetVisible: boolean = false;
  @State holidaySheetVisible: boolean = false;
  @State overrideSheetVisible: boolean = false;
  @State editingMap: LocalMapRule | null = null;
  @State editingHoliday: HolidayDay | null = null;
  @State editingOverride: DayOverride | null = null;

  private holidayDays(): HolidayDay[] {
    const settings = this.state.holidaySettings;
    if (settings === null || settings === undefined) {
      return [];
    }
    return settings.days;
  }

  private overrideTimeText(item: DayOverride): string {
    if (item.patch.cancelled === true) {
      return '';
    }
    const start = item.patch.startTime === undefined ? item.base.startTime : item.patch.startTime;
    const end = item.patch.endTime === undefined ? item.base.endTime : item.patch.endTime;
    return start + '-' + end;
  }

  private overrideRoomText(item: DayOverride): string {
    return item.patch.room === undefined ? item.base.room : item.patch.room;
  }

  build() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text($r('app.string.custom_list_title')).fontSize(16).fontWeight(FontWeight.Medium)
        Blank()
        Text($r('app.string.custom_action_undo')).fontSize(13)
          .fontWeight(this.canUndo ? FontWeight.Medium : FontWeight.Normal)
          .onClick(() => { if (this.canUndo) { this.onUndo(); } })
        Text($r('app.string.custom_action_redo')).fontSize(13)
          .fontWeight(this.canRedo ? FontWeight.Medium : FontWeight.Normal)
          .onClick(() => { if (this.canRedo) { this.onRedo(); } })
      }.width('100%')
      Row({ space: 8 }) {
        Text($r('app.string.custom_section_custom')).fontSize(13)
        Blank()
        Text($r('app.string.custom_action_add')).fontSize(13).onClick(() => { this.onAdd(); })
      }.width('100%')
      if (this.state.customCourses.length === 0) {
        Text($r('app.string.custom_list_empty')).fontSize(12)
      } else {
        ForEach(this.state.customCourses, (course: CustomCourse) => {
          Row({ space: 8 }) {
            Column({ space: 2 }) {
              Text(course.name).fontSize(13)
              Row({ space: 4 }) {
                Text(course.startTime + '-' + course.endTime).fontSize(11)
                if (course.mode === 'weekly') {
                  Text($r('app.string.custom_day_label')).fontSize(11)
                  Text(String(course.dayOfWeek === undefined ? 0 : course.dayOfWeek)).fontSize(11)
                } else {
                  Text(course.date === undefined ? '' : course.date).fontSize(11)
                }
              }
            }.alignItems(HorizontalAlign.Start).layoutWeight(1).onClick(() => { this.onEdit(course); })
            Text($r('app.string.custom_action_delete')).fontSize(12)
              .onClick(() => { this.onDeleteCourse(course.id); })
          }.width('100%')
        }, (course: CustomCourse) => course.id)
      }
      Row({ space: 8 }) {
        Text($r('app.string.custom_section_map')).fontSize(13)
        Blank()
        Text($r('app.string.custom_action_add')).fontSize(13).onClick(() => { this.onAddMap(); this.editingMap = null; this.mapSheetVisible = true; })
      }.width('100%')
      if (this.state.localMaps.length === 0) {
        Text($r('app.string.custom_map_empty')).fontSize(12)
      } else {
        ForEach(this.state.localMaps, (rule: LocalMapRule) => {
          Row({ space: 8 }) {
            Column({ space: 2 }) {
              Row({ space: 4 }) {
                Text($r('app.string.custom_map_from')).fontSize(11)
                Text(rule.fromDate).fontSize(12)
                Text($r('app.string.custom_map_to')).fontSize(11)
                Text(rule.date).fontSize(12)
              }
              Text($r('app.string.custom_map_mode_replace')).fontSize(11)
            }.alignItems(HorizontalAlign.Start).layoutWeight(1).onClick(() => { this.onEditMap(rule); this.editingMap = rule; this.mapSheetVisible = true; })
            Text($r('app.string.custom_action_delete')).fontSize(12)
              .onClick(() => { this.onDeleteMap(rule.id); })
          }.width('100%')
        }, (rule: LocalMapRule) => rule.id)
      }
      Row({ space: 8 }) {
        Text($r('app.string.custom_section_holiday')).fontSize(13)
        Blank()
        Text($r('app.string.custom_action_add')).fontSize(13).onClick(() => { this.onAddHoliday(); this.editingHoliday = null; this.holidaySheetVisible = true; })
      }.width('100%')
      if (this.holidayDays().length === 0) {
        Text($r('app.string.custom_holiday_empty')).fontSize(12)
      } else {
        ForEach(this.holidayDays(), (day: HolidayDay) => {
          Row({ space: 8 }) {
            Column({ space: 2 }) {
              Text(day.date).fontSize(12)
              if (day.skipStudy) {
                Text($r('app.string.custom_holiday_skip_study')).fontSize(11)
              }
            }.alignItems(HorizontalAlign.Start).layoutWeight(1).onClick(() => { this.onEditHoliday(day); this.editingHoliday = day; this.holidaySheetVisible = true; })
            Text($r('app.string.custom_action_delete')).fontSize(12)
              .onClick(() => { this.onDeleteHoliday(day.date); })
          }.width('100%')
        }, (day: HolidayDay) => day.date)
      }
      Row({ space: 8 }) {
        Text($r('app.string.custom_section_override')).fontSize(13)
        Blank()
        Text($r('app.string.custom_action_add')).fontSize(13).onClick(() => { this.onAddOverride(); this.editingOverride = null; this.overrideSheetVisible = true; })
      }.width('100%')
      if (this.state.overrides.length === 0) {
        Text($r('app.string.custom_override_empty')).fontSize(12)
      } else {
        ForEach(this.state.overrides, (item: DayOverride) => {
          Row({ space: 8 }) {
            Column({ space: 2 }) {
              Row({ space: 4 }) {
                Text(item.date).fontSize(12)
                Text(item.base.name).fontSize(13)
              }
              Row({ space: 4 }) {
                if (item.patch.cancelled === true) {
                  Text($r('app.string.custom_override_cancelled')).fontSize(11)
                } else {
                  Text(this.overrideTimeText(item)).fontSize(11)
                  Text(this.overrideRoomText(item)).fontSize(11)
                }
              }
            }.alignItems(HorizontalAlign.Start).layoutWeight(1).onClick(() => { this.onEditOverride(item); this.editingOverride = item; this.overrideSheetVisible = true; })
            Text($r('app.string.custom_action_delete')).fontSize(12)
              .onClick(() => { this.onDeleteOverride(item.id); })
          }.width('100%')
        }, (item: DayOverride) => item.id)
      }
      if (this.mapSheetVisible) {
        LocalMapSheet({
          state: this.state,
          editing: this.editingMap,
          onSubmit: (rule: LocalMapRule) => { this.onSubmitMap(rule); },
          onDelete: (id: string) => { this.onDeleteMap(id); this.mapSheetVisible = false; },
          onClose: () => { this.mapSheetVisible = false; this.editingMap = null; }
        })
      }
      if (this.holidaySheetVisible) {
        HolidayDaySheet({
          state: this.state,
          editing: this.editingHoliday,
          onSubmit: (day: HolidayDay) => { this.onSubmitHoliday(day); },
          onDelete: (date: string) => { this.onDeleteHoliday(date); this.holidaySheetVisible = false; },
          onClose: () => { this.holidaySheetVisible = false; this.editingHoliday = null; }
        })
      }
      if (this.overrideSheetVisible) {
        DayOverrideSheet({
          state: this.state,
          editing: this.editingOverride,
          onSubmit: (item: DayOverride) => { this.onSubmitOverride(item); },
          onDelete: (id: string) => { this.onDeleteOverride(id); this.overrideSheetVisible = false; },
          onClose: () => { this.overrideSheetVisible = false; this.editingOverride = null; }
        })
      }
    }
    .padding(16)
    .width('100%')
  }
}
