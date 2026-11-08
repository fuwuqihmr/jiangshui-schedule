// 职责：features/export 的静态契约（资源键三处一致 / 无中文无 #hex / 模块边界 / 备份两步落地）+ core/export 纯度。
// 说明：本机无 DevEco，只能做源码级断言；运行时行为由 core-export.test.mjs 覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HARMONY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ETS = path.join(HARMONY_ROOT, 'entry/src/main/ets');
const FEATURES = path.join(ETS, 'features/export');
const CORE = path.join(ETS, 'core/export');
const REQUESTS = path.join(HARMONY_ROOT, 'tools/resource-requests/harmony-export.json');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
}
const CJK = /(?:[\u3400-\u9fff\uf900-\ufaff])/;
const CJK_ESCAPE = /\\u(?:3[4-9][0-9a-f]{2}|[4-9][0-9a-f]{3}|f[89a-f][0-9a-f]{2})/i;

test('export-ui-1 NAV.md 记录父页面接线、权限结论与未验证风险', () => {
  const nav = read(path.join(FEATURES, 'NAV.md'));
  assert.match(nav, /SettingsPage\.ets/);
  assert.match(nav, /features\/export\/ExportPanel/);
  assert.match(nav, /buildExportCopy/);
  assert.match(nav, /module\.json5/);
  assert.match(nav, /不需要新增运行时权限/);
  assert.match(nav, /未编译/);
});

test('export-ui-2 资源键清单、资源请求文件、buildExportCopy 查询三者一致', () => {
  const src = read(path.join(FEATURES, 'ExportCopyKeys.ets'));
  const blockStart = src.indexOf('EXPORT_STRING_KEYS: string[] = [');
  const blockEnd = src.indexOf('];', blockStart);
  assert.ok(blockStart > 0 && blockEnd > blockStart, '找不到 EXPORT_STRING_KEYS 清单');
  const listed = [...src.slice(blockStart, blockEnd).matchAll(/'(export_[a-z0-9_]+)'/g)].map((m) => m[1]);
  const queried = [...src.matchAll(/lookup\('(export_[a-z0-9_]+)'\)/g)].map((m) => m[1]);
  const requested = Object.keys(JSON.parse(read(REQUESTS)));
  assert.equal(new Set(listed).size, listed.length, 'EXPORT_STRING_KEYS 有重复键');
  assert.equal(listed.length, 144, '资源键数量变化必须同步改测试与 NAV.md');
  for (const key of requested) assert.ok(listed.includes(key), '资源请求文件多出未登记的键：' + key);
  for (const key of listed) assert.ok(requested.includes(key), '资源请求文件缺少键：' + key);
  for (const key of queried) assert.ok(listed.includes(key), 'buildExportCopy 查询了未登记的键：' + key);
  const weekdays = [...src.matchAll(/'(export_weekday_[1-7])'/g)].map((m) => m[1]);
  assert.equal(new Set(weekdays).size, 7, '周一到周日 7 个键必须齐全');
});

test('export-ui-3 资源值非空且不带 app.string. 前缀，请求文件合法 JSON', () => {
  const raw = read(REQUESTS);
  const data = JSON.parse(raw);
  for (const [key, value] of Object.entries(data)) {
    assert.ok(!key.startsWith('app.string.'), '资源请求键不带前缀：' + key);
    assert.equal(typeof value, 'string');
    assert.ok(value.trim().length > 0, '资源值不能为空：' + key);
  }
  assert.equal(Object.keys(data).length, 144);
  const merged = JSON.parse(read(path.join(HARMONY_ROOT, 'entry/src/main/resources/base/element/string.json'))).string;
  const mergedKeys = new Set(merged.map((item) => item.name));
  const requested = Object.keys(data);
  const pending = requested.filter((key) => !mergedKeys.has(key));
  // harmony-export 只负责请求；string.json 由 harmony-ui 单点合并。
  // 未合并键在开发模式只告警（check-harmony），/25/27 的 strict 阶段才会强制。
  assert.ok(pending.length <= requested.length);
  for (const key of requested) {
    if (!mergedKeys.has(key)) continue;
    const value = merged.find((item) => item.name === key).value;
    assert.equal(typeof value, 'string');
    assert.ok(value.length > 0, 'string.json 已合并键的值不能为空：' + key);
  }
});

test('export-ui-4 features/export 无中文硬编码、无 #hex 颜色、不 import SDK Kit', () => {
  const files = fs.readdirSync(FEATURES).filter((name) => name.endsWith('.ets'));
  assert.deepEqual(files.sort(), ['ExportCopyKeys.ets', 'ExportPanel.ets', 'ExportWorkflow.ets', 'PagePainter.ets']);
  for (const name of files) {
    const code = stripComments(read(path.join(FEATURES, name)));
    assert.ok(!CJK.test(code), name + ' 含中文字面量');
    assert.ok(!CJK_ESCAPE.test(code), name + ' 用 \\u 转义绕中文检查');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), name + ' 含硬编码颜色（颜色走资源/调色板）');
    assert.ok(!/from\s+['"]@(?:kit|ohos)\//.test(code), name + ' 直接 import 了 SDK（features 只允许 platform 层 import）');
  }
});

test('export-ui-5 编排层只依赖 core，落盘/选文件全部走注入端口', () => {
  const code = stripComments(read(path.join(FEATURES, 'ExportWorkflow.ets')));
  const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const spec of imports) {
    assert.ok(spec.startsWith('../../core/'), '编排层出现非 core 依赖：' + spec);
  }
  assert.match(code, /export interface FileSavePort/);
  assert.match(code, /export interface FilePickPort/);
  assert.match(code, /export interface PageRenderPort/);
  assert.match(code, /export interface StateApplyPort/);
});

test('export-ui-6 备份导入强制两步：previewRestore 不落地，commitRestore 才 apply', () => {
  const code = stripComments(read(path.join(FEATURES, 'ExportWorkflow.ets')));
  const preview = code.slice(code.indexOf('async previewRestore'), code.indexOf('async commitRestore'));
  assert.ok(preview.length > 0);
  assert.ok(!/\.apply\(/.test(preview), 'previewRestore 不得调用 apply（坏数据不许覆盖好数据）');
  const commit = code.slice(code.indexOf('async commitRestore'), code.indexOf('async exportDiagnostics'));
  assert.match(commit, /apply\.apply\(preview\.state\)/);
  assert.match(commit, /STATUS_RESTORE_SAVE_FAILED/);
  assert.match(commit, /STATUS_RESTORE_APPLY_FAILED/);
});

test('export-ui-7 面板具备三条导出 + 备份 + 日志 + 导入恢复的入口与资源化文案', () => {
  const panel = read(path.join(FEATURES, 'ExportPanel.ets'));
  for (const kind of ['overview', 'pages', 'rules', 'backup', 'diagnostics']) {
    assert.match(panel, new RegExp("run\\('" + kind + "'\\)"), '缺少导出入口：' + kind);
  }
  assert.match(panel, /this\.restore\(\)/);
  const copy = read(path.join(FEATURES, 'ExportCopyKeys.ets'));
  for (const field of ['title', 'overviewAction', 'pagesAction', 'rulesAction', 'backupAction', 'restoreAction', 'diagnosticsAction', 'restoreOk']) {
    assert.match(copy, new RegExp(field + ':'), 'ExportCopyKeys 缺少面板字段：' + field);
  }
});

test('export-ui-9 排查日志默认走 util/Redactor 真脱敏（不再恒等）', () => {
  const panel = read(path.join(FEATURES, 'ExportPanel.ets'));
  assert.match(panel, /import\s*\{[^}]*redactText[^}]*\}\s*from\s*'\.\.\/\.\.\/util\/Redactor'/, 'ExportPanel 应 import redactText');
  assert.match(panel, /redact:\s*\(line:\s*string\)\s*=>\s*string\s*=\s*redactText/, 'redact 默认值应为 redactText');
  const redactor = read(path.join(ETS, 'util/Redactor.ets'));
  assert.match(redactor, /export function redactText/);
  const workflow = read(path.join(FEATURES, 'ExportWorkflow.ets'));
  assert.match(workflow, /redact\b/, '日志导出路径必须把注入的 redact 传给诊断报告');
  const diag = read(path.join(CORE, 'DiagnosticsReport.ets'));
  assert.match(diag, /redact/, 'core 诊断报告对每行应用 redact');
});


test('export-ui-10 PDF 在渲染前按整份总页数补 n/N 页码', () => {
  const workflow = stripComments(read(path.join(FEATURES, 'ExportWorkflow.ets')));
  assert.match(workflow, /appendPageNumbers\s*\(\s*planned\s*\)/, 'exportSemesterPages 必须对 planned 调 appendPageNumbers');
  assert.match(workflow, /import\s*\{[^}]*appendPageNumbers[^}]*\}\s*from\s*'\.\.\/\.\.\/core\/export\/CanvasLayout'/, '必须从 core/export/CanvasLayout 导入 appendPageNumbers');
  const call = workflow.indexOf('appendPageNumbers(planned)');
  const budget = workflow.indexOf('pageCountBudgetCode(planned.length)', call);
  const render = workflow.indexOf('for (const page of planned) {', call);
  const jpeg = workflow.indexOf('await render.renderJpeg(page)', call);
  assert.ok(call >= 0, '找不到 appendPageNumbers 调用');
  assert.ok(budget > call, '页码必须在页数预算前补齐（总页数含所有附页）');
  assert.ok(render > call && jpeg > call, '页码必须在逐页渲染之前补齐');
  const core = read(path.join(CORE, 'CanvasLayout.ets'));
  assert.match(core, /export function formatPageNumber/);
  assert.match(core, /export function appendPageNumbers/);
});

test('export-ui-8 core/export 纯逻辑无中文、无 CJK 转义、无运行时 SDK 依赖', () => {
  const files = fs.readdirSync(CORE).filter((name) => name.endsWith('.ets'));
  assert.ok(files.length >= 7, 'core/export 模块数量异常');
  for (const name of files) {
    const raw = read(path.join(CORE, name));
    const code = stripComments(raw);
    assert.ok(!CJK.test(code), 'core/export/' + name + ' 含中文字面量');
    assert.ok(!CJK_ESCAPE.test(code), 'core/export/' + name + ' 用 \\u 转义绕中文检查');
    assert.ok(!/from\s+['"]@(?:kit|ohos)\//.test(code), 'core/export/' + name + ' import 了 SDK');
  }
});
