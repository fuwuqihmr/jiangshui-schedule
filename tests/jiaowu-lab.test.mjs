import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LAB_TIMETABLE_URL,
  LAB_CACHE_TTL_MS,
  parseSectionCode,
  parseLabTimetable,
  normalizeLabList,
  groupByWeekDay,
  labDay,
  withLabFallback,
  labSummary,
  attachLabPayload,
  diffLabSnapshots,
  labErrorText,
} from '../web/jiaowu-lab.mjs';
import { PERIOD_TIMES } from '../web/jsxsd.mjs';

const SEMESTER = { id: 'school-2026-08-31', startDate: '2026-08-31', weeks: 25 };
const FETCHED = '2026-11-17T00:00:00.000Z';

function li(code, className, room, section) {
  return '<li class="qz-toolitiplists"><span>课程编号</span>：' + code
    + '<br><span>班级</span>：' + className
    + '<br><span>地址</span>：' + room
    + '<br><span>节次</span>：' + section + '</li>';
}

function course(title, listHtml) {
  return '<td class="qz-hasCourse"><span class="qz-hasCourse-title">' + title + '</span><ul>' + listHtml + '</ul></td>';
}

const HEADER = '<tr><th>周次</th><th>节次</th><th>星期一</th><th>星期二</th><th>星期三</th><th>星期四</th><th>星期五</th><th>星期六</th><th>星期日</th></tr>';
const EMPTY6 = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td>';

function rowsFor(week, cells) {
  // cells: 6 行 × 7 个星期单元格；第一行自动补 rowspan=6 的周次单元格与节次段。
  const segments = ['1-2节', '3-4节', '5-6节', '7-8节', '9-10节', '11-12节'];
  return cells.map((days, index) => '<tr>'
    + (index === 0 ? '<td rowspan="6">第' + week + '周</td>' : '')
    + '<td>' + segments[index] + '</td>' + days + '</tr>').join('');
}

const WEEK3 = rowsFor(3, [
  '<td></td><td>' + course('合成实验G', li('G007', '26合成02班', '实验楼G102', '20102')) + '</td>' + '<td></td><td></td><td></td><td></td><td></td>',
  EMPTY6, EMPTY6, EMPTY6, EMPTY6, EMPTY6,
]);

const WEEK4 = rowsFor(4, [
  '<td>' + course('合成实验A', li('A001', '26合成03班00000000000:49', '实验楼A302', '10102')
    + li('A001', '26合成03班00000000000:49', '实验楼A302', '10102')
    + li('A001', '26合成03班00000000000:49', '实验楼A302', '10102')) + '</td>'
    + '<td></td><td></td><td></td><td></td>'
    + '<td rowspan="4">' + course('合成实验D', li('D004', '26合成04班', '实验楼D401', '60102030405060708')).replace(/^<td[^>]*>/, '').replace(/<\/td>$/, '') + '</td>'
    + '<td rowspan="4">' + course('合成实验F', li('F006', '26合成06班', '实验楼F501', '70102030405060708')).replace(/^<td[^>]*>/, '').replace(/<\/td>$/, '') + '</td>',
  '<td></td><td></td><td>' + course('合成实验B', li('B002', '26合成03班', '实验楼B101', '30304') + li('E005', '26合成01班', '实验楼B102', '30304')) + '</td><td></td><td></td>',
  '<td></td><td></td><td></td><td></td><td class="qz-hasCourse"><span class="qz-hasCourse-title">合成实验X</span><ul>' + li('X009', '26合成09班', '实验楼X901', '99999') + '</ul></td>',
  '<td></td><td></td><td></td><td>' + course('合成实验C', li('C003', '26合成03班', '实验楼C203', '40708')) + '</td><td></td>',
  EMPTY6, EMPTY6,
]);

const FIXTURE = '<html><body><table class="Nsb_r_list">' + HEADER + WEEK3 + WEEK4 + '</table></body></html>';
const HEADER_ONLY = '<html><body><table>' + HEADER + '</table></body></html>';

function parseFixture(extra = {}) {
  return parseLabTimetable(FIXTURE, { periodTimes: PERIOD_TIMES, totalWeeks: SEMESTER.weeks, ...extra });
}
function snapshotWith(items) {
  return {
    semester: SEMESTER,
    labs: {
      semesterId: SEMESTER.id,
      semesterStartDate: SEMESTER.startDate,
      fetchedAt: FETCHED,
      error: null,
      source: 'school',
      items,
      skipped: [],
    },
  };
}

test('实验课：常量与节次编码（三种实测编码 + 非法）', () => {
  assert.equal(LAB_TIMETABLE_URL, '/jsxsd/syjx/toXskb.do');
  assert.equal(LAB_CACHE_TTL_MS, 6 * 60 * 60 * 1000);
  assert.deepEqual(parseSectionCode('60102030405060708'), { weekday: 6, periods: [1, 2, 3, 4, 5, 6, 7, 8] });
  assert.deepEqual(parseSectionCode('40708'), { weekday: 4, periods: [7, 8] });
  assert.deepEqual(parseSectionCode('70102030405060708'), { weekday: 7, periods: [1, 2, 3, 4, 5, 6, 7, 8] });
  assert.deepEqual(parseSectionCode('10102'), { weekday: 1, periods: [1, 2] });
  assert.equal(parseSectionCode('01202'), null);
  assert.equal(parseSectionCode('112'), null);
  assert.equal(parseSectionCode('1012a'), null);
  assert.equal(parseSectionCode('80102'), null);
  assert.equal(parseSectionCode(''), null);
  assert.equal(parseSectionCode(null), null);
});

test('实验课：解析周次 rowspan、同格多课、去重、星期编码与节次映射', () => {
  const result = parseFixture();
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(result.items.length, 7);
  assert.deepEqual(result.weeks, [3, 4]);
  assert.deepEqual(result.items.map((item) => item.name), [
    '合成实验G', '合成实验A', '合成实验B', '合成实验B', '合成实验C', '合成实验D', '合成实验F',
  ]);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'section');

  const a = result.items.find((item) => item.name === '合成实验A');
  assert.deepEqual(a, {
    id: 'A001|4|1|10102',
    week: 4,
    weekday: 1,
    name: '合成实验A',
    courseCode: 'A001',
    className: '26合成03班',
    room: '实验楼A302',
    sectionCode: '10102',
    periods: [1, 2],
    first: 1,
    last: 2,
    startTime: PERIOD_TIMES[1][0],
    endTime: PERIOD_TIMES[2][1],
    exact: true,
    lab: true,
    sourceLabel: '实验课',
  });

  const d = result.items.find((item) => item.name === '合成实验D');
  assert.equal(d.weekday, 6);
  assert.deepEqual(d.periods, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(d.first, 1);
  assert.equal(d.last, 8);
  assert.equal(d.exact, true);
  assert.equal(d.startTime, PERIOD_TIMES[1][0]);
  assert.equal(d.endTime, PERIOD_TIMES[8][1]);

  const f = result.items.find((item) => item.name === '合成实验F');
  assert.equal(f.weekday, 7);
  assert.equal(f.periods.length, 8);

  const c = result.items.find((item) => item.name === '合成实验C');
  assert.equal(c.weekday, 4);
  assert.deepEqual(c.periods, [7, 8]);

  // 同格两份 li 都保留（班级/地点不同，去重键不同）
  assert.ok(result.items.some((item) => item.courseCode === 'B002'));
  assert.ok(result.items.some((item) => item.courseCode === 'E005'));
});

test('实验课：同一条目重复多次只保留一条（28→10 等价去重）', () => {
  const records = [];
  for (let i = 0; i < 28; i += 1) {
    records.push({ week: 4, name: '合成实验A', courseCode: 'A001', className: '26合成03班00000000000:49', room: '实验楼A302', sectionCode: '10102' });
  }
  const result = normalizeLabList(records, { periodTimes: PERIOD_TIMES, totalWeeks: 25 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].className, '26合成03班');
});

test('实验课：规范化幂等，且兼容已规范化条目（无 sectionCode 时按 periods 复原）', () => {
  const parsed = parseFixture();
  const again = normalizeLabList(parsed.items, { periodTimes: PERIOD_TIMES, totalWeeks: 25 });
  assert.deepEqual(again.items, parsed.items);
  assert.equal(again.error, null);

  const legacy = normalizeLabList([{ week: 5, weekday: 2, name: '兼容实验', room: '实验楼Z', periods: [1, 2] }], { periodTimes: PERIOD_TIMES, totalWeeks: 25 });
  assert.equal(legacy.items.length, 1);
  assert.equal(legacy.items[0].id, '兼容实验|5|2|');
  assert.deepEqual(legacy.items[0].periods, [1, 2]);
});

test('实验课：不连续节次 exact=false，非法条目分类跳过', () => {
  const irregular = normalizeLabList([{ week: 4, name: '不连续实验', room: '实验楼Q', sectionCode: '10204' }], { periodTimes: PERIOD_TIMES, totalWeeks: 25 });
  assert.equal(irregular.items.length, 1);
  assert.deepEqual(irregular.items[0].periods, [2, 4]);
  assert.equal(irregular.items[0].exact, false);

  const bad = normalizeLabList([
    { week: 4, name: '', room: '实验楼Q', sectionCode: '10102' },
    { week: 4, name: '坏节次', room: '实验楼Q', sectionCode: '99999' },
    { week: 30, name: '超周次', room: '实验楼Q', sectionCode: '10102' },
  ], { periodTimes: PERIOD_TIMES, totalWeeks: 25 });
  assert.equal(bad.items.length, 0);
  assert.deepEqual(bad.skipped.map((entry) => entry.reason), ['name', 'section', 'week']);
  assert.equal(bad.error, 'format');
});

test('实验课：表头存在但全部失败是 format；0 条有课是合法空结果', () => {
  const empty = parseLabTimetable(HEADER_ONLY, { periodTimes: PERIOD_TIMES, totalWeeks: 25 });
  assert.equal(empty.ok, true);
  assert.equal(empty.error, null);
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.weeks, []);

  const allInvalid = parseLabTimetable(FIXTURE, { periodTimes: {}, totalWeeks: 25 });
  assert.equal(allInvalid.ok, false);
  assert.equal(allInvalid.error, 'format');
  assert.equal(allInvalid.items.length, 0);
  assert.ok(allInvalid.skipped.length > 0);

  const notTable = parseLabTimetable('<html><body><p>没有表格</p></body></html>', { periodTimes: PERIOD_TIMES });
  assert.equal(notTable.error, 'format');

  const login = parseLabTimetable('<html><body>用户登录 统一身份认证</body></html>', { periodTimes: PERIOD_TIMES });
  assert.equal(login.error, 'session');
});

test('实验课：表头缺少星期列时 fail-closed，不静默部分注入', () => {
  const malformed = '<table><tr><th>周次</th><th>节次</th><th>星期一</th></tr>'
    + '<tr><td>第1周</td><td>1-2节</td>'
    + course('合成实验M', li('M001', '26合成01班', '实验楼M101', '10102'))
    + '</tr></table>';
  const result = parseLabTimetable(malformed, { periodTimes: PERIOD_TIMES, totalWeeks: 25 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'format');
  assert.deepEqual(result.items, []);
});

test('实验课：超过学期周次的行被跳过，错误不误判整体失败', () => {
  const result = parseFixture({ totalWeeks: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, '合成实验G');
  assert.deepEqual(result.weeks, [3]);
  assert.ok(result.skipped.some((entry) => entry.reason === 'week'));
});

test('实验课：groupByWeekDay 按周与星期分组并排序', () => {
  const grouped = groupByWeekDay(parseFixture().items);
  assert.equal(grouped.size, 2);
  assert.equal(grouped.get(3).get(2).map((item) => item.name).join(','), '合成实验G');
  assert.equal(grouped.get(4).get(1).map((item) => item.name).join(','), '合成实验A');
  assert.equal(grouped.get(4).get(3).map((item) => item.name).join(','), '合成实验B,合成实验B');
});

test('实验课：labDay 注入条目、学期 guard 与日期 guard', () => {
  const parsed = parseFixture();
  const snapshot = snapshotWith(parsed.items);
  const day = labDay(snapshot, '2026-09-21');
  assert.equal(day.length, 1);
  const entry = day[0];
  assert.equal(entry.lab, true);
  assert.equal(entry.labId, 'A001|4|1|10102');
  assert.equal(entry.ruleId, 'lab-A001|4|1|10102');
  assert.equal(entry.key, '2026-09-21/lab-A001|4|1|10102');
  assert.equal(entry.originDate, '2026-09-21');
  assert.deepEqual(entry.weeks, [4]);
  assert.equal(entry.sourceLabel, '实验课');
  assert.deepEqual(entry.periods, [1, 2]);
  assert.equal(entry.startTime, PERIOD_TIMES[1][0]);

  const saturday = labDay(snapshot, '2026-09-26');
  assert.equal(saturday.length, 1);
  assert.equal(saturday[0].name, '合成实验D');

  assert.deepEqual(labDay(snapshot, '2026-09-20'), []);
  assert.deepEqual(labDay(snapshot, 'not-a-date'), []);
  assert.deepEqual(labDay({ semester: SEMESTER, labs: { ...snapshot.labs, semesterId: 'school-other' } }, '2026-09-21'), []);
  assert.deepEqual(labDay({ semester: { ...SEMESTER, startDate: '2026-09-01' }, labs: snapshot.labs }, '2026-09-21'), []);
});

test('实验课：withLabFallback 成功返回新数据、失败保留同学期旧数据', () => {
  const fresh = { semesterId: SEMESTER.id, semesterStartDate: SEMESTER.startDate, fetchedAt: FETCHED, items: [{ id: 'new' }], skipped: [] };
  const success = withLabFallback({ semesterId: SEMESTER.id, semesterStartDate: SEMESTER.startDate, items: [] }, fresh, { now: FETCHED });
  assert.deepEqual(success.items, [{ id: 'new' }]);
  assert.equal(success.lastAttempt, FETCHED);
  assert.equal(success.lastSkipped, null);

  const previous = { semesterId: SEMESTER.id, semesterStartDate: SEMESTER.startDate, fetchedAt: FETCHED, items: [{ id: 'old' }], skipped: [] };
  const fallback = withLabFallback(previous, { ...fresh, error: 'format', items: [] }, { now: '2026-11-18T00:00:00.000Z', error: 'format', skipped: [{ reason: 'section' }] });
  assert.deepEqual(fallback.items, [{ id: 'old' }]);
  assert.equal(fallback.error, 'format');
  assert.equal(fallback.lastAttempt, '2026-11-18T00:00:00.000Z');
  assert.deepEqual(fallback.lastSkipped, [{ reason: 'section' }]);

  assert.equal(withLabFallback({ ...previous, semesterId: 'school-other' }, { ...fresh, error: 'http', items: [] }, { now: FETCHED, error: 'http' }), null);
  assert.equal(withLabFallback(null, { ...fresh, error: 'http', items: [] }, { now: FETCHED, error: 'http' }), null);
});

test('实验课：attachLabPayload 三态（数组替换 / 错误保留 / 缺省不动）', () => {
  const parsed = parseFixture();
  const previous = { semesterId: SEMESTER.id, semesterStartDate: SEMESTER.startDate, fetchedAt: FETCHED, items: parsed.items, skipped: [] };
  const snapshot = snapshotWith([{ id: 'stale' }]);

  const replaced = attachLabPayload(snapshot, { labs: parsed.items, labFetchedAt: FETCHED }, previous, { periodTimes: PERIOD_TIMES, now: FETCHED });
  assert.equal(replaced.labs.items.length, 7);
  assert.equal(replaced.labs.error, null);
  assert.equal(replaced.labs.fetchedAt, FETCHED);
  assert.equal(replaced.labs.lastAttempt, FETCHED);

  const emptied = attachLabPayload(snapshot, { labs: [] }, previous, { periodTimes: PERIOD_TIMES, now: FETCHED });
  assert.deepEqual(emptied.labs.items, []);

  const failed = attachLabPayload(snapshot, { labError: 'timeout' }, previous, { now: FETCHED });
  assert.equal(failed.labs.items.length, 7);
  assert.equal(failed.labs.error, 'timeout');
  assert.equal(failed.labs.lastAttempt, FETCHED);

  const untouched = attachLabPayload(snapshot, {}, previous, { periodTimes: PERIOD_TIMES, now: FETCHED });
  assert.equal(untouched, snapshot);

  const html = attachLabPayload(snapshot, { labHtml: FIXTURE, labFetchedAt: FETCHED }, previous, { periodTimes: PERIOD_TIMES, now: FETCHED });
  assert.equal(html.labs.items.length, 7);

  const broken = attachLabPayload({ semester: SEMESTER }, { labHtml: '<html>用户登录</html>' }, null, { periodTimes: PERIOD_TIMES, now: FETCHED });
  assert.equal(broken.labs.error, 'session');
  assert.deepEqual(broken.labs.items, []);
  assert.equal(broken.labs.fetchedAt, null);
});

test('实验课：diffLabSnapshots 新增/取消/改时间/改地点/调整，首次无基线不生成新增', () => {
  const parsed = parseFixture();
  const after = { semesterId: SEMESTER.id, semesterStartDate: SEMESTER.startDate, items: parsed.items };
  const now = '2026-09-20T00:00:00.000Z';

  assert.deepEqual(diffLabSnapshots(null, after, now), []);
  assert.deepEqual(diffLabSnapshots({ ...after, items: [] }, after, now), []);

  const withoutA = { ...after, items: parsed.items.filter((item) => item.name !== '合成实验A') };
  const added = diffLabSnapshots(withoutA, after, now);
  assert.equal(added.length, 1);
  assert.equal(added[0].type, '新增实验课');
  assert.equal(added[0].date, '2026-09-21');
  assert.equal(added[0].key, '2026-09-21/lab-A001|4|1|10102');

  const removed = diffLabSnapshots(after, withoutA, now);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].type, '取消实验课');

  const retimed = { ...after, items: parsed.items.map((item) => item.name === '合成实验A' ? { ...item, startTime: PERIOD_TIMES[3][0], first: 3 } : item) };
  const retimeEvent = diffLabSnapshots(after, retimed, now);
  assert.equal(retimeEvent.length, 1);
  assert.equal(retimeEvent[0].type, '改时间');
  assert.ok(retimeEvent[0].fields.includes('startTime'));

  const moved = { ...after, items: parsed.items.map((item) => item.name === '合成实验A' ? { ...item, room: '实验楼A999' } : item) };
  const moveEvent = diffLabSnapshots(after, moved, now);
  assert.equal(moveEvent.length, 1);
  assert.equal(moveEvent[0].type, '改地点');

  const renamed = { ...after, items: parsed.items.map((item) => item.name === '合成实验A' ? { ...item, name: '合成实验A改' } : item) };
  assert.equal(diffLabSnapshots(after, renamed, now)[0].type, '实验调整');
  assert.deepEqual(diffLabSnapshots(after, after, now), []);

  const past = { id: 'PAST|1|1|10102', week: 1, weekday: 1, name: '过去实验', courseCode: 'PAST', room: '实验楼P', sectionCode: '10102', periods: [1, 2], first: 1, last: 2, startTime: PERIOD_TIMES[1][0], endTime: PERIOD_TIMES[2][1], exact: true, lab: true };
  const withPast = { ...after, items: [...parsed.items, past] };
  assert.deepEqual(diffLabSnapshots(after, withPast, now), []);
});

test('实验课：labSummary 与 labErrorText', () => {
  const parsed = parseFixture();
  const summary = labSummary({ items: parsed.items, fetchedAt: FETCHED, error: null });
  assert.equal(summary.count, 7);
  assert.equal(summary.fetchedAt, FETCHED);
  assert.equal(summary.stale, true);
  assert.equal(summary.error, null);

  const fresh = labSummary({ items: [], fetchedAt: new Date().toISOString() });
  assert.equal(fresh.count, 0);
  assert.equal(fresh.stale, false);
  assert.equal(labSummary({ items: [] }).stale, true);
  assert.equal(labSummary({ items: [], fetchedAt: FETCHED, error: 'timeout' }).error, 'timeout');

  assert.equal(labErrorText('session'), '登录已过期，请重新登录后同步');
  assert.equal(labErrorText('http'), '教务系统暂时无法访问');
  assert.equal(labErrorText('timeout'), '读取实验课表超时');
  assert.equal(labErrorText('format'), '实验课表格式无法识别');
  assert.equal(labErrorText('other'), '读取实验课表失败');
  assert.equal(labErrorText('unknown-code'), '读取实验课表失败');
});

test('实验课：模块保持纯函数（无 DOM、无网络、无仓库模块依赖）', () => {
  const source = readFileSync(new URL('../web/jiaowu-lab.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /new\s+DOMParser/);
  assert.doesNotMatch(source, /^import\s/m);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /XMLHttpRequest/);
});
