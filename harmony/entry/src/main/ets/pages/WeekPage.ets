// 职责：完整课表页，只消费 WeekViewModel。
// 依赖方向：pages -> core/viewmodel/core/timetable/components。
// 阶段：P2；网格滚动/今天列待真机验证。
import type { AppState } from '../core/types/AppState';
import type { LeaveRecord } from '../core/types/Leave';
import type { WeekViewModel } from '../core/viewmodel/WeekViewModel';
import { buildWeekViewModel, emptyWeekViewModel, FALLBACK_WEEKS } from '../core/viewmodel/WeekViewModel';
import { resolveDay, markLeave, weekdayOf, addDays, weekOf } from '../core/timetable/TimetableCore';
import { createViewModelCopy } from '../platform/format/ViewModelCopyFactory';
import { WeekGrid } from '../components/WeekGrid';
import { EmptyState } from '../components/EmptyState';
import { CourseDetailSheet } from '../components/CourseDetailSheet';
import type { CourseDetailView } from '../core/viewmodel/DayViewModel';

const WEEK_SELECT_WIDTH: number = 56;

@Component
export struct WeekPage {
  @Prop @Watch('refresh') appState: AppState;
  @Prop @Watch('refresh') leaveRecords: LeaveRecord[];
  @Prop @Watch('onSelectedWeek') selectedWeek: number;
  @Prop @Watch('refresh') selectedDate: string;
  todayKey: string = '';
  onWeekChange: (week: number) => void = () => {};
  onSelectDate: (date: string) => void = () => {};
  onOpenCourse: (course: object) => void = () => {};
  @State vm: WeekViewModel = emptyWeekViewModel();
  @State selectedDetail: CourseDetailView | null = null;
  @State showDetail: boolean = false;
  // appState/leaveRecords 两次到达都会触发 @Watch；重入期间丢弃，等本轮结束后由下一次变更重算。
  private refreshing: boolean = false;
  aboutToAppear(): void { this.refresh(); }
  onSelectedWeek(): void { this.refresh(); }
  refresh(): void {
    if (this.refreshing) { return; }
    this.refreshing = true;
    try {
      const copy = createViewModelCopy(getContext(this));
      this.vm = buildWeekViewModel({ state: this.appState, week: this.selectedWeek, todayKey: this.todayKey, selectedDateKey: this.selectedDate, leaveRecords: this.leaveRecords },
        { resolveDay: resolveDay, markLeave: markLeave, weekdayOf: weekdayOf, addDays: addDays, weekOf: weekOf }, copy);
    } finally {
      this.refreshing = false;
    }
  }
  private totalWeeks(): number {
    const snapshot = this.appState.snapshot;
    if (snapshot === null) {
      return FALLBACK_WEEKS;
    }
    return snapshot.weeks > 0 ? snapshot.weeks : FALLBACK_WEEKS;
  }
  private currentWeek(): number {
    const snapshot = this.appState.snapshot;
    if (snapshot === null || this.todayKey.length === 0) {
      return 1;
    }
    return Math.min(Math.max(1, weekOf(snapshot, this.todayKey)), this.totalWeeks());
  }
  private changeWeek(next: number): void {
    const total: number = this.totalWeeks();
    let week: number = next;
    if (week < 1) week = 1;
    if (week > total) week = total;
    if (week !== this.selectedWeek) {
      this.onWeekChange(week);
    }
  }
  private weekOptions(): SelectOption[] {
    const options: SelectOption[] = [];
    const total: number = this.totalWeeks();
    for (let week = 1; week <= total; week++) {
      options.push({ value: String(week) });
    }
    return options;
  }
  build() {
    Column({ space: 12 }) {
      Row({ space: 6 }) {
        Button($r('app.string.prev_week')).height($r('app.float.float_touch_min')).layoutWeight(1)
          .padding({ left: 8, right: 8 })
          .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
          .backgroundColor($r('app.color.color_surface'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => this.changeWeek(this.vm.week - 1))
        Row({ space: 4 }) {
          Text($r('app.string.school_lex_week_prefix')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary'))
          Select(this.weekOptions())
            .selected(this.vm.week - 1)
            .value(String(this.vm.week))
            .width(WEEK_SELECT_WIDTH).height($r('app.float.float_touch_min'))
            .fontColor($r('app.color.color_text_primary'))
            .onSelect((index: number) => { this.changeWeek(index + 1); })
          Text($r('app.string.school_lex_week_suffix')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary'))
        }
        Button($r('app.string.week_today')).height($r('app.float.float_touch_min'))
          .padding({ left: 8, right: 8 })
          .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
          .backgroundColor($r('app.color.color_surface'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => this.changeWeek(this.currentWeek()))
        Button($r('app.string.next_week')).height($r('app.float.float_touch_min')).layoutWeight(1)
          .padding({ left: 8, right: 8 })
          .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
          .backgroundColor($r('app.color.color_surface'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => this.changeWeek(this.vm.week + 1))
      }.width('100%')
      if (this.vm.errorKey !== null) {
        EmptyState({ title: $r('app.string.data_not_read'), hint: $r('app.string.data_sync_hint') })
      } else if (this.vm.isEmpty) {
        EmptyState({ title: $r('app.string.status_vacant'), hint: $r('app.string.day_empty_hint') })
      }
      WeekGrid({ vm: this.vm, onSelectDay: this.onSelectDate, onOpenCourse: (detail: object) => { this.selectedDetail = detail as CourseDetailView; this.showDetail = true; } })
        .layoutWeight(1)
      if (this.showDetail && this.selectedDetail !== null) {
        CourseDetailSheet({ detail: this.selectedDetail, onClose: () => { this.showDetail = false; } })
      }
    }.padding($r('app.float.float_page_padding')).width('100%').height('100%').backgroundColor($r('app.color.color_background'))
  }
}
