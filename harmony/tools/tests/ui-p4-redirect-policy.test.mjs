// 登录重定向策略的静态回归（不编译、不联真机）。
// 目的：锁住“同校域默认 80/443 放行、跨域仍拦、ticket 不进日志、单一真源”不被后续改回。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.HARMONY_ROOT;
if (!root) throw new Error('HARMONY_ROOT 未设置，请用 run-core-tests.mjs 运行');
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('redirect-policy UI: 主帧重定向用 isRedirect 判定，放行/拦截都留 reason 且不记 ticket', () => {
  const school = read('entry/src/main/ets/platform/web/SchoolLoginWebView.ets');
  assert.match(school, /event\.data\.isRedirect\(\)/);
  assert.equal(/isServerRedirect/.test(school), false, 'ArkWeb 没有 isServerRedirect API');
  assert.match(school, /school-web blocked reason=/);
  assert.match(school, /school-web redirect allowed rule=/);
  assert.match(school, /policy\.blockReason\(target\)/);
  assert.match(school, /mainFrame && redirected && this\.policy\.isAllowedRedirect\(target\)/);
  assert.match(school, /JIAOWU_SESSION_URL/);
  assert.match(school, /cookieHeaderForAll\(JIAOWU_HTTP\)/);
  assert.match(school, /incognitoMode: true/);
  assert.match(school, /enableAutoFill\(false\)/);
  assert.equal(/Logger[\s\S]{0,120}ticket=/.test(school), false, 'ticket 不得进入日志');
});

test('redirect-policy UI: HttpGateway/换票/重读共用同一 origin 真源，cookie 白名单含默认端口', () => {
  const reader = read('entry/src/main/ets/platform/school/SchoolReader.ets');
  assert.match(reader, /SCHOOL_REDIRECT_ORIGINS as CORE_REDIRECT_ORIGINS/);
  assert.match(reader, /export const SCHOOL_REDIRECT_ORIGINS: string\[\] = CORE_REDIRECT_ORIGINS;/);

  const relogin = read('entry/src/main/ets/platform/school/SchoolRelogin.ets');
  assert.match(relogin, /RELOGIN_REDIRECT_ORIGINS: string\[\] = CORE_REDIRECT_ORIGINS;/);
  assert.match(relogin, /allowedRedirectOrigins: RELOGIN_REDIRECT_ORIGINS/);

  const cookies = read('entry/src/main/ets/platform/web/WebCookieStore.ets');
  assert.match(cookies, /'http:\/\/jiaowu\.juwp\.edu\.cn',/);
  assert.match(cookies, /'https:\/\/jiaowu\.juwp\.edu\.cn',/);

  const policy = read('entry/src/main/ets/platform/web/SchoolUrlPolicy.ets');
  assert.match(policy, /schoolUrlBlockReason/);
  assert.match(policy, /blockReason\(url: string\): string/);
});
