// 职责：schema v1 状态读写编排（沙箱文件 + Preferences 小字段），对应规格 §4.2。
// 依赖方向：data -> core type-only 契约；不 import Kit/pages/platform。
// 阶段：P1 数据层；完整 state 经 StateFileStore 原子写，revision 只走 Preferences。
// 待确认：文件 fsync/rename/bak 由 platform/StateFileGateway 实现，Node 测试用 MemoryStateFileStore。

import type {
  AppState,
  CalendarOptions,
  ChangeEvent,
  ChangeRecord,
  ClassReminderSettings,
  CourseSettings,
  CustomCourse,
  DayOverride,
  HolidaySettings,
  LocalMapRule,
  SemesterSnapshot,
  SettingsExpanded
} from '../core/types/AppState';
import type { LeaveRecord, LeaveStatusCache } from '../core/types/Leave';
import type { PreferencesStore } from '../core/types/PreferencesStore';
import type { StateFileStore } from '../core/store/StateFileStore';

const ENVELOPE_VERSION = 1;
const STATE_VERSION = 3;
const STATE_CORRUPT = 'STATE_CORRUPT';
const STATE_MIGRATION_FAILED = 'STATE_MIGRATION_FAILED';
const STATE_REVISION_CONFLICT = 'STATE_REVISION_CONFLICT';
const STATE_WRITE_FAILED = 'STATE_WRITE_FAILED';

export interface StatePayload {
  version: number;
  state: AppState;
}

export interface StateRepository {
  load(): Promise<AppState>;
  save(state: AppState, expectedRevision: number): Promise<number>;
  saveRestored(state: AppState): Promise<number>;
  reset(): Promise<void>;
}

export interface StoredState {
  state: AppState;
  revision: number;
}

interface RawStateShape {
  version?: number;
  snapshot?: SemesterSnapshot | null;
  events?: object[];
  changeRecords?: object[];
  overrides?: object[];
  localMaps?: object[];
  holidaySettings?: object | null;
  courseSettings?: object;
  customCourses?: object[];
  theme?: string;
  showDayOverview?: boolean;
  settingsExpanded?: object;
  leaveStatus?: object;
  demoMode?: boolean;
  calendarOptions?: object;
  notificationEnabled?: boolean;
  classReminders?: object;
  autoCheckEnabled?: boolean;
  lastSuccess?: number;
  lastAttempt?: number;
  error?: string | null;
}

interface StoredEnvelope {
  version?: number;
  state?: RawStateShape;
}

/** 迁移期的宽松原始形状：ArkTS 无 any/unknown，用可选字段接口 + as 断言承载旧数据。 */
interface RawSettingsExpanded {
  auto?: boolean;
  display?: boolean;
  leave?: boolean;
  course?: boolean;
  data?: boolean;
  about?: boolean;
}

interface RawLeaveRecord {
  id?: string;
  status?: string;
  demo?: boolean;
  endDate?: string;
  endTime?: string;
  semesterId?: string;
}

interface RawLeaveCache {
  schemaVersion?: number;
  semesterId?: string;
  provider?: string;
  fetchedAt?: string | null;
  records?: object[];
}

function revisionKeyOf(semesterId: string): string {
  return `jiangshui.state.revision.${semesterId || 'default'}`;
}

function parseRevision(raw: string | null): number {
  if (raw === null) {
    return 0;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function createEmptyState(): AppState {
  return {
    version: ENVELOPE_VERSION,
    snapshot: null,
    events: [],
    changeRecords: [],
    overrides: [],
    localMaps: [],
    holidaySettings: null,
    courseSettings: { showEveningStudy: false, grade: '' },
    customCourses: [],
    theme: 'system',
    showDayOverview: false,
    settingsExpanded: { auto: true, display: false, leave: false, course: false, data: false, about: false },
    calendarOptions: { school: true, custom: true, study: true },
    notificationEnabled: false,
    classReminders: { enabled: true, leadMinutes: 30 },
    autoCheckEnabled: true,
    lastSuccess: 0,
    lastAttempt: 0,
    error: null,
    _revision: 0
  };
}

function validateDate(value: string): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}

function validateSnapshotShape(snapshot: SemesterSnapshot): void {
  if (snapshot === null || snapshot === undefined) {
    throw new Error(STATE_MIGRATION_FAILED);
  }
  if (!validateDate(snapshot.startDate)) {
    throw new Error(STATE_MIGRATION_FAILED);
  }
  if (!Number.isInteger(snapshot.weeks) || snapshot.weeks < 1 || snapshot.weeks > 60) {
    throw new Error(STATE_MIGRATION_FAILED);
  }
  if (!(snapshot.rules instanceof Array)) {
    throw new Error(STATE_MIGRATION_FAILED);
  }
  for (const rule of snapshot.rules) {
    if (typeof rule.id !== 'string' || rule.id === '' || typeof rule.name !== 'string' ||
      !(rule.weeks instanceof Array) || !(rule.periods instanceof Array)) {
      throw new Error(STATE_MIGRATION_FAILED);
    }
  }
}

function normalizeSettingsExpandedInRepo(raw: object | undefined | null): SettingsExpanded {
  const out: SettingsExpanded = { auto: true, display: false, leave: false, course: false, data: false, about: false };
  if (raw === undefined || raw === null || typeof raw !== 'object') { return out; }
  const r = raw as RawSettingsExpanded;
  out.auto = typeof r.auto === 'boolean' ? r.auto : true;
  out.display = typeof r.display === 'boolean' ? r.display : false;
  out.leave = typeof r.leave === 'boolean' ? r.leave : false;
  out.course = typeof r.course === 'boolean' ? r.course : false;
  out.data = typeof r.data === 'boolean' ? r.data : false;
  out.about = typeof r.about === 'boolean' ? r.about : false;
  return out;
}
function normalizeLeaveProvider(value: string | undefined): 'school' | 'sample' | 'local' | null {
  if (value === 'school' || value === 'sample' || value === 'local') { return value; }
  return null;
}
function normalizeLeaveCacheInRepo(raw: object | undefined | null, activeSemesterId: string = ''): LeaveStatusCache {
  const empty: LeaveStatusCache = { schemaVersion: 1, semesterId: '', provider: null, fetchedAt: null, records: [] };
  if (raw === undefined || raw === null) { return empty; }
  if (raw instanceof Array) {
    const list: object[] = raw as object[];
    const arr: LeaveRecord[] = [];
    for (const item of list) {
      const r = item as RawLeaveRecord;
      if (r === null || r === undefined || r.demo === true) { continue; }
      const st = String(r.status ?? '');
      if (st !== 'approved' && st !== 'pending' && st !== 'rejected') { continue; }
      const d = String(r.endDate ?? '') + 'T' + String(r.endTime ?? '') + ':00+08:00';
      if (!Number.isFinite(Date.parse(d))) { continue; }
      if (activeSemesterId.length > 0 && String(r.semesterId ?? '') !== activeSemesterId) { continue; }
      arr.push(item as LeaveRecord);
    }
    const migrated: LeaveStatusCache = { schemaVersion: 1, semesterId: activeSemesterId, provider: 'local', fetchedAt: null, records: arr.slice(0, 200) };
    return migrated;
  }
  const source = raw as RawLeaveCache;
  if (!(source.records instanceof Array)) { return empty; }
  const rs: LeaveRecord[] = [];
  const items: object[] = source.records as object[];
  for (const item of items) {
    const r = item as RawLeaveRecord;
    if (r.demo === true) { continue; }
    const date = String(r.endDate ?? '') + 'T' + String(r.endTime ?? '') + ':00+08:00';
    if (!Number.isFinite(Date.parse(date))) { continue; }
    rs.push(item as LeaveRecord);
  }
  empty.records = rs.slice(0, 200);
  empty.fetchedAt = typeof source.fetchedAt === 'string' ? source.fetchedAt : null;
  empty.semesterId = typeof source.semesterId === 'string' ? source.semesterId : '';
  empty.provider = normalizeLeaveProvider(source.provider);
  return empty;
}
function normalizeLocalMapModesInRepo(raw: object[]): LocalMapRule[] {
  // 产品口径 DECISIONS.md:14：本机手动调休一律替换；旧版保存的 append 记录读出后按 replace 呈现。
  // 只归一 mode，保留其余字段；幂等：replace 再读仍为 replace。
  const list: LocalMapRule[] = [];
  for (const item of raw) {
    if (item === null || item === undefined) {
      continue;
    }
    const rule = item as LocalMapRule;
    rule.mode = 'replace';
    list.push(rule);
  }
  return list;
}
function normalizeStateObject(raw: object): AppState {
  const base = createEmptyState();
  const typed = raw as RawStateShape;
  if (typed.snapshot !== undefined && typed.snapshot !== null) {
    validateSnapshotShape(typed.snapshot);
    base.snapshot = typed.snapshot;
  }
  base.events = typed.events instanceof Array ? typed.events as ChangeEvent[] : [];
  base.changeRecords = typed.changeRecords instanceof Array ? typed.changeRecords as ChangeRecord[] : [];
  base.overrides = typed.overrides instanceof Array ? typed.overrides as DayOverride[] : [];
  base.localMaps = typed.localMaps instanceof Array ? normalizeLocalMapModesInRepo(typed.localMaps as object[]) : [];
  if (typed.holidaySettings !== undefined && typed.holidaySettings !== null) {
    base.holidaySettings = typed.holidaySettings as HolidaySettings;
  }
  if (typed.courseSettings !== undefined && typed.courseSettings !== null) {
    base.courseSettings = typed.courseSettings as CourseSettings;
  }
  base.customCourses = typed.customCourses instanceof Array ? typed.customCourses as CustomCourse[] : [];
  const theme = typed.theme;
  if (theme === 'system' || theme === 'blue' || theme === 'black' || theme === 'white' || theme === 'purple') {
    base.theme = theme;
  }
  base.showDayOverview = typed.showDayOverview === true;
  base.demoMode = typed.demoMode === true;
  const activeSemesterId: string = typed.snapshot !== undefined && typed.snapshot !== null ? typed.snapshot.id : '';
  base.leaveStatus = normalizeLeaveCacheInRepo(typed.leaveStatus, activeSemesterId);
  if (typed.settingsExpanded !== undefined && typed.settingsExpanded !== null) {
    base.settingsExpanded = normalizeSettingsExpandedInRepo(typed.settingsExpanded);
  }
  if (typed.calendarOptions !== undefined && typed.calendarOptions !== null) {
    base.calendarOptions = typed.calendarOptions as CalendarOptions;
  }
  base.notificationEnabled = typed.notificationEnabled === true;
  if (typed.classReminders !== undefined && typed.classReminders !== null) {
    base.classReminders = typed.classReminders as ClassReminderSettings;
  }
  base.autoCheckEnabled = typed.autoCheckEnabled !== false;
  base.lastSuccess = typeof typed.lastSuccess === 'number' ? typed.lastSuccess : 0;
  base.lastAttempt = typeof typed.lastAttempt === 'number' ? typed.lastAttempt : 0;
  base.error = typeof typed.error === 'string' ? typed.error : null;
  base.version = STATE_VERSION;
  return base;
}

export function migrate(raw: string): AppState {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return createEmptyState();
  }
  let parsed: object;
  try {
    parsed = JSON.parse(raw) as object;
  } catch (error) {
    throw new Error(STATE_CORRUPT);
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(STATE_CORRUPT);
  }
  const wrapper = parsed as StoredEnvelope;
  if (wrapper.state !== undefined && wrapper.state !== null) {
    if (typeof wrapper.version === 'number' && wrapper.version > ENVELOPE_VERSION) {
      throw new Error(STATE_MIGRATION_FAILED);
    }
    return normalizeStateObject(wrapper.state as object);
  }
  try {
    return normalizeStateObject(parsed);
  } catch (error) {
    throw new Error(STATE_MIGRATION_FAILED);
  }
}

async function preserveCorrupt(files: StateFileStore): Promise<void> {
  try {
    await files.preserveCorrupt();
  } catch (error) {
    // 保留坏文件副本是诊断增强；失败不改变降级结果。
  }
}

function legacyStateKeyOf(semesterId: string): string {
  return `jiangshui.state.${semesterId || 'default'}`;
}

function isFileStore(value: StateFileStore | AppState | string | null | undefined): boolean {
  if (value === null || value === undefined || typeof value === 'string') {
    return false;
  }
  const candidate = value as StateFileStore;
  return typeof candidate.read === 'function' && typeof candidate.writeAtomic === 'function';
}

async function loadLegacy(repo: PreferencesStore, semesterId: string): Promise<AppState> {
  const revision = parseRevision(await repo.get(revisionKeyOf(semesterId)));
  const payload = await repo.get(legacyStateKeyOf(semesterId));
  if (payload === null) {
    const empty = createEmptyState();
    empty._revision = revision;
    return empty;
  }
  try {
    const state = migrate(payload);
    state._revision = revision;
    return state;
  } catch (error) {
    const empty = createEmptyState();
    empty._revision = revision;
    const message = error instanceof Error ? error.message : STATE_CORRUPT;
    empty.error = message.indexOf(STATE_MIGRATION_FAILED) >= 0 ? STATE_MIGRATION_FAILED : STATE_CORRUPT;
    return empty;
  }
}

async function saveLegacy(repo: PreferencesStore, state: AppState, semesterId: string, expectedRevision: number): Promise<number> {
  const stateKey = legacyStateKeyOf(semesterId);
  const oldPayload = await repo.get(stateKey);
  const nextRevision = expectedRevision + 1;
  const oldRevision = state._revision;
  try {
    await repo.set(stateKey, JSON.stringify({ version: ENVELOPE_VERSION, state: state } as StatePayload));
    await repo.set(revisionKeyOf(semesterId), String(nextRevision));
    state._revision = nextRevision;
    return nextRevision;
  } catch (error) {
    try {
      if (oldPayload === null) {
        await repo.delete(stateKey);
      } else {
        await repo.set(stateKey, oldPayload);
      }
      await repo.set(revisionKeyOf(semesterId), String(expectedRevision));
    } catch (restoreError) {
      // 回滚尽力而为；仍返回稳定错误码。
    }
    state._revision = oldRevision;
    throw new Error(STATE_WRITE_FAILED);
  }
}

export async function load(
  repo: PreferencesStore,
  filesOrSemesterId: StateFileStore | string,
  semesterId?: string
): Promise<AppState> {
  if (typeof filesOrSemesterId === 'string') {
    return loadLegacy(repo, filesOrSemesterId);
  }
  const files = filesOrSemesterId;
  const targetSemesterId = semesterId === undefined ? 'default' : semesterId;
  const revision = parseRevision(await repo.get(revisionKeyOf(targetSemesterId)));
  const payload = await files.read();
  if (payload === null) {
    const empty = createEmptyState();
    empty._revision = revision;
    return empty;
  }
  try {
    const state = migrate(payload);
    state._revision = revision;
    return state;
  } catch (error) {
    await preserveCorrupt(files);
    const empty = createEmptyState();
    empty._revision = revision;
    const message = error instanceof Error ? error.message : STATE_CORRUPT;
    empty.error = message.indexOf(STATE_MIGRATION_FAILED) >= 0 ? STATE_MIGRATION_FAILED : STATE_CORRUPT;
    return empty;
  }
}

// 写盘入口的纵深校验。core/data 不允许运行时 import，校验逻辑在这里自包含；
// 与 core/export/Backup.checkStateShape、core/validate/SnapshotValidator 保持一致（有测试交叉锁定）。
// 只拦「结构非法/不可能值」，合法示例状态、正常导入、迁移都必须能保存。
export const STATE_INVALID = 'BACKUP_STATE_INVALID';
const MAX_RULES_FOR_SAVE = 1000;
const SAVE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const SAVE_RULE_SOURCES = ['school', 'custom', 'study', 'local'];
const SAVE_THEMES = ['system', 'blue', 'black', 'white', 'purple'];

function saveIsObject(value: Object | null | undefined): boolean {
  return value !== null && value !== undefined && typeof value === 'object';
}

function saveIsInteger(value: Object | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function saveDateKey(value: Object | null | undefined): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function saveWeekdayOf(dateKey: string): number {
  return new Date(dateKey + 'T00:00:00Z').getUTCDay() || 7;
}

function saveRuleOk(rule: Object, totalWeeks: number, ids: Set<string>): boolean {
  if (!saveIsObject(rule)) {
    return false;
  }
  const raw = rule as Record<string, Object>;
  if (typeof raw.id !== 'string' || (raw.id as string) === '' || ids.has(raw.id as string)) {
    return false;
  }
  if (typeof raw.name !== 'string' || (raw.name as string).trim() === '') {
    return false;
  }
  const hasDay = saveIsInteger(raw.dayOfWeek);
  const hasWeekday = saveIsInteger(raw.weekday);
  if (!hasDay && !hasWeekday) {
    return false;
  }
  if (hasDay && hasWeekday && (raw.dayOfWeek as number) !== (raw.weekday as number)) {
    return false;
  }
  const weekday = hasDay ? raw.dayOfWeek as number : raw.weekday as number;
  if (weekday < 1 || weekday > 7) {
    return false;
  }
  if (!saveIsInteger(raw.startPeriod) || (raw.startPeriod as number) < 1 || (raw.startPeriod as number) > 16) {
    return false;
  }
  if (!saveIsInteger(raw.endPeriod) || (raw.endPeriod as number) < 1 || (raw.endPeriod as number) > 16 ||
    (raw.endPeriod as number) < (raw.startPeriod as number)) {
    return false;
  }
  if (raw.periods !== null && raw.periods !== undefined) {
    if (!(raw.periods instanceof Array) || (raw.periods as Object[]).length === 0) {
      return false;
    }
    for (const period of raw.periods as Object[]) {
      if (!saveIsInteger(period) || (period as number) < 1 || (period as number) > 16) {
        return false;
      }
    }
  }
  if (!(raw.weeks instanceof Array) || (raw.weeks as Object[]).length === 0) {
    return false;
  }
  for (const week of raw.weeks as Object[]) {
    if (!saveIsInteger(week) || (week as number) < 1 || (week as number) > totalWeeks) {
      return false;
    }
  }
  if (typeof raw.startTime !== 'string' || !SAVE_TIME_PATTERN.test(raw.startTime as string) ||
    typeof raw.endTime !== 'string' || !SAVE_TIME_PATTERN.test(raw.endTime as string) ||
    (raw.endTime as string) <= (raw.startTime as string)) {
    return false;
  }
  if (raw.cancelled !== true && raw.cancelled !== false) {
    return false;
  }
  if (typeof raw.source !== 'string' || SAVE_RULE_SOURCES.indexOf(raw.source as string) < 0) {
    return false;
  }
  ids.add(raw.id as string);
  return true;
}

function saveSnapshotOk(snapshot: Object): boolean {
  const raw = snapshot as Record<string, Object>;
  if (typeof raw.id !== 'string' || (raw.id as string) === '' ||
    typeof raw.name !== 'string' || (raw.name as string).trim() === '' ||
    typeof raw.startDate !== 'string' || !saveDateKey(raw.startDate) || saveWeekdayOf(raw.startDate as string) !== 1) {
    return false;
  }
  if (!saveIsInteger(raw.weeks) || (raw.weeks as number) < 1 || (raw.weeks as number) > 60) {
    return false;
  }
  const totalWeeks: number = raw.weeks as number;
  if (!(raw.rules instanceof Array) || (raw.rules as Object[]).length > MAX_RULES_FOR_SAVE) {
    return false;
  }
  const ids = new Set<string>();
  for (const rule of raw.rules as Object[]) {
    if (!saveRuleOk(rule, totalWeeks, ids)) {
      return false;
    }
  }
  if (!saveIsObject(raw.source)) {
    return false;
  }
  const source = raw.source as Record<string, Object>;
  if ((source.kind !== 'school' && source.kind !== 'sample') || typeof source.label !== 'string') {
    return false;
  }
  if (raw.closedDates !== null && raw.closedDates !== undefined) {
    if (!(raw.closedDates instanceof Array)) {
      return false;
    }
    for (const date of raw.closedDates as Object[]) {
      if (!saveDateKey(date)) {
        return false;
      }
    }
  }
  if (raw.remaps !== null && raw.remaps !== undefined) {
    if (!(raw.remaps instanceof Array)) {
      return false;
    }
    const remapIds = new Set<string>();
    for (const remap of raw.remaps as Object[]) {
      if (!saveIsObject(remap)) {
        return false;
      }
      const item = remap as Record<string, Object>;
      if (typeof item.id !== 'string' || (item.id as string) === '' || remapIds.has(item.id as string) ||
        !saveDateKey(item.date) || !saveDateKey(item.fromDate) ||
        (item.mode !== 'append' && item.mode !== 'replace')) {
        return false;
      }
      remapIds.add(item.id as string);
    }
  }
  if (raw.exceptions !== null && raw.exceptions !== undefined) {
    if (!(raw.exceptions instanceof Array)) {
      return false;
    }
    for (const exception of raw.exceptions as Object[]) {
      if (!saveIsObject(exception)) {
        return false;
      }
      const item = exception as Record<string, Object>;
      if (!saveDateKey(item.date) || typeof item.ruleId !== 'string' || !ids.has(item.ruleId as string) ||
        (item.cancel !== true && item.cancel !== false)) {
        return false;
      }
    }
  }
  if (raw.unscheduled !== null && raw.unscheduled !== undefined) {
    if (!(raw.unscheduled instanceof Array)) {
      return false;
    }
    for (const item of raw.unscheduled as Object[]) {
      if (!saveIsObject(item)) {
        return false;
      }
      const course = item as Record<string, Object>;
      if (typeof course.id !== 'string' || (course.id as string) === '' ||
        typeof course.name !== 'string' || (course.name as string).trim() === '' ||
        !(course.weeks instanceof Array)) {
        return false;
      }
      for (const week of course.weeks as Object[]) {
        if (!saveIsInteger(week) || (week as number) < 1 || (week as number) > totalWeeks) {
          return false;
        }
      }
    }
  }
  return true;
}

function saveRecordListOk(list: Object, requireDate: boolean): boolean {
  if (!(list instanceof Array)) {
    return false;
  }
  for (const item of list as Object[]) {
    if (!saveIsObject(item)) {
      return false;
    }
    const raw = item as Record<string, Object>;
    if (typeof raw.id !== 'string' || (raw.id as string) === '') {
      return false;
    }
    if (requireDate && !saveDateKey(raw.date)) {
      return false;
    }
  }
  return true;
}

function saveCustomCoursesOk(list: Object): boolean {
  if (!(list instanceof Array)) {
    return false;
  }
  for (const item of list as Object[]) {
    if (!saveIsObject(item)) {
      return false;
    }
    const raw = item as Record<string, Object>;
    if (typeof raw.id !== 'string' || (raw.id as string) === '' ||
      typeof raw.name !== 'string' || (raw.name as string).trim() === '' ||
      (raw.mode !== 'weekly' && raw.mode !== 'once') ||
      typeof raw.startTime !== 'string' || !SAVE_TIME_PATTERN.test(raw.startTime as string) ||
      typeof raw.endTime !== 'string' || !SAVE_TIME_PATTERN.test(raw.endTime as string)) {
      return false;
    }
  }
  return true;
}

function saveHolidayOk(raw: Object | null | undefined): boolean {
  if (raw === null || raw === undefined) {
    return true;
  }
  if (!saveIsObject(raw)) {
    return false;
  }
  const record = raw as Record<string, Object>;
  if (!(record.days instanceof Array)) {
    return false;
  }
  for (const item of record.days as Object[]) {
    if (!saveIsObject(item)) {
      return false;
    }
    const day = item as Record<string, Object>;
    if (!saveDateKey(day.date) || (day.skipStudy !== true && day.skipStudy !== false)) {
      return false;
    }
  }
  return true;
}

export function validateStateForSave(state: AppState): string {
  if (!saveIsObject(state as Object)) {
    return STATE_INVALID;
  }
  const raw = state as Object as Record<string, Object>;
  if (!saveIsInteger(raw.version) || (raw.version as number) < 1 || (raw.version as number) > STATE_VERSION) {
    return STATE_INVALID;
  }
  if (raw.snapshot !== null && raw.snapshot !== undefined) {
    if (!saveIsObject(raw.snapshot) || !saveSnapshotOk(raw.snapshot as Object)) {
      return STATE_INVALID;
    }
  }
  if (!saveRecordListOk(raw.events, true) || !saveRecordListOk(raw.changeRecords, true) ||
    !saveRecordListOk(raw.overrides, true) || !saveRecordListOk(raw.localMaps, true) ||
    !saveCustomCoursesOk(raw.customCourses)) {
    return STATE_INVALID;
  }
  if (!saveHolidayOk(raw.holidaySettings)) {
    return STATE_INVALID;
  }
  if (!saveIsObject(raw.courseSettings) || !saveIsObject(raw.settingsExpanded) ||
    !saveIsObject(raw.calendarOptions) || !saveIsObject(raw.classReminders)) {
    return STATE_INVALID;
  }
  if (typeof raw.theme !== 'string' || SAVE_THEMES.indexOf(raw.theme as string) < 0) {
    return STATE_INVALID;
  }
  if (raw.showDayOverview !== true && raw.showDayOverview !== false) {
    return STATE_INVALID;
  }
  if (raw.notificationEnabled !== true && raw.notificationEnabled !== false) {
    return STATE_INVALID;
  }
  if (raw.autoCheckEnabled !== true && raw.autoCheckEnabled !== false) {
    return STATE_INVALID;
  }
  if (typeof raw.lastSuccess !== 'number' || !Number.isFinite(raw.lastSuccess as number) ||
    typeof raw.lastAttempt !== 'number' || !Number.isFinite(raw.lastAttempt as number)) {
    return STATE_INVALID;
  }
  if (raw.leaveStatus !== null && raw.leaveStatus !== undefined && !saveIsObject(raw.leaveStatus)) {
    return STATE_INVALID;
  }
  return '';
}

// 返回值：'' 表示已写盘；否则是稳定错误码（当前只有 BACKUP_STATE_INVALID），此时不写盘、不改内存态。
export async function save(
  repo: PreferencesStore,
  filesOrState: StateFileStore | AppState,
  state?: AppState
): Promise<string> {
  if (state === undefined) {
    const legacyState = filesOrState as AppState;
    const legacyCode = validateStateForSave(legacyState);
    if (legacyCode !== '') {
      return legacyCode;
    }
    const semesterId = legacyState.snapshot === null ? 'default' : legacyState.snapshot.id;
    const oldRevision = parseRevision(await repo.get(revisionKeyOf(semesterId)));
    await saveLegacy(repo, legacyState, semesterId, oldRevision);
    return '';
  }
  const files = filesOrState as StateFileStore;
  const code = validateStateForSave(state);
  if (code !== '') {
    return code;
  }
  const semesterId = state.snapshot === null ? 'default' : state.snapshot.id;
  const oldRevision = parseRevision(await repo.get(revisionKeyOf(semesterId)));
  await saveWithRevision(repo, files, state, semesterId, oldRevision);
  return '';
}

export async function saveWithRevision(
  repo: PreferencesStore,
  filesOrState: StateFileStore | AppState,
  stateOrSemesterId: AppState | string,
  semesterIdOrExpected: string | number,
  expectedOrFiles?: number | StateFileStore | null
): Promise<number> {
  let files: StateFileStore | null = null;
  let state: AppState;
  let semesterId: string;
  let expectedRevision: number;
  if (isFileStore(filesOrState)) {
    files = filesOrState as StateFileStore;
    state = stateOrSemesterId as AppState;
    semesterId = semesterIdOrExpected as string;
    expectedRevision = expectedOrFiles as number;
  } else {
    state = filesOrState as AppState;
    semesterId = stateOrSemesterId as string;
    expectedRevision = semesterIdOrExpected as number;
    files = isFileStore(expectedOrFiles as StateFileStore | AppState) ? expectedOrFiles as StateFileStore : null;
  }
  const invalidCode = validateStateForSave(state);
  if (invalidCode !== '') {
    throw new Error(invalidCode);
  }
  if (files === null) {
    return saveLegacy(repo, state, semesterId, expectedRevision);
  }
  const payload = JSON.stringify({ version: ENVELOPE_VERSION, state: state } as StatePayload);
  const oldPayload = await files.read();
  const nextRevision = expectedRevision + 1;
  const oldRevision = state._revision;
  try {
    await files.writeAtomic(payload);
    await repo.set(revisionKeyOf(semesterId), String(nextRevision));
    state._revision = nextRevision;
    return nextRevision;
  } catch (error) {
    try {
      if (oldPayload === null) {
        await files.remove();
      } else {
        await files.replaceWithBackup(oldPayload);
      }
    } catch (restoreError) {
      // 文件恢复失败时仍抛出写失败，交给上层提示；revision 必须回滚。
    }
    try {
      await repo.set(revisionKeyOf(semesterId), String(expectedRevision));
    } catch (revisionError) {
      // 保持原错误码；内存 revision 在下方恢复。
    }
    state._revision = oldRevision;
    throw new Error(STATE_WRITE_FAILED);
  }
}

export async function reset(
  repo: PreferencesStore,
  filesOrSemesterId: StateFileStore | string,
  semesterId?: string
): Promise<void> {
  if (typeof filesOrSemesterId === 'string') {
    await repo.delete(revisionKeyOf(filesOrSemesterId));
    await repo.delete(legacyStateKeyOf(filesOrSemesterId));
    return;
  }
  const targetSemesterId = semesterId === undefined ? 'default' : semesterId;
  await repo.delete(revisionKeyOf(targetSemesterId));
  await filesOrSemesterId.remove();
}

export class StateRepositoryImpl implements StateRepository {
  private repo: PreferencesStore;
  private files: StateFileStore | null;
  private semesterId: string;

  constructor(repo: PreferencesStore, filesOrSemesterId: StateFileStore | string, semesterId?: string) {
    this.repo = repo;
    if (typeof filesOrSemesterId === 'string') {
      this.files = null;
      this.semesterId = filesOrSemesterId;
    } else {
      this.files = filesOrSemesterId;
      this.semesterId = semesterId === undefined ? 'default' : semesterId;
    }
  }

  load(): Promise<AppState> {
    if (this.files === null) {
      return loadLegacy(this.repo, this.semesterId);
    }
    return load(this.repo, this.files, this.semesterId);
  }

  async save(state: AppState, expectedRevision: number): Promise<number> {
    const invalidCode = validateStateForSave(state);
    if (invalidCode !== '') {
      throw new Error(invalidCode);
    }
    const actualRevision = parseRevision(await this.repo.get(revisionKeyOf(this.semesterId)));
    if (expectedRevision !== actualRevision) {
      throw new Error(STATE_REVISION_CONFLICT);
    }
    if (this.files === null) {
      return saveLegacy(this.repo, state, this.semesterId, expectedRevision);
    }
    return saveWithRevision(this.repo, this.files, state, this.semesterId, expectedRevision);
  }

  // 备份恢复是整体替换，不适用乐观锁：先校验结构，再把目标 revision 抬到
  // max(当前 revision, 备份 revision)，写盘后 revision = 该值 + 1。
  async saveRestored(state: AppState): Promise<number> {
    const invalidCode = validateStateForSave(state);
    if (invalidCode !== '') {
      throw new Error(invalidCode);
    }
    const actualRevision = parseRevision(await this.repo.get(revisionKeyOf(this.semesterId)));
    const rawRevision = state._revision;
    const backupRevision = typeof rawRevision === 'number' && Number.isInteger(rawRevision) && rawRevision >= 0
      ? rawRevision : 0;
    const baseRevision = backupRevision > actualRevision ? backupRevision : actualRevision;
    state._revision = baseRevision;
    if (this.files === null) {
      return saveLegacy(this.repo, state, this.semesterId, baseRevision);
    }
    return saveWithRevision(this.repo, this.files, state, this.semesterId, baseRevision);
  }

  reset(): Promise<void> {
    if (this.files === null) {
      return reset(this.repo, this.semesterId);
    }
    return reset(this.repo, this.files, this.semesterId);
  }
}









