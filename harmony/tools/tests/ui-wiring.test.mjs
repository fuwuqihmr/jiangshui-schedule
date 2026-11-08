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

test('Index 装配 CustomStateController，并在首次进入与返回时重置', () => {
  assert.match(index, /import \{ CustomStateController \} from '\.\.\/features\/custom\/CustomStateController';/);
  assert.ok(index.includes('private customController: CustomStateController = new CustomStateController();'));
  // applyRestoredState 恢复备份后也 reset 一次，共 4 处（aboutToAppear/onPageShow/恢复/首屏）。
  assert.equal((index.match(/this\.customController\.reset\(this\.appState\);/g) || []).length, 4);
  assert.match(index, /async onPageShow\(\): Promise<void>/);
  assert.ok(index.includes('await AppStateHost.load();'));
  assert.ok(index.includes('this.appState = AppStateHost.currentPretty();'));
});

test('Index 把 7 个 custom 回调与撤销状态传入 SettingsPage', () => {
  assert.ok(index.includes('customCanUndo: this.customController.canUndoNow(),'));
  assert.ok(index.includes('customCanRedo: this.customController.canRedoNow(),'));
  for (const callback of [
    'onSaveCustomCourse: (course: CustomCourse) => this.saveCustomCourse(course),',
    'onDeleteCustomCourse: (id: string) => this.removeCustomCourse(id),',
    'onDeleteCustomMap: (id: string) => this.removeCustomMap(id),',
    'onDeleteCustomHoliday: (date: string) => this.removeCustomHoliday(date),',
    'onUndoCustom: () => this.undoCustom(),',
    'onRedoCustom: () => this.redoCustom(),',
    'onToggleEveningStudy: (on: boolean) => this.toggleEveningStudy(on),'
  ]) {
    assert.ok(index.includes(callback), 'missing ' + callback);
  }
});

test('SettingsPage 内联渲染三个 custom 组件并引用晚自习/自定义课程资源', () => {
  for (const component of ['CustomSchedulePanel', 'CustomCourseSheet', 'TodayOverviewCard']) {
    assert.ok(settings.includes("import { " + component + " } from '../features/custom/" + component + "';"), 'missing import ' + component);
  }
  assert.ok(settings.includes('TodayOverviewCard({ state: this.appState, leaveRecords: this.leaveRecords, todayKey: this.todayKey'));
  assert.ok(settings.includes('CustomSchedulePanel({'));
  assert.ok(settings.includes('CustomCourseSheet({'));
  assert.ok(settings.includes("Text($r('app.string.settings_course_study'))"));
  assert.ok(settings.includes("Button($r('app.string.settings_course_custom'))"));
  assert.ok(settings.includes('.enabled(!this.demoMode)'));
  assert.ok(settings.includes('customPanelVisible'));
  assert.ok(settings.includes('customSheetVisible'));
});

test('custom 文件都由其他文件 import，全部可达', () => {
  const dir = path.join(ets, 'features', 'custom');
  const customFiles = fs.readdirSync(dir).filter((name) => name.endsWith('.ets'));
  // 新增 5 个表单组件（CustomFormLogic、CustomFormErrorText、LocalMapSheet、
  // HolidayDaySheet、DayOverrideSheet）后共 10 个；数量钉死用于防孤儿文件。
  assert.equal(customFiles.length, 10);
  const allEts = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); }
      else if (entry.name.endsWith('.ets')) { allEts.push(full); }
    }
  };
  walk(ets);
  for (const file of customFiles) {
    const base = file.replace(/\.ets$/, '');
    const referenced = allEts.some((candidate) => {
      if (path.resolve(candidate) === path.resolve(path.join(dir, file))) { return false; }
      const source = fs.readFileSync(candidate, 'utf8');
      return new RegExp("from\\s+['\"][^'\"]*" + base + "['\"]").test(source);
    });
    assert.ok(referenced, 'orphan custom file: ' + file);
  }
});

test('接线 export/system：SettingsPage 接 ExportPanel 与 SystemIntegrationCard，main_pages 未新增自定义路由', () => {
  for (const source of [index, settings]) {
    assert.ok(!source.includes('platform/files'));
  }
  assert.ok(settings.includes('features/export/ExportPanel'), 'SettingsPage 必须接线 features/export 入口');
  assert.ok(settings.includes('features/system/SystemIntegrationCard'), 'SettingsPage 必须接线 features/system 入口');
  assert.ok(index.includes('features/system') || settings.includes('features/system'), 'Index.ets 或 SettingsPage 至少一处 import 了 features/system');
  const mainPages = JSON.parse(fs.readFileSync(path.join(root, 'entry', 'src', 'main', 'resources', 'base', 'profile', 'main_pages.json'), 'utf8'));
  assert.ok(Array.isArray(mainPages.src));
  assert.ok(mainPages.src.includes('pages/Index'));
  assert.ok(!mainPages.src.some((item) => item.includes('custom')));
});

test('custom 写操作先检查 demo 模式，成功后刷新页面状态', () => {
  assert.ok((index.match(/if \(AppStateHost\.demoMode\(\)\) \{ return; \}/g) || []).length >= 7);
  for (const call of ['saveCourse', 'removeCourse', 'removeLocalMap', 'removeHoliday', 'undo', 'redo', 'changeEveningStudy']) {
    assert.ok(index.includes('await this.customController.' + call + '('), 'missing controller call ' + call);
  }
  assert.ok(index.includes('this.refreshCustomState();'));
});
