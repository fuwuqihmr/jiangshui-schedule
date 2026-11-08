// 职责：把学期课表展开成系统日历事件，并计算与已写入事件的差量（纯逻辑，无 Kit）。
// 依赖方向：core/system -> core/types；禁止 import pages/platform/data/features。
// 最终课表解析由调用方注入 resolveDay（core/data 纯逻辑门禁禁止运行时 import），
// 与 core/viewmodel/DayViewModel 的 deps.resolveDay 模式一致。
// 阶段：P6 系统日历；事件 key 稳定，重复写入可幂等。

import type { AppState, CalendarOptions, CourseRow } from '../types/AppState';
import type { CalendarBuildResult, CalendarEvent } from '../types/Calendar';

export const CALENDAR_MARKER_PREFIX = 'jiangshui:';
export const CALENDAR_EVENT_LIMIT = 5000;
const MS_PER_DAY = 86400000;
const MS_PER_MINUTE = 60000;
const TITLE_LIMIT = 200;
const LOCATION_LIMIT = 200;
const DESCRIPTION_LIMIT = 1000;

export type DayResolver = (state: AppState, date: string) => CourseRow[];

function pad2(value: number): string {
  return value < 10 ? '0' + String(value) : String(value);
}

function dateParts(text: string): number[] {
  const parts = text.split('-');
  const out: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    out.push(Number(parts[i]));
  }
  return out;
}

function formatDate(year: number, month: number, day: number): string {
  return String(year) + '-' + pad2(month) + '-' + pad2(day);
}

function advanceDate(date: string, days: number): string {
  const parts = dateParts(date);
  if (parts.length < 3 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || !Number.isFinite(parts[2])) {
    return date;
  }
  const base = Date.UTC(parts[0], parts[1] - 1, parts[2]) + days * MS_PER_DAY;
  const shifted = new Date(base);
  return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

function localMillis(date: string, time: string): number {
  const d = dateParts(date);
  const t = time.split(':');
  if (d.length < 3 || t.length < 2) {
    return -1;
  }
  const year = Number(d[0]);
  const month = Number(d[1]);
  const day = Number(d[2]);
  const hour = Number(t[0]);
  const minute = Number(t[1]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)
    || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return -1;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return -1;
  }
  return new Date(year, month - 1, day, hour, minute, 0).getTime();
}

function sourceIncluded(source: string, options: CalendarOptions): boolean {
  if (source === 'school') {
    return options.school;
  }
  if (source === 'custom' || source === 'local') {
    return options.custom;
  }
  if (source === 'study') {
    return options.study;
  }
  return false;
}

/** 选项归类：晚自习、自定义/调休/单日修改（本地调整后）与学校课程。 */
function optionSource(row: CourseRow): string {
  if (row.localActivity) {
    return 'study';
  }
  if (row.customCourse || row.remapId !== null || row.source === 'local') {
    return 'custom';
  }
  return 'school';
}

/** 事件 source 只写三类；单日修改后的学校课程仍标 school。 */
function eventSource(row: CourseRow): string {
  if (row.localActivity) {
    return 'study';
  }
  if (row.customCourse) {
    return 'custom';
  }
  return 'school';
}

function normalizeOptions(options: CalendarOptions): CalendarOptions {
  const school: boolean = options.school !== false;
  const custom: boolean = options.custom !== false;
  const study: boolean = options.study !== false;
  const normalized: CalendarOptions = { school: school, custom: custom, study: study };
  return normalized;
}

function clampText(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

export function calendarMarker(key: string): string {
  return CALENDAR_MARKER_PREFIX + key;
}

/** 事件 key 规范：`${date}/${row.key}`（calendar-settings-spec.md §1）。 */
export function calendarEventKey(date: string, rowKey: string): string {
  return date + '/' + rowKey;
}

/** 从事件描述里取回稳定 key；不是本应用写入的事件返回空串。 */
export function keyFromDescription(description: string): string {
  if (!description.startsWith(CALENDAR_MARKER_PREFIX)) {
    return '';
  }
  const rest = description.slice(CALENDAR_MARKER_PREFIX.length);
  const bar = rest.indexOf('|');
  return bar >= 0 ? rest.slice(0, bar) : rest;
}

export function calendarDescription(key: string, teacher: string): string {
  return calendarMarker(key) + '|' + teacher;
}

export function planCalendarEvents(state: AppState, options: CalendarOptions, resolveDay?: DayResolver): CalendarBuildResult {
  const snapshot = state.snapshot;
  if (snapshot === null || snapshot === undefined) {
    return { events: [], total: 0, skipped: 0, error: 'CALENDAR_UNAVAILABLE' };
  }
  const normalized = normalizeOptions(options);
  if (!normalized.school && !normalized.custom && !normalized.study) {
    return { events: [], total: 0, skipped: 0, error: 'CALENDAR_NO_OPTIONS' };
  }
  // 依赖注入：调用方必须显式传入最终课表解析器；缺少时给稳定错误码，不静默写空日历。
  if (resolveDay === undefined || resolveDay === null) {
    return { events: [], total: 0, skipped: 0, error: 'CALENDAR_UNAVAILABLE' };
  }
  const totalDays: number = snapshot.weeks * 7;
  const events: CalendarEvent[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (let i = 0; i < totalDays; i++) {
    const date = advanceDate(snapshot.startDate, i);
    const rows: CourseRow[] = resolveDay(state, date);
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      if (row.cancelled || row.vacant || row.name.trim() === '' || row.startTime === '' || row.endTime === '') {
        skipped++;
        continue;
      }
      if (!sourceIncluded(optionSource(row), normalized)) {
        skipped++;
        continue;
      }
      const startMillis = localMillis(date, row.startTime);
      const endMillis = localMillis(date, row.endTime);
      if (startMillis <= 0 || endMillis <= startMillis) {
        skipped++;
        continue;
      }
      const key = calendarEventKey(date, row.key);
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      const title = clampText(row.name.trim(), TITLE_LIMIT);
      const location = clampText(row.room, LOCATION_LIMIT);
      const description = clampText(calendarDescription(key, row.teacher), DESCRIPTION_LIMIT);
      const event: CalendarEvent = {
        key: key,
        title: title,
        location: location,
        description: description,
        startMillis: startMillis,
        endMillis: endMillis,
        startDate: date,
        startTime: row.startTime,
        endTime: row.endTime,
        source: eventSource(row)
      };
      events.push(event);
    }
  }
  events.sort((a: CalendarEvent, b: CalendarEvent): number => {
    if (a.startMillis !== b.startMillis) {
      return a.startMillis - b.startMillis;
    }
    return a.key.localeCompare(b.key);
  });
  if (events.length > CALENDAR_EVENT_LIMIT) {
    return { events: [], total: 0, skipped: skipped, error: 'CALENDAR_TOO_MANY_EVENTS' };
  }
  return { events: events, total: events.length, skipped: skipped, error: null };
}

export interface CalendarKeyDiff {
  add: CalendarEvent[];
  removeKeys: string[];
  keep: number;
}

/** 幂等差量：只新增缺的、只删除过期的，已存在的不重复写。 */
export function diffCalendarKeys(plan: CalendarEvent[], existingKeys: string[]): CalendarKeyDiff {
  const planKeys = new Set<string>();
  for (let i = 0; i < plan.length; i++) {
    planKeys.add(plan[i].key);
  }
  const existing = new Set<string>();
  for (let i = 0; i < existingKeys.length; i++) {
    existing.add(existingKeys[i]);
  }
  const add: CalendarEvent[] = [];
  for (let i = 0; i < plan.length; i++) {
    if (!existing.has(plan[i].key)) {
      add.push(plan[i]);
    }
  }
  const removeKeys: string[] = [];
  for (let i = 0; i < existingKeys.length; i++) {
    if (!planKeys.has(existingKeys[i])) {
      removeKeys.push(existingKeys[i]);
    }
  }
  return { add: add, removeKeys: removeKeys, keep: plan.length - add.length };
}

/** 给提醒计划用：开始时刻毫秒（本地时区）。 */
export function eventStartMillis(date: string, time: string): number {
  return localMillis(date, time);
}

export const CALENDAR_MINUTE_MILLIS = MS_PER_MINUTE;
