import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ets = path.join(root, 'entry', 'src', 'main', 'ets');
const read = (relative) => fs.readFileSync(path.join(ets, relative), 'utf8');
const index = read('pages/Index.ets');
const settings = read('pages/SettingsPage.ets');
const stringResource = JSON.parse(fs.readFileSync(path.join(root, 'entry', 'src', 'main', 'resources', 'base', 'element', 'string.json'), 'utf8'));

test('export 接线使用 features/files 端口，不绕过 features 直接依赖 platform/files', () => {
  assert.ok(settings.includes("import { createExportFilePorts, unavailableExportFilePorts } from '../features/files/ExportFilePorts';"));
  assert.ok(settings.includes("import type { ExportFilePortSet } from '../features/files/ExportFilePorts';"));
  assert.ok(!settings.includes('platform/files'));
  assert.ok(!index.includes('platform/files'));
  assert.ok(settings.includes('private exportPorts: ExportFilePortSet = unavailableExportFilePorts();'));
  assert.ok(settings.includes('this.exportPorts = createExportFilePorts(getContext(this));'));
  assert.ok(settings.includes('saver: this.exportPorts.saver,'));
  assert.ok(settings.includes('picker: this.exportPorts.picker,'));
  assert.ok(settings.includes('onApplyState: (next: AppState) => this.onApplyRestoredState(next)'));
});

test('设置页同时装配 SystemIntegrationCard，appState 变化刷新导出诊断', () => {
  assert.ok(settings.includes("import { SystemIntegrationCard } from '../features/system/SystemIntegrationCard';"));
  assert.ok(settings.includes('SystemIntegrationCard({ state: this.appState })'));
  assert.ok(settings.includes("@Prop @Watch('refreshExportDiagnostics') appState: AppState"));
  assert.ok(settings.includes('this.diagnostics = this.buildDiagnostics();'));
  assert.ok(settings.includes('this.exportCopy = buildExportCopy'));
});

test('备份恢复先写盘再替换内存状态，demo 语义由备份决定且同步自定义/请假视图', () => {
  const start = index.indexOf('private async applyRestoredState(');
  const end = index.indexOf('private markChangeRead(', start);
  assert.ok(start >= 0 && end > start, 'applyRestoredState block missing');
  const block = index.slice(start, end);
  assert.ok(block.includes('const backupDemo: boolean = next.demoMode === true;'));
  assert.ok(block.includes('next.demoMode = backupDemo;'));
  assert.ok(block.includes('await AppStateHost.restore(next);'));
  assert.ok(block.includes('this.appState = AppStateHost.currentPretty();'));
  assert.ok(block.indexOf('await AppStateHost.restore(next);') < block.indexOf('this.appState = AppStateHost.currentPretty();'));
  assert.ok(block.includes('this.selectedDate = this.todayKey;'));
  assert.ok(block.includes('this.leaveRecords = this.leaveCache().records;'));
  assert.ok(block.includes('this.customController.reset(this.appState);'));
  assert.ok(block.includes('return true;'));
  assert.ok(index.includes('onApplyRestoredState: (next: AppState) => this.applyRestoredState(next)'));
});

test('页面不直接 import @kit/@ohos，导出/系统能力只经 features 装配', () => {
  for (const source of [index, settings]) {
    assert.ok(!source.includes('@ohos'));
    assert.ok(!source.includes('@kit.'));
  }
  assert.ok(settings.includes("import { resolveDay } from '../core/timetable/TimetableCore';"));
  assert.ok(settings.includes("import { redactText } from '../util/Redactor';"));
});

test('新增 custom 资源键已合并，strict 下无缺失键', () => {
  const names = new Set(stringResource.string.map((item) => item.name));
  for (const key of ['custom_action_add', 'custom_section_override', 'custom_override_sheet_title_add', 'custom_holiday_sheet_title_add', 'custom_map_sheet_title_add', 'custom_error_override_base_required']) {
    assert.ok(names.has(key), 'missing resource ' + key);
  }
  assert.equal(new Set(stringResource.string.map((item) => item.name)).size, stringResource.string.length, 'duplicate resource keys');
});

test('ui-wiring 的临时约束已按授权翻转，旧 platform/files 断言仍保留', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'tests', 'ui-wiring.test.mjs'), 'utf8');
  assert.ok(source.includes("assert.ok(!source.includes('platform/files'));"));
  assert.ok(source.includes("assert.ok(settings.includes('features/export/ExportPanel')"));
  assert.ok(source.includes("assert.ok(settings.includes('features/system/SystemIntegrationCard')"));
});

test('父页面接通调课/休假/单日修改表单回调，写入口先查 demo 模式', () => {
  for (const type of ['DayOverride', 'HolidayDay', 'LocalMapRule']) {
    assert.ok(settings.includes(type), 'SettingsPage 缺类型 ' + type);
  }
  for (const callback of ['onSaveCustomMap', 'onSaveCustomHoliday', 'onSaveCustomOverride', 'onDeleteCustomOverride']) {
    assert.ok(settings.includes(callback + ':'), 'SettingsPage 缺回调 ' + callback);
    assert.ok(index.includes(callback + ':'), 'Index 未传 ' + callback);
  }
  for (const method of ['saveCustomMap', 'saveCustomHoliday', 'saveCustomOverride', 'removeCustomOverride']) {
    const start = index.indexOf('private async ' + method + '(');
    assert.ok(start >= 0, 'Index 缺 ' + method);
    const body = index.slice(start, start + 420);
    assert.ok(body.includes('if (AppStateHost.demoMode()) { return; }'), method + ' 未先查 demo');
  }
  for (const call of ['saveLocalMap', 'addHoliday', 'saveOverride', 'removeOverride']) {
    assert.ok(index.includes('await this.customController.' + call + '('), 'Index 未调用 controller.' + call);
  }
  assert.ok(settings.includes('onSubmitMap: (rule: LocalMapRule) => { this.submitCustomMap(rule); }'));
  assert.ok(settings.includes('onSubmitHoliday: (day: HolidayDay) => { this.submitCustomHoliday(day); }'));
  assert.ok(settings.includes('onSubmitOverride: (item: DayOverride) => { this.submitCustomOverride(item); }'));
  assert.ok(settings.includes('onDeleteOverride: (id: string) => { this.deleteCustomOverride(id); }'));
});

