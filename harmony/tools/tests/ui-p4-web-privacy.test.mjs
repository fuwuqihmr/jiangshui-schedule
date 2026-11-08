// 两个登录 WebView 的隐私配置与错误页诊断静态回归（不编译、不联网）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.HARMONY_ROOT;
if (!root) throw new Error('HARMONY_ROOT 未设置，请用 run-core-tests.mjs 运行');
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('web privacy: both login WebViews disable autofill and enable diagnostics', () => {
  const school = read('entry/src/main/ets/platform/web/SchoolLoginWebView.ets');
  const office = read('entry/src/main/ets/platform/web/OfficeWebView.ets');
  for (const src of [school, office]) {
    assert.match(src, /\.enableAutoFill\(false\)/);
    assert.match(src, /incognitoMode: true/);
    assert.match(src, /new PlatformWebCookieStore\(true\)/);
    assert.match(src, /detectWebPageIssue/);
    assert.match(src, /page-error kind=/);
  }
  assert.match(school, /\.domStorageAccess\(true\)/);
  assert.match(office, /\.javaScriptAccess\(true\)/);
  assert.match(office, /\.domStorageAccess\(true\)/);
});

test('web privacy: cleaner exposes cookie/storage/http-auth cleanup only', () => {
  const src = read('entry/src/main/ets/platform/web/WebDataCleaner.ets');
  assert.match(src, /clearAllCookies/);
  assert.match(src, /WebStorage\.deleteAllData/);
  assert.match(src, /WebDataBase\.deleteHttpAuthCredentials/);
  assert.equal(/console\./.test(src), false);
});
