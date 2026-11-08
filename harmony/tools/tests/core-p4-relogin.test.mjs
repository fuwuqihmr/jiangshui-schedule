// 静默重登的真实换票语义测试（纯逻辑，Node 可跑；不涉及平台 Kit）。
// 覆盖：401/登录页触发换票、换票成功后用新会话 cookie 重读、换票失败/无新票/仍 401 都不假装成功。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
const fixtures = process.env.HARMONY_FIXTURES;
if (!tmp || !fixtures) throw new Error('HARMONY_CORE_TMP/HARMONY_FIXTURES 未设置，请用 run-core-tests.mjs 运行');

const imp = (p) => import(pathToFileURL(path.join(tmp, p)).href);
const P = await imp('core/parser/JsxsdParser.ts');
const O = await imp('data/SchoolReadOrchestrator.ts');

// 与 core-p4.test.mjs 同源的词表（测试值可含中文；生产值由资源键注入）。
const LEX = {
  weekPrefix: '第', weekSuffix: '周', weekAll: '全部', weekOdd: '单周', weekEven: '双周',
  dayChars: ['一', '二', '三', '四', '五', '六', '日'],
  periodPrefix: '第', periodSuffix: '节',
  unscheduledValues: ['未安排', '未排课', '未排时间', '待定', '无', ''],
  profileLabels: ['年级', '入学年份', '入学年度', '入学年', '入学日期', '入学时间'],
  leaveType: '请假类型', leaveReason: '请假原因', leaveStart: '请假开始时间', leaveEnd: '请假结束时间',
  leaveSubmitted: '请假申请时间', leaveNumber: '请假编号', leaveDuration: '请假时长',
  statusRejected: ['驳回', '退回', '不通过', '拒绝', '不同意'],
  statusPending: ['待', '审批中', '处理中', '审核中'],
  statusApproved: ['通过', '批准', '同意', '已完成'],
  rangeSeparators: ['-', '－', '–', '—', '~', '～', '至'],
  unscheduledNoteNoTime: '学校未安排具体上课时间',
  unscheduledNoteWeeksOnly: '学校仅提供周次，具体上课时间待通知',
  leaveTypeCancel: '销假', leaveTypeRenew: '续假',
  profileYearSuffix: '级', profileGradePrefix: '大',
};

const fixture = (rel) => fs.readFileSync(path.join(fixtures, 'school', rel), 'utf8');
const SESSION = { cookieHeader: 'bzb_jsxsd=old-cookie', updatedAt: 1, domain: 'jiaowu.juwp.edu.cn' };
const ROWS = JSON.stringify({ code: 0, data: [
  { kc_mc: '换票课', jg0101mc: '教师甲', jx0404id: 'RL-1', skddmc: 'B204', sktime: '周一第1、2节{第1-10周}(全部)' },
] });

// 模拟一轮读取：jar 里的教务会话 cookie 可被换票写回；http 记录每次请求携带的 Cookie。
function makeWorld(opt = {}) {
  const calls = [];
  const exchanges = [];
  let jarCookie = SESSION.cookieHeader;
  let rowsHits = 0;
  const http = {
    async get(url, cookieHeader) {
      calls.push({ url, cookie: cookieHeader });
      if (url.includes('xsMainV')) return opt.frame401 ? { status: 401, body: '' } : { status: 200, body: '<html><body>xsMainV ok</body></html>' };
      if (url.includes('jxzlzc')) return { status: 200, body: '[{"jszc":10}]' };
      if (url.includes('needData=1')) {
        rowsHits++;
        if (opt.rowsAlways401) return { status: 401, body: '' };
        if (opt.rowsFirst401 && rowsHits === 1) return { status: 401, body: '' };
        return { status: 200, body: ROWS };
      }
      if (url.includes('xskb_list.do')) return { status: 200, body: opt.meta ?? fixture('timetable.html') };
      return { status: 200, body: '' };
    },
  };
  const cookies = {
    async read() { return jarCookie; },
    async clear() {
      // noClear 模拟旧替身（没有 clear 能力）：清票不生效，用于验证“重读 jar”分支不会假装换票。
      if (!opt.noClear) jarCookie = '';
      return true;
    },
  };
  const relogin = {
    async exchange() {
      exchanges.push(calls.length);
      if (opt.exchangeThrows) {
        const error = new Error(opt.exchangeThrows + ': injected');
        error.code = opt.exchangeThrows;
        throw error;
      }
      const next = opt.exchangeCookie ?? 'bzb_jsxsd=new-cookie';
      if (next.length > 0) jarCookie = next; // 模拟 applySessionCookies 写回 WebCookieManager
      return next;
    },
  };
  const deps = { http, cookies, parser: P, lexicon: LEX, now: () => 1000 };
  if (opt.withRelogin !== false) deps.relogin = relogin;
  return { calls, exchanges, rowsCalls: () => calls.filter((c) => c.url.includes('needData=1')), orch: new O.SchoolReadOrchestrator(deps) };
}

const rejectsWith = (promise, code) => assert.rejects(promise, (error) => {
  assert.equal(error && error.code, code);
  return true;
});

// 1) 换票成功路径：401 → 端口换到新票 → 用新票重读成功（证明不是“清 cookie 后拿旧票重读”）。
test('relogin-1) 401 触发真实换票：exchange 1 次、重读携带新 cookie、读取成功', async () => {
  const world = makeWorld({ rowsFirst401: true });
  const result = await world.orch.read(SESSION);
  assert.equal(world.exchanges.length, 1);
  assert.equal(result.snapshot.id, 'jsxsd-2026-08-31');
  assert.ok(result.snapshot.rules.length >= 1);
  const rows = world.rowsCalls();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cookie, 'bzb_jsxsd=old-cookie');
  assert.equal(rows[1].cookie, 'bzb_jsxsd=new-cookie');
});

// 2) 登录页也属于会话失效：必须走换票；换票后仍是登录页就如实报 LOGIN_REQUIRED。
test('relogin-2) 登录页触发换票；仍换不到票时如实 LOGIN_REQUIRED', async () => {
  const world = makeWorld({ meta: fixture('login.html') });
  await rejectsWith(world.orch.read(SESSION), 'SCHOOL_LOGIN_REQUIRED');
  assert.equal(world.exchanges.length, 1);
});

// 3) 换票失败路径（无 TGC）：如实上抛 LOGIN_REQUIRED，且不再发读取请求。
test('relogin-3) 换票抛 LOGIN_REQUIRED（无 TGC）：上抛该码，不再重读', async () => {
  const world = makeWorld({ rowsFirst401: true, exchangeThrows: 'SCHOOL_LOGIN_REQUIRED' });
  await rejectsWith(world.orch.read(SESSION), 'SCHOOL_LOGIN_REQUIRED');
  assert.equal(world.exchanges.length, 1);
  assert.equal(world.rowsCalls().length, 1);
});

// 4) 换票失败路径（CAS 要验证码）：原样保留 CAPTCHA_REQUIRED，不降级成网络/会话错误。
test('relogin-4) 换票需要验证码：CAPTCHA_REQUIRED 原样上抛', async () => {
  const world = makeWorld({ rowsFirst401: true, exchangeThrows: 'SCHOOL_CAPTCHA_REQUIRED' });
  await rejectsWith(world.orch.read(SESSION), 'SCHOOL_CAPTCHA_REQUIRED');
  assert.equal(world.exchanges.length, 1);
});

// 5) 换票返回不含 bzb_jsxsd：视为没换到票（LOGIN_REQUIRED），绝不拿旧票继续读。
test('relogin-5) 换票结果不含会话 cookie：LOGIN_REQUIRED，不重读', async () => {
  const world = makeWorld({ rowsFirst401: true, exchangeCookie: 'JSESSIONID=abc' });
  await rejectsWith(world.orch.read(SESSION), 'SCHOOL_LOGIN_REQUIRED');
  assert.equal(world.exchanges.length, 1);
  assert.equal(world.rowsCalls().length, 1);
});

// 6) 换票成功但重读仍 401：规格 §3.2:386 / §4.2:451 —— 重登后再次失败必须转 LOGIN_REQUIRED，换票只尝试一次。
test('relogin-6) 换票后仍 401：LOGIN_REQUIRED，换票只 1 次', async () => {
  const world = makeWorld({ rowsAlways401: true });
  await rejectsWith(world.orch.read(SESSION), 'SCHOOL_LOGIN_REQUIRED');
  assert.equal(world.exchanges.length, 1);
  assert.equal(world.rowsCalls().length, 2);
});

// 7) 未注入换票端口的旧替身：只能重读 jar；重读仍 401 也按“重登后仍失败”转 LOGIN_REQUIRED，绝不假装成功。
test('relogin-7) 无换票端口且旧票重读仍 401：LOGIN_REQUIRED', async () => {
  const world = makeWorld({ rowsAlways401: true, withRelogin: false, noClear: true });
  await rejectsWith(world.orch.read(SESSION), 'SCHOOL_LOGIN_REQUIRED');
  assert.equal(world.exchanges.length, 0);
  assert.equal(world.rowsCalls().length, 2);
});

// 8) 首次 401 的映射（readProfile 不经过静默重登）：仍是 SESSION_EXPIRED，供 UI 判定“一次静默重登”。
test('relogin-8) 首次 401（readProfile）→ SCHOOL_SESSION_EXPIRED', async () => {
  const world = makeWorld({ frame401: true });
  await rejectsWith(world.orch.readProfile(SESSION), 'SCHOOL_SESSION_EXPIRED');
  assert.equal(world.exchanges.length, 0, '首次 401 不应触发换票');
});

// sso.jsp 是 200+JS 跳转页，不能靠请求它再猜 service；service 固定为
// core/parser/SchoolUrls.CAS_SERVICE_URL，纯 HTTP 直接发 CAS。以下为 platform 源码静态断言。
const root = process.env.HARMONY_ROOT;
function reloginSource() {
  if (!root) throw new Error('HARMONY_ROOT 未设置，请用 run-core-tests.mjs 运行');
  const raw = fs.readFileSync(path.join(root, 'entry/src/main/ets/platform/school/SchoolRelogin.ets'), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// 9) 取 service 的唯一来源是固定常量；不再请求 sso.jsp、不再从 finalUrl/body 猜。
test('relogin-9) service 固定为 CAS_SERVICE_URL：不请求 sso.jsp、不读 body、仍做 URL 编码', () => {
  const source = reloginSource();
  assert.match(source, /encodeURIComponent\(CAS_SERVICE_URL\)/);
  assert.match(source, /CAS_LOGIN \+ '\?service=' \+ service/);
  assert.doesNotMatch(source, /extractServiceParam/);
  assert.doesNotMatch(source, /entry\.finalUrl/);
  assert.doesNotMatch(source, /entry\.body/);
  assert.doesNotMatch(source, /SSO_ENTRY/);
});

// 10) 302 回 service?ticket= 是成功判据；失败必须清持久化 TGC，不能再靠 resolveService 前置。
test('relogin-10) 302 ticket 回跳判成功；失败清票，不再有 resolveService 前置', () => {
  const source = reloginSource();
  assert.match(source, /hasTicketRedirect\(response\.redirects, CAS_SERVICE_URL\)/);
  assert.match(source, /maxRedirects:\s*8/);
  assert.match(source, /clearPersistedTicket/);
  assert.doesNotMatch(source, /resolveService/);
  assert.doesNotMatch(source, /isAllowedSchoolRedirect/);
});
