import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const harmonyRoot = process.env.HARMONY_ROOT;
if (!harmonyRoot) throw new Error('HARMONY_ROOT 未设置，请用 run-core-tests.mjs 运行');
const etsRoot = path.join(harmonyRoot, 'entry/src/main/ets');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'harmony-system-gateway-'));

function writeFile(rel, text) {
  const full = path.join(sandbox, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function copySource(rel) {
  const from = path.join(etsRoot, rel);
  const to = path.join(sandbox, rel.slice(0, -4) + '.ts');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function rewriteImports(file) {
  let text = fs.readFileSync(file, 'utf8');
  text = text.replace(/(from\s*['"])(\.{1,2}\/[^'"]+)(['"])/g, (whole, pre, spec, post) => {
    let next = spec;
    if (next.endsWith('.ets')) {
      next = next.slice(0, -4) + '.ts';
    } else if (!next.endsWith('.ts')) {
      const abs = path.resolve(path.dirname(file), next);
      if (fs.existsSync(abs + '.ts')) next = next + '.ts';
    }
    return pre + next + post;
  });
  fs.writeFileSync(file, text);
}

copySource('features/system/SystemIntegrationService.ets');
copySource('features/system/CalendarDisplay.ets');
copySource('core/system/CalendarPlanner.ets');
copySource('core/system/ReminderPlanner.ets');
copySource('core/system/UnreadSummary.ets');
copySource('core/system/ReminderGate.ets');
copySource('core/system/NotificationState.ets');

writeFile('core/types/Common.ts', [
  'export const ErrorCode = {',
  "  CALENDAR_WRITE_FAILED: 'CALENDAR_WRITE_FAILED',",
  "  CALENDAR_UNAVAILABLE: 'CALENDAR_UNAVAILABLE',",
  "  REMINDER_UNAVAILABLE: 'REMINDER_UNAVAILABLE',",
  "  NOTIFY_UNAVAILABLE: 'NOTIFY_UNAVAILABLE',",
  "  PREFERENCES_UNAVAILABLE: 'PREFERENCES_UNAVAILABLE',",
  "  BACKGROUND_UNAVAILABLE: 'BACKGROUND_UNAVAILABLE',",
  "  PERMISSION_DENIED: 'PERMISSION_DENIED',",
  "  PERMISSION_UNAVAILABLE: 'PERMISSION_UNAVAILABLE'",
  '};',
  ''
].join('\n'));

writeFile('core/timetable/TimetableCore.ts', [
  'export function addDays(date, days) {',
  "  const parts = date.split('-');",
  '  const base = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + days);',
  "  const pad = (n) => (n < 10 ? '0' + n : String(n));",
  "  return base.getFullYear() + '-' + pad(base.getMonth() + 1) + '-' + pad(base.getDate());",
  '}',
  'export function resolveDay(_state, date) {',
  '  const fake = globalThis.__RESOLVE_FAKE__;',
  '  return fake ? fake(date) : [];',
  '}',
  ''
].join('\n'));

writeFile('platform/system/CalendarKitGateway.ts', [
  'export class CalendarKitGateway {',
  '  constructor(_context) {}',
  '  async sync(_request) {',
  '    const fake = globalThis.__CALENDAR_GATEWAY_FAKE__;',
  "    if (!fake || fake.throwNow === true) throw new Error('gateway down');",
  '    return fake.syncResult;',
  '  }',
  '  async remove() {',
  '    const fake = globalThis.__CALENDAR_GATEWAY_FAKE__;',
  "    if (!fake || fake.throwNow === true) throw new Error('gateway down');",
  '    return fake.removeResult;',
  '  }',
  '  async status() { return { available: true }; }',
  '}',
  ''
].join('\n'));

writeFile('platform/system/ReminderKitGateway.ts', [
  'export class ReminderKitGateway {',
  '  constructor(_context) {}',
  '  async clear() { return true; }',
  '  async reconcile(_targets, _verified) {',
  '    globalThis.__REMINDER_VERIFIED__ = _verified;',
  '    const fake = globalThis.__REMINDER_FAKE__;',
  '    if (!fake) return { written: 0, failed: 0, error: "" };',
  '    return fake;',
  '  }',
  '  async status() { return { count: 0, permission: "none" }; }',
  '}',
  ''
].join('\n'));

writeFile('platform/system/BackgroundScheduler.ts', [
  'export class BackgroundScheduler {',
  '  constructor(_context) {}',
  '  async start() { return { started: true, error: "" }; }',
  '  async stop() { return { available: true }; }',
  '  async status() { return { started: false }; }',
  '}',
  ''
].join('\n'));

writeFile('platform/system/NotificationKitGateway.ts', [
  'export class NotificationKitGateway {',
  '  constructor(_context) {}',
  '  async status() { return globalThis.__NOTIFY_FAKE__.status; }',
  '  async requestEnable() {',
  '    globalThis.__NOTIFY_CALLS__ = (globalThis.__NOTIFY_CALLS__ || 0) + 1;',
  '    return globalThis.__NOTIFY_FAKE__.request;',
  '  }',
  '  async openSettings() { return globalThis.__NOTIFY_FAKE__.settings; }',
  '  async syncBadge() { return 0; }',
  '  async publish() { return true; }',
  '}',
  ''
].join('\n'));

writeFile('platform/system/SystemPermissionService.ts', [
  'export class SystemPermissionService {',
  '  constructor(_context) {}',
  '  async status() { return { calendar: "granted", notification: "granted", background: "granted" }; }',
  '  async requestCalendar() { return { granted: true }; }',
  '  async requestNotification() { return { granted: true }; }',
  '  async openSystemSettings(_kind) {',
  '    if (globalThis.__SETTINGS_FAKE__ === "throw") throw new Error("settings down");',
  '    return;',
  '  }',
  '}',
  ''
].join('\n'));

writeFile('platform/system/SystemCacheStore.ts', [
  'export class SystemCacheStore {',
  '  constructor(_context) {}',
  '  async read() { return null; }',
  '  async write() { return true; }',
  '}',
  ''
].join('\n'));

for (const rel of [
  'features/system/SystemIntegrationService.ts',
  'core/system/CalendarPlanner.ts',
  'core/system/ReminderPlanner.ts',
  'core/system/UnreadSummary.ts',
  'core/system/ReminderGate.ts',
  'core/system/NotificationState.ts'
]) {
  rewriteImports(path.join(sandbox, rel));
}

const { SystemIntegrationService } = await import(
  pathToFileURL(path.join(sandbox, 'features/system/SystemIntegrationService.ts')).href
);

const state = {
  version: 3,
  snapshot: {
    id: 's1',
    name: 'semester',
    startDate: '2026-08-31',
    weeks: 1,
    rules: [],
    source: { kind: 'school', label: 'school' }
  },
  calendarOptions: { school: true, custom: true, study: true },
  changeRecords: [],
  customCourses: [],
  overrides: [],
  localMaps: [],
  holidaySettings: null,
  classReminders: { enabled: false, leadMinutes: 30 }
};

function setFake(fake) {
  globalThis.__CALENDAR_GATEWAY_FAKE__ = fake;
}

// 通知平台假实现：默认「已授权」。每个用例显式设置，避免默认值掩盖谎报。
function setNotifyFake(fake) {
  globalThis.__NOTIFY_FAKE__ = fake;
}

function notifyFake(over) {
  return Object.assign({
    status: { enabled: true, permission: 'granted', error: '', verified: true, source: 'notificationSetting' },
    request: { result: 'already', code: '' },
    settings: { opened: true, enabled: true, verified: true, code: '' }
  }, over || {});
}

function setReminderFake(fake) {
  globalThis.__REMINDER_FAKE__ = fake;
}

function tomorrow() {
  return addDaysText(dateText(new Date()), 1);
}

function dateText(value) {
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate());
}

function addDaysText(date, days) {
  const parts = date.split('-');
  return dateText(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + days));
}

// 只给「明天」一门课，保证提醒触发时刻总在未来 8 天内。
function setResolveRows() {
  const target = tomorrow();
  globalThis.__RESOLVE_FAKE__ = (date) => (date === target ? [{
    key: 'c1',
    name: 'Math',
    teacher: 'T1',
    room: 'A101',
    startTime: '08:00',
    endTime: '09:35',
    cancelled: false,
    vacant: false
  }] : []);
}

setNotifyFake(notifyFake());
setReminderFake({ written: 0, failed: 0, error: '' });
setResolveRows();

function result(over) {
  return Object.assign({ ok: false, written: 0, deleted: 0, failed: 0, skipped: 0 }, over || {});
}

test('writeCalendar: 网关 ok=false 且 failed=0 必须失败并保留计数', async () => {
  setFake({ syncResult: result({ skipped: 1 }), removeResult: result({ ok: true }) });
  const view = await SystemIntegrationService.writeCalendar({}, state);
  assert.equal(view.ok, false);
  assert.equal(view.code, 'CALENDAR_WRITE_FAILED');
  assert.equal(view.written, 0);
  assert.equal(view.deleted, 0);
  assert.equal(view.failed, 0);
});

test('writeCalendar: 网关 ok=false 且 failed>0 必须失败', async () => {
  setFake({ syncResult: result({ failed: 2 }), removeResult: result({ ok: true }) });
  const view = await SystemIntegrationService.writeCalendar({}, state);
  assert.equal(view.ok, false);
  assert.equal(view.code, 'CALENDAR_WRITE_FAILED');
  assert.equal(view.failed, 2);
});

test('writeCalendar: 网关 ok=true 不得误报失败', async () => {
  setFake({ syncResult: result({ ok: true, written: 2, deleted: 1 }), removeResult: result({ ok: true }) });
  const view = await SystemIntegrationService.writeCalendar({}, state);
  assert.equal(view.ok, true);
  assert.equal(view.code, '');
  assert.equal(view.written, 2);
  assert.equal(view.deleted, 1);
});

test('removeCalendar: 网关 ok=false 必须失败并保留计数', async () => {
  setFake({ syncResult: result({ ok: true }), removeResult: result({ failed: 3 }) });
  const view = await SystemIntegrationService.removeCalendar({});
  assert.equal(view.ok, false);
  assert.equal(view.code, 'CALENDAR_WRITE_FAILED');
  assert.equal(view.failed, 3);
});

test('removeCalendar: 网关 ok=true 不得误报失败', async () => {
  setFake({ syncResult: result({ ok: true }), removeResult: result({ ok: true, deleted: 4 }) });
  const view = await SystemIntegrationService.removeCalendar({});
  assert.equal(view.ok, true);
  assert.equal(view.code, '');
  assert.equal(view.deleted, 4);
});

test('writeCalendar: 网关抛错返回 CALENDAR_UNAVAILABLE', async () => {
  setFake({ throwNow: true });
  const view = await SystemIntegrationService.writeCalendar({}, state);
  assert.equal(view.ok, false);
  assert.equal(view.code, 'CALENDAR_UNAVAILABLE');
});

// ---- 通知状态与失败码不得谎报 ----

function remindersOn() {
  return Object.assign({}, state, { classReminders: { enabled: true, leadMinutes: 30 } });
}

test('loadStatus: 查询不到不可证证据时显示 unverified，不显示待授权/已开启', async () => {
  setNotifyFake(notifyFake({
    status: { enabled: false, permission: 'prompt', error: '', verified: false, source: 'notificationSetting:isNotificationEnabled' }
  }));
  const view = await SystemIntegrationService.loadStatus({}, state);
  assert.equal(view.notificationPermission, 'unverified');
  assert.equal(view.notificationEnabled, false);
  assert.equal(view.notificationVerified, false);
});

test('loadStatus: 即使网关报 granted/verified 也不得显示已开启；查询失败显示 unavailable', async () => {
  setNotifyFake(notifyFake({
    status: { enabled: true, permission: 'granted', error: '', verified: true, source: 'notificationSetting' }
  }));
  const granted = await SystemIntegrationService.loadStatus({}, state);
  assert.equal(granted.notificationPermission, 'unverified');
  assert.equal(granted.notificationEnabled, false);
  assert.equal(granted.notificationVerified, false);

  setNotifyFake(notifyFake({
    status: { enabled: false, permission: 'unavailable', error: 'NOTIFY_UNAVAILABLE', verified: false, source: 'notificationSetting:1600001' }
  }));
  const failed = await SystemIntegrationService.loadStatus({}, state);
  assert.equal(failed.notificationPermission, 'unavailable');
  assert.equal(failed.notificationEnabled, false);
});

test('applyReminders: 通知未开且申请被拒 → NOTIFY_PERMISSION_REQUIRED（不是 REMINDER_UNAVAILABLE）', async () => {
  setNotifyFake(notifyFake({
    status: { enabled: false, permission: 'prompt', error: '', verified: true, source: 'notificationSetting' },
    request: { result: 'denied', code: '1600004' }
  }));
  const view = await SystemIntegrationService.applyReminders({}, remindersOn());
  assert.equal(view.ok, false);
  assert.equal(view.code, 'NOTIFY_PERMISSION_REQUIRED');
});

test('applyReminders: 申请时平台异常 → NOTIFY_UNAVAILABLE', async () => {
  setNotifyFake(notifyFake({
    status: { enabled: false, permission: 'prompt', error: '', verified: true, source: 'notificationSetting' },
    request: { result: 'failed', code: '1600001' }
  }));
  const view = await SystemIntegrationService.applyReminders({}, remindersOn());
  assert.equal(view.ok, false);
  assert.equal(view.code, 'NOTIFY_UNAVAILABLE');
});

test('applyReminders: 查询失败直接 NOTIFY_UNAVAILABLE，不尝试登记', async () => {
  setNotifyFake(notifyFake({
    status: { enabled: false, permission: 'unavailable', error: 'NOTIFY_UNAVAILABLE', verified: false, source: 'notificationSetting:1600001' }
  }));
  const view = await SystemIntegrationService.applyReminders({}, remindersOn());
  assert.equal(view.ok, false);
  assert.equal(view.code, 'NOTIFY_UNAVAILABLE');
});

test('applyReminders: 申请成功也不声称已开启（proceed-unverified），仍正常登记并保留计数', async () => {
  setNotifyFake(notifyFake({
    status: { enabled: true, permission: 'granted', error: '', verified: true, source: 'notificationSetting' },
    request: { result: 'granted', code: '' }
  }));
  setReminderFake({ written: 1, failed: 0, error: '' });
  globalThis.__REMINDER_VERIFIED__ = null;
  const view = await SystemIntegrationService.applyReminders({}, remindersOn());
  assert.equal(view.ok, true);
  assert.equal(view.code, '');
  assert.equal(view.written, 1);
  // 通知真值不可证：第二参数必须为 false，提醒网关不得被误导为「已开启」。
  assert.equal(globalThis.__REMINDER_VERIFIED__, false);
});

test('applyReminders: 提醒网关报通知未开时透传 NOTIFY_PERMISSION_REQUIRED', async () => {
  setNotifyFake(notifyFake({
    status: { enabled: true, permission: 'granted', error: '', verified: true, source: 'notificationSetting' }
  }));
  setReminderFake({ written: 0, failed: 1, error: 'NOTIFY_PERMISSION_REQUIRED' });
  const view = await SystemIntegrationService.applyReminders({}, remindersOn());
  assert.equal(view.ok, false);
  assert.equal(view.code, 'NOTIFY_PERMISSION_REQUIRED');
  assert.equal(view.failed, 1);
});

test('enableNotifications: 系统不再弹框/未生效 → NOTIFY_PERMISSION_UNVERIFIED，不报已开启', async () => {
  setNotifyFake(notifyFake({ request: { result: 'no-effect', code: '' } }));
  const view = await SystemIntegrationService.enableNotifications({});
  assert.equal(view.ok, false);
  assert.equal(view.code, 'NOTIFY_PERMISSION_UNVERIFIED');
});

test('enableNotifications: 申请成功也只报「无法确认」；平台异常 → NOTIFY_UNAVAILABLE', async () => {
  setNotifyFake(notifyFake({ request: { result: 'granted', code: '' } }));
  const granted = await SystemIntegrationService.enableNotifications({});
  assert.equal(granted.ok, false);
  assert.equal(granted.code, 'NOTIFY_PERMISSION_UNVERIFIED');

  setNotifyFake(notifyFake({ request: { result: 'failed', code: '1600001' } }));
  const failed = await SystemIntegrationService.enableNotifications({});
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'NOTIFY_UNAVAILABLE');
});

test('openNotificationSettings: 半模态打开成功 → ok；两条通道都失败 → NOTIFY_SETTINGS_FAILED', async () => {
  setNotifyFake(notifyFake({ settings: { opened: true, enabled: true, verified: true, code: '' } }));
  globalThis.__SETTINGS_FAKE__ = 'ok';
  const opened = await SystemIntegrationService.openNotificationSettings({});
  assert.equal(opened.ok, true);

  // 半模态关掉后发布探针仍发不出 = 用户没开，不能报成功。
  setNotifyFake(notifyFake({ settings: { opened: true, enabled: false, verified: true, code: '' } }));
  const stillOff = await SystemIntegrationService.openNotificationSettings({});
  assert.equal(stillOff.ok, false);
  assert.equal(stillOff.code, 'NOTIFY_PERMISSION_REQUIRED');

  setNotifyFake(notifyFake({ settings: { opened: false, enabled: false, verified: false, code: '1600003' } }));
  globalThis.__SETTINGS_FAKE__ = 'throw';
  const failed = await SystemIntegrationService.openNotificationSettings({});
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'NOTIFY_SETTINGS_FAILED');

  globalThis.__SETTINGS_FAKE__ = 'ok';
  const fallback = await SystemIntegrationService.openNotificationSettings({});
  assert.equal(fallback.ok, true);
});

// ---- 不得 already 短路、unverified 不得当已开启 ----

test('enableNotifications: 即使状态显示已开启也必须真调系统授权，不靠 already 短路', async () => {
  setNotifyFake(notifyFake({
    status: { enabled: true, permission: 'granted', error: '', verified: true, source: 'notificationSetting' },
    request: { result: 'granted', code: '' }
  }));
  globalThis.__NOTIFY_CALLS__ = 0;
  const view = await SystemIntegrationService.enableNotifications({});
  assert.equal(globalThis.__NOTIFY_CALLS__, 1, '点击必须触发一次系统授权调用');
  assert.equal(view.ok, false);
  assert.equal(view.code, 'NOTIFY_PERMISSION_UNVERIFIED');
});

test('applyReminders: 通知真值不可证，第二参数必须恒为 false', async () => {
  setNotifyFake(notifyFake({
    status: { enabled: true, permission: 'granted', error: '', verified: true, source: 'notificationSetting' }
  }));
  setReminderFake({ written: 1, failed: 0, error: '' });
  globalThis.__REMINDER_VERIFIED__ = null;
  await SystemIntegrationService.applyReminders({}, remindersOn());
  assert.equal(globalThis.__REMINDER_VERIFIED__, false);
});

test('applyReminders: unverified 不得当已开启，先发起系统申请；被拒即 NOTIFY_PERMISSION_REQUIRED', async () => {
  setNotifyFake(notifyFake({
    status: { enabled: false, permission: 'prompt', error: '', verified: false, source: 'notificationSetting:isNotificationEnabled' },
    request: { result: 'denied', code: '1600004' }
  }));
  globalThis.__NOTIFY_CALLS__ = 0;
  const view = await SystemIntegrationService.applyReminders({}, remindersOn());
  assert.ok(globalThis.__NOTIFY_CALLS__ >= 1, 'unverified 状态必须发起一次真实申请');
  assert.equal(view.ok, false);
  assert.equal(view.code, 'NOTIFY_PERMISSION_REQUIRED');
});

after(() => {
  delete globalThis.__CALENDAR_GATEWAY_FAKE__;
  delete globalThis.__NOTIFY_FAKE__;
  delete globalThis.__NOTIFY_CALLS__;
  delete globalThis.__REMINDER_FAKE__;
  delete globalThis.__REMINDER_VERIFIED__;
  delete globalThis.__RESOLVE_FAKE__;
  delete globalThis.__SETTINGS_FAKE__;
  fs.rmSync(sandbox, { recursive: true, force: true });
});
