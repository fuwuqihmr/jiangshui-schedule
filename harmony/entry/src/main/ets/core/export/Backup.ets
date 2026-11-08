// 职责：全量状态备份（导出 JSON / 导入校验），对应第③项；导入先校验后落地，坏数据一律拒且不改内存态。
// 依赖方向：import type 只有 core/types（AppState）；零运行时 import（run-core-tests 纯度门禁）。
// 阶段：P5 导出与备份；落地写入由 data/StateRepository 负责，本文件只产出「校验通过的 state」。
// 互通决策：web/Android「课表快照」不是全量状态，显式拒绝（BACKUP_LEGACY_UNSUPPORTED），
//         不做静默部分合并——它会丢掉设置/调休/事件/日志，且无法通过版本与结构校验。
// checkStateShape 从「顶层字段类型」升级为「完整状态严格校验」（snapshot 内每条规则/日期/周次、
//         五个数组的元素、holidaySettings），并提供 validateRestoreState 供 UI 在写盘前二次校验。
//         校验逻辑与 core/validate/SnapshotValidator 有意重复：core 内不允许运行时 import，只能自包含。

import type { AppState } from '../types/AppState';

export const BACKUP_FORMAT: string = 'jiangshui-schedule-backup';
export const BACKUP_VERSION: number = 1;
export const CURRENT_STATE_VERSION: number = 3;
export const MAX_BACKUP_BYTES: number = 16 * 1024 * 1024;
export const MAX_BACKUP_CUSTOM_COURSES: number = 500;
export const MAX_BACKUP_RECORDS: number = 5000;
export const MAX_BACKUP_EVENTS: number = 2000;
export const MAX_BACKUP_RULES: number = 1000;

export const CODE_BACKUP_EMPTY: string = 'BACKUP_EMPTY';
export const CODE_BACKUP_TOO_LARGE: string = 'BACKUP_TOO_LARGE';
export const CODE_BACKUP_INVALID_JSON: string = 'BACKUP_INVALID_JSON';
export const CODE_BACKUP_NOT_OBJECT: string = 'BACKUP_NOT_OBJECT';
export const CODE_BACKUP_FORMAT: string = 'BACKUP_FORMAT_UNSUPPORTED';
export const CODE_BACKUP_VERSION: string = 'BACKUP_VERSION_UNSUPPORTED';
export const CODE_BACKUP_STATE_INVALID: string = 'BACKUP_STATE_INVALID';
export const CODE_BACKUP_STATE_FUTURE: string = 'BACKUP_STATE_VERSION_FUTURE';
export const CODE_BACKUP_TOO_MANY: string = 'BACKUP_TOO_MANY_ITEMS';
export const CODE_BACKUP_LEGACY: string = 'BACKUP_LEGACY_UNSUPPORTED';

const THEMES: string[] = ['system', 'blue', 'black', 'white', 'purple'];
const RULE_SOURCES: string[] = ['school', 'custom', 'study', 'local'];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface BackupEnvelope {
  format: string;
  version: number;
  exportedAt: number;
  appVersion: string;
  state: AppState;
}

export interface BackupSummary {
  semesterName: string;
  weeks: number;
  customCourses: number;
  events: number;
  revision: number;
}

export interface BackupParseResult {
  ok: boolean;
  code: string;
  state: AppState | null;
  exportedAt: number;
  appVersion: string;
  summary: BackupSummary | null;
}

interface RawSnapshot {
  id?: Object;
  name?: Object;
  startDate?: Object;
  weeks?: Object;
  rules?: Object;
  source?: Object;
  closedDates?: Object;
  remaps?: Object;
  exceptions?: Object;
  studyPolicy?: Object;
  unscheduled?: Object;
  studentProfile?: Object | null;
}

interface RawState {
  version?: Object;
  snapshot?: Object | null;
  events?: Object;
  changeRecords?: Object;
  overrides?: Object;
  localMaps?: Object;
  holidaySettings?: Object | null;
  courseSettings?: Object;
  customCourses?: Object;
  theme?: Object;
  showDayOverview?: Object;
  settingsExpanded?: Object;
  leaveStatus?: Object;
  demoMode?: Object;
  calendarOptions?: Object;
  notificationEnabled?: Object;
  classReminders?: Object;
  autoCheckEnabled?: Object;
  lastSuccess?: Object;
  lastAttempt?: Object;
  error?: Object | null;
  _revision?: Object;
}

interface RawEnvelope {
  format?: Object;
  version?: Object;
  exportedAt?: Object;
  appVersion?: Object;
  state?: Object;
}

function isObject(value: Object | null | undefined): boolean {
  return value !== null && value !== undefined && typeof value === 'object';
}

function isFiniteNumber(value: Object | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: Object | null | undefined): boolean {
  return typeof value === 'number' && Number.isInteger(value);
}

function isBoolean(value: Object | null | undefined): boolean {
  return typeof value === 'boolean';
}

function isString(value: Object | null | undefined): boolean {
  return typeof value === 'string';
}

function arrayLength(value: Object | null | undefined): number {
  return Array.isArray(value) ? (value as Object[]).length : -1;
}

function checkBooleanFields(raw: Object | null | undefined, fields: string[]): boolean {
  if (!isObject(raw)) {
    return false;
  }
  const record = raw as Record<string, Object>;
  for (const field of fields) {
    if (!isBoolean(record[field])) {
      return false;
    }
  }
  return true;
}

function validDateKey(value: Object | null | undefined): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function weekdayOf(dateKey: string): number {
  return new Date(dateKey + 'T00:00:00Z').getUTCDay() || 7;
}

function checkRule(rule: Object, totalWeeks: number, ids: Set<string>): boolean {
  if (!isObject(rule)) {
    return false;
  }
  const raw = rule as Record<string, Object>;
  if (typeof raw.id !== 'string' || (raw.id as string) === '' || ids.has(raw.id as string)) {
    return false;
  }
  if (typeof raw.name !== 'string' || (raw.name as string).trim() === '') {
    return false;
  }
  const hasDay = isInteger(raw.dayOfWeek);
  const hasWeekday = isInteger(raw.weekday);
  if (hasDay && hasWeekday && (raw.dayOfWeek as number) !== (raw.weekday as number)) {
    return false;
  }
  const weekday = hasDay ? raw.dayOfWeek as number : raw.weekday as number;
  if (!hasDay && !hasWeekday) {
    return false;
  }
  if (weekday < 1 || weekday > 7) {
    return false;
  }
  if (!isInteger(raw.startPeriod) || (raw.startPeriod as number) < 1 || (raw.startPeriod as number) > 16) {
    return false;
  }
  if (!isInteger(raw.endPeriod) || (raw.endPeriod as number) < 1 || (raw.endPeriod as number) > 16 ||
    (raw.endPeriod as number) < (raw.startPeriod as number)) {
    return false;
  }
  if (raw.periods !== null && raw.periods !== undefined) {
    if (arrayLength(raw.periods) < 1) {
      return false;
    }
    for (const period of raw.periods as Object[]) {
      if (!isInteger(period) || (period as number) < 1 || (period as number) > 16) {
        return false;
      }
    }
  }
  if (arrayLength(raw.weeks) < 1) {
    return false;
  }
  for (const week of raw.weeks as Object[]) {
    if (!isInteger(week) || (week as number) < 1 || (week as number) > totalWeeks) {
      return false;
    }
  }
  if (typeof raw.startTime !== 'string' || !TIME_PATTERN.test(raw.startTime as string) ||
    typeof raw.endTime !== 'string' || !TIME_PATTERN.test(raw.endTime as string) ||
    (raw.endTime as string) <= (raw.startTime as string)) {
    return false;
  }
  if (!isBoolean(raw.cancelled)) {
    return false;
  }
  if (typeof raw.source !== 'string' || RULE_SOURCES.indexOf(raw.source as string) < 0) {
    return false;
  }
  ids.add(raw.id as string);
  return true;
}

function checkSnapshot(snapshot: RawSnapshot, totalWeeks: number): boolean {
  if (typeof snapshot.id !== 'string' || (snapshot.id as string) === '') {
    return false;
  }
  if (typeof snapshot.name !== 'string' || (snapshot.name as string).trim() === '') {
    return false;
  }
  if (typeof snapshot.startDate !== 'string' || !validDateKey(snapshot.startDate) ||
    weekdayOf(snapshot.startDate as string) !== 1) {
    return false;
  }
  if (arrayLength(snapshot.rules) < 0 || arrayLength(snapshot.rules) > MAX_BACKUP_RULES) {
    return false;
  }
  const ids = new Set<string>();
  for (const rule of snapshot.rules as Object[]) {
    if (!checkRule(rule, totalWeeks, ids)) {
      return false;
    }
  }
  if (!isObject(snapshot.source)) {
    return false;
  }
  const source = snapshot.source as Record<string, Object>;
  if (source.kind !== 'school' && source.kind !== 'sample') {
    return false;
  }
  if (typeof source.label !== 'string') {
    return false;
  }
  if (snapshot.closedDates !== null && snapshot.closedDates !== undefined) {
    if (arrayLength(snapshot.closedDates) < 0) {
      return false;
    }
    for (const date of snapshot.closedDates as Object[]) {
      if (!validDateKey(date)) {
        return false;
      }
    }
  }
  if (snapshot.remaps !== null && snapshot.remaps !== undefined) {
    if (arrayLength(snapshot.remaps) < 0) {
      return false;
    }
    const remapIds = new Set<string>();
    for (const remap of snapshot.remaps as Object[]) {
      if (!isObject(remap)) {
        return false;
      }
      const item = remap as Record<string, Object>;
      if (typeof item.id !== 'string' || (item.id as string) === '' || remapIds.has(item.id as string) ||
        !validDateKey(item.date) || !validDateKey(item.fromDate) ||
        (item.mode !== 'append' && item.mode !== 'replace')) {
        return false;
      }
      remapIds.add(item.id as string);
    }
  }
  if (snapshot.exceptions !== null && snapshot.exceptions !== undefined) {
    if (arrayLength(snapshot.exceptions) < 0) {
      return false;
    }
    for (const exception of snapshot.exceptions as Object[]) {
      if (!isObject(exception)) {
        return false;
      }
      const item = exception as Record<string, Object>;
      if (!validDateKey(item.date) || typeof item.ruleId !== 'string' || !ids.has(item.ruleId as string) ||
        !isBoolean(item.cancel)) {
        return false;
      }
    }
  }
  if (snapshot.unscheduled !== null && snapshot.unscheduled !== undefined) {
    if (arrayLength(snapshot.unscheduled) < 0) {
      return false;
    }
    for (const item of snapshot.unscheduled as Object[]) {
      if (!isObject(item)) {
        return false;
      }
      const raw = item as Record<string, Object>;
      if (typeof raw.id !== 'string' || (raw.id as string) === '' ||
        typeof raw.name !== 'string' || (raw.name as string).trim() === '' ||
        arrayLength(raw.weeks) < 0) {
        return false;
      }
      for (const week of raw.weeks as Object[]) {
        if (!isInteger(week) || (week as number) < 1 || (week as number) > totalWeeks) {
          return false;
        }
      }
    }
  }
  if (snapshot.studyPolicy !== null && snapshot.studyPolicy !== undefined) {
    if (!checkBooleanFields(snapshot.studyPolicy, ['enabled', 'userEnabled', 'userDisabled'])) {
      return false;
    }
  }
  if (snapshot.studentProfile !== null && snapshot.studentProfile !== undefined && !isObject(snapshot.studentProfile)) {
    return false;
  }
  return true;
}

function checkRecordList(list: Object, requireDate: boolean): boolean {
  if (arrayLength(list) < 0) {
    return false;
  }
  for (const item of list as Object[]) {
    if (!isObject(item)) {
      return false;
    }
    const raw = item as Record<string, Object>;
    if (typeof raw.id !== 'string' || (raw.id as string) === '') {
      return false;
    }
    if (requireDate && !validDateKey(raw.date)) {
      return false;
    }
  }
  return true;
}

function checkChangeEvents(list: Object | null | undefined): boolean {
  if (arrayLength(list) < 0) {
    return false;
  }
  for (const item of list as Object[]) {
    if (!isObject(item)) {
      return false;
    }
    const raw = item as Record<string, Object>;
    if (typeof raw.id !== 'string' || (raw.id as string) === '' || !validDateKey(raw.date) ||
      typeof raw.kind !== 'string' || typeof raw.label !== 'string' || !isFiniteNumber(raw.createdAt)) {
      return false;
    }
  }
  return true;
}

function checkChangeRecords(list: Object | null | undefined): boolean {
  if (arrayLength(list) < 0) {
    return false;
  }
  for (const item of list as Object[]) {
    if (!isObject(item)) {
      return false;
    }
    const raw = item as Record<string, Object>;
    if (typeof raw.id !== 'string' || (raw.id as string) === '' || !validDateKey(raw.date)) {
      return false;
    }
  }
  return true;
}

function checkOverrides(list: Object | null | undefined): boolean {
  if (arrayLength(list) < 0) {
    return false;
  }
  for (const item of list as Object[]) {
    if (!isObject(item)) {
      return false;
    }
    const raw = item as Record<string, Object>;
    if (typeof raw.id !== 'string' || (raw.id as string) === '' || !validDateKey(raw.date) ||
      typeof raw.key !== 'string' || !isObject(raw.base) || !isObject(raw.patch)) {
      return false;
    }
  }
  return true;
}

function checkLocalMaps(list: Object | null | undefined): boolean {
  if (arrayLength(list) < 0) {
    return false;
  }
  for (const item of list as Object[]) {
    if (!isObject(item)) {
      return false;
    }
    const raw = item as Record<string, Object>;
    if (typeof raw.id !== 'string' || (raw.id as string) === '' || !validDateKey(raw.date) ||
      !validDateKey(raw.fromDate) || (raw.mode !== 'append' && raw.mode !== 'replace')) {
      return false;
    }
  }
  return true;
}

function checkCustomCourses(list: Object | null | undefined): boolean {
  if (arrayLength(list) < 0) {
    return false;
  }
  for (const item of list as Object[]) {
    if (!isObject(item)) {
      return false;
    }
    const raw = item as Record<string, Object>;
    if (typeof raw.id !== 'string' || (raw.id as string) === '' ||
      typeof raw.name !== 'string' || (raw.name as string).trim() === '' ||
      (raw.mode !== 'weekly' && raw.mode !== 'once') ||
      typeof raw.startTime !== 'string' || !TIME_PATTERN.test(raw.startTime as string) ||
      typeof raw.endTime !== 'string' || !TIME_PATTERN.test(raw.endTime as string)) {
      return false;
    }
  }
  return true;
}

function checkHolidaySettings(raw: Object | null | undefined): boolean {
  if (raw === null || raw === undefined) {
    return true;
  }
  if (!isObject(raw)) {
    return false;
  }
  const record = raw as Record<string, Object>;
  if (arrayLength(record.days) < 0) {
    return false;
  }
  for (const item of record.days as Object[]) {
    if (!isObject(item)) {
      return false;
    }
    const day = item as Record<string, Object>;
    if (!validDateKey(day.date) || !isBoolean(day.skipStudy)) {
      return false;
    }
  }
  for (const key of ['winter', 'summer']) {
    const range = record[key];
    if (range === null || range === undefined) {
      continue;
    }
    if (!isObject(range)) {
      return false;
    }
    const span = range as Record<string, Object>;
    if (!validDateKey(span.startDate) || !validDateKey(span.endDate)) {
      return false;
    }
  }
  return true;
}

function checkStateShape(raw: RawState): string {
  if (!isObject(raw)) {
    return CODE_BACKUP_STATE_INVALID;
  }
  if (!isInteger(raw.version)) {
    return CODE_BACKUP_STATE_INVALID;
  }
  const version: number = raw.version as number;
  if (version < 1) {
    return CODE_BACKUP_STATE_INVALID;
  }
  if (version > CURRENT_STATE_VERSION) {
    return CODE_BACKUP_STATE_FUTURE;
  }
  if (raw.snapshot !== null && raw.snapshot !== undefined) {
    const snapshot = raw.snapshot as RawSnapshot;
    if (!isObject(snapshot) || !isInteger(snapshot.weeks) ||
      (snapshot.weeks as number) < 1 || (snapshot.weeks as number) > 60) {
      return CODE_BACKUP_STATE_INVALID;
    }
    if (!checkSnapshot(snapshot, snapshot.weeks as number)) {
      return CODE_BACKUP_STATE_INVALID;
    }
  }
  // 先判数量上限再判元素结构：超限数据即使元素不完整也应报 TOO_MANY（既有测试契约）。
  if (arrayLength(raw.customCourses) > MAX_BACKUP_CUSTOM_COURSES ||
    arrayLength(raw.events) > MAX_BACKUP_EVENTS ||
    arrayLength(raw.changeRecords) > MAX_BACKUP_RECORDS ||
    arrayLength(raw.overrides) > MAX_BACKUP_RECORDS ||
    arrayLength(raw.localMaps) > MAX_BACKUP_RECORDS) {
    return CODE_BACKUP_TOO_MANY;
  }
  if (!checkChangeEvents(raw.events) || !checkChangeRecords(raw.changeRecords) ||
    !checkOverrides(raw.overrides) || !checkLocalMaps(raw.localMaps) || !checkCustomCourses(raw.customCourses)) {
    return CODE_BACKUP_STATE_INVALID;
  }
  if (!checkHolidaySettings(raw.holidaySettings)) {
    return CODE_BACKUP_STATE_INVALID;
  }
  if (!checkBooleanFields(raw.courseSettings, ['showEveningStudy']) ||
    !checkBooleanFields(raw.calendarOptions, ['school', 'custom', 'study']) ||
    !checkBooleanFields(raw.classReminders, ['enabled']) ||
    !checkBooleanFields(raw.settingsExpanded, ['auto', 'display', 'leave', 'course', 'data', 'about'])) {
    return CODE_BACKUP_STATE_INVALID;
  }
  if (!isFiniteNumber((raw.classReminders as Record<string, Object>).leadMinutes)) {
    return CODE_BACKUP_STATE_INVALID;
  }
  if (!isString(raw.theme) || THEMES.indexOf(raw.theme as string) < 0) {
    return CODE_BACKUP_STATE_INVALID;
  }
  for (const flag of [raw.showDayOverview, raw.notificationEnabled, raw.autoCheckEnabled]) {
    if (!isBoolean(flag)) {
      return CODE_BACKUP_STATE_INVALID;
    }
  }
  if (!isFiniteNumber(raw.lastSuccess) || !isFiniteNumber(raw.lastAttempt)) {
    return CODE_BACKUP_STATE_INVALID;
  }
  if (raw.error !== null && raw.error !== undefined && !isString(raw.error)) {
    return CODE_BACKUP_STATE_INVALID;
  }
  if (raw._revision !== null && raw._revision !== undefined && !isFiniteNumber(raw._revision)) {
    return CODE_BACKUP_STATE_INVALID;
  }
  if (raw.demoMode !== null && raw.demoMode !== undefined && !isBoolean(raw.demoMode)) {
    return CODE_BACKUP_STATE_INVALID;
  }
  if (raw.leaveStatus !== null && raw.leaveStatus !== undefined && !isObject(raw.leaveStatus)) {
    return CODE_BACKUP_STATE_INVALID;
  }
  return '';
}

// 写盘前二次校验：返回稳定错误码，'' 表示可以落地。UI 必须在 apply 之前调用。
export function validateRestoreState(state: AppState): string {
  if (!isObject(state as Object)) {
    return CODE_BACKUP_STATE_INVALID;
  }
  return checkStateShape(state as Object as RawState);
}

export function summarizeBackup(state: AppState | null): BackupSummary {
  if (state === null) {
    return { semesterName: '', weeks: 0, customCourses: 0, events: 0, revision: 0 };
  }
  const snapshot = state.snapshot;
  return {
    semesterName: snapshot === null ? '' : snapshot.name,
    weeks: snapshot === null ? 0 : snapshot.weeks,
    customCourses: Array.isArray(state.customCourses) ? state.customCourses.length : 0,
    events: Array.isArray(state.events) ? state.events.length : 0,
    revision: typeof state._revision === 'number' ? state._revision : 0
  };
}

export function buildBackupJson(state: AppState, nowMs: number, appVersion: string): string {
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Number.isFinite(nowMs) ? nowMs : 0,
    appVersion: typeof appVersion === 'string' ? appVersion : '',
    state: state
  };
  return JSON.stringify(envelope, null, 2);
}

function fail(code: string, exportedAt: number, appVersion: string): BackupParseResult {
  return { ok: false, code, state: null, exportedAt, appVersion, summary: null };
}

// 两种输入都接受：鸿蒙备份外壳 {format,version,exportedAt,state}，或 Android state.json 那样裸 AppState。
// A10：上限必须按 UTF-8 字节数判断（raw.length 是 UTF-16 码元数，CJK 会少算到 1/3）。
function utf8ByteLength(raw: string): number {
  let bytes = 0;
  for (let index = 0; index < raw.length; index++) {
    const code = raw.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function parseBackupJson(raw: string): BackupParseResult {
  if (typeof raw !== 'string' || raw.length === 0) {
    return fail(CODE_BACKUP_EMPTY, 0, '');
  }
  if (utf8ByteLength(raw) > MAX_BACKUP_BYTES) {
    return fail(CODE_BACKUP_TOO_LARGE, 0, '');
  }
  let parsed: Object;
  try {
    parsed = JSON.parse(raw) as Object;
  } catch (error) {
    return fail(CODE_BACKUP_INVALID_JSON, 0, '');
  }
  if (!isObject(parsed) || Array.isArray(parsed)) {
    return fail(CODE_BACKUP_NOT_OBJECT, 0, '');
  }
  const envelope = parsed as RawEnvelope;
  let stateRaw: RawState;
  let exportedAt: number = 0;
  let appVersion: string = '';
  if (isString(envelope.format)) {
    if (envelope.format !== BACKUP_FORMAT) {
      return fail(CODE_BACKUP_FORMAT, 0, '');
    }
    if (!isInteger(envelope.version)) {
      return fail(CODE_BACKUP_VERSION, 0, '');
    }
    const version: number = envelope.version as number;
    if (version > BACKUP_VERSION || version < 1) {
      return fail(CODE_BACKUP_VERSION, 0, '');
    }
    if (!isObject(envelope.state)) {
      return fail(CODE_BACKUP_STATE_INVALID, 0, '');
    }
    stateRaw = envelope.state as RawState;
    exportedAt = isFiniteNumber(envelope.exportedAt) ? envelope.exportedAt as number : 0;
    appVersion = isString(envelope.appVersion) ? envelope.appVersion as string : '';
  } else {
    // 裸 AppState：web 旧「课表快照」是学期快照 + customCourses（无 state.version 结构），这里显式区分。
    const maybeState = parsed as RawState;
    if (!isInteger(maybeState.version)) {
      // web/Android「课表快照」：无 version、只有学期快照字段 + customCourses 数组。
      if (arrayLength((parsed as Record<string, Object>).customCourses) >= 0) {
        return fail(CODE_BACKUP_LEGACY, 0, '');
      }
      return fail(CODE_BACKUP_FORMAT, 0, '');
    }
    stateRaw = maybeState;
  }
  const code: string = checkStateShape(stateRaw);
  if (code !== '') {
    return fail(code, exportedAt, appVersion);
  }
  const state = stateRaw as AppState;
  return {
    ok: true,
    code: '',
    state,
    exportedAt,
    appVersion,
    summary: summarizeBackup(state)
  };
}

function pad2(value: number): string {
  return value < 10 ? '0' + String(value) : String(value);
}

// 与 ExportFiles.compactStamp 同一规则；这里保留一份最小实现，避免 core 内运行时 import。
export function buildBackupFileName(prefix: string, label: string, nowMs: number, offsetMinutes: number): string {
  const time: number = Number.isFinite(nowMs) ? nowMs : 0;
  const offset: number = Number.isFinite(offsetMinutes) ? offsetMinutes : 0;
  const local: Date = new Date(time + offset * 60000);
  const stamp: string = String(local.getUTCFullYear()) + pad2(local.getUTCMonth() + 1) + pad2(local.getUTCDate()) +
    '-' + pad2(local.getUTCHours()) + pad2(local.getUTCMinutes());
  const rawLabel: string = typeof label === 'string' && label.length > 0 ? label : 'backup';
  const clean: string = rawLabel.split('/').join('-').split('\\').join('-').split(':').join('-').split('*').join('-')
    .split('?').join('-').split('"').join('-').split('<').join('-').split('>').join('-').split('|').join('-');
  const safePrefix: string = typeof prefix === 'string' && prefix.length > 0 ? prefix : 'jiangshui';
  return safePrefix + '-' + clean + '-' + stamp + '.json';
}
