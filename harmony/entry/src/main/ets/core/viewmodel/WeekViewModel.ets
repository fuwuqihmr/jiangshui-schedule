// 职责：完整课表页视图模型（5 时段 × 7 天），纯逻辑、Node 可执行。
// 依赖方向：core/viewmodel -> core/types（仅 import type）。
// 阶段：P2 完整课表；resolveDay/markLeave 由页面注入。
// 待确认：周格滚动与今天列样式需真机/Previewer 验证。

import type { AppState, CourseRow, SemesterSnapshot } from '../types/AppState';
import type { LeaveRecord } from '../types/Leave';
import type { ViewModelCopy } from './ViewModelCopy';
import type { CourseTag, CourseView, DayStatus } from './DayViewModel';

export interface WeekSlot {
  startPeriod: number;
  endPeriod: number;
  startTime: string;
  endTime: string;
}

// ArkTS 不允许匿名对象类型（arkts-no-obj-literals-as-types），时段区间用具名接口。
export interface WeekRange {
  start: number;
  end: number;
}

export const WEEK_PERIOD_COUNT: number = 11;
export const WEEK_SLOTS: WeekSlot[] = [
  { startPeriod: 1, endPeriod: 2, startTime: '08:30', endTime: '09:55' },
  { startPeriod: 3, endPeriod: 4, startTime: '10:15', endTime: '11:40' },
  { startPeriod: 5, endPeriod: 6, startTime: '14:00', endTime: '15:25' },
  { startPeriod: 7, endPeriod: 8, startTime: '15:45', endTime: '17:10' },
  { startPeriod: 9, endPeriod: 11, startTime: '19:00', endTime: '21:10' }
];

// 无学期快照时仍渲染 7 列日期表头与空网格（真机缺陷：只剩余时间轴）。
export const FALLBACK_WEEKS: number = 20;

export interface WeekBlockView {
  startSlot: number;
  endSlot: number;
  courses: CourseView[];
  isEmpty: boolean;
}

export interface WeekDayView {
  dateKey: string;
  weekdayLabel: string;
  dayNumber: string;
  blocks: WeekBlockView[];
  courses: CourseView[];
  isToday: boolean;
  isSelected: boolean;
  isEmpty: boolean;
}

export interface WeekViewModel {
  week: number;
  weekLabel: string;
  days: WeekDayView[];
  occupancy: boolean[][];
  todayColumn: number;
  selectedColumn: number;
  isEmpty: boolean;
  errorKey: 'NO_SEMESTER' | null;
}

export interface WeekViewDeps {
  resolveDay: (state: AppState, dateKey: string) => CourseRow[];
  markLeave: (rows: CourseRow[], records: LeaveRecord[]) => CourseRow[];
  weekdayOf: (dateKey: string) => number;
  addDays: (dateKey: string, amount: number) => string;
  weekOf: (snapshot: SemesterSnapshot, dateKey: string) => number;
}

export interface WeekViewInput {
  state: AppState;
  week: number;
  todayKey: string;
  selectedDateKey: string;
  leaveRecords: LeaveRecord[];
}

export function emptyWeekViewModel(): WeekViewModel {
  const oc: boolean[][] = [];
  for (let r = 0; r < WEEK_PERIOD_COUNT; r++) {
    const line: boolean[] = [];
    for (let c = 0; c < 7; c++) {
      line.push(false);
    }
    oc.push(line);
  }
  return { week: 1, weekLabel: '', days: [], occupancy: oc, todayColumn: -1, selectedColumn: -1, isEmpty: true, errorKey: null };
}

function minutes(value: string): number {
  const parts: string[] = value.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

export function courseWeekRange(row: CourseRow): WeekRange {
  const startMin: number = minutes(row.startTime);
  const endMin: number = minutes(row.endTime);
  let first: number = -1;
  let last: number = -1;
  for (let i = 0; i < WEEK_SLOTS.length; i++) {
    const slot: WeekSlot = WEEK_SLOTS[i];
    if (startMin < minutes(slot.endTime) && endMin > minutes(slot.startTime)) {
      if (first < 0) {
        first = i;
      }
      last = i;
    }
  }
  if (first >= 0) {
    return { start: first, end: last };
  }
  let nearest: number = 0;
  for (let i = 0; i < WEEK_SLOTS.length; i++) {
    if (startMin >= minutes(WEEK_SLOTS[i].startTime)) {
      nearest = i;
    }
  }
  return { start: nearest, end: nearest };
}

function courseStatus(row: CourseRow): DayStatus {
  if (row.vacant && row.vacancyReason === 'moved') {
    return 'moved';
  }
  if (row.vacant) {
    return 'vacant';
  }
  if (row.cancelled) {
    return 'cancelled';
  }
  if (row.leave === true) {
    return 'leave-approved';
  }
  if (row.pendingLeave === true) {
    return 'leave-pending';
  }
  if (row.localActivity) {
    return 'study';
  }
  return 'normal';
}

function statusLabelOf(status: DayStatus, copy: ViewModelCopy): string {
  if (status === 'leave-approved') return copy.status.leaveApproved;
  if (status === 'leave-pending') return copy.status.leavePending;
  if (status === 'moved') return copy.status.moved;
  if (status === 'vacant') return copy.status.vacant;
  if (status === 'cancelled') return copy.status.cancelled;
  if (status === 'study') return copy.status.study;
  return copy.status.normal;
}

function weekTags(row: CourseRow): CourseTag[] {
  const tags: CourseTag[] = [];
  if (row.customCourse) tags.push('custom');
  if (row.remapId !== null || (row.originDate !== null && row.originDate !== row.date)) tags.push('makeup');
  if (row.source === 'local' && !row.customCourse && !row.localActivity) tags.push('modified');
  if (row.conflict) tags.push('conflict');
  if (row.overlap) tags.push('overlap');
  return tags;
}

function weekTagLabels(tags: CourseTag[], copy: ViewModelCopy): string[] {
  const labels: string[] = [];
  for (const tag of tags) {
    if (tag === 'custom') labels.push(copy.tags.custom);
    else if (tag === 'makeup') labels.push(copy.tags.makeup);
    else if (tag === 'modified') labels.push(copy.tags.modified);
    else if (tag === 'conflict') labels.push(copy.tags.conflict);
    else labels.push(copy.tags.overlap);
  }
  return labels;
}

function weekCourseView(row: CourseRow, copy: ViewModelCopy): CourseView {
  const status: DayStatus = courseStatus(row);
  const timeText: string = row.startTime + '–' + row.endTime;
  const statusLabel: string = statusLabelOf(status, copy);
  const movedToText: string = row.vacancyReason === 'moved' && row.movedTo !== undefined && row.movedTo !== null
    ? copy.movedTo.replaceAll('{date}', row.movedTo) : '';
  const tags: CourseTag[] = weekTags(row);
  return {
    row: row, timeText: timeText, periodText: '', status: status, colorKey: status, tags: tags,
    statusLabel: statusLabel, tagLabels: weekTagLabels(tags, copy), movedToText: movedToText,
    a11yText: copy.a11yCourse.replaceAll('{name}', row.name).replaceAll('{time}', timeText)
      .replaceAll('{room}', row.room).replaceAll('{teacher}', row.teacher).replaceAll('{status}', statusLabel),
    detail: {
      dateKey: row.date, timeText: timeText, name: row.name, room: row.room, teacher: row.teacher,
      sourceLabel: row.source, statusLabel: statusLabel, movedToText: movedToText,
      leaveText: row.leave === true ? copy.status.leaveApproved : ''
    }
  };
}

export function weekDayBlocks(courses: CourseView[]): WeekBlockView[] {
  const blocks: WeekBlockView[] = [];
  let start: number = 0;
  while (start < WEEK_SLOTS.length) {
    const blockCourses: CourseView[] = [];
    let endSlot: number = start;
    for (const course of courses) {
      const range: WeekRange = courseWeekRange(course.row);
      if (range.start <= start && range.end >= start) {
        blockCourses.push(course);
        if (range.end > endSlot) {
          endSlot = range.end;
        }
      }
    }
    if (blockCourses.length > 0) {
      for (const course of courses) {
        const range: WeekRange = courseWeekRange(course.row);
        if (range.start <= endSlot && range.end >= start && blockCourses.indexOf(course) < 0) {
          blockCourses.push(course);
        }
      }
    }
    blocks.push({ startSlot: start, endSlot: endSlot, courses: blockCourses, isEmpty: blockCourses.length === 0 });
    start = endSlot + 1;
  }
  return blocks;
}
function markOccupancy(rows: CourseRow[], occupancy: boolean[][], column: number): void {
  for (const row of rows) {
    let periods: number[] = row.periods;
    if (periods.length === 0) {
      const range: WeekRange = courseWeekRange(row);
      periods = [WEEK_SLOTS[range.start].startPeriod, WEEK_SLOTS[range.end].endPeriod];
    }
    let from: number = Math.min(periods[0], periods[periods.length - 1]);
    let to: number = Math.max(periods[0], periods[periods.length - 1]);
    if (from < 1) from = 1;
    if (to > WEEK_PERIOD_COUNT) to = WEEK_PERIOD_COUNT;
    for (let p = from; p <= to; p++) {
      occupancy[p - 1][column] = true;
    }
  }
}

function dateDiff(a: string, b: string): number {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}

function formatWeekLabel(template: string, week: number): string {
  if (template.indexOf('{week}') >= 0) {
    return template.replaceAll('{week}', String(week));
  }
  if (template.length > 0) {
    return template + ' ' + String(week);
  }
  return String(week);
}

function fallbackWeekDays(input: WeekViewInput, deps: WeekViewDeps, copy: ViewModelCopy, week: number): WeekDayView[] {
  const days: WeekDayView[] = [];
  const anchor: string = input.selectedDateKey.length > 0 ? input.selectedDateKey : input.todayKey;
  let monday: string = '';
  if (anchor.length > 0) {
    monday = deps.addDays(anchor, -(deps.weekdayOf(anchor) - 1));
  }
  for (let i = 0; i < 7; i++) {
    const dateKey: string = monday.length > 0 ? deps.addDays(monday, (week - 1) * 7 + i) : '';
    days.push({
      dateKey: dateKey,
      weekdayLabel: copy.weekdays.length > i ? copy.weekdays[i] : '',
      dayNumber: dateKey.length >= 10 ? dateKey.slice(5) : dateKey,
      blocks: weekDayBlocks([]),
      courses: [],
      isToday: dateKey.length > 0 && dateKey === input.todayKey,
      isSelected: dateKey.length > 0 && dateKey === input.selectedDateKey,
      isEmpty: true
    });
  }
  return days;
}

export function buildWeekViewModel(input: WeekViewInput, deps: WeekViewDeps, copy: ViewModelCopy): WeekViewModel {
  const empty: WeekViewModel = emptyWeekViewModel();
  const snapshot: SemesterSnapshot | null = input.state.snapshot;
  const totalWeeks: number = snapshot === null ? FALLBACK_WEEKS : (snapshot.weeks > 0 ? snapshot.weeks : FALLBACK_WEEKS);
  let week: number = input.week;
  if (week < 1) week = 1;
  if (week > totalWeeks) week = totalWeeks;
  empty.week = week;
  empty.weekLabel = formatWeekLabel(copy.weekLabel, week);
  if (snapshot === null) {
    empty.errorKey = 'NO_SEMESTER';
    empty.days = fallbackWeekDays(input, deps, copy, week);
    empty.isEmpty = true;
    return empty;
  }
  const days: WeekDayView[] = [];
  for (let i = 0; i < 7; i++) {
    const dateKey: string = deps.addDays(snapshot.startDate, (week - 1) * 7 + i);
    const rows: CourseRow[] = deps.markLeave(deps.resolveDay(input.state, dateKey), input.leaveRecords);
    const courses: CourseView[] = [];
    for (const row of rows) {
      courses.push(weekCourseView(row, copy));
    }
    markOccupancy(rows, empty.occupancy, i);
    const weekdayIndex: number = deps.weekdayOf(dateKey) - 1;
    days.push({
      dateKey: dateKey,
      weekdayLabel: copy.weekdays.length > weekdayIndex ? copy.weekdays[weekdayIndex] : '',
      dayNumber: dateKey.length >= 10 ? dateKey.slice(5) : dateKey,
      blocks: weekDayBlocks(courses),
      courses: courses,
      isToday: dateKey === input.todayKey,
      isSelected: dateKey === input.selectedDateKey,
      isEmpty: courses.length === 0
    });
    if (dateKey === input.todayKey) empty.todayColumn = i;
    if (dateKey === input.selectedDateKey) empty.selectedColumn = i;
  }
  empty.days = days;
  let allEmpty: boolean = true;
  for (const day of days) {
    if (day.courses.length > 0) allEmpty = false;
  }
  empty.isEmpty = allEmpty;
  return empty;
}


