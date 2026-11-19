import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, runChecks, formatResults } from '../tools/check-ios.mjs';

const expectedIds = [];
for (const [prefix, count] of [['A', 11], ['B', 7], ['C', 8], ['D', 7], ['E', 2], ['F', 12], ['G', 1]]) {
  for (let index = 1; index <= count; index++) expectedIds.push(prefix + index);
}

const results = runChecks(ROOT);

test('check-ios 共 48 项检查，编号与顺序稳定', () => {
  assert.equal(results.length, 48);
  assert.deepEqual(results.map((item) => item.id), expectedIds);
  assert.equal(new Set(results.map((item) => item.id)).size, 48);
});

test('全部 48 项检查通过，且每项都有说明', () => {
  const failures = results.filter((item) => !item.ok);
  assert.deepEqual(failures.map((item) => item.id), [], '失败项：' + failures.map((item) => item.id + ' ' + item.detail).join(' | '));
  for (const item of results) {
    assert.equal(item.ok, true, item.id);
    assert.ok(typeof item.detail === 'string' && item.detail.length > 0, item.id + ' 缺少说明');
    assert.ok(typeof item.title === 'string' && item.title.length > 0, item.id + ' 缺少标题');
  }
});

test('formatResults 输出 fail 0 与全绿汇总', () => {
  const text = formatResults(results);
  assert.match(text, /汇总：48 项，ok 48，fail 0/);
  assert.match(text, /全绿，退出码：0/);
});

test('命令行入口退出码为 0（可重复运行）', () => {
  const script = path.join(ROOT, 'ios', 'tools', 'check-ios.mjs');
  const run = spawnSync(process.execPath, [script], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, 'stdout：' + run.stdout + '\nstderr：' + run.stderr);
  assert.match(run.stdout, /汇总：48 项，ok 48，fail 0/);
  assert.match(run.stdout, /全绿，退出码：0/);
});
