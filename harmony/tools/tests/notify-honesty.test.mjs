#!/usr/bin/env node
/**
 * 通知诚信化静态守护（第二轮）。
 *
 * 真机 r7 的教训是「查询被骗 + 按钮被 .enabled(false) 吃掉」，这类问题编译器不会报，
 * 只能靠在 CI 里盯住源码形状：不允许 already 短路、不允许按钮 disabled、
 * 不允许页面再退回静态假权限服务、必须保留发布探针与交叉验证。
 *
 * 只读源码文本，不 import .ets。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.HARMONY_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ETS = path.join(ROOT, 'entry/src/main/ets');

function read(rel) {
  return fs.readFileSync(path.join(ETS, rel), 'utf8');
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('通知网关不得保留 already 短路，必须保留发布探针与请求入口', () => {
  const code = stripComments(read('platform/system/NotificationKitGateway.ets'));
  assert.equal(code.includes("result: 'already'"), false, '不得再用 already 短路授权申请');
  assert.equal(code.includes('before.result ==='), false, '不得在申请前用查询结果提前返回');
  assert.ok(code.includes('requestEnableNotification'), '必须真调系统授权接口');
  assert.ok(code.includes('verifyByPublish'), '必须暴露发布探针作为真值');
  assert.ok(code.includes('notify-probe'), '探针结果必须留日志');
});

test('提醒网关必须接收通知真值参数，1700002 未超限不得甩锅成提醒能力问题', () => {
  const code = stripComments(read('platform/system/ReminderKitGateway.ets'));
  assert.ok(code.includes('notificationsVerifiedOn'), 'reconcile 必须接收通知真值');
  assert.ok(code.includes('classifyReminderFailure'), '失败归因必须走统一分类器');
  assert.ok(code.includes('REMINDER_NOTIFICATION_LIMIT'), '容量上限必须使用共享常量');
  assert.ok(code.includes('reminder-limit'), '容量超限必须留独立日志');
});

test('不可证⇔不声称：展示态只允许 unavailable/denied/unverified，设置入口无条件可用', () => {
  const state = stripComments(read('core/system/NotificationState.ets'));
  assert.ok(state.includes('notificationDisplayState'), '必须集中提供展示态映射，禁止页面各自解释');
  assert.ok(state.includes('classifyReminderFailure'), '提醒失败必须按「通知是否可证」归因');
  const gate = stripComments(read('core/system/ReminderGate.ets'));
  assert.ok(gate.includes('proceed-unverified'), '申请成功但不可证时必须走 proceed-unverified');
  assert.ok(gate.includes('NOTIFY_PERMISSION_UNVERIFIED'), '必须区分「无法确认」与「未授权」');
  const card = stripComments(read('features/system/SystemIntegrationCard.ets'));
  assert.ok(card.includes('system_action_notify_settings'), '设置入口必须始终存在');
  assert.equal(/\.enabled\s*\(/.test(card), false, '设置入口不得被状态禁用');
  assert.ok(card.includes('permission-entry'), '入口点击必须留日志');
  const index = stripComments(read('pages/Index.ets'));
  assert.ok(index.includes("return 'unverified'"), '首页通知状态不得回落到 granted/prompt');
});

test('权限卡片按钮不得被 disabled，点击入口必须留日志', () => {
  const code = stripComments(read('components/PermissionCard.ets'));
  assert.equal(code.includes('.enabled(!this.blocked'), false, '按钮不得因状态被禁用');
  assert.equal(code.includes('blocked('), false, '不得保留阻止点击的 blocked 判断');
  assert.ok(code.includes('permission-entry'), '点击入口必须打日志便于真机取证');
});

test('设置页权限卡仍收到通知/日历状态，且通知状态来自可验证来源', () => {
  const code = stripComments(read('pages/SettingsPage.ets'));
  assert.ok(code.includes('notificationState: this.permission'), '权限卡必须继续收到通知状态');
  assert.ok(code.includes('calendarState: this.calendarStatus'), '权限卡必须继续收到日历状态');
  const index = stripComments(read('pages/Index.ets'));
  assert.ok(index.includes('notificationView'), '通知状态必须来自通知网关的可验证视图');
});

test('首页权限入口必须走真实平台服务，不得再退回静态假实现', () => {
  const code = stripComments(read('pages/Index.ets'));
  assert.equal(code.includes('PermissionServiceUnavailable'), false, '不得 import 静态假权限服务');
  assert.ok(code.includes('SystemIntegrationService.enableNotifications'), '通知入口必须真调系统授权');
  assert.ok(code.includes('SystemIntegrationService.openNotificationSettings'), '申请无效必须能转通知设置');
  assert.ok(code.includes('refreshPermissionStates'), '页面显示必须有重新取证入口');
});

test('纯逻辑层必须保留交叉验证与 unverified 判定', () => {
  const code = stripComments(read('core/system/NotificationState.ets'));
  assert.ok(code.includes('crossCheckNotify'), '必须保留多路交叉验证');
  assert.ok(code.includes('unverified'), '必须保留无法确认状态');
  assert.ok(code.includes('probeFailureResult'), '必须能把探针失败码映射成状态');
});
