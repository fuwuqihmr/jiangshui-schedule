import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
const fixtures = process.env.HARMONY_FIXTURES;
if (!tmp || !fixtures) throw new Error('HARMONY_CORE_TMP/HARMONY_FIXTURES 未设置，请用 run-core-tests.mjs 运行');

async function load(rel) {
  return import(pathToFileURL(path.join(tmp, rel)).href);
}
const core = await load('core/timetable/TimetableCore.ts');
const custom = await load('core/custom/CustomScheduleService.ts');

const edge = JSON.parse(fs.readFileSync(path.join(fixtures, 'edge-state.json'), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const state = () => clone(edge);
const snapshot = () => edge.snapshot;
const names = (rows) => rows.map((row) => row.name);

function weeklyDraft(overrides = {}) {
  return {
    mode: 'weekly',
    name: '自习',
    teacher: '自己',
    room: '图书馆',
    startTime: '18:00',
    endTime: '18:45',
    dayOfWeek: 2,
    startWeek: 5,
    endWeek: 9,
    weekPattern: 'odd',
    date: '',
    customCourseId: '',
    ...overrides
  };
}

function onceDraft(overrides = {}) {
  return {
    mode: 'once',
    name: '补课',
    teacher: '王老师',
    room: 'B101',
    startTime: '12:00',
    endTime: '13:00',
    dayOfWeek: 1,
    startWeek: 1,
    endWeek: 1,
    weekPattern: 'every',
    date: '2026-09-09',
    customCourseId: '',
    ...overrides
  };
}

function emptySettings() {
  return { showEveningStudy: true, grade: '大一' };
}

function changeRecord(id, overrides = {}) {
  return {
    id,
    key: '2026-09-07/' + id,
    kind: 'update',
    stableKey: 'r-math',
    date: '2026-09-07',
    title: '高等数学',
    detail: 'start=08:30;end=09:55;room=A101',
    before: null,
    after: null,
    fields: ['room'],
    type: 'room',
    source: 'school',
    read: false,
    notifiedAt: null,
    detectedAt: '2026-10-01T00:00:00.000Z',
    at: 1790000000000,
    ...overrides
  };
}

test('1) 自定义课程 weekly：周次/单双周展开，resolveDay 只在命中周出现', () => {
  const draft = weeklyDraft();
  const result = custom.buildCustomCourse(draft, snapshot(), [], 1790000000000);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.course.mode, 'weekly');
  assert.equal(result.course.semesterId, '2026-2027-1');
  assert.equal(result.course.semesterStartDate, '2026-08-31');
  assert.equal(result.course.dayOfWeek, 2);
  assert.equal(result.course.startWeek, 5);
  assert.equal(result.course.endWeek, 9);
  assert.equal(result.course.weekPattern, 'odd');
  assert.deepEqual(result.course.weeks, [5, 7, 9]);
  assert.deepEqual(result.course.weekdays, [2]);

  const next = custom.upsertCustomCourse(state(), result.course);
  const week5 = core.resolveDay(next, '2026-09-29');
  const hit = week5.find((row) => row.name === '自习');
  assert.ok(hit, '第 5 周周二应出现自定义课程');
  assert.equal(hit.startTime, '18:00');
  assert.equal(hit.endTime, '18:45');
  assert.equal(hit.room, '图书馆');
  assert.equal(hit.customCourse, true);
  assert.equal(hit.customCourseId, result.course.id);
  assert.ok(!names(core.resolveDay(next, '2026-10-06')).includes('自习'), '双周不应出现单周课程');
  assert.ok(!names(core.resolveDay(next, '2026-09-22')).includes('自习'), '第 4 周不在范围');
});

test('2) 自定义课程 once：只在指定日期出现，不重复', () => {
  const result = custom.buildCustomCourse(onceDraft(), snapshot(), [], 1790000000000);
  assert.equal(result.ok, true);
  assert.equal(result.course.mode, 'once');
  assert.equal(result.course.date, '2026-09-09');
  const next = custom.upsertCustomCourse(state(), result.course);
  assert.ok(names(core.resolveDay(next, '2026-09-09')).includes('补课'));
  assert.ok(!names(core.resolveDay(next, '2026-09-16')).includes('补课'));
});

test('3) 自定义课程校验：名称/时间/星期/周次/日期越界/编辑不存在均拒绝', () => {
  assert.deepEqual(custom.validateCustomCourseDraft(weeklyDraft({ name: '  ' }), snapshot(), []), ['name-required']);
  assert.ok(custom.validateCustomCourseDraft(weeklyDraft({ startTime: '25:00' }), snapshot(), []).includes('time-invalid'));
  assert.ok(custom.validateCustomCourseDraft(weeklyDraft({ endTime: '18:00' }), snapshot(), []).includes('time-order'));
  assert.ok(custom.validateCustomCourseDraft(weeklyDraft({ dayOfWeek: 0 }), snapshot(), []).includes('day-invalid'));
  assert.ok(custom.validateCustomCourseDraft(weeklyDraft({ endWeek: 19 }), snapshot(), []).includes('week-out-of-range'));
  assert.ok(custom.validateCustomCourseDraft(weeklyDraft({ startWeek: 9, endWeek: 5 }), snapshot(), []).includes('week-invalid'));
  assert.ok(custom.validateCustomCourseDraft(onceDraft({ date: '2027-01-05' }), snapshot(), []).includes('date-out-of-semester'));
  assert.ok(custom.validateCustomCourseDraft(onceDraft({ date: '2026-13-01' }), snapshot(), []).includes('date-invalid'));
  assert.ok(custom.validateCustomCourseDraft(weeklyDraft(), null, []).includes('semester-missing'));
  assert.ok(custom.validateCustomCourseDraft(weeklyDraft({ customCourseId: 'missing-id' }), snapshot(), ['custom-1']).includes('course-missing'));

  const bad = custom.buildCustomCourse(weeklyDraft({ name: '' }), snapshot(), [], 1790000000000);
  assert.equal(bad.ok, false);
  assert.equal(bad.course, null);
});

test('4) 自定义课程增删改：按 id 替换、不修改旧状态', () => {
  const draft = custom.buildCustomCourse(weeklyDraft(), snapshot(), [], 1790000000000);
  const next = custom.upsertCustomCourse(state(), draft.course);
  assert.equal(next.customCourses.length, 3);
  assert.equal(edge.customCourses.length, 2, '旧状态不能被修改');

  const edited = custom.buildCustomCourse(weeklyDraft({ customCourseId: draft.course.id, name: '自习改' }), snapshot(), ['custom-1', 'custom-2', draft.course.id], 1800000000000);
  assert.equal(edited.ok, true);
  assert.equal(edited.course.id, draft.course.id);
  const replaced = custom.upsertCustomCourse(next, edited.course);
  assert.equal(replaced.customCourses.length, 3);
  assert.equal(replaced.customCourses.find((item) => item.id === draft.course.id).name, '自习改');

  const removed = custom.deleteCustomCourse(replaced, draft.course.id);
  assert.equal(removed.customCourses.length, 2);
  assert.ok(!removed.customCourses.some((item) => item.id === draft.course.id));
});

test('5) 调休 localMap：目标日出现原日课程，原日留 moved 占位', () => {
  const bad = custom.buildLocalMap({ fromDate: '2026-09-03', date: '2026-09-03', mode: 'replace' }, 1790000000000, []);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.includes('same-date'));
  assert.ok(custom.validateLocalMap({ fromDate: '2026-13-01', date: '2026-09-04', mode: 'replace' }).includes('from-date-invalid'));

  const built = custom.buildLocalMap({ fromDate: '2026-09-03', date: '2026-09-04', mode: 'replace' }, 1790000000000, ['local-map-1']);
  assert.equal(built.ok, true);
  const next = custom.upsertLocalMap(state(), built.rule);
  assert.equal(next.localMaps.length, 2);
  assert.equal(edge.localMaps.length, 1);

  const target = core.resolveDay(next, '2026-09-04').find((row) => row.name === '物理实验');
  assert.ok(target, '目标日应出现周四的物理实验');
  assert.equal(target.originDate, '2026-09-03');
  assert.ok(target.key.includes(built.rule.id));

  const origin = core.resolveDay(next, '2026-09-03').find((row) => row.name === '物理实验');
  assert.ok(origin, '原日应保留占位');
  assert.equal(origin.vacant, true);
  assert.equal(origin.movedTo, '2026-09-04');
});

test('6) 单日休假：停普通课与自定义课，晚自习按 skipStudy 保留/停止', () => {
  const added = custom.addHolidayDay(state(), { date: '2026-09-07', skipStudy: false });
  assert.equal(added.holidaySettings.days.length, 2);
  assert.equal(edge.holidaySettings.days.length, 1);
  const rows = core.resolveDay(added, '2026-09-07');
  assert.ok(!names(rows).includes('高等数学'));
  assert.ok(!names(rows).includes('社团活动'));
  assert.ok(names(rows).includes('study'), 'skipStudy=false 时晚自习保留');

  const skipped = custom.addHolidayDay(state(), { date: '2026-09-07', skipStudy: true });
  assert.deepEqual(core.resolveDay(skipped, '2026-09-07'), []);

  const removed = custom.removeHolidayDay(added, '2026-09-07');
  assert.ok(names(core.resolveDay(removed, '2026-09-07')).includes('高等数学'));
  assert.equal(removed.holidaySettings.days.length, 1);
});

test('7) 晚自习开关：setEveningStudy 同时影响 resolveDay 与 courseSettings', () => {
  const off = custom.setEveningStudy(state(), false);
  assert.equal(off.courseSettings.showEveningStudy, false);
  assert.equal(off.snapshot.studyPolicy.userEnabled, false);
  assert.ok(!names(core.resolveDay(off, '2026-09-01')).includes('study'));
  assert.equal(edge.snapshot.studyPolicy.userEnabled, true, '旧状态不能被修改');

  const on = custom.setEveningStudy(off, true);
  assert.ok(names(core.resolveDay(on, '2026-09-01')).includes('study'));
});

test('8) 单日修改 override：改时间/地点/取消，非法 patch 拒绝', () => {
  const rows = core.resolveDay(state(), '2026-09-07');
  const base = rows.find((row) => row.name === '高等数学');
  assert.ok(base);
  const override = custom.buildDayOverride('2026-09-07', base, { room: 'B202', startTime: '09:00' }, 1790000000000);
  assert.ok(override);
  assert.equal(override.key, base.key);
  assert.equal(override.base.name, '高等数学');

  const next = custom.upsertOverride(state(), override);
  const patched = core.resolveDay(next, '2026-09-07').find((row) => row.name === '高等数学');
  assert.equal(patched.room, 'B202');
  assert.equal(patched.startTime, '09:00');
  assert.equal(patched.source, 'local');

  const cancelled = custom.buildDayOverride('2026-09-07', base, { cancelled: true }, 1790000000000);
  const hidden = custom.upsertOverride(state(), cancelled);
  assert.equal(core.resolveDay(hidden, '2026-09-07').find((row) => row.name === '高等数学').cancelled, true);

  assert.equal(custom.buildDayOverride('2026-09-07', base, { startTime: '10:00', endTime: '09:00' }, 1), null);
  assert.equal(custom.buildDayOverride('2026-13-01', base, { room: 'X' }, 1), null);
});

test('9) 撤销/重做：历史栈、重做清空、上限截断', () => {
  const history = custom.createHistory(state());
  assert.equal(custom.canUndo(history), false);
  assert.equal(custom.canRedo(history), false);

  const s1 = custom.addHolidayDay(history.present, { date: '2026-09-07', skipStudy: true });
  const h1 = custom.commitHistory(history, s1);
  assert.equal(custom.canUndo(h1), true);
  assert.equal(h1.present.holidaySettings.days.length, 2);

  const undone = custom.undoHistory(h1);
  assert.equal(custom.canUndo(undone), false);
  assert.equal(custom.canRedo(undone), true);
  assert.equal(undone.present.holidaySettings.days.length, 1);

  const redone = custom.redoHistory(undone);
  assert.equal(redone.present.holidaySettings.days.length, 2);
  assert.equal(custom.canRedo(redone), false);

  const cleared = custom.commitHistory(undone, s1);
  assert.equal(custom.canRedo(cleared), false, '新提交应清空重做栈');

  let limited = custom.createHistory(state());
  for (let index = 0; index < 25; index++) {
    limited = custom.commitHistory(limited, custom.addHolidayDay(limited.present, { date: '2026-09-' + String(10 + (index % 10)).padStart(2, '0'), skipStudy: false }), 5);
  }
  assert.equal(limited.past.length, 5);
});

test('10) 变更合并：新记录在前、按 id 去重、上限 200、未读计数', () => {
  const a = changeRecord('a');
  const b = changeRecord('b');
  const c = changeRecord('c');
  assert.deepEqual(custom.mergeChangeRecords([a], [b, c]).map((item) => item.id), ['b', 'c', 'a']);
  assert.deepEqual(custom.mergeChangeRecords([b, a], [b]).map((item) => item.id), ['b', 'a']);
  assert.equal(custom.mergeChangeRecords([a], [a]).length, 1);

  const many = [];
  for (let index = 0; index < 205; index++) {
    many.push(changeRecord('r' + String(index)));
  }
  const merged = custom.mergeChangeRecords([a], many);
  assert.equal(merged.length, 200);
  assert.equal(merged[0].id, 'r0');

  const next = custom.applyChangeRecords(state(), [b, c]);
  assert.equal(next.changeRecords.length, 2);
  assert.equal((edge.changeRecords || []).length, 0, '旧状态不能被修改');
  assert.equal(custom.countUnread(next.changeRecords), 2);
  assert.equal(custom.countUnread(custom.markRecordRead(next, b.id).changeRecords), 1);
  assert.equal(custom.countUnread(custom.markAllChangeRecordsRead(next).changeRecords), 0);
});

test('11) 今日概览：节数、下一节、假条统计', () => {
  const leaveRecords = [
    { id: 'lr-1', type: 'leave', status: 'approved', startDate: '2026-09-07', startTime: '08:30', endDate: '2026-09-07', endTime: '09:55', reason: 'x', approver: '', comment: '', rawStatus: '', semesterId: '2026-2027-1', demo: false },
    { id: 'lr-2', type: 'leave', status: 'pending', startDate: '2026-09-07', startTime: '16:00', endDate: '2026-09-07', endTime: '17:30', reason: 'y', approver: '', comment: '', rawStatus: '', semesterId: '2026-2027-1', demo: false },
    { id: 'lr-3', type: 'cancel', status: 'approved', startDate: '2026-09-07', startTime: '08:30', endDate: '2026-09-07', endTime: '09:55', reason: 'z', approver: '', comment: '', rawStatus: '', semesterId: '2026-2027-1', demo: false }
  ];
  const rows = core.markLeave(core.resolveDay(state(), '2026-09-07'), leaveRecords);
  const morning = custom.buildTodayOverview(rows, leaveRecords, 0);
  assert.equal(morning.lessonCount, 3, '高等数学 + 社团活动 + 晚自习');
  assert.equal(morning.nextStartTime, '08:30');
  assert.equal(morning.nextName, '高等数学');
  assert.equal(morning.nextRoom, 'A101');
  assert.equal(morning.leaveCount, 1);
  assert.equal(morning.pendingLeaveCount, 1);
  assert.equal(morning.hasLeave, true);

  const after = custom.buildTodayOverview(rows, leaveRecords, 10 * 60);
  assert.equal(after.nextStartTime, '16:00');
  assert.equal(after.nextName, '社团活动');
});

test('12) 假条标注：行内 approved 优先、明细按时间重叠', () => {
  const leaveRecords = [
    { id: 'lr-1', type: 'leave', status: 'approved', startDate: '2026-09-07', startTime: '08:30', endDate: '2026-09-07', endTime: '09:55', reason: 'x', approver: '', comment: '', rawStatus: '', semesterId: '2026-2027-1', demo: false },
    { id: 'lr-2', type: 'leave', status: 'pending', startDate: '2026-09-07', startTime: '16:00', endDate: '2026-09-07', endTime: '17:30', reason: 'y', approver: '', comment: '', rawStatus: '', semesterId: '2026-2027-1', demo: false }
  ];
  const rows = core.markLeave(core.resolveDay(state(), '2026-09-07'), leaveRecords);
  const annotations = custom.annotateLeaveRows(rows, leaveRecords);
  const byName = {};
  for (const row of rows) {
    byName[row.name] = annotations.find((item) => item.key === row.key);
  }
  assert.equal(byName['高等数学'].status, 'approved');
  assert.deepEqual(byName['高等数学'].recordIds, ['lr-1']);
  assert.equal(byName['社团活动'].status, 'pending');
  assert.equal(byName['study'].status, 'none');

  const math = rows.find((row) => row.name === '高等数学');
  const detail = custom.leaveRecordsForRow(math, leaveRecords);
  assert.equal(detail.length, 1);
  assert.equal(detail[0].id, 'lr-1');
});

test('13) 真实 diff 接线：diffState -> merge -> 未读，幂等且不修改旧快照', () => {
  const prev = state();
  const next = state();
  next.snapshot.rules[0].room = 'A999';
  next.snapshot.rules.push({
    id: 'r-new',
    name: '新课',
    teacher: '新老师',
    room: 'C301',
    dayOfWeek: 3,
    weekday: 3,
    startPeriod: 7,
    endPeriod: 8,
    periods: [7, 8],
    weeks: [1],
    startTime: '15:45',
    endTime: '17:10',
    cancelled: false,
    source: 'school'
  });
  const nowMs = Date.parse('2026-08-01T00:00:00+08:00');
  const fresh = core.diffState(prev, next, nowMs);
  assert.ok(fresh.length >= 19, '18 周房间变化 + 新增课');
  assert.ok(fresh.every((record) => record.read === false));

  const applied = custom.applyChangeRecords(prev, fresh);
  assert.equal(applied.changeRecords.length, fresh.length);
  assert.equal(custom.countUnread(applied.changeRecords), fresh.length);
  assert.equal(prev.snapshot.rules[0].room, 'A101', 'diff 不应修改旧快照');
  assert.equal((prev.changeRecords || []).length, 0);

  const again = custom.applyChangeRecords(applied, fresh);
  assert.equal(again.changeRecords.length, fresh.length, '重复合并不产生重复记录');
});

test('14) 日期/时间/周次工具：边界与非法输入', () => {
  assert.equal(custom.isValidDateKey('2026-09-07'), true);
  assert.equal(custom.isValidDateKey('2026-02-30'), false);
  assert.equal(custom.isValidDateKey('2026-9-7'), false);
  assert.equal(custom.weekdayOfDate('2026-08-31'), 1);
  assert.equal(custom.weekdayOfDate('2026-09-06'), 7);
  assert.equal(custom.weekdayOfDate('bad'), 0);
  assert.equal(custom.weekNumberOf(snapshot(), '2026-08-31'), 1);
  assert.equal(custom.weekNumberOf(snapshot(), '2026-09-07'), 2);
  assert.equal(custom.weekNumberOf(snapshot(), '2026-08-30'), 0);
  assert.equal(custom.parseTimeToMinutes('08:30'), 510);
  assert.equal(custom.parseTimeToMinutes('24:00'), -1);
  assert.equal(custom.parseTimeToMinutes('8:30'), -1);
  assert.equal(custom.minutesToTime(510), '08:30');
  assert.deepEqual(custom.expandWeeks(5, 10, 'even'), [6, 8, 10]);
  assert.deepEqual(custom.expandWeeks(5, 10, 'odd'), [5, 7, 9]);
  assert.deepEqual(custom.expandWeeks(5, 10, 'every'), [5, 6, 7, 8, 9, 10]);
  assert.deepEqual(custom.expandWeeks(10, 5, 'every'), []);
});

test('15) 调休写入口径：buildLocalMap 强制 stamp replace', () => {
  assert.equal(custom.LOCAL_REMAP_MODE, 'replace');
  const built = custom.buildLocalMap({ fromDate: '2026-09-07', date: '2026-09-10', mode: 'append' }, 1790000000000, []);
  assert.equal(built.ok, true);
  assert.equal(built.rule.mode, 'replace', '本机手动调休一律按替换写入');

  const next = custom.upsertLocalMap(state(), built.rule);
  const target = names(core.resolveDay(next, '2026-09-10'));
  assert.ok(!target.includes('物理实验'), 'replace 覆盖目标日（2026-09-10 周四原有物理实验）');
  assert.ok(target.includes('高等数学'), '原日 2026-09-07 周一课程映射到目标日');
  assert.ok(target.includes('社团活动'));
});
