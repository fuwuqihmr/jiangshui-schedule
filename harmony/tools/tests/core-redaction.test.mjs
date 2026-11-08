import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
const root = process.env.HARMONY_ROOT;
if (!tmp || !root) throw new Error('HARMONY_CORE_TMP/HARMONY_ROOT 未设置，请用 run-core-tests.mjs 运行');
// Redactor 合并为唯一一份 util/Redactor.ets；本测试自行复制，避免依赖 core-p4 先跑。
fs.mkdirSync(path.join(tmp, 'util'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'entry/src/main/ets/util/Redactor.ets'),
  path.join(tmp, 'util/Redactor.ts'),
);
const R = await import(pathToFileURL(path.join(tmp, 'util/Redactor.ts')).href);

test('19) redact-text：Cookie/TGC/ticket/token/pageEnc/uid/enc/fidEnc 片段被替换，普通文本不变', () => {
  const raws = [
    'Cookie: JSESSIONID=abc123; TGC=CASTGC-xyz',
    'Set-Cookie: bzb_jsxsd=secret; Path=/jsxsd',
    'ticket=ST-123456-abc',
    'token=eyJhbGciOiJIUzI1NiJ9.payload.sig',
    'pageEnc=AbC-123_x',
    'uid=1234567890',
    'enc=dGVzdA==',
    'fidEnc=ZmlkRW5j',
    'cookieHeader=bzb_jsxsd%3Dabc',
    'service=https://sso.example/cb?code=ABC',
  ];
  for (const raw of raws) {
    const out = R.redactText(raw);
    assert.ok(out.includes('[redacted]'), '未替换：' + raw);
    for (const leak of ['abc123', 'CASTGC-xyz', 'bzb_jsxsd=secret', 'ST-123456', 'eyJhbGciOiJIUzI1NiJ9', 'AbC-123_x', '1234567890', 'dGVzdA==', 'ZmlkRW5j', 'bzb_jsxsd%3Dabc', 'sso.example']) {
      if (raw.includes(leak)) assert.ok(!out.includes(leak), '泄漏 ' + leak + ' ← ' + raw);
    }
  }
  assert.equal(R.redactText(''), '');
  assert.equal(R.redactText('普通日志 3 门课'), '普通日志 3 门课');
  assert.equal(R.redactText('httpStatus=503 stage=rows'), 'httpStatus=503 stage=rows');
});

test('20) log-fields：只保留白名单键、非法 stage 丢弃、code 脱敏、数值截断', () => {
  const full = {
    stage: 'parse', code: 'SCHOOL_PARSE_FAILED', httpStatus: 503,
    durationMs: 12.9, bytes: 2048.7, ruleCount: 3, weekCount: 10, sessionPresent: true,
  };
  assert.deepEqual(R.logFields(full), { ...full, durationMs: 12, bytes: 2048 });
  const dirty = {
    ...full,
    stage: 'evil', cookie: 'bzb_jsxsd=abc', body: '<html>secret</html>',
    url: 'http://jiaowu/?uid=1234567890', cookieHeader: 'TGC=HEADER_SECRET', token: 'tok',
    code: 'ERR Cookie=CODE_SECRET',
  };
  const clean = R.logFields(dirty);
  const keys = Object.keys(clean).sort();
  assert.deepEqual(keys, ['bytes', 'code', 'durationMs', 'httpStatus', 'ruleCount', 'sessionPresent', 'weekCount']);
  assert.equal(clean.stage, undefined);
  assert.equal(clean.code.includes('[redacted]'), true);
  assert.equal(JSON.stringify(clean).includes('CODE_SECRET'), false, 'code 中的 Cookie 值必须脱敏');
  assert.equal(JSON.stringify(clean).includes('HEADER_SECRET'), false, 'header 秘密不得进入日志');
  assert.equal(JSON.stringify(clean).includes('1234567890'), false);
  assert.equal(JSON.stringify(clean).includes('bzb_jsxsd=abc'), false);
  assert.equal(JSON.stringify(clean).includes('<html>'), false);
});