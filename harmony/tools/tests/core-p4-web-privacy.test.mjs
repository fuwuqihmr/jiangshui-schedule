// 网页错误页特征与入口消歧回归（纯逻辑；不依赖 HarmonyOS SDK / 真机）。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');
const W = await import(pathToFileURL(path.join(tmp, 'core/viewmodel/WebEntryViewModel.ts')).href);
const S = await import(pathToFileURL(path.join(tmp, 'core/parser/SchoolUrls.ts')).href);

test('web-page-issue: ordinary page is none', () => {
  assert.equal(W.detectWebPageIssue('请假申请', '填写申请信息', 200), 'none');
});

test('web-page-issue: OOPS title/body is site-error', () => {
  assert.equal(W.detectWebPageIssue('OOPS!', '', 200), 'site-error');
  assert.equal(W.detectWebPageIssue('', 'The webmaster said that you can not enter this page...', 200), 'site-error');
});

test('web-page-issue: 401/403 and access-denied text are permission', () => {
  assert.equal(W.detectWebPageIssue('', '', 401), 'permission');
  assert.equal(W.detectWebPageIssue('', '', 403), 'permission');
  assert.equal(W.detectWebPageIssue('', 'Access Denied', 200), 'permission');
});

test('web-page-issue: 5xx is site-error, case insensitive', () => {
  assert.equal(W.detectWebPageIssue('', '', 500), 'site-error');
  assert.equal(W.detectWebPageIssue('Oops', '', 200), 'site-error');
});

test('web-entry: xgxt alias is not the jiaowu SSO source', () => {
  assert.equal(W.XGXT_SSO_ENTRY, W.SSO_ENTRY);
  assert.ok(W.XGXT_SSO_ENTRY.startsWith('https://xgxt.juwp.edu.cn/'));
  assert.ok(S.SSO_ENTRY.startsWith('https://jiaowu.juwp.edu.cn:81/'));
  assert.notEqual(W.XGXT_SSO_ENTRY, S.SSO_ENTRY);
});

test('web-entry: whitelist still rejects http and evil hosts', () => {
  assert.equal(W.isAllowedWebUrl('https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425'), true);
  assert.equal(W.isAllowedWebUrl('https://evil.example/openPcApp'), false);
  assert.equal(W.isAllowedWebUrl('http://xgxt.juwp.edu.cn/'), false);
});
