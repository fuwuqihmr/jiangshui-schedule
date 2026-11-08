import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
const fixtures = process.env.HARMONY_FIXTURES;
if (!tmp || !fixtures) throw new Error('HARMONY_CORE_TMP/HARMONY_FIXTURES 未设置，请用 run-core-tests.mjs 运行');

async function load(rel) {
  return import(pathToFileURL(path.join(tmp, rel)).href);
}
const core = await load('core/timetable/TimetableCore.ts');
const types = await load('core/types/AppState.ts');
const repoMod = await load('data/StateRepository.ts');
const memMod = await load('data/MemoryPreferencesStore.ts');
const fileMod = await load('data/MemoryStateFileStore.ts');

const normal = JSON.parse(fs.readFileSync(path.join(fixtures, 'normal-state.json'), 'utf8'));
const edge = JSON.parse(fs.readFileSync(path.join(fixtures, 'edge-state.json'), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const names = (rows) => rows.map((row) => row.name);

function day(state, date) {
  return core.resolveDay(state, date);
}

test('1) 单双周：第1周有单周课、第2周没有；全周课每周都有', () => {
  const odd = day(normal, '2026-09-03');
  const even = day(normal, '2026-09-10');
  assert.ok(names(odd).includes('单周实验'));
  assert.ok(!names(even).includes('单周实验'));
  assert.ok(names(day(normal, '2026-08-31')).includes('高等数学'));
  assert.ok(names(day(normal, '2026-09-07')).includes('高等数学'));
});

test('2) localMaps：目标日按原日上课，原日变 moved 占位', () => {
  const mapped = day(edge, '2026-10-09');
  const math = mapped.find((row) => row.name === '高等数学');
  assert.ok(math, '目标日应出现原日（2026-10-05）的高等数学');
  assert.equal(math.originDate, '2026-10-05');
  assert.ok(math.key.includes('map-local-map-1'));
  const original = day(edge, '2026-10-05').find((row) => row.name === '高等数学');
  assert.ok(original, '原日应保留 moved 占位（与 web 灰色记录一致）');
  assert.equal(original.vacant, true);
  assert.equal(original.cancelled, true);
  assert.equal(original.vacancyReason, 'moved');
  assert.equal(original.movedTo, '2026-10-09');
});

test('2b) snapshot.remaps：学期内调休目标日与原日停课', () => {
  const mapped = day(edge, '2026-10-08');
  const math = mapped.find((row) => row.name === '高等数学');
  assert.ok(math);
  assert.equal(math.originDate, '2026-09-28');
  assert.ok(!names(day(edge, '2026-09-28')).includes('高等数学'));
  assert.ok(names(day(edge, '2026-09-28')).includes('社团活动'));
});

test('3) 调休 replace：调休日原有课被替换', () => {
  const mapped = day(edge, '2026-10-08');
  assert.ok(names(mapped).includes('高等数学'));
  assert.ok(!names(mapped).includes('物理实验'));
});

test('3a) localMaps append：目标日保留原课并合并调课课程（条数=并集）', () => {
  const state = clone(edge);
  state.snapshot.remaps = [];
  state.localMaps = [{ id: 'm-append', date: '2026-10-08', fromDate: '2026-10-05', mode: 'append' }];
  const rows = day(state, '2026-10-08');
  const list = names(rows);
  assert.ok(list.includes('物理实验'), '目标日原有课必须保留');
  assert.ok(list.includes('高等数学'), '原日课程应合并进来');
  assert.ok(list.includes('社团活动'), '原日自定义课也应合并进来');
  assert.equal(rows.filter((row) => row.name !== 'study').length, 3, '并集=目标日 1 + 原日 2');
  assert.equal(rows.filter((row) => row.name === 'study').length, 1, '晚自习只按目标日算一次');
  const math = rows.find((row) => row.name === '高等数学');
  assert.equal(math.date, '2026-10-08');
  assert.equal(math.originDate, '2026-10-05');
  assert.equal(math.remapId, 'm-append');
  assert.ok(math.key.includes('map-m-append'));
});

test('3b) localMaps replace：目标日原课被覆盖（条数=新集）', () => {
  const state = clone(edge);
  state.snapshot.remaps = [];
  state.localMaps = [{ id: 'm-replace', date: '2026-10-08', fromDate: '2026-10-05', mode: 'replace' }];
  const rows = day(state, '2026-10-08');
  const list = names(rows);
  assert.ok(!list.includes('物理实验'), 'replace 必须清掉目标日原有课');
  assert.ok(list.includes('高等数学'));
  assert.ok(list.includes('社团活动'));
  assert.equal(rows.filter((row) => row.name !== 'study').length, 2, '新集=原日 2，不含目标日 1');
  assert.equal(rows.filter((row) => row.name === 'study').length, 1);
  const math = rows.find((row) => row.name === '高等数学');
  assert.equal(math.originDate, '2026-10-05');
  assert.equal(math.remapId, 'm-replace');
});

test('3c) snapshot.remaps append：学校来源映射仍合并而非替换', () => {
  const state = clone(edge);
  state.localMaps = [];
  state.snapshot.remaps = [{ id: 'school-append', date: '2026-10-08', fromDate: '2026-10-05', mode: 'append' }];
  const rows = day(state, '2026-10-08');
  const list = names(rows);
  assert.ok(list.includes('物理实验'));
  assert.ok(list.includes('高等数学'));
  assert.ok(list.includes('社团活动'));
  assert.equal(rows.filter((row) => row.name !== 'study').length, 3);
});

test('3d) 读路径：历史 append 本地记录加载后按 replace 呈现（幂等）', () => {
  const legacy = clone(edge);
  legacy.snapshot.remaps = [];
  legacy.localMaps = [{ id: 'legacy-append', date: '2026-10-08', fromDate: '2026-10-05', mode: 'append' }];
  const first = repoMod.migrate(JSON.stringify({ version: 1, state: legacy }));
  assert.equal(first.localMaps.length, 1);
  assert.equal(first.localMaps[0].id, 'legacy-append', '归一化不能丢记录');
  assert.equal(first.localMaps[0].mode, 'replace');
  const firstNames = names(day(first, '2026-10-08'));
  assert.ok(!firstNames.includes('物理实验'), '归一为 replace 后目标日原课被覆盖');
  assert.ok(firstNames.includes('高等数学'));

  const second = repoMod.migrate(JSON.stringify({ version: 1, state: first }));
  assert.equal(second.localMaps[0].mode, 'replace');
  assert.deepEqual(names(day(second, '2026-10-08')), firstNames, '连续读两次结果一致');
});

test('4) 寒假/暑假：普通课停课，晚自习按 skipStudy 规则保留', () => {
  const winterRows = day(edge, '2026-12-28');
  assert.ok(!names(winterRows).includes('高等数学'), '寒假普通课应停课');
  assert.ok(names(winterRows).includes('study'), '寒假 skipStudy=false 时晚自习应保留');
});

test('5) 单日休假：停课但晚自习按 skipStudy 规则保留', () => {
  const state = clone(edge);
  state.holidaySettings.days = [{ date: '2026-09-07', skipStudy: false }];
  const rows = day(state, '2026-09-07');
  assert.ok(!names(rows).includes('高等数学'));
  assert.ok(names(rows).includes('study'), 'skipStudy=false 时晚自习应保留');
});

test('6) 单日休假：skipStudy=true 时晚自习也停', () => {
  const state = clone(edge);
  state.holidaySettings.days = [{ date: '2026-09-07', skipStudy: true }];
  assert.deepEqual(day(state, '2026-09-07'), []);
});

test('7) 晚自习：大一显示、非大一隐藏、userEnabled=false 隐藏', () => {
  assert.ok(names(day(edge, '2026-09-01')).includes('study'));
  const other = clone(edge);
  other.snapshot.studyPolicy.profile = { enrollmentYear: 2025 };
  assert.ok(!names(day(other, '2026-09-01')).includes('study'));
  const disabled = clone(edge);
  disabled.snapshot.studyPolicy.userEnabled = false;
  assert.ok(!names(day(disabled, '2026-09-01')).includes('study'));
});

test('8) 晚自习：与学校课冲突时不显示，overlap 标记生效', () => {
  const state = clone(edge);
  state.overrides = [{
    id: 'o1',
    key: '2026-09-07/r-math',
    date: '2026-09-07',
    base: {},
    patch: { startTime: '19:00', endTime: '20:30', periods: [9, 10] },
    createdAt: '2026-09-01T00:00:00.000Z'
  }];
  const rows = day(state, '2026-09-07');
  assert.ok(!names(rows).includes('study'));
  assert.ok(rows.some((row) => row.name === '高等数学' && row.startTime === '19:00'));
});

test('9) 自定义课程：weekly 指定周次/星期、once 单日出现', () => {
  assert.ok(names(day(edge, '2026-09-07')).includes('社团活动'));
  assert.ok(!names(day(edge, '2026-09-01')).includes('社团活动'));
  assert.ok(names(day(edge, '2026-09-28')).includes('讲座'));
});

test('10) 请假联动：approved 左闭右开、pending 标记、rejected 不标记', () => {
  const row = {
    key: 'k1', date: '2026-09-01', startTime: '14:00', endTime: '15:25', periods: [5, 6],
    name: '课', teacher: '师', room: '室', cancelled: false, vacant: false, localActivity: false,
    customCourse: false, remapId: null, conflict: false, overlap: false, source: 'school', originDate: '2026-09-01'
  };
  const base = { ...row };
  const approved = { ...base, type: 'leave', id: 'l1', status: 'approved', startDate: '2026-09-01', startTime: '15:00', endDate: '2026-09-01', endTime: '16:00', reason: '', approver: '', comment: '', rawStatus: '', semesterId: 's1', demo: false };
  const pending = { ...approved, status: 'pending' };
  const rejected = { ...approved, status: 'rejected' };
  const before = { ...row };
  const mid = { ...approved, startTime: '15:00', endTime: '17:00' };
  assert.equal(core.markLeave([row], [mid])[0].leave, true, '中段相交应标记');
  assert.equal(core.markLeave([row], [approved])[0].leave, true);
  assert.equal(core.markLeave([row], [pending])[0].pendingLeave, true);
  assert.equal(core.markLeave([row], [rejected])[0].leave, false);
  assert.equal(core.markLeave([row], [rejected])[0].pendingLeave, false);
  // 左闭右开：请假 13:00-14:00 与 14:00 开始的课不相交
  const boundary = { ...approved, startTime: '13:00', endTime: '14:00' };
  assert.equal(core.markLeave([row], [boundary])[0].leave, false);
  assert.deepEqual(row, before, 'markLeave 不应修改入参');
});

test('11) diffState：新增/删除/改教室各 1 条，无变化 0 条，首次基线不刷屏', () => {
  const make = (rules) => {
    const state = types.createDefaultState();
    state.snapshot = {
      id: 's1', name: 'S', startDate: '2026-08-31', weeks: 1,
      source: { kind: 'sample', label: 't' }, rules
    };
    return state;
  };
  const rule = (id, room) => ({
    id, name: '课', teacher: '师', room, dayOfWeek: 1, weekday: 1, startPeriod: 1, endPeriod: 2,
    periods: [1, 2], weeks: [1], startTime: '08:30', endTime: '09:55', cancelled: false, source: 'school'
  });
  const base = make([rule('r1', 'A101')]);
  const NOW = Date.parse('2026-08-31T00:00:00+08:00');
  const added = core.diffState(base, make([rule('r1', 'A101'), rule('r2', 'B202')]), NOW);
  assert.equal(added.filter((x) => x.kind === 'add').length, 1);
  const removed = core.diffState(base, make([]), NOW);
  assert.equal(removed.filter((x) => x.kind === 'remove').length, 1);
  const updated = core.diffState(base, make([rule('r1', 'C303')]), NOW);
  assert.equal(updated.filter((x) => x.kind === 'update').length, 1);
  assert.equal(core.diffState(base, make([rule('r1', 'A101')]), NOW).length, 0);
  assert.deepEqual(core.diffState(null, base, NOW), []);
});

test('12) StateRepository：save→load 往返一致、revision 递增、空值容错', async () => {
  const store = new memMod.MemoryPreferencesStore();
  const files = new fileMod.MemoryStateFileStore();
  const state = types.createDefaultState();
  state.snapshot = { id: 's1', name: 'S', startDate: '2026-08-31', weeks: 1, source: { kind: 'sample', label: 't' }, rules: [] };
  state.theme = 'blue';
  state.events = [{ id: 'e1', date: '2026-09-01', kind: 'add', label: 'x', createdAt: 1 }];
  state.localMaps = [{ id: 'm1', date: '2026-09-11', fromDate: '2026-09-07', mode: 'replace' }];
  state.customCourses = [{ id: 'c1', mode: 'weekly', name: '社团', teacher: '', room: '', startTime: '19:00', endTime: '20:30', dayOfWeek: 1, weeks: [1], semesterId: 's1' }];
  state.overrides = [{
    id: 'o1', key: 'k1', date: '2026-09-01',
    base: { key: 'k1', date: '2026-09-01', startTime: '14:00', endTime: '15:25', periods: [5, 6], name: '课', teacher: '师', room: '室', cancelled: false, vacant: false, localActivity: false, customCourse: false, remapId: null, conflict: false, overlap: false, source: 'school', originDate: '2026-09-01' },
    patch: { room: 'B202' }, createdAt: '2026-09-01T00:00:00+08:00'
  }];
  await repoMod.save(store, files, state);
  const loaded = await repoMod.load(store, files, 's1');
  assert.equal(loaded.theme, 'blue');
  assert.equal(loaded._revision, 1);
  assert.equal(loaded.events.length, 1, 'events 往返不能丢');
  assert.equal(loaded.overrides.length, 1, 'overrides 往返不能丢');
  assert.equal(loaded.localMaps.length, 1, 'localMaps 往返不能丢');
  assert.equal(loaded.customCourses.length, 1, 'customCourses 往返不能丢');
  assert.equal(loaded.localMaps[0].id, 'm1');
  const loadedEmpty = await repoMod.load(store, new fileMod.MemoryStateFileStore(), 'missing');
  assert.equal(loadedEmpty.snapshot, null);
});

test('13) StateRepository：空/坏 JSON 容错，schema 版本迁移失败', async () => {
  assert.equal(repoMod.migrate('').version, 1);
  assert.throws(() => repoMod.migrate('{bad'), /STATE_CORRUPT/);
  const state = types.createDefaultState();
  assert.throws(() => repoMod.migrate(JSON.stringify({ version: 2, state })), /STATE_MIGRATION_FAILED/);
});

test('14) StateRepository：写失败回滚，主键不残留、revision 回退', async () => {
  const store = new memMod.MemoryPreferencesStore();
  const files = new fileMod.MemoryStateFileStore();
  const state = types.createDefaultState();
  state.snapshot = { id: 's1', name: 'S', startDate: '2026-08-31', weeks: 1, source: { kind: 'sample', label: 't' }, rules: [] };
  files.failNextWriteForTest();
  await assert.rejects(repoMod.saveWithRevision(store, files, state, 's1', 0), /STATE_WRITE_FAILED/);
  assert.equal(await files.read(), null);
  assert.equal(await store.get('jiangshui.state.revision.s1'), '0');
});

test('15) StateRepository：revision 冲突拒绝写入', async () => {
  const store = new memMod.MemoryPreferencesStore();
  const repo = new repoMod.StateRepositoryImpl(store, 's1');
  const state = types.createDefaultState();
  state.snapshot = { id: 's1', name: 'S', startDate: '2026-08-31', weeks: 1, source: { kind: 'sample', label: 't' }, rules: [] };
  await assert.rejects(repo.save(state, 3), /STATE_REVISION_CONFLICT/);
});

test('16) key 唯一：同一日期重复解析 key 一致，学期内 key 不重复', () => {
  const a = day(edge, '2026-09-07').map((row) => row.key);
  const b = day(edge, '2026-09-07').map((row) => row.key);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
  const all = core.semesterOccurrences(edge.snapshot).map((row) => row.key);
  assert.equal(new Set(all).size, all.length);
});

test('17) 寒假/暑假 skipStudy=false 仍保留晚自习', () => {
  const winter = clone(edge);
  winter.holidaySettings.days = [{ date: '2026-12-28', skipStudy: false }];
  assert.ok(names(day(winter, '2026-12-28')).includes('study'), '寒假默认应保留晚自习');

  const summer = clone(edge);
  summer.holidaySettings.winter = null;
  summer.holidaySettings.summer = { startDate: '2026-12-29', endDate: '2026-12-31' };
  summer.holidaySettings.days = [{ date: '2026-12-29', skipStudy: false }];
  assert.ok(names(day(summer, '2026-12-29')).includes('study'), '暑假默认应保留晚自习');

  const skip = clone(edge);
  skip.holidaySettings.days = [{ date: '2026-12-28', skipStudy: true }];
  assert.ok(!names(day(skip, '2026-12-28')).includes('study'), '显式 skipStudy=true 才停');
});

test('18) diffState：同课跨周 stableKey 一致', () => {
  const make = (room) => {
    const state = types.createDefaultState();
    state.snapshot = {
      id: 's1', name: 'S', startDate: '2026-11-02', weeks: 2,
      source: { kind: 'sample', label: 't' },
      rules: [{
        id: 'r1', name: '课', teacher: '师', room, dayOfWeek: 1, weekday: 1,
        startPeriod: 1, endPeriod: 2, periods: [1, 2], weeks: [1, 2],
        startTime: '08:30', endTime: '09:55', cancelled: false, source: 'school'
      }]
    };
    return state;
  };
  const changes = core.diffState(make('A101'), make('B202'));
  const updates = changes.filter((item) => item.kind === 'update');
  assert.ok(updates.length >= 1, '改教室应产生 update');
  assert.equal(new Set(updates.map((item) => item.stableKey)).size, 1, '同课两周 stableKey 应一致');
  assert.equal(updates[0].stableKey, 'r1');
});

test('19) diffState：已结束课程不产生变更', () => {
  const make = (room) => {
    const state = types.createDefaultState();
    state.snapshot = {
      id: 's1', name: 'S', startDate: '2026-08-31', weeks: 1,
      source: { kind: 'sample', label: 't' },
      rules: [{
        id: 'r1', name: '课', teacher: '师', room, dayOfWeek: 1, weekday: 1,
        startPeriod: 1, endPeriod: 2, periods: [1, 2], weeks: [1],
        startTime: '08:30', endTime: '09:55', cancelled: false, source: 'school'
      }]
    };
    return state;
  };
  assert.deepEqual(core.diffState(make('A101'), make('B202')), []);
});

test('20) StateRepository：坏 snapshot 降级不崩', async () => {
  const bad = JSON.stringify({ version: 1, state: { snapshot: { id: 's1' } } });
  let degraded = null;
  try {
    degraded = repoMod.migrate(bad);
  } catch (error) {
    assert.match(String(error.message), /STATE_(CORRUPT|MIGRATION_FAILED)/);
  }
  if (degraded !== null) {
    assert.equal(degraded.snapshot, null, '坏 snapshot 应回退为空状态');
    assert.deepEqual(core.resolveDay(degraded, '2026-09-01'), []);
  }

  const store = new memMod.MemoryPreferencesStore();
  const files = new fileMod.MemoryStateFileStore();
  await files.writeAtomic(bad);
  let loaded = null;
  try {
    loaded = await repoMod.load(store, files, 's1');
  } catch (error) {
    assert.match(String(error.message), /STATE_(CORRUPT|MIGRATION_FAILED)/);
  }
  if (loaded !== null) {
    assert.equal(loaded.snapshot, null);
    assert.deepEqual(core.resolveDay(loaded, '2026-09-01'), []);
  }
});

test('21) 请假：cancel 不标记；approved+pending 多假条各自生效', () => {
  const makeRow = (key, startTime, endTime) => ({
    key, date: '2026-09-01', startTime, endTime, periods: [5, 6],
    name: '课', teacher: '师', room: '室', cancelled: false, vacant: false, localActivity: false,
    customCourse: false, remapId: null, conflict: false, overlap: false, source: 'school', originDate: '2026-09-01'
  });
  const rows = [makeRow('k1', '14:00', '15:25'), makeRow('k2', '16:00', '17:00')];
  const record = (id, type, status, startTime, endTime) => ({
    id, type, status, startDate: '2026-09-01', startTime, endDate: '2026-09-01', endTime,
    reason: '', approver: '', comment: '', rawStatus: '', semesterId: 's1', demo: false
  });
  const marked = core.markLeave(rows, [
    record('a1', 'leave', 'approved', '14:10', '15:00'),
    record('p1', 'leave', 'pending', '15:00', '16:10'),
    record('r1', 'leave', 'rejected', '16:00', '17:00')
  ]);
  assert.equal(marked[0].leave, true);
  assert.equal(marked[0].pendingLeave, false);
  assert.equal(marked[1].leave, false);
  assert.equal(marked[1].pendingLeave, true);

  const cancel = core.markLeave([makeRow('k1', '14:00', '15:25')], [
    record('c1', 'cancel', 'approved', '14:10', '15:00')
  ]);
  assert.equal(cancel[0].leave, false, '销假（cancel）不应标记请假');

  const leaveState = clone(edge);
  leaveState.snapshot.remaps = [];
  leaveState.snapshot.exceptions = [];
  const fixtureRows = core.markLeave(day(leaveState, '2026-09-28'), edge.leaveRecords);
  const fixtureMath = fixtureRows.find((row) => row.name === '高等数学');
  assert.ok(fixtureMath);
  assert.equal(fixtureMath.leave, true, 'fixtures/edge-state.json 的 leaveRecords 应真实驱动');
});

test('22) StateRepository：主文件写成功后 revision 写失败 → 回滚文件与 revision', async () => {
  const store = new memMod.MemoryPreferencesStore();
  const files = new fileMod.MemoryStateFileStore();
  const state = types.createDefaultState();
  state.snapshot = { id: 's1', name: 'S', startDate: '2026-08-31', weeks: 1, source: { kind: 'sample', label: 't' }, rules: [] };
  state.theme = 'blue';
  await repoMod.save(store, files, state);
  const before = await files.read();
  const next = clone(state);
  next.theme = 'black';
  store.failNextSetForTest();
  await assert.rejects(repoMod.saveWithRevision(store, files, next, 's1', 1), /STATE_WRITE_FAILED/);
  assert.equal(await files.read(), before, '文件应回滚到旧 payload');
  assert.equal(await store.get('jiangshui.state.revision.s1'), '1');
  assert.equal(next._revision, 1, '内存 revision 应回滚');
});

test('23) StateRepository：删 tmp 失败路径 → STATE_WRITE_FAILED 且 revision 不递增', async () => {
  const store = new memMod.MemoryPreferencesStore();
  const files = new fileMod.MemoryStateFileStore();
  const state = types.createDefaultState();
  state.snapshot = { id: 's1', name: 'S', startDate: '2026-08-31', weeks: 1, source: { kind: 'sample', label: 't' }, rules: [] };
  files.failNextWriteForTest();
  files.failNextRemoveForTest();
  await assert.rejects(repoMod.saveWithRevision(store, files, state, 's1', 0), /STATE_WRITE_FAILED/);
  assert.equal(await files.read(), null);
  assert.equal(await store.get('jiangshui.state.revision.s1'), '0');
});

test('24) StateRepository：坏文件保留 .corrupt 副本并降级为空态', async () => {
  const store = new memMod.MemoryPreferencesStore();
  const files = new fileMod.MemoryStateFileStore();
  const bad = JSON.stringify({ version: 1, state: { snapshot: { id: 's1' } } });
  await files.writeAtomic(bad);
  const loaded = await repoMod.load(store, files, 's1');
  assert.equal(loaded.snapshot, null);
  assert.match(String(loaded.error), /STATE_(MIGRATION_FAILED|CORRUPT)/);
  assert.equal(files.corruptCopyForTest(), bad, '坏文件应保留副本');
  assert.deepEqual(core.resolveDay(loaded, '2026-09-01'), [], '降级态解析不抛 TypeError');
});

test('25) 错误码：STATE_CORRUPT 与 STATE_MIGRATION_FAILED 可区分；空文件返回空态', async () => {
  assert.throws(() => repoMod.migrate('{bad'), /STATE_CORRUPT/);
  assert.throws(() => repoMod.migrate(JSON.stringify({ version: 2, state: {} })), /STATE_MIGRATION_FAILED/);
  const empty = await repoMod.load(new memMod.MemoryPreferencesStore(), new fileMod.MemoryStateFileStore(), 'none');
  assert.equal(empty.snapshot, null);
});

test('26) StateRepository：migrate 保留 events/overrides/localMaps/customCourses', () => {
  const state = types.createDefaultState();
  state.snapshot = { id: 's1', name: 'S', startDate: '2026-08-31', weeks: 1, source: { kind: 'sample', label: 't' }, rules: [] };
  state.events = [{ id: 'e1', date: '2026-09-01', kind: 'add', label: 'x', createdAt: 1 }];
  state.localMaps = [{ id: 'm1', date: '2026-09-11', fromDate: '2026-09-07', mode: 'replace' }];
  state.customCourses = [{ id: 'c1', mode: 'weekly', name: '社团', teacher: '', room: '', startTime: '19:00', endTime: '20:30', dayOfWeek: 1, weeks: [1], semesterId: 's1' }];
  state.overrides = [{
    id: 'o1', key: 'k1', date: '2026-09-01',
    base: { key: 'k1', date: '2026-09-01', startTime: '14:00', endTime: '15:25', periods: [5, 6], name: '课', teacher: '师', room: '室', cancelled: false, vacant: false, localActivity: false, customCourse: false, remapId: null, conflict: false, overlap: false, source: 'school', originDate: '2026-09-01' },
    patch: { room: 'B202' }, createdAt: '2026-09-01T00:00:00+08:00'
  }];
  const migrated = repoMod.migrate(JSON.stringify({ version: 1, state }));
  assert.equal(migrated.events.length, 1, 'migrate 不能丢 events');
  assert.equal(migrated.overrides.length, 1, 'migrate 不能丢 overrides');
  assert.equal(migrated.localMaps.length, 1, 'migrate 不能丢 localMaps');
  assert.equal(migrated.customCourses.length, 1, 'migrate 不能丢 customCourses');
});

