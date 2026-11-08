import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');
const load = (rel) => import(pathToFileURL(path.join(tmp, rel)).href);

const Backup = await load('core/export/Backup.ts');
const Validator = await load('core/validate/SnapshotValidator.ts');
const Repo = await load('data/StateRepository.ts');
const MemPrefs = await load('data/MemoryPreferencesStore.ts');
const MemFiles = await load('data/MemoryStateFileStore.ts');

const clone = (value) => JSON.parse(JSON.stringify(value));
const CODE = Backup.CODE_BACKUP_STATE_INVALID;

function makeRule(overrides = {}) {
  return Object.assign({
    id: 'rule-1',
    name: '高等数学',
    teacher: '张老师',
    room: 'A101',
    dayOfWeek: 1,
    startPeriod: 1,
    endPeriod: 2,
    periods: [1, 2],
    weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    startTime: '08:30',
    endTime: '09:55',
    cancelled: false,
    source: 'school'
  }, overrides);
}

function makeState() {
  const state = Repo.createEmptyState();
  state.version = 3;
  state.snapshot = {
    id: 'semester-1',
    name: '测试学期',
    startDate: '2026-08-31',
    weeks: 10,
    rules: [makeRule()],
    source: { kind: 'school', label: '教务系统' },
    unscheduled: []
  };
  return state;
}

function envelopeOf(state, overrides = {}) {
  const envelope = JSON.parse(Backup.buildBackupJson(state, 1790000000000, '1.5.0'));
  Object.assign(envelope, overrides);
  return envelope;
}

function previewOf(state) {
  return Backup.parseBackupJson(JSON.stringify(envelopeOf(state)));
}

function badStates() {
  const list = [];
  const rulesNull = makeState();
  rulesNull.snapshot.rules = [null];
  list.push(['rules:[null]', rulesNull]);
  const badDate = makeState();
  badDate.snapshot.startDate = '2026-02-30';
  list.push(['impossible startDate', badDate]);
  const missingStart = makeState();
  delete missingStart.snapshot.startDate;
  list.push(['missing startDate', missingStart]);
  const weekOverflow = makeState();
  weekOverflow.snapshot.rules = [makeRule({ weeks: [1, 11] })];
  list.push(['week out of range', weekOverflow]);
  const zeroWeeks = makeState();
  zeroWeeks.snapshot.weeks = 0;
  list.push(['weeks 0', zeroWeeks]);
  const nonMonday = makeState();
  nonMonday.snapshot.startDate = '2026-09-01';
  list.push(['startDate not Monday', nonMonday]);
  const nullRule = makeState();
  nullRule.snapshot.rules = [null, makeRule()];
  list.push(['rules with null mixed', nullRule]);
  const overflowRule = makeState();
  overflowRule.snapshot.rules = [makeRule({ weeks: Array.from({ length: 11 }, (_, i) => i + 1) })];
  list.push(['rule weeks 11 entries', overflowRule]);
  return list;
}

test('backup-strict-1) 坏规则/坏日期预览被拒且返回 BACKUP_STATE_INVALID', () => {
  for (const [label, state] of badStates()) {
    const result = previewOf(state);
    assert.equal(result.ok, false, label + ' 应拒绝');
    assert.equal(result.code, CODE, label + ' 应返回稳定码');
    assert.equal(result.state, null, label + ' 不落地');
  }
});

test('backup-strict-2) 未来版本返回 BACKUP_STATE_FUTURE，旧版本仍接受', () => {
  const state = makeState();
  const futureState = makeState();
  futureState.version = 4;
  const future = Backup.parseBackupJson(JSON.stringify(envelopeOf(futureState)));
  assert.equal(future.ok, false);
  assert.equal(future.code, Backup.CODE_BACKUP_STATE_FUTURE);
  const v1 = envelopeOf(state, { version: 1 });
  assert.equal(Backup.parseBackupJson(JSON.stringify(v1)).ok, true);
});

test('backup-strict-3) 数组/设置/假期结构非法都拒绝', () => {
  const cases = [];
  const events = makeState();
  events.events = 'not-array';
  cases.push(['events not array', events]);
  const eventNull = makeState();
  eventNull.events = [null];
  cases.push(['events contains null', eventNull]);
  const custom = makeState();
  custom.customCourses = [{ id: 'c1', name: '社团', mode: 'daily', startTime: '18:00', endTime: '19:00' }];
  cases.push(['custom course bad mode', custom]);
  const holiday = makeState();
  holiday.holidaySettings = { days: [{ date: '2026-02-30', skipStudy: false }] };
  cases.push(['holiday impossible date', holiday]);
  const theme = makeState();
  theme.theme = 'neon';
  cases.push(['unknown theme', theme]);
  for (const [label, state] of cases) {
    const result = previewOf(state);
    assert.equal(result.ok, false, label + ' 应拒绝');
    assert.equal(result.code, CODE, label + ' 应返回 BACKUP_STATE_INVALID');
  }
});

test('backup-strict-4) 合法状态（空状态与正常学期）仍被接受', () => {
  const empty = Repo.createEmptyState();
  assert.equal(Backup.validateRestoreState(empty), '');
  const parsedEmpty = Backup.parseBackupJson(Backup.buildBackupJson(empty, Date.now(), '1.5.0'));
  assert.equal(parsedEmpty.ok, true);

  const state = makeState();
  assert.equal(Backup.validateRestoreState(state), '');
  const parsed = previewOf(state);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.snapshot.rules.length, 1);
  assert.equal(parsed.state.snapshot.rules[0].name, '高等数学');
});

test('backup-strict-5) validateRestoreState 明确区分合法/非法', () => {
  assert.equal(Backup.validateRestoreState(makeState()), '');
  assert.equal(Backup.validateRestoreState(null), CODE);
  const bad = makeState();
  bad.snapshot.rules = [null];
  assert.equal(Backup.validateRestoreState(bad), CODE);
});

test('backup-strict-6) 数据层模块级 save 对非法状态不写盘、不抛，返回稳定码', async () => {
  const prefs = new MemPrefs.MemoryPreferencesStore();
  const files = new MemFiles.MemoryStateFileStore();
  const good = makeState();
  assert.equal(await Repo.save(prefs, files, good), '');
  const written = await files.read();
  assert.ok(written && written.includes('semester-1'));

  let writes = 0;
  const originalWrite = files.writeAtomic.bind(files);
  files.writeAtomic = (payload) => {
    writes += 1;
    return originalWrite(payload);
  };
  const bad = makeState();
  bad.snapshot.rules = [null];
  const code = await Repo.save(prefs, files, bad);
  assert.equal(code, CODE);
  assert.equal(writes, 0, '非法状态不得调用 writeAtomic');
  const after = await Repo.load(prefs, files);
  assert.equal(after.snapshot.id, 'semester-1');
  assert.equal(after.snapshot.rules.length, 1);
  assert.equal(after.error, null);
  assert.equal(files.corruptCopyForTest(), null);
});

test('backup-strict-7) StateRepositoryImpl.save 对非法状态 reject 且不写盘', async () => {
  const prefs = new MemPrefs.MemoryPreferencesStore();
  const files = new MemFiles.MemoryStateFileStore();
  const repo = new Repo.StateRepositoryImpl(prefs, files, 'semester-1');
  await repo.save(makeState(), 0);
  const before = await files.read();
  const bad = makeState();
  bad.snapshot.rules = [null];
  await assert.rejects(() => repo.save(bad, 1), /BACKUP_STATE_INVALID/);
  assert.equal(await files.read(), before);
  const after = await Repo.load(prefs, files);
  assert.equal(after.snapshot.rules[0].name, '高等数学');
});

test('backup-strict-8) SnapshotValidator 兼容 dayOfWeek/weekday，拒绝结构坏值', () => {
  Validator.validateSnapshot(makeState().snapshot);
  const onlyDay = makeState();
  delete onlyDay.snapshot.rules[0].periods;
  Validator.validateSnapshot(onlyDay.snapshot);
  const onlyWeekday = makeState();
  const rule = onlyWeekday.snapshot.rules[0];
  rule.weekday = rule.dayOfWeek;
  delete rule.dayOfWeek;
  Validator.validateSnapshot(onlyWeekday.snapshot);

  const conflict = makeState();
  conflict.snapshot.rules[0].weekday = 3;
  assert.throws(() => Validator.validateSnapshot(conflict.snapshot), /STATE_MIGRATION_FAILED/);
  const overflow = makeState();
  overflow.snapshot.rules[0].weeks = [11];
  assert.throws(() => Validator.validateSnapshot(overflow.snapshot), /STATE_MIGRATION_FAILED/);
  const nullRule = makeState();
  nullRule.snapshot.rules = [null];
  assert.throws(() => Validator.validateSnapshot(nullRule.snapshot), /STATE_MIGRATION_FAILED/);
  const badStart = makeState();
  badStart.snapshot.startDate = '2026-02-30';
  assert.throws(() => Validator.validateSnapshot(badStart.snapshot), /STATE_MIGRATION_FAILED/);
});

test('backup-strict-9) 三处校验对同一组坏 fixture 结论一致', () => {
  for (const [label, state] of badStates()) {
    const preview = previewOf(state);
    assert.equal(preview.ok, false, label + ' Backup 应拒');
    assert.equal(Repo.validateStateForSave(state), CODE, label + ' 数据层应拒');
    assert.throws(() => Validator.validateSnapshot(state.snapshot), /STATE_MIGRATION_FAILED/, label + ' Validator 应拒');
  }
});

test('backup-strict-10) 现有 parseBackupJson 旧路径不被放宽：Web 快照仍判 legacy', () => {
  const webSnapshot = {
    schemaVersion: 1,
    name: '测试学期',
    startDate: '2026-08-31',
    weeks: 10,
    rules: [],
    customCourses: [{ id: 'c1', name: '社团' }]
  };
  const result = Backup.parseBackupJson(JSON.stringify(webSnapshot));
  assert.equal(result.ok, false);
  assert.equal(result.code, Backup.CODE_BACKUP_LEGACY);
});

test('backup-strict-11) 合法 revision 写入后 revision +1，坏写入不影响 revision', async () => {
  const prefs = new MemPrefs.MemoryPreferencesStore();
  const files = new MemFiles.MemoryStateFileStore();
  const state = makeState();
  assert.equal(await Repo.save(prefs, files, state), '');
  assert.equal(Number(await prefs.get('jiangshui.state.revision.semester-1')), 1);
  const bad = makeState();
  bad.snapshot.rules = [null];
  assert.equal(await Repo.save(prefs, files, bad), CODE);
  assert.equal(Number(await prefs.get('jiangshui.state.revision.semester-1')), 1);
});

test('backup-strict-12) 超限按 UTF-8 字节数判断（CJK 不再少算）', () => {
  const huge = '汉'.repeat(6 * 1000 * 1000);
  assert.ok(Buffer.byteLength(huge, 'utf8') > Backup.MAX_BACKUP_BYTES);
  const result = Backup.parseBackupJson(JSON.stringify({ format: Backup.BACKUP_FORMAT, version: 1, state: makeState(), padding: huge }));
  assert.equal(result.ok, false);
  assert.equal(result.code, Backup.CODE_BACKUP_TOO_LARGE);
});
