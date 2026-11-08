#!/usr/bin/env node
/**
 * 静态回归：Office WebView 必须落可诊断日志，且所有 URL/标题先脱敏。
 * 无 SDK，只读源码做结构断言；不编译、不运行 ArkUI。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.HARMONY_ROOT || path.resolve(process.cwd());
const VIEW = path.join(ROOT, 'entry/src/main/ets/platform/web/OfficeWebView.ets');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('Office Web 诊断：四类事件 + 最终 URL/标题 + 统一前缀 + 脱敏', () => {
  const view = read(VIEW);
  for (const token of [
    'onErrorReceive',
    'onHttpErrorReceive',
    'onSslErrorEventReceive',
    'onLoadIntercept',
    'getErrorCode',
    'getErrorInfo',
    'getResponseCode',
    'getReasonMessage',
    'getRequestUrl',
    'isMainFrame',
    'getTitle',
    'handleCancel',
    'school-web',
    'page-end',
    "allowed="
  ]) {
    assert.ok(view.includes(token), 'missing diagnostic token: ' + token);
  }
  // 诊断必须经 util/Logger（禁止在组件里直接 console），URL/标题必须先脱敏。
  assert.ok(view.includes("from '../../util/Logger'"), 'diagnostics must use the shared Logger');
  assert.ok(view.includes("from '../../util/Redactor'"), 'diagnostics must use the shared redactor');
  assert.ok(view.includes('Logger.info('), 'diagnostics must go through Logger.info');
  assert.ok(!/console\./.test(view), 'OfficeWebView must not call console directly');
  assert.ok(/redactUrl\((finalUrl|url)\)/.test(view), 'page-end URL must be redacted');
  assert.ok(view.includes('redactLine(title)'), 'page title must be redacted');
  assert.ok(view.includes('redactUrl(event.request.getRequestUrl())'), 'request URL must be redacted');
  assert.ok(view.includes('redactUrl(event.url)'), 'page-begin URL must be redacted');
});