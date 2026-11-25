import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, readText, stripSwift, findForceUnwraps } from '../tools/check-ios.mjs';

const readIos = (rel) => readText(path.join(ROOT, 'ios', rel));
const controller = readIos('Jiangshui/Services/ClassActivityController.swift');
const reminder = readIos('Jiangshui/Services/ClassReminderService.swift');
const widget = readIos('JiangshuiWidgets/ClassActivityWidget.swift');
const plist = readIos('Jiangshui/Resources/Info.plist');

test('实时活动只在 iOS 16.1+ 可见，并受系统开关控制', () => {
  assert.match(controller, /import ActivityKit/);
  assert.match(controller, /@available\(iOS 16\.1, \*\)/);
  assert.match(controller, /ActivityAuthorizationInfo\(\)\.areActivitiesEnabled/);
});

test('实时活动请求、更新、T+10 结束与撤销路径齐全', () => {
  assert.match(controller, /Activity(?:<ClassActivityAttributes>)?\.request\(attributes:/);
  assert.match(controller, /contentState:\s*state/);
  assert.match(controller, /activity\.update\(using:\s*state\)/);
  assert.match(controller, /activity\.end\(using:\s*state,\s*dismissalPolicy:\s*\.after\(dismissal\)\)/);
  assert.match(controller, /startDate\.addingTimeInterval\(600\)/);
  assert.match(controller, /func endAll\(\)/);
  assert.match(controller, /dismissalPolicy:\s*\.immediate/);
});

test('实时活动失败只写诊断，不影响普通通知', () => {
  assert.match(controller, /catch\s*\{[\s\S]{0,200}?import-error kind=other http-status=0/);
  assert.doesNotMatch(controller, /fatalError|preconditionFailure/);
  assert.deepEqual(findForceUnwraps(stripSwift(controller)), []);
});

test('ClassReminderService 接入活动并限制 pending 通知不超过 60 条', () => {
  assert.match(reminder, /if #available\(iOS 16\.1, \*\) \{ ClassActivityController\.shared\.reconcile/);
  assert.match(reminder, /candidates\.prefix\(60\)/);
  assert.match(reminder, /candidates\.count > 60/);
  assert.match(reminder, /import-error kind=other http-status=0/);
  assert.match(reminder, /ClassActivityController\.shared\.endAll\(\)/);
  const lines = reminder.split('\n').length - (reminder.endsWith('\n') ? 1 : 0);
  assert.ok(lines < 400, 'ClassReminderService.swift 行数 ' + lines + '，应小于 400');
});

test('Info.plist 声明实时活动且 Widget 无关闭入口', () => {
  assert.match(plist, /<key>NSSupportsLiveActivities<\/key>\s*<true\/>/);
  assert.doesNotMatch(widget, /\bButton\s*\(/);
});
