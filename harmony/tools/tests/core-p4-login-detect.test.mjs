#!/usr/bin/env node
/**
 * 纯逻辑：登录成功判定分层与 Cookie 采集优先级（无网络、无 Kit）。
 * 成功判定只看 URL 命中教务框架/课表页；cookie 三层依次回落，全失败仍算成功但降级静默重登。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TMP = process.env.HARMONY_CORE_TMP;
if (!TMP) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');

const web = await import(pathToFileURL(path.join(TMP, 'core/viewmodel/WebEntryViewModel.ts')).href);
const session = await import(pathToFileURL(path.join(TMP, 'data/SchoolSessionStore.ts')).href);
const { isSchoolLoginSuccessParts, planLoginCapture } = web;
const { extractSessionCookie } = session;

function emptySources() {
  return {
    sessionFromRequestHeader: '',
    sessionFromFetchCookie: '',
    sessionFromAllCookies: '',
    tgcFromRequestHeader: '',
    tgcFromFetchCookie: '',
    tgcFromAllCookies: ''
  };
}

test('login-detect-1) URL 命中教务框架/课表页才判成功，拒绝登录页、学工域与非 8080/81', () => {
  const ok = (scheme, host, port, path) => isSchoolLoginSuccessParts(scheme, host, port, path);
  assert.equal(ok('http', 'jiaowu.juwp.edu.cn', 8080, '/jsxsd/framework/xsMainV.htmlx'), true);
  assert.equal(ok('https', 'jiaowu.juwp.edu.cn', 81, '/jsxsd/framework/xsMainV.htmlx?x=1'), true);
  assert.equal(ok('https', 'jiaowu.juwp.edu.cn', 81, '/jsxsd/xskb/xskb_list.do?viweType=1'), true);
  assert.equal(ok('https', 'jiaowu.juwp.edu.cn', 81, '/jsxsd/xskb/xskb_list.do'), true);
  assert.equal(ok('https', 'jiaowu.juwp.edu.cn', 81, '/sso.jsp'), false);
  assert.equal(ok('https', 'jiaowu.juwp.edu.cn', 81, '/jsxsd/framework/other.htmlx'), false);
  assert.equal(ok('https', 'jiaowu.juwp.edu.cn', 81, '/jsxsd/framework/xsMainV.htmlx.bak'), false);
  assert.equal(ok('https', 'jiaowu.juwp.edu.cn', 443, '/jsxsd/framework/xsMainV.htmlx'), false);
  assert.equal(ok('http', 'jiaowu.juwp.edu.cn', 81, '/jsxsd/framework/xsMainV.htmlx'), false);
  assert.equal(ok('https', 'eapp2.juwp.edu.cn', 9443, '/jsxsd/framework/xsMainV.htmlx'), false);
  assert.equal(ok('https', 'evil.example', 81, '/jsxsd/framework/xsMainV.htmlx'), false);
  assert.equal(ok('https', 'jiaowu.juwp.edu.cn', 81, ''), false);
});

test('login-detect-2) Cookie 采集优先级：fetchCookie > fetchAllCookies > 请求头，session 与 TGC 各自回落', () => {
  const s = emptySources();
  s.sessionFromRequestHeader = 'bzb_jsxsd=header-session';
  s.sessionFromFetchCookie = 'bzb_jsxsd=fetch-session';
  s.sessionFromAllCookies = 'bzb_jsxsd=all-session';
  s.tgcFromRequestHeader = 'TGC=header-tgc';
  s.tgcFromFetchCookie = 'TGC=fetch-tgc';
  s.tgcFromAllCookies = 'TGC=all-tgc';
  const plan = planLoginCapture(true, s);
  assert.equal(plan.success, true);
  assert.equal(plan.successLayer, 'page-url');
  assert.equal(plan.sessionCookie, 'bzb_jsxsd=fetch-session');
  assert.equal(plan.sessionLayer, 'cookie-fetch');
  assert.equal(plan.tgc, 'TGC=fetch-tgc');
  assert.equal(plan.tgcLayer, 'cookie-fetch');

  const mixed = emptySources();
  mixed.sessionFromRequestHeader = 'bzb_jsxsd=header-session';
  mixed.sessionFromAllCookies = 'bzb_jsxsd=all-session';
  mixed.tgcFromRequestHeader = 'TGC=header-tgc';
  mixed.tgcFromAllCookies = 'TGC=all-tgc';
  const mixedPlan = planLoginCapture(true, mixed);
  assert.equal(mixedPlan.sessionLayer, 'cookie-all');
  assert.equal(mixedPlan.sessionCookie, 'bzb_jsxsd=all-session');
  assert.equal(mixedPlan.tgcLayer, 'cookie-all');
  assert.equal(mixedPlan.tgc, 'TGC=all-tgc');

  const headerOnly = emptySources();
  headerOnly.sessionFromRequestHeader = 'bzb_jsxsd=header-session';
  headerOnly.tgcFromRequestHeader = 'TGC=header-tgc';
  const headerPlan = planLoginCapture(true, headerOnly);
  assert.equal(headerPlan.sessionLayer, 'request-header');
  assert.equal(headerPlan.sessionCookie, 'bzb_jsxsd=header-session');
  assert.equal(headerPlan.tgcLayer, 'request-header');
  assert.equal(headerPlan.tgc, 'TGC=header-tgc');
});

test('login-detect-3) 三层全失败仍按 URL 判成功，但 session/TGC 层级为 none（静默重登降级）', () => {
  const plan = planLoginCapture(true, emptySources());
  assert.equal(plan.success, true);
  assert.equal(plan.successLayer, 'page-url');
  assert.equal(plan.sessionCookie, '');
  assert.equal(plan.sessionLayer, 'none');
  assert.equal(plan.tgc, '');
  assert.equal(plan.tgcLayer, 'none');
});

test('login-detect-4) URL 未命中时任何 cookie 都不判成功；extractSessionCookie 只取 bzb_jsxsd', () => {
  const s = emptySources();
  s.sessionFromRequestHeader = 'bzb_jsxsd=session';
  s.tgcFromRequestHeader = 'TGC=tgc';
  const plan = planLoginCapture(false, s);
  assert.equal(plan.success, false);
  assert.equal(plan.successLayer, 'none');
  assert.equal(plan.sessionCookie, 'bzb_jsxsd=session');
  assert.equal(plan.sessionLayer, 'request-header');

  assert.equal(extractSessionCookie('route=x; bzb_jsxsd=abc; other=y'), 'bzb_jsxsd=abc');
  assert.equal(extractSessionCookie('bzb_jsxsd=first; bzb_jsxsd=second'), 'bzb_jsxsd=first');
  assert.equal(extractSessionCookie('bzb_jsxsd_extra=x; TGC=t'), '');
  assert.equal(extractSessionCookie(''), '');
});
