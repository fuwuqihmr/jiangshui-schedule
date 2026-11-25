import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  CONTRACT_FIXTURE_PATH,
  CONSENT_FREE_ACTIONS,
  loadSwiftFiles,
  parseContractActions,
  parseContractFixture,
  parseAndroidActions,
  parseSwiftCaseMap,
  androidActionProfiles,
  matchAndroidProfile,
  expandNumberRanges,
  parseProtocols,
  runChecks
} from '../tools/check-ios.mjs';

const files = loadSwiftFiles(ROOT);
const contractText = readFileSync(path.join(ROOT, 'ios', 'docs', 'IOS-PORT-CONTRACT.md'), 'utf8');
const androidText = readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'cn', 'local', 'tomorrow', 'MainActivity.java'), 'utf8');
const dispatcherText = files['Jiangshui/Web/BridgeDispatcher.swift'];
const fixtureText = readFileSync(path.join(ROOT, CONTRACT_FIXTURE_PATH), 'utf8');

const contract = parseContractActions(contractText);
const fixture = parseContractFixture(fixtureText);
const android = parseAndroidActions(androidText);
const ios = parseSwiftCaseMap(dispatcherText);

test('contract fixture 为 45 个 action（MUST 35 + OPTIONAL 10），键唯一且水平自洽', () => {
  assert.equal(fixture.contractVersion, 'v0-2026-11-18');
  assert.equal(fixture.actions.length, 45);
  assert.equal(new Set(fixture.actions).size, 45);
  assert.equal(fixture.must.length, 35);
  assert.equal(fixture.optional.length, 10);
  assert.equal(fixture.unknownLevels.length, 0, '存在未知 level：' + fixture.unknownLevels.join(','));
  assert.ok(fixture.stats, 'fixture 缺少 levelStats.actions');
  assert.equal(fixture.stats.MUST, 35);
  assert.equal(fixture.stats.OPTIONAL, 10);
  assert.equal(fixture.stats.total, 45);
  assert.equal(fixture.actions[0], 'consentStatus');
  assert.equal(fixture.actions[44], 'updateInstall');
  assert.ok(fixture.optional.includes('runtimeStatus'));
  assert.ok(fixture.must.includes('cancelRecordSync'));
});

test('契约 §3 的 35 个 action，编号 1..35 连续，与 1.3.1 兼容档（含 runtimeStatus、缺 cancelRecordSync）一致', () => {
  assert.equal(contract.count, 35);
  const numbers = expandNumberRanges(contract.numbers);
  assert.deepEqual(numbers, Array.from({ length: 35 }, (_, index) => index + 1));
  assert.equal(new Set(contract.actions).size, 35);
  const legacy = androidActionProfiles(fixture).find((item) => item.id === 'android-1.3.1-legacy');
  assert.deepEqual(contract.actions, legacy.actions, '契约 §3 是本地 1.3.1 口径；45 项全表由 fixture/B3-B5 校验');
  assert.equal(contract.actions[0], 'consentStatus');
  assert.equal(contract.actions[34], 'logout');
});

test('Android MainActivity 的 switch 精确匹配 1.3.1 兼容档（35 = MUST 去 cancelRecordSync + runtimeStatus）', () => {
  assert.equal(android.cases.length, 35);
  assert.equal(new Set(android.cases).size, 35);
  const match = matchAndroidProfile(android.cases, fixture);
  assert.equal(match.ok, true, '缺失：' + match.missing.join(',') + ' 多余：' + match.extra.join(','));
  assert.equal(match.profile.id, 'android-1.3.1-legacy');
  const legacy = androidActionProfiles(fixture).find((item) => item.id === 'android-1.3.1-legacy');
  assert.deepEqual(android.cases, legacy.actions, 'Android 顺序必须与兼容档一致');
  assert.ok(!android.cases.includes('cancelRecordSync'), '1.3.1 尚未实现 cancelRecordSync');
  assert.ok(android.cases.includes('runtimeStatus'));
  assert.equal(android.hasDefault, true);
  assert.ok(android.defaultText.includes('不支持的操作'));
});

test('iOS BridgeDispatcher 的 switch action 精确匹配 fixture 45 项且顺序一致', () => {
  assert.equal(ios.order.length, 45);
  assert.equal(new Set(ios.order).size, 45);
  assert.deepEqual(ios.order, fixture.actions);
  assert.deepEqual([...ios.map.keys()].sort(), [...fixture.actions].sort());
  const defaultBody = ios.map.get('__default__');
  assert.ok(dispatcherText.includes('default:'));
  assert.ok(/default:[\s\S]{0,160}?不支持的操作/.test(dispatcherText));
  assert.ok(!/default:[\s\S]{0,120}?reply\(id,\s*\[/.test(dispatcherText), 'default 不得返回成功回包');
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

test('协议参数标签按协议作用域解析（C5 回归），含 P3 新增回调', () => {
  const protocols = parseProtocols(files['Jiangshui/Services/ServiceProtocols.swift']);
  assert.equal(Object.keys(protocols).length, 15);
  assert.deepEqual(protocols.ConsentStoring.methods.accept.labels, ['version']);
  assert.deepEqual(protocols.StateStoring.methods.save.labels, ['_', 'expectedRevision']);
  assert.deepEqual(protocols.SessionVaulting.methods.save.labels, ['_']);
  assert.deepEqual(protocols.ThemeControlling.methods.apply.labels, ['background', 'surface', 'preference', 'dark']);
  assert.deepEqual(protocols.NotificationPermissions.methods.post.labels, ['title', 'body']);
  assert.deepEqual(protocols.ClassReminding.methods.preview.labels, ['lockedTest']);
  assert.deepEqual(protocols.SchoolProviding.methods.openWebApp.labels, ['url', 'warmupUrl']);
  assert.deepEqual(protocols.SchoolProviding.methods.cancelRecordSync.labels, []);
  assert.deepEqual(protocols.BridgeTransport.methods.progress.labels, ['_', 'text']);
  assert.deepEqual(protocols.BridgeTransport.methods.leaveServiceReturn.labels, []);
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
