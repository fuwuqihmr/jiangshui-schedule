import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  ATS_DOMAINS,
  SCHOOL_DOMAINS,
  HANDLER_NAME,
  parseXmlPlist,
  checkInfoPlistCore,
  checkAts,
  checkBackground,
  checkUsageDescriptions,
  checkPrivacyManifest,
  analyzeShim,
  findForceUnwraps,
  stripSwift,
  loadSwiftFiles
} from '../tools/check-ios.mjs';

const infoText = readFileSync(path.join(ROOT, 'ios', 'Jiangshui', 'Resources', 'Info.plist'), 'utf8');
const privacyText = readFileSync(path.join(ROOT, 'ios', 'Jiangshui', 'Resources', 'PrivacyInfo.xcprivacy'), 'utf8');
const info = parseXmlPlist(infoText);
const privacy = parseXmlPlist(privacyText);

test('parseXmlPlist 支持字典/数组/布尔/整数与注释', () => {
  const value = parseXmlPlist([
    '<plist>',
    '<!-- comment -->',
    '<dict>',
    '<key>a</key><true/>',
    '<key>b</key><integer>42</integer>',
    '<key>c</key><array><string>x</string><false/></array>',
    '</dict>',
    '</plist>'
  ].join('\n'));
  assert.deepEqual(value, { a: true, b: 42, c: ['x', false] });
});

test('parseXmlPlist 对残缺 XML 抛异常', () => {
  assert.throws(() => parseXmlPlist('<plist><dict><key>a</key>'), /plist XML/);
  assert.throws(() => parseXmlPlist('not-xml'), /plist XML/);
});

test('Info.plist 核心键与版本宏', () => {
  assert.deepEqual(checkInfoPlistCore(info), []);
  assert.equal(info.CFBundleDisplayName, '江水课表');
  assert.equal(info.CFBundleIdentifier, '$(PRODUCT_BUNDLE_IDENTIFIER)');
  assert.equal(info.CFBundleShortVersionString, '$(MARKETING_VERSION)');
  assert.equal(info.CFBundleVersion, '$(CURRENT_PROJECT_VERSION)');
  assert.equal(info.ITSAppUsesNonExemptEncryption, false);
});

test('ATS：本地网络 + 7 域，5 个教务域 insecure 且 TLSv1.2，无 ArbitraryLoads', () => {
  assert.deepEqual(checkAts(info), []);
  const ats = info.NSAppTransportSecurity;
  assert.equal(ats.NSAllowsLocalNetworking, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(ats, 'NSAllowsArbitraryLoads'));
  assert.deepEqual(Object.keys(ats.NSExceptionDomains).sort(), [...ATS_DOMAINS].sort());
  for (const domain of SCHOOL_DOMAINS) {
    const item = ats.NSExceptionDomains[domain];
    assert.equal(item.NSExceptionAllowsInsecureHTTPLoads, true, domain);
    assert.equal(item.NSExceptionMinimumTLSVersion, 'TLSv1.2', domain);
  }
});

test('后台模式与 BGTask 两个 id', () => {
  assert.deepEqual(checkBackground(info), []);
  assert.deepEqual(info.UIBackgroundModes, ['fetch', 'processing']);
  assert.deepEqual(info.BGTaskSchedulerPermittedIdentifiers, [
    'cn.local.tomorrow.background-check',
    'cn.local.tomorrow.class-reminder'
  ]);
});

test('日历/定位用途文案为中文非空', () => {
  assert.deepEqual(checkUsageDescriptions(info), []);
});

test('PrivacyInfo.xcprivacy 结构与 Required Reason API', () => {
  assert.deepEqual(checkPrivacyManifest(privacy), []);
  assert.equal(privacy.NSPrivacyTracking, false);
  assert.deepEqual(privacy.NSPrivacyTrackingDomains, []);
  assert.deepEqual(privacy.NSPrivacyCollectedDataTypes, []);
  const types = privacy.NSPrivacyAccessedAPITypes.map((item) => item.NSPrivacyAccessedAPIType).sort();
  assert.deepEqual(types, [
    'NSPrivacyAccessedAPICategoryFileTimestamp',
    'NSPrivacyAccessedAPICategoryUserDefaults'
  ]);
});

test('注入 shim 逐字符合契约，逻辑非不会误伤强解包检查', () => {
  const jsbridge = readFileSync(path.join(ROOT, 'ios', 'Jiangshui', 'Web', 'JSBridge.swift'), 'utf8');
  assert.deepEqual(analyzeShim(jsbridge), []);
  assert.equal(HANDLER_NAME, 'jiangshuiBridge');
  assert.ok(jsbridge.includes('static let handlerName = "jiangshuiBridge"'));

  const broken = jsbridge.replace('window.Android.systemDarkMode = function ()', 'window.Android.systemDarkModeX = function ()');
  assert.notEqual(broken, jsbridge);
  assert.ok(analyzeShim(broken).length > 0);

  const hits = findForceUnwraps([
    'let a = foo!',
    'if !flag {',
    'if x != y {',
    'let b = dictionary["k"]!',
    'let c = try! risky()',
    'guard let d = value else { return }'
  ].join('\n'));
  const texts = hits.map((item) => item.text);
  assert.ok(texts.includes('let a = foo!'));
  assert.ok(texts.includes('let b = dictionary["k"]!'));
  assert.ok(hits.some((item) => item.kinds.includes('try!')));
  assert.ok(!texts.includes('if !flag {'));
  assert.ok(!texts.includes('if x != y {'));

  const files = loadSwiftFiles(ROOT);
  for (const rel of ['Jiangshui/Web/JSBridge.swift', 'Jiangshui/Web/WebHost.swift', 'Jiangshui/Web/BridgeDispatcher.swift']) {
    assert.ok(files[rel], '缺少 ' + rel);
    assert.deepEqual(findForceUnwraps(stripSwift(files[rel])), [], rel + ' 不得有强解包');
  }
});
