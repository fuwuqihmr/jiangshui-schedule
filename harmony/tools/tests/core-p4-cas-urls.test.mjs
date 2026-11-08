// CAS 登录链路的白名单 / 重定向 / service 回归（纯逻辑；不依赖 HarmonyOS SDK / 真机）。
// 覆盖：xgxt 与 eapp2:9443 放行、非白名单/降级 http 拒绝、CAS service 参数提取。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');
const W = await import(pathToFileURL(path.join(tmp, 'core/viewmodel/WebEntryViewModel.ts')).href);
const U = await import(pathToFileURL(path.join(tmp, 'core/parser/SchoolUrls.ts')).href);

const XGXT_LOGIN = 'https://xgxt.juwp.edu.cn/sfrz/login343962';
const CAS_LOGIN = 'https://eapp2.juwp.edu.cn:9443/cas/login?service=https%3A%2F%2Fxgxt.juwp.edu.cn%2Fsfrz%2Flogin343962';

test('cas-urls: xgxt login and CAS login are whitelisted, evil/http are not', () => {
  assert.equal(W.isAllowedWebUrl(XGXT_LOGIN), true);
  assert.equal(W.isAllowedWebUrl(CAS_LOGIN), true);
  assert.equal(W.isAllowedWebUrl('https://eapp2.nit.edu.cn:9443/cas/login'), true);
  assert.equal(W.isAllowedWebUrl('http://eapp2.juwp.edu.cn:9443/cas/login'), false);
  assert.equal(W.isAllowedWebUrl('https://evil.example/cas/login'), false);
  assert.equal(W.isAllowedWebUrl('https://eapp2.juwp.edu.cn.evil.example/cas/login'), false);
});

test('cas-urls: CAS redirect stays on eapp2:9443 and never downgrades to http', () => {
  assert.equal(U.isAllowedSchoolRedirect(CAS_LOGIN), true);
  assert.equal(U.isAllowedSchoolRedirect('https://eapp2.juwp.edu.cn:9443/cas/login'), true);
  assert.equal(U.isAllowedSchoolRedirect('http://eapp2.juwp.edu.cn:9443/cas/login'), false);
  assert.equal(U.isAllowedSchoolRedirect('https://eapp2.juwp.edu.cn:443/cas/login'), false);
  assert.equal(U.isAllowedSchoolRedirect('https://evil.example/cas/login'), false);
  assert.equal(U.isAllowedSchoolUrl(CAS_LOGIN), true);
});

test('cas-urls: service parameter is extracted only from the CAS query', () => {
  const service = 'https%3A%2F%2Fxgxt.juwp.edu.cn%2Fsfrz%2Flogin343962';
  assert.equal(U.extractServiceParam(CAS_LOGIN), service);
  assert.equal(U.extractServiceParam('https://eapp2.juwp.edu.cn:9443/cas/login'), null);
  assert.equal(U.extractServiceParam('https://eapp2.juwp.edu.cn:9443/cas/login?service2=x'), null);
  assert.equal(U.extractServiceParam('https://eapp2.juwp.edu.cn:9443/cas/login?service=' + service + '#frag'), service);
});
