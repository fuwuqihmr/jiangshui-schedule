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
const rowsJson = () => {
  const html = fixture('timetable.html');
  const m = html.match(/<script[^>]*id="jsxsd-payload"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('fixture 缺 jsxsd-payload');
  return m[1].trim();
};
const SESSION = { cookieHeader: 'bzb_jsxsd=abc123', updatedAt: 1, domain: 'jiaowu.juwp.edu.cn' };
const codeOf = async (p) => {
  try { await p; return 'no-throw'; } catch (e) { return e && e.code ? e.code : String(e && e.message); }
};

// Fake 平台层：按 URL 分派 frame/meta/weeks/rows；记录每次调用
function makeHttp(opt = {}) {
  // opt 保持可变更，便于同一 orchestrator 实例在失败后重试成功
  const calls = [];
  const stageOf = (url) => {
    if (url.includes('xsMainV')) return 'frame';
    if (url.includes('jxzlzc')) return 'weeks';
    if (url.includes('needData=1')) return 'rows';
    if (url.includes('xskb_list.do')) return 'meta';
    return 'unknown';
  };
  const http = {
    async get(url, cookieHeader, timeoutMs) {
      const stage = stageOf(url);
      calls.push({ stage, url, cookieHeader, timeoutMs });
      const override = opt[stage];
      if (override === 'TIMEOUT') throw new Error('SCHOOL_TIMEOUT: request timed out');
      if (typeof override === 'number') {
        return { status: override, body: stage === 'frame' ? fixture('login.html') : '{"code":0,"data":[]}' };
      }
      if (stage === 'frame') return { status: 200, body: opt.frame ?? '<html><body>xsMainV ok</body></html>' };
      if (stage === 'meta') return { status: 200, body: opt.meta ?? fixture('timetable.html') };
      if (stage === 'weeks') return { status: 200, body: opt.weeks ?? '[{"jszc":10}]' };
      if (stage === 'rows') return { status: 200, body: opt.rows ?? rowsJson() };
      throw new Error('unexpected url ' + url);
    },
  };
  return { calls, http };
}

function makeDeps(opt = {}, cookie = 'bzb_jsxsd=abc123') {
  const { calls, http } = makeHttp(opt);
  const deps = {
    http,
    cookies: { read: async () => cookie },
    parser: P,
    lexicon: LEX,
    now: () => 1000,
  };
  return { calls, deps, opt };
}

test('21) session-required：空/非教务 cookie → SCHOOL_LOGIN_REQUIRED，且不发任何请求', async () => {
  for (const cookieHeader of ['', '   ', 'JSESSIONID=x; other=y']) {
    const { calls, deps } = makeDeps({});
    const orch = new O.SchoolReadOrchestrator(deps);
    const code = await codeOf(orch.read({ cookieHeader, updatedAt: 0, domain: 'jiaowu.juwp.edu.cn' }));
    assert.equal(code, 'SCHOOL_LOGIN_REQUIRED', 'cookie=' + JSON.stringify(cookieHeader));
    assert.equal(calls.length, 0, '不应发请求');
  }
});

test('22) login-and-captcha：登录页/验证码页/flag1=2,3 → 对应稳定码', async () => {
  const login = fixture('login.html');
  {
    const { calls, deps } = makeDeps({ frame: login });
    const orch = new O.SchoolReadOrchestrator(deps);
    assert.equal(await codeOf(orch.read(SESSION)), 'SCHOOL_LOGIN_REQUIRED');
    assert.equal(calls.length, 2, '登录页 + 静默重登后第二次读取');
  }
  {
    const { deps } = makeDeps({ frame: '<html><body><input name="captcha" type="text" /></body></html>' });
    const orch = new O.SchoolReadOrchestrator(deps);
    assert.equal(await codeOf(orch.read(SESSION)), 'SCHOOL_CAPTCHA_REQUIRED');
  }
  for (const flag1 of [2, 3]) {
    const rows = JSON.stringify({ code: 0, flag1, data: [] });
    const { deps } = makeDeps({ rows });
    const orch = new O.SchoolReadOrchestrator(deps);
    // 首次 flag1 内部为 SESSION_EXPIRED 触发一次静默重登；重登后仍 flag1 -> LOGIN_REQUIRED（规格 §3.2:386）。
    assert.equal(await codeOf(orch.read(SESSION)), 'SCHOOL_LOGIN_REQUIRED', 'flag1=' + flag1);
  }
});

test('23) read-success：Fake meta/weeks/rows 解析 fixture，startDate 周一、id/source/profile 正确', async () => {
  const { calls, deps } = makeDeps({});
  const orch = new O.SchoolReadOrchestrator(deps);
  const res = await orch.read(SESSION);
  assert.equal(res.snapshot.id, 'jsxsd-2026-08-31');
  assert.equal(res.snapshot.startDate, '2026-08-31');
  assert.equal(O.isMondayDate(res.snapshot.startDate), true);
  assert.equal(res.snapshot.weeks, 10);
  assert.equal(res.snapshot.rules.length, 3);
  assert.equal(res.snapshot.unscheduled.length, 1);
  assert.deepEqual(res.snapshot.exceptions, []);
  assert.equal(res.snapshot.source.kind, 'school');
  assert.equal(res.snapshot.source.label, 'school');
  assert.equal(res.snapshot.studentProfile, null);
  assert.equal(res.profile, null);
  assert.equal(res.fetchedAt, 1000);
  assert.deepEqual(res.snapshot.rules.map((r) => r.id).sort(), ['jsxsd-plan-A-2-1-2-0', 'jsxsd-plan-A-4-3-4-1', 'jsxsd-plan-B-3-5-6-0']);
  assert.equal(res.snapshot.unscheduled[0].id, 'jsxsd-pending-plan-C-0');
  assert.deepEqual(calls.map((c) => c.stage), ['frame', 'meta', 'weeks', 'rows']);
  for (const call of calls) {
    assert.equal(call.cookieHeader, 'bzb_jsxsd=abc123');
    assert.equal(call.timeoutMs, 20000);
  }
});

test('24) http-timeout-network：401 重登后→LOGIN_REQUIRED、503→NETWORK_FAILED、抛 TIMEOUT→SCHOOL_TIMEOUT，错误不含 cookie/响应体', async () => {
  {
    const { deps } = makeDeps({ frame: 401 });
    const orch = new O.SchoolReadOrchestrator(deps);
    const err = await orch.read(SESSION).then(() => null, (e) => e);
    assert.equal(err.code, 'SCHOOL_LOGIN_REQUIRED');
    assert.equal(String(err.message).includes('bzb_jsxsd'), false);
    assert.equal(String(err.message).includes('userAccount'), false);
  }
  {
    const { deps } = makeDeps({ frame: 503 });
    const orch = new O.SchoolReadOrchestrator(deps);
    assert.equal(await codeOf(orch.read(SESSION)), 'SCHOOL_NETWORK_FAILED');
  }
  {
    const { deps } = makeDeps({ frame: 'TIMEOUT' });
    const orch = new O.SchoolReadOrchestrator(deps);
    const err = await orch.read(SESSION).then(() => null, (e) => e);
    assert.equal(err.code, 'SCHOOL_TIMEOUT');
    assert.equal(String(err.message).includes('bzb_jsxsd'), false);
    assert.equal(String(err.message).includes('<html'), false);
  }
  {
    // P2：异常带 HttpError.code 时优先读 code，不依赖 message 文本
    const { deps } = makeDeps({});
    const coded = new Error('transport exploded');
    coded.code = 'SCHOOL_TIMEOUT';
    deps.http.get = async () => { throw coded; };
    const orch = new O.SchoolReadOrchestrator(deps);
    assert.equal(await codeOf(orch.read(SESSION)), 'SCHOOL_TIMEOUT');
  }
  {
    const { deps } = makeDeps({});
    const coded = new Error('transport exploded');
    coded.code = 'HTTP_503';
    deps.http.get = async () => { throw coded; };
    const orch = new O.SchoolReadOrchestrator(deps);
    assert.equal(await codeOf(orch.read(SESSION)), 'SCHOOL_NETWORK_FAILED');
  }
});

test('25) single-flight-and-old-snapshot：并发只跑一组请求；失败不覆盖旧快照且可重试', async () => {
  const opt = {};
  const { calls, deps } = makeDeps(opt);
  const orch = new O.SchoolReadOrchestrator(deps);
  const [a, b] = await Promise.all([orch.read(SESSION), orch.read(SESSION)]);
  assert.equal(calls.length, 4, '并发应只发 4 个请求');
  assert.equal(a, b, '并发调用应复用同一结果');
  const oldId = a.snapshot.id;
  const oldJson = JSON.stringify(a.snapshot);

  // 同一实例：让下一次 rows 阶段返回 HTTP 500，失败后旧快照必须原样保留（逐字节）
  opt.rows = 500;
  assert.equal(await codeOf(orch.read(SESSION)), 'SCHOOL_NETWORK_FAILED');
  assert.equal(a.snapshot.id, oldId, '失败不得覆盖旧快照 id');
  assert.equal(JSON.stringify(a.snapshot), oldJson, '失败不得改写旧快照任何字段');
  // 失败后 inflight 已清：同一实例重试（脚本恢复成功）应成功且产出新对象
  opt.rows = rowsJson();
  const again = await orch.read(SESSION);
  assert.equal(again.snapshot.id, 'jsxsd-2026-08-31');
  assert.equal(again.snapshot.rules.length, 3);
  assert.equal(again.snapshot.unscheduled.length, 1);
  assert.notEqual(again.snapshot, a.snapshot, '重试应产出新快照对象，而不是原地改写旧对象');
  assert.equal(JSON.stringify(a.snapshot), oldJson, '重试成功后旧快照仍保持失败前内容');
});

test('26) progress-stages：成功读取依次回调 6 个阶段且顺序单调，回调抛错不影响读取', async () => {
  const { deps } = makeDeps({});
  const orch = new O.SchoolReadOrchestrator(deps);
  const stages = [];
  const res = await orch.read(SESSION, (stage) => stages.push(stage));
  assert.equal(res.snapshot.id, 'jsxsd-2026-08-31');
  assert.deepEqual(stages, ['session-check', 'page-meta', 'weeks', 'rows', 'parse', 'save']);
  const indexes = stages.map((stage) => O.SCHOOL_READ_STAGES.indexOf(stage));
  assert.deepEqual(indexes, [0, 1, 2, 3, 4, 5], 'stage 顺序必须按 §5.2 白名单单调');

  // 进度回调抛错不得中断读取，阶段序列仍完整
  const stages2 = [];
  const { deps: deps2 } = makeDeps({});
  const orch2 = new O.SchoolReadOrchestrator(deps2);
  const res2 = await orch2.read(SESSION, (stage) => {
    stages2.push(stage);
    throw new Error('ui progress boom');
  });
  assert.equal(res2.snapshot.id, 'jsxsd-2026-08-31');
  assert.deepEqual(stages2, ['session-check', 'page-meta', 'weeks', 'rows', 'parse', 'save']);
});

test('27) progress-failure：会话缺失不回调；中途失败停在失败阶段，不得提前 emit parse/save', async () => {
  // 会话缺失：SCHOOL_LOGIN_REQUIRED，且没有任何进度回调
  const { deps } = makeDeps({});
  const orch = new O.SchoolReadOrchestrator(deps);
  const none = [];
  const code = await codeOf(orch.read({ cookieHeader: '   ', updatedAt: 0 }, (stage) => none.push(stage)));
  assert.equal(code, 'SCHOOL_LOGIN_REQUIRED');
  assert.deepEqual(none, [], '会话缺失时不得回调任何阶段');

  // rows 阶段 500：停在 rows，不得 emit parse/save
  const { deps: bad } = makeDeps({ rows: 500 });
  const badOrch = new O.SchoolReadOrchestrator(bad);
  const stages = [];
  const failCode = await codeOf(badOrch.read(SESSION, (stage) => stages.push(stage)));
  assert.equal(failCode, 'SCHOOL_NETWORK_FAILED');
  assert.deepEqual(stages, ['session-check', 'page-meta', 'weeks', 'rows'], '失败后不得继续 emit parse/save');
});

test('28) weeks-malformed：weeks 含 null 元素或非数组 → SCHOOL_PARSE_FAILED，绝不抛 TypeError，且不进入 rows', async () => {
  const payloads = ['[null]', '[1,null]', '{"jszc":10}'];
  for (const weeks of payloads) {
    const { calls, deps } = makeDeps({ weeks });
    const orch = new O.SchoolReadOrchestrator(deps);
    const error = await orch.read(SESSION).then(() => null, (e) => e);
    assert.ok(error, 'weeks=' + weeks + ' 应失败');
    assert.equal(error.code, 'SCHOOL_PARSE_FAILED', 'weeks=' + weeks + ' 稳定码');
    assert.equal(error instanceof TypeError, false, 'weeks=' + weeks + ' 不得冒未包装 TypeError');
    assert.match(String(error.detail || ''), /^[\x20-\x7e]*$/, 'detail 必须是 ASCII');
    assert.equal(calls.some((c) => c.stage === 'rows'), false, 'weeks=' + weeks + ' 不得进入 rows 阶段');
  }
});