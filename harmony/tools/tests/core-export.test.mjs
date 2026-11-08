// 职责：core/export 纯逻辑测试（导出文件名/排版/PDF 拼装/备份校验/排查日志），不依赖 SDK 与真机。
// 运行：node harmony/tools/run-core-tests.mjs（本文件被其收集；也可 node --experimental-strip-types --test 单跑）。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');

const load = async (rel) => await import(pathToFileURL(path.join(tmp, rel)).href);
const F = await load('core/export/ExportFiles.ts');
const M = await load('core/export/ExportModel.ts');
const T = await load('core/export/ExportText.ts');
const L = await load('core/export/CanvasLayout.ts');
const P = await load('core/export/PdfPages.ts');
const B = await load('core/export/Backup.ts');
const D = await load('core/export/DiagnosticsReport.ts');
const A = await load('core/types/AppState.ts');

const WEEKDAYS = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'];

const rulesCopy = {
  title: 'TITLE', generatedAt: 'AT {0}', semester: 'SEM {0}', weekdays: WEEKDAYS,
  nameLabel: 'NAME', teacherLabel: 'TEACHER', roomLabel: 'ROOM', timeLabel: 'TIME', weeksLabel: 'WEEKS',
  studyLabel: 'STUDY', customLabel: 'CUSTOM', unscheduledTitle: 'UNSCHEDULED', emptyNote: 'EMPTY',
  timeRange: '{0}-{1}', weekRange: '{0}-{1}w', weekSingle: '{0}w', weekAll: 'ALL', weekOdd: 'ODD', weekEven: 'EVEN',
  fieldSeparator: '\t', listSeparator: ',', commentPrefix: '#', lineBreak: '\n',
  // —— web buildRulesText 逐字口径——
  webTitle: '# TITLE', semesterLine: 'SEM {0}', teachingWeeks: 'TEACH {0}|{1}|{2}',
  weekSpan: 'W{0}-{1}', weekOne: 'W{0}', generatedLine: 'GEN {0}', sourceLine: 'SRC {0}',
  sourceNote: 'NOTE', notesLine: 'NOTES', formatLine: 'FORMAT', courseName: 'COURSE', classTime: 'CLASSTIME',
  emptyLine: 'EMPTYLINE', period: 'P{0}', periodJoin: '+', segmentSpan: '{0}~{1}', noteLabel: 'NOTE-LABEL',
  unknownWeeks: 'UNKNOWN-WEEKS', unscheduledNote: 'UNSCHED-NOTE', conflictLine: 'CONFLICT {0}',
  patternAll: 'ALL', sourceSchool: 'SCHOOL', sourceSample: 'SAMPLE',
  normalizeOpen: '(', normalizeClose: ')', normalizeComma: ',', normalizeDash: '-',
  ordinalPrefix: '', weekSuffix: '', weekdayPrefix: 'W', unnamed: 'UNNAMED'
};

// 中文金样本用副本：断言与 web/timetable-export.mjs 的 7 组周次输出逐字一致。
const goldCopy = Object.assign({}, rulesCopy, {
  weekSpan: '第{0}-{1}周', weekOne: '第{0}周', ordinalPrefix: '第', weekSuffix: '周',
  patternAll: '全部', weekOdd: '单周', weekEven: '双周', periodJoin: '、', unknownWeeks: '待确认'
});

const weekLabelOf = (weeks, total) => 'W' + weeks.join('/') + '#' + total;

const pageCopy = {
  weekTitle: 'WEEK {0}/{1}', semesterTitle: 'SEM {0}', timeColumn: 'TIME', weekdays: WEEKDAYS,
  stampLabel: 'AT {0}', emptyNote: 'EMPTY', overflowNote: 'OVER {0}/{1}',
  cardTime: '{0}-{1}', cardRoom: 'R {0}', cardTeacher: 'T {0}',
  // ——/④：状态标签与未排课附页 ——
  tagRemap: 'TAG-REMAP', tagOverride: 'TAG-OVERRIDE', tagCustom: 'TAG-CUSTOM', tagStudy: 'TAG-STUDY',
  tagOverlap: 'TAG-OVERLAP', tagConflict: 'TAG-CONFLICT', continuation: 'CONT {0}/{1}',
  unscheduledTitle: 'UNSCHED-TITLE', unscheduledItem: '{0} @ {1}', unscheduledMeta: 'LOC {0} / TEA {1}',
  overviewTitle: 'OVERVIEW-TITLE', overviewSubtitleRange: 'SUB {0}-{1}', overviewSubtitleOne: 'SUB-ONE {0}',
  overviewNote: 'NOTE', overviewTimeColumn: 'SLOT', weeksPrefix: 'WEEKS {0}', overviewTimeRange: '{0}~{1}',
  placePrefix: 'PLACE {0}', roomUnknown: 'ROOM-UNKNOWN', teacherPrefix: 'TEA {0}', teacherNone: 'TEA-NONE', teacherUnknown: 'TEA-UNKNOWN',
  overviewFooterEmpty: 'FOOT-EMPTY', overviewFooterEmptyPending: 'FOOT-EMPTY-PEND {0}', overviewFooterPending: 'FOOT-PEND {0}',
  overviewFooterWeeks: 'FOOT-WEEKS {0}', overviewFooterWeeksOne: 'FOOT-WEEKS-ONE', overviewFooterLegend: 'FOOT-LEGEND|',
  overviewRight: 'FOOT-RIGHT', overviewNotice: 'OVERVIEW-NOTICE',
  weekTagShift: 'W-SHIFT', weekTagShiftFrom: 'W-SHIFT-FROM {0}', weekTagPersonEdit: 'W-EDIT', weekTagOverlap: 'W-OVERLAP',
  weekTagConflict: 'W-CONFLICT', weekTagConflictConfirm: 'W-CONFLICT-CONFIRM'
};

const diagCopy = {
  title: 'DIAG', generatedAt: 'AT {0}', appVersion: 'APP {0}', systemVersion: 'SYS {0}', apiVersion: 'API {0}',
  stateRevision: 'REV {0}', lastSyncAt: 'SYNC {0}', lastAttempt: 'TRY {0}', sectionEvents: 'EVENTS',
  sectionSources: 'SOURCES', none: 'NONE', unknownValue: 'UNKNOWN', eventLine: '- {0} {1}', sourceLine: '* {0} {1}',
  truncatedNote: 'TRUNC {0}/{1}'
};

function baseState() {
  const state = A.createDefaultState();
  state.snapshot = {
    id: 's1', name: 'Semester A', startDate: '2026-09-07', weeks: 2, rules: [], source: { kind: 'sample', label: 'x' }
  };
  return state;
}

function row(date, name, startTime, endTime, extra) {
  return Object.assign({
    key: date + '/' + name, date, startTime, endTime, periods: [], name, teacher: 'T', room: 'R',
    cancelled: false, vacant: false, localActivity: false, customCourse: false, remapId: null,
    conflict: false, overlap: false, source: 'school', originDate: null
  }, extra || {});
}

function modelOf() {
  const state = baseState();
  const byDate = new Map();
  // 同一门课落在同一星期（第 1、2 周的周一）才会合并成一张卡；Art 在第 1 周周四。
  byDate.set('2026-09-07', [row('2026-09-07', 'Math', '08:00', '08:45')]);
  byDate.set('2026-09-14', [row('2026-09-14', 'Math', '08:00', '08:45')]);
  byDate.set('2026-09-08', [row('2026-09-08', 'Cancelled', '09:00', '09:45', { cancelled: true })]);
  byDate.set('2026-09-09', [row('2026-09-09', 'Vacant', '09:00', '09:45', { vacant: true })]);
  byDate.set('2026-09-10', [row('2026-09-10', 'Art', '10:00', '11:30')]);
  const resolve = (date) => byDate.get(date) || [];
  return { state, model: M.buildSemesterModel(state, resolve) };
}

test('export-1) exportFileSpec 三种导出：总览 PNG / 每周一页 PDF / 规则 TXT', () => {
  assert.deepEqual(F.exportFileSpec('semester-overview'), { mime: 'image/png', extension: 'png' });
  assert.deepEqual(F.exportFileSpec('semester-pages'), { mime: 'application/pdf', extension: 'pdf' });
  assert.deepEqual(F.exportFileSpec('rules-text'), { mime: 'text/plain', extension: 'txt' });
});

test('export-2) 时间戳：固定 +08:00 偏移，展示与文件名两种格式', () => {
  const at = Date.UTC(2026, 8, 7, 1, 5);
  assert.equal(F.formatStamp(at, 480), '2026-09-07 09:05');
  assert.equal(F.compactStamp(at, 480), '20260907-0905');
  assert.equal(F.compactStamp(at, 0), '20260907-0105');
  assert.throws(() => F.requireFiniteTime(NaN), /EXPORT_TIME_INVALID/);
});

test('export-3) sanitizeFileName：去危险字符/控制字符、折叠空格、去首尾点，超长截断', () => {
  assert.equal(F.sanitizeFileName('a/b\\c:d*e?f"g<h>i|j', 'fb'), 'abcdefghij');
  assert.equal(F.sanitizeFileName('  name  ', 'fb'), 'name');
  assert.equal(F.sanitizeFileName('...x...', 'fb'), 'x');
  assert.equal(F.sanitizeFileName('a\u0000b', 'fb'), 'ab');
  assert.equal(F.sanitizeFileName('   ', 'fb'), 'fb');
  assert.equal(F.sanitizeFileName('x'.repeat(300), 'fb').length, 180);
});

test('export-4) ensureExtension 幂等、大小写不重复；isSafeFileName 拒绝路径字符', () => {
  assert.equal(F.ensureExtension('a', 'png'), 'a.png');
  assert.equal(F.ensureExtension('a.PNG', 'png'), 'a.PNG');
  assert.equal(F.ensureExtension('a.pdf', 'png'), 'a.pdf.png');
  assert.equal(F.isSafeFileName('ok-name_1.png'), true);
  assert.equal(F.isSafeFileName('a/b.png'), false);
  assert.equal(F.isSafeFileName('.hidden'), false);
  assert.equal(F.isSafeFileName(''), false);
});

test('export-5) validateExportPayload：MIME/扩展名/文件名字符/体积四道校验', () => {
  assert.deepEqual(F.validateExportPayload('image/png', 'png', 'a.png', 10), { ok: true, code: 'OK' });
  assert.equal(F.validateExportPayload('text/html', 'png', 'a.png', 10).code, 'EXPORT_MIME_UNSUPPORTED');
  assert.equal(F.validateExportPayload('image/png', 'exe', 'a.exe', 10).code, 'EXPORT_EXTENSION_UNSUPPORTED');
  assert.equal(F.validateExportPayload('image/png', 'png', 'a/b.png', 10).code, 'EXPORT_NAME_UNSAFE');
  assert.equal(F.validateExportPayload('image/png', 'png', 'a.png', 0).code, 'EXPORT_TOO_LARGE');
  assert.equal(F.validateExportPayload('image/png', 'png', 'a.png', F.MAX_EXPORT_BYTES + 1).code, 'EXPORT_TOO_LARGE');
});

test('export-6) buildExportFileName/诊断文件名：带紧凑时间戳且扩展名正确', () => {
  const at = Date.UTC(2026, 8, 7, 1, 5);
  assert.equal(F.buildExportFileName({ prefix: 'P', label: 'L', kind: 'semester-overview', nowMs: at, offsetMinutes: 480 }), 'P-L-20260907-0905.png');
  assert.equal(F.buildExportFileName({ prefix: 'P', label: 'L', kind: 'semester-pages', nowMs: at, offsetMinutes: 480 }), 'P-L-20260907-0905.pdf');
  assert.equal(F.buildDiagnosticsFileName('P', 'L', at, 480), 'P-L-20260907-0905.txt');
});

test('export-7) 日期工具：日期键校验 / 加减天 / 星期 / 周次', () => {
  assert.equal(M.isValidDateKey('2026-09-07'), true);
  assert.equal(M.isValidDateKey('2026-02-30'), false);
  assert.equal(M.isValidDateKey('2026-9-7'), false);
  assert.equal(M.addDaysKey('2026-09-07', 4), '2026-09-11');
  assert.equal(M.addDaysKey('2026-12-31', 1), '2027-01-01');
  assert.equal(M.weekdayOfKey('2026-09-07'), 1);
  assert.equal(M.weekdayOfKey('2026-09-13'), 7);
  assert.equal(M.weekOfKey({ startDate: '2026-09-07' }, '2026-09-14'), 2);
});

test('export-8) collectEntries：跳过停课与空课位，按周展开', () => {
  const state = baseState();
  const resolve = (date) => date === '2026-09-07' ? [row(date, 'Math', '08:00', '08:45')] : [];
  const entries = M.collectEntries(state.snapshot, resolve);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].week, 1);
  assert.equal(entries[0].weekday, 1);
  const skip = (date) => [row(date, 'X', '08:00', '08:45', { cancelled: true }), row(date, 'Y', '09:00', '09:45', { vacant: true })];
  assert.equal(M.collectEntries(state.snapshot, skip).length, 0);
});

test('export-9) cardsOf：跨周同课合并、周次升序、首末日期与列计数', () => {
  const { model } = modelOf();
  assert.equal(model.totalWeeks, 2);
  assert.equal(model.cards.length, 2, 'Math 两周合并 + Art 一门');
  const math = model.cards.find((c) => c.name === 'Math');
  assert.deepEqual(math.weeks, [1, 2]);
  assert.equal(math.firstDate, '2026-09-07');
  assert.equal(math.lastDate, '2026-09-14');
  assert.equal(model.columnCounts[0], 1);
  assert.equal(model.columnCounts[3], 1);
});

test('export-10) buildSemesterModel：无学期快照返回 null', () => {
  const state = A.createDefaultState();
  assert.equal(M.buildSemesterModel(state, () => []), null);
});

test('export-11) formatWeekSpec：与 web 逐字一致的 7 组金样本 + 边界', () => {
  // web/timetable-export.mjs formatWeekParts：仅 ≥3 周且连续全奇/全偶才压缩「第a-b周(单/双)」，2 周一律枚举。
  const cases = [
    [[3], 8, '第3周(全部)'],
    [[7, 9], 10, '第7、9周(全部)'],
    [[1, 3, 5], 8, '第1-5周(单周)'],
    [[2, 4, 6], 8, '第2-6周(双周)'],
    [[7, 9, 11], 12, '第7-11周(单周)'],
    [[2, 5], 8, '第2、5周(全部)']
  ];
  for (const [weeks, total, expected] of cases) {
    assert.equal(T.formatWeekSpec(weeks, total, goldCopy).text, expected);
  }
  assert.equal(T.formatWeekSpec([1, 2, 3, 4], 4, goldCopy).text, '第1-4周(全部)');
  const empty = T.formatWeekSpec([], 8, goldCopy);
  assert.equal(empty.text, '');
  assert.equal(empty.pattern, '全部');
  const bad = T.formatWeekSpec([0, -1], 8, goldCopy);
  assert.equal(bad.text, '');
  assert.equal(bad.pattern, '全部');
  // 超出总周次的周次被过滤（web 同口径）。
  assert.equal(T.formatWeekSpec([3, 12], 8, goldCopy).text, '第3周(全部)');
  const parts = T.formatWeekParts([5, 6], 18, goldCopy);
  assert.equal(parts.text, '第5-6周');
  assert.equal(parts.pattern, '全部');
});

test('export-12) buildRulesText：8 行头 + 4 列表头 + 每门课一行（多段分号合并）+ 未排课 5 列', () => {
  const { model } = modelOf();
  model.snapshot.unscheduled = [{ id: 'u1', name: 'Pending', teacher: 'T', room: 'R', weeks: [2, 3], note: '' }];
  const text = T.buildRulesText(model, goldCopy, '2026-09-07 09:00');
  const lines = text.split('\n');
  assert.equal(lines[0], '# TITLE');
  assert.equal(lines[1], '# SEM Semester A');
  assert.equal(lines[2], '# TEACH 第1-2周|2026-09-07|2026-09-20');
  assert.equal(lines[3], '# GEN 2026-09-07 09:00');
  assert.equal(lines[4], '# SRC xNOTE', '来源行=来源标签 + 非学校来源后缀（后缀值自带括号）');
  assert.equal(lines[5], '# NOTES');
  assert.equal(lines[6], '# FORMAT');
  assert.equal(lines[7], ['COURSE', 'TEACHER', 'ROOM', 'CLASSTIME'].join('\t'));
  const courseLines = lines.filter((l) => l.startsWith('Math\t') || l.startsWith('Art\t'));
  assert.equal(courseLines.length, 2, '每门课一行（Math 两段同教室合并成一行）');
  assert.ok(courseLines[0].startsWith('Math\tT\tR\t'));
  assert.ok(courseLines[0].includes('W1P1{第1-2周}(全部)'));
  const unscheduledIndex = lines.indexOf('# UNSCHEDULED');
  assert.ok(unscheduledIndex > 0);
  assert.equal(lines[unscheduledIndex + 1], ['COURSE', 'TEACHER', 'ROOM', 'WEEKS', 'NOTE-LABEL'].join('\t'));
  assert.equal(lines[unscheduledIndex + 2], 'Pending\tT\tR\t第2周(全部)\tUNSCHED-NOTE');
  assert.ok(!text.includes('Cancelled') && !text.includes('Vacant'));
  assert.ok(text.endsWith('\n'));
});

test('export-13) buildRulesText：空课表输出 emptyLine（第 10 行）', () => {
  const state = baseState();
  const empty = M.buildSemesterModel({ ...state, snapshot: { ...state.snapshot, weeks: 1 } }, () => []);
  const lines = T.buildRulesText(empty, goldCopy, 'S').split('\n');
  assert.equal(lines.length, 10, '7 行抬头 + 列表头 + 空行 + 末尾换行');
  assert.equal(lines[7], ['COURSE', 'TEACHER', 'ROOM', 'CLASSTIME'].join('\t'));
  assert.equal(lines[8], '# EMPTYLINE');
  assert.equal(T.buildRulesText(null, goldCopy, 'S').split('\n')[8], '# EMPTYLINE');
});

test('export-13b) buildRulesModel：多段合并、周次 union、按 web 排序并聚合未排课周次', () => {
  const { model } = modelOf();
  const courses = T.buildRulesModel(model, goldCopy);
  assert.equal(courses.length, 2);
  const math = courses.find((c) => c.name === 'Math');
  assert.equal(math.segments.length, 1);
  assert.equal(math.rooms.join(';'), 'R');
  assert.deepEqual(math.segments[0].periods, [1]);
  assert.equal(math.segments[0].week.text, '第1-2周');
  assert.equal(math.segments[0].week.pattern, '全部');
  assert.equal(T.buildRulesModel(model, goldCopy).map((c) => c.name).join(','), 'Math,Art');
  assert.deepEqual(T.occurrencePeriods('08:30', '09:55'), [1, 2]);
  assert.deepEqual(T.occurrencePeriods('bad', 'bad'), []);
  assert.equal(T.cleanField('a\tb\nc', 'X'), 'a b c');
  assert.equal(T.cleanField('   ', 'X'), 'X');
});

test('export-14) 画布几何：7 个作息带单调、minuteToY 单调、调色板 0..4', () => {
  const boxes = L.layoutBands(L.EXPORT_HEADER_BOTTOM, L.EXPORT_GRID_BOTTOM);
  assert.equal(boxes.length, 7);
  for (let i = 1; i < boxes.length; i++) {
    assert.ok(boxes[i].top >= boxes[i - 1].bottom - 1e-6);
  }
  assert.equal(L.minuteToY(0, boxes), boxes[0].top);
  assert.equal(L.minuteToY(1440, boxes), boxes[6].bottom);
  let last = -1;
  for (const minute of [0, 480, 510, 720, 900, 1080, 1440]) {
    const y = L.minuteToY(minute, boxes);
    assert.ok(y >= last);
    last = y;
  }
  for (let weekday = 1; weekday <= 7; weekday++) {
    const palette = L.cardPalette(weekday);
    assert.ok(Number.isInteger(palette) && palette >= 0 && palette < L.PALETTE_COUNT);
  }
  assert.equal(L.formatMinute(510), '08:30');
  assert.equal(L.parseMinute('08:30'), 510);
  assert.equal(L.parseMinute('bad'), -1);
});

test('export-15) buildWeekPage：单周页尺寸/标题/星期表头/课程卡片', () => {
  const { model } = modelOf();
  const page = L.buildWeekPage(model, 1, pageCopy, '2026-09-07 09:00');
  assert.equal(page.width, 2520);
  assert.equal(page.height, 1782);
  assert.ok(page.texts.some((t) => t.text === 'WEEK 1/2'));
  assert.ok(page.texts.some((t) => t.text === 'W1'));
  assert.ok(page.texts.some((t) => t.text === 'Math'));
  assert.ok(page.rects.length >= 7);
  for (const rect of page.rects) {
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= page.width + 1);
    assert.ok(rect.y + rect.height <= page.height + 1);
  }
  const emptyPage = L.buildWeekPage(model, 1, pageCopy, 'S');
  const emptyTexts = L.buildWeekPage(M.buildSemesterModel({ ...baseState(), snapshot: { ...baseState().snapshot, weeks: 1 } }, () => []), 1, pageCopy, 'S');
  assert.ok(emptyTexts.texts.some((t) => t.text === 'EMPTY'));
  assert.ok(emptyPage.texts.length > 0);
});

test('export-16) 整学期总览：恒单图 full；高度随内容升，超 4096 才压缩并给 notice', () => {
  const { model } = modelOf();
  const layout = L.selectOverviewLayout(model, pageCopy, L.defaultMeasure, weekLabelOf);
  assert.equal(layout.level, 'full');
  assert.equal(layout.height, 1782);
  assert.equal(layout.scaleY, 1);
  assert.equal(layout.notice, '');

  const state = baseState();
  const dense = [];
  for (let i = 0; i < 24; i++) {
    dense.push(row('2026-09-07', 'C' + i, String(8 + (i % 8)).padStart(2, '0') + ':00', String(9 + (i % 8)).padStart(2, '0') + ':30'));
  }
  const big = M.buildSemesterModel(state, () => dense);
  const bigLayout = L.selectOverviewLayout(big, pageCopy, L.defaultMeasure, weekLabelOf);
  assert.equal(bigLayout.level, 'full', 'B 不能切双列/PDF，只能单图');
  assert.ok(bigLayout.height >= 1782 && bigLayout.height <= 4096);
  const page = L.buildOverviewPage(big, pageCopy, 'S', L.defaultMeasure, weekLabelOf);
  assert.equal(page.width, 2520);
  assert.equal(page.height, bigLayout.height);
  assert.ok(page.height >= 1782 && page.height <= 4096);
  for (const rect of page.rects) {
    assert.ok(rect.x + rect.width <= page.width + 1);
    assert.ok(rect.y + rect.height <= page.height + 1);
  }
  assert.equal(page.texts.filter((t) => t.text === pageCopy.overviewTitle).length, 1);
  assert.ok(!page.texts.some((t) => t.text === 'WEEK 2/2'), '总览页不再使用周页标题');
});

test('export-17) buildOverviewPage：空课表输出 emptyNote 且仍是一张固定高度图', () => {
  const state = baseState();
  const model = M.buildSemesterModel({ ...state, snapshot: { ...state.snapshot, weeks: 1 } }, () => []);
  const page = L.buildOverviewPage(model, pageCopy, 'S', L.defaultMeasure, weekLabelOf);
  assert.equal(page.height, 1782);
  assert.ok(page.texts.some((t) => t.text === 'EMPTY'));
});

test('export-18) PDF 计划：整学期页数=周数、单周=1、超 200 页判溢出', () => {
  const plan = P.buildSemesterPdfPlan(17);
  assert.equal(plan.pageCount, 17);
  assert.deepEqual(plan.weeks, Array.from({ length: 17 }, (_, i) => i + 1));
  assert.equal(P.buildWeekPdfPlan(3).weeks[0], 3);
  assert.equal(P.pdfPagesOverflow(201), true);
  assert.equal(P.pdfPagesOverflow(200), false);
  assert.deepEqual(P.validatePdfPages([]), { ok: false, code: 'EXPORT_PAGES_EMPTY' });
  assert.equal(P.validatePdfPages([{ jpeg: new Uint8Array([]), width: 10, height: 10 }]).code, 'EXPORT_PAGE_INVALID');
});

test('export-19) buildImagePdf：%PDF 头、页对象数、xref/EOF 完整', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  const pdf = P.buildImagePdf([
    { jpeg, width: 1684, height: 1190 },
    { jpeg, width: 1684, height: 1190 }
  ]);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 2);
  assert.ok(text.includes('/Count 2'));
  assert.ok(text.includes('/Filter /DCTDecode'));
  assert.equal(P.PDF_PAGE_WIDTH, 841.89);
  assert.equal(P.PDF_PAGE_HEIGHT, 595.28);
  assert.ok(text.includes('/MediaBox [0 0 841.89 595.28]'));
  assert.ok(!text.includes('/MediaBox [0 0 842 595]'));
  // 内容矩阵必须与 MediaBox 同一组尺寸，避免「只改页尺寸导致内容错位」。
  assert.ok(text.includes('q 841.89 0 0 595.28 0 0 cm /Im0 Do Q'));
  assert.equal(P.buildWeekPdfPlan(3).width, 841.89);
  assert.equal(P.buildWeekPdfPlan(3).height, 595.28);
  assert.ok(text.includes('startxref'));
  assert.equal((text.match(/\/Subtype \/Image/g) || []).length, 2);
  assert.throws(() => P.buildImagePdf([]), /EXPORT_PAGES_EMPTY/);
  const many = new Array(201).fill({ jpeg, width: 1, height: 1 });
  assert.throws(() => P.buildImagePdf(many), /EXPORT_PAGES_TOO_MANY/);
});

test('export-20) 备份往返：信封字段与摘要', () => {
  const state = baseState();
  const raw = B.buildBackupJson(state, Date.UTC(2026, 8, 7, 1, 5), '1.2.0');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.format, 'jiangshui-schedule-backup');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.state.snapshot.name, 'Semester A');
  const result = B.parseBackupJson(raw);
  assert.equal(result.ok, true);
  assert.equal(result.code, '');
  assert.equal(result.summary.semesterName, 'Semester A');
  assert.equal(result.summary.weeks, 2);
  assert.equal(result.exportedAt, Date.UTC(2026, 8, 7, 1, 5));
  assert.equal(result.appVersion, '1.2.0');
  assert.equal(result.state.snapshot.name, 'Semester A');
});

test('export-21) 裸 AppState（Android state.json）也能导入', () => {
  const raw = JSON.stringify(baseState());
  const result = B.parseBackupJson(raw);
  assert.equal(result.ok, true);
  assert.equal(result.state.snapshot.name, 'Semester A');
});

test('export-22) 坏备份一律拒绝，且不返回可落地 state', () => {
  const cases = [
    ['', 'BACKUP_EMPTY'],
    ['not json', 'BACKUP_INVALID_JSON'],
    ['[]', 'BACKUP_NOT_OBJECT'],
    ['{"hello":1}', 'BACKUP_FORMAT_UNSUPPORTED'],
    ['{"format":"other","version":1,"state":{}}', 'BACKUP_FORMAT_UNSUPPORTED'],
    ['{"format":"jiangshui-schedule-backup","version":9,"state":{}}', 'BACKUP_VERSION_UNSUPPORTED'],
    ['{"format":"jiangshui-schedule-backup","version":1,"state":{"version":4}}', 'BACKUP_STATE_VERSION_FUTURE'],
    ['{"format":"jiangshui-schedule-backup","version":1,"state":{"version":3}}', 'BACKUP_STATE_INVALID']
  ];
  for (const [raw, code] of cases) {
    const result = B.parseBackupJson(raw);
    assert.equal(result.ok, false, raw);
    assert.equal(result.code, code, raw);
    assert.equal(result.state, null, raw);
  }
  const big = '{"x":"' + 'a'.repeat(B.MAX_BACKUP_BYTES) + '"}';
  assert.equal(B.parseBackupJson(big).code, 'BACKUP_TOO_LARGE');
});

test('export-23) 结构校验：字段类型错/数量超限/主题非法都要拒', () => {
  const state = baseState();
  const clone = () => JSON.parse(JSON.stringify(state));
  const wrap = (s) => JSON.stringify({ format: 'jiangshui-schedule-backup', version: 1, state: s });
  let bad = clone();
  delete bad.events;
  assert.equal(B.parseBackupJson(wrap(bad)).code, 'BACKUP_STATE_INVALID');
  bad = clone();
  bad.courseSettings.showEveningStudy = 'yes';
  assert.equal(B.parseBackupJson(wrap(bad)).code, 'BACKUP_STATE_INVALID');
  bad = clone();
  bad.theme = 'neon';
  assert.equal(B.parseBackupJson(wrap(bad)).code, 'BACKUP_STATE_INVALID');
  bad = clone();
  bad.snapshot.weeks = 0;
  assert.equal(B.parseBackupJson(wrap(bad)).code, 'BACKUP_STATE_INVALID');
  bad = clone();
  bad.overrides = new Array(B.MAX_BACKUP_RECORDS + 1).fill({});
  assert.equal(B.parseBackupJson(wrap(bad)).code, 'BACKUP_TOO_MANY_ITEMS');
  assert.equal(B.parseBackupJson(JSON.stringify(state)).ok, true);
});

test('export-24) 旧「课表快照」（学期快照 + customCourses，无 state.version）显式拒绝', () => {
  const legacy = { name: 'Semester A', startDate: '2026-09-07', weeks: 2, rules: [], customCourses: [] };
  assert.equal(B.parseBackupJson(JSON.stringify(legacy)).code, 'BACKUP_LEGACY_UNSUPPORTED');
});

test('export-25) 备份文件名：只含安全字符且带紧凑时间戳', () => {
  const name = B.buildBackupFileName('P', '课表/快照', Date.UTC(2026, 8, 7, 1, 5), 480);
  assert.equal(name, 'P-课表-快照-20260907-0905.json');
  assert.equal(B.buildBackupFileName('', '', NaN, NaN).endsWith('.json'), true);
});

test('export-26) 排查日志：头部字段、事件/来源分段、空段输出 none', () => {
  const input = {
    appVersion: '1.2.0', systemVersion: 'HarmonyOS 6.0', apiVersion: 26, stateRevision: 7,
    lastSyncAt: '2026-09-07 09:00', lastAttempt: '2026-09-07 09:05',
    events: ['stage=parse code=SCHOOL_PARSE_FAILED'], sources: ['school|cache']
  };
  const text = D.buildDiagnosticsText(input, diagCopy, Date.UTC(2026, 8, 7, 1, 5), 480, (line) => line, 200000);
  const lines = text.split('\n');
  assert.equal(lines[0], 'DIAG');
  assert.equal(lines[1], 'AT 2026-09-07 09:05');
  assert.ok(lines.includes('APP 1.2.0'));
  assert.ok(lines.includes('SYS HarmonyOS 6.0'));
  assert.ok(lines.includes('API 26'));
  assert.ok(lines.includes('REV 7'));
  assert.ok(text.includes('EVENTS'));
  assert.ok(text.includes('- 1 stage=parse code=SCHOOL_PARSE_FAILED'));
  assert.ok(text.includes('SOURCES'));
  assert.ok(text.includes('* 1 school|cache'));
  const emptyText = D.buildDiagnosticsText({ ...input, events: [], sources: [] }, diagCopy, 0, 0, (l) => l, 200000);
  assert.ok(emptyText.includes('NONE'));
});

test('export-27) 排查日志：注入的脱敏函数对每行生效', () => {
  const input = {
    appVersion: '1.2.0', systemVersion: 'S', apiVersion: 26, stateRevision: 1,
    lastSyncAt: 'A', lastAttempt: 'B',
    events: ['Cookie: JSESSIONID=secret'], sources: ['token=abc']
  };
  const redact = (line) => line.replace(/JSESSIONID=secret/g, 'JSESSIONID=[redacted]').replace(/token=abc/g, 'token=[redacted]');
  const text = D.buildDiagnosticsText(input, diagCopy, 0, 0, redact, 200000);
  assert.ok(!text.includes('secret'));
  assert.ok(!text.includes('token=abc'));
  assert.ok(text.includes('JSESSIONID=[redacted]'));
  assert.ok(text.includes('token=[redacted]'));
});

test('export-28) 排查日志：事件行数与总字符双上限，超限给 truncatedNote', () => {
  const many = Array.from({ length: D.MAX_DIAGNOSTICS_LINES + 50 }, (_, i) => 'event-' + i);
  const input = {
    appVersion: '1', systemVersion: 'S', apiVersion: 1, stateRevision: 1, lastSyncAt: 'A', lastAttempt: 'B',
    events: many, sources: []
  };
  const text = D.buildDiagnosticsText(input, diagCopy, 0, 0, (l) => l, 200000);
  assert.ok(text.includes('TRUNC ' + D.MAX_DIAGNOSTICS_LINES + '/' + many.length));
  assert.ok(!text.includes('event-' + (many.length - 1)));
  const capped = D.buildDiagnosticsText({ ...input, events: Array.from({ length: 50 }, (_, i) => 'x'.repeat(100) + i) }, diagCopy, 0, 0, (l) => l, 500);
  assert.ok(capped.length <= 500);
  assert.ok(capped.includes('TRUNC'));
});

test('export-29) 导出模型不透传空/停课行，且列计数总和等于卡片数', () => {
  const { model } = modelOf();
  const total = model.columnCounts.reduce((a, b) => a + b, 0);
  assert.equal(total, model.cards.length);
  for (const card of model.cards) {
    assert.ok(card.name !== 'Cancelled' && card.name !== 'Vacant');
    assert.ok(card.weeks.length > 0 && card.count > 0);
  }
});

function weekModelOf(specs) {
  const entries = specs.map((spec, index) => ({
    week: 1, weekday: spec.weekday || 1, date: '2026-09-07',
    row: row('2026-09-07', spec.name, spec.start, spec.end, { key: 'k' + index })
  }));
  return { snapshot: { name: 'S', startDate: '2026-09-07' }, totalWeeks: 1, entries, cards: [], columnCounts: [0, 0, 0, 1, 0, 0, 0] };
}

function cardRects(page) {
  return page.rects.filter((rect) => rect.width === L.EXPORT_COLUMN_WIDTH - 16);
}

test('export-30) 周页容量边界：一张课占满一页（4px 余量），+1 张跨页且不丢卡', () => {
  const full = weekModelOf([{ name: 'Full', start: '00:00', end: '24:00' }]);
  const one = L.buildWeekPages(full, 1, pageCopy, 'S');
  assert.equal(one.length, 1);
  assert.equal(one[0].texts.filter((item) => item.text === 'Full').length, 1);
  const only = cardRects(one[0]);
  assert.equal(only.length, 1);
  assert.equal(only[0].y + only[0].height, 1606);
  assert.ok(L.EXPORT_GRID_BOTTOM - (only[0].y + only[0].height) === 4, '占满后只剩 4px（代码中的 +4 视觉余量）');

  // 再放一张同起始的课：列内游标已经到 1616，必然跨页，而不是丢卡或叠画。
  const two = weekModelOf([
    { name: 'Full', start: '00:00', end: '24:00' },
    { name: 'Next', start: '00:00', end: '24:00' }
  ]);
  const pages = L.buildWeekPages(two, 1, pageCopy, 'S');
  assert.equal(pages.length, 2);
  assert.equal(pages[0].texts.filter((item) => item.text === 'Full').length, 1);
  assert.equal(pages[1].texts.filter((item) => item.text === 'Next').length, 1);
  assert.ok(pages[0].texts.some((item) => item.text === 'WEEK 1/1 · 1/2'));
  assert.ok(pages[1].texts.some((item) => item.text === 'WEEK 1/1 · 2/2'));
  assert.ok(pages[0].texts.some((item) => item.text === 'CONT 1/2'));
  assert.ok(pages[1].texts.some((item) => item.text === 'CONT 2/2'));
  assert.equal(cardRects(pages[0]).length + cardRects(pages[1]).length, 2);
});

test('export-31) 长课名换行：标题按估宽拆行、卡片高度随之增加，容量边界随之下移', () => {
  const short4 = L.buildWeekPages(weekModelOf([
    { name: 'S0', start: '08:30', end: '09:55' },
    { name: 'S1', start: '08:30', end: '09:55' },
    { name: 'S2', start: '08:30', end: '09:55' },
    { name: 'S3', start: '08:30', end: '09:55' }
  ]), 1, pageCopy, 'S');
  assert.equal(short4.length, 1);
  const short5 = L.buildWeekPages(weekModelOf([
    { name: 'S0', start: '08:30', end: '09:55' }, { name: 'S1', start: '08:30', end: '09:55' },
    { name: 'S2', start: '08:30', end: '09:55' }, { name: 'S3', start: '08:30', end: '09:55' },
    { name: 'S4', start: '08:30', end: '09:55' }
  ]), 1, pageCopy, 'S');
  assert.equal(short5.length, 2);

  const name = '超长课名'.repeat(8); // 32 个 CJK 字符，超过列内 273.71px 的单行宽
  const long3 = L.buildWeekPages(weekModelOf([
    { name, start: '08:30', end: '09:55' },
    { name: name + 'B', start: '08:30', end: '09:55' },
    { name: name + 'C', start: '08:30', end: '09:55' }
  ]), 1, pageCopy, 'S');
  assert.equal(long3.length, 2);
  const firstLongCard = cardRects(long3[0]).filter((rect) => rect.height > 200);
  assert.equal(firstLongCard.length >= 1, true);
  assert.equal(firstLongCard[0].height, 294);
  const titles = long3[0].texts.filter((item) => item.size === 30).map((item) => item.text);
  assert.equal(titles.includes(name), false, '整串课名不应塞进一个文本 op');
  assert.ok(titles.includes(name.slice(0, 9)), '按 9 个 CJK 字符/行拆行');
  assert.ok(titles.includes(name.slice(9, 18)));
  assert.ok(titles.includes(name.slice(18, 27)));
  assert.ok(titles.includes(name.slice(27)));
});
// A'：与 web 的 band 流式分页是架构差异，不逐案比页数；只钉三条产品性质：
// ①不丢卡 ②同一张卡不跨页（页内 y 递增、页与页之间不重复）③页内顺序稳定（重复构建结果一致）。
// 矩阵口径与报告一致：同一日 1..12 张同起始短课名，core 绝对时间网格单页容量 4 张。
test('export-52) 周页分页性质：1..12 张密集卡不丢/不重/页内顺序稳定', () => {
  for (let n = 1; n <= 12; n += 1) {
    const specs = Array.from({ length: n }, (_, index) => ({
      name: 'K' + index, start: '08:30', end: '09:55'
    }));
    const pages = L.buildWeekPages(weekModelOf(specs), 1, pageCopy, 'S');
    const rects = pages.flatMap((page) => cardRects(page));
    assert.equal(rects.length, n, 'n=' + n + ' 卡片矩形总数必须等于课程数，不得丢卡');
    for (const rect of rects) {
      assert.equal(rect.width, L.EXPORT_COLUMN_WIDTH - 16);
      assert.ok(rect.height > 0);
    }
    for (const page of pages) {
      const ys = cardRects(page).map((rect) => rect.y);
      for (let i = 1; i < ys.length; i += 1) assert.ok(ys[i] >= ys[i - 1], '页内卡片顺序必须稳定（y 不倒退）');
    }
    const repeated = L.buildWeekPages(weekModelOf(specs), 1, pageCopy, 'S');
    assert.deepEqual(repeated.map((page) => page.texts), pages.map((page) => page.texts), 'n=' + n + ' 重复构建文本必须一致');
    assert.deepEqual(repeated.map((page) => page.rects), pages.map((page) => page.rects), 'n=' + n + ' 重复构建矩形必须一致');
    for (let i = 0; i < n; i += 1) {
      const title = 'K' + i;
      const occurrences = pages.reduce((sum, page) => sum + page.texts.filter((item) => item.text === title).length, 0);
      assert.equal(occurrences, 1, '课程 ' + title + ' 必须恰好出现一次（不跨页复制、不丢）');
    }
  }
});

// —— B 整学期总览与 web 一致（恒单图 / 阈值与 notice / 页脚 / 标签 / 示例前缀） ——
function overviewModel(rows, weeks, unscheduled) {
  const state = baseState();
  state.snapshot = { ...state.snapshot, weeks, unscheduled: unscheduled || [] };
  return M.buildSemesterModel(state, () => rows);
}

test('export-53) 总览恒单图：28 门高度 >1782 且 ≤4096，400 门高度=4096、notice 出现、课程名全绘制', () => {
  const days = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'];
  const rows28 = [];
  for (let d = 0; d < days.length; d++) {
    for (let i = 0; i < 7; i++) {
      const start = String(8 + i).padStart(2, '0') + ':00';
      const end = String(8 + i).padStart(2, '0') + ':45';
      rows28.push(row(days[d], 'C' + d + '-' + i, start, end));
    }
  }
  const model28 = overviewModel(rows28, 18, []);
  const layout28 = L.selectOverviewLayout(model28, pageCopy, L.defaultMeasure, weekLabelOf);
  const page28 = L.buildOverviewPage(model28, pageCopy, 'S', L.defaultMeasure, weekLabelOf);
  assert.equal(layout28.level, 'full');
  assert.equal(page28.height, layout28.height);
  assert.ok(page28.height > 1782 && page28.height <= 4096, '28 门应升高度但不截断');
  assert.equal(page28.width, 2520);
  for (let d = 0; d < days.length; d++) {
    for (let i = 0; i < 7; i++) {
      assert.ok(page28.texts.some((t) => t.text === 'C' + d + '-' + i), '28 门课程名必须都绘制');
    }
  }
  const rows400 = [];
  for (let i = 0; i < 400; i++) rows400.push(row('2026-09-07', 'X' + i, '08:00', '08:45'));
  const model400 = overviewModel(rows400, 18, []);
  const layout400 = L.selectOverviewLayout(model400, pageCopy, L.defaultMeasure, weekLabelOf);
  const page400 = L.buildOverviewPage(model400, pageCopy, 'S', L.defaultMeasure, weekLabelOf);
  assert.equal(page400.height, 4096);
  assert.equal(layout400.height, 4096);
  assert.ok(layout400.scaleY < 1, '极端情况必须压缩绘制');
  assert.equal(layout400.notice, pageCopy.overviewNotice);
  assert.ok(page400.texts.some((t) => t.text === pageCopy.overviewNotice), 'notice 必须出现在图上');
  assert.ok(page400.texts.some((t) => t.text === pageCopy.overviewFooterEmpty) === false);
  for (let i = 0; i < 400; i++) {
    assert.ok(page400.texts.some((t) => t.text === 'X' + i), '400 门课程名必须都绘制');
  }
});

test('export-54) 总览页脚四种文案与周次图例（web :530-537）', () => {
  const emptyModel = overviewModel([], 18, []);
  const emptyPage = L.buildOverviewPage(emptyModel, pageCopy, 'S', L.defaultMeasure, weekLabelOf);
  assert.equal(emptyPage.height, 1782);
  assert.ok(emptyPage.texts.some((t) => t.text === pageCopy.overviewFooterEmpty));
  const pending3 = [
    { id: 'u1', name: 'U1', teacher: '', room: '', weeks: [5], note: '' },
    { id: 'u2', name: 'U2', teacher: '', room: '', weeks: [6], note: '' },
    { id: 'u3', name: 'U3', teacher: '', room: '', weeks: [7], note: '' }
  ];
  const emptyPending = L.buildOverviewPage(overviewModel([], 18, pending3), pageCopy, 'S', L.defaultMeasure, weekLabelOf);
  assert.ok(emptyPending.texts.some((t) => t.text === 'FOOT-EMPTY-PEND 3'), '空学期+未排课');
  const oneRow = [row('2026-09-07', 'Math', '08:00', '08:45')];
  const withPending = L.buildOverviewPage(overviewModel(oneRow, 18, pending3.slice(0, 2)), pageCopy, 'S', L.defaultMeasure, weekLabelOf);
  assert.ok(withPending.texts.some((t) => t.text === 'FOOT-PEND 2'), '有课+未排课');
  const withCourses = L.buildOverviewPage(overviewModel(oneRow, 18, []), pageCopy, 'S', L.defaultMeasure, weekLabelOf);
  assert.ok(withCourses.texts.some((t) => t.text === 'FOOT-LEGEND|FOOT-WEEKS 18'), '≥8 周带图例 + 第1-N周说明');
  const oneWeek = L.buildOverviewPage(overviewModel(oneRow, 1, []), pageCopy, 'S', L.defaultMeasure, weekLabelOf);
  assert.ok(oneWeek.texts.some((t) => t.text === 'FOOT-WEEKS-ONE'), '1 周用第1周文案');
});

test('export-55) 总览 6 标签顺序 / 周页 5 标签（含调休自日期），与 web :404-412 / :258-262 一致', () => {
  const all = [row('2026-09-07', 'ALL', '08:00', '08:45', {
    customCourse: true, localActivity: true, remapId: 'remap-1', originDate: '2026-09-29', overlap: true, conflict: true
  })];
  const card = overviewModel(all, 18, []).cards[0];
  assert.deepEqual(L.overviewTagsOf(card, pageCopy),
    [pageCopy.tagCustom, pageCopy.tagStudy, pageCopy.weekTagShift, pageCopy.weekTagOverlap, pageCopy.weekTagConflictConfirm]);
  const local = [row('2026-09-07', 'LOCAL', '08:00', '08:45', { source: 'local', remapId: 'r2', originDate: '2026-09-30', overlap: true, conflict: true })];
  const localCard = overviewModel(local, 18, []).cards[0];
  assert.deepEqual(L.overviewTagsOf(localCard, pageCopy),
    [pageCopy.weekTagPersonEdit, pageCopy.weekTagShift, pageCopy.weekTagOverlap, pageCopy.weekTagConflictConfirm]);
  assert.deepEqual(L.weekTagsOf(local[0], pageCopy),
    ['W-SHIFT-FROM 2026-09-30', pageCopy.weekTagPersonEdit, pageCopy.weekTagOverlap, pageCopy.weekTagConflict]);
  assert.deepEqual(L.weekTagsOf(all[0], pageCopy),
    ['W-SHIFT-FROM 2026-09-29', pageCopy.tagCustom, pageCopy.weekTagOverlap, pageCopy.weekTagConflict]);
  const page = L.buildOverviewPage(overviewModel(all, 18, []), pageCopy, 'S', L.defaultMeasure, weekLabelOf);
  const texts = page.texts.map((t) => t.text);
  assert.ok(texts.some((line) => line.includes(pageCopy.tagCustom) && line.includes(pageCopy.tagStudy)), '总览页标签行包含自定义/晚自习');
  assert.ok(texts.some((t) => t.includes(pageCopy.weekTagShift)), '总览页显示调休标签');
  assert.ok(!texts.includes(pageCopy.tagRemap), '总览页不再用旧「已调课」标签');
});

test('export-56) 示例模式只给文件名加「示例-」前缀，不改课程名（web/app.mjs:414）', () => {
  assert.equal(F.buildExportPrefix('江水课表', '示例-', false), '江水课表');
  assert.equal(F.buildExportPrefix('江水课表', '示例-', true), '示例-江水课表');
  assert.equal(F.buildExportPrefix('', '示例-', true), '示例-export');
  const page = L.buildOverviewPage(overviewModel([row('2026-09-07', '示例课程名', '08:00', '08:45')], 18, []),
    pageCopy, 'S', L.defaultMeasure, weekLabelOf);
  assert.ok(page.texts.some((t) => t.text === '示例课程名'), '课程名原样，不加前缀');
});
// —— 每周一页 PDF 页头三段互不重叠 + 整份 PDF 的 n/N 页码 ——
test('export-57) 周页页头：标题/学期/导出时间纵向不重叠，表头首行在页头底之下', () => {
  const page = L.buildWeekPage(weekModelOf([{ name: 'X', start: '08:30', end: '09:55' }]), 1, pageCopy, 'STAMP');
  const find = (text) => page.texts.find((item) => item.text === text);
  const title = find('WEEK 1/1');
  const semester = find('S');
  const stamp = find('AT STAMP');
  const time = find('TIME');
  const weekday = find('W1');
  assert.ok(title && semester && stamp && time && weekday, '页头与表头文字必须都存在');
  assert.equal(title.y, L.PAGE_TITLE_TOP);
  assert.equal(semester.y, L.PAGE_SEMESTER_TOP);
  assert.equal(stamp.y, L.PAGE_STAMP_TOP);
  assert.equal(stamp.size, L.PAGE_STAMP_SIZE);
  assert.equal(time.y, L.PAGE_HEADER_LABEL_TOP);
  assert.equal(weekday.y, L.PAGE_HEADER_LABEL_TOP);
  assert.ok(title.y + title.size <= semester.y - 8, '标题底与学期行至少留 8px');
  assert.ok(semester.y + semester.size <= stamp.y - 8, '学期行底与导出时间至少留 8px');
  assert.ok(stamp.y + stamp.size <= L.PAGE_HEADER_TOP, '导出时间不得进入表头矩形');
  assert.ok(time.y >= L.PAGE_HEADER_TOP + 12, '表头首行必须晚于页头底');
  const headerRects = page.rects.filter((rect) => rect.y === L.PAGE_HEADER_TOP && rect.height === 56);
  assert.equal(headerRects.length, 7, '七个星期表头矩形都从 PAGE_HEADER_TOP 开始');
  assert.ok(page.texts.every((item) => item.text !== 'AT STAMP' || item.y < L.PAGE_HEADER_TOP), '导出时间不再压住表头');
});

test('export-58) 页码：1/1、2/2、34 页用例，右下角且在网格下方', () => {
  assert.equal(L.formatPageNumber(1, 1), '1/1');
  assert.equal(L.formatPageNumber(2, 2), '2/2');
  assert.equal(L.formatPageNumber(34, 34), '34/34');
  assert.equal(L.formatPageNumber(0, 0), '1/1');
  assert.equal(L.formatPageNumber(99, 34), '34/34');
  const make = () => L.buildWeekPage(weekModelOf([{ name: 'X', start: '08:30', end: '09:55' }]), 1, pageCopy, 'S');
  const one = [make()];
  assert.equal(L.appendPageNumbers(one), one);
  const oneNumber = one[0].texts.find((item) => item.text === '1/1');
  assert.ok(oneNumber, '单页 PDF 必须有 1/1');
  assert.equal(oneNumber.y, L.PAGE_NUMBER_TOP);
  assert.equal(oneNumber.size, L.PAGE_NUMBER_SIZE);
  assert.ok(oneNumber.x > L.EXPORT_PAGE_WIDTH / 2, '页码在右下角');
  assert.ok(oneNumber.y >= L.EXPORT_GRID_BOTTOM, '页码在网格下方');
  assert.ok(!one[0].texts.some((item) => item.text === '1/2'), '单页不得出现总页数 2');
  const two = [make(), make()];
  L.appendPageNumbers(two);
  assert.ok(two[0].texts.some((item) => item.text === '1/2'));
  assert.ok(two[1].texts.some((item) => item.text === '2/2'));
  const many = Array.from({ length: 34 }, make);
  L.appendPageNumbers(many);
  assert.ok(many[0].texts.some((item) => item.text === '1/34'));
  assert.ok(many[33].texts.some((item) => item.text === '34/34'));
  assert.ok(many.every((page, index) => page.texts.some((item) => item.text === (index + 1) + '/34')));
});

test('export-59) 页头文字宽度用确定性 measure 校验，单行且不出版心', () => {
  const safeWidth = L.EXPORT_PAGE_WIDTH - L.EXPORT_MARGIN * 2;
  const samples = [
    { text: '第 1 周课表', size: 56 },
    { text: '2026-2027 Fall (demo)', size: 34 },
    { text: '导出时间 2026-10-30 21:31', size: L.PAGE_STAMP_SIZE }
  ];
  for (const sample of samples) {
    const lines = L.wrapTextLines(sample.text, sample.size, safeWidth);
    assert.equal(lines.length, 1, sample.text + ' 必须在版心内单行');
    assert.equal(L.defaultMeasure(sample.text, sample.size, safeWidth), 1);
  }
  assert.ok(L.wrapTextLines('第 1 周课表', 56, 200).length > 1, '测量函数必须能识别超宽' );
});
