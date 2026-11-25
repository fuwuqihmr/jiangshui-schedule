import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  parseOpenStep,
  parsePbxproj,
  loadSwiftFiles,
  runChecks
} from '../tools/check-ios.mjs';

const pbxText = readFileSync(path.join(ROOT, 'ios', 'Jiangshui.xcodeproj', 'project.pbxproj'), 'utf8');
const parsed = parsePbxproj(pbxText);
const { raw, objects, project, rootObject } = parsed;

test('parseOpenStep：注释、引号、数组、嵌套字典与 $() 变量', () => {
  const source = [
    '// !$*UTF8*$!',
    '{',
    '  a = "x; y";',
    '  b = (p, q);',
    '  c = { d = 1; };',
    '  e = "$(inherited)";',
    '}'
  ].join('\n');
  assert.deepEqual(parseOpenStep(source), {
    a: 'x; y',
    b: ['p', 'q'],
    c: { d: '1' },
    e: '$(inherited)'
  });
});

test('parseOpenStep：语法错误必须抛异常而不是静默返回', () => {
  assert.throws(() => parseOpenStep('{ a = ; }'), /OpenStep/);
  assert.throws(() => parseOpenStep('{ a = 1;'), /OpenStep/);
  assert.throws(() => parseOpenStep('(1, 2)'), /OpenStep/);
});

test('pbxproj：头部、objectVersion、rootObject 与 compatibilityVersion', () => {
  assert.ok(pbxText.startsWith('// !$*UTF8*$!'));
  assert.equal(String(raw.archiveVersion), '1');
  assert.equal(String(raw.objectVersion), '56');
  assert.match(String(rootObject), /^[0-9A-F]{24}$/);
  assert.equal(project.isa, 'PBXProject');
  assert.equal(project.compatibilityVersion, 'Xcode 14.0');
  assert.ok(objects[project.mainGroup], 'PBXProject.mainGroup 必须指向已定义对象');
  assert.equal(objects[project.mainGroup].isa, 'PBXGroup');
});

test('pbxproj：application target 的 Debug/Release 构建设置', () => {
  const target = Object.values(objects).find((item) => item.isa === 'PBXNativeTarget' && item.productType === 'com.apple.product-type.application');
  assert.ok(target, '缺少 application target');
  const list = objects[target.buildConfigurationList];
  assert.ok(list, '缺少 buildConfigurationList');
  const settings = list.buildConfigurations.map((id) => objects[id].buildSettings);
  assert.equal(settings.length, 2);
  for (const value of settings) {
    assert.equal(value.PRODUCT_BUNDLE_IDENTIFIER, 'cn.local.tomorrow');
    assert.equal(value.MARKETING_VERSION, '1.5.0');
    assert.equal(String(value.CURRENT_PROJECT_VERSION), '64');
    assert.equal(value.IPHONEOS_DEPLOYMENT_TARGET, '15.0');
    assert.equal(value.INFOPLIST_FILE, 'Jiangshui/Resources/Info.plist');
    assert.equal(value.GENERATE_INFOPLIST_FILE, 'NO');
    assert.equal(value.SWIFT_VERSION, '5.0');
  }
});

test('pbxproj：每个 target 的 Sources 都在磁盘，且单 target 内不重复', () => {
  const disk = new Set(Object.keys(loadSwiftFiles(ROOT)).map((key) => path.basename(key)));
  const targets = Object.values(objects).filter((item) => item.isa === 'PBXNativeTarget');
  assert.ok(targets.length >= 2, '至少应有主 App 与 Widget 两个 target');
  for (const target of targets) {
    const paths = targetSourcePaths(target);
    assert.ok(paths.length > 0, target.name + ' 缺少 Sources');
    assert.equal(new Set(paths).size, paths.length, target.name + ' Sources 不得重复');
    for (const name of paths) {
      assert.ok(name.endsWith('.swift'), target.name + ' Sources 含非 .swift：' + name);
      assert.ok(disk.has(path.basename(name)), target.name + ' 编译了磁盘不存在的 .swift：' + name);
    }
  }
});

function targetSourcePaths(target) {
  return (target.buildPhases || [])
    .map((id) => objects[id])
    .filter((phase) => phase && phase.isa === 'PBXSourcesBuildPhase')
    .flatMap((phase) => phase.files || [])
    .map((id) => objects[id])
    .filter((buildFile) => buildFile && buildFile.fileRef)
    .map((buildFile) => objects[buildFile.fileRef])
    .filter(Boolean)
    .map((ref) => String(ref.path));
}

test('pbxproj：主 App 与 Widget 的 Sources 分 target 映射，共享文件只双 target', () => {
  const targets = Object.values(objects).filter((item) => item.isa === 'PBXNativeTarget');
  const app = targets.find((item) => item.name === 'Jiangshui');
  const widget = targets.find((item) => item.productType === 'com.apple.product-type.app-extension');
  assert.ok(app, '缺少主 App target');
  assert.ok(widget, '缺少 Widget extension target');
  const mainSources = targetSourcePaths(app).sort();
  const widgetSources = targetSourcePaths(widget).sort();
  const disk = Object.keys(loadSwiftFiles(ROOT));
  const appDisk = disk.filter((key) => key.startsWith('Jiangshui/')).map((key) => path.basename(key)).sort();
  const widgetDisk = disk.filter((key) => key.startsWith('JiangshuiWidgets/')).map((key) => path.basename(key)).sort();
  assert.deepEqual(widgetSources, widgetDisk, 'Widget target 只编译自己的全部 .swift');
  assert.equal(new Set(mainSources).size, mainSources.length, '主 App Sources 不得重复');
  for (const name of appDisk) assert.ok(mainSources.includes(name), '主 App 缺 ' + name);
  assert.ok(mainSources.includes('ClassActivityAttributes.swift'), '共享 Attributes 必须进主 App');
  assert.ok(widgetSources.includes('ClassActivityAttributes.swift'), '共享 Attributes 必须进 Widget');
  assert.equal(widgetSources.includes('BridgeDispatcher.swift'), false, 'Widget 不得编译主 App 专属文件');
});

const results = runChecks(ROOT);
const byId = new Map(results.map((item) => [item.id, item]));
for (const id of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11']) {
  test('检查 ' + id + ' 通过', () => {
    const item = byId.get(id);
    assert.ok(item, '缺少检查项 ' + id);
    assert.equal(item.ok, true, id + '：' + (item.detail || ''));
  });
}
