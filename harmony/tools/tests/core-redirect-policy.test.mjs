import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');
const R = await import(pathToFileURL(path.join(tmp, 'core/network/RedirectPolicy.ts')).href);

// 与 platform/school 的 SCHOOL_REDIRECT_HOSTS 同口径的测试白名单。
const WHITE = [
  'jiaowu.juwp.edu.cn:8080',
  'jiaowu.juwp.edu.cn:81',
  'eapp2.juwp.edu.cn:9443',
  'xgxt.juwp.edu.cn',
];

// 直接搬 implementer-d 的 21 条探针（17 条 canonical + 4 条 allowed），断言写实。
const canonicalCases = [
  ['https://jiaowu.juwp.edu.cn:8080/jsxsd/x?y=1', 'jiaowu.juwp.edu.cn:8080'],
  ['https://evil.example\\@jiaowu.juwp.edu.cn:8080/x', ''],
  ['https://evil.example\\\\@jiaowu.juwp.edu.cn:8080/x', ''],
  ['https://user:pass@jiaowu.juwp.edu.cn:8080/x', ''],
  ['https://jiaowu.juwp.edu.cn./x', ''],
  ['https://JIAOWU.JUWP.EDU.CN:8080/X', 'jiaowu.juwp.edu.cn:8080'],
  ['http://jiaowu.juwp.edu.cn/jsxsd/', 'jiaowu.juwp.edu.cn'],
  ['https://jiaowu.juwp.edu.cn:443/x', 'jiaowu.juwp.edu.cn'],
  ['https://jiaowu.juwp.edu.cn:81/jsxsd/login', 'jiaowu.juwp.edu.cn:81'],
  ['https://jiaowu.juwp.edu.cn:65536/', ''],
  ['//evil.example/x', ''],
  ['javascript:alert(1)', ''],
  ['https://[::1]:8080/', ''],
  ['https://jiaowu%2Ejuwp.edu.cn/x', ''],
  ['https://evil.example\t@jiaowu.juwp.edu.cn:8080/x', ''],
  ['https://jiaowu.juwp.edu.cn:8080/x y', ''],
  ['ftp://jiaowu.juwp.edu.cn:8080/x', ''],
];

test('redirect-policy: 21 条探针（canonicalHostOf）', () => {
  for (const [url, want] of canonicalCases) {
    assert.equal(R.canonicalHostOf(url), want, url);
  }
});

const allowedCases = [
  ['https://jiaowu.juwp.edu.cn:8080/jsxsd/x', true],
  ['https://evil.example/x', false],
  ['https://jiaowu.juwp.edu.cn/x', false],
  ['https://xgxt.juwp.edu.cn/cas/login', true],
];

test('redirect-policy: 21 条探针（isRedirectHostAllowed）', () => {
  for (const [url, want] of allowedCases) {
    assert.equal(R.isRedirectHostAllowed(url, WHITE), want, url);
  }
});

test('redirect-policy: 任务列出的放行 host/端口/大小写', () => {
  const allowed = [
    'https://jiaowu.juwp.edu.cn:8080/x',
    'https://eapp2.juwp.edu.cn:9443/cas',
    'https://xgxt.juwp.edu.cn/office',
    'http://jiaowu.juwp.edu.cn:8080',
    'https://JIAOWU.JUWP.EDU.CN:8080/X',
  ];
  for (const url of allowed) assert.equal(R.isRedirectHostAllowed(url, WHITE), true, url);
});

test('redirect-policy: 默认端口规范化（https:443 / http:80 去掉端口）', () => {
  assert.equal(R.canonicalHostOf('https://jiaowu.juwp.edu.cn:443'), 'jiaowu.juwp.edu.cn');
  assert.equal(R.canonicalHostOf('https://jiaowu.juwp.edu.cn:443/X'), 'jiaowu.juwp.edu.cn');
  assert.equal(R.canonicalHostOf('http://jiaowu.juwp.edu.cn:80/x'), 'jiaowu.juwp.edu.cn');
  // 白名单只有 jiaowu:8080/:81；:443 规范化去端口后不再命中，false 是正确的：
  // 学校站点就是 http+8080/81，避免用 https 降级或端口混淆。
  assert.equal(R.isRedirectHostAllowed('https://jiaowu.juwp.edu.cn:443', WHITE), false);
  assert.equal(R.isRedirectHostAllowed('http://jiaowu.juwp.edu.cn:80/x', WHITE), false);
});

test('redirect-policy: 任务列出的拒绝形态（userinfo/反斜杠/相对/编码/尾点/IPv6/控制字符）', () => {
  const rejected = [
    'https://evil.example\\@jiaowu.juwp.edu.cn:8080/x',
    'https://evil.example\\\\@jiaowu.juwp.edu.cn:8080/x',
    'https://user:pass@jiaowu.juwp.edu.cn:8080/x',
    '//evil.com',
    'http:/evil',
    'https://jiaowu%2Ejuwp.edu.cn/x',
    'https://jiaowu.juwp.edu.cn./x',
    'https://[::1]:8080/',
    'https:///x',
    'https://jiaowu.juwp.edu.cn:65536/',
    'ftp://jiaowu.juwp.edu.cn:8080/x',
    'javascript:alert(1)',
    'https://evil.example\t@jiaowu.juwp.edu.cn:8080/x',
    'https://jiaowu.juwp.edu.cn:8080/x y',
    'https://jiaowu.juwp.edu.cn:8080/x\u0000',
    'https://jiaowu.juwp.edu.cn:8080/x\u001f',
  ];
  for (const url of rejected) {
    assert.equal(R.isRedirectHostAllowed(url, WHITE), false, url);
  }
});

test('redirect-policy: 超长 host 不得命中白名单', () => {
  const longHost = 'a'.repeat(300) + '.jiaowu.juwp.edu.cn';
  assert.equal(R.isRedirectHostAllowed('https://' + longHost + ':8080/x', WHITE), false);
});

test('redirect-policy: 每跳与首跳校验、5 跳上限在 HttpGateway 静态契约里', () => {
  const gateway = fs.readFileSync(
    path.join(process.env.HARMONY_ROOT, 'entry/src/main/ets/platform/network/HttpGateway.ets'),
    'utf8',
  );
  assert.match(gateway, /MAX_REDIRECTS:\s*number\s*=\s*5/);
  assert.match(gateway, /hop >= MAX_REDIRECTS/);
  assert.match(gateway, /canonicalHostOf\(currentUrl\)\.length === 0/, '首跳要校验 URL 形态');
  assert.match(gateway, /isRedirectHostAllowed\(next, allowed\)/, '每跳都要校验白名单');
  assert.match(gateway, /hop = hop \+ 1/);
});
