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

// 规格 §2.5 SchoolLexicon：Node 测试直接构造中文字典（core 源码不得含中文）
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
const codeOf = (fn) => { try { fn(); return 'no-throw'; } catch (e) { return e && e.code ? e.code : String(e && e.message); } };
const fixture = (rel) => fs.readFileSync(path.join(fixtures, 'school', rel), 'utf8');

// 生产值镜像（P1-4/P1-5/P1-6/P1-7 回归）：按 ParserLexiconFactory.ets 的映射规则，从 string.json
// 真实资源值构造 lexicon；分组 token 用 '|' 合并（与工厂 expandTokens 一致），范围符含工厂硬编码形态。
// 这样测试不再自建中文值，生产资源与 fixture 一旦脱节（P0-1）会直接红。
function readStringResources() {
  const file = path.join(process.env.HARMONY_ROOT, 'entry/src/main/resources/base/element/string.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const map = {};
  for (const item of parsed.string) map[item.name] = item.value;
  return map;
}
function expandTokens(values) {
  const tokens = [];
  for (const value of values) {
    for (const part of String(value).split('|')) {
      const token = part.trim();
      if (token.length > 0 && tokens.indexOf(token) < 0) tokens.push(token);
    }
  }
  return tokens;
}
function indexed(map, prefix, count) {
  const out = [];
  for (let i = 1; i <= count; i++) out.push(map[prefix + '_' + i]);
  return out;
}
function productionLexicon() {
  const m = readStringResources();
  return {
    weekPrefix: m.school_lex_week_prefix,
    weekSuffix: m.school_lex_week_suffix,
    weekAll: m.school_lex_week_all,
    weekOdd: m.school_lex_week_odd,
    weekEven: m.school_lex_week_even,
    dayChars: indexed(m, 'school_lex_day', 7),
    periodPrefix: m.school_lex_period_prefix,
    periodSuffix: m.school_lex_period_suffix,
    unscheduledValues: expandTokens(indexed(m, 'school_lex_unscheduled', 3)),
    profileLabels: indexed(m, 'school_lex_profile', 6),
    leaveType: m.school_lex_leave_type,
    leaveReason: m.school_lex_leave_reason,
    leaveStart: m.school_lex_leave_start,
    leaveEnd: m.school_lex_leave_end,
    leaveSubmitted: m.school_lex_leave_submitted,
    leaveNumber: m.school_lex_leave_number,
    leaveDuration: m.school_lex_leave_duration,
    statusRejected: expandTokens(indexed(m, 'school_lex_status_rejected', 2)),
    statusPending: expandTokens(indexed(m, 'school_lex_status_pending', 2)),
    statusApproved: expandTokens(indexed(m, 'school_lex_status_approved', 2)),
    rangeSeparators: ['-', '\uFF0D', '\u2013', '\u2014', '~', '\uFF5E', m.school_lex_range_separator],
    unscheduledNoteNoTime: m.school_lex_unscheduled_note_no_time,
    unscheduledNoteWeeksOnly: m.school_lex_unscheduled_note,
    leaveTypeCancel: m.school_lex_leave_type_cancel,
    leaveTypeRenew: m.school_lex_leave_type_renew,
    profileYearSuffix: m.school_lex_profile_year_suffix,
    profileGradePrefix: m.school_lex_profile_grade_prefix,
  };
}

test('1) week-list：第7-15周 展开、枚举去重排序', () => {
  assert.deepEqual(P.parseWeekSpec('第7-15周', LEX).weeks, [7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual(P.parseWeekSpec('第6,8,10,12,14周', LEX).weeks, [6, 8, 10, 12, 14]);
  assert.deepEqual(P.parseWeekSpec('第1,3,3,2周', LEX).weeks, [1, 2, 3]);
});

test('2) week-odd-even：单/双周过滤、全角括号与 ～ 范围', () => {
  const odd = P.parseWeekSpec('第3-8周(单周)', LEX);
  assert.deepEqual(odd.weeks, [3, 5, 7]);
  assert.equal(odd.pattern, 'odd');
  const even = P.parseWeekSpec('第5-10周（双周）', LEX);
  assert.deepEqual(even.weeks, [6, 8, 10]);
  assert.equal(even.pattern, 'even');
  assert.deepEqual(P.parseWeekSpec('第1～4周', LEX).weeks, [1, 2, 3, 4]);
  assert.equal(codeOf(() => P.parseWeekSpec('第4-4周(单周)', LEX)), 'SCHOOL_PARSE_FAILED'); // 过滤后为空
});

test('3) segments：多段、枚举/范围节次、地点一一对应、缺失用 —', () => {
  const segs = P.parseSegments('周二第1、2节{第1-4周}(全部);周四第3、4节{第2,4,6周}(全部)', 'B204;B101', LEX);
  assert.equal(segs.length, 2);
  assert.deepEqual([segs[0].day, segs[0].first, segs[0].last, segs[0].room], [2, 1, 2, 'B204']);
  assert.deepEqual(segs[0].weeks, [1, 2, 3, 4]);
  assert.deepEqual([segs[1].day, segs[1].first, segs[1].last, segs[1].room], [4, 3, 4, 'B101']);
  assert.deepEqual(segs[1].weeks, [2, 4, 6]);
  const wide = P.parseSegments('周一第9、10、11节{第1周}(全部)', '', LEX);
  assert.deepEqual([wide[0].first, wide[0].last, wide[0].room], [9, 11, '—']);
  const range = P.parseSegments('周一第10-11节{第2周}(全部)', 'A103;东C201', LEX);
  assert.deepEqual([range[0].first, range[0].last, range[0].room], [10, 11, 'A103']);
});

test('4) period-times：1–11 时间精确，第9–11节 19:00–21:10', () => {
  const want = [
    ['08:30', '09:10'], ['09:15', '09:55'], ['10:15', '10:55'], ['11:00', '11:40'],
    ['14:00', '14:40'], ['14:45', '15:25'], ['15:45', '16:25'], ['16:30', '17:10'],
    ['19:00', '19:40'], ['19:45', '20:25'], ['20:30', '21:10'],
  ];
  assert.equal(P.PERIOD_TIMES.length, 11);
  for (let i = 0; i < want.length; i++) {
    assert.deepEqual([P.PERIOD_TIMES[i].start, P.PERIOD_TIMES[i].end], want[i], '节次 ' + (i + 1));
  }
  const parsed = P.parseTimetableRows(
    [{ kc_mc: '晚课', jx0404id: 'X', sktime: '周一第9、10、11节{第1周}(全部)', skddmc: 'B204' }], OPTIONS, LEX);
  const rule = parsed.rules[0];
  assert.deepEqual([rule.startPeriod, rule.endPeriod, rule.startTime, rule.endTime], [9, 11, '19:00', '21:10']);
  assert.equal(parsed.unscheduled.length, 0);
});

test('5) missing-period：第12节/缺时间 → SCHOOL_PARSE_FAILED', () => {
  assert.equal(codeOf(() => P.parseTimetableRows([{ kc_mc: '坏课', jx0404id: 'X', sktime: '周一第12节{第1周}(全部)' }], OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
  assert.equal(codeOf(() => P.parseSegments('周一第12节{第1周}(全部)', '', LEX)), 'SCHOOL_PARSE_FAILED');
});

test('6) rules-build：fixture 规则数 3，周次/节次/时间/房间精确', () => {
  const parsed = P.parseTimetable(fixture('timetable.html'), OPTIONS, LEX);
  assert.equal(parsed.rules.length, 3);
  assert.equal(parsed.unscheduled.length, 1);
  const byId = Object.fromEntries(parsed.rules.map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(byId).sort(), [
    'jsxsd-plan-A-2-1-2-0', 'jsxsd-plan-A-4-3-4-1', 'jsxsd-plan-B-3-5-6-0',
  ]);
  const a0 = byId['jsxsd-plan-A-2-1-2-0'];
  assert.deepEqual([a0.dayOfWeek, a0.weekday, a0.startPeriod, a0.endPeriod, a0.startTime, a0.endTime, a0.room, a0.teacher, a0.cancelled, a0.source],
    [2, 2, 1, 2, '08:30', '09:55', 'B204', '教师甲', false, 'school']);
  assert.deepEqual(a0.weeks, [1, 2, 3, 4]);
  const a1 = byId['jsxsd-plan-A-4-3-4-1'];
  assert.deepEqual([a1.dayOfWeek, a1.startPeriod, a1.endPeriod, a1.startTime, a1.endTime, a1.room], [4, 3, 4, '10:15', '11:40', 'B101']);
  assert.deepEqual(a1.weeks, [2, 4, 6]);
  const b = byId['jsxsd-plan-B-3-5-6-0'];
  assert.deepEqual([b.dayOfWeek, b.startPeriod, b.endPeriod, b.startTime, b.endTime, b.room], [3, 5, 6, '14:00', '15:25', 'A103']);
  assert.deepEqual(b.weeks, [3, 5, 7]);
  assert.equal(parsed.semesterId, OPTIONS.semesterId);
  assert.equal(parsed.totalWeeks, 10);
  assert.equal(parsed.sourceLabel, OPTIONS.sourceLabel);
});

test('7) unscheduled：第2周/null/未安排 进 unscheduled，不进入 rules', () => {
  const rows = [
    { kc_mc: '待安排课程', jg0101mc: '教师丙', jx0404id: 'plan-C', sktime: '第2周', skddmc: '' },
    { kc_mc: '无时间课程', jx0404id: 'plan-D', sktime: null, skddmc: 'B204' },
    { kc_mc: '未排课程', jx0404id: 'plan-E', sktime: '第3周', skddmc: 'A101' },
    { kc_mc: '空值课程', jx0404id: 'plan-F', sktime: '未安排', skddmc: '' },
  ];
  const parsed = P.parseTimetableRows(rows, OPTIONS, LEX);
  assert.equal(parsed.rules.length, 0);
  assert.equal(parsed.unscheduled.length, 4);
  const c = parsed.unscheduled[0];
  assert.equal(c.id, 'jsxsd-pending-plan-C-0');
  assert.deepEqual(c.weeks, [2]);
  assert.equal(c.note, '学校仅提供周次，具体上课时间待通知');
  assert.deepEqual(parsed.unscheduled[1].weeks, []);
  assert.equal(parsed.unscheduled[1].note, '学校未安排具体上课时间');
  assert.deepEqual(parsed.unscheduled[2].weeks, [3]);
  assert.deepEqual(parsed.unscheduled[3].weeks, []);
  assert.equal(parsed.unscheduled[0].teacher, '教师丙');
});

test('8) empty-and-malformed：空 data/code!==0/缺 kc_mc/坏 HTML 稳定报错', () => {
  assert.equal(codeOf(() => P.parseTimetable(JSON.stringify({ code: 0, data: [] }), OPTIONS, LEX)), 'SCHOOL_EMPTY_TIMETABLE');
  assert.equal(codeOf(() => P.parseTimetable(JSON.stringify({ code: 1, data: [{ kc_mc: 'x' }] }), OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
  assert.equal(codeOf(() => P.parseTimetableRows([{ jx0404id: 'X', sktime: '周一第1节{第1周}(全部)' }], OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
  assert.equal(codeOf(() => P.parseTimetable('<html><body>not a timetable</body></html>', OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
  assert.equal(codeOf(() => P.parseTimetable('', OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
});

test('9) page-meta-profile：xnxq01id/kbjcmsid 提取；年级/入学年份；缺失返回 null', () => {
  const page = P.parseTimetablePage(fixture('timetable.html'));
  assert.deepEqual(page, { semesterId: '2026-2027-1', modeId: '1' });
  assert.equal(P.parseTimetablePage('<html><body>no ids</body></html>'), null);
  const byYear = P.parseProfile('<table><tr><td>年级</td><td>2026级</td></tr></table>', LEX);
  assert.ok(byYear);
  assert.equal(byYear.enrollmentYear, 2026);
  const byGrade = P.parseProfile('<div>大二</div>', LEX);
  assert.ok(byGrade);
  assert.equal(byGrade.grade, 2);
  assert.equal(P.parseProfile('<html><body>无信息</body></html>', LEX), null);
});

// ---- 79a 补充：URL 白名单、登录/验证码优先报码、跨周合并与例外 ----

test('10) urls：白名单精确匹配、service 参数原样提取、重定向与课表 URL', async () => {
  const S = await imp('core/parser/SchoolUrls.ts');
  assert.equal(S.JIAOWU_HTTP, 'http://jiaowu.juwp.edu.cn:8080');
  assert.equal(S.JIAOWU_HTTPS, 'https://jiaowu.juwp.edu.cn:81');
  assert.equal(S.SSO_ENTRY, 'https://jiaowu.juwp.edu.cn:81/sso.jsp');
  assert.equal(S.CAS_LOGIN, 'https://eapp2.juwp.edu.cn:9443/cas/login');
  assert.equal(S.FRAME_PATH, '/jsxsd/framework/xsMainV.htmlx');
  assert.equal(S.TABLE_PATH, '/jsxsd/xskb/xskb_list.do?viweType=1');
  assert.equal(S.XK_PATH, '/jsxsd/xk/LoginToXk');

  const allowed = [
    S.JIAOWU_HTTP + S.FRAME_PATH,
    S.JIAOWU_HTTP + S.TABLE_PATH,
    S.JIAOWU_HTTPS + '/sso.jsp',
    S.CAS_LOGIN,
    'https://eapp2.nit.edu.cn:9443/cas/login',
    'https://portal.juwp.edu.cn/index',
    'https://jiaowuh5.juwp.edu.cn/a',
    // CAS 成功回跳实测先到 http:80，再经 https:443，之后才回 8080 的 jsxsd。
    'http://jiaowu.juwp.edu.cn/sso.jsp',
    'http://jiaowu.juwp.edu.cn/sso.jsp?ticket=ST-demo',
    'https://jiaowu.juwp.edu.cn/sso.jsp',
    'http://jiaowu.juwp.edu.cn/jsxsd/framework/xsMainV.htmlx',
    'https://jiaowu.juwp.edu.cn/jsxsd/xskb/xskb_list.do',
    'https://jiaowu.juwp.edu.cn:81/jsxsd/xskb/xskb_list.do',
  ];
  for (const url of allowed) assert.equal(S.isAllowedSchoolUrl(url), true, 'allowed: ' + url);

  const blocked = [
    'http://jiaowu.juwp.edu.cn:8081/jsxsd/x',
    'https://jiaowu.juwp.edu.cn:9443/sso.jsp',
    'http://jiaowu.juwp.edu.cn:8080/anything',
    'https://jiaowu.juwp.edu.cn/cas/login',
    'https://eapp2.juwp.edu.cn:9443/jsxsd/x',
    'http://eapp2.juwp.edu.cn:9443/cas/login',
    'http://jwgl.juwp.edu.cn:8080/jsxsd/x',
    'https://user:pass@eapp2.juwp.edu.cn:9443/cas/login',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://jiaowu.juwp.edu.cn/abc',
    'http://jiaowu.juwp.edu.cn:8080/jsxsd/x\\y',
    'https://evil-jiaowu.juwp.edu.cn:8080/jsxsd/x',
    'http://jiaowu.juwp.edu.cn:8080/jsxsd/' + 'a'.repeat(3000),
  ];
  for (const url of blocked) assert.equal(S.isAllowedSchoolUrl(url), false, 'blocked: ' + url.slice(0, 60));

  assert.deepEqual(S.SCHOOL_REDIRECT_ORIGINS, [
    'http://jiaowu.juwp.edu.cn',
    'http://jiaowu.juwp.edu.cn:8080',
    'https://jiaowu.juwp.edu.cn',
    'https://jiaowu.juwp.edu.cn:81',
    'https://eapp2.juwp.edu.cn:9443',
    'https://eapp2.nit.edu.cn:9443',
    'https://portal.juwp.edu.cn',
    'https://jiaowuh5.juwp.edu.cn',
  ]);

  assert.equal(
    S.extractServiceParam('https://eapp2.juwp.edu.cn:9443/cas/login?service=http%3A%2F%2Fjiaowu.juwp.edu.cn%3A8080%2Fsso.jsp'),
    'http%3A%2F%2Fjiaowu.juwp.edu.cn%3A8080%2Fsso.jsp'
  );
  assert.equal(S.extractServiceParam('https://eapp2.juwp.edu.cn:9443/cas/login'), null);
  assert.equal(S.extractServiceParam('https://eapp2.juwp.edu.cn:9443/cas/login?service=x#frag'), 'x');
  assert.equal(S.extractServiceParam('https://eapp2.juwp.edu.cn:9443/cas/login?service2=x'), null);

  assert.equal(S.isJiaowuTimetableUrl(S.JIAOWU_HTTP + S.TABLE_PATH), true);
  assert.equal(S.isJiaowuTimetableUrl(S.JIAOWU_HTTPS + S.TABLE_PATH), true);
  assert.equal(S.isJiaowuTimetableUrl(S.JIAOWU_HTTP + S.FRAME_PATH), false);
  assert.equal(S.isJiaowuTimetableUrl('https://eapp2.juwp.edu.cn:9443/cas/login'), false);

  assert.equal(S.isAllowedSchoolRedirect('http://jiaowu.juwp.edu.cn:8080/anything'), true);
  assert.equal(S.isAllowedSchoolRedirect('http://jiaowu.juwp.edu.cn/sso.jsp?ticket=ST-demo'), true);
  assert.equal(S.isAllowedSchoolRedirect('https://jiaowu.juwp.edu.cn/sso.jsp'), true);
  assert.equal(S.isAllowedSchoolRedirect('https://eapp2.juwp.edu.cn:9443/anywhere'), true);
  assert.equal(S.isAllowedSchoolRedirect('http://jiaowu.juwp.edu.cn:8081/x'), false);
  assert.equal(S.isAllowedSchoolRedirect('https://eapp2.juwp.edu.cn:9443.evil.example/x'), false);
  assert.equal(S.isAllowedSchoolRedirect('javascript:alert(1)'), false);
  assert.equal(S.isAllowedSchoolRedirect('https://evil.example.com/cas/login'), false);
});

test('11) login-and-captcha：登录/验证码页先于课表解析报码', () => {
  const login = fixture('login.html');
  assert.equal(P.isLoginPage(login, LEX), true);
  assert.equal(P.isCaptchaPage(login, LEX), true);
  assert.equal(codeOf(() => P.parseTimetable(login, OPTIONS, LEX)), 'SCHOOL_LOGIN_REQUIRED');

  const captchaOnly = '<html><body><input name="captcha" type="text" /></body></html>';
  assert.equal(P.isLoginPage(captchaOnly, LEX), false);
  assert.equal(P.isCaptchaPage(captchaOnly, LEX), true);
  assert.equal(codeOf(() => P.parseTimetable(captchaOnly, OPTIONS, LEX)), 'SCHOOL_CAPTCHA_REQUIRED');

  const timetable = fixture('timetable.html');
  assert.equal(P.isLoginPage(timetable, LEX), false);
  assert.equal(P.isCaptchaPage(timetable, LEX), false);
  assert.equal(P.parseTimetablePage('<html><body>no ids</body></html>'), null);
  assert.equal(P.parseTimetablePage('<input id="xnxq01id" value="" /><input id="kbjcmsid" value="1" />'), null);
});

test('12) merge-and-exceptions：跨周合并、重复周报错、字段变化写例外日期', () => {
  const dated = Object.assign({}, OPTIONS, { startDate: '2026-08-31' });
  const merged = P.parseTimetableRows([
    { kc_mc: '合并课', jg0101mc: '教师甲', jx0404id: 'plan-M', sktime: '周二第1、2节{第1-2周}(全部)', skddmc: 'A101' },
    { kc_mc: '合并课', jg0101mc: '教师甲', jx0404id: 'plan-M', sktime: '周二第1、2节{第3-4周}(全部)', skddmc: 'A102' },
  ], dated, LEX);
  assert.equal(merged.rules.length, 1);
  assert.equal(merged.rules[0].id, 'jsxsd-plan-M-2-1-2-0');
  assert.deepEqual(merged.rules[0].weeks, [1, 2, 3, 4]);
  assert.equal(merged.rules[0].room, 'A101');
  assert.deepEqual(merged.exceptions.map((item) => item.date), ['2026-09-15', '2026-09-22']);
  for (const exception of merged.exceptions) {
    assert.equal(exception.ruleId, 'jsxsd-plan-M-2-1-2-0');
    assert.equal(exception.cancel, false);
    assert.deepEqual(exception.patch, { room: 'A102' });
  }

  const teacherSplit = P.parseTimetableRows([
    { kc_mc: '换师课', jg0101mc: '教师甲', jx0404id: 'plan-E', sktime: '周五第9、10节{第1周}(全部)', skddmc: 'A101' },
    { kc_mc: '换师课', jg0101mc: '教师乙', jx0404id: 'plan-E', sktime: '周五第9、10节{第2周}(全部)', skddmc: 'A101' },
  ], dated, LEX);
  assert.equal(teacherSplit.rules.length, 1);
  assert.equal(teacherSplit.exceptions.length, 1);
  assert.equal(teacherSplit.exceptions[0].date, '2026-09-11');
  assert.deepEqual(teacherSplit.exceptions[0].patch, { teacher: '教师乙' });

  // 规则 5（Lead 2026-10-27 裁定）：同周重复静默保留首条，不再抛错（与 Web 版一致）。
  const duplicate = [
    { kc_mc: '重复课', jx0404id: 'plan-D', sktime: '周二第1、2节{第1-4周}(全部)', skddmc: 'A101' },
    { kc_mc: '重复课', jx0404id: 'plan-D', sktime: '周二第1、2节{第1-4周}(全部)', skddmc: 'A101' },
  ];
  const deduped = P.parseTimetableRows(duplicate, OPTIONS, LEX);
  assert.equal(deduped.rules.length, 1);
  assert.deepEqual(deduped.rules[0].weeks, [1, 2, 3, 4]);
  assert.equal(deduped.exceptions.length, 0);
});

test('13) pending-weeks-annotation：{第4周}(全部) 进 unscheduled、weeks[4]、note 用资源值', () => {
  const result = P.parseTimetableRows([
    { kc_mc: '待安排课程', jg0101mc: '教师丙', jx0404id: 'plan-C', sktime: '{第4周}(全部)', skddmc: '' },
  ], OPTIONS, productionLexicon());
  assert.equal(result.rules.length, 0);
  assert.equal(result.unscheduled.length, 1);
  const pending = result.unscheduled[0];
  assert.equal(pending.id, 'jsxsd-pending-plan-C-0');
  assert.deepEqual(pending.weeks, [4]);
  assert.equal(pending.note, productionLexicon().unscheduledNoteWeeksOnly);

  // §2.4 规则 7：未排课/未排时间/无 也算未安排（P1-6），并给出 no-time 文案
  for (const marker of ['未排课', '未排时间', '无', '待定']) {
    const got = P.parseTimetableRows([
      { kc_mc: '待安排课程', jx0404id: 'plan-C', sktime: marker, skddmc: '' },
    ], OPTIONS, productionLexicon());
    assert.equal(got.unscheduled.length, 1, marker + ' 应进 unscheduled');
    assert.equal(got.unscheduled[0].note, productionLexicon().unscheduledNoteNoTime, marker);
  }
});

test('14) production-lexicon：string.json 生产值下 ～/－/~ 范围与请假标签可解析', () => {
  const lex = productionLexicon();
  const options = Object.assign({}, OPTIONS, { totalWeeks: 20 });
  const cases = [
    ['第9～11周', [9, 10, 11]],
    ['第5－10周', [5, 6, 7, 8, 9, 10]],
    ['第5~10周', [5, 6, 7, 8, 9, 10]],
    ['第5至10周', [5, 6, 7, 8, 9, 10]],
  ];
  for (const [spec, weeks] of cases) {
    const parsed = P.parseTimetableRows([
      { kc_mc: '范围课', jx0404id: 'plan-R', sktime: '周二第1、2节{' + spec + '}(全部)', skddmc: 'A101' },
    ], options, lex);
    assert.deepEqual(parsed.rules[0].weeks, weeks, spec);
  }

  // 工厂映射守卫：范围符硬编码形态在工厂里、组 token 用 '|' 合并、请假标签走资源键（P0-1/P1-4 复发防线）
  const factory = fs.readFileSync(path.join(process.env.HARMONY_ROOT, 'entry/src/main/ets/platform/school/ParserLexiconFactory.ets'), 'utf8');
  for (const sep of ['\uFF0D', '\u2013', '\u2014', '~', '\uFF5E']) {
    assert.ok(factory.includes("'" + sep + "'"), '工厂范围符缺 ' + sep);
  }
  assert.ok(factory.includes('school_lex_range_separator'));
  assert.ok(factory.includes("split('|')"));
  for (const key of ['school_lex_leave_start', 'school_lex_leave_end', 'school_lex_leave_submitted', 'school_lex_leave_number', 'school_lex_leave_duration']) {
    assert.ok(factory.includes(key), '工厂未注入 ' + key);
  }
  assert.equal(lex.leaveStart, '请假开始时间');
  assert.equal(lex.leaveNumber, '请假编号');
});

test('15) plan-id-fallback：缺 jx0404id/kch 时用课程名兜底，缺课程名仍报错', () => {
  const byName = P.parseTimetableRows([
    { kc_mc: '仅名称课程', jg0101mc: '教师丁', sktime: '周一第1、2节{第1周}(全部)', skddmc: 'A101' },
  ], OPTIONS, LEX);
  assert.equal(byName.rules.length, 1);
  assert.equal(byName.rules[0].id, 'jsxsd-仅名称课程-1-1-2-0');

  const byCode = P.parseTimetableRows([
    { kc_mc: '有代码课程', kch: 'K-001', sktime: '周一第3、4节{第1周}(全部)', skddmc: 'A102' },
  ], OPTIONS, LEX);
  assert.equal(byCode.rules[0].id, 'jsxsd-K-001-1-3-4-0');

  assert.equal(codeOf(() => P.parseTimetableRows([
    { kch: 'K-002', sktime: '周一第1、2节{第1周}(全部)', skddmc: 'A101' },
  ], OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
});

test('16) profile-no-guess：学号/专业不猜、入学日期→入学年份、大X→年级', () => {
  assert.equal(P.parseProfile('<table><tr><td>学号</td><td>2023123456</td></tr></table>', LEX), null);
  assert.equal(P.parseProfile('<table><tr><td>专业</td><td>计算机科学与技术</td></tr></table>', LEX), null);
  const byDate = P.parseProfile('<table><tr><td>入学日期</td><td>2026-09-01</td></tr></table>', LEX);
  assert.ok(byDate);
  assert.equal(byDate.enrollmentYear, 2026);
  const byYear = P.parseProfile('<table><tr><td>入学年份</td><td>2025</td></tr></table>', LEX);
  assert.equal(byYear.enrollmentYear, 2025);
  const byGradeYear = P.parseProfile('<table><tr><td>年级</td><td>2026级</td></tr></table>', LEX);
  assert.equal(byGradeYear.enrollmentYear, 2026);
  const byGradeName = P.parseProfile('<table><tr><td>年级</td><td>大二</td></tr></table>', LEX);
  assert.equal(byGradeName.grade, 2);
  const bySpan = P.parseProfile('<table><tr><td>入学年份</td><td>2025-2026学年</td></tr></table>', LEX);
  assert.equal(bySpan.enrollmentYear, 2025);
  assert.equal(bySpan.academicYear, 2025);
});

test('17) e2e-resource-lexicon：string.json 生产值 + leave.json → records=2 / skipped=1', async () => {
  const O = await imp('core/parser/OfficeLeaveParser.ts');
  const lex = productionLexicon();
  const got = O.parseOfficeLeave(fixture('leave.json'), lex);
  assert.equal(got.error, null);
  assert.equal(got.records.length, 2);
  assert.equal(got.skipped, 1);
  const one = got.records.find((item) => item.id === 'leave-1');
  assert.ok(one);
  assert.equal(one.status, 'approved');
  assert.equal(one.type, 'leave');
  assert.equal(one.reason, '身体不适');
  assert.deepEqual([one.startDate, one.startTime, one.endDate, one.endTime], ['2026-10-20', '08:30', '2026-10-20', '10:00']);
  const two = got.records.find((item) => item.id === 'leave-2');
  assert.ok(two);
  assert.equal(two.status, 'pending');
  assert.equal(two.type, 'renew');
  assert.deepEqual([two.startDate, two.startTime, two.endDate, two.endTime], ['2026-10-22', '09:00', '2026-10-22', '10:30']);
});

test('18) limits-and-types：2MB 上限、data 非数组/空、sktime 非字符串 → 稳定错误码', async () => {
  const O = await imp('core/parser/OfficeLeaveParser.ts');
  const huge = 'x'.repeat(2000001);
  assert.equal(codeOf(() => P.parseTimetable(huge, OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
  assert.equal(codeOf(() => P.parseTimetable(JSON.stringify({ code: 0, data: {} }), OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
  assert.equal(codeOf(() => P.parseTimetable(JSON.stringify({ code: 0, data: [] }), OPTIONS, LEX)), 'SCHOOL_EMPTY_TIMETABLE');
  assert.equal(codeOf(() => P.parseTimetable(JSON.stringify({ code: 1, data: [{}] }), OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
  assert.equal(codeOf(() => P.parseTimetableRows([{ kc_mc: '坏类型课程', sktime: 123 }], OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
  assert.equal(codeOf(() => P.parseTimetableRows([{ kc_mc: '坏类型课程', sktime: {} }], OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
  const lex = productionLexicon();
  assert.equal(O.parseOfficeLeave(huge, lex).error, 'OFFICE_UNAVAILABLE');
  assert.equal(O.parseOfficeLeave(JSON.stringify({ data: { formsUserList: {} } }), lex).error, 'OFFICE_UNAVAILABLE');
  assert.equal(O.parseOfficeLeave(JSON.stringify({ data: [] }), lex).error, 'OFFICE_UNAVAILABLE');
  assert.equal(P.parseProfile('<td>姓名</td><td>张三</td>', lex), null);
});

test('19) status-matrix：生产资源 token 全量映射 rejected/pending/approved（P1-5 回归）', async () => {
  const O = await imp('core/parser/OfficeLeaveParser.ts');
  const lex = productionLexicon();
  const field = (label, val) => ({ label, values: [{ val }] });
  const statusOf = (raw) => {
    const form = { id: 's1', aprvStatusType: raw, aprvStatusTypeId: '9', formData: { blocks: [{ fields: [
      field(lex.leaveStart, '2026-10-20 08:30'), field(lex.leaveEnd, '2026-10-20 09:00'),
    ] }] } };
    const got = O.parseOfficeLeave(JSON.stringify({ data: { formsUserList: [form] } }), lex);
    assert.equal(got.records.length, 1, '状态样本应可解析：' + raw);
    return got.records[0].status;
  };
  for (const raw of ['驳回', '退回', '不通过', '拒绝', '不同意', '未通过']) assert.equal(statusOf(raw), 'rejected', raw);
  for (const raw of ['待', '审批中', '处理中', '审核中']) assert.equal(statusOf(raw), 'pending', raw);
  for (const raw of ['通过', '批准', '同意', '已完成']) assert.equal(statusOf(raw), 'approved', raw);
  assert.equal(statusOf('未知状态'), 'unknown');
});

// P1-B：有课程名但时间不可解析 → invalid-time；空行/非对象不计；周次被 totalWeeks 过滤不算丢行。
test('20) skipped-accounting：invalid-time/空行/周次过滤', () => {
  const parsed = P.parseTimetableRows([
    { kc_mc: '秘密课程名', jx0404id: 'x1', sktime: '周一 abc' },
    null,
    undefined,
    '',
    { kc_mc: '周次超范围', jx0404id: 'x2', sktime: '周一第1节{第12周}(全部)' },
  ], OPTIONS, LEX);
  assert.equal(parsed.skippedRows, 1);
  assert.deepEqual(parsed.skippedReasons, ['invalid-time']);
  assert.equal(parsed.rules.length, 0);
  assert.equal(parsed.unscheduled.length, 0);
});

// 早失败优先：第 12 节在 parseSegments 的 validatePeriod 就抛 PARSE_FAILED，属更严格行为；
// 行级 invalid-period 仅在 validatePeriod 放宽后才可达（skippedReasons 该分支先留作防御）。
test('20b) invalid-period 当前在 parseSegments 即失败（行级 skipped 分支不可达）', () => {
  assert.equal(codeOf(() => P.parseTimetableRows([
    { kc_mc: '坏节次', jx0404id: 'x3', sktime: '周一第12节{第1周}(全部)' },
  ], OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
});

// P2：空对象/空数组行语义上应视为空行（不计 skipped）；isEmptyRow 覆盖此场景。
test('23) 空对象行应视为空行（不计 skipped）', () => {
  const parsed = P.parseTimetableRows([{}, []], OPTIONS, LEX);
  assert.equal(parsed.skippedRows, 0);
  assert.equal(parsed.rules.length, 0);
});

// parseTimetable 在 skippedRows>0 时必须 PARSE_FAILED，detail 带条数且不泄露原始行文本。
test('21) parseTimetable：skippedRows>0 抛 PARSE_FAILED 且 detail 不含原始行', () => {
  const payload = JSON.stringify({
    code: 0,
    data: [{ kc_mc: '秘密课程名', jx0404id: 'x4', sktime: '周一 abc' }],
  });
  assert.throws(() => P.parseTimetable(payload, OPTIONS, LEX), (error) => {
    assert.equal(error.code, 'SCHOOL_PARSE_FAILED');
    assert.match(String(error.message), /dropped 1 course rows/);
    assert.equal(String(error.message).includes('秘密课程名'), false);
    assert.equal(String(error.message).includes('周一 abc'), false);
    return true;
  });
});

test('22) EMPTY_TIMETABLE 与 PARSE_FAILED 互斥', () => {
  assert.equal(codeOf(() => P.parseTimetable(JSON.stringify({ code: 0, data: [] }), OPTIONS, LEX)), 'SCHOOL_EMPTY_TIMETABLE');
  assert.equal(codeOf(() => P.parseTimetable('', OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
  assert.equal(codeOf(() => P.parseTimetable(JSON.stringify({ code: 0, data: [{ kc_mc: 'x', sktime: '周一 abc' }] }), OPTIONS, LEX)), 'SCHOOL_PARSE_FAILED');
});
