import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  SHARED_MANIFEST_PATH,
  SHARED_MANIFEST_FORMAT,
  readSharedManifest,
  sharedLayerFiles,
  hashSharedFiles,
  buildSharedManifest,
  sha256,
  readText
} from '../tools/check-ios.mjs';

const manifest = readSharedManifest(ROOT);
const actualFiles = sharedLayerFiles(ROOT);
const actualHashes = hashSharedFiles(ROOT, actualFiles);

test('共享层清单存在、格式合法，且不以写死文件数作为冻结值', () => {
  assert.ok(manifest, '缺少 ' + SHARED_MANIFEST_PATH + '，请运行 node ios/tools/check-ios.mjs --write-shared-manifest');
  assert.equal(manifest.formatVersion, SHARED_MANIFEST_FORMAT);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, '清单 files 不能为空');
  assert.ok(!Object.prototype.hasOwnProperty.call(manifest, 'count'), '清单不应记录文件数（只报 missing/extra/changed）');
  assert.ok(!Object.prototype.hasOwnProperty.call(manifest, 'hash'), '清单不应记录聚合哈希作为权威值');
  assert.equal(new Set(manifest.files.map((item) => item.path)).size, manifest.files.length, '清单路径不得重复');
});

test('E1：git 工作树实际文件集合与清单完全一致（missing/extra 都为空）', () => {
  const manifestPaths = manifest.files.map((item) => item.path);
  const missing = manifestPaths.filter((rel) => !actualFiles.includes(rel));
  const extra = actualFiles.filter((rel) => !manifestPaths.includes(rel));
  assert.deepEqual(missing, [], '清单有、工作树没有（missing）');
  assert.deepEqual(extra, [], '工作树有、清单没有（extra）');
  assert.deepEqual(manifestPaths, actualFiles, '清单顺序应与 git 工作树排序一致');
  for (const rel of actualFiles) assert.ok(existsSync(path.join(ROOT, rel)), '文件不存在：' + rel);
});

test('E2：逐文件 git blob 未变（共享层未被污染）', () => {
  const expected = new Map(manifest.files.map((item) => [item.path, item.blob]));
  const changed = actualHashes.filter((item) => expected.get(item.path) !== item.blob).map((item) => item.path);
  assert.deepEqual(changed, [], '以下文件 blob 与清单不一致（changed）');
  assert.equal(actualHashes.length, manifest.files.length);
});

test('清单可由当前工作树重新生成且结果稳定（可重复命令）', () => {
  const rebuilt = buildSharedManifest(ROOT);
  assert.deepEqual(rebuilt.files, manifest.files);
  assert.equal(rebuilt.formatVersion, SHARED_MANIFEST_FORMAT);
});

test('共享层清单覆盖 web/ 与 android/ 的关键入口，且排除构建产物', () => {
  const paths = manifest.files.map((item) => item.path);
  assert.ok(paths.includes('web/index.html'));
  assert.ok(paths.includes('web/agreement.json'));
  assert.ok(paths.includes('android/app/src/main/java/cn/local/tomorrow/MainActivity.java'));
  for (const rel of paths) {
    assert.ok(!/\.(apk|zip)$/i.test(rel), '清单不应包含构建产物：' + rel);
    assert.ok(!/(^|\/)(build|\.gradle)(\/|$)/.test(rel), '清单不应包含构建目录：' + rel);
  }
});

test('文本模式哈希仅作诊断，不与 git blob 混用', () => {
  const text = readText(path.join(ROOT, 'web', 'index.html'));
  assert.equal(sha256(text), sha256(Buffer.from(text, 'utf8')));
  assert.match(actualHashes[0].blob, /^[0-9a-f]{40}$/);
});
