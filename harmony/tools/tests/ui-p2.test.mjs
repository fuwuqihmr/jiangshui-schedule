#!/usr/bin/env node
/**
 * P2 视觉/交互修复静态回归（无 SDK）：只读取源码与资源，不编译、不运行 ArkUI。
 * 覆盖五项：分区头对比度、首页顶部对齐、空态按钮、全部展开文案回流、底部安全间距。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.HARMONY_ROOT || path.resolve(process.cwd());
const ETS = path.join(ROOT, 'entry/src/main/ets');
const RES = path.join(ROOT, 'entry/src/main/resources/base/element');

function read(rel) {
  return fs.readFileSync(path.join(ETS, rel), 'utf8');
}

function colorMap() {
  const list = JSON.parse(fs.readFileSync(path.join(RES, 'color.json'), 'utf8')).color;
  const map = new Map();
  for (const item of list) map.set(item.name, item.value);
  return map;
}

function floatMap() {
  const list = JSON.parse(fs.readFileSync(path.join(RES, 'float.json'), 'utf8')).float;
  const map = new Map();
  for (const item of list) map.set(item.name, item.value);
  return map;
}

function luminance(hex) {
  const raw = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

test('P2-1 设置分区头显式使用 surface 底色，标题/摘要对比度 >= 4.5:1', () => {
  const src = read('components/SettingsGroup.ets');
  const headerButton = src.slice(src.indexOf('Button() {'), src.indexOf('.onClick(() => { this.onToggle'));
  assert.match(headerButton, /\.type\(ButtonType\.Normal\)[\s\S]*?\.backgroundColor\(\$r\('app\.color\.color_surface'\)\)/,
    '分区头 Button 必须显式设置 color_surface，不能沿用 ArkUI 默认蓝色');
  assert.doesNotMatch(headerButton, /#[0-9A-Fa-f]{3,8}/, '分区头不得硬编码颜色');
  const colors = colorMap();
  const bg = colors.get('color_surface');
  const title = colors.get('color_text_primary');
  const summary = colors.get('color_text_secondary');
  assert.ok(bg && title && summary, '缺少 surface/text_primary/text_secondary 颜色资源');
  assert.ok(contrast(title, bg) >= 4.5, '标题对比度不足：' + contrast(title, bg).toFixed(2));
  assert.ok(contrast(summary, bg) >= 4.5, '摘要对比度不足：' + contrast(summary, bg).toFixed(2));
});

test('P2-2 今日课表 Scroll 顶部对齐，短内容不再垂直居中', () => {
  const src = read('pages/DayPage.ets');
  assert.match(src, /\.height\('100%'\)\.align\(Alignment\.Top\)\.backgroundColor\(\$r\('app\.color\.color_background'\)\)/,
    'Scroll 的滚动内容默认居中，需要在 Scroll 上显式 align(Alignment.Top)');
});

test('P2-3 变更记录空态/无未读时隐藏「全部知道了」，不可点击', () => {
  const src = read('pages/ChangesPage.ets');
  const start = src.indexOf("Button($r('app.string.change_all_read'))");
  assert.ok(start > 0, '找不到 change_all_read 按钮');
  const block = src.slice(start, src.indexOf('.onClick', start));
  assert.match(block, /\.visibility\(this\.vm\.unreadCount > 0 \? Visibility\.Visible : Visibility\.None\)/,
    '按钮必须在 unreadCount === 0 时 Visibility.None');
  assert.match(src, /if \(this\.vm\.isEmpty\) \{[\s\S]*?EmptyState/, '空态分支必须保留 EmptyState');
});

test('P2-4 isAllExpanded 改为 @Prop，父组件收回后标题能回流', () => {
  const src = read('pages/SettingsPage.ets');
  assert.match(src, /@Prop isAllExpanded: boolean = false;/, 'isAllExpanded 必须是 @Prop 才能接收 Index 的计算值');
  assert.doesNotMatch(src, /\n  isAllExpanded: boolean = false;/, '不得保留普通字段版本');
  assert.match(src, /this\.isAllExpanded \? \$r\('app\.string\.settings_collapse_all'\) : \$r\('app\.string\.settings_expand_all'\)/,
    '按钮文案必须跟随 isAllExpanded');
});

test('P2-5 设置页内容尾部预留底部导航安全间距', () => {
  const src = read('pages/SettingsPage.ets');
  const about = src.indexOf("groupId: 'about'");
  const spacer = src.indexOf("Blank().width('100%').height($r('app.float.float_bottom_nav'))");
  assert.ok(spacer > about, '安全间距必须位于六个分组之后');
  assert.ok(src.indexOf('}.width(\'100%\')', spacer) > spacer, '安全间距必须在 Scroll 内容列内');
  const floats = floatMap();
  assert.equal(floats.get('float_bottom_nav'), '56vp');
});
