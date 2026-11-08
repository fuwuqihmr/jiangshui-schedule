// 职责：自定义课程/调休/单日休假/单日修改的纯逻辑服务，供自定义课程面板与今日概览消费。
// 依赖方向：core/custom -> core/types（仅 import type）；不依赖 TimetableCore 的运行时函数，
// 因此校验、周次展开、概览统计全部自包含；真实课表解析由调用方注入 resolveDay/diffState 结果。
// 阶段：P4 自定义课程与变更 diff 接线。
import type {
  AppState,
  ChangeRecord,
  CourseExceptionPatch,
  CourseRow,
  CustomCourse,
  DayOverride,
  HolidayDay,
  HolidaySettings,
  LocalMapRule,
  SemesterSnapshot,
  StudyPolicy
} from '../types/AppState';
import type { LeaveRecord } from '../types/Leave';

export const MAX_HISTORY: number = 20;
export const MAX_CHANGE_RECORDS: number = 200;
export const MAX_CUSTOM_WEEKS: number = 60;

const DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const TIME_RE = /^([0-9]{2}):([0-9]{2})$/;
const MINUTES_PER_DAY: number = 1440;

/** 自定义课程表单草稿；weekly 用 dayOfWeek+startWeek/endWeek，once 用 date。 */
export interface CustomCourseDraft {
  mode: 'weekly' | 'once';
  name: string;
  teacher: string;
  room: string;
  startTime: string;
  endTime: string;
  dayOfWeek: number;
  startWeek: number;
  endWeek: number;
  weekPattern: 'every' | 'odd' | 'even';
  date: string;
  /** 编辑既有课程时传入原 id；新增留空。 */
  customCourseId: string;
}

export interface DraftResult {
  ok: boolean;
  course: CustomCourse | null;
  errors: string[];
}

export interface LocalMapDraft {
  fromDate: string;
  date: string;
  mode: 'append' | 'replace';
}

export interface LocalMapResult {
  ok: boolean;
  rule: LocalMapRule | null;
  errors: string[];
}

export interface EditHistory {
  past: AppState[];
  present: AppState;
  future: AppState[];
}

export interface TodayOverview {
  lessonCount: number;
  nextStartTime: string;
  nextEndTime: string;
  nextName: string;
  nextRoom: string;
  leaveCount: number;
  pendingLeaveCount: number;
  hasLeave: boolean;
}

export interface LeaveAnnotation {
  key: string;
  status: 'approved' | 'pending' | 'none';
  recordIds: string[];
}

function pad2(value: number): string {
  return value < 10 ? '0' + String(value) : String(value);
}

export function isValidDateKey(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const stamp = Date.UTC(year, month - 1, day);
  const check = new Date(stamp);
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

export function dayNumber(dateKey: string): number {
  const match = DATE_RE.exec(dateKey);
  if (match === null) {
    return -1;
  }
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}

/** ISO 周几：周一=1，周日=7；非法日期返回 0。 */
export function weekdayOfDate(dateKey: string): number {
  if (!isValidDateKey(dateKey)) {
    return 0;
  }
  const match = DATE_RE.exec(dateKey);
  if (match === null) {
    return 0;
  }
  const stamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const weekday = new Date(stamp).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** 学期第几周；学期开始前/非法日期返回 0，允许超过总周数（调用方自行截断）。 */
export function weekNumberOf(snapshot: SemesterSnapshot | null, dateKey: string): number {
  if (snapshot === null || !isValidDateKey(snapshot.startDate) || !isValidDateKey(dateKey)) {
    return 0;
  }
  const delta = dayNumber(dateKey) - dayNumber(snapshot.startDate);
  if (delta < 0) {
    return 0;
  }
  return Math.floor(delta / 7) + 1;
}

/** HH:mm -> 当日分钟；非法返回 -1。 */
export function parseTimeToMinutes(value: string): number {
  const match = TIME_RE.exec(value);
  if (match === null) {
    return -1;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return -1;
  }
  return hour * 60 + minute;
}

export function minutesToTime(minutes: number): string {
  return pad2(Math.floor(minutes / 60)) + ':' + pad2(minutes % 60);
}

export function expandWeeks(startWeek: number, endWeek: number, pattern: string): number[] {
  const result: number[] = [];
  if (startWeek < 1 || endWeek < startWeek || endWeek > MAX_CUSTOM_WEEKS) {
    return result;
  }
  for (let week = startWeek; week <= endWeek; week++) {
    if (pattern === 'every' || week % 2 === (pattern === 'odd' ? 1 : 0)) {
      result.push(week);
    }
  }
  return result;
}

function trimText(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 表单校验，返回 ASCII 错误码；空数组表示通过。 */
export function validateCustomCourseDraft(draft: CustomCourseDraft, snapshot: SemesterSnapshot | null, existingIds: string[]): string[] {
  const errors: string[] = [];
  if (snapshot === null) {
    errors.push('semester-missing');
  }
  if (trimText(draft.name) === '') {
    errors.push('name-required');
  }
  const start = parseTimeToMinutes(draft.startTime);
  const end = parseTimeToMinutes(draft.endTime);
  if (start < 0 || end < 0) {
    errors.push('time-invalid');
  } else if (end <= start) {
    errors.push('time-order');
  }
  if (draft.mode === 'weekly') {
    if (!Number.isInteger(draft.dayOfWeek) || draft.dayOfWeek < 1 || draft.dayOfWeek > 7) {
      errors.push('day-invalid');
    }
    if (!Number.isInteger(draft.startWeek) || !Number.isInteger(draft.endWeek) ||
      draft.startWeek < 1 || draft.endWeek > MAX_CUSTOM_WEEKS || draft.endWeek < draft.startWeek) {
      errors.push('week-invalid');
    } else if (snapshot !== null && draft.endWeek > snapshot.weeks) {
      errors.push('week-out-of-range');
    }
    if (draft.weekPattern !== 'every' && draft.weekPattern !== 'odd' && draft.weekPattern !== 'even') {
      errors.push('week-pattern-invalid');
    }
  } else if (draft.mode === 'once') {
    if (!isValidDateKey(draft.date)) {
      errors.push('date-invalid');
    } else if (snapshot !== null) {
      const week = weekNumberOf(snapshot, draft.date);
      if (week < 1 || week > snapshot.weeks) {
        errors.push('date-out-of-semester');
      }
    }
  } else {
    errors.push('mode-invalid');
  }
  if (trimText(draft.customCourseId) !== '' && existingIds.indexOf(trimText(draft.customCourseId)) < 0) {
    errors.push('course-missing');
  }
  return errors;
}

function nextCustomCourseId(nowMs: number, existingIds: string[]): string {
  let index = existingIds.length + 1;
  let candidate = 'custom-' + String(nowMs) + '-' + String(index);
  while (existingIds.indexOf(candidate) >= 0) {
    index++;
    candidate = 'custom-' + String(nowMs) + '-' + String(index);
  }
  return candidate;
}

/** 组装 CustomCourse；校验失败时 course=null。 */
export function buildCustomCourse(draft: CustomCourseDraft, snapshot: SemesterSnapshot | null, existingIds: string[], nowMs: number): DraftResult {
  const errors = validateCustomCourseDraft(draft, snapshot, existingIds);
  if (errors.length > 0 || snapshot === null) {
    return { ok: false, course: null, errors: errors.length > 0 ? errors : ['semester-missing'] };
  }
  const editing = trimText(draft.customCourseId) !== '';
  const id = editing ? trimText(draft.customCourseId) : nextCustomCourseId(nowMs, existingIds);
  const course: CustomCourse = {
    id: id,
    mode: draft.mode,
    name: trimText(draft.name),
    teacher: trimText(draft.teacher),
    room: trimText(draft.room),
    startTime: minutesToTime(parseTimeToMinutes(draft.startTime)),
    endTime: minutesToTime(parseTimeToMinutes(draft.endTime)),
    semesterId: snapshot.id,
    semesterStartDate: snapshot.startDate
  };
  if (draft.mode === 'weekly') {
    course.dayOfWeek = draft.dayOfWeek;
    course.weekdays = [draft.dayOfWeek];
    course.startWeek = draft.startWeek;
    course.endWeek = draft.endWeek;
    course.weekPattern = draft.weekPattern;
    // weeks 仅供界面展示；TimetableCore 以 startWeek/endWeek/weekPattern 展开。
    course.weeks = expandWeeks(draft.startWeek, draft.endWeek, draft.weekPattern);
  } else {
    course.date = draft.date;
  }
  return { ok: true, course: course, errors: [] };
}

export function upsertCustomCourse(state: AppState, course: CustomCourse): AppState {
  const next = cloneState(state);
  const list: CustomCourse[] = [];
  let replaced = false;
  for (const item of next.customCourses) {
    if (item.id === course.id) {
      list.push(course);
      replaced = true;
    } else {
      list.push(item);
    }
  }
  if (!replaced) {
    list.push(course);
  }
  next.customCourses = list;
  return next;
}

export function deleteCustomCourse(state: AppState, id: string): AppState {
  const next = cloneState(state);
  next.customCourses = next.customCourses.filter((item) => item.id !== id);
  return next;
}

export function validateLocalMap(draft: LocalMapDraft): string[] {
  const errors: string[] = [];
  if (!isValidDateKey(draft.fromDate)) {
    errors.push('from-date-invalid');
  }
  if (!isValidDateKey(draft.date)) {
    errors.push('date-invalid');
  }
  if (errors.length === 0 && draft.fromDate === draft.date) {
    errors.push('same-date');
  }
  if (draft.mode !== 'append' && draft.mode !== 'replace') {
    errors.push('mode-invalid');
  }
  return errors;
}

/** 调休规则；产品口径 DECISIONS.md:14：本机手动调休一律按 replace 写入（TimetableCore 的 append 仅作通用引擎能力，本机不启用）。 */
export const LOCAL_REMAP_MODE = 'replace';
export function buildLocalMap(draft: LocalMapDraft, nowMs: number, existingIds: string[]): LocalMapResult {
  const errors = validateLocalMap(draft);
  if (errors.length > 0) {
    return { ok: false, rule: null, errors: errors };
  }
  let index = existingIds.length + 1;
  let id = 'local-map-' + String(nowMs) + '-' + String(index);
  while (existingIds.indexOf(id) >= 0) {
    index++;
    id = 'local-map-' + String(nowMs) + '-' + String(index);
  }
  return { ok: true, rule: { id: id, date: draft.date, fromDate: draft.fromDate, mode: LOCAL_REMAP_MODE }, errors: [] };
}

export function upsertLocalMap(state: AppState, rule: LocalMapRule): AppState {
  const next = cloneState(state);
  const list: LocalMapRule[] = [];
  let replaced = false;
  for (const item of next.localMaps) {
    if (item.id === rule.id) {
      list.push(rule);
      replaced = true;
    } else {
      list.push(item);
    }
  }
  if (!replaced) {
    list.push(rule);
  }
  next.localMaps = list;
  return next;
}

export function deleteLocalMap(state: AppState, id: string): AppState {
  const next = cloneState(state);
  next.localMaps = next.localMaps.filter((item) => item.id !== id);
  return next;
}

function ensureHolidaySettings(state: AppState): HolidaySettings {
  if (state.holidaySettings !== null) {
    return state.holidaySettings;
  }
  return { winter: null, summer: null, days: [] };
}

export function addHolidayDay(state: AppState, day: HolidayDay): AppState {
  if (!isValidDateKey(day.date)) {
    return state;
  }
  const next = cloneState(state);
  const settings = ensureHolidaySettings(next);
  const days: HolidayDay[] = [];
  let replaced = false;
  for (const item of settings.days) {
    if (item.date === day.date) {
      days.push({ date: day.date, skipStudy: day.skipStudy === true });
      replaced = true;
    } else {
      days.push(item);
    }
  }
  if (!replaced) {
    days.push({ date: day.date, skipStudy: day.skipStudy === true });
  }
  next.holidaySettings = { winter: settings.winter, summer: settings.summer, days: days };
  return next;
}

export function removeHolidayDay(state: AppState, date: string): AppState {
  const next = cloneState(state);
  if (next.holidaySettings === null) {
    return next;
  }
  const settings = next.holidaySettings;
  next.holidaySettings = {
    winter: settings.winter,
    summer: settings.summer,
    days: settings.days.filter((item) => item.date !== date)
  };
  return next;
}

/** 是否显示晚自习；同时更新学期学习策略的 userEnabled。 */
export function setEveningStudy(state: AppState, enabled: boolean): AppState {
  const next = cloneState(state);
  const settings = next.courseSettings;
  next.courseSettings = { showEveningStudy: enabled, grade: settings.grade };
  if (next.snapshot !== null && next.snapshot.studyPolicy) {
    const policy = next.snapshot.studyPolicy;
    const studyPolicy: StudyPolicy = {
      enabled: policy.enabled,
      userEnabled: enabled,
      userDisabled: policy.userDisabled,
      profile: policy.profile,
      holidayDates: policy.holidayDates.slice(),
      verifiedYears: policy.verifiedYears.slice(),
      sourceLabel: policy.sourceLabel,
      startTime: policy.startTime,
      endTime: policy.endTime
    };
    const snapshot = next.snapshot;
    next.snapshot = {
      id: snapshot.id,
      name: snapshot.name,
      startDate: snapshot.startDate,
      weeks: snapshot.weeks,
      rules: snapshot.rules,
      source: snapshot.source,
      closedDates: snapshot.closedDates,
      remaps: snapshot.remaps,
      exceptions: snapshot.exceptions,
      studyPolicy: studyPolicy,
      unscheduled: snapshot.unscheduled,
      studentProfile: snapshot.studentProfile
    };
  }
  return next;
}

function isValidPatch(patch: CourseExceptionPatch): boolean {
  const start = patch.startTime === undefined ? 0 : parseTimeToMinutes(patch.startTime);
  const end = patch.endTime === undefined ? 0 : parseTimeToMinutes(patch.endTime);
  if (patch.startTime !== undefined && start < 0) {
    return false;
  }
  if (patch.endTime !== undefined && end < 0) {
    return false;
  }
  if (patch.startTime !== undefined && patch.endTime !== undefined && end <= start) {
    return false;
  }
  return true;
}

/** 单日修改：以当日一行课为基准生成 override；非法返回 null。 */
export function buildDayOverride(date: string, base: CourseRow, patch: CourseExceptionPatch, nowMs: number): DayOverride | null {
  if (!isValidDateKey(date) || !isValidPatch(patch)) {
    return null;
  }
  return {
    id: 'override-' + String(nowMs) + '-' + base.key,
    key: base.key,
    date: date,
    base: cloneRow(base),
    patch: patch,
    createdAt: new Date(nowMs).toISOString()
  };
}

export function upsertOverride(state: AppState, override: DayOverride): AppState {
  const next = cloneState(state);
  const list: DayOverride[] = [];
  let replaced = false;
  for (const item of next.overrides) {
    if (item.id === override.id) {
      list.push(override);
      replaced = true;
    } else {
      list.push(item);
    }
  }
  if (!replaced) {
    list.push(override);
  }
  next.overrides = list;
  return next;
}

export function deleteOverride(state: AppState, id: string): AppState {
  const next = cloneState(state);
  next.overrides = next.overrides.filter((item) => item.id !== id);
  return next;
}

/** 撤销栈：最多保留 limit 个历史状态。 */
export function createHistory(state: AppState): EditHistory {
  return { past: [], present: state, future: [] };
}

export function commitHistory(history: EditHistory, nextState: AppState, limit: number = MAX_HISTORY): EditHistory {
  const past = history.past.concat([history.present]);
  const start = past.length > limit ? past.length - limit : 0;
  return { past: past.slice(start), present: nextState, future: [] };
}

export function undoHistory(history: EditHistory, limit: number = MAX_HISTORY): EditHistory {
  if (history.past.length === 0) {
    return history;
  }
  const index = history.past.length - 1;
  const previous = history.past[index];
  const past = history.past.slice(0, index);
  const future = [history.present].concat(history.future).slice(0, limit);
  return { past: past, present: previous, future: future };
}

export function redoHistory(history: EditHistory, limit: number = MAX_HISTORY): EditHistory {
  if (history.future.length === 0) {
    return history;
  }
  const nextState = history.future[0];
  const future = history.future.slice(1);
  const past = history.past.concat([history.present]);
  const start = past.length > limit ? past.length - limit : 0;
  return { past: past.slice(start), present: nextState, future: future };
}

export function canUndo(history: EditHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: EditHistory): boolean {
  return history.future.length > 0;
}

/** 合并真实变更：新记录在前、按 id 去重、上限 200 条。 */
export function mergeChangeRecords(existing: ChangeRecord[], fresh: ChangeRecord[], limit: number = MAX_CHANGE_RECORDS): ChangeRecord[] {
  const result: ChangeRecord[] = [];
  const seen: string[] = [];
  for (const record of fresh) {
    if (seen.indexOf(record.id) >= 0) {
      continue;
    }
    seen.push(record.id);
    result.push(record);
  }
  for (const record of existing) {
    if (seen.indexOf(record.id) >= 0) {
      continue;
    }
    seen.push(record.id);
    result.push(record);
  }
  return result.slice(0, limit);
}

export function applyChangeRecords(state: AppState, fresh: ChangeRecord[], limit: number = MAX_CHANGE_RECORDS): AppState {
  const next = cloneState(state);
  next.changeRecords = mergeChangeRecords(next.changeRecords, fresh, limit);
  return next;
}

export function countUnread(records: ChangeRecord[]): number {
  let count = 0;
  for (const record of records) {
    if (record.read !== true) {
      count++;
    }
  }
  return count;
}

export function markRecordRead(state: AppState, id: string): AppState {
  const next = cloneState(state);
  const list: ChangeRecord[] = [];
  for (const record of next.changeRecords) {
    if (record.id === id) {
      list.push(cloneRecord(record, true));
    } else {
      list.push(record);
    }
  }
  next.changeRecords = list;
  return next;
}

export function markAllChangeRecordsRead(state: AppState): AppState {
  const next = cloneState(state);
  const list: ChangeRecord[] = [];
  for (const record of next.changeRecords) {
    list.push(cloneRecord(record, true));
  }
  next.changeRecords = list;
  return next;
}

function recordMinutes(dateKey: string, time: string): number {
  const day = dayNumber(dateKey);
  const minutes = parseTimeToMinutes(time);
  if (day < 0 || minutes < 0) {
    return -1;
  }
  return day * MINUTES_PER_DAY + minutes;
}

function rowMinutes(row: CourseRow): number {
  return recordMinutes(row.date, row.startTime);
}

function rowEndMinutes(row: CourseRow): number {
  return recordMinutes(row.date, row.endTime);
}

function recordStartMinutes(record: LeaveRecord): number {
  return recordMinutes(record.startDate, record.startTime);
}

function recordEndMinutes(record: LeaveRecord): number {
  return recordMinutes(record.endDate, record.endTime);
}

function isActiveRow(row: CourseRow): boolean {
  return !row.cancelled && !row.vacant;
}

/** 今日概览：节数 / 下一节 / 假条统计。rows 应为当日 resolveDay+markLeave 结果。 */
export function buildTodayOverview(rows: CourseRow[], leaveRecords: LeaveRecord[], nowMinutes: number): TodayOverview {
  let lessonCount = 0;
  let leaveCount = 0;
  let pendingLeaveCount = 0;
  let next: CourseRow | null = null;
  let nextStart = -1;
  for (const row of rows) {
    if (!isActiveRow(row)) {
      continue;
    }
    lessonCount++;
    if (row.leave === true) {
      leaveCount++;
    }
    if (row.pendingLeave === true) {
      pendingLeaveCount++;
    }
    const start = parseTimeToMinutes(row.startTime);
    if (start >= 0 && start >= nowMinutes && (next === null || start < nextStart)) {
      next = row;
      nextStart = start;
    }
  }
  return {
    lessonCount: lessonCount,
    nextStartTime: next === null ? '' : next.startTime,
    nextEndTime: next === null ? '' : next.endTime,
    nextName: next === null ? '' : next.name,
    nextRoom: next === null ? '' : next.room,
    leaveCount: leaveCount,
    pendingLeaveCount: pendingLeaveCount,
    hasLeave: leaveCount > 0 || pendingLeaveCount > 0
  };
}

/** 每行的假条标注：approved 优先于 pending。 */
export function annotateLeaveRows(rows: CourseRow[], leaveRecords: LeaveRecord[]): LeaveAnnotation[] {
  const result: LeaveAnnotation[] = [];
  for (const row of rows) {
    const start = rowMinutes(row);
    const end = rowEndMinutes(row);
    let status: 'approved' | 'pending' | 'none' = 'none';
    const ids: string[] = [];
    if (start >= 0 && end >= 0) {
      for (const record of leaveRecords) {
        if (record.type !== 'leave' && record.type !== 'renew') {
          continue;
        }
        if (record.status !== 'approved' && record.status !== 'pending') {
          continue;
        }
        const recordStart = recordStartMinutes(record);
        const recordEnd = recordEndMinutes(record);
        if (recordStart < 0 || recordEnd < 0 || recordStart >= recordEnd) {
          continue;
        }
        if (start < recordEnd && recordStart < end) {
          ids.push(record.id);
          if (record.status === 'approved') {
            status = 'approved';
          } else if (status === 'none') {
            status = 'pending';
          }
        }
      }
    }
    result.push({ key: row.key, status: status, recordIds: ids });
  }
  return result;
}

/** 与某一行课程时间重叠的假条明细。 */
export function leaveRecordsForRow(row: CourseRow, leaveRecords: LeaveRecord[]): LeaveRecord[] {
  const start = rowMinutes(row);
  const end = rowEndMinutes(row);
  const result: LeaveRecord[] = [];
  if (start < 0 || end < 0) {
    return result;
  }
  for (const record of leaveRecords) {
    if (record.type !== 'leave' && record.type !== 'renew') {
      continue;
    }
    if (record.status !== 'approved' && record.status !== 'pending') {
      continue;
    }
    const recordStart = recordStartMinutes(record);
    const recordEnd = recordEndMinutes(record);
    if (recordStart < 0 || recordEnd < 0 || recordStart >= recordEnd) {
      continue;
    }
    if (start < recordEnd && recordStart < end) {
      result.push(record);
    }
  }
  return result;
}

function cloneRow(row: CourseRow): CourseRow {
  const next: CourseRow = {
    key: row.key,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    periods: row.periods.slice(),
    name: row.name,
    teacher: row.teacher,
    room: row.room,
    cancelled: row.cancelled,
    vacant: row.vacant,
    localActivity: row.localActivity,
    customCourse: row.customCourse,
    remapId: row.remapId,
    conflict: row.conflict,
    overlap: row.overlap,
    source: row.source,
    originDate: row.originDate,
    weekday: row.weekday,
    leave: row.leave,
    pendingLeave: row.pendingLeave,
    sourceLabel: row.sourceLabel,
    customCourseId: row.customCourseId,
    vacancyReason: row.vacancyReason,
    movedTo: row.movedTo
  };
  if (row.ruleId !== undefined) {
    next.ruleId = row.ruleId;
  }
  return next;
}

function cloneRecord(record: ChangeRecord, read: boolean): ChangeRecord {
  return {
    id: record.id,
    key: record.key,
    kind: record.kind,
    stableKey: record.stableKey,
    date: record.date,
    title: record.title,
    detail: record.detail,
    before: record.before,
    after: record.after,
    fields: record.fields.slice(),
    type: record.type,
    source: record.source,
    read: read,
    notifiedAt: record.notifiedAt,
    detectedAt: record.detectedAt,
    at: record.at
  };
}

function cloneState(state: AppState): AppState {
  const settings = state.settingsExpanded;
  const options = state.calendarOptions;
  const reminders = state.classReminders;
  const courseSettings = state.courseSettings;
  const next: AppState = {
    version: state.version,
    snapshot: state.snapshot,
    events: (state.events || []).slice(),
    changeRecords: (state.changeRecords || []).slice(),
    overrides: (state.overrides || []).slice(),
    localMaps: (state.localMaps || []).slice(),
    holidaySettings: state.holidaySettings,
    courseSettings: { showEveningStudy: courseSettings.showEveningStudy, grade: courseSettings.grade },
    customCourses: (state.customCourses || []).slice(),
    theme: state.theme,
    showDayOverview: state.showDayOverview,
    settingsExpanded: {
      auto: settings.auto,
      display: settings.display,
      leave: settings.leave,
      course: settings.course,
      data: settings.data,
      about: settings.about
    },
    calendarOptions: { school: options.school, custom: options.custom, study: options.study },
    notificationEnabled: state.notificationEnabled,
    classReminders: { enabled: reminders.enabled, leadMinutes: reminders.leadMinutes },
    autoCheckEnabled: state.autoCheckEnabled,
    lastSuccess: state.lastSuccess,
    lastAttempt: state.lastAttempt,
    error: state.error
  };
  if (state.leaveStatus !== undefined) {
    next.leaveStatus = state.leaveStatus;
  }
  if (state.demoMode !== undefined) {
    next.demoMode = state.demoMode;
  }
  if (state._revision !== undefined) {
    next._revision = state._revision;
  }
  return next;
}
