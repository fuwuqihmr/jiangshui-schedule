import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  ACTION_COUNT,
  CONSENT_FREE_ACTIONS,
  loadSwiftFiles,
  parseContractActions,
  parseAndroidActions,
  parseSwiftCases,
  expandNumberRanges,
  parseProtocols,
  runChecks
} from '../tools/check-ios.mjs';

const files = loadSwiftFiles(ROOT);
const contractText = readFileSync(path.join(ROOT, 'ios', 'docs', 'IOS-PORT-CONTRACT.md'), 'utf8');
const androidText = readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'cn', 'local', 'tomorrow', 'MainActivity.java'), 'utf8');
const dispatcherText = files['Jiangshui/Web/BridgeDispatcher.swift'];

const contract = parseContractActions(contractText);
const android = parseAndroidActions(androidText);
const ios = parseSwiftCases(dispatcherText);

test('契约 §3 解析出 35 个 action，编号 1..35 连续且无重复', () => {
  assert.equal(contract.count, ACTION_COUNT);
  assert.equal(contract.actions.length, ACTION_COUNT);
  const numbers = expandNumberRanges(contract.numbers);
  assert.deepEqual(numbers, Array.from({ length: ACTION_COUNT }, (_, index) => index + 1));
  assert.equal(new Set(contract.actions).size, ACTION_COUNT);
  assert.equal(contract.actions[0], 'consentStatus');
  assert.equal(contract.actions[contract.actions.length - 1], 'logout');
});

test('Android MainActivity 的 switch (action) 解析出 35 个 case', () => {
  assert.equal(android.cases.length, ACTION_COUNT);
  assert.equal(new Set(android.cases).size, ACTION_COUNT);
  assert.equal(android.hasDefault, true);
  assert.ok(android.defaultText.includes('不支持的操作'));
});

test('iOS BridgeDispatcher 的 switch action 解析出 35 个 case', () => {
  assert.equal(ios.cases.length, ACTION_COUNT);
  assert.equal(new Set(ios.cases).size, ACTION_COUNT);
  assert.equal(ios.hasDefault, true);
  assert.ok(ios.defaultText.includes('不支持的操作'));
  assert.ok(!/reply\(id,\s*\[/.test(ios.defaultText), 'default 不得返回成功回包');
});

test('契约 / Android / iOS 三向 action 集合与顺序完全一致', () => {
  assert.deepEqual(ios.cases, contract.actions);
  assert.deepEqual(android.cases, contract.actions);
});

test('免同意白名单恰好 4 项，且 Android 与 iOS 均在 requireAgreed 前放行', () => {
  assert.deepEqual(CONSENT_FREE_ACTIONS, ['consentStatus', 'acceptConsent', 'declineConsent', 'setTheme']);
  const requireIndex = androidText.indexOf('UserConsent.require');
  assert.ok(requireIndex > 0, 'Android 未找到 UserConsent.require');
  const before = androidText.slice(Math.max(0, requireIndex - 400), requireIndex);
  assert.ok(before.includes('Arrays.asList'), 'Android 免同意判断应使用 Arrays.asList');
  for (const name of CONSENT_FREE_ACTIONS) assert.ok(before.includes('"' + name + '"'), 'Android 白名单缺少 ' + name);

  assert.ok(dispatcherText.includes('consentFreeActions.contains(action)'));
  const setMatch = /consentFreeActions[^=]*=\s*\[([^\]]+)\]/.exec(dispatcherText);
  assert.ok(setMatch, 'iOS 未找到 consentFreeActions 集合');
  const iosNames = setMatch[1].split(',').map((item) => item.trim().replace(/^"|"$/g, '')).filter(Boolean);
  assert.deepEqual(iosNames, CONSENT_FREE_ACTIONS);
  assert.ok(dispatcherText.indexOf('consentFreeActions.contains(action)') < dispatcherText.indexOf('switch action'));
});

test('协议参数标签按协议作用域解析（C5 回归）', () => {
  const protocols = parseProtocols(files['Jiangshui/Services/ServiceProtocols.swift']);
  assert.equal(Object.keys(protocols).length, 15);
  assert.deepEqual(protocols.ConsentStoring.methods.accept.labels, ['version']);
  assert.deepEqual(protocols.StateStoring.methods.save.labels, ['_', 'expectedRevision']);
  assert.deepEqual(protocols.SessionVaulting.methods.save.labels, ['_']);
  assert.deepEqual(protocols.ThemeControlling.methods.apply.labels, ['background', 'surface', 'preference', 'dark']);
  assert.deepEqual(protocols.NotificationPermissions.methods.post.labels, ['title', 'body']);
  assert.deepEqual(protocols.ClassReminding.methods.preview.labels, ['lockedTest']);
  assert.deepEqual(protocols.SchoolProviding.methods.openWebApp.labels, ['url', 'warmupUrl']);
});

const results = runChecks(ROOT);
const byId = new Map(results.map((item) => [item.id, item]));
for (const id of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']) {
  test('检查 ' + id + ' 通过', () => {
    const item = byId.get(id);
    assert.ok(item, '缺少检查项 ' + id);
    assert.equal(item.ok, true, id + '：' + (item.detail || ''));
  });
}
