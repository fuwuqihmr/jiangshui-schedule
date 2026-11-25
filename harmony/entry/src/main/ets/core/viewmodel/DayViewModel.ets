// 职责：今日页视图模型，纯逻辑、可 Node type-strip 执行。
// 依赖方向：core/viewmodel -> core/types（仅 import type）。
// 阶段：P2 今日页；业务解析由 deps.resolveDay/markLeave 注入。
// 待确认：DatePickerDialog 与 bindSheet 的 API 12 行为由页面层负责。

import type { AppState, CourseRow } from '../types/AppState';
import type { LeaveRecord } from '../types/Leave';
import type { ViewModelCopy } from './ViewModelCopy';

export type DayStatus = 'normal' | 'cancelled' | 'leave-approved' | 'leave-pending' | 'moved' | 'vacant' | 'study';
export type CourseColorKey = DayStatus;
export type CourseTag = 'custom' | 'makeup' | 'modified' | 'conflict' | 'overlap';

export interface CourseDetailView {
  dateKey: string;
  timeText: string;
  name: string;
  room: string;
  teacher: string;
  sourceLabel: string;
  statusLabel: string;
  movedToText: string;
  leaveText: string;
}

export interface CourseView {
  row: CourseRow;
  timeText: string;
  periodText: string;
  status: DayStatus;
  colorKey: CourseColorKey;
  tags: CourseTag[];
  statusLabel: string;
  tagLabels: string[];
  movedToText: string;
  a11yText: string;
  detail: CourseDetailView;
}

export interface DayViewDeps {
  resolveDay: (state: AppState, dateKey: string) => CourseRow[];
  markLeave: (rows: CourseRow[], records: LeaveRecord[]) => CourseRow[];
  weekdayOf: (dateKey: string) => number;
}

export interface DayViewInput {
  state: AppState;
  dateKey: string;
  todayKey: string;
  weekNumber: number;
  leaveRecords: LeaveRecord[];
}

export interface DayViewModel {
  dateKey: string;
  weekdayLabel: string;
  title: string;
  weekNumber: number;
  isSample: boolean;
  courses: CourseView[];
  isEmpty: boolean;
  activeCount: number;
  errorKey: 'NO_SEMESTER' | 'INVALID_DATE' | null;
}

export function emptyDayViewModel(): DayViewModel {
  return {
    dateKey: '',
    weekdayLabel: '',
    title: '',
    weekNumber: 1,
    isSample: false,
    courses: [],
    isEmpty: true,
    activeCount: 0,
    errorKey: null
  };
}

export function formatTimeRange(start: string, end: string): string {
  return start + '–' + end;
}

export function formatPeriods(periods: number[]): string {
  if (periods.length === 0) {
    return '';
  }
  const sorted: number[] = periods.slice().sort((a: number, b: number): number => a - b);
  const uniq: number[] = [];
  for (const p of sorted) {
    if (uniq.indexOf(p) < 0) {
      uniq.push(p);
    }
  }
  const parts: string[] = [];
  let start = uniq[0];
  let prev = uniq[0];
  for (let i = 1; i < uniq.length; i++) {
    const current = uniq[i];
    if (current === prev + 1) {
      prev = current;
    } else {
      parts.push(start === prev ? String(start) : start + '-' + prev);
      start = current;
      prev = current;
    }
  }
  parts.push(start === prev ? String(start) : start + '-' + prev);
  return parts.join(',');
}

export function statusOf(row: CourseRow): DayStatus {
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
  if (status === 'leave-approved') {
    return copy.status.leaveApproved;
  }
  if (status === 'leave-pending') {
    return copy.status.leavePending;
  }
  if (status === 'moved') {
    return copy.status.moved;
  }
  if (status === 'vacant') {
    return copy.status.vacant;
  }
  if (status === 'cancelled') {
    return copy.status.cancelled;
  }
  if (status === 'study') {
    return copy.status.study;
  }
  return copy.status.normal;
}

function sourceLabelOf(row: CourseRow, copy: ViewModelCopy): string {
  if (row.source === 'school') {
    return copy.sources.school;
  }
  if (row.source === 'custom') {
    return copy.sources.custom;
  }
  if (row.source === 'study') {
    return copy.sources.study;
  }
  return copy.sources.local;
}

function replaceAllText(template: string, name: string, time: string, room: string,
  teacher: string, status: string): string {
  return template.replaceAll('{name}', name).replaceAll('{time}', time)
    .replaceAll('{room}', room).replaceAll('{teacher}', teacher).replaceAll('{status}', status);
}

function buildCourseView(row: CourseRow, copy: ViewModelCopy): CourseView {
  const status: DayStatus = statusOf(row);
  const movedToText: string = row.vacancyReason === 'moved' && row.movedTo !== undefined && row.movedTo !== null
    ? copy.movedTo.replaceAll('{date}', row.movedTo)
    : '';
  const tags: CourseTag[] = [];
  if (row.customCourse) {
    tags.push('custom');
  }
  if (row.remapId !== null || (row.originDate !== null && row.originDate !== row.date)) {
    tags.push('makeup');
  }
  if (row.source === 'local' && !row.customCourse && !row.localActivity) {
    tags.push('modified');
  }
  if (row.conflict) {
    tags.push('conflict');
  }
  if (row.overlap) {
    tags.push('overlap');
  }
  const tagLabels: string[] = [];
  for (const tag of tags) {
    if (tag === 'custom') {
      tagLabels.push(copy.tags.custom);
    } else if (tag === 'makeup') {
      tagLabels.push(copy.tags.makeup);
    } else if (tag === 'modified') {
      tagLabels.push(copy.tags.modified);
    } else if (tag === 'conflict') {
      tagLabels.push(copy.tags.conflict);
    } else {
      tagLabels.push(copy.tags.overlap);
    }
  }
  const statusLabel: string = statusLabelOf(status, copy);
  const timeText: string = formatTimeRange(row.startTime, row.endTime);
  const a11yText: string = status === 'moved' && movedToText !== ''
    ? replaceAllText(copy.a11yMoved, row.name, timeText, row.room, row.teacher, statusLabel)
    : replaceAllText(copy.a11yCourse, row.name, timeText, row.room, row.teacher, statusLabel);
  const leaveText: string = row.leave === true ? copy.status.leaveApproved : (row.pendingLeave === true ? copy.status.leavePending : '');
  return {
    row: row,
    timeText: timeText,
    periodText: '',
    status: status,
    colorKey: status,
    tags: tags,
    statusLabel: statusLabel,
    tagLabels: tagLabels,
    movedToText: movedToText,
    a11yText: a11yText,
    detail: {
      dateKey: row.date,
      timeText: timeText,
      name: row.name,
      room: row.room,
      teacher: row.teacher,
      sourceLabel: sourceLabelOf(row, copy),
      statusLabel: statusLabel,
      movedToText: movedToText,
      leaveText: leaveText
    }
  };
}

function dateDiff(a: string, b: string): number {
  const av: number = Date.parse(a + 'T00:00:00Z');
  const bv: number = Date.parse(b + 'T00:00:00Z');
  return Math.round((av - bv) / 86400000);
}

function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}

export function buildDayViewModel(input: DayViewInput, deps: DayViewDeps, copy: ViewModelCopy): DayViewModel {
  const vm: DayViewModel = emptyDayViewModel();
  vm.dateKey = input.dateKey;
  vm.weekNumber = input.weekNumber;
  const snapshot = input.state.snapshot;
  if (snapshot === null) {
    vm.errorKey = 'NO_SEMESTER';
    return vm;
  }
  vm.isSample = snapshot.source.kind === 'sample';
  if (!isValidDateKey(input.dateKey)) {
    vm.errorKey = 'INVALID_DATE';
    return vm;
  }
  const lastDate: string = new Date(Date.parse(snapshot.startDate + 'T00:00:00Z') + (snapshot.weeks * 7 - 1) * 86400000)
    .toISOString().slice(0, 10);
  if (input.dateKey < snapshot.startDate || input.dateKey > lastDate) {
    vm.errorKey = 'INVALID_DATE';
    return vm;
  }
  vm.weekdayLabel = copy.weekdays[deps.weekdayOf(input.dateKey) - 1];
  const diff: number = dateDiff(input.dateKey, input.todayKey);
  vm.title = diff === 0 ? copy.titleToday : (diff === 1 ? copy.titleTomorrow : (diff === -1 ? copy.titleYesterday : copy.titleSelected));
  const rows: CourseRow[] = deps.markLeave(deps.resolveDay(input.state, input.dateKey), input.leaveRecords);
  const courses: CourseView[] = [];
  for (const row of rows) {
    const view: CourseView = buildCourseView(row, copy);
    view.periodText = row.periods.length > 0 ? copy.periodLabel.replaceAll('{periods}', formatPeriods(row.periods)) : '';
    courses.push(view);
  }
  vm.courses = courses;
  vm.isEmpty = courses.length === 0;
  let active: number = 0;
  for (const c of courses) {
    if (!c.row.vacant && !c.row.cancelled) {
      active++;
    }
  }
  vm.activeCount = active;
  return vm;
}
