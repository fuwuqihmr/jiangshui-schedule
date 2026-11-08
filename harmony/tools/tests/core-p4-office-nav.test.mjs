// 学工 WebView 导航决策回归（纯逻辑；不依赖 HarmonyOS SDK / 真机）。
// 覆盖：无 UID 先 warmup、有 UID 直接 target、登录后 retarget 一次、申请页不重载、非白名单不放行。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');
const W = await import(pathToFileURL(path.join(tmp, 'core/viewmodel/WebEntryViewModel.ts')).href);

const TARGET = 'https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425';
const WARMUP = 'https://xgxt.juwp.edu.cn/sfrz/login343962';

function state(over = {}) {
  return {
    targetUrl: TARGET,
    warmupUrl: WARMUP,
    targetRequested: false,
    warmupLoaded: false,
    retargetTried: false,
    hasUid: false,
    isApplyPage: false,
    ...over
  };
}

test('office-nav: no UID starts with warmup, not target', () => {
  assert.equal(W.decideOfficeNav(state()), 'load-warmup');
});

test('office-nav: existing UID goes straight to target', () => {
  assert.equal(W.decideOfficeNav(state({ hasUid: true })), 'load-target');
});

test('office-nav: while warmup is loading / login pending stay put', () => {
  assert.equal(W.decideOfficeNav(state({ warmupLoaded: true })), 'none');
  assert.equal(W.decideOfficeNav(state({ targetRequested: true })), 'none');
});

test('office-nav: after login UID appears, retarget once from CAS/xgxt page', () => {
  assert.equal(W.decideOfficeNav(state({ hasUid: true, warmupLoaded: true })), 'load-target');
  assert.equal(W.decideOfficeNav(state({ hasUid: true, targetRequested: true, retargetTried: true })), 'none');
});

test('office-nav: already on apply page never reloads', () => {
  assert.equal(W.decideOfficeNav(state({ hasUid: true, isApplyPage: true })), 'none');
  assert.equal(W.decideOfficeNav(state({ isApplyPage: true, warmupLoaded: true })), 'none');
});

test('office-nav: invalid target is blocked before any cookie/navigation logic', () => {
  assert.equal(W.decideOfficeNav(state({ targetUrl: 'https://evil.example/openPcApp' })), 'none');
  assert.equal(W.decideOfficeNav(state({ targetUrl: 'http://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425' })), 'none');
});

test('office-nav: invalid warmup falls back to target, never to a non-whitelisted URL', () => {
  assert.equal(W.decideOfficeNav(state({ warmupUrl: 'https://evil.example/login' })), 'load-target');
  assert.equal(W.decideOfficeNav(state({ warmupUrl: '' })), 'load-target');
});

