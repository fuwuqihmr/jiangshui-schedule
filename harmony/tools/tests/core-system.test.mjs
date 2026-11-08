import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');

async function load(rel) {
  return import(pathToFileURL(path.join(tmp, rel)).href);
}
const calendar = await load('core/system/CalendarPlanner.ts');
const reminders = await load('core/system/ReminderPlanner.ts');
const unread = await load('core/system/UnreadSummary.ts');
const gate = await load('core/system/ReminderGate.ts');
const timetable = await load('core/timetable/TimetableCore.ts');
const notifyState = await load('core/system/NotificationState.ts');

// 依赖注入：core/data 纯逻辑门禁不允许 CalendarPlanner 运行时 import TimetableCore。
const resolveDay = (st, date) => timetable.resolveDay(st, date);

function rule(over) {
  return {
    id: 'r1',
    name: 'Math',
    teacher: 'T1',
    room: 'A101',
    dayOfWeek: 3,
    startPeriod: 1,
    endPeriod: 2,
    periods: [1, 2],
    weeks: [1, 2, 3, 4],
    startTime: '08:00',
    endTime: '09:35',
    cancelled: false,
    source: 'school',
    ...over
  };
}

function snapshot(over) {
  return {
    id: 'sem-1',
    name: 'Spring',
    startDate: '2026-03-02',
    weeks: 8,
    rules: [],
    source: 'school',
    ...over
  };
}

function state(snap, options, extra) {
  return {
    version: 2,
    snapshot: snap,
    calendarOptions: options,
    changeRecords: [],
    customCourses: [],
    overrides: [],
    localMaps: [],
    holidaySettings: null,
    ...(extra || {})
  };
}

test('1) 日历展开：按周次生成、闭校日与停课例外被跳过', () => {
  const snap = snapshot({
    rules: [rule({})],
    closedDates: ['2026-03-11'],
    exceptions: [{ date: '2026-03-18', ruleId: 'r1', cancel: true }]
  });
  const options = { school: true, custom: true, study: true };
  const plan = calendar.planCalendarEvents(state(snap, options), options, resolveDay);
  assert.equal(plan.error, null);
  assert.deepEqual(plan.events.map((e) => e.startDate), ['2026-03-04', '2026-03-25']);
  assert.equal(plan.events[0].title, 'Math');
  assert.equal(plan.events[0].location, 'A101');
  assert.ok(calendar.keyFromDescription(plan.events[0].description), '描述里应能取回稳定 key');
  assert.equal(plan.events[0].key, '2026-03-04/2026-03-04/r1');
  assert.equal(calendar.calendarEventKey('2026-03-04', '2026-03-04/r1'), plan.events[0].key);
});

test('2) 日历调课例外：patch 覆盖时间与教室', () => {
  const snap = snapshot({
    rules: [rule({ weeks: [4] })],
    exceptions: [{ date: '2026-03-25', ruleId: 'r1', cancel: false, patch: { startTime: '10:00', endTime: '11:35', room: 'B202' } }]
  });
  const options = { school: true, custom: false, study: false };
  const plan = calendar.planCalendarEvents(state(snap, options), options, resolveDay);
  assert.equal(plan.events.length, 1);
  assert.equal(plan.events[0].startTime, '10:00');
  assert.equal(plan.events[0].location, 'B202');
  const expected = new Date(2026, 2, 25, 10, 0, 0).getTime();
  assert.equal(plan.events[0].startMillis, expected);
});

test('3) 日历来源开关：关闭 school 后只剩 custom（真实 customCourses）', () => {
  const customCourses = [{
    id: 'c1',
    mode: 'weekly',
    name: 'Art',
    teacher: 'T2',
    room: 'C303',
    startTime: '10:00',
    endTime: '11:35',
    dayOfWeek: 1,
    startPeriod: 3,
    endPeriod: 4,
    weeks: [1],
    semesterId: 'sem-1',
    semesterStartDate: '2026-03-02',
    startWeek: 1,
    endWeek: 1,
    weekPattern: 'every'
  }];
  const onlyCustomOptions = { school: false, custom: true, study: false };
  const onlyCustom = calendar.planCalendarEvents(
    state(snapshot({ rules: [rule({})] }), onlyCustomOptions, { customCourses: customCourses }),
    onlyCustomOptions,
    resolveDay
  );
  assert.deepEqual(onlyCustom.events.map((e) => e.title), ['Art']);
  assert.ok(onlyCustom.events.every((e) => e.source === 'custom'));
  const onlySchoolOptions = { school: true, custom: false, study: false };
  const onlySchool = calendar.planCalendarEvents(
    state(snapshot({ rules: [rule({})] }), onlySchoolOptions, { customCourses: customCourses }),
    onlySchoolOptions,
    resolveDay
  );
  assert.equal(onlySchool.events.length, 4);
  assert.ok(onlySchool.events.every((e) => e.title === 'Math'));
});

test('4) 日历差量：只新增缺的、只删除过期的', () => {
  const plan = [{ key: 'a' }, { key: 'b' }];
  const diff = calendar.diffCalendarKeys(plan, ['b', 'c']);
  assert.deepEqual(diff.add.map((e) => e.key), ['a']);
  assert.deepEqual(diff.removeKeys, ['c']);
  assert.equal(diff.keep, 1);
  const none = calendar.diffCalendarKeys([], ['x', 'y']);
  assert.deepEqual(none.removeKeys, ['x', 'y']);
});

test('5) 提醒提前量：夹取到 1..240，非法值回落 30', () => {
  assert.equal(reminders.normalizeLeadMinutes(0), 1);
  assert.equal(reminders.normalizeLeadMinutes(-5), 1);
  assert.equal(reminders.normalizeLeadMinutes(999), 240);
  assert.equal(reminders.normalizeLeadMinutes(Number.NaN), 30);
  assert.equal(reminders.normalizeLeadMinutes(30), 30);
});

test('6) 提醒计划：跳过已开始/停课/空课，跨天排序', () => {
  const days = [
    {
      date: '2026-03-02',
      rows: [
        { key: 'k1', date: '2026-03-02', name: 'A', room: 'R1', teacher: 'T', startTime: '08:00', endTime: '09:00' },
        { key: 'k2', date: '2026-03-02', name: 'B', room: 'R1', teacher: 'T', startTime: '07:00', endTime: '08:00' },
        { key: 'k3', date: '2026-03-02', name: 'C', room: 'R1', teacher: 'T', startTime: '09:00', endTime: '10:00', cancelled: true },
        { key: 'k4', date: '2026-03-02', name: 'D', room: 'R1', teacher: 'T', startTime: '10:00', endTime: '11:00', vacant: true }
      ]
    },
    { date: '2026-03-03', rows: [{ key: 'k5', date: '2026-03-03', name: 'E', room: 'R2', teacher: 'T', startTime: '09:00', endTime: '10:00' }] }
  ];
  const now = new Date(2026, 2, 2, 6, 30, 0).getTime();
  const plan = reminders.planReminders(days, now, 30);
  assert.deepEqual(plan.targets.map((t) => t.name), ['A', 'E']);
  assert.equal(plan.targets[0].triggerMillis, new Date(2026, 2, 2, 7, 30, 0).getTime());
  assert.equal(plan.targets[1].triggerMillis, new Date(2026, 2, 3, 8, 30, 0).getTime());
  assert.ok(plan.nextMillis > now);
  assert.equal(plan.skipped, 3);
});

test('7) 提醒去重与上限：同一天同 key 只排一次', () => {
  const row = { key: 'same', date: '2026-03-02', name: 'A', room: 'R', teacher: 'T', startTime: '08:00', endTime: '09:00' };
  const plan = reminders.planReminders([{ date: '2026-03-02', rows: [row, { ...row }] }], new Date(2026, 2, 2, 0, 0, 0).getTime(), 20);
  assert.equal(plan.targets.length, 1);
});

test('8) 未读汇总：read 标记计数、取最新日期一条、角标夹取', () => {
  const st = {
    version: 2,
    snapshot: null,
    changeRecords: [
      { id: '1', date: '2026-03-02', title: 'old', detail: 'd1', read: true },
      { id: '2', date: '2026-03-05', title: 'mid', detail: 'd2', read: false },
      { id: '3', date: '2026-03-09', title: 'new', detail: 'd3', read: false }
    ]
  };
  const summary = unread.summarizeUnread(st);
  assert.equal(summary.unread, 2);
  assert.equal(summary.latestTitle, 'new');
  assert.equal(summary.latestDetail, 'd3');
  assert.equal(summary.latestDate, '2026-03-09');
  assert.equal(unread.badgeNumber(0), 0);
  assert.equal(unread.badgeNumber(-3), 0);
  assert.equal(unread.badgeNumber(120), 99);
  assert.equal(unread.badgeNumber(7), 7);
});

test('9) 日历选项全关：不产生事件并返回 CALENDAR_NO_OPTIONS', () => {
  const options = { school: false, custom: false, study: false };
  const plan = calendar.planCalendarEvents(state(snapshot({ rules: [rule({})] }), options), options, resolveDay);
  assert.equal(plan.error, 'CALENDAR_NO_OPTIONS');
  assert.deepEqual(plan.events, []);
  assert.equal(plan.total, 0);
});

test('10) 日历上限：超过 5000 条事件全有或全无', () => {
  const allWeeks = [];
  for (let week = 1; week <= 60; week++) {
    allWeeks.push(week);
  }
  const rules = [];
  for (let i = 0; i < 100; i++) {
    rules.push(rule({ id: 'r' + String(i), weeks: allWeeks }));
  }
  const options = { school: true, custom: true, study: true };
  const plan = calendar.planCalendarEvents(state(snapshot({ weeks: 60, rules: rules }), options), options, resolveDay);
  assert.equal(plan.error, 'CALENDAR_TOO_MANY_EVENTS');
  assert.deepEqual(plan.events, []);
  assert.equal(plan.total, 0);
  assert.equal(plan.skipped, 0);
});

test('11) 调休：localMap 把周三课移到周一，原日不再出现', () => {
  const options = { school: true, custom: true, study: true };
  const st = state(snapshot({ rules: [rule({ weeks: [1] })] }), options, {
    localMaps: [{ id: 'm1', date: '2026-03-09', fromDate: '2026-03-04', mode: 'replace' }]
  });
  const plan = calendar.planCalendarEvents(st, options, resolveDay);
  assert.equal(plan.error, null);
  assert.deepEqual(plan.events.map((e) => e.startDate), ['2026-03-09']);
  assert.equal(plan.events[0].title, 'Math');
  assert.equal(plan.events[0].source, 'school');
});

test('12) 晚自习：一年级 studyPolicy 生成 study 事件', () => {
  const policy = {
    enabled: true,
    userEnabled: true,
    userDisabled: false,
    profile: { enrollmentYear: 2025 },
    holidayDates: [],
    verifiedYears: [2025],
    sourceLabel: 'study',
    startTime: '19:00',
    endTime: '20:30'
  };
  const options = { school: true, custom: true, study: true };
  const st = state(snapshot({ rules: [], studyPolicy: policy }), options);
  const plan = calendar.planCalendarEvents(st, options, resolveDay);
  const monday = plan.events.find((e) => e.startDate === '2026-03-02');
  assert.ok(monday, '周一应有晚自习事件');
  assert.equal(monday.source, 'study');
  assert.equal(monday.title, 'study');
  assert.equal(monday.startTime, '19:00');
  assert.ok(plan.events.every((e) => e.source === 'study'));
});

test('13) 缺少最终课表解析器：显式返回 CALENDAR_UNAVAILABLE，不静默写空日历', () => {
  const options = { school: true, custom: true, study: true };
  const plan = calendar.planCalendarEvents(state(snapshot({ rules: [rule({})] }), options), options);
  assert.equal(plan.error, 'CALENDAR_UNAVAILABLE');
  assert.deepEqual(plan.events, []);
  assert.equal(plan.total, 0);
});

test('14) 提醒门控：通知已开且可验证才直接登记（proceed）', () => {
  const decision = gate.decideReminderGate({
    remindersEnabled: true,
    targetCount: 3,
    notificationEnabled: true,
    notificationVerified: true,
    requestResult: 'none'
  });
  assert.equal(decision.action, 'proceed');
  assert.equal(decision.code, '');
  assert.equal(decision.notificationOn, true);
});

test('15) 提醒门控：通知未开且未申请过 → 先申请（request），不直接登记', () => {
  const decision = gate.decideReminderGate({
    remindersEnabled: true,
    targetCount: 2,
    notificationEnabled: false,
    requestResult: 'none'
  });
  assert.equal(decision.action, 'request');
  assert.equal(decision.code, '');
});

test('16) 提醒门控：申请被拒 → 阻断（blocked）并给可操作错误码，不静默报不可用', () => {
  const decision = gate.decideReminderGate({
    remindersEnabled: true,
    targetCount: 2,
    notificationEnabled: false,
    requestResult: 'denied'
  });
  assert.equal(decision.action, 'blocked');
  assert.equal(decision.code, gate.NOTIFY_PERMISSION_REQUIRED);
  assert.equal(decision.code, 'NOTIFY_PERMISSION_REQUIRED');
});

test('17) 提醒门控：申请成功也不等于可验证 → proceed-unverified；提醒关闭或无课 → 清空', () => {
  const granted = gate.decideReminderGate({
    remindersEnabled: true,
    targetCount: 1,
    notificationEnabled: false,
    requestResult: 'granted'
  });
  assert.equal(granted.action, 'proceed-unverified');
  assert.equal(granted.notificationOn, false);
  assert.equal(granted.code, '');
  const disabled = gate.decideReminderGate({
    remindersEnabled: false,
    targetCount: 5,
    notificationEnabled: true,
    requestResult: 'none'
  });
  assert.equal(disabled.action, 'clear');
  const empty = gate.decideReminderGate({
    remindersEnabled: true,
    targetCount: 0,
    notificationEnabled: true,
    requestResult: 'none'
  });
  assert.equal(empty.action, 'clear');
});

// ----通知诚信化：查询四态、申请失败分类与错误码映射 ----

test('18) 通知查询：任何查询都不构成「已开启」证据，只有 disabled 可证（无授权无法证伪）', () => {
  // 即便历史接口返回 enabled，也不能映射成 granted。
  const enabled = { result: 'enabled', source: 'notificationSetting', code: '' };
  assert.equal(notifyState.notificationPermissionState(enabled), 'prompt');
  assert.equal(notifyState.notificationVerified(enabled), false);

  const disabled = { result: 'disabled', source: 'notificationSetting', code: '' };
  assert.equal(notifyState.notificationPermissionState(disabled), 'denied');
  assert.equal(notifyState.notificationVerified(disabled), true);

  const unverified = { result: 'unverified', source: 'notificationSetting:isNotificationEnabled', code: '' };
  assert.equal(notifyState.notificationPermissionState(unverified), 'prompt');
  assert.equal(notifyState.notificationVerified(unverified), false);

  const failed = { result: 'failed', source: 'notificationSetting:1600001', code: '1600001' };
  assert.equal(notifyState.notificationPermissionState(failed), 'unavailable');
  assert.equal(notifyState.notificationVerified(failed), false);
});

test('19) 申请结果分类：平台异常 unavailable，明确被拒 permission，其余一律 unverified', () => {
  assert.equal(notifyState.notificationFailureClass({ result: 'granted', code: '' }), 'unverified');
  assert.equal(notifyState.notificationFailureClass({ result: 'already', code: '' }), 'unverified');
  assert.equal(notifyState.notificationFailureClass({ result: 'failed', code: '1600001' }), 'unavailable');
  assert.equal(notifyState.notificationFailureClass({ result: 'denied', code: '1600004' }), 'permission');
  assert.equal(notifyState.notificationFailureClass({ result: 'busy', code: '1600013' }), 'permission');
  assert.equal(notifyState.notificationFailureClass({ result: 'no-effect', code: '' }), 'unverified');
  assert.equal(notifyState.notificationFailureClass({ result: 'unverified', code: '' }), 'unverified');
  assert.equal(notifyState.notificationFailureClass({ result: 'none', code: '' }), 'unverified');
});

test('20) 申请错误码映射：1600013=弹框在显示，1600004=被拒，1600001/2/3/801=能力异常', () => {
  assert.equal(notifyState.requestResultFromCode('1600013'), 'busy');
  assert.equal(notifyState.requestResultFromCode('1600004'), 'denied');
  assert.equal(notifyState.requestResultFromCode('1600001'), 'failed');
  assert.equal(notifyState.requestResultFromCode('1600002'), 'failed');
  assert.equal(notifyState.requestResultFromCode('1600003'), 'failed');
  assert.equal(notifyState.requestResultFromCode('801'), 'failed');
  assert.equal(notifyState.requestResultFromCode(''), 'none');
  assert.equal(notifyState.requestResultFromCode('1700001'), 'denied');
});

test('21) 提醒失败码分类：1700001/201 是通知未开，其余才是提醒能力不可用', () => {
  assert.equal(notifyState.reminderFailureClass('1700001'), 'permission');
  assert.equal(notifyState.reminderFailureClass('201'), 'permission');
  assert.equal(notifyState.reminderFailureClass('1700002'), 'reminder');
  assert.equal(notifyState.reminderFailureClass(''), 'reminder');
  assert.equal(notifyState.reminderFailureClass('REMINDER_DATE_INVALID'), 'reminder');
});

test('22) 打开通知设置失败用的是独立稳定错误码，不与「通知不可用」混用', () => {
  assert.equal(notifyState.NOTIFY_SETTINGS_FAILED_CODE, 'NOTIFY_SETTINGS_FAILED');
});

// ----第二轮：多路交叉验证 + 发布探针当真值 ----

function queryOf(result) {
  return { result, source: 'cross-check', code: '' };
}

test('23) 交叉验证：永不产出 enabled；探针成功也只算 unverified，只有 disabled 可证', () => {
  const probeOk = notifyState.crossCheckNotify({ setting: 'on', legacy: 'on', probe: 'ok', probeCode: '' });
  assert.equal(probeOk, 'unverified');
  assert.equal(notifyState.notificationPermissionState(queryOf(probeOk)), 'prompt');
  assert.equal(notifyState.notificationVerified(queryOf(probeOk)), false);

  // 真机 r7 场景：notificationEnabled=true 但实际发不出 → 必须 unverified，不得显示 granted。
  const bothTrueProbeFailed = notifyState.crossCheckNotify({ setting: 'on', legacy: 'on', probe: 'failed', probeCode: '1600001' });
  assert.equal(bothTrueProbeFailed, 'unverified');
  assert.equal(notifyState.notificationPermissionState(queryOf(bothTrueProbeFailed)), 'prompt');
  assert.equal(notifyState.notificationVerified(queryOf(bothTrueProbeFailed)), false);

  // 探针明确「通知被关闭」才能判 disabled → denied。
  const bothTrueProbeDisabled = notifyState.crossCheckNotify({ setting: 'on', legacy: 'on', probe: 'disabled', probeCode: '1600004' });
  assert.equal(bothTrueProbeDisabled, 'disabled');
  assert.equal(notifyState.notificationPermissionState(queryOf(bothTrueProbeDisabled)), 'denied');
});

test('24) 交叉验证：标志位 off 且探针也发不出算 disabled；探针成功也只算 unverified；全读不出才算 failed', () => {
  assert.equal(notifyState.crossCheckNotify({ setting: 'off', legacy: 'on', probe: 'failed', probeCode: '1600004' }), 'disabled');
  assert.equal(notifyState.crossCheckNotify({ setting: 'unknown', legacy: 'off', probe: 'failed', probeCode: '1600004' }), 'disabled');
  // 标志位明确 off 是可读的「被关闭」证据 → disabled；探针成功也不能翻案成已开启。
  assert.equal(notifyState.crossCheckNotify({ setting: 'unknown', legacy: 'off', probe: 'ok', probeCode: '' }), 'disabled');
  const allUnknown = notifyState.crossCheckNotify({ setting: 'unknown', legacy: 'unknown', probe: 'failed', probeCode: '1600001' });
  assert.equal(allUnknown, 'failed');
  assert.equal(notifyState.notificationPermissionState(queryOf(allUnknown)), 'unavailable');
  assert.equal(notifyState.notificationVerified(queryOf(allUnknown)), false);
});

test('25) 发布探针失败码：1600004=通知被关闭，其余按能力失败处理，不谎报已开', () => {
  assert.equal(notifyState.probeFailureResult('1600004'), 'disabled');
  assert.equal(notifyState.probeFailureResult('1600001'), 'failed');
  assert.equal(notifyState.probeFailureResult(''), 'failed');
});

test('26) 提醒超限 1700002 是容量问题，不能映射成通知权限错误', () => {
  assert.equal(notifyState.isReminderLimitCode('1700002'), true);
  assert.equal(notifyState.isReminderLimitCode('1700001'), false);
  assert.equal(notifyState.reminderFailureClass('1700002'), 'reminder');
});

// ----第三轮：不可证 ⇔ 不声称 ----

test('27) 提醒门控：未验证的通知开关不得 proceed，须先申请（request）', () => {
  // 旧接口报 true 但没有可验证证据 → 不能直接登记提醒。
  const unverifiedOn = gate.decideReminderGate({
    remindersEnabled: true,
    targetCount: 2,
    notificationEnabled: true,
    requestResult: 'none'
  });
  assert.equal(unverifiedOn.action, 'request');
  assert.equal(unverifiedOn.notificationOn, false);
  const explicitlyFalse = gate.decideReminderGate({
    remindersEnabled: true,
    targetCount: 2,
    notificationEnabled: true,
    notificationVerified: false,
    requestResult: 'none'
  });
  assert.equal(explicitlyFalse.action, 'request');
});

test('28) 展示态映射与提醒失败归因：无证据只显示 unverified，1700002 未超限归通知权限', () => {
  assert.equal(notifyState.notificationDisplayState('granted'), 'unverified');
  assert.equal(notifyState.notificationDisplayState('prompt'), 'unverified');
  assert.equal(notifyState.notificationDisplayState('denied'), 'denied');
  assert.equal(notifyState.notificationDisplayState('unavailable'), 'unavailable');

  // 未验证时任何失败都不能甩锅给「提醒能力」。
  assert.equal(notifyState.classifyReminderFailure(3, 5, '201', false), 'notify-permission');
  // 验证已开：1700001 仍是通知未开；1700002 未达上限也是通知侧问题。
  assert.equal(notifyState.classifyReminderFailure(3, 5, '1700001', true), 'notify-permission');
  assert.equal(notifyState.classifyReminderFailure(3, 5, '1700002', true), 'notify-permission');
  // 达到上限才是容量问题。
  assert.equal(notifyState.classifyReminderFailure(3, 120, '1700002', true), 'reminder-limit');
  assert.equal(notifyState.classifyReminderFailure(3, 130, '1700002', true), 'reminder-limit');
  // 其他码是提醒能力不可用。
  assert.equal(notifyState.classifyReminderFailure(3, 5, 'REMINDER_DATE_INVALID', true), 'reminder-unavailable');
  assert.equal(notifyState.classifyReminderFailure(0, 5, '', true), 'ok');
});

test('29) 交叉验证永不产出 enabled：遍历全部输入组合', () => {
  const flags = ['on', 'off', 'unknown'];
  const probes = ['ok', 'failed', 'disabled'];
  for (const setting of flags) {
    for (const legacy of flags) {
      for (const probe of probes) {
        const result = notifyState.crossCheckNotify({ setting, legacy, probe, probeCode: '' });
        assert.notEqual(result, 'enabled', 'setting=' + setting + ' legacy=' + legacy + ' probe=' + probe);
        assert.ok(['disabled', 'unverified', 'failed'].includes(result));
      }
    }
  }
});

