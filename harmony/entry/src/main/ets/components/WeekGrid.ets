// 职责：完整课表周网格（5×7，消费 blocks/occupancy）。
// 依赖方向：components -> core/viewmodel 类型 only。
// 阶段：P2；跨节合并与滚动待真机验证。
import type { WeekViewModel, WeekSlot, WeekDayView } from '../core/viewmodel/WeekViewModel';
import type { CourseView } from '../core/viewmodel/DayViewModel';
import { WEEK_SLOTS, emptyWeekViewModel } from '../core/viewmodel/WeekViewModel';
import { CourseCard } from './CourseCard';

// 时间列固定，右侧仅横向滚 7 天，避免整表 Scroll 裁剪右侧卡片文字。
const TIME_COLUMN_WIDTH: number = 68;
const DAY_COLUMN_WIDTH: number = 92;
const CELL_GAP: number = 2;
const HEADER_HEIGHT: number = 44;
const CELL_HEIGHT: number = 52;
const DAYS_WIDTH: number = DAY_COLUMN_WIDTH * 7 + CELL_GAP * 6;
const GRID_HEIGHT: number = HEADER_HEIGHT + WEEK_SLOTS.length * CELL_HEIGHT + WEEK_SLOTS.length * CELL_GAP;

function courseAt(day: WeekDayView, slotIndex: number): CourseView | null {
  for (const block of day.blocks) {
    if (block.startSlot === slotIndex) {
      for (const course of block.courses) {
        return course;
      }
    }
  }
  for (const course of day.courses) {
    const periods: number[] = course.row.periods;
    if (periods.length > 0 && periods.indexOf(slotIndex + 1) >= 0) {
      return course;
    }
  }
  return null;
}

@Component
export struct WeekGrid {
  // P1 修复：vm 必须是状态变量。普通成员在 ArkUI 编译产物里 updateStateVars 为空（disasm.pa:37015），
  // 父组件刷新时只收到 updateStateVarsOfChildByElmtId(elmtId, {})，网格永远停在构造时的空模型。
  // 这里选 @Prop（深拷贝）：vm 是纯展示数据、无回调字段；换 @ObjectLink 需把 WeekViewModel 改 @Observed class，改动更大。
  @Prop vm: WeekViewModel = emptyWeekViewModel();
  onSelectDay: (dateKey: string) => void = () => {};
  onOpenCourse: (course: CourseView) => void = () => {};
  build() {
    Row() {
      Column({ space: CELL_GAP }) {
        Text('').width(TIME_COLUMN_WIDTH).height(HEADER_HEIGHT)
          .backgroundColor($r('app.color.color_surface'))
        ForEach(WEEK_SLOTS, (slot: WeekSlot, slotIndex: number) => {
          Text(slot.startTime + '\n' + slot.startPeriod.toString() + '-' + slot.endPeriod.toString())
            .fontSize($r('app.float.float_font_12')).width(TIME_COLUMN_WIDTH).height(CELL_HEIGHT)
            .fontColor($r('app.color.color_text_secondary')).textAlign(TextAlign.Center)
            .backgroundColor($r('app.color.color_surface'))
        }, (slot: WeekSlot, slotIndex: number) => slotIndex.toString())
      }.width(TIME_COLUMN_WIDTH).height(GRID_HEIGHT).backgroundColor($r('app.color.color_background'))
      Scroll() {
        Column({ space: CELL_GAP }) {
          Row({ space: CELL_GAP }) {
            ForEach(this.vm.days, (day: WeekDayView) => {
              Column({ space: 0 }) {
                Text(day.weekdayLabel).fontSize($r('app.float.float_font_12'))
                  .fontColor(day.isToday ? $r('app.color.color_accent') : $r('app.color.color_text_secondary'))
                Text(day.dayNumber).fontSize($r('app.float.float_font_11'))
                  .fontColor($r('app.color.color_text_secondary'))
              }.width(DAY_COLUMN_WIDTH).height(HEADER_HEIGHT)
                .justifyContent(FlexAlign.Center)
                .backgroundColor(day.isSelected ? $r('app.color.color_accent_soft') : $r('app.color.color_surface'))
                .borderRadius($r('app.float.float_radius_control'))
                .onClick(() => this.onSelectDay(day.dateKey))
            }, (day: WeekDayView) => day.dateKey)
          }.width(DAYS_WIDTH)
          ForEach(WEEK_SLOTS, (slot: WeekSlot, slotIndex: number) => {
            Row({ space: CELL_GAP }) {
              ForEach(this.vm.days, (day: WeekDayView, dayIndex: number) => {
                Column() {
                  if (courseAt(day, slotIndex) !== null) {
                    CourseCard({ model: courseAt(day, slotIndex) as CourseView, compact: true,
                      onOpen: () => { const c: CourseView | null = courseAt(day, slotIndex); if (c !== null) this.onOpenCourse(c); } })
                  } else {
                    Text('').height('100%').width('100%')
                      .backgroundColor(this.vm.occupancy[slotIndex][dayIndex] ? $r('app.color.color_surface') : $r('app.color.color_background'))
                  }
                }.width(DAY_COLUMN_WIDTH).height(CELL_HEIGHT)
              }, (day: WeekDayView) => day.dateKey)
            }.width(DAYS_WIDTH)
          }, (slot: WeekSlot, slotIndex: number) => slotIndex.toString())
        }.width(DAYS_WIDTH)
      }.layoutWeight(1).height('100%').scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
    }.width('100%').height('100%')
  }
}
