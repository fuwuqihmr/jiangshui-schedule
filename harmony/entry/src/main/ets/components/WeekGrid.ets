// 职责：完整课表周网格（5×7，消费 blocks/occupancy）。
// 依赖方向：components -> core/viewmodel 类型 only。
// 阶段：P2；跨节合并与滚动待真机验证。
import type { WeekViewModel, WeekSlotView, WeekDayView } from '../core/viewmodel/WeekViewModel';
import type { CourseView } from '../core/viewmodel/WeekViewModel';
import { WEEK_SLOTS } from '../core/viewmodel/WeekViewModel';
import { CourseCard } from './CourseCard';

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
  vm: WeekViewModel = {} as WeekViewModel;
  onSelectDay: (dateKey: string) => void = () => {};
  onOpenCourse: (course: CourseView) => void = () => {};
  build() {
    Scroll() {
      Column({ space: 2 }) {
        Row({ space: 2 }) {
          Text('').width(68)
          ForEach(this.vm.days, (day: WeekDayView) => {
            Text(day.weekdayLabel).fontSize($r('app.float.float_font_12')).width(92).textAlign(TextAlign.Center)
              .fontColor(day.isToday ? $r('app.color.color_accent') : $r('app.color.color_text_secondary'))
              .onClick(() => this.onSelectDay(day.dateKey))
          }, (day: WeekDayView) => day.dateKey)
        }.width(712)
        ForEach(WEEK_SLOTS, (slot: WeekSlot, slotIndex: number) => {
          Row({ space: 2 }) {
            Text(slot.startTime + '\n' + slot.label).fontSize($r('app.float.float_font_12')).width(68)
              .fontColor($r('app.color.color_text_secondary'))
            ForEach(this.vm.days, (day: WeekDayView, dayIndex: number) => {
              Column({ space: 2 }) {
                if (courseAt(day, slotIndex) !== null) {
                  CourseCard({ model: courseAt(day, slotIndex) as CourseView, compact: true,
                    onOpen: () => { const c: CourseView | null = courseAt(day, slotIndex); if (c !== null) this.onOpenCourse(c); } })
                } else {
                  Text('').height(44).width('100%')
                    .backgroundColor(this.vm.occupancy[slotIndex][dayIndex] ? $r('app.color.color_surface') : $r('app.color.color_background'))
                }
              }.width(92).height(52)
            }, (day: WeekDayView) => day.dateKey)
          }.width(712).height(52)
        }, (slot: WeekSlot, slotIndex: number) => slotIndex.toString())
      }
    }.scrollable(ScrollDirection.Horizontal)
  }
}



