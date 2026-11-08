// 职责：导出落盘适配层测试——四态映射（成功/取消/超限/不可用）+ 适配层静态契约。
// 运行：node harmony/tools/run-core-tests.mjs（本文件被其收集）。
// 说明：本机无 DevEco，运行行为仅覆盖纯映射；.ets 适配层只做源码级断言，未编译验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');

const HARMONY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ETS = path.join(HARMONY_ROOT, 'entry/src/main/ets');
const ADAPTER = path.join(ETS, 'features/files/ExportFilePorts.ets');
const NAV = path.join(ETS, 'features/files/NAV.md');
const FACTORY = path.join(ETS, 'platform/files/FilePortFactory.ets');

const read = (file) => fs.readFileSync(file, 'utf8');
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
}
const CJK = /(?:[\u3400-\u9fff\uf900-\ufaff])/;

const M = await import(pathToFileURL(path.join(tmp, 'core/export/ExportPortStatus.ts')).href);

test('export-ports-1 成功码映射为 ok 且不静默', () => {
  for (const code of ['OK', '']) {
    const status = M.mapExportPortCode(true, code);
    assert.equal(status.state, 'ok');
    assert.equal(status.code, 'OK');
    assert.equal(status.messageKey, '');
    assert.equal(status.silent, false);
  }
  const forcedOk = M.mapExportPortCode(false, 'OK');
  assert.equal(forcedOk.state, 'ok');
});

test('export-ports-2 用户取消有文案键且静默（两种取消码）', () => {
  for (const code of ['FILE_CANCELED', 'EXPORT_CANCELLED']) {
    const status = M.mapExportPortCode(false, code);
    assert.equal(status.state, 'canceled');
    assert.equal(status.code, code);
    assert.equal(status.messageKey, 'file_error_canceled');
    assert.equal(status.silent, true);
  }
});

test('export-ports-3 超限映射为 too_large + 可见文案键', () => {
  const status = M.mapExportPortCode(false, 'FILE_TOO_LARGE');
  assert.equal(status.state, 'too_large');
  assert.equal(status.messageKey, 'file_error_too_large');
  assert.equal(status.silent, false);
});

test('export-ports-4 能力不可用映射为 unavailable + 可见文案键', () => {
  const status = M.mapExportPortCode(false, 'FILE_UNAVAILABLE');
  assert.equal(status.state, 'unavailable');
  assert.equal(status.messageKey, 'file_error_unavailable');
  assert.equal(status.silent, false);
});

test('export-ports-5 其余稳定错误码映射为 failed 且各有文案键', () => {
  const cases = {
    FILE_UNSUPPORTED: 'file_error_unsupported',
    FILE_EMPTY: 'file_error_empty',
    FILE_INVALID_PATH: 'file_error_invalid_path',
    FILE_NAME_INVALID: 'file_error_name',
    FILE_TIME_INVALID: 'file_error_time',
    FILE_IO_FAILED: 'file_error_io'
  };
  for (const [code, key] of Object.entries(cases)) {
    const status = M.mapExportPortCode(false, code);
    assert.equal(status.state, 'failed', code);
    assert.equal(status.messageKey, key, code);
    assert.equal(status.silent, false, code);
  }
});

test('export-ports-6 未知错误码兜底为 failed/io，不丢原码', () => {
  const status = M.mapExportPortCode(false, 'SOMETHING_ELSE');
  assert.equal(status.state, 'failed');
  assert.equal(status.code, 'SOMETHING_ELSE');
  assert.equal(status.messageKey, 'file_error_io');
});

test('export-ports-7 映射纯逻辑无中文、无 SDK 依赖、无副作用 import', () => {
  const code = stripComments(read(path.join(ETS, 'core/export/ExportPortStatus.ets')));
  assert.ok(!CJK.test(code), 'core/export/ExportPortStatus.ets 含中文字面量');
  assert.ok(!/from\s+['"]@(?:kit|ohos)\//.test(code), '映射层不得 import SDK');
  assert.ok(!/^import\s+(?!type)/m.test(code), '映射层不得有运行时 import');
});

test('export-ports-8 适配层保留窄端口并暴露四态与工厂', () => {
  const code = stripComments(read(ADAPTER));
  for (const token of ['wrapFilePorts', 'createExportFilePorts', 'unavailableExportFilePorts', 'saveExport', 'pickTextExport', 'mapExportPortCode']) {
    assert.ok(code.includes(token), '适配层缺契约：' + token);
  }
  assert.match(code, /saver:\s*FileSavePort/);
  assert.match(code, /picker:\s*FilePickPort/);
  assert.ok(!/export\s+interface\s+FileSavePort/.test(code), '不得重复定义既有窄端口');
  assert.match(code, /createFilePortsFromContext\(context\)/);
  assert.match(code, /FILE_PORT_UNAVAILABLE/);
});

test('export-ports-9 适配层不 import SDK Kit、无中文硬编码、无 #hex 颜色', () => {
  const code = stripComments(read(ADAPTER));
  assert.ok(!CJK.test(code), 'features/files/ExportFilePorts.ets 含中文字面量');
  assert.ok(!/from\s+['"]@(?:kit|ohos)\//.test(code), 'features 层禁止直接 import SDK');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), '适配层不应出现硬编码颜色');
});

test('export-ports-10 platform 工厂提供 object 入口，页面无需 import Kit', () => {
  const code = read(FACTORY);
  assert.match(code, /export\s+function\s+createFilePortsFromContext\(context:\s*object\):\s*FilePortSet/);
  assert.match(code, /createFilePorts\(context\s+as\s+common\.UIAbilityContext\)/);
});

test('export-ports-11 NAV 记录接线、四态文案键、权限与未编译风险', () => {
  const nav = read(NAV);
  for (const token of ['createExportFilePorts', 'features/files/ExportFilePorts', 'SettingsPage.ets', 'file_error_canceled', 'file_error_too_large', 'file_error_unavailable', '不需要新增运行时权限', 'module.json5', '未编译']) {
    assert.ok(nav.includes(token), 'NAV 缺少：' + token);
  }
});
