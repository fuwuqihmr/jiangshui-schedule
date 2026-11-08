// 登录成功判定分层、无痕 cookie 读取与清理的静态回归（不编译、不联网）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.HARMONY_ROOT;
if (!root) throw new Error('HARMONY_ROOT 未设置，请用 run-core-tests.mjs 运行');
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('login layers: fetchCookie -> fetchAllCookies -> 请求头，且成功判定走 page-url', () => {
  const school = read('entry/src/main/ets/platform/web/SchoolLoginWebView.ets');
  assert.match(school, /onLoadIntercept/);
  assert.match(school, /isMainFrame\(\)/);
  assert.match(school, /getRequestHeader\(\)/);
  assert.match(school, /extractSessionCookie/);
  assert.match(school, /extractTicketGrantingCookie/);
  assert.match(school, /cookieHeaderForAll\(JIAOWU_HTTP\)/);
  assert.match(school, /cookieHeaderForAll\(CAS_LOGIN\)/);
  assert.match(school, /isSchoolLoginSuccessParts\(parts\.scheme, parts\.host, parts\.port, parts\.path\)/);
  assert.match(school, /planLoginCapture\(true, sources\)/);
  assert.match(school, /tgc-capture miss layer=none/);
  assert.match(school, /session-capture miss layer=none/);
  assert.match(school, /login-success layer=/);
  assert.match(school, /session-save-failed/);
  assert.match(school, /sessionPresent: sessionSaved/);
  // 旧单点判定不得回归；Cookie 原文不得进入 Logger。
  assert.equal(/checkLoginCookie/.test(school), false);
  const model = read('entry/src/main/ets/core/viewmodel/WebEntryViewModel.ets');
  const urls = read('entry/src/main/ets/core/parser/SchoolUrls.ets');
  for (const literal of ['/jsxsd/framework/xsMainV.htmlx', '/jsxsd/xskb/xskb_list.do']) {
    assert.equal(model.includes(literal), true, literal);
    assert.equal(urls.includes(literal), true, literal);
  }
  const loggerLines = school.split('\n').filter((line) => line.includes('Logger'));
  assert.equal(loggerLines.some((line) => line.includes('headerValue')), false);
});

test('login layers: cookie 存储暴露 fetchAllCookies 过滤接口，清理显式覆盖无痕 jar', () => {
  const cookies = read('entry/src/main/ets/platform/web/WebCookieStore.ets');
  assert.match(cookies, /fetchAllCookies\(useIncognito\)/);
  assert.match(cookies, /cookieHeaderForAll\(url: string, incognito\?: boolean\)/);
  assert.match(cookies, /cookieDomainMatches/);
  assert.match(cookies, /cookiePathMatches/);

  const cleaner = read('entry/src/main/ets/platform/web/WebDataCleaner.ets');
  assert.match(cleaner, /clearAllCookiesSync\(false\)/);
  assert.match(cleaner, /clearAllCookiesSync\(true\)/);
  assert.match(cleaner, /WebStorage\.deleteAllData\(true\)/);
  assert.match(cleaner, /clearLoginSessionData\(context: object\)/);
  assert.match(cleaner, /cookiesCleared: normalCookiesCleared && incognitoCookiesCleared/);
  assert.match(cleaner, /storageCleared: normalStorageCleared && incognitoStorageCleared/);
});
