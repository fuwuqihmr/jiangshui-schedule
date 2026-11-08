// 职责：commitRestore 分阶段码与 leftDemo 语义（真执行 ExportWorkflow 拷贝）。
// 运行：node harmony/tools/run-core-tests.mjs（本文件被其收集）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');
const HARMONY_ROOT = process.env.HARMONY_ROOT || path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..');
const ETS = path.join(HARMONY_ROOT, 'entry/src/main/ets');
const load = (rel) => import(pathToFileURL(path.join(tmp, rel)).href);

const Backup = await load('core/export/Backup.ts');
const Repo = await load('data/StateRepository.ts');
const WORKFLOW = path.join(ETS, 'features/export/ExportWorkflow.ets');
const dest = path.join(tmp, 'features/export/ExportWorkflowFixture.ts');
fs.mkdirSync(path.dirname(dest), { recursive: true });
const patched = fs.readFileSync(WORKFLOW, 'utf8').replace(/from '([^']+)'/g, (full, spec) => spec.startsWith('../../core/') ? "from '" + spec + ".ts'" : full);
fs.writeFileSync(dest, patched);
const W = await import(pathToFileURL(dest).href + '?v=' + Date.now());

function makeRule() {
  return {
    id: 'rule-1', name: '高等数学', teacher: '张老师', room: 'A101', dayOfWeek: 1,
    startPeriod: 1, endPeriod: 2, periods: [1, 2], weeks: [1, 2], startTime: '08:30', endTime: '09:55',
    cancelled: false, source: 'school'
  };
}
function makeState() {
  const state = Repo.createEmptyState();
  state.version = 3;
  state.snapshot = {
    id: 'semester-1', name: '测试学期', startDate: '2026-08-31', weeks: 10,
    rules: [makeRule()], source: { kind: 'school', label: '教务系统' }, unscheduled: []
  };
  return state;
}
function flow() {
  return new W.ExportWorkflow({}, { save: async () => ({ uri: 'file://x', mime: 'text/plain', bytes: 1, pages: 1 }) }, { pickText: async () => null });
}
function previewOf(state) {
  return { ok: true, code: W.STATUS_OK, summary: 'S', state: state };
}
function applyOf(ok, calls) {
  return { apply: async () => { calls.count++; return ok; } };
}

test('restore-flow-1) 当前 demo + 真实备份：commit 成功且 leftDemo=true', async () => {
  const state = makeState();
  state.demoMode = false;
  const calls = { count: 0 };
  const out = await flow().commitRestore(previewOf(state), applyOf(true, calls), true);
  assert.equal(out.ok, true);
  assert.equal(out.code, W.STATUS_OK);
  assert.equal(out.leftDemo, true);
  assert.equal(calls.count, 1);
});

test('restore-flow-2) 示例备份不触发退出提示；非 demo 也不提示', async () => {
  const state = makeState();
  state.demoMode = true;
  const calls = { count: 0 };
  const inDemo = await flow().commitRestore(previewOf(state), applyOf(true, calls), true);
  assert.equal(inDemo.leftDemo, false);
  state.demoMode = false;
  const notDemo = await flow().commitRestore(previewOf(state), applyOf(true, calls), false);
  assert.equal(notDemo.leftDemo, false);
});

test('restore-flow-3) 非法状态在 validate 阶段拒绝，码为 BACKUP_STATE_INVALID 且不调用 apply', async () => {
  const state = makeState();
  state.snapshot.rules = [null];
  const calls = { count: 0 };
  const out = await flow().commitRestore(previewOf(state), applyOf(true, calls), false);
  assert.equal(out.ok, false);
  assert.equal(out.code, Backup.CODE_BACKUP_STATE_INVALID);
  assert.equal(out.leftDemo, false);
  assert.equal(calls.count, 0);
});

test('restore-flow-4) 写盘被拒映射 EXPORT_BACKUP_SAVE_FAILED，异常映射 EXPORT_BACKUP_APPLY_FAILED', async () => {
  const state = makeState();
  const calls = { count: 0 };
  const rejected = await flow().commitRestore(previewOf(state), applyOf(false, calls), false);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, W.STATUS_RESTORE_SAVE_FAILED);
  assert.notEqual(rejected.code, W.STATUS_RESTORE_APPLY_FAILED);

  const throwing = { apply: async () => { throw { code: 'STATE_WRITE_FAILED', message: 'disk' }; } };
  const failed = await flow().commitRestore(previewOf(state), throwing, false);
  assert.equal(failed.code, W.STATUS_RESTORE_APPLY_FAILED);
});

test('restore-flow-5) preview 已失败时原样返回其阶段码，不再改写成 APPLY_FAILED', async () => {
  const calls = { count: 0 };
  const out = await flow().commitRestore({ ok: false, code: 'BACKUP_INVALID_JSON', summary: '', state: null }, applyOf(true, calls), false);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'BACKUP_INVALID_JSON');
  assert.equal(calls.count, 0);
});
