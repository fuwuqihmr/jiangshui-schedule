// 职责：schema v1 状态读写编排（沙箱文件 + Preferences 小字段），对应规格 §4.2。
// 依赖方向：data -> core type-only 契约；不 import Kit/pages/platform。
// 阶段：P1 数据层；完整 state 经 StateFileStore 原子写，revision 只走 Preferences。
// 待确认：文件 fsync/rename/bak 由 platform/StateFileGateway 实现，Node 测试用 MemoryStateFileStore。

import type {
  AppState,
  ChangeEvent,
  ChangeRecord,
  CustomCourse,
  DayOverride,
  LocalMapRule,
  SemesterSnapshot
} from '../core/types/AppState';
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

function normalizeSettingsExpandedInRepo(raw: object | undefined | null): AppState['settingsExpanded'] {
  const out = { auto: true, display: false, leave: false, course: false, data: false, about: false };
  if (raw === undefined || raw === null || typeof raw !== 'object') { return out; }
  const r = raw as Record<string, object>;
  out.auto = typeof r.auto === 'boolean' ? r.auto : true;
  out.display = typeof r.display === 'boolean' ? r.display : false;
  out.leave = typeof r.leave === 'boolean' ? r.leave : false;
  out.course = typeof r.course === 'boolean' ? r.course : false;
  out.data = typeof r.data === 'boolean' ? r.data : false;
  out.about = typeof r.about === 'boolean' ? r.about : false;
  return out;
}
function normalizeLeaveCacheInRepo(raw: object | undefined | null, activeSemesterId: string = ''): object {
  const empty = { schemaVersion: 1, semesterId: '', provider: null as string | null, fetchedAt: null as string | null, records: [] as object[] };
  if (raw === undefined || raw === null) { return empty; }
  if (raw instanceof Array) { const arr: object[] = []; for (const item of raw) { const r = item as Record<string, object>; if (r === null || r === undefined || r.demo === true) continue; const st = String(r.status ?? ''); if (['approved','pending','rejected'].indexOf(st) < 0) continue; const d = String(r.endDate ?? '') + 'T' + String(r.endTime ?? '') + ':00+08:00'; if (!Number.isFinite(Date.parse(d))) continue; if (activeSemesterId.length > 0 && String(r.semesterId ?? '') !== activeSemesterId) continue; arr.push(item); } return { schemaVersion: 1, semesterId: activeSemesterId, provider: 'local', fetchedAt: null, records: arr.slice(0, 200) }; }
  const source = raw as Record<string, object>;
  if (!(source.records instanceof Array)) { return empty; }
  const rs: object[] = [];
  for (const item of source.records) { const r = item as Record<string, object>; if (r.demo === true) continue; const date = String(r.endDate ?? '') + 'T' + String(r.endTime ?? '') + ':00+08:00'; if (!Number.isFinite(Date.parse(date))) continue; rs.push(item); }
  empty.records = rs.slice(0, 200);
  empty.fetchedAt = typeof source.fetchedAt === 'string' ? source.fetchedAt : null;
  empty.semesterId = typeof source.semesterId === 'string' ? source.semesterId : '';
  empty.provider = typeof source.provider === 'string' ? source.provider : null;
  return empty;
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
  base.localMaps = typed.localMaps instanceof Array ? typed.localMaps as LocalMapRule[] : [];
  if (typed.holidaySettings !== undefined && typed.holidaySettings !== null) {
    base.holidaySettings = typed.holidaySettings as AppState['holidaySettings'];
  }
  if (typed.courseSettings !== undefined && typed.courseSettings !== null) {
    base.courseSettings = typed.courseSettings as AppState['courseSettings'];
  }
  base.customCourses = typed.customCourses instanceof Array ? typed.customCourses as CustomCourse[] : [];
  const theme = typed.theme;
  if (theme === 'system' || theme === 'blue' || theme === 'black' || theme === 'white' || theme === 'purple') {
    base.theme = theme;
  }
  base.showDayOverview = typed.showDayOverview === true;
  base.demoMode = typed.demoMode === true;
  base.leaveStatus = normalizeLeaveCacheInRepo(typed.leaveStatus, typed.snapshot !== undefined && typed.snapshot !== null && typed.snapshot.semester !== undefined ? typed.snapshot.semester.id : '') as AppState['leaveStatus'];
  if (typed.settingsExpanded !== undefined && typed.settingsExpanded !== null) {
    base.settingsExpanded = normalizeSettingsExpandedInRepo(typed.settingsExpanded);
  }
  if (typed.calendarOptions !== undefined && typed.calendarOptions !== null) {
    base.calendarOptions = typed.calendarOptions as AppState['calendarOptions'];
  }
  base.notificationEnabled = typed.notificationEnabled === true;
  if (typed.classReminders !== undefined && typed.classReminders !== null) {
    base.classReminders = typed.classReminders as AppState['classReminders'];
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

export async function save(
  repo: PreferencesStore,
  filesOrState: StateFileStore | AppState,
  state?: AppState
): Promise<void> {
  if (state === undefined) {
    const legacyState = filesOrState as AppState;
    const semesterId = legacyState.snapshot === null ? 'default' : legacyState.snapshot.id;
    const oldRevision = parseRevision(await repo.get(revisionKeyOf(semesterId)));
    await saveLegacy(repo, legacyState, semesterId, oldRevision);
    return;
  }
  const files = filesOrState as StateFileStore;
  const semesterId = state.snapshot === null ? 'default' : state.snapshot.id;
  const oldRevision = parseRevision(await repo.get(revisionKeyOf(semesterId)));
  await saveWithRevision(repo, files, state, semesterId, oldRevision);
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
    const actualRevision = parseRevision(await this.repo.get(revisionKeyOf(this.semesterId)));
    if (expectedRevision !== actualRevision) {
      throw new Error(STATE_REVISION_CONFLICT);
    }
    if (this.files === null) {
      return saveLegacy(this.repo, state, this.semesterId, expectedRevision);
    }
    return saveWithRevision(this.repo, this.files, state, this.semesterId, expectedRevision);
  }

  reset(): Promise<void> {
    if (this.files === null) {
      return reset(this.repo, this.semesterId);
    }
    return reset(this.repo, this.files, this.semesterId);
  }
}









