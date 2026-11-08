// 职责：snapshot 结构校验（对应 web validateSnapshot），坏字段抛 STATE_MIGRATION_FAILED。
// 依赖方向：core 内 type-only；零运行时 import；由 StateRepository 在迁移/加载时调用。
// 阶段：P1 数据层；只校验文件可恢复性，不访问网络或文件。
// CourseRule 的真实字段是 dayOfWeek（必填）+ weekday?（兼容旧数据），periods? 也可省略；
//           早先版本只认 weekday 且强制 periods 非空，会误杀合法规则，这里按真实 DTO 放宽并补强。
import type { SemesterSnapshot } from '../types/AppState';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_RULES = 1000;

function isObjectValue(value: Object | null | undefined): boolean {
  return value !== null && value !== undefined && typeof value === 'object';
}

function isIntegerValue(value: Object | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value as number) && Number.isInteger(value as number);
}

function isValidDate(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const time = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(time)) {
    return false;
  }
  return new Date(time).toISOString().slice(0, 10) === value;
}

function weekdayOf(dateKey: string): number {
  return new Date(dateKey + 'T00:00:00Z').getUTCDay() || 7;
}

function fail(): void {
  throw new Error('STATE_MIGRATION_FAILED');
}

// dayOfWeek 必填、weekday 可选；两者同时存在时必须一致（旧数据可能只有其中一个）。
function resolveWeekday(dayOfWeek: Object | null | undefined, weekday: Object | null | undefined): number {
  const hasDay = isIntegerValue(dayOfWeek);
  const hasWeekday = isIntegerValue(weekday);
  if (hasDay && hasWeekday && (dayOfWeek as number) !== (weekday as number)) {
    fail();
  }
  if (hasDay) {
    return dayOfWeek as number;
  }
  if (hasWeekday) {
    return weekday as number;
  }
  fail();
  return 0;
}

function validateRule(rule: Object, snapshotWeeks: number, ids: Set<string>): void {
  if (!isObjectValue(rule)) {
    fail();
  }
  const raw = rule as Record<string, Object>;
  if (typeof raw.id !== 'string' || (raw.id as string) === '' || ids.has(raw.id as string)) {
    fail();
  }
  if (typeof raw.name !== 'string' || (raw.name as string).trim() === '') {
    fail();
  }
  const weekday = resolveWeekday(raw.dayOfWeek, raw.weekday);
  if (weekday < 1 || weekday > 7) {
    fail();
  }
  const startPeriod = raw.startPeriod;
  const endPeriod = raw.endPeriod;
  if (!isIntegerValue(startPeriod) || (startPeriod as number) < 1 || (startPeriod as number) > 16) {
    fail();
  }
  if (!isIntegerValue(endPeriod) || (endPeriod as number) < 1 || (endPeriod as number) > 16 ||
    (endPeriod as number) < (startPeriod as number)) {
    fail();
  }
  if (raw.periods !== null && raw.periods !== undefined) {
    const periods = raw.periods;
    if (!(periods instanceof Array) || periods.length === 0) {
      fail();
    }
    for (const period of periods as Object[]) {
      if (!isIntegerValue(period) || (period as number) < 1 || (period as number) > 16) {
        fail();
      }
    }
  }
  const weeks = raw.weeks;
  if (!(weeks instanceof Array) || weeks.length === 0) {
    fail();
  }
  for (const week of weeks as Object[]) {
    if (!isIntegerValue(week) || (week as number) < 1 || (week as number) > snapshotWeeks) {
      fail();
    }
  }
  if (typeof raw.startTime !== 'string' || !TIME_PATTERN.test(raw.startTime as string) ||
    typeof raw.endTime !== 'string' || !TIME_PATTERN.test(raw.endTime as string) ||
    (raw.endTime as string) <= (raw.startTime as string)) {
    fail();
  }
  if (raw.cancelled !== true && raw.cancelled !== false) {
    fail();
  }
  if (raw.source !== 'school' && raw.source !== 'custom' && raw.source !== 'study' && raw.source !== 'local') {
    fail();
  }
  ids.add(raw.id as string);
}

function validateUnscheduled(value: Object, snapshotWeeks: number): void {
  if (!(value instanceof Array) || value.length > 5000) {
    fail();
  }
  for (const item of value as Object[]) {
    if (!isObjectValue(item)) {
      fail();
    }
    const raw = item as Record<string, Object>;
    if (typeof raw.id !== 'string' || (raw.id as string) === '') {
      fail();
    }
    if (typeof raw.name !== 'string' || (raw.name as string).trim() === '') {
      fail();
    }
    if (!(raw.weeks instanceof Array)) {
      fail();
    }
    for (const week of raw.weeks as Object[]) {
      if (!isIntegerValue(week) || (week as number) < 1 || (week as number) > snapshotWeeks) {
        fail();
      }
    }
  }
}

export function validateSnapshot(snapshot: SemesterSnapshot): void {
  if (snapshot === null || snapshot === undefined || !isObjectValue(snapshot as Object)) {
    fail();
  }
  const raw = snapshot as Object as Record<string, Object>;
  if (typeof raw.id !== 'string' || (raw.id as string) === '') {
    fail();
  }
  if (typeof raw.name !== 'string' || (raw.name as string).trim() === '') {
    fail();
  }
  if (typeof raw.startDate !== 'string' || !isValidDate(raw.startDate as string) ||
    weekdayOf(raw.startDate as string) !== 1) {
    fail();
  }
  if (!isIntegerValue(raw.weeks) || (raw.weeks as number) < 1 || (raw.weeks as number) > 60) {
    fail();
  }
  const totalWeeks: number = raw.weeks as number;
  if (!(raw.rules instanceof Array) || raw.rules.length > MAX_RULES) {
    fail();
  }
  const ids = new Set<string>();
  for (const rule of raw.rules as Object[]) {
    validateRule(rule, totalWeeks, ids);
  }
  if (!isObjectValue(raw.source)) {
    fail();
  }
  const source = raw.source as Record<string, Object>;
  if (source.kind !== 'school' && source.kind !== 'sample') {
    fail();
  }
  if (typeof source.label !== 'string') {
    fail();
  }
  if (raw.closedDates !== null && raw.closedDates !== undefined) {
    if (!(raw.closedDates instanceof Array)) {
      fail();
    }
    for (const date of raw.closedDates as Object[]) {
      if (typeof date !== 'string' || !isValidDate(date as string)) {
        fail();
      }
    }
  }
  if (raw.remaps !== null && raw.remaps !== undefined) {
    if (!(raw.remaps instanceof Array)) {
      fail();
    }
    const remapIds = new Set<string>();
    for (const remap of raw.remaps as Object[]) {
      if (!isObjectValue(remap)) {
        fail();
      }
      const item = remap as Record<string, Object>;
      if (typeof item.id !== 'string' || (item.id as string) === '' || remapIds.has(item.id as string) ||
        typeof item.date !== 'string' || !isValidDate(item.date as string) ||
        typeof item.fromDate !== 'string' || !isValidDate(item.fromDate as string) ||
        (item.mode !== 'append' && item.mode !== 'replace')) {
        fail();
      }
      remapIds.add(item.id as string);
    }
  }
  if (raw.exceptions !== null && raw.exceptions !== undefined) {
    if (!(raw.exceptions instanceof Array)) {
      fail();
    }
    for (const exception of raw.exceptions as Object[]) {
      if (!isObjectValue(exception)) {
        fail();
      }
      const item = exception as Record<string, Object>;
      if (typeof item.date !== 'string' || !isValidDate(item.date as string) ||
        typeof item.ruleId !== 'string' || !ids.has(item.ruleId as string) ||
        (item.cancel !== true && item.cancel !== false)) {
        fail();
      }
    }
  }
  if (raw.unscheduled !== null && raw.unscheduled !== undefined) {
    validateUnscheduled(raw.unscheduled as Object, totalWeeks);
  }
  if (raw.studyPolicy !== null && raw.studyPolicy !== undefined) {
    if (!isObjectValue(raw.studyPolicy)) {
      fail();
    }
    const policy = raw.studyPolicy as Record<string, Object>;
    for (const flag of [policy.enabled, policy.userEnabled, policy.userDisabled]) {
      if (flag !== true && flag !== false) {
        fail();
      }
    }
  }
  if (raw.studentProfile !== null && raw.studentProfile !== undefined && !isObjectValue(raw.studentProfile)) {
    fail();
  }
}
