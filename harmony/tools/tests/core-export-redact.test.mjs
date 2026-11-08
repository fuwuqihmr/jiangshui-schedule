import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
const root = process.env.HARMONY_ROOT;
if (!tmp || !root) throw new Error('HARMONY_CORE_TMP/HARMONY_ROOT 未设置，请用 run-core-tests.mjs 运行');

// util/Redactor 不在 core 复制范围，本测试自行复制（与 core-redaction.test.mjs 同法）。
fs.mkdirSync(path.join(tmp, 'util'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'entry/src/main/ets/util/Redactor.ets'),
  path.join(tmp, 'util/Redactor.ts'),
);
const R = await import(pathToFileURL(path.join(tmp, 'util/Redactor.ts')).href);
const D = await import(pathToFileURL(path.join(tmp, 'core/export/DiagnosticsReport.ts')).href);

const diagnosticsCopy = {
  title: 'DIAG',
  generatedAt: 'AT {0}',
  appVersion: 'APP {0}',
  systemVersion: 'SYS {0}',
  apiVersion: 'API {0}',
  stateRevision: 'REV {0}',
  lastSyncAt: 'SYNC {0}',
  lastAttempt: 'TRY {0}',
  sectionEvents: 'EVENTS',
  sectionSources: 'SOURCES',
  none: 'NONE',
  unknownValue: '?',
  eventLine: 'E{0} {1}',
  sourceLine: 'S{0} {1}',
  truncatedNote: 'TRUNC {0}/{1}',
};

test('export-redact-1 redactText 对 Cookie/session/token/uid 样本零泄漏', () => {
  const samples = [
    'Cookie: JSESSIONID=abc123; TGC=CASTGC-xyz',
    'Set-Cookie: bzb_jsxsd=secret; Path=/jsxsd',
    'authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig',
    'token=eyJhbGciOiJIUzI1NiJ9.payload.sig',
    'ticket=ST-123456-abc',
    'uid=1234567890',
    'sessionId=deadbeef',
  ];
  for (const sample of samples) {
    const out = D.redactDiagnosticsLine(sample, R.redactText);
    assert.ok(out.indexOf('abc123') < 0, 'JSESSIONID 值泄漏：' + sample);
    assert.ok(out.indexOf('CASTGC-xyz') < 0, 'TGC 值泄漏：' + sample);
    assert.ok(out.indexOf('secret') < 0, 'Cookie 值泄漏：' + sample);
    assert.ok(out.indexOf('eyJhbGci') < 0, 'token 值泄漏：' + sample);
    assert.ok(out.indexOf('ST-123456') < 0, 'ticket 值泄漏：' + sample);
    assert.ok(out.indexOf('1234567890') < 0, 'uid/学号值泄漏：' + sample);
    assert.ok(out.indexOf('deadbeef') < 0, 'session 值泄漏：' + sample);
  }
  assert.ok(D.redactDiagnosticsLine('普通日志 2026-10-30 导出成功', R.redactText).indexOf('导出成功') > 0);
  assert.equal(D.redactDiagnosticsLine('', R.redactText), '');
});

test('export-redact-2 诊断文本经 redactText 后不含敏感原文，密钥替换为 [redacted]', () => {
  const input = {
    appVersion: '1.0.0',
    systemVersion: 'HarmonyOS 5',
    apiVersion: '12',
    stateRevision: 7,
    lastSyncAt: '2026-10-30T08:00:00.000Z',
    lastAttempt: '',
    events: [
      'Cookie: JSESSIONID=abc123; TGC=CASTGC-xyz',
      'token=eyJhbGciOiJIUzI1NiJ9.payload.sig uid=1234567890',
    ],
    sources: ['https://example.test/api?ticket=ST-123456-abc&ok=1'],
  };
  const text = D.buildDiagnosticsText(input, diagnosticsCopy, Date.UTC(2026, 9, 30, 8, 0), 480, R.redactText, 200000);
  for (const secret of ['abc123', 'CASTGC-xyz', 'eyJhbGci', '1234567890', 'ST-123456']) {
    assert.ok(text.indexOf(secret) < 0, '诊断文本泄漏敏感值：' + secret);
  }
  assert.ok(text.indexOf('[redacted]') >= 0, '应出现 [redacted] 占位');
});

test('export-redact-3 诊断导出输入是白名单字段，不含学生档案/姓名/学号', () => {
  const workflow = fs.readFileSync(path.join(root, 'entry/src/main/ets/features/export/ExportWorkflow.ets'), 'utf8');
  const start = workflow.indexOf('const input: DiagnosticsInput = {');
  assert.ok(start > 0, 'exportDiagnostics 必须显式构造 DiagnosticsInput');
  const body = workflow.slice(start, workflow.indexOf('};', start));
  for (const key of ['appVersion', 'systemVersion', 'apiVersion', 'stateRevision', 'lastSyncAt', 'events', 'sources']) {
    assert.ok(body.indexOf(key) >= 0, 'DiagnosticsInput 缺少字段：' + key);
  }
  for (const forbidden of ['studentProfile', 'studentId', 'studentName', 'realName', 'snapshot.name', 'state.snapshot']) {
    assert.ok(body.indexOf(forbidden) < 0, '诊断文本不得包含学生身份字段：' + forbidden);
  }
});
