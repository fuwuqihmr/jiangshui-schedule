import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
const fixtures = process.env.HARMONY_FIXTURES;
if (!tmp || !fixtures) throw new Error('HARMONY_CORE_TMP/HARMONY_FIXTURES 未设置，请用 run-core-tests.mjs 运行');

const imp = (p) => import(pathToFileURL(path.join(tmp, p)).href);
const O = await imp('core/parser/OfficeLeaveParser.ts');

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
const field = (label, val) => ({ label, values: [{ val }] });
const form = (over = {}) => ({
  id: 'r1',
  aprvStatusType: '已通过',
  aprvStatusTypeId: '2',
  allAprvUserList: '辅导员',
  inserttime: 1729500000000,
  formData: { blocks: [{ fields: [
    field('请假类型', '请假'),
    field('请假原因', '测试原因'),
    field('请假开始时间', '2026-10-20 08:30'),
    field('请假结束时间', '2026-10-20 10:00'),
    field('请假申请时间', '2026-10-19 10:00'),
  ] }] },
  ...over,
});
const wrap = (list) => JSON.stringify({ data: { formsUserList: list } });

test('15) leave-mapping：approved/pending 映射、类型/原因/起止/审批人/submittedAt、cancel 识别', () => {
  const got = O.parseOfficeLeave(fixture('leave.json'), LEX);
  assert.equal(got.error, null);
  assert.equal(got.records.length, 2);
  assert.equal(got.skipped, 1);
  const one = got.records.find((r) => r.id === 'leave-1');
  assert.ok(one);
  assert.equal(one.type, 'leave');
  assert.equal(one.status, 'approved');
  assert.deepEqual([one.startDate, one.startTime, one.endDate, one.endTime], ['2026-10-20', '08:30', '2026-10-20', '10:00']);
  assert.equal(one.reason, '身体不适');
  assert.equal(one.approver, '辅导员');
  assert.equal(one.submittedAt, '2026-10-19T10:00:00Z');
  assert.equal(one.comment, '');
  assert.equal(one.semesterId, '');
  assert.equal(one.demo, false);
  const two = got.records.find((r) => r.id === 'leave-2');
  assert.ok(two);
  assert.equal(two.type, 'renew');
  assert.equal(two.status, 'pending');
  assert.deepEqual([two.startDate, two.startTime, two.endDate, two.endTime], ['2026-10-22', '09:00', '2026-10-22', '10:30']);
  assert.equal(two.submittedAt, new Date(1729500000000).toISOString());
  // 销假 -> cancel
  const cancel = O.parseOfficeLeave(wrap([form({ id: 'c1', formData: { blocks: [{ fields: [
    field('请假类型', '销假'), field('请假原因', '提前返校'),
    field('请假开始时间', '2026-10-21 08:00'), field('请假结束时间', '2026-10-21 09:00'),
  ] }] } })]), LEX);
  assert.equal(cancel.records[0].type, 'cancel');
});

// 规格恢复（§2.8:309 / §7.4:580）：缺 id 的假条跳过并计 skipped，不合成 leave-row-<index>；坏时间同样跳过
test('16) leave-invalid：缺 id 跳过并计 skipped，坏时间跳过，skipped 正确', () => {
  const list = [
    form({ id: 'ok-1', autoId: undefined }),
    form({ id: undefined, autoId: undefined }),
    form({ id: 'bad-1', formData: { blocks: [{ fields: [
      field('请假开始时间', 'not-a-time'), field('请假结束时间', '2026-10-20 10:00'),
    ] }] } }),
    form({ id: 'bad-2', formData: { blocks: [{ fields: [
      field('请假开始时间', '2026-10-20 10:00'), field('请假结束时间', '2026-10-20 09:00'),
    ] }] } }),
  ];
  const got = O.parseOfficeLeave(wrap(list), LEX);
  assert.equal(got.error, null);
  assert.equal(got.records.length, 1);
  assert.deepEqual(got.records.map((r) => r.id), ['ok-1']);
  assert.equal(got.skipped, 3);
  const notArray = O.parseOfficeLeave(JSON.stringify({ data: { formsUserList: {} } }), LEX);
  assert.equal(notArray.error, 'OFFICE_UNAVAILABLE');
  assert.equal(notArray.records.length, 0);
  assert.equal(O.parseOfficeLeave('<html>login</html>', LEX).error, 'OFFICE_SESSION_REQUIRED');
  assert.equal(O.parseOfficeLeave('', LEX).error, 'OFFICE_UNAVAILABLE');
});

test('17) leave-status：退回/驳回、审批中、未识别文本不回落 id；仅空文本+id=2 回退 approved；最多 200 条', () => {
  const statusOf = (raw, id) => O.parseOfficeLeave(wrap([form({ id: 's1', aprvStatusType: raw, aprvStatusTypeId: id })]), LEX).records[0].status;
  assert.equal(statusOf('驳回', '3'), 'rejected');
  assert.equal(statusOf('已退回', '3'), 'rejected');
  assert.equal(statusOf('审批中', '1'), 'pending');
  assert.equal(statusOf('已通过', '3'), 'approved');
  assert.equal(statusOf('', '2'), 'approved');
  assert.equal(statusOf('', '3'), 'unknown');
  assert.equal(statusOf('其它状态', '9'), 'unknown');
  // P1-6（spec:312 + lead 裁定 B+web）：文本优先；非空未识别文本保持 unknown，绝不回落 id=2。
  assert.equal(statusOf('未审核', '2'), 'unknown', '未识别文本不得按 id=2 升格 approved');
  assert.equal(statusOf('已通过', '1'), 'approved', '已通过文本优先于非回退 id');
  assert.equal(statusOf('待审核', '1'), 'pending');
  assert.equal(statusOf('', '1'), 'unknown');
  assert.equal(statusOf('', null), 'unknown');
  const many = [];
  for (let i = 0; i < 250; i++) many.push(form({ id: 'm' + i }));
  assert.equal(O.parseOfficeLeave(wrap(many), LEX).records.length, 200);
});

// ---- 79a 补充（lead 拍板）：空格与 T 两种分隔都必须接受，垃圾时间跳过 ----

test('18) leave-time-separators：YYYY-MM-DD HH:mm[:ss] 与 YYYY-MM-DDTHH:mm[:ss] 都通过', () => {
  const fieldsOf = (start, end) => ({ blocks: [{ fields: [
    field('请假类型', '请假'),
    field('请假原因', '分隔符测试'),
    field('请假开始时间', start),
    field('请假结束时间', end),
  ] }] });
  const got = O.parseOfficeLeave(wrap([
    form({ id: 'space', formData: fieldsOf('2026-10-20 08:30:00', '2026-10-20 10:00:00') }),
    form({ id: 'tee', formData: fieldsOf('2026-10-20T08:30:00', '2026-10-20T10:00:00') }),
    form({ id: 'space-short', formData: fieldsOf('2026-10-20 08:30', '2026-10-20 09:00') }),
    form({ id: 'tee-short', formData: fieldsOf('2026-10-20T08:30', '2026-10-20T09:00') }),
    form({ id: 'junk', formData: fieldsOf('2026/10/20 08:30', '2026-10-20 09:00') }),
    form({ id: 'junk2', formData: fieldsOf('2026-10-20T25:00', '2026-10-20 09:00') }),
  ]), LEX);
  assert.equal(got.error, null);
  assert.deepEqual(got.records.map((r) => r.id), ['space', 'tee', 'space-short', 'tee-short']);
  assert.equal(got.skipped, 2);
  for (const record of got.records) {
    assert.equal(record.startDate, '2026-10-20');
    assert.equal(record.endDate, '2026-10-20');
  }
  assert.deepEqual([got.records[0].startTime, got.records[0].endTime], ['08:30', '10:00']);
  assert.deepEqual([got.records[1].startTime, got.records[1].endTime], ['08:30', '10:00']);
});

// ---- 79a P0-1 端到端：生产资源 string.json -> SchoolLexicon -> 金样本 leave.json ----

const root = process.env.HARMONY_ROOT;
if (!root) throw new Error('HARMONY_ROOT 未设置，请用 run-core-tests.mjs 运行');

const lexFromResources = () => {
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'entry/src/main/resources/base/element/string.json'), 'utf8'));
  const map = {};
  for (const item of doc.string) map[item.name] = item.value;
  const pick = (name) => {
    const value = map['school_lex_' + name];
    if (typeof value !== 'string') throw new Error('缺少资源 school_lex_' + name);
    return value;
  };
  const split = (name) => pick(name).split('|').map((part) => part.trim()).filter((part) => part.length > 0);
  return {
    weekPrefix: pick('week_prefix'), weekSuffix: pick('week_suffix'),
    weekAll: pick('week_all'), weekOdd: pick('week_odd'), weekEven: pick('week_even'),
    dayChars: ['day_1', 'day_2', 'day_3', 'day_4', 'day_5', 'day_6', 'day_7'].map(pick),
    periodPrefix: pick('period_prefix'), periodSuffix: pick('period_suffix'),
    unscheduledValues: ['unscheduled_1', 'unscheduled_2', 'unscheduled_3'].flatMap(split).concat(['']),
    profileLabels: ['profile_1', 'profile_2', 'profile_3', 'profile_4', 'profile_5', 'profile_6'].map(pick),
    leaveType: pick('leave_type'), leaveReason: pick('leave_reason'), leaveStart: pick('leave_start'),
    leaveEnd: pick('leave_end'), leaveSubmitted: pick('leave_submitted'),
    leaveNumber: pick('leave_number'), leaveDuration: pick('leave_duration'),
    statusRejected: split('status_rejected_1').concat(split('status_rejected_2')),
    statusPending: split('status_pending_1').concat(split('status_pending_2')),
    statusApproved: split('status_approved_1').concat(split('status_approved_2')),
    rangeSeparators: split('range_separator'),
    unscheduledNoteNoTime: pick('unscheduled_note_no_time'),
    unscheduledNoteWeeksOnly: pick('unscheduled_note'),
    leaveTypeCancel: pick('leave_type_cancel'), leaveTypeRenew: pick('leave_type_renew'),
    profileYearSuffix: pick('profile_year_suffix'), profileGradePrefix: pick('profile_grade_prefix'),
  };
};

test('19) leave-resource-e2e：string.json 构造的 lexicon 解析金样本 leave.json 得到 records=2/skipped=1', () => {
  const got = O.parseOfficeLeave(fixture('leave.json'), lexFromResources());
  assert.equal(got.error, null);
  assert.equal(got.records.length, 2);
  assert.equal(got.skipped, 1);
  assert.deepEqual(got.records.map((r) => [r.id, r.status, r.type]).sort(), [
    ['leave-1', 'approved', 'leave'],
    ['leave-2', 'pending', 'renew'],
  ]);
});

// ---- P2（lead）：只给日期的 endAt 归 23:59（与 Web 版一致），startAt date-only 仍 00:00 ----

test('20) leave-date-only-end：结束日期只给日期时归 23:59，开始日期只给日期仍 00:00', () => {
  const fieldsOf = (start, end, submitted) => ({ blocks: [{ fields: [
    field('请假类型', '请假'),
    field('请假原因', '日期边界'),
    field('请假开始时间', start),
    field('请假结束时间', end),
    ...(submitted ? [field('请假申请时间', submitted)] : []),
  ] }] });
  const got = O.parseOfficeLeave(wrap([
    form({ id: 'd1', formData: fieldsOf('2026-10-20', '2026-10-23', '2026-10-19') }),
    form({ id: 'd2', formData: fieldsOf('2026-10-20 08:30', '2026-10-20') }),
  ]), LEX);
  assert.equal(got.error, null);
  assert.equal(got.skipped, 0);
  const one = got.records.find((r) => r.id === 'd1');
  assert.deepEqual([one.startDate, one.startTime], ['2026-10-20', '00:00']);
  assert.deepEqual([one.endDate, one.endTime], ['2026-10-23', '23:59']);
  // 申请时间的 date-only 不受影响，仍归一为 T00:00:00
  assert.equal(one.submittedAt, '2026-10-19T00:00:00');
  // 同一天：开始 08:30 < 结束 23:59，必须保留而不是跳过
  const two = got.records.find((r) => r.id === 'd2');
  assert.deepEqual([two.startDate, two.startTime], ['2026-10-20', '08:30']);
  assert.deepEqual([two.endDate, two.endTime], ['2026-10-20', '23:59']);
});

// ---- P1（lead）：按学期过滤；源记录缺学期字段时保留，semesterId 未传行为不变 ----

test('21) leave-semester-filter：传 semesterId 过滤不匹配记录、缺学期字段的记录保留', () => {
  const list = [
    form({ id: 'sem-a', semesterId: '2026-2027-1' }),
    form({ id: 'sem-b', semesterId: '2025-2026-2' }),
    form({ id: 'sem-c' }), // 源记录没有学期字段
  ];
  // 未传 options：不过滤、semesterId 保持 ''（行为不变）
  const unfiltered = O.parseOfficeLeave(wrap(list), LEX);
  assert.equal(unfiltered.error, null);
  assert.deepEqual(unfiltered.records.map((r) => r.id), ['sem-a', 'sem-b', 'sem-c']);
  assert.equal(unfiltered.skipped, 0);
  for (const record of unfiltered.records) assert.equal(record.semesterId, '');

  // 传当前学期：不匹配的 sem-b 被过滤且计入 skipped；sem-a 匹配；sem-c 缺字段保留并回填
  const filtered = O.parseOfficeLeave(wrap(list), LEX, { semesterId: '2026-2027-1' });
  assert.equal(filtered.error, null);
  assert.deepEqual(filtered.records.map((r) => r.id), ['sem-a', 'sem-c']);
  assert.equal(filtered.skipped, 1);
  for (const record of filtered.records) assert.equal(record.semesterId, '2026-2027-1');
});
