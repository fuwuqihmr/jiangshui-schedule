import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  EXPECTED_BASELINE,
  EXPECTED_BASELINE_COUNT,
  computeBaseline,
  sha256,
  readText
} from '../tools/check-ios.mjs';

const baseline = computeBaseline(ROOT);

test('web/ + android/ 入库源码文件数仍为基线 182', () => {
  assert.equal(EXPECTED_BASELINE_COUNT, 182);
  assert.equal(baseline.count, EXPECTED_BASELINE_COUNT);
});

test('web/ + android/ 基线哈希未变（共享层未被污染）', () => {
  assert.equal(baseline.hash, EXPECTED_BASELINE);
  assert.equal(baseline.hash, '1ea23688954ba6631a98c31aca4c62b593815da5052965434bd057ac6718cbdd');
});

test('基线文件列表排序稳定、无重复且都在磁盘上', () => {
  const sorted = [...baseline.files].sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
  assert.deepEqual(baseline.files, sorted);
  assert.equal(new Set(baseline.files).size, baseline.files.length);
  for (const rel of baseline.files) assert.ok(existsSync(path.join(ROOT, rel)), '文件不存在：' + rel);
  assert.ok(baseline.files.includes('web/index.html'));
  assert.ok(baseline.files.includes('web/agreement.json'));
  assert.ok(baseline.files.includes('android/app/src/main/java/cn/local/tomorrow/MainActivity.java'));
});

test('文本模式哈希仅作诊断，不与二进制模式混用', () => {
  const text = readText(path.join(ROOT, 'web', 'index.html'));
  assert.equal(sha256(text), sha256(Buffer.from(text, 'utf8')));
  assert.notEqual(baseline.textHash, baseline.hash);
});
