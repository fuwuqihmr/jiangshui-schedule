import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  loadSwiftFiles,
  stripSwift,
  matchBalanced,
  parsePbxproj,
  sha256
} from '../tools/check-ios.mjs';

const files = loadSwiftFiles(ROOT);
const controller = files['Jiangshui/School/SchoolReadController.swift'] || '';
const controllerCode = stripSwift(controller);

function functionBody(raw, code, name) {
  const match = new RegExp('func\\s+' + name + '\\s*\\(').exec(code);
  assert.ok(match, '无法定位函数 ' + name);
  const open = code.indexOf('{', match.index);
  assert.ok(open >= 0, '函数 ' + name + ' 缺少函数体');
  const close = matchBalanced(code, open);
  assert.ok(close > open, '函数 ' + name + ' 花括号不配平');
  return raw.slice(open, close + 1);
}

test('v1.5.2 实验课：labHtml/labFetchedAt/labError 非空才透传，labHttpStatus 按 hasKey 保留 0', () => {
  const body = functionBody(controller, controllerCode, 'handleReadResult');
  assert.match(body, /let\s+labHtml\s*=\s*result\.optString\s*\(\s*"labHtml"\s*\)\s*if\s+labHtml\.isEmpty\s*==\s*false\s*\{\s*payload\s*\[\s*"labHtml"\s*\]\s*=\s*labHtml\s*\}/);
  assert.match(body, /let\s+labFetchedAt\s*=\s*result\.optString\s*\(\s*"labFetchedAt"\s*\)\s*if\s+labFetchedAt\.isEmpty\s*==\s*false\s*\{\s*payload\s*\[\s*"labFetchedAt"\s*\]\s*=\s*labFetchedAt\s*\}/);
  assert.match(body, /var\s+labError\s*=\s*result\.optString\s*\(\s*"labError"\s*\)\s*if\s+labError\.isEmpty\s*==\s*false\s*\{[\s\S]{0,260}?Self\.examErrorKinds\.contains\s*\(\s*labError\s*\)\s*==\s*false\s*\{\s*labError\s*=\s*"other"\s*\}[\s\S]{0,80}?payload\s*\[\s*"labError"\s*\]\s*=\s*labError/);
  // 0 是合法 HTTP 状态码；只允许 hasKey 守卫 + optInt(...,0)，不允许把 0 当缺失。
  assert.match(body, /if\s+result\.hasKey\s*\(\s*"labHttpStatus"\s*\)\s*\{\s*payload\s*\[\s*"labHttpStatus"\s*\]\s*=\s*result\.optInt\s*\(\s*"labHttpStatus"\s*,\s*0\s*\)\s*\}/);
  assert.doesNotMatch(body, /labHttpStatus\s*(?:==|!=|>|<)\s*0/);
  assert.ok(body.includes('state.log("web-read-lab bytes=\\(labHtml.utf8.count) error=\\(labErrorText)")'));
  assert.ok(body.includes('let labErrorText = labError.isEmpty ? "none" : labError'));
});

test('v1.5.2 实验课：payload 只多 4 个登记键，不整体合并 result', () => {
  const body = functionBody(controller, controllerCode, 'handleReadResult');
  const keys = [...body.matchAll(/payload\s*\[\s*"([^"]+)"\s*\]\s*=/g)].map((match) => match[1]);
  const allowed = new Set([
    'studentProfile',
    'exams', 'examFetchedAt', 'examError',
    'labHtml', 'labFetchedAt', 'labError', 'labHttpStatus'
  ]);
  const unknown = keys.filter((key) => !allowed.has(key));
  assert.deepEqual([...new Set(unknown)], [], 'payload 出现未登记的透传键');
  for (const key of ['labHtml', 'labFetchedAt', 'labError', 'labHttpStatus']) {
    assert.equal(keys.filter((item) => item === key).length, 1, 'payload["' + key + '"] 必须恰好写入一次');
  }
  assert.doesNotMatch(body, /payload\s*=\s*result\b/);
  assert.doesNotMatch(body, /payload\s*\.\s*merge\s*\(/);
  assert.doesNotMatch(body, /payload\s*\.\s*updateValue\s*\(/);
  const exam = body.indexOf('if let exams = result.optArray("exams")');
  const lab = body.indexOf('let labHtml = result.optString("labHtml")');
  const log = body.indexOf('state.log("web-read-lab');
  const persist = body.indexOf('persistSessionCookies()');
  const finish = body.indexOf('finish(.success(payload))');
  assert.ok(exam >= 0 && exam < lab && lab < log && log < persist && persist < finish, '考试/实验课/日志/落盘顺序错误');
});

test('v1.5.2 备选图标：AppIconWater 是单张 1024x1024 8-bit RGB，无 alpha', () => {
  const dir = path.join(ROOT, 'ios', 'Jiangshui', 'Resources', 'Assets.xcassets', 'AppIconWater.appiconset');
  const contentsPath = path.join(dir, 'Contents.json');
  const pngPath = path.join(dir, 'AppIconWater-1024.png');
  assert.ok(existsSync(contentsPath), '缺少 AppIconWater Contents.json');
  assert.ok(existsSync(pngPath), '缺少 AppIconWater-1024.png');
  const contents = JSON.parse(readFileSync(contentsPath, 'utf8'));
  assert.equal(contents.images.length, 1);
  assert.equal(contents.images[0].filename, 'AppIconWater-1024.png');
  assert.equal(contents.images[0].idiom, 'universal');
  assert.equal(contents.images[0].platform, 'ios');
  assert.equal(contents.images[0].size, '1024x1024');
  assert.equal(contents.info.version, 1);

  const buffer = readFileSync(pngPath);
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(buffer.readUInt32BE(16), 1024, '宽度');
  assert.equal(buffer.readUInt32BE(20), 1024, '高度');
  assert.equal(buffer[24], 8, 'bit depth');
  assert.equal(buffer[25], 2, 'colorType=2 表示 RGB、无 alpha');
  assert.equal(buffer[28], 0, '非交错');
  assert.equal(sha256(buffer), '011d8be062a2a6280d8c2ab86e0f70de88b361f62cc3040c764c8fff22ffcb0b');
});

test('v1.5.2 工程设置：备选图标只在主 App（project.yml / gen-pbxproj / pbxproj）', () => {
  const yml = readFileSync(path.join(ROOT, 'ios', 'project.yml'), 'utf8');
  const mainStart = yml.indexOf('\n  Jiangshui:\n');
  const widgetStart = yml.indexOf('\n  JiangshuiWidgets:\n');
  assert.ok(mainStart >= 0 && widgetStart > mainStart, 'project.yml target 块');
  const mainYml = yml.slice(mainStart, widgetStart);
  const widgetYml = yml.slice(widgetStart);
  assert.match(mainYml, /ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES:\s*AppIconWater/);
  assert.match(mainYml, /ASSETCATALOG_COMPILER_APPICON_NAME:\s*AppIcon\b/);
  assert.doesNotMatch(widgetYml, /ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES/);

  const gen = readFileSync(path.join(ROOT, 'ios', 'tools', 'gen-pbxproj.mjs'), 'utf8');
  const targetStart = gen.indexOf('const targetShared = {');
  const genWidgetStart = gen.indexOf('const widgetShared = {');
  const renderStart = gen.indexOf('function renderSettings');
  assert.ok(targetStart >= 0 && genWidgetStart > targetStart && renderStart > genWidgetStart);
  const targetBlock = gen.slice(targetStart, genWidgetStart);
  const widgetBlock = gen.slice(genWidgetStart, renderStart);
  assert.ok(targetBlock.includes('ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES: "AppIconWater"'));
  assert.equal(widgetBlock.includes('ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES'), false);

  const pbxText = readFileSync(path.join(ROOT, 'ios', 'Jiangshui.xcodeproj', 'project.pbxproj'), 'utf8');
  const parsed = parsePbxproj(pbxText);
  const targets = Object.values(parsed.objects).filter((item) => item.isa === 'PBXNativeTarget');
  const app = targets.find((item) => item.name === 'Jiangshui');
  const widget = targets.find((item) => item.productType === 'com.apple.product-type.app-extension');
  assert.ok(app && widget);
  const configsOf = (target) => (parsed.objects[target.buildConfigurationList].buildConfigurations || []).map((id) => parsed.objects[id]);
  const appConfigs = configsOf(app);
  const widgetConfigs = configsOf(widget);
  assert.equal(appConfigs.length, 2);
  for (const config of appConfigs) {
    assert.equal(config.buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES, 'AppIconWater');
    assert.equal(config.buildSettings.ASSETCATALOG_COMPILER_APPICON_NAME, 'AppIcon');
  }
  for (const config of widgetConfigs) {
    assert.equal(config.buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES, undefined);
  }
});

test('v1.5.2 切换链路：协议声明、比较后切换、saveState 应用、回前台只校准一次', () => {
  const protocols = files['Jiangshui/Services/ServiceProtocols.swift'] || '';
  assert.match(protocols, /protocol\s+ThemeControlling[\s\S]{0,900}?func\s+applyIconTheme\s*\(\s*_ value\s*:\s*String\s*\)/);

  const themeRaw = files['Jiangshui/Services/ThemeController.swift'] || '';
  const themeCode = stripSwift(themeRaw);
  const themeBody = functionBody(themeRaw, themeCode, 'applyIconTheme');
  assert.match(themeBody, /value == "water" \? "AppIconWater" : nil/);
  assert.match(themeBody, /alternateIconName == desired/);
  assert.match(themeBody, /setAlternateIconName\(desired/);
  assert.match(themeBody, /DispatchQueue\.main\.async/);
  assert.match(themeBody, /icon-theme apply failed/);

  const setIconSites = Object.entries(files).filter(([, source]) => /setAlternateIconName\s*\(/.test(stripSwift(source)));
  assert.deepEqual(setIconSites.map(([file]) => file), ['Jiangshui/Services/ThemeController.swift']);

  const dispatcher = files['Jiangshui/Web/BridgeDispatcher.swift'] || '';
  assert.equal((dispatcher.match(/applyIconTheme\s*\(/g) || []).length, 1);
  const saveStart = dispatcher.indexOf('case "saveState":');
  const themeStart = dispatcher.indexOf('case "setTheme":', saveStart);
  assert.ok(saveStart >= 0 && themeStart > saveStart, 'saveState case 块');
  const saveBlock = dispatcher.slice(saveStart, themeStart);
  assert.match(saveBlock, /state\.hasKey\("iconTheme"\)/);
  assert.match(saveBlock, /services\.theme\.applyIconTheme\(state\.optString\("iconTheme", "whale"\)\)/);
  const saveAt = saveBlock.indexOf('services.state.save');
  const applyAt = saveBlock.indexOf('applyIconTheme');
  const replyAt = saveBlock.indexOf('reply(id, ["revision"');
  assert.ok(saveAt >= 0 && applyAt > saveAt && replyAt > applyAt, '先保存、再应用图标、最后回 revision');

  const appRaw = files['Jiangshui/App/AppEnvironment.swift'] || '';
  const appCode = stripSwift(appRaw);
  assert.match(appCode, /didBecomeActiveNotification/);
  assert.match(appCode, /removeObserver/);
  assert.match(appCode, /calibrateIconTheme\s*\(\s*\)/);
  const calibrateBody = functionBody(appRaw, appCode, 'calibrateIconTheme');
  assert.match(calibrateBody, /guard iconCalibrated == false else \{ return \}/);
  assert.match(calibrateBody, /services\.state\.load\(\)/);
  assert.ok(calibrateBody.includes('services.theme.applyIconTheme(saved?.optString("iconTheme", "whale") ?? "whale")'));
});
