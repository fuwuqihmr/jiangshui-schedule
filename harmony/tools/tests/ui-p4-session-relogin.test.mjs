#!/usr/bin/env node
/**
 * 静态契约（无 SDK）：静默重登必须是真实 TGC/SSO 换票语义，
 * office 保存失败必须可见（不再静默吞掉）且页面有手动刷新入口。
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

const relogin = stripComments(read('platform/school/SchoolRelogin.ets'));
const orchestrator = stripComments(read('data/SchoolReadOrchestrator.ets'));
const reader = stripComments(read('platform/school/SchoolReader.ets'));
const gateway = stripComments(read('platform/network/HttpGateway.ets'));
const cookies = stripComments(read('platform/web/WebCookieStore.ets'));
const officePage = stripComments(read('pages/WebOfficePage.ets'));
const officeView = stripComments(read('platform/web/OfficeWebView.ets'));

// 1) 换票实现：读 CAS 域 TGC → 带 TGC 请求 CAS → 只认变化后的新票。
test('relogin-static-1) SchoolRelogin 注入真实换票端口：TGC 读、CAS 请求、新票判定齐全', () => {
  assert.match(relogin, /implements SchoolReloginPort/);
  assert.match(relogin, /cookieHeaderFor\(CAS_LOGIN\)/);
  assert.match(relogin, /hasTicketGrantingCookie\(casCookie\)/);
  assert.match(relogin, /CAS_LOGIN \+ '\?service='/);
  assert.match(relogin, /allowedRedirectOrigins: RELOGIN_REDIRECT_ORIGINS/);
  assert.match(relogin, /fromSetCookie !== previous/);
  assert.match(relogin, /applySessionCookies\(response\.setCookies\)/);
});

// 2) 换票失败必须如实抛稳定码；不得把“清 cookie 后重读”写进换票实现。
test('relogin-static-2) 换票失败如实抛 LOGIN/CAPTCHA，且不以清 cookie 充当换票', () => {
  assert.match(relogin, /cas ticket granting cookie absent/);
  assert.match(relogin, /cas login page/);
  assert.match(relogin, /cas captcha required/);
  assert.match(relogin, /cas ticket exchange failed/);
  assert.doesNotMatch(relogin, /clearSchoolCookies/);
});

// 3) 编排层：端口契约 + 返回必含会话 cookie + 无新票即失败。
test('relogin-static-3) 编排层端口契约与“无新票不重试”守卫', () => {
  assert.match(orchestrator, /export interface SchoolReloginPort/);
  assert.match(orchestrator, /relogin\?: SchoolReloginPort/);
  assert.match(orchestrator, /port\.exchange\(\)/);
  assert.match(orchestrator, /sso relogin without session cookie/);
});

// 4) 网关必须把每跳 Set-Cookie 收集给换票判定（否则无从判断是否换到新票）。
test('relogin-static-4) HttpGateway 收集重定向链上的 Set-Cookie', () => {
  assert.match(gateway, /setCookies: string\[\]/);
  assert.match(gateway, /function setCookiesFrom\(header: Object\): string\[\]/);
  assert.match(gateway, /collectedCookies = collectedCookies\.concat\(attempt\.setCookies\)/);
});

// 5) cookie 读写器：CAS origin 只用于读 TGC；写回只接受 bzb_jsxsd 一条。
test('relogin-static-5) WebCookieStore 仅读 CAS TGC、仅写回教务会话 cookie', () => {
  assert.match(cookies, /'https:\/\/eapp2\.juwp\.edu\.cn:9443'/);
  assert.match(cookies, /applySessionCookies\(setCookies: string\[\]\): Promise<boolean>/);
  assert.match(cookies, /function sessionCookieOnly\(raw: string\): string/);
  assert.match(cookies, /bzb_jsxsd/);
});

// 6) 装配层默认注入真实换票端口（页面不需要知道换票细节）。
test('relogin-static-6) SchoolReader 默认装配 PlatformSchoolRelogin', () => {
  assert.match(reader, /new PlatformSchoolRelogin\(http, cookies, JXS_PARSER, lexicon\)/);
  assert.match(reader, /relogin: relogin/);
});

// 7) office 保存失败必须上抛到 UI 并给重试；页面必须有手动刷新。
test('relogin-static-7) WebOfficePage：保存失败可见 + 重试 + 刷新按钮', () => {
  assert.match(officePage, /saveError = true/);
  assert.match(officePage, /retrySave\(\)/);
  assert.match(officePage, /this\.refreshToken = this\.refreshToken \+ 1/);
  assert.match(officePage, /web_office_refresh/);
  assert.match(officePage, /web_office_save_failed/);
  assert.doesNotMatch(officePage, /saveLeaveStatus\(cache\)\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/);
});

// 8) 容器：刷新信号触发重载并重新抓取；重载失败上报 error（页面据此给出可见错误）。
test('relogin-static-8) OfficeWebView：refreshToken 触发 reload 并复位抓取标记', () => {
  assert.match(officeView, /@Watch\('onRefreshToken'\) refreshToken: number = 0/);
  assert.match(officeView, /private onRefreshToken\(\): void/);
  assert.match(officeView, /this\.leaveFetchUrl = ''/);
  assert.match(officeView, /session\.reload\(\)\.catch/);
});
