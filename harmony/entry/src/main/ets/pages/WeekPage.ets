// 职责：完整课表页，只消费 WeekViewModel。
// 依赖方向：pages -> core/viewmodel/core/timetable/components。
// 阶段：P2；网格滚动/今天列待真机验证。
import type { AppState } from '../core/types/AppState';
import type { LeaveRecord } from '../core/types/Leave';
import type { WeekViewModel } from '../core/viewmodel/WeekViewModel';
import { buildWeekViewModel, emptyWeekViewModel } from '../core/viewmodel/WeekViewModel';
import { resolveDay, markLeave, weekdayOf, addDays, weekOf } from '../core/timetable/TimetableCore';
import { createViewModelCopy } from '../platform/format/ViewModelCopyFactory';
import { WeekGrid } from '../components/WeekGrid';
import { CourseDetailSheet } from '../components/CourseDetailSheet';
import type { CourseDetailView } from '../core/viewmodel/DayViewModel';

@Component
export struct WeekPage {
  @Prop appState: AppState;
  @Prop leaveRecords: LeaveRecord[];
  @Prop @Watch('onSelectedWeek') selectedWeek: number;
  @Prop selectedDate: string;
  todayKey: string = '';
  onWeekChange: (week: number) => void = () => {};
  onSelectDate: (date: string) => void = () => {};
  onOpenCourse: (course: object) => void = () => {};
  @State vm: WeekViewModel = emptyWeekViewModel();
  @State selectedDetail: CourseDetailView | null = null;
  @State showDetail: boolean = false;
  aboutToAppear(): void { this.refresh(); }
  onSelectedWeek(): void { this.refresh(); }
  refresh(): void {
    const copy = createViewModelCopy(getContext(this));
    this.vm = buildWeekViewModel({ state: this.appState, week: this.selectedWeek, todayKey: this.todayKey, selectedDateKey: this.selectedDate, leaveRecords: this.leaveRecords },
      { resolveDay: resolveDay, markLeave: markLeave, weekdayOf: weekdayOf, addDays: addDays, weekOf: weekOf }, copy);
  }
  build() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        Button($r('app.string.prev_week')).height($r('app.float.float_touch_min'))
          .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
          .backgroundColor($r('app.color.color_surface'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => this.onWeekChange(this.vm.week - 1))
        Text(this.vm.weekLabel).fontSize($r('app.float.float_font_16')).fontColor($r('app.color.color_text_primary'))
        Button($r('app.string.week_today')).height($r('app.float.float_touch_min'))
          .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
          .backgroundColor($r('app.color.color_surface'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => this.onWeekChange(1))
        Button($r('app.string.next_week')).height($r('app.float.float_touch_min'))
          .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
          .backgroundColor($r('app.color.color_surface'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => this.onWeekChange(this.vm.week + 1))
      }
      Scroll() {
        WeekGrid({ vm: this.vm, onSelectDay: this.onSelectDate, onOpenCourse: (detail: object) => { this.selectedDetail = detail as CourseDetailView; this.showDetail = true; } })
      }.width('100%').scrollable(ScrollDirection.Horizontal)
      if (this.showDetail && this.selectedDetail !== null) {
        CourseDetailSheet({ detail: this.selectedDetail, onClose: () => { this.showDetail = false; } })
      }
    }.padding($r('app.float.float_page_padding')).width('100%').height('100%').backgroundColor($r('app.color.color_background'))
  }
}





