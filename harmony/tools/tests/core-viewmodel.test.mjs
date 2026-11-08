import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TMP = process.env.HARMONY_CORE_TMP;
const FIX = process.env.HARMONY_FIXTURES;
const imp = (p) => import(pathToFileURL(path.join(TMP, p)).href);
const day = await imp('core/viewmodel/DayViewModel.ts');
const week = await imp('core/viewmodel/WeekViewModel.ts');
const change = await imp('core/viewmodel/ChangeViewModel.ts');
const core = await imp('core/timetable/TimetableCore.ts');
const types = await imp('core/types/AppState.ts');
const normal = JSON.parse(fs.readFileSync(path.join(FIX, 'normal-state.json'), 'utf8'));
const edge = JSON.parse(fs.readFileSync(path.join(FIX, 'edge-state.json'), 'utf8'));
const copy = {
  weekdays: ['周一','周二','周三','周四','周五','周六','周日'], titleToday: '今天', titleTomorrow: '明天', titleYesterday: '昨天', titleSelected: '所选日期',
  weekLabel: '第{week}周', periodLabel: '第{periods}节', movedTo: '已调至 {date}', dayEmptyTitle: '无课', dayEmptyHint: '', sampleLabel: '示例数据',
  status: { normal: '正常', leaveApproved: '已批准请假', leavePending: '待审批', moved: '已调课', vacant: '无课', study: '晚自习', cancelled: '取消' },
  tags: { custom: '自定义', makeup: '补课', modified: '已修改', conflict: '冲突', overlap: '重叠' },
  sources: { school: '学校', custom: '自定义', study: '晚自习', local: '本地' },
  changes: { today: '今天', earlier: '更早', emptyTitle: '', emptyHint: '', allRead: '', openDay: '', markRead: '', typeAdd: '新增', typeRemove: '删除', typeUpdate: '更新', typeTime: '时间', typeRoom: '教室', typeTeacher: '教师', unread: '未读' },
  detail: { title: '课程详情', time: '时间', room: '地点', teacher: '教师', source: '来源', status: '状态', moved: '调课', leave: '请假', close: '关闭' },
  a11yCourse: '{name}，{time}，{room}，{teacher}，{status}', a11yMoved: '{name}调至{status}', a11yChange: '{title} {type} {detail}'
};
const deps = { resolveDay: core.resolveDay, markLeave: core.markLeave, weekdayOf: core.weekdayOf, addDays: core.addDays, weekOf: core.weekOf };
const leave = { id: 'leave-gold', type: 'leave', status: 'approved', startDate: '2026-08-31', startTime: '08:30', endDate: '2026-08-31', endTime: '09:55', reason: '测试', approver: '', comment: '', rawStatus: '已通过', semesterId: '2026-2027-1', demo: true };
const dayVm = (state, dateKey, leaveRecords = [], todayKey = '2026-08-31', weekNumber = 1) => day.buildDayViewModel({ state, dateKey, todayKey, weekNumber, leaveRecords }, deps, copy);
const records = [
  { id: 'c1', kind: 'add', type: 'add', date: '2026-08-31', title: 'a', detail: '', fields: [], detectedAt: 3, read: false },
  { id: 'c2', kind: 'update', type: 'time', date: '2026-08-30', title: 'b', detail: '', fields: [], detectedAt: 2, read: true },
  { id: 'c3', kind: 'remove', type: 'remove', date: '2026-08-31', title: 'c', detail: '', fields: [], detectedAt: 1, read: true }
];

test('day approved leave gold', () => { const vm = dayVm(normal, '2026-08-31', [leave]); assert.equal(vm.title, '今天'); assert.equal(vm.courses.length, 1); assert.equal(vm.courses[0].status, 'leave-approved'); assert.equal(vm.courses[0].periodText, '第1-2节'); assert.equal(vm.courses[0].colorKey, 'leave-approved'); });
test('day pending leave', () => { const vm = dayVm(normal, '2026-08-31', [{ ...leave, status: 'pending' }]); assert.equal(vm.courses[0].status, 'leave-pending'); });
test('day empty weekend', () => { const vm = dayVm(normal, '2026-09-05'); assert.equal(vm.isEmpty, true); assert.equal(vm.courses.length, 0); });
test('day invalid date', () => { const vm = dayVm(normal, 'bad'); assert.equal(vm.errorKey, 'INVALID_DATE'); });
test('day no semester', () => { const vm = dayVm({ ...normal, snapshot: null }, '2026-08-31'); assert.equal(vm.errorKey, 'NO_SEMESTER'); });
test('day edge moved', () => { const vm = dayVm(edge, '2026-10-05', [], '2026-10-05', 6); assert.deepEqual(vm.courses.map((c) => c.status), ['moved', 'moved', 'study']); assert.equal(vm.courses[0].movedToText, '已调至 2026-10-09'); });
test('day edge make-up day', () => { const vm = dayVm(edge, '2026-10-09', [], '2026-10-09', 6); assert.equal(vm.courses.length, 3); assert.ok(vm.courses[0].tags.includes('makeup')); });
test('day edge cancelled day', () => { const vm = dayVm(edge, '2026-09-28', [], '2026-09-28', 5); assert.equal(vm.courses.some((c) => c.row.name === '高等数学'), false); });
test('day title selected', () => { const vm = dayVm(normal, '2026-09-03', [], '2026-08-31'); assert.equal(vm.title, '所选日期'); });
test('format periods/range', () => { assert.equal(day.formatPeriods([1,2,3]), '1-3'); assert.equal(day.formatPeriods([]), ''); assert.equal(day.formatTimeRange('08:30','09:55'), '08:30–09:55'); });
test('week normal first week', () => { const vm = week.buildWeekViewModel({ state: normal, week: 1, todayKey: '2026-08-31', selectedDateKey: '2026-08-31', leaveRecords: [] }, deps, copy); assert.equal(vm.days.length, 7); assert.equal(vm.occupancy[0][0], true); assert.equal(vm.occupancy[1][0], true); assert.equal(vm.occupancy[0][1], false); });
test('week selected columns', () => { const vm = week.buildWeekViewModel({ state: normal, week: 1, todayKey: '2026-09-01', selectedDateKey: '2026-09-03', leaveRecords: [] }, deps, copy); assert.equal(vm.todayColumn, 1); assert.equal(vm.selectedColumn, 3); });
test('week edge week six', () => { const vm = week.buildWeekViewModel({ state: edge, week: 6, todayKey: '2026-10-05', selectedDateKey: '2026-10-05', leaveRecords: [] }, deps, copy); assert.equal(vm.days.length, 7); assert.ok(vm.days[0].courses.length >= 3); const nonEmpty = vm.days[0].blocks.filter((block) => !block.isEmpty); assert.equal(nonEmpty.length, 3, '周一应有 3 个非空块，实际 ' + nonEmpty.length); });
test('change empty', () => { const vm = change.buildChangeViewModel([], '2026-08-31', copy); assert.equal(vm.isEmpty, true); assert.equal(vm.total, 0); });
test('change groups unread', () => { const vm = change.buildChangeViewModel(records, '2026-08-31', copy); assert.equal(vm.total, 3); assert.equal(vm.unreadCount, 1); assert.equal(vm.groups.length, 2); });
test('change markRead immutable', () => { const next = change.markChangeRead(records, 'c1'); assert.equal(next[0].read, true); assert.equal(records[0].read, false); });
test('change markAllRead', () => { const next = change.markAllChangeRead(records); assert.equal(next.every((r) => r.read === true), true); assert.equal(records.some((r) => r.read === false), true); });
test('schema default changeRecords', () => { const s = types.createDefaultState(); assert.deepEqual(s.changeRecords, []); assert.equal(s.version, 2); });



test('day time/period/weekday labels', () => {
  const vm = dayVm(normal, '2026-08-31', [leave]);
  const course = vm.courses[0];
  assert.equal(course.timeText, '08:30–09:55');
  assert.equal(course.periodText, '第1-2节');
  assert.equal(vm.weekdayLabel, '周一');
  assert.equal(vm.activeCount, 1);
});
test('week label and selected date slot', () => {
  const vm = week.buildWeekViewModel({ state: normal, week: 1, todayKey: '2026-09-01', selectedDateKey: '2026-09-03', leaveRecords: [] }, deps, copy);
  assert.equal(vm.weekLabel, '第1周');
  assert.equal(vm.days.length, 7);
  assert.equal(vm.days[0].dateKey, '2026-08-31');
  assert.equal(vm.days[3].dateKey, '2026-09-03');
  assert.equal(vm.selectedColumn, 3);
});
test('change group titles and split', () => {
  const vm = change.buildChangeViewModel(records, '2026-08-31', copy);
  assert.deepEqual(vm.groups.map((g) => g.key), ['today', 'earlier']);
  assert.equal(vm.groups[0].title, '今天');
  assert.equal(vm.groups[0].items.length, 2);
  assert.equal(vm.groups[1].items.length, 1);
});
test('change markRead unknown id is no-op', () => {
  const next = change.markChangeRead(records, 'missing');
  assert.equal(next.length, records.length);
  assert.equal(next[0].read, false);
  assert.equal(records[0].read, false);
});

test('week edge week six: exactly 3 non-empty blocks', () => {
  const vm = week.buildWeekViewModel({ state: edge, week: 6, todayKey: '2026-10-05', selectedDateKey: '2026-10-05', leaveRecords: [] }, deps, copy);
  const blocks = week.weekDayBlocks(vm.days[0].courses);
  const nonEmpty = blocks.filter((b) => !b.isEmpty);
  assert.equal(nonEmpty.length, 3, '周一应有 3 个非空块，实际 ' + nonEmpty.length);
  for (const block of nonEmpty) {
    assert.ok(block.courses.length > 0, '非空块必须含课程');
  }
  assert.ok(nonEmpty.some((b) => b.courses.some((c) => c.status === 'study')), '晚自习块应在周一');
});

test('week edge monday three non-empty blocks', () => { const vm = week.buildWeekViewModel({ state: edge, week: 6, todayKey: '2026-10-05', selectedDateKey: '2026-10-05', leaveRecords: [] }, deps, copy); const nonEmpty = vm.days[0].blocks.filter((block) => !block.isEmpty); assert.equal(nonEmpty.length, 3); });
