// 职责：备份恢复往返——生产导出/解析/严格校验/恢复专用写盘（revision=max+1、demoMode 以备份为准）。
// 运行：node harmony/tools/run-core-tests.mjs（本文件被其收集）。
// 说明：本机无 DevEco；这里只执行 Node 可跑的 data/core 纯逻辑，不涉及 ArkUI。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');
const load = (rel) => import(pathToFileURL(path.join(tmp, rel)).href);

const Backup = await load('core/export/Backup.ts');
const Repo = await load('data/StateRepository.ts');
const MemPrefs = await load('data/MemoryPreferencesStore.ts');
const MemFiles = await load('data/MemoryStateFileStore.ts');
const Demo = await load('core/demo/DemoState.ts');

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
    weeks: [1, 2, 3, 4, 5, 6, 7, 8],
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
    rules: [makeRule(), makeRule({ id: 'rule-2', name: '大学英语', dayOfWeek: 2, weeks: [1, 3, 5] })],
    source: { kind: 'school', label: '教务系统' },
    unscheduled: []
  };
  state.customCourses = [{
    id: 'custom-1',
    mode: 'weekly',
    name: '社团',
    room: 'B201',
    teacher: '李老师',
    startTime: '18:30',
    endTime: '19:30',
    semesterId: 'semester-1',
    semesterStartDate: '2026-08-31',
    startWeek: 1,
    endWeek: 10,
    weekPattern: 'every',
    weekdays: [3]
  }];
  return state;
}

function repoPair() {
  const prefs = new MemPrefs.MemoryPreferencesStore();
  const files = new MemFiles.MemoryStateFileStore();
  return { prefs, files, repo: new Repo.StateRepositoryImpl(prefs, files, 'semester-1') };
}

function productionBackup(state) {
  const raw = Backup.buildBackupJson(state, 1790000000000, '1.3.1');
  const parsed = Backup.parseBackupJson(raw);
  assert.equal(parsed.ok, true, 'production backup must parse: ' + parsed.code);
  assert.equal(Backup.validateRestoreState(parsed.state), '');
  return parsed.state;
}

test('roundtrip-1) 生产导出→生产导入→恢复写盘，rules/customCourses/revision 保留', async () => {
  const state = makeState();
  state._revision = 0;
  const restored = productionBackup(state);
  assert.equal(restored.snapshot.rules.length, 2);
  assert.equal(restored.customCourses.length, 1);

  const { repo } = repoPair();
  const revision = await repo.saveRestored(restored);
  assert.equal(revision, 1);
  const loaded = await repo.load();
  assert.equal(loaded.snapshot.rules.length, 2);
  assert.equal(loaded.snapshot.rules[0].name, '高等数学');
  assert.equal(loaded.customCourses.length, 1);
  assert.equal(loaded.customCourses[0].name, '社团');
  assert.equal(loaded._revision, 1);
});

test('roundtrip-2) 备份 _revision=0 导入 revision>0 的仓库成功，再写一次仍成功', async () => {
  const { repo } = repoPair();
  const seed = makeState();
  await repo.save(seed, 0);
  await repo.save(seed, 1);
  assert.equal(Number(await repo.load().then((s) => s._revision)), 2);

  const backup = productionBackup(makeState());
  assert.equal(backup._revision, 0);
  const revision = await repo.saveRestored(backup);
  assert.equal(revision, 3, 'revision must be max(current, backup)+1');
  const loaded = await repo.load();
  assert.equal(loaded._revision, 3);

  // 恢复后再走普通保存（乐观锁）必须仍然成功。
  const nextRevision = await repo.save(loaded, loaded._revision);
  assert.equal(nextRevision, 4);
  assert.equal((await repo.load())._revision, 4);
});

test('roundtrip-3) 备份 revision 高于仓库时也抬到 max+1，不抛冲突', async () => {
  const { repo } = repoPair();
  await repo.save(makeState(), 0);
  const backup = productionBackup(makeState());
  backup._revision = 5;
  const revision = await repo.saveRestored(backup);
  assert.equal(revision, 6);
  assert.equal((await repo.load())._revision, 6);
});

test('roundtrip-4) demoMode 以备份为准：示例备份可写回，真实备份可退出示例', async () => {
  const { repo } = repoPair();
  const demo = Demo.createDemoState();
  demo.version = 3;
  demo._revision = 0;
  demo.demoMode = true;
  const demoBackup = productionBackup(demo);
  await repo.saveRestored(demoBackup);
  const loadedDemo = await repo.load();
  assert.equal(loadedDemo.demoMode, true);
  assert.equal(loadedDemo.snapshot.rules.length, demo.snapshot.rules.length);

  const real = makeState();
  real.demoMode = false;
  real._revision = 0;
  const realBackup = productionBackup(real);
  await repo.saveRestored(realBackup);
  const loadedReal = await repo.load();
  assert.equal(loadedReal.demoMode, false);
  assert.equal(loadedReal.snapshot.rules.length, 2);
});

test('roundtrip-5) 坏备份在解析/写盘两层都被拒，旧文件一字节不变', async () => {
  const { repo, files } = repoPair();
  await repo.save(makeState(), 0);
  const before = await files.read();
  const bad = makeState();
  bad.snapshot.rules = [null];
  const raw = JSON.stringify({ format: Backup.BACKUP_FORMAT, version: 1, state: bad });
  const parsed = Backup.parseBackupJson(raw);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, Backup.CODE_BACKUP_STATE_INVALID);
  await assert.rejects(() => repo.saveRestored(bad), /BACKUP_STATE_INVALID/);
  assert.equal(await files.read(), before);
  assert.equal((await repo.load()).snapshot.rules[0].name, '高等数学');
});

test('roundtrip-6) r4 同形示例备份（demoMode=true/_revision=0）可导入并可再保存', async () => {
  const { repo } = repoPair();
  await repo.save(makeState(), 0);
  await repo.save(await repo.load(), 1);
  const demo = Demo.createDemoState();
  demo.version = 3;
  demo._revision = 0;
  demo.demoMode = true;
  const backup = productionBackup(demo);
  assert.equal(backup.demoMode, true);
  assert.equal(backup._revision, 0);
  assert.equal(backup.snapshot.source.kind, 'sample');
  const revision = await repo.saveRestored(backup);
  assert.equal(revision, 3);
  const loaded = await repo.load();
  assert.equal(loaded.demoMode, true);
  assert.equal(loaded.snapshot.id, demo.snapshot.id);
  assert.equal((await repo.save(loaded, loaded._revision)), 4);
});
