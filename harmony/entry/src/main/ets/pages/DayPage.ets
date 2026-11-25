// 职责：今日课表页，只消费 DayViewModel；日期切换/详情/请假入口。
// 依赖方向：pages -> core/viewmodel/core/timetable/platform/format/components。
// 阶段：P2；bindSheet/DatePickerDialog 行为待官方文档确认。
import type { AppState } from '../core/types/AppState';
import type { LeaveRecord } from '../core/types/Leave';
import type { DayViewModel, CourseDetailView } from '../core/viewmodel/DayViewModel';
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
  @Prop appState: AppState;
  @Prop leaveRecords: LeaveRecord[];
  @Prop @Watch('onSelectedDate') selectedDate: string;
  todayKey: string = '';
  onDateChange: (date: string) => void = () => {};
  onOpenLeaveStatus: () => void = () => {};
  @State vm: DayViewModel = emptyDayViewModel();
  @State selectedDetail: CourseDetailView | null = null;
  @State showDetail: boolean = false;
  aboutToAppear(): void { this.refresh(); }
  onSelectedDate(): void { this.refresh(); }
  refresh(): void {
    const copy = createViewModelCopy(getContext(this));
    const week: number = this.appState.snapshot === null ? 1 : weekOf(this.appState.snapshot, this.selectedDate);
    this.vm = buildDayViewModel({ state: this.appState, dateKey: this.selectedDate, todayKey: this.todayKey, weekNumber: week, leaveRecords: this.leaveRecords },
      { resolveDay: resolveDay, markLeave: markLeave, weekdayOf: weekdayOf }, copy);
  }
  build() {
    Scroll() {
      Column({ space: 12 }) {
        DateSwitcher({ dateKey: this.vm.dateKey, label: this.vm.title,
          onPrev: () => this.onDateChange(addDays(this.vm.dateKey, -1)),
          onNext: () => this.onDateChange(addDays(this.vm.dateKey, 1)), onPick: () => {} })
        if (this.vm.errorKey !== null) {
          EmptyState({ title: $r('app.string.day_empty_title'), hint: $r('app.string.day_empty_hint') })
        } else if (this.vm.isEmpty) {
          EmptyState({ title: $r('app.string.day_empty_title'), hint: $r('app.string.day_empty_hint') })
        } else {
          ForEach(this.vm.courses, (course) => {
            CourseCard({ model: course, compact: false,
              onOpen: () => { this.selectedDetail = course.detail; this.showDetail = true; } })
          }, (course) => course.row.key)
        }
        if (this.showDetail && this.selectedDetail !== null) {
          CourseDetailSheet({ detail: this.selectedDetail, onClose: () => { this.showDetail = false; } })
        }
        LeaveStatusEntry({ onOpen: () => this.onOpenLeaveStatus() })
      }.padding($r('app.float.float_page_padding')).width('100%')
    }.width('100%').height('100%').backgroundColor($r('app.color.color_background'))
  }
}
