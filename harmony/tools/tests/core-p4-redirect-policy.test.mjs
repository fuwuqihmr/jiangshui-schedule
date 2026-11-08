// CAS 成功回跳被自家白名单拦截的回归（纯逻辑；不依赖 HarmonyOS SDK / 真机）。
// 真实链路：https:81/sso.jsp -> CAS eapp2:9443 -> http:80/sso.jsp?ticket=... -> https:443/sso.jsp
// -> http:8080/jsxsd/xk/LoginToXk -> http:8080/jsxsd/framework/xsMainV.htmlx。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');
const U = await import(pathToFileURL(path.join(tmp, 'core/parser/SchoolUrls.ts')).href);

test('redirect-policy: jiaowu 四个同校 origin 放行 sso.jsp 与 jsxsd，路径/端口仍受限', () => {
  const allowed = [
    'https://jiaowu.juwp.edu.cn:81/sso.jsp',
    'http://jiaowu.juwp.edu.cn/sso.jsp',
    'http://jiaowu.juwp.edu.cn/sso.jsp?ticket=ST-demo',
    'https://jiaowu.juwp.edu.cn/sso.jsp?ticket=ST-demo',
    'http://jiaowu.juwp.edu.cn:8080/jsxsd/framework/xsMainV.htmlx',
    'http://jiaowu.juwp.edu.cn/jsxsd/xk/LoginToXk',
    'https://jiaowu.juwp.edu.cn/jsxsd/xskb/xskb_list.do?viweType=1',
    'https://jiaowu.juwp.edu.cn:81/jsxsd/xskb/xskb_list.do',
    'http://jiaowu.juwp.edu.cn/',
    'http://jiaowu.juwp.edu.cn:8080/',
    'https://jiaowu.juwp.edu.cn/jsxsd',
  ];
  for (const url of allowed) {
    assert.equal(U.isAllowedSchoolUrl(url), true, 'allowed: ' + url);
  }
  const blocked = [
    'http://jiaowu.juwp.edu.cn:8081/jsxsd/x',
    'https://jiaowu.juwp.edu.cn:9443/sso.jsp',
    'http://jiaowu.juwp.edu.cn:8080/anything',
    'https://jiaowu.juwp.edu.cn/cas/login',
    'https://evil-jiaowu.juwp.edu.cn:8080/jsxsd/x',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://jiaowu.juwp.edu.cn/abc',
    'ftp://jiaowu.juwp.edu.cn/sso.jsp',
  ];
  for (const url of blocked) {
    assert.equal(U.isAllowedSchoolUrl(url), false, 'blocked: ' + url);
  }
  assert.equal(U.schoolUrlBlockReason('http://jiaowu.juwp.edu.cn:8081/jsxsd/x'), 'port');
  assert.equal(U.schoolUrlBlockReason('http://jiaowu.juwp.edu.cn:8080/anything'), 'path');
  assert.equal(U.schoolUrlBlockReason('javascript:alert(1)'), 'scheme');
  assert.equal(U.schoolUrlBlockReason('https://evil.example/x'), 'host');
});

test('redirect-policy: 重定向跟随只认同校 origin，默认 80/443 与 8080/81 都覆盖', () => {
  const allowed = [
    'http://jiaowu.juwp.edu.cn',
    'http://jiaowu.juwp.edu.cn:8080/anything',
    'https://jiaowu.juwp.edu.cn',
    'https://jiaowu.juwp.edu.cn:81/anything',
    'https://eapp2.juwp.edu.cn:9443/cas/login',
    'https://eapp2.nit.edu.cn:9443/cas/login',
    'https://portal.juwp.edu.cn/',
    'https://jiaowuh5.juwp.edu.cn/',
  ];
  for (const url of allowed) {
    assert.equal(U.isAllowedSchoolRedirect(url), true, 'redirect allowed: ' + url);
  }
  const blocked = [
    'http://jiaowu.juwp.edu.cn:8081/x',
    'https://jiaowu.juwp.edu.cn:9443/x',
    'http://eapp2.juwp.edu.cn:9443/cas/login',
    'https://eapp2.juwp.edu.cn:443/cas/login',
    'https://eapp2.juwp.edu.cn:9443.evil.example/x',
    'https://evil.example/cas/login',
    'javascript:alert(1)',
    'blob:https://jiaowu.juwp.edu.cn/abc',
  ];
  for (const url of blocked) {
    assert.equal(U.isAllowedSchoolRedirect(url), false, 'redirect blocked: ' + url);
  }
});

test('redirect-policy: origin 单一真源包含默认端口，课表判定覆盖四个 jiaowu origin', () => {
  assert.deepEqual(U.SCHOOL_REDIRECT_ORIGINS, [
    'http://jiaowu.juwp.edu.cn',
    'http://jiaowu.juwp.edu.cn:8080',
    'https://jiaowu.juwp.edu.cn',
    'https://jiaowu.juwp.edu.cn:81',
    'https://eapp2.juwp.edu.cn:9443',
    'https://eapp2.nit.edu.cn:9443',
    'https://portal.juwp.edu.cn',
    'https://jiaowuh5.juwp.edu.cn',
  ]);
  assert.equal(U.isJiaowuTimetableUrl('http://jiaowu.juwp.edu.cn:8080/jsxsd/xskb/xskb_list.do?viweType=1'), true);
  assert.equal(U.isJiaowuTimetableUrl('http://jiaowu.juwp.edu.cn/jsxsd/xskb/xskb_list.do?viweType=1'), true);
  assert.equal(U.isJiaowuTimetableUrl('https://jiaowu.juwp.edu.cn/jsxsd/xskb/xskb_list.do?viweType=1'), true);
  assert.equal(U.isJiaowuTimetableUrl('https://jiaowu.juwp.edu.cn:81/jsxsd/xskb/xskb_list.do?viweType=1'), true);
  assert.equal(U.isJiaowuTimetableUrl('http://jiaowu.juwp.edu.cn:8081/jsxsd/xskb/xskb_list.do'), false);
  assert.equal(U.isJiaowuTimetableUrl('https://eapp2.juwp.edu.cn:9443/jsxsd/xskb/xskb_list.do'), false);
});
