import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, readText, stripSwift, findForceUnwraps } from '../tools/check-ios.mjs';

const readIos = (rel) => readText(path.join(ROOT, 'ios', rel));
const reminder = readIos('Jiangshui/Services/ClassReminderService.swift');
const app = readIos('Jiangshui/App/JiangshuiApp.swift');
const env = readIos('Jiangshui/App/AppEnvironment.swift');
const root = readIos('Jiangshui/App/RootView.swift');
const cache = readIos('Jiangshui/Services/SystemNotificationService.swift');

test('ClassReminderService 预排未来事件并清理已投递通知', () => {
  assert.match(reminder, /UNCalendarNotificationTrigger/);
  assert.match(reminder, /removeDeliveredNotifications/);
  assert.match(reminder, /cleanupExpiredDelivered/);
  assert.match(reminder, /nextWakeAt/);
  assert.match(reminder, /for event in candidates\.prefix\(60\)/);
  // 指纹不能继续包含会随时间变化的 phase，否则预排后每次 reconcile 都会重发。
  assert.doesNotMatch(reminder, /phase\(event, now\)/);
});

test('默认提前量保持 lead 30 / afterStart 5', () => {
  assert.match(reminder, /var leadMinutes = 30/);
  assert.match(reminder, /var afterStartMinutes = 5/);
});

test('主 App 注册 BGAppRefreshTask 并在前后台接线', () => {
  assert.match(app, /static let taskIdentifier = "cn\.local\.tomorrow\.class-reminder"/);
  assert.match(app, /BGTaskScheduler\.shared\.register/);
  assert.match(app, /BGAppRefreshTask/);
  assert.match(app, /expirationHandler/);
  assert.match(app, /setTaskCompleted/);
  assert.match(env, /BackgroundReminderScheduler\.shared\.configure/);
  assert.match(root, /BackgroundReminderScheduler\.shared\.handleForeground/);
  assert.match(root, /BackgroundReminderScheduler\.shared\.schedule\(\)/);
});

test('权限首次未知时等待回调再重排', () => {
  assert.match(cache, /func whenKnown/);
  assert.match(cache, /waiters/);
  assert.match(reminder, /whenKnown/);
});

test('提醒与 App 接线文件无强解包且 ClassReminderService 小于 400 行', () => {
  for (const [name, text] of [['ClassReminderService.swift', reminder], ['JiangshuiApp.swift', app],
    ['AppEnvironment.swift', env], ['RootView.swift', root], ['SystemNotificationService.swift', cache]]) {
    const hits = findForceUnwraps(stripSwift(text));
    assert.deepEqual(hits, [], name + ' 出现强解包：' + hits.map((hit) => hit.line + ' ' + hit.text).join(' | '));
  }
  const lines = reminder.split('\n').length - (reminder.endsWith('\n') ? 1 : 0);
  assert.ok(lines < 400, 'ClassReminderService.swift 行数 ' + lines + '，应小于 400');
});
