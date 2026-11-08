// 职责：今日课表页，只消费 DayViewModel；日期切换/详情/请假入口。
// 依赖方向：pages -> core/viewmodel/core/timetable/platform/format/components。
// 阶段：P2；bindSheet/DatePickerDialog 行为待官方文档确认。
import type { AppState } from '../core/types/AppState';
import type { LeaveRecord } from '../core/types/Leave';
import type { DayViewModel, CourseDetailView, CourseView } from '../core/viewmodel/DayViewModel';
import { buildDayViewModel, emptyDayViewModel } from '../core/viewmodel/DayViewModel';
import { resolveDay, markLeave, weekdayOf, addDays, weekOf } from '../core/timetable/TimetableCore';
import { createViewModelCopy } from '../platform/format/ViewModelCopyFactory';
import { CourseCard } from '../components/CourseCard';
import { EmptyState } from '../components/EmptyState';
import { DateSwitcher } from '../components/DateSwitcher';
import { LeaveStatusEntry } from '../components/LeaveStatusEntry';
import { CourseDetailSheet } from '../components/CourseDetailSheet';

@Component
export struct DayPage {
  @Prop @Watch('refresh') appState: AppState;
  @Prop @Watch('refresh') leaveRecords: LeaveRecord[];
  @Prop @Watch('onSelectedDate') selectedDate: string;
  // appState/leaveRecords 由 Index 异步更新，两个 @Watch 共用 refresh()；
  // 今日页在 TabContent 内不会重建，必须靠 watch 立即刷新 vm。
  aboutToAppear(): void { this.refresh(); }
  onSelectedDate(): void { this.refresh(); }
  private refreshing: boolean = false;
  todayKey: string = '';
  onDateChange: (date: string) => void = () => {};
  onOpenLeaveStatus: () => void = () => {};
  @State vm: DayViewModel = emptyDayViewModel();
  @State selectedDetail: CourseDetailView | null = null;
  @State showDetail: boolean = false;
  refresh(): void {
    if (this.refreshing) { return; }
    this.refreshing = true;
    try {
      const copy = createViewModelCopy(getContext(this));
      const week: number = this.appState.snapshot === null ? 1 : weekOf(this.appState.snapshot, this.selectedDate);
      this.vm = buildDayViewModel({ state: this.appState, dateKey: this.selectedDate, todayKey: this.todayKey, weekNumber: week, leaveRecords: this.leaveRecords },
        { resolveDay: resolveDay, markLeave: markLeave, weekdayOf: weekdayOf }, copy);
    } finally {
      this.refreshing = false;
    }
  }
  build() {
    Scroll() {
      Column({ space: 12 }) {
        DateSwitcher({ dateKey: this.vm.dateKey, label: this.vm.title,
          onPrev: () => this.onDateChange(addDays(this.vm.dateKey, -1)),
          onNext: () => this.onDateChange(addDays(this.vm.dateKey, 1)),
          onPick: (dateKey: string) => this.onDateChange(dateKey) })
        if (this.vm.errorKey === 'NO_SEMESTER') {
          EmptyState({ title: $r('app.string.data_not_read'), hint: $r('app.string.data_sync_hint') })
        } else if (this.vm.errorKey === 'INVALID_DATE') {
          EmptyState({ title: $r('app.string.school_error_unknown') })
        } else if (this.vm.isEmpty) {
          EmptyState({ title: $r('app.string.day_empty_title'), hint: $r('app.string.day_empty_hint') })
        } else {
          ForEach(this.vm.courses, (course: CourseView) => {
            CourseCard({ model: course, compact: false,
              onOpen: () => { this.selectedDetail = course.detail; this.showDetail = true; } })
          }, (course: CourseView) => course.row.key)
        }
        if (this.showDetail && this.selectedDetail !== null) {
          CourseDetailSheet({ detail: this.selectedDetail, onClose: () => { this.showDetail = false; } })
        }
        LeaveStatusEntry({ onOpen: () => this.onOpenLeaveStatus() })
      }.padding($r('app.float.float_page_padding')).width('100%')
    }.width('100%').height('100%').align(Alignment.Top).backgroundColor($r('app.color.color_background'))
  }
}
