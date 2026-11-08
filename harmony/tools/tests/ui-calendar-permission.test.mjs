#!/usr/bin/env node
/**
 * 静态与纯逻辑守护：
 * 1) 日历展示只有「能力可用 + 授权已知」才可能显示已开启，未知一律 unavailable；
 * 2) 上课提醒的通知失败使用「无法确认」口径，且不改变既有 NOTIFY_PERMISSION_REQUIRED 稳定码；
 * 3) unverified 态点「开启通知权限」先留痕并给可见反馈，再触发真实申请。
 *
 * 只读源码 + 复制纯逻辑模块到临时 .ts 后 import，不依赖 HarmonyOS SDK。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ETS = path.join(ROOT, 'entry/src/main/ets');
const RES = path.join(ROOT, 'entry/src/main/resources/base/element/string.json');
const REQUESTS = path.join(ROOT, 'tools/resource-requests');

function read(rel) {
  return fs.readFileSync(path.join(ETS, rel), 'utf8');
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('calendarDisplayState: 能力不可用或授权未知一律 unavailable，不出现未知→已开启', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'harmony-calendar-display-'));
  const from = path.join(ETS, 'features/system/CalendarDisplay.ets');
  const to = path.join(sandbox, 'CalendarDisplay.ts');
  fs.copyFileSync(from, to);
  const mod = await import(pathToFileURL(to).href);
  assert.equal(mod.calendarDisplayState(false, 'granted'), 'unavailable');
  assert.equal(mod.calendarDisplayState(false, 'prompt'), 'unavailable');
  assert.equal(mod.calendarDisplayState(true, 'granted'), 'granted');
  assert.equal(mod.calendarDisplayState(true, 'prompt'), 'prompt');
  assert.equal(mod.calendarDisplayState(true, 'weird'), 'unavailable');
  assert.equal(mod.calendarDisplayState(true, ''), 'unavailable');
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('PermissionCard 日历行不再直接吃页面 calendarState，改用能力+授权视图', () => {
  const code = stripComments(read('components/PermissionCard.ets'));
  assert.ok(code.includes('SystemIntegrationService.calendarView'), '必须读取日历能力/授权视图');
  assert.ok(code.includes('calendarStateForDisplay'), '必须集中归一显示态');
  assert.ok(code.includes("this.permissionRow('calendar', $r('app.string.permission_calendar'), this.calendarStateForDisplay()"), '日历行必须使用归一后的状态');
  assert.equal(code.includes("this.permissionRow('calendar', $r('app.string.permission_calendar'), this.calendarState,"), false, '日历行不得直接使用页面传入的 calendarState');
  assert.equal(code.includes("this.calendarState === 'granted'"), false, '不得把页面状态直接当已开启');
});

test('SystemIntegrationService: loadStatus 与 calendarView 共用同一能力判定', () => {
  const code = stripComments(read('features/system/SystemIntegrationService.ets'));
  assert.ok(code.includes('calendarDisplayState(calendarStatus.available, permissionSnapshot.calendar)'), 'loadStatus 必须按能力收口');
  assert.ok(code.includes('static async calendarView'), '必须提供权限卡可用的日历视图');
  assert.ok(code.includes('calendarDisplayState(status.available, snapshot.calendar)'), 'calendarView 必须同样收口');
  assert.ok(code.includes("permission: 'unavailable'"), '查询失败必须降级 unavailable');
});

test('上课提醒通知失败改为无法确认口径，稳定码不变', () => {
  const code = stripComments(read('features/system/SystemIntegrationCard.ets'));
  const reminder = code.indexOf("scope === 'reminder'");
  const generic = code.indexOf("code === 'NOTIFY_PERMISSION_REQUIRED'");
  assert.ok(reminder >= 0, '必须有 reminder 来源分支');
  assert.ok(generic > reminder, 'reminder 分支必须早于通用通知未开启文案');
  assert.ok(code.includes('system_error_reminder_notify_unverified'), '必须使用指定的无法确认文案');
  assert.ok(code.includes('errorLabel(view.code, view.scope)'), 'apply 必须透传来源');
  const service = stripComments(read('features/system/SystemIntegrationService.ets'));
  assert.ok(service.includes("failure(decision.code, 'reminder')"), '提醒失败必须带 reminder 来源');
  assert.ok(service.includes("if (result.error !== '')"), '既有稳定码透传逻辑必须保留');
  assert.ok(service.includes('view.code = result.error'), '既有稳定码透传逻辑必须保留');
});

test('unverified 点开启通知：先日志与可见反馈，再真实调用申请', () => {
  const card = stripComments(read('features/system/SystemIntegrationCard.ets'));
  const logAt = card.indexOf("console.info('permission-request kind=notification entry=integration-card state=");
  const feedbackAt = card.indexOf('system_feedback_notify_requesting');
  const callAt = card.indexOf('SystemIntegrationService.enableNotifications');
  assert.ok(logAt >= 0, '点击必须留 permission-request 日志');
  assert.ok(feedbackAt >= 0, '点击必须立即给可见反馈');
  assert.ok(callAt > logAt && callAt > feedbackAt, '反馈/日志必须先于异步申请调用');
  const service = stripComments(read('features/system/SystemIntegrationService.ets'));
  assert.ok(service.indexOf("console.info('notify-enable requested=1 source=integration-card')") < service.indexOf('await gateway.requestEnable()'), '进入系统申请前必须留 notify-enable 日志');
});

test('新文案只登记在 harmony-ui.json 请求文件，键唯一', () => {
  const ui = readJson(path.join(REQUESTS, 'harmony-ui.json'));
  assert.equal(ui.system_error_reminder_notify_unverified, '上课提醒写入失败，可能是通知未允许，请到系统设置确认通知开关');
  assert.equal(ui.system_feedback_notify_requesting, '正在申请通知权限，请稍候…');
  const all = fs.readdirSync(REQUESTS).filter((name) => name.endsWith('.json'));
  for (const name of all) {
    const data = readJson(path.join(REQUESTS, name));
    for (const key of ['system_error_reminder_notify_unverified', 'system_feedback_notify_requesting']) {
      const owners = all.filter((other) => {
        const candidate = readJson(path.join(REQUESTS, other));
        return Object.prototype.hasOwnProperty.call(candidate, key);
      });
      assert.equal(owners.length, 1, key + ' 只能在一个请求文件中登记，实际：' + owners.join(','));
    }
  }
  // 仅检查请求文件已登记；不要求当前 string.json 已合并，合并由 lead 统一执行。
  const strings = readJson(RES);
  assert.ok(Array.isArray(strings.string), 'string.json 结构必须保持');
});
