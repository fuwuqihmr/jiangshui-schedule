// 职责：今日页顶部概览卡（今日节数 / 下一节时间地点 / 假条入口）。
// 依赖方向：features/custom -> core/timetable、core/custom 纯逻辑 + ArkUI 资源。
// 阶段：P4；父页面只需传入 state/leaveRecords/todayKey。
import type { AppState } from '../../core/types/AppState';
import type { LeaveRecord } from '../../core/types/Leave';
import { resolveDay, markLeave } from '../../core/timetable/TimetableCore';
import type { TodayOverview } from '../../core/custom/CustomScheduleService';
import { buildTodayOverview } from '../../core/custom/CustomScheduleService';
import { LeaveBadge } from './LeaveBadge';

function emptyOverview(): TodayOverview {
  return {
    lessonCount: 0,
    nextStartTime: '',
    nextEndTime: '',
    nextName: '',
    nextRoom: '',
    leaveCount: 0,
    pendingLeaveCount: 0,
    hasLeave: false
  };
}

@Component
export struct TodayOverviewCard {
  @Prop @Watch('refresh') state: AppState;
  @Prop @Watch('refresh') leaveRecords: LeaveRecord[];
  todayKey: string = '';
  onOpenLeave: () => void = () => {};
  @State overview: TodayOverview = emptyOverview();

  aboutToAppear(): void {
    this.refresh();
  }

  refresh(): void {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const rows = markLeave(resolveDay(this.state, this.todayKey), this.leaveRecords);
    this.overview = buildTodayOverview(rows, this.leaveRecords, minutes);
  }

  build() {
    Column({ space: 8 }) {
      Row() {
        Text($r('app.string.custom_today_title')).fontSize(14).fontWeight(FontWeight.Medium)
        Blank()
        Text($r('app.string.custom_today_lessons')).fontSize(12)
        Text(String(this.overview.lessonCount)).fontSize(14).fontWeight(FontWeight.Medium)
      }.width('100%')
      if (this.overview.nextStartTime !== '') {
        Row({ space: 6 }) {
          Text($r('app.string.custom_today_next')).fontSize(12)
          Text(this.overview.nextStartTime + '-' + this.overview.nextEndTime).fontSize(12)
          Text(this.overview.nextName).fontSize(12).fontWeight(FontWeight.Medium)
          Text(this.overview.nextRoom).fontSize(12)
        }.width('100%')
      } else {
        Text($r('app.string.custom_today_next_none')).fontSize(12)
      }
      if (this.overview.hasLeave) {
        Row({ space: 8 }) {
          Text($r('app.string.custom_today_leave')).fontSize(12)
          LeaveBadge({
            status: this.overview.leaveCount > 0 ? 'approved' : 'pending',
            onOpen: () => { this.onOpenLeave(); }
          })
          if (this.overview.pendingLeaveCount > 0 && this.overview.leaveCount > 0) {
            Text($r('app.string.custom_today_pending')).fontSize(11)
            LeaveBadge({ status: 'pending', onOpen: () => { this.onOpenLeave(); } })
          }
          Blank()
          Text($r('app.string.custom_leave_detail')).fontSize(11).onClick(() => { this.onOpenLeave(); })
        }.width('100%')
      }
    }
    .padding(12)
    .borderRadius(8)
    .width('100%')
  }
}
