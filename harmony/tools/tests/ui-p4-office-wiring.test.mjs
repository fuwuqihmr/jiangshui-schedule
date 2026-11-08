#!/usr/bin/env node
/**
 * P4 79c 收尾静态契约（无 SDK）：OfficeWebSessionImpl 必须被真实调用（不是死代码），
 * 且 P3 的 office WebView 旧行为（白名单/能力探测/复制链接/事件回调）不得回退。
 * 纯静态读源码，不编译、不运行 ArkUI；由 run-core-tests.mjs 收集。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.HARMONY_ROOT || path.resolve(process.cwd());
const ETS = path.join(ROOT, 'entry/src/main/ets');

function read(rel) {
  return fs.readFileSync(path.join(ETS, rel), 'utf8');
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function etsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { etsFiles(full, acc); } else if (entry.name.endsWith('.ets')) { acc.push(full); }
  }
  return acc;
}

test('1) OfficeWebView 用真实 controller 构造 OfficeWebSessionImpl，并交给页面与 noteUrl', () => {
  const view = stripComments(read('platform/web/OfficeWebView.ets'));
  assert.match(view, /import \{ OfficeWebSessionImpl \}/, 'OfficeWebSessionImpl 必须是值导入（不是 import type）');
  assert.match(view, /new OfficeWebSessionImpl\(this\.controller/, '必须用真实 Web 控制器构造会话，不得 new 空会话');
  assert.match(view, /this\.onSessionReady\(impl\)/, '必须把会话交给宿主页面');
  assert.match(view, /this\.session\.noteUrl\(/, '页面跳转必须通知会话记录 URL');
  assert.match(view, /onControllerAttached/, '必须等 Web 控制器就绪后再建会话');
});

test('2) WebOfficePage 持有会话并真正调用 close，不得只存不用', () => {
  const page = stripComments(read('pages/WebOfficePage.ets'));
  assert.match(page, /onSessionReady\s*:/, '页面必须接收会话回调');
  assert.match(page, /this\.session = session/, '页面必须保存会话实例');
  assert.match(page, /this\.session\.close\(\)/, '页面必须调用会话 close');
  assert.match(page, /OfficeWebView\(\{/, '页面必须挂载 OfficeWebView');
});

test('3) P3 office WebView 旧行为不得回退（白名单/能力探测/复制链接/事件回调）', () => {
  const view = stripComments(read('platform/web/OfficeWebView.ets'));
  for (const marker of ['url', 'warmupUrl', 'onStateChange', 'closed', 'canIUse', 'isAllowedWebUrl', 'copyText', 'onLoadIntercept', 'onErrorReceive']) {
    assert.ok(view.includes(marker), 'P3 旧行为标记缺失：' + marker);
  }
  assert.match(view, /web_office_invalid_url/, '白名单外链接必须仍走降级提示');
  assert.match(view, /web_office_copy_link/, '复制链接降级必须仍在');
  assert.match(view, /web_office_copy_failed/, '复制失败提示必须仍在');
});

test('4) OfficeWebSessionImpl 在本文件之外至少两个文件被引用（有真实调用点，非死代码）', () => {
  const self = path.join(ETS, 'platform/web/OfficeWebSessionImpl.ets');
  const referencing = etsFiles(ETS).filter((file) => {
    if (file === self) { return false; }
    return /OfficeWebSessionImpl/.test(stripComments(fs.readFileSync(file, 'utf8')));
  }).map((file) => path.relative(ETS, file).split(path.sep).join('/'));
  assert.deepEqual(referencing.sort(), ['pages/WebOfficePage.ets', 'platform/web/OfficeWebView.ets']);
});
