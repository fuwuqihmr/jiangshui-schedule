#!/usr/bin/env node
/**
 * 静态回归（无 SDK）：取消文案、[object Object]、示例模式双向确认、查看当天页签。
 * 只读源码与资源，不构建。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.HARMONY_ROOT || path.resolve(process.cwd());
const ETS = path.join(ROOT, 'entry/src/main/ets');
const RES = path.join(ROOT, 'entry/src/main/resources/base/element/string.json');

function read(rel) {
  return fs.readFileSync(path.join(ETS, rel), 'utf8');
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith('.ets')) {
      out.push(full);
    }
  }
}

test('ChangesPage 不再把 Resource 拼进 Text，未读标签先解成字符串', () => {
  const changes = read('pages/ChangesPage.ets');
  assert.ok(changes.includes("@State private unreadLabel: string = '';"), '需要 string 状态承接资源文案');
  assert.ok(changes.includes('this.unreadLabel = copy.changes.unread;'), 'refresh 时必须解出未读标签');
  assert.ok(changes.includes("Text(this.unreadLabel + ' ' + this.vm.unreadCount.toString())"), 'Text 只能拼接 string');
  assert.ok(!changes.includes("$r('app.string.change_unread').toString()"), '不得对 Resource 调 toString');

  const files = [];
  walk(ETS, files);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!/\$r\([^\n]*\)\.toString\(/.test(source), '禁止把 Resource 转成 [object Object]：' + file);
  }
});

test('ExportPanel 取消为中性文案，失败统一走 fileErrorText，机器码不直出', () => {
  const panel = read('features/export/ExportPanel.ets');
  assert.ok(panel.includes("import { fileErrorText } from '../../platform/files/FilePortMessages';"), '需要接入 fileErrorText');
  assert.ok(panel.includes('STATUS_CANCELLED'), '取消必须识别导出取消码');
  assert.ok(panel.includes('this.status = this.copy.panel.pickerCancelled;'), '取消显示中性的已取消文案');
  assert.ok(panel.includes('this.status = this.copy.panel.renderBudget;'), '渲染预算失败显示完整文案');
  assert.ok(panel.includes('this.status = this.copy.panel.renderFailed;'), '渲染失败显示完整文案');
  assert.ok(panel.includes('this.status = this.copy.panel.statusNoSemester;'), '无学期显示引导文案');
  assert.ok(panel.includes('this.failureCode = code;'), '失败码进 failureCode');
  assert.ok(panel.includes('this.noteFailure(preview.code);'), '预览失败记录机器码');
  assert.ok(panel.includes('this.noteFailure(restoreCode);'), '恢复校验失败只记录机器码');
  assert.ok(panel.includes('this.noteFailure(result.code);'), '提交失败记录机器码');
  assert.ok(panel.includes('Text(fileErrorText(this.failureCode))'), '失败文案由 fileErrorText 映射');
  assert.ok(!panel.includes("statusFailed + ' ' + result.code"), '不得直出 result.code');
  assert.ok(!panel.includes("statusFailed + ' ' + preview.code"), '不得直出 preview.code');
  assert.ok(!panel.includes("statusFailed + ' ' + restoreCode"), '不得直出 restoreCode');
});

test('示例模式 real→demo 与 demo→real 都要确认，确认后切到目标模式', () => {
  const card = read('components/DataSyncCard.ets');
  assert.ok(card.includes("@State private pendingMode: string = '';"), '需要记录待确认的目标模式');
  assert.ok(card.includes("const target: string = isOn ? 'demo' : 'real';"), '开关只决定目标模式');
  assert.ok(card.includes('this.pendingMode = target;'), '先进入待确认状态');
  assert.ok(card.includes("Text(this.pendingMode === 'real' ? $r('app.string.data_switch_real_confirm') : $r('app.string.data_switch_confirm'))"), '确认文案按方向切换');
  assert.ok(card.includes("Button(this.pendingMode === 'real' ? $r('app.string.data_switch_real') : $r('app.string.data_switch_demo_confirm'))"), '确认按钮按方向切换');
  assert.ok(card.includes('this.confirmReal();'), '切回真实需要独立确认动作');
  assert.ok(card.includes('this.confirmDemo();'), '切到示例保留原确认动作');
  assert.ok(card.includes("this.onModeChange('real');"), '确认后才切换真实模式');
  assert.ok(card.includes("this.onModeChange('demo');"), '确认后才切换示例模式');

  const strings = JSON.parse(fs.readFileSync(RES, 'utf8')).string;
  const value = (name) => {
    const found = strings.find((entry) => entry.name === name);
    assert.ok(found, '缺少资源键 ' + name);
    return found.value;
  };
  assert.equal(value('data_switch_real'), '切换到真实数据');
  assert.ok(value('data_switch_real_confirm').length > 0, '切回真实确认文案不能为空');
});

test('查看当天会把 Tabs 页签切回今日课表', () => {
  const index = read('pages/Index.ets');
  assert.ok(index.includes('Tabs({ barPosition: BarPosition.End, index: this.activeTab })'), 'Tabs 必须绑定 activeTab');
  assert.ok(index.includes('this.selectedDate = date; this.activeTab = 0;'), '查看当天必须同时切到今日页签');
  assert.ok(index.includes('.onChange((index: number) => { this.activeTab = index; })'), '手工切页签仍要同步 activeTab');
});
