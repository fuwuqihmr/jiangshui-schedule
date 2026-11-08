import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
const fixtures = process.env.HARMONY_FIXTURES;
const root = process.env.HARMONY_ROOT;
if (!tmp || !fixtures || !root) throw new Error('HARMONY_CORE_TMP/HARMONY_FIXTURES/HARMONY_ROOT 未设置，请用 run-core-tests.mjs 运行');

const imp = (p) => import(pathToFileURL(path.join(tmp, p)).href);
const P = await imp('core/parser/JsxsdParser.ts');
const L = await imp('core/parser/OfficeLeaveParser.ts');
const O = await imp('data/SchoolReadOrchestrator.ts');
const R = await imp('data/SchoolReaderImpl.ts');
const fsUtil = path.join(root, 'entry/src/main/ets/util/Redactor.ets');
fs.mkdirSync(path.join(tmp, 'util'), { recursive: true });
fs.copyFileSync(fsUtil, path.join(tmp, 'util/Redactor.ts'));
const Redact = await imp('util/Redactor.ts');

// P4 新增：真实解析词表（与 ParserLexiconFactory 的资源键一一对应；测试值可含中文）
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
const OPTIONS = { semesterId: '2026-2027-1', totalWeeks: 10, modeId: '1', sourceLabel: '教务系统' };
const fixture = (rel) => fs.readFileSync(path.join(fixtures, 'school', rel), 'utf8');
const codeOf = (fn) => { try { fn(); return 'no-throw'; } catch (e) { return e && e.code ? e.code : String(e && e.message); } };

function htmlWith(payload) {
  return '<!doctype html><html><body>'
    + '<input id="xnxq01id" value="2026-2027-1"><input id="kbjcmsid" value="1">'
    + '<script id="jsxsd-payload" type="application/json">' + JSON.stringify(payload) + '</script>'
    + '</body></html>';
}
function leaveJson(forms) {
  return JSON.stringify({ data: { formsUserList: forms } });
}
function leaveForm(id, type, status, start, end, statusId = '1') {
  return {
    id, aprvStatusType: status, aprvStatusTypeId: statusId,
    formData: { blocks: [{ fields: [
      { label: '请假类型', values: [{ val: type }] },
      { label: '请假原因', values: [{ val: '测试原因' }] },
      { label: '请假开始时间', values: [{ val: start }] },
      { label: '请假结束时间', values: [{ val: end }] },
    ] }] },
  };
}

function makeOrch(opt = {}) {
  const calls = [];
  const http = {
    async get(url) {
      calls.push(url);
      if (opt.throwCode) {
        const error = new Error(opt.throwCode + ': injected');
        error.code = opt.throwCode;
        throw error;
      }
      if (typeof opt.status === 'number') {
        return { status: opt.status, body: '' };
      }
      if (url.includes('xsMainV')) return { status: 200, body: opt.frame ?? '<html><body>xsMainV ok</body></html>' };
      if (url.includes('jxzlzc')) return { status: 200, body: opt.weeks ?? '[{"jszc":10}]' };
      if (url.includes('needData=1')) return { status: 200, body: opt.rows ?? '{"code":0,"data":[]}' };
      if (url.includes('xskb_list.do')) return { status: 200, body: opt.meta ?? fixture('timetable.html') };
      return { status: 200, body: '' };
    },
  };
  const deps = { http, cookies: { read: async () => 'bzb_jsxsd=test-cookie' }, parser: P, lexicon: LEX, now: () => 1000 };
  return { calls, orch: new O.SchoolReadOrchestrator(deps) };
}

// 1) 9–11 节真实行：规则时间 19:00–21:10，教师/教室/周次均保留
test('p4-1) 晚课 9–11 节：19:00–21:10、教师/教室/单双周标签', () => {
  const parsed = P.parseTimetableRows([
    { kc_mc: '晚课甲', jg0101mc: '教师甲', jx0404id: 'P4-W1', skddmc: 'B204', sktime: '周一第9、10、11节{第1-2周}(全部)' },
    { kc_mc: '晚课乙', jg0101mc: '教师乙', jx0404id: 'P4-W2', skddmc: 'A101', sktime: '周二第1节{第2,4,6周}(双周)' },
  ], OPTIONS, LEX);
  assert.equal(parsed.rules.length, 2);
  const a = parsed.rules.find((r) => r.id.indexOf('P4-W1') >= 0);
  const b = parsed.rules.find((r) => r.id.indexOf('P4-W2') >= 0);
  assert.ok(a && b, '规则 id 应含 P4-W1/P4-W2');
  assert.deepEqual([a.startPeriod, a.endPeriod, a.startTime, a.endTime], [9, 11, '19:00', '21:10']);
  assert.deepEqual([a.teacher, a.room], ['教师甲', 'B204']);
  assert.deepEqual(a.weeks, [1, 2]);
  assert.deepEqual([b.startTime, b.endTime, b.room], ['08:30', '09:10', 'A101']);
  assert.deepEqual(b.weeks, [2, 4, 6]);
});

// 2) 自定义 HTML：单周枚举、未排周次进 unscheduled（不进 rules）
test('p4-2) 自定义 HTML：单周枚举与未排周次分流', () => {
  const payload = { code: 0, data: [
    { kc_mc: '枚举课', jg0101mc: '教师丙', jx0404id: 'P4-W3', skddmc: '东C201', sktime: '周三第5、6节{第2-8周}(单周)' },
    { kc_mc: '待排课', jg0101mc: '教师丁', jx0404id: 'P4-W4', skddmc: '', sktime: '第3周' },
  ] };
  const parsed = P.parseTimetable(htmlWith(payload), OPTIONS, LEX);
  assert.equal(parsed.rules.length, 1);
  assert.equal(parsed.unscheduled.length, 1);
  const rule = parsed.rules[0];
  assert.deepEqual([rule.dayOfWeek, rule.startPeriod, rule.endPeriod, rule.room], [3, 5, 6, '东C201']);
  assert.deepEqual(rule.weeks, [3, 5, 7]);
  assert.deepEqual(parsed.unscheduled[0].weeks, [3]);
  assert.equal(parsed.unscheduled[0].teacher, '教师丁');
});

// 3) 空表与截断/乱码 HTML：稳定错误码，不抛未捕获异常
test('p4-3) 空表 SCHOOL_EMPTY_TIMETABLE；截断/乱码 SCHOOL_PARSE_FAILED', () => {
  assert.equal(codeOf(() => P.parseTimetable(htmlWith({ code: 0, data: [] }), OPTIONS, LEX)), 'SCHOOL_EMPTY_TIMETABLE');
  const truncated = '<html><body><input id="xnxq01id" value="2026-2027-1"><script id="jsxsd-payload">{"code":0,"data":[{"kc_mc":"x"';
  assert.equal(codeOf(() => P.parseTimetable(truncated, OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
  const broken = '<html><body><input id="xnxq01id" value="2026-2027-1"><script id="jsxsd-payload">\u0000\u0001not-json</script></body></html>';
  assert.equal(codeOf(() => P.parseTimetable(broken, OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
  assert.equal(codeOf(() => P.parseTimetableRows([{ kc_mc: '坏节次', jx0404id: 'P4-BAD', sktime: '周一第12节{第1周}(全部)' }], OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
});

// 4) 假条 fixture：2 条完整记录 + skipped=1，字段逐一核对
test('p4-4) 假条 fixture：2 条完整、skipped=1、字段映射正确', () => {
  const parsed = L.parseOfficeLeave(fixture('leave.json'), LEX, { semesterId: '2026-2027-1' });
  assert.equal(parsed.error, null);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.skipped, 1);
  const a = parsed.records[0];
  assert.deepEqual([a.id, a.type, a.status, a.startDate, a.startTime, a.endDate, a.endTime], ['leave-1', 'leave', 'approved', '2026-10-20', '08:30', '2026-10-20', '10:00']);
  assert.deepEqual([a.reason, a.approver, a.semesterId], ['身体不适', '辅导员', '2026-2027-1']);
  assert.equal(a.submittedAt, '2026-10-19T10:00:00Z');
  const b = parsed.records[1];
  assert.deepEqual([b.id, b.type, b.status, b.reason], ['leave-2', 'renew', 'pending', '复诊']);
  assert.ok(typeof b.submittedAt === 'string' && b.submittedAt.length > 0);
});

// 5) 状态词「退回」→ rejected；销假/续假 → cancel/renew
test('p4-5) 假条状态词与类型词映射：退回/销假/续假', () => {
  const parsed = L.parseOfficeLeave(leaveJson([
    leaveForm('p4-l1', '销假', '退回修改', '2026-10-20 08:30', '2026-10-20 10:00'),
    leaveForm('p4-l2', '续假', '已通过', '2026-10-20 10:00', '2026-10-20 11:00', '2'),
  ]), LEX);
  assert.equal(parsed.error, null);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].status, 'rejected');
  assert.equal(parsed.records[0].type, 'cancel');
  assert.equal(parsed.records[1].status, 'approved');
  assert.equal(parsed.records[1].type, 'renew');
});

// 6) 规格语义（§2.8:309 / §7.4:580）：缺 id 的假条跳过并计 skipped，不合成 leave-row-<index>；坏时间同样跳过，不崩溃
test('p4-6) 假条缺 id 跳过计 skipped（§2.8:309 / §7.4:580），坏时间同样跳过，不崩溃', () => {
  const parsed = L.parseOfficeLeave(leaveJson([
    leaveForm('', '请假', '已通过', '2026-10-20 08:30', '2026-10-20 10:00'),
    leaveForm('p4-bad1', '请假', '已通过', 'not-a-date', '2026-10-20 10:00'),
    leaveForm('p4-bad2', '请假', '已通过', '2026-10-20 10:00', '2026-10-20 09:00'),
    leaveForm('p4-bad3', '请假', '已通过', '2026-10-20 25:00', '2026-10-20 26:00'),
  ]), LEX);
  assert.equal(parsed.error, null);
  assert.equal(parsed.records.length, 0);
  assert.deepEqual(parsed.records.map((r) => r.id), []);
  assert.equal(parsed.records.filter((r) => r.id.startsWith('leave-row-')).length, 0);
  assert.equal(parsed.skipped, 4);
});

// 7) 非 JSON / 登录页：错误码可播报
test('p4-7) 假条非 JSON / 登录页：OFFICE_UNAVAILABLE / OFFICE_SESSION_REQUIRED', () => {
  assert.equal(L.parseOfficeLeave('not json', LEX).error, 'OFFICE_UNAVAILABLE');
  assert.equal(L.parseOfficeLeave('', LEX).error, 'OFFICE_UNAVAILABLE');
  const session = L.parseOfficeLeave('<html><body>login</body></html>', LEX);
  assert.equal(session.error, 'OFFICE_SESSION_REQUIRED');
  assert.equal(session.records.length, 0);
});

// 8) Redactor：Cookie/TGC/ticket/service 值全部消失，阶段/错误码保留
test('p4-8) redactLine 去掉 Cookie/TGC/ticket/service 原值', () => {
  const line = 'stage=rows code=SCHOOL_TIMEOUT Cookie: bzb_jsxsd=SECRET123; TGC=TGC999 ticket=TICK888 service=https://sso.example/cb?code=ABC';
  const out = Redact.redactLine(line);
  for (const secret of ['SECRET123', 'TGC999', 'TICK888', 'code=ABC']) assert.ok(!out.includes(secret), '仍含 ' + secret + '：' + out);
  assert.ok(out.includes('stage=rows'));
  assert.ok(out.includes('SCHOOL_TIMEOUT'));
  assert.ok(out.includes('[redacted]'));
});

// 9) Redactor URL：userinfo/query 敏感值脱敏，host/path 保留
test('p4-9) redactUrl 去 userinfo 与 service/ticket/uid/token 值', () => {
  const out = Redact.redactUrl('https://user:pass@jiaowu.juwp.edu.cn:8080/jsxsd/x?ticket=T1&service=https%3A%2F%2Fsso&uid=U1&ok=1#token=TOK');
  for (const secret of ['user', 'pass', 'T1', 'https%3A', 'U1', 'TOK']) assert.ok(!out.includes(secret), '仍含 ' + secret + '：' + out);
  assert.ok(out.includes('jiaowu.juwp.edu.cn:8080'));
  assert.ok(out.includes('ok=1'));
});

// 10) 401 → 静默重登一次后仍 401 → LOGIN_REQUIRED（规格 §3.2:386：再次失败转人工登录；共 2 次请求）
test('p4-10) 401 静默重登后转 SCHOOL_LOGIN_REQUIRED（共 2 次请求）', async () => {
  const { calls, orch } = makeOrch({ status: 401 });
  await assert.rejects(orch.read({ cookieHeader: 'bzb_jsxsd=x', updatedAt: 0, domain: 'jiaowu.juwp.edu.cn' }), (e) => e.code === 'SCHOOL_LOGIN_REQUIRED');
  assert.equal(calls.length, 2, '首次 401 + 静默重登后的第二次读取');
});

// 11) 登录页 → LOGIN_REQUIRED；验证码页 → CAPTCHA_REQUIRED
test('p4-11) 登录页/验证码页错误码', async () => {
  {
    const { orch } = makeOrch({ frame: fixture('login.html') });
    await assert.rejects(orch.read({ cookieHeader: 'bzb_jsxsd=x', updatedAt: 0, domain: 'd' }), (e) => e.code === 'SCHOOL_LOGIN_REQUIRED');
  }
  {
    const { orch } = makeOrch({ frame: '<html><body><input name="captcha" type="text" /></body></html>' });
    await assert.rejects(orch.read({ cookieHeader: 'bzb_jsxsd=x', updatedAt: 0, domain: 'd' }), (e) => e.code === 'SCHOOL_CAPTCHA_REQUIRED');
  }
});

// 12) flag1=2/3 → 静默重登一次，第二次仍 flag1=2/3 → LOGIN_REQUIRED（规格 §3.2:386）
test('p4-12) flag1=2/3 静默重登一次后仍失败转 LOGIN_REQUIRED（共 8 次请求）', async () => {
  for (const flag1 of [2, 3]) {
    const { calls, orch } = makeOrch({ rows: JSON.stringify({ code: 0, flag1, data: [] }) });
    await assert.rejects(orch.read({ cookieHeader: 'bzb_jsxsd=x', updatedAt: 0, domain: 'd' }), (e) => e.code === 'SCHOOL_LOGIN_REQUIRED', 'flag1=' + flag1);
    // 每个读取周期 frame/meta/weeks/rows 各一次，重登后再读一周期：共 8 次
    assert.equal(calls.length, 8, 'flag1 命中过期时两轮各 4 次请求');
  }
});

// 13) 超时与网络失败映射
test('p4-13) 超时 SCHOOL_TIMEOUT / 503 SCHOOL_NETWORK_FAILED', async () => {
  {
    const { orch } = makeOrch({ throwCode: 'SCHOOL_TIMEOUT' });
    await assert.rejects(orch.read({ cookieHeader: 'bzb_jsxsd=x', updatedAt: 0, domain: 'd' }), (e) => e.code === 'SCHOOL_TIMEOUT');
  }
  {
    const { orch } = makeOrch({ status: 503 });
    await assert.rejects(orch.read({ cookieHeader: 'bzb_jsxsd=x', updatedAt: 0, domain: 'd' }), (e) => e.code === 'SCHOOL_NETWORK_FAILED');
  }
});

// 14) SchoolReaderImpl 成功才写 snapshot/lastSuccess/lastAttempt/error，revision 正确
test('p4-14) 读取成功才持久化 snapshot 与 revision', async () => {
  const saved = [];
  const state = { snapshot: null, lastSuccess: 0, lastAttempt: 0, error: 'OLD', _revision: 7 };
  const repo = { load: async () => state, save: async (next, rev) => { saved.push({ next, rev }); return rev + 1; }, reset: async () => {} };
  const result = { snapshot: { id: 'snap-1' }, profile: null, fetchedAt: 1 };
  const reader = new R.SchoolReaderImpl({ read: async () => result }, repo, { clock: () => 555 });
  const got = await reader.read({ cookieHeader: 'bzb_jsxsd=x', updatedAt: 0, domain: 'd' });
  assert.equal(got.snapshot.id, 'snap-1');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].rev, 7);
  assert.equal(saved[0].next.snapshot.id, 'snap-1');
  assert.equal(saved[0].next.lastSuccess, 555);
  assert.equal(saved[0].next.lastAttempt, 555);
  assert.equal(saved[0].next.error, null);
});

// 15) 读取失败只写 lastAttempt/error，snapshot/lastSuccess 保持原值
test('p4-15) 读取失败只写 lastAttempt/error，不改 snapshot', async () => {
  const saved = [];
  const state = { snapshot: { id: 'old' }, lastSuccess: 1, lastAttempt: 2, error: null, _revision: 1 };
  const repo = { load: async () => state, save: async (next, rev) => { saved.push({ next, rev }); return rev + 1; }, reset: async () => {} };
  const reader = new R.SchoolReaderImpl({ read: async () => { throw new Error('SCHOOL_TIMEOUT: injected'); } }, repo, { clock: () => 333 });
  await assert.rejects(reader.read({ cookieHeader: 'bzb_jsxsd=x', updatedAt: 0, domain: 'd' }), (e) => e.message.includes('SCHOOL_TIMEOUT'));
  assert.equal(saved.length, 1, '失败也要持久化 lastAttempt/lastError');
  assert.equal(saved[0].next.snapshot.id, 'old', 'snapshot 不得覆盖');
  assert.equal(saved[0].next.lastSuccess, 1, 'lastSuccess 不得覆盖');
  assert.equal(saved[0].next.lastAttempt, 333);
  assert.equal(saved[0].next.error, 'SCHOOL_TIMEOUT');
});

test('p4-16) 失败时 lastAttempt 更新（已实现）', async () => {
  const state = { snapshot: { id: 'old' }, lastSuccess: 1, lastAttempt: 2, error: null, _revision: 1 };
  const repo = { load: async () => state, save: async () => 1, reset: async () => {} };
  const reader = new R.SchoolReaderImpl({ read: async () => { throw new Error('SCHOOL_TIMEOUT: injected'); } }, repo, { clock: () => 333 });
  await assert.rejects(reader.read({ cookieHeader: 'bzb_jsxsd=x', updatedAt: 0, domain: 'd' }));
  assert.equal(state.lastAttempt, 333);
  assert.equal(state.error, 'SCHOOL_TIMEOUT');
});

// 17) 9 个稳定错误码 resource 存在且非空（school_error_* 8 个 + WEB_UNAVAILABLE）
test('p4-17) school_error_* 文案键存在且非空', () => {
  const json = JSON.parse(fs.readFileSync(path.join(root, 'entry/src/main/resources/base/element/string.json'), 'utf8'));
  const map = Object.fromEntries(json.string.map((s) => [s.name, s.value]));
  const expected = [
    'school_error_login_required', 'school_error_captcha', 'school_error_network', 'school_error_timeout',
    'school_error_session_expired', 'school_error_parse', 'school_error_empty', 'school_error_unknown',
    'school_web_unavailable',
  ];
  for (const key of expected) assert.ok(typeof map[key] === 'string' && map[key].trim().length > 0, '缺文案 ' + key);
  assert.ok(Object.keys(map).filter((k) => k.startsWith('school_error_')).length >= 8);
});

// 18) pages/components 代码行无中文硬编码（注释除外）
test('p4-18) pages/components 无中文硬编码', () => {
  const dirs = ['entry/src/main/ets/pages', 'entry/src/main/ets/components'];
  for (const dir of dirs) {
    const abs = path.join(root, dir);
    for (const name of fs.readdirSync(abs)) {
      if (!name.endsWith('.ets')) continue;
      const lines = fs.readFileSync(path.join(abs, name), 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/[\u4e00-\u9fff]/.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line)) {
          assert.fail(dir + '/' + name + ':' + (index + 1) + ' 中文硬编码：' + line.trim());
        }
      });
    }
  }
});

// 19) 示例模式禁用路径：账号卡按钮与说明均受 demoMode 控制
test('p4-19) 示例模式禁用学校里读/登录入口', () => {
  const card = fs.readFileSync(path.join(root, 'entry/src/main/ets/components/SchoolAccountCard.ets'), 'utf8');
  assert.ok(card.includes('.enabled(!this.busy && this.demoMode === false && this.permission !== \'denied\')'));
  assert.ok(card.includes('school_demo_disabled'));
  const index = fs.readFileSync(path.join(root, 'entry/src/main/ets/pages/Index.ets'), 'utf8');
  assert.ok(index.includes('demoMode'));
});
