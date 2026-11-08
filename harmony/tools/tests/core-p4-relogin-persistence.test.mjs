#!/usr/bin/env node
/**
 * 纯逻辑：PlatformSchoolRelogin 的固定 CAS service 换票、302 ticket 判定、持久化 TGC 回落/刷新/清理与单飞。
 * 与版本的区别：不再手写 SchoolUrls 桩；直接复制真实 core/parser/SchoolUrls.ets，
 * 并让假 HTTP 返回真实 sso.jsp(200+JS) / CAS(302 ticket) / 登录表单 三种形状。
 * 不访问真实网络，不依赖 HarmonyOS SDK；由 run-core-tests.mjs 收集。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const harmonyRoot = process.env.HARMONY_ROOT;
if (!harmonyRoot) throw new Error('HARMONY_ROOT 未设置，请用 run-core-tests.mjs 运行');
const etsRoot = path.join(harmonyRoot, 'entry/src/main/ets');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'harmony-relogin-persist-'));

function writeFile(rel, text) {
  const full = path.join(sandbox, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function copySource(rel) {
  const from = path.join(etsRoot, rel);
  const to = path.join(sandbox, rel.slice(0, -4) + '.ts');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function rewriteImports(file) {
  let text = fs.readFileSync(file, 'utf8');
  text = text.replace(/(from\s*['"])(\.{1,2}\/[^'"]+)(['"])/g, (whole, pre, spec, post) => {
    let next = spec;
    if (next.endsWith('.ets')) {
      next = next.slice(0, -4) + '.ts';
    } else if (!next.endsWith('.ts')) {
      const abs = path.resolve(path.dirname(file), next);
      if (fs.existsSync(abs + '.ts')) next = next + '.ts';
    }
    return pre + next + post;
  });
  fs.writeFileSync(file, text);
}

writeFile('core/types/Common.ts', [
  'export const ErrorCode = {',
  "  WEB_UNAVAILABLE: 'WEB_UNAVAILABLE',",
  "  STATE_WRITE_FAILED: 'STATE_WRITE_FAILED',",
  "  PREFERENCES_UNAVAILABLE: 'PREFERENCES_UNAVAILABLE'",
  '};',
  ''
].join('\n'));

// 真实常量，不再手写 SSO_ENTRY/extractServiceParam/isAllowedSchoolRedirect 宽松桩。
copySource('core/parser/SchoolUrls.ets');

writeFile('data/SchoolReadOrchestrator.ts', [
  "export const SCHOOL_LOGIN_REQUIRED = 'SCHOOL_LOGIN_REQUIRED';",
  "export const SCHOOL_CAPTCHA_REQUIRED = 'SCHOOL_CAPTCHA_REQUIRED';",
  'export class SchoolReadError extends Error {',
  '  constructor(code, detail) {',
  '    super(detail);',
  "    this.name = 'SchoolReadError';",
  '    this.code = code;',
  '    this.detail = detail;',
  '  }',
  '}',
  ''
].join('\n'));

// 真实 Redactor + 可捕获日志的 Logger，验证 ticket/TGC/会话值不落日志。
copySource('util/Redactor.ets');
writeFile('util/Logger.ts', [
  "import { redactLine } from './Redactor.ts';",
  'export const LOG_MESSAGES = [];',
  'export class Logger {',
  '  static info(message) { LOG_MESSAGES.push(redactLine(String(message))); }',
  '  static warn(message) { LOG_MESSAGES.push(redactLine(String(message))); }',
  '  static error(message) { LOG_MESSAGES.push(redactLine(String(message))); }',
  '}',
  ''
].join('\n'));

copySource('data/SchoolTicketStore.ets');
copySource('platform/school/SchoolRelogin.ets');
rewriteImports(path.join(sandbox, 'platform/school/SchoolRelogin.ts'));

const urlsMod = await import(pathToFileURL(path.join(sandbox, 'core/parser/SchoolUrls.ts')).href);
const reloginMod = await import(pathToFileURL(path.join(sandbox, 'platform/school/SchoolRelogin.ts')).href);
const storeMod = await import(pathToFileURL(path.join(sandbox, 'data/SchoolTicketStore.ts')).href);
const loggerMod = await import(pathToFileURL(path.join(sandbox, 'util/Logger.ts')).href);
const { PlatformSchoolRelogin } = reloginMod;
const { SCHOOL_TICKET_DOMAIN } = storeMod;
const { LOG_MESSAGES } = loggerMod;
const { CAS_SERVICE_URL, CAS_LOGIN, JIAOWU_SESSION_URL } = urlsMod;

const SERVICE_ENCODED = encodeURIComponent(CAS_SERVICE_URL);
const SSO_JS_BODY = "<html><script>window.location.href='https://eapp2.juwp.edu.cn:9443/cas/login?service="
  + SERVICE_ENCODED + "';</script></html>";

function ticketRedirect(url) {
  return { status: 302, url: url };
}

function successResponse() {
  return {
    status: 200,
    body: '',
    finalUrl: JIAOWU_SESSION_URL + 'framework/xsMainV.htmlx',
    setCookies: ['bzb_jsxsd=NEW; Path=/jsxsd', 'TGC=FRESH; Path=/; HttpOnly'],
    redirects: [
      ticketRedirect(CAS_LOGIN + '?service=' + SERVICE_ENCODED),
      ticketRedirect(CAS_SERVICE_URL + '?ticket=ST-SECRET'),
      ticketRedirect(JIAOWU_SESSION_URL + 'jsxsd/framework/xsMainV.htmlx')
    ]
  };
}

class FakeHttp {
  constructor() {
    this.calls = [];
    this.casCount = 0;
    this.ssoHits = 0;
    this.delayMs = 0;
    this.failure = null;
    this.casResponse = successResponse();
    this.lastResponse = null;
  }

  async request(request) {
    this.calls.push(request);
    if (request.url.indexOf('https://jiaowu.juwp.edu.cn:81/sso.jsp') === 0 ||
      request.url.indexOf('http://jiaowu.juwp.edu.cn/sso.jsp') === 0) {
      this.ssoHits += 1;
      throw new Error('sso.jsp must not be requested during relogin');
    }
    if (request.url.indexOf(CAS_LOGIN + '?service=') === 0) {
      this.casCount += 1;
      if (this.failure !== null) throw this.failure;
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
      this.lastResponse = this.casResponse;
      return this.casResponse;
    }
    throw new Error('unexpected request: ' + request.url);
  }

  casRequest() {
    return this.calls.find((item) => item.url.indexOf(CAS_LOGIN + '?service=') === 0);
  }
}

class FakeCookies {
  constructor(options) {
    const opts = options || {};
    this.jiaowuCookie = opts.jiaowuCookie === undefined ? 'bzb_jsxsd=OLD' : opts.jiaowuCookie;
    this.casCookie = opts.casCookie === undefined ? '' : opts.casCookie;
    this.applied = null;
  }

  async cookieHeaderFor(url) {
    if (url === JIAOWU_SESSION_URL || url === 'http://jiaowu.juwp.edu.cn:8080') return this.jiaowuCookie;
    if (url === CAS_LOGIN) return this.casCookie;
    return '';
  }

  async contains() { return false; }
  async clearSchoolCookies() { return false; }
  async applySessionCookies(setCookies) { this.applied = setCookies; return true; }
}

class FakeTickets {
  constructor(initial) {
    this.value = initial === undefined ? null : initial;
    this.loadCalls = 0;
    this.saveCalls = 0;
    this.clearCalls = 0;
    this.failLoad = false;
    this.failSave = false;
    this.failClear = false;
  }

  async load() {
    this.loadCalls += 1;
    if (this.failLoad) throw new Error('store load failed');
    return this.value === null ? null : { ...this.value };
  }

  async save(ticket) {
    this.saveCalls += 1;
    if (this.failSave) throw new Error('store save failed');
    this.value = { ...ticket };
  }

  async clear() {
    this.clearCalls += 1;
    if (this.failClear) throw new Error('store clear failed');
    this.value = null;
  }

  async metadata() {
    return this.value === null ? { updatedAt: 0, hasTgc: false } : { updatedAt: this.value.updatedAt, hasTgc: true };
  }
}

const parser = {
  isLoginPage: (body) => body.indexOf('name="password"') >= 0,
  isCaptchaPage: (body) => body.toLowerCase().indexOf('captcha') >= 0
};

function makeRelogin(options) {
  const opts = options || {};
  const http = opts.http || new FakeHttp();
  const cookies = new FakeCookies(opts.cookies);
  const tickets = opts.tickets || new FakeTickets(opts.ticket);
  const relogin = new PlatformSchoolRelogin(http, cookies, parser, {});
  relogin.attachTicketStore(tickets, () => 123456);
  LOG_MESSAGES.length = 0;
  return { http, cookies, tickets, relogin };
}

function storedTicket() {
  return { cookieHeader: 'TGC=STORED', updatedAt: 1, domain: SCHOOL_TICKET_DOMAIN };
}

test('relogin-persist-1) 无痕 jar 无 TGC 时用持久化 TGC 换票，成功后刷新持久化', async () => {
  const tickets = new FakeTickets(storedTicket());
  const { http, cookies, relogin } = makeRelogin({ tickets, cookies: { casCookie: '' } });
  const next = await relogin.exchange();
  assert.equal(next, 'bzb_jsxsd=NEW');
  assert.equal(http.casCount, 1);
  assert.equal(http.casRequest().headers.Cookie, 'TGC=STORED');
  assert.deepEqual(tickets.value, {
    cookieHeader: 'TGC=FRESH',
    updatedAt: 123456,
    domain: SCHOOL_TICKET_DOMAIN
  });
  assert.deepEqual(cookies.applied, [
    'bzb_jsxsd=NEW; Path=/jsxsd',
    'TGC=FRESH; Path=/; HttpOnly'
  ]);
});

test('relogin-persist-2) jar 有 TGC 时优先用 jar，不用持久化值；响应无新 TGC 时保留请求 TGC', async () => {
  const tickets = new FakeTickets(storedTicket());
  const { http, relogin } = makeRelogin({ tickets, cookies: { casCookie: 'TGC=JAR' } });
  http.casResponse.setCookies = ['bzb_jsxsd=NEW; Path=/jsxsd'];
  await relogin.exchange();
  assert.equal(http.casRequest().headers.Cookie, 'TGC=JAR');
  assert.equal(tickets.value.cookieHeader, 'TGC=JAR');
});

test('relogin-persist-3) 持久化 load 失败且 jar 无 TGC：抛 LOGIN_REQUIRED，不发 CAS 请求', async () => {
  const tickets = new FakeTickets(storedTicket());
  tickets.failLoad = true;
  const { http, relogin } = makeRelogin({ tickets, cookies: { casCookie: '' } });
  await assert.rejects(relogin.exchange(), (error) => {
    assert.equal(error.code, 'SCHOOL_LOGIN_REQUIRED');
    assert.match(error.message, /cas ticket granting cookie absent/);
    return true;
  });
  assert.equal(tickets.loadCalls, 1);
  assert.equal(http.calls.length, 0);
});

test('relogin-persist-4) 持久化 save 失败不改变本次换票成功', async () => {
  const tickets = new FakeTickets(storedTicket());
  tickets.failSave = true;
  const { relogin } = makeRelogin({ tickets, cookies: { casCookie: '' } });
  const next = await relogin.exchange();
  assert.equal(next, 'bzb_jsxsd=NEW');
  assert.equal(tickets.saveCalls, 1);
});

test('relogin-persist-5) CAS 回登录页：清持久化 TGC 并抛 LOGIN_REQUIRED', async () => {
  const tickets = new FakeTickets(storedTicket());
  const { http, relogin } = makeRelogin({ tickets, cookies: { casCookie: 'TGC=JAR' } });
  http.casResponse = {
    status: 200,
    body: '<form name="password"><input name="execution"></form>',
    finalUrl: CAS_LOGIN,
    setCookies: [],
    redirects: []
  };
  await assert.rejects(relogin.exchange(), (error) => {
    assert.equal(error.code, 'SCHOOL_LOGIN_REQUIRED');
    assert.match(error.message, /cas login page/);
    return true;
  });
  assert.equal(tickets.clearCalls, 1);
  assert.equal(tickets.value, null);
});

test('relogin-persist-6) CAS 回验证码页：清持久化 TGC 并抛 CAPTCHA_REQUIRED', async () => {
  const tickets = new FakeTickets(storedTicket());
  const { http, relogin } = makeRelogin({ tickets, cookies: { casCookie: 'TGC=JAR' } });
  http.casResponse = {
    status: 200,
    body: '<html><img src="/captcha.jpg"></html>',
    finalUrl: CAS_LOGIN,
    setCookies: [],
    redirects: []
  };
  await assert.rejects(relogin.exchange(), (error) => {
    assert.equal(error.code, 'SCHOOL_CAPTCHA_REQUIRED');
    assert.match(error.message, /cas captcha required/);
    return true;
  });
  assert.equal(tickets.clearCalls, 1);
  assert.equal(tickets.value, null);
});

test('relogin-persist-7) 并发 exchange 单飞：两次调用只发一次 CAS 请求', async () => {
  const tickets = new FakeTickets(storedTicket());
  const { http, relogin } = makeRelogin({ tickets, cookies: { casCookie: '' } });
  http.delayMs = 20;
  const first = relogin.exchange();
  const second = relogin.exchange();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results, ['bzb_jsxsd=NEW', 'bzb_jsxsd=NEW']);
  assert.equal(http.casCount, 1);
  assert.equal(http.calls.length, 1);
  assert.equal(tickets.saveCalls, 1);
});

test('relogin-persist-8) 无新会话：清持久化 TGC 并抛 cas ticket exchange failed', async () => {
  const tickets = new FakeTickets(storedTicket());
  const { http, relogin } = makeRelogin({ tickets, cookies: { casCookie: 'TGC=JAR' } });
  http.casResponse = { status: 200, body: '', finalUrl: CAS_LOGIN, setCookies: [], redirects: [] };
  await assert.rejects(relogin.exchange(), (error) => {
    assert.equal(error.code, 'SCHOOL_LOGIN_REQUIRED');
    assert.match(error.message, /cas ticket exchange failed/);
    return true;
  });
  assert.equal(tickets.clearCalls, 1);
  assert.equal(tickets.value, null);
});

// 覆盖 5 种真实形状。
test('relogin-shape-1) sso.jsp 返回 200+JS 也不会被请求：直接用固定 CAS_SERVICE_URL 发 CAS', async () => {
  const { http, relogin } = makeRelogin({ cookies: { casCookie: 'TGC=JAR' } });
  // sso.jsp 的真实 200+JS 形状只作为背景；实现若去 GET 它，FakeHttp 会抛错并计入 ssoHits。
  http.ssoBody = SSO_JS_BODY;
  await relogin.exchange();
  assert.equal(http.ssoHits, 0);
  assert.equal(http.calls.length, 1);
  assert.equal(http.casRequest().url, CAS_LOGIN + '?service=' + SERVICE_ENCODED);
  assert.equal(http.casRequest().url.includes(encodeURIComponent(CAS_SERVICE_URL)), true);
});

test('relogin-shape-2) CAS 302 回 service?ticket=：成功取新会话并刷新 TGC', async () => {
  const { http, cookies, tickets, relogin } = makeRelogin({ cookies: { casCookie: 'TGC=JAR' } });
  const next = await relogin.exchange();
  assert.equal(next, 'bzb_jsxsd=NEW');
  assert.ok(http.lastResponse.redirects.some((hop) => hop.status === 302 && hop.url.indexOf('ticket=ST-SECRET') >= 0));
  assert.equal(tickets.value.cookieHeader, 'TGC=FRESH');
  assert.deepEqual(cookies.applied, ['bzb_jsxsd=NEW; Path=/jsxsd', 'TGC=FRESH; Path=/; HttpOnly']);
});

test('relogin-shape-3) CAS 返回登录表单：抛 LOGIN_REQUIRED 且清票（不发第二次请求）', async () => {
  const { http, tickets, relogin } = makeRelogin({ cookies: { casCookie: 'TGC=JAR' } });
  http.casResponse = {
    status: 200,
    body: '<html><form id="fm1" name="password"><input name="execution"></form></html>',
    finalUrl: CAS_LOGIN,
    setCookies: [],
    redirects: []
  };
  await assert.rejects(relogin.exchange(), (error) => {
    assert.equal(error.code, 'SCHOOL_LOGIN_REQUIRED');
    return true;
  });
  assert.equal(tickets.clearCalls, 1);
  assert.equal(http.calls.length, 1);
});

test('relogin-shape-4) CAS 网络超时：原样抛 SCHOOL_TIMEOUT，不清持久化 TGC', async () => {
  const failure = new Error('timeout');
  failure.code = 'SCHOOL_TIMEOUT';
  const http = new FakeHttp();
  http.failure = failure;
  const { tickets, relogin } = makeRelogin({ http, cookies: { casCookie: 'TGC=JAR' } });
  await assert.rejects(relogin.exchange(), (error) => {
    assert.equal(error.code, 'SCHOOL_TIMEOUT');
    return true;
  });
  assert.equal(tickets.clearCalls, 0);
  assert.equal(tickets.value, null);
});

test('relogin-shape-5) 日志脱敏：ticket 值、TGC 值、bzb_jsxsd 值均不出现', async () => {
  const { relogin } = makeRelogin({ cookies: { casCookie: 'TGC=JAR-SECRET' } });
  await relogin.exchange();
  const logs = LOG_MESSAGES.join('\n');
  assert.ok(logs.length > 0, '应当有日志用于验证脱敏');
  assert.equal(logs.includes('ST-SECRET'), false);
  assert.equal(logs.includes('TGC=JAR-SECRET'), false);
  assert.equal(logs.includes('bzb_jsxsd=NEW'), false);
  assert.equal(logs.includes('ticket='), false);
});