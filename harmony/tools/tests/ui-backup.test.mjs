import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ets = path.join(root, 'entry', 'src', 'main', 'ets');
const read = (relative) => fs.readFileSync(path.join(ets, relative), 'utf8');
const index = read('pages/Index.ets');
const settings = read('pages/SettingsPage.ets');
const panel = read('features/export/ExportPanel.ets');
const workflow = read('features/export/ExportWorkflow.ets');
const host = read('platform/app/AppStateHost.ets');
const about = read('components/AboutCard.ets');
const resources = JSON.parse(fs.readFileSync(path.join(root, 'entry', 'src', 'main', 'resources', 'base', 'element', 'string.json'), 'utf8'));
const resourceNames = resources.string.map((item) => item.name);

function blockOf(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  if (start < 0) {
    return '';
  }
  const end = source.indexOf(endToken, start + startToken.length);
  return end > start ? source.slice(start, end) : source.slice(start);
}

test('恢复备份先校验再做变更 diff，写盘成功后才替换内存状态', () => {
  const block = blockOf(index, 'private async applyRestoredState(', 'private markChangeRead(');
  assert.ok(block.length > 0, 'applyRestoredState block missing');
  // demo 守卫改为「按备份的 demoMode 整体替换」，不再一律拒绝合法备份。
  assert.ok(block.includes('const wasDemo: boolean = AppStateHost.demoMode();'), 'demo snapshot missing');
  assert.ok(block.includes('const backupDemo: boolean = next.demoMode === true;'), 'backup demoMode missing');
  assert.ok(block.includes('next.demoMode = backupDemo;'), 'backup demoMode must win');
  assert.ok(!block.includes('if (AppStateHost.demoMode()) { return false; }'), 'old blanket demo guard must be gone');
  const validatePos = block.indexOf("if (validateRestoreState(next) !== '') { return false; }");
  const diffPos = block.indexOf('const fresh: ChangeRecord[] = diffState(base, next);');
  const recordsPos = block.indexOf('next.changeRecords = applyChangeRecords(next, fresh).changeRecords;');
  const savePos = block.indexOf('await AppStateHost.restore(next);');
  const prettyPos = block.indexOf('this.appState = AppStateHost.currentPretty();');
  for (const [name, pos] of [['validate', validatePos], ['diff', diffPos], ['changeRecords', recordsPos], ['save', savePos], ['currentPretty', prettyPos]]) {
    assert.ok(pos >= 0, name + ' missing');
  }
  assert.ok(validatePos < diffPos, 'validate must precede diff');
  assert.ok(diffPos < recordsPos, 'diff must precede changeRecords merge');
  assert.ok(recordsPos < savePos, 'changeRecords must be merged before save');
  assert.ok(savePos < prettyPos, 'memory state must be replaced after save');
  assert.ok(block.includes('try { await AppStateHost.restore(next); } catch (error) { return false; }'), 'restore save failure must return false');
  assert.ok(block.indexOf('this.selectedDate = this.todayKey;') > savePos, 'restored view state only after save');
  assert.ok(block.includes('return true;'));
});

test('教务读取成功路径在写盘前生成 changeRecords，且写盘后才替换内存状态', () => {
  const start = index.indexOf('private async readSchool(');
  assert.ok(start >= 0, 'readSchool missing');
  const block = index.slice(start);
  const diffPos = block.indexOf('const fresh: ChangeRecord[] = diffState(this.appState, next);');
  const recordsPos = block.indexOf('next.changeRecords = applyChangeRecords(next, fresh).changeRecords;');
  const savePos = block.indexOf('await AppStateHost.save(next);');
  const statePos = block.indexOf('this.appState = next;', savePos);
  assert.ok(diffPos >= 0 && recordsPos >= 0 && savePos >= 0 && statePos >= 0, 'readSchool wiring missing');
  assert.ok(diffPos < recordsPos, 'diff must precede changeRecords');
  assert.ok(recordsPos < savePos, 'changeRecords must precede save');
  assert.ok(savePos < statePos, 'state assignment must follow save');
  assert.ok(block.includes('if (!AppStateHost.demoMode()) {'), 'demo guard missing');
});

test('commitRestore 入口对伪造 preview 做纵深校验，非法不调用 apply', () => {
  const block = blockOf(workflow, 'async commitRestore(', '// 排查日志导出');
  assert.ok(block.length > 0, 'commitRestore block missing');
  const validatePos = block.indexOf('const code: string = validateRestoreState(preview.state);');
  const rejectPos = block.indexOf("if (code !== '') {");
  const applyPos = block.indexOf('await apply.apply(preview.state);');
  assert.ok(validatePos >= 0, 'validateRestoreState missing');
  assert.ok(rejectPos > validatePos, 'invalid state guard missing');
  assert.ok(applyPos > rejectPos, 'apply must run after validation');
  assert.ok(block.includes("return { ok: false, code, summary: '', leftDemo: false };"));
  assert.ok(block.includes('STATUS_RESTORE_SAVE_FAILED'), 'save stage code missing');
  assert.ok(block.includes('STATUS_RESTORE_APPLY_FAILED'), 'apply stage code missing');
  assert.ok(block.includes("logStageFailure('save'"), 'save stage must be logged');
  assert.ok(block.includes("logStageFailure('apply'"), 'apply stage must be logged');
  assert.ok(block.includes('leftDemo'), 'demo exit signal missing');
});

test('备份预览阶段复用同一校验，非法文件显示资源文案', () => {
  const block = blockOf(panel, 'private async restore(', 'private async commit(');
  assert.ok(block.length > 0, 'restore preview block missing');
  const validatePos = block.indexOf('const restoreCode: string = validateRestoreState(preview.state);');
  const dialogPos = block.indexOf('AlertDialog.show({');
  assert.ok(validatePos >= 0, 'preview validation missing');
  assert.ok(dialogPos > validatePos, 'validation must precede confirm dialog');
  const invalidBranch = block.slice(validatePos, dialogPos);
  assert.ok(invalidBranch.includes('this.restoreErrorCode = restoreCode;'));
  assert.ok(invalidBranch.includes('this.status = this.copy.panel.restoreFailed;'));
  assert.ok(invalidBranch.includes('this.noteFailure(restoreCode);'));
  assert.ok(!invalidBranch.includes("statusFailed + ' ' + restoreCode"), 'machine code must not be rendered');
  assert.ok(invalidBranch.includes('return;'), 'invalid preview must return before dialog');
  assert.ok(panel.includes('Text(fileErrorText(this.failureCode))'));
  assert.ok(panel.includes("Text($r('app.string.export_panel_restore_failed_hint'))"));
  assert.ok(panel.includes('this.restoreErrorCode = result.code;'));
  assert.equal(resourceNames.filter((name) => name === 'export_panel_restore_failed_hint').length, 1);
});

test('设置页版本号来自应用包信息，不显示硬编码 1.0.0，缺失时关于卡隐藏版本行', () => {
  assert.ok(!settings.includes('APP_VERSION_NAME'));
  assert.ok(!settings.includes('APP_VERSION_CODE'));
  assert.ok(!settings.includes("'1.0.0'"));
  assert.ok(settings.includes('@State appVersionName: string = \'\';'));
  assert.ok(settings.includes('@State appVersionCode: number = 0;'));
  assert.ok(settings.includes('this.appVersionName = AppStateHost.appVersionName();'));
  assert.ok(settings.includes('this.appVersionCode = AppStateHost.appVersionCode();'));
  assert.ok(settings.includes('appVersion: this.appVersionName,'));
  assert.ok(settings.includes('AboutCard({ versionName: this.appVersionName, versionCode: this.appVersionCode'));
  assert.ok(about.includes('this.versionName.length > 0 ? Visibility.Visible : Visibility.None'));
});

test('版本 API 只在 platform 层调用 bundleManager，失败兜底空值', () => {
  assert.ok(host.includes("import { bundleManager } from '@kit.AbilityKit';"));
  const nameBlock = blockOf(host, 'static appVersionName(): string {', 'static appVersionCode(): number {');
  assert.ok(nameBlock.includes('bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT)'));
  assert.ok(nameBlock.includes("typeof info.versionName === 'string' ? info.versionName : ''"));
  assert.ok(nameBlock.includes("return '';"));
  const codeBlock = blockOf(host, 'static appVersionCode(): number {', 'static async load(');
  assert.ok(codeBlock.includes("typeof info.versionCode === 'number' ? info.versionCode : 0"));
  assert.ok(codeBlock.includes('return 0;'));
  assert.ok(!index.includes('bundleManager'));
  assert.ok(!settings.includes('bundleManager'));
});

const coreTmp = process.env.HARMONY_CORE_TMP;

test('保存前后 diffState 生成 room 变更且未读为 1', { skip: coreTmp ? false : '需要 run-core-tests.mjs 提供的 HARMONY_CORE_TMP' }, async () => {
  const load = (relative) => import(pathToFileURL(path.join(coreTmp, relative)).href);
  const timetable = await load('core/timetable/TimetableCore.ts');
  const stateTypes = await load('core/types/AppState.ts');
  const custom = await load('core/custom/CustomScheduleService.ts');

  const prev = stateTypes.createDefaultState();
  prev.snapshot = {
    id: 'sem-room-diff',
    name: '房间变更学期',
    startDate: '2026-09-07',
    weeks: 1,
    source: { kind: 'school', label: '' },
    closedDates: [],
    remaps: [],
    exceptions: [],
    unscheduled: [],
    rules: [{
      id: 'r-room',
      name: '高等数学',
      teacher: '张老师',
      room: 'A101',
      dayOfWeek: 1,
      weekday: 1,
      startPeriod: 1,
      endPeriod: 2,
      periods: [1, 2],
      weeks: [1],
      startTime: '08:30',
      endTime: '09:55',
      cancelled: false,
      source: 'school'
    }]
  };
  const next = JSON.parse(JSON.stringify(prev));
  next.snapshot.rules[0].room = 'A999';

  const nowMs = Date.parse('2026-09-07T00:00:00+08:00');
  const fresh = timetable.diffState(prev, next, nowMs);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].type, 'room');
  assert.deepEqual(fresh[0].fields, ['room']);
  assert.ok(fresh[0].detail.includes('room=A999'));
  assert.equal(fresh[0].read, false);

  const applied = custom.applyChangeRecords(prev, fresh);
  assert.equal(applied.changeRecords.length, 1);
  assert.equal(applied.changeRecords[0].type, 'room');
  assert.equal(custom.countUnread(applied.changeRecords), 1);
  assert.equal(prev.snapshot.rules[0].room, 'A101');
  assert.equal(prev.changeRecords.length, 0);
});
