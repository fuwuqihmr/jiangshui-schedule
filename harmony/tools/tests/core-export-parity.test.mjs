// 职责：三种导出与 web 金样本的差分校验（parity harness）。
// 金样本：课程根 ../web/timetable-export.mjs、../web/core.mjs、../web/custom-courses.mjs 直接 import 执行。
// 本文件只读 web 源码，不复制 web 逻辑；当前已确认的实差用「known gap」断言钉死，修好后改成 parity 断言。
// 运行：node harmony/tools/run-core-tests.mjs（本文件被收集；HARMONY_ROOT/HARMONY_CORE_TMP 由运行器注入）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
const harmonyRoot = process.env.HARMONY_ROOT;
if (!tmp || !harmonyRoot) throw new Error('HARMONY_CORE_TMP / HARMONY_ROOT 未设置，请用 run-core-tests.mjs 运行');

const load = async (rel) => await import(pathToFileURL(path.join(tmp, rel)).href);
const F = await load('core/export/ExportFiles.ts');
const M = await load('core/export/ExportModel.ts');
const T = await load('core/export/ExportText.ts');
const L = await load('core/export/CanvasLayout.ts');
const P = await load('core/export/PdfPages.ts');
const B = await load('core/export/Backup.ts');
const A = await load('core/types/AppState.ts');

const webRoot = path.resolve(harmonyRoot, '..', 'web');
const web = await import(pathToFileURL(path.join(webRoot, 'timetable-export.mjs')).href);
const wcore = await import(pathToFileURL(path.join(webRoot, 'core.mjs')).href);
const wcustom = await import(pathToFileURL(path.join(webRoot, 'custom-courses.mjs')).href);

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const rulesCopy = {
  title: '江水课表 · 纯文本课表规则', generatedAt: '导出时间 {0}', semester: '学期 {0}', weekdays: WEEKDAYS,
  nameLabel: '课程名', teacherLabel: '教师', roomLabel: '教室', timeLabel: '上课时间', weeksLabel: '周次',
  studyLabel: '晚自习', customLabel: '自定义', unscheduledTitle: '未排时间的课程', emptyNote: '本学期没有可导出的课程',
  timeRange: '{0}-{1}', weekRange: '第{0}-{1}周', weekSingle: '第{0}周', weekAll: '全学期',
  weekOdd: '单周', weekEven: '双周', fieldSeparator: '\t', listSeparator: '、', commentPrefix: '#', lineBreak: '\n',
  // ——：web buildRulesText 逐字文案 ——
  webTitle: '# 江水课表 · 纯文本课表规则',
  semesterLine: '学期：{0}', teachingWeeks: '教学周：{0}（{1} 至 {2}）',
  weekSpan: '第{0}-{1}周', weekOne: '第{0}周',
  generatedLine: '导出时间：{0}（Asia/Shanghai）', sourceLine: '来源：{0}', sourceNote: '（非学校教务来源）',
  notesLine: '说明：按当前最终生效课表导出，包含调休、自定义课程和晚自习；不包含账号、密码或登录凭据。',
  formatLine: '格式：课程名<Tab>教师<Tab>教室<Tab>上课时间；多段以 ; 分隔；周次写作 {第7-15周}(全部|单周|双周)',
  courseName: '课程名', classTime: '上课时间', emptyLine: '本学期没有可导出的课程',
  period: '第{0}节', periodJoin: '、', segmentSpan: '{0}–{1}', noteLabel: '说明',
  unknownWeeks: '待确认', unscheduledNote: '学校仅提供周次，具体上课时间待通知',
  conflictLine: '注意：有 {0} 处来源冲突，按当前显示版本导出，请向学校确认。',
  patternAll: '全部', sourceSchool: '学校教务系统', sourceSample: '交接样例',
  normalizeOpen: '（', normalizeClose: '）', normalizeComma: '，', normalizeDash: '－–—~～至',
  ordinalPrefix: '第', weekSuffix: '周', weekdayPrefix: '周', unnamed: '未命名课程'
};
const pageCopy = {
  weekTitle: '第 {0} 周课表', semesterTitle: '整学期课表', timeColumn: '节次', weekdays: WEEKDAYS,
  stampLabel: '导出时间 {0}', emptyNote: '本页暂无课程', overflowNote: '课程过多，已压缩字号',
  cardTime: '{0}-{1}', cardRoom: '教室 {0}', cardTeacher: '教师 {0}',
  tagRemap: '已调课', tagOverride: '已修改', tagCustom: '自定义', tagStudy: '晚自习',
  tagOverlap: '重叠', tagConflict: '冲突', continuation: '续页 {0}/{1}',
  unscheduledTitle: '未排时间的课程', unscheduledItem: '{0} · 周次：{1}', unscheduledMeta: '地点：{0} · 老师：{1}',
  overviewTitle: 'OVERVIEW-TITLE', overviewSubtitleRange: 'SUB {0}-{1}', overviewSubtitleOne: 'SUB-ONE {0}',
  overviewNote: 'NOTE', overviewTimeColumn: 'SLOT', weeksPrefix: 'WEEKS {0}', overviewTimeRange: '{0}~{1}',
  placePrefix: 'PLACE {0}', roomUnknown: 'ROOM-UNKNOWN', teacherPrefix: 'TEA {0}', teacherNone: 'TEA-NONE', teacherUnknown: 'TEA-UNKNOWN',
  overviewFooterEmpty: 'FOOT-EMPTY', overviewFooterEmptyPending: 'FOOT-EMPTY-PEND {0}', overviewFooterPending: 'FOOT-PEND {0}',
  overviewFooterWeeks: 'FOOT-WEEKS {0}', overviewFooterWeeksOne: 'FOOT-WEEKS-ONE', overviewFooterLegend: 'FOOT-LEGEND|',
  overviewRight: 'FOOT-RIGHT', overviewNotice: 'OVERVIEW-NOTICE',
  weekTagShift: 'W-SHIFT', weekTagShiftFrom: 'W-SHIFT-FROM {0}', weekTagPersonEdit: 'W-EDIT', weekTagOverlap: 'W-OVERLAP',
  weekTagConflict: 'W-CONFLICT', weekTagConflictConfirm: 'W-CONFLICT-CONFIRM'
};

const weekLabelOf = (weeks, total) => 'W' + weeks.join('/') + '#' + total;
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(webRoot, 'data', name), 'utf8'));
const webStateOf = (snapshot) => wcore.createState(structuredClone(snapshot));
const baseline = () => webStateOf(fixture('baseline.json'));
const adjusted = () => webStateOf(fixture('adjusted.json'));
function customState() {
  const state = baseline();
  state.customCourses = [{
    id: 'custom-parity-1', mode: 'weekly', name: '社团活动', room: '活动室', teacher: '李老师',
    startTime: '19:00', endTime: '20:00', semesterId: state.snapshot.semester.id,
    semesterStartDate: state.snapshot.semester.startDate, startWeek: 2, endWeek: 6,
    weekPattern: 'odd', weekdays: [3]
  }];
  return state;
}

// web 的 AppState.snapshot.semester 与鸿蒙 SemesterSnapshot 是两种扁平结构：这里只做字段映射，不改语义。
function harmonyStateOf(state) {
  const base = A.createDefaultState();
  const sem = state.snapshot.semester;
  return {
    ...base,
    // web 基线规则是扁平 web 形状（weekday/periods，无 cancelled/source），补成鸿蒙 CourseRule 的必填字段后才能通过严格备份校验。
    snapshot: {
      ...state.snapshot, id: sem.id, name: sem.name, startDate: sem.startDate, weeks: sem.weeks,
      unscheduled: (state.snapshot.unscheduled || []).map((item, index) => ({
        id: item.id || 'unscheduled-' + index,
        name: item.name || '',
        teacher: item.teacher || '',
        room: item.room || '',
        weeks: Array.isArray(item.weeks) ? item.weeks : [],
        note: typeof item.weeks === 'string' ? item.weeks : (item.note || '')
      })),
      rules: (state.snapshot.rules || []).map((rule) => {
        const periods = rule.periods || [];
        return {
          ...rule,
          dayOfWeek: rule.dayOfWeek ?? rule.weekday,
          startPeriod: rule.startPeriod ?? (periods.length ? periods[0] : 1),
          endPeriod: rule.endPeriod ?? (periods.length ? periods[periods.length - 1] : 2),
          cancelled: rule.cancelled === true,
          source: rule.source || 'school'
        };
      })
    },
    events: state.events || [], changeRecords: state.changeRecords || [],
    overrides: state.overrides || [], localMaps: state.localMaps || [],
    holidaySettings: state.holidaySettings || base.holidaySettings,
    courseSettings: { ...base.courseSettings, ...(state.courseSettings || {}) },
    customCourses: state.customCourses || [],
    theme: state.theme || base.theme, showDayOverview: !!state.showDayOverview,
    settingsExpanded: state.settingsExpanded || base.settingsExpanded,
    calendarOptions: state.calendarOptions || base.calendarOptions,
    notificationEnabled: !!state.notificationEnabled, autoCheckEnabled: !!state.autoCheckEnabled,
    lastSuccess: state.lastSuccess ?? 0, lastAttempt: state.lastAttempt ?? 0, error: state.error ?? null
  };
}
const resolveOf = (state) => (date) => wcore.timetableDay(
  state.snapshot, date, state.overrides || [], state.localMaps || [],
  state.courseSettings || {}, state.customCourses || [], state.holidaySettings || null
);
const coreModelOf = (state) => M.buildSemesterModel(harmonyStateOf(state), resolveOf(state));

const normCard = (card) => ({
  name: card.name ?? '', teacher: card.teacher ?? '', room: card.room ?? '',
  weekday: card.weekday, startTime: card.startTime, endTime: card.endTime,
  weeks: [...(card.weeks || [])].sort((a, b) => a - b)
});
const byJson = (a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
function webRuleCards(state) {
  const model = web.buildRulesModel(state);
  const cards = [];
  for (const course of model.courses) {
    for (const segment of course.segments) {
      cards.push(normCard({ ...segment, name: course.name, teacher: course.teacher }));
    }
  }
  return cards.sort(byJson);
}
function webOverviewCards(state) {
  return web.buildSemesterOverviewModel(state).days.flatMap((day) => day.courses).map(normCard).sort(byJson);
}
const coreCards = (model) => model.cards.map(normCard).sort(byJson);

const startDate = baseline().snapshot.semester.startDate;

test('export-parity-1) fixture 基线：web 课次 / 卡片数与鸿蒙入口模型同源', () => {
  const state = baseline();
  const webModel = web.buildRulesModel(state);
  const core = coreModelOf(state);
  assert.equal(web.semesterOccurrences(state).length, core.entries.length);
  assert.equal(webModel.courses.reduce((sum, course) => sum + course.segments.length, 0), core.cards.length);
  assert.ok(core.entries.length > 0);
  assert.equal(core.totalWeeks, state.snapshot.semester.weeks);
});

test('export-parity-2) baseline 卡片集合：课程/教师/教室/星期/起止/周次逐项一致', () => {
  const state = baseline();
  assert.deepEqual(coreCards(coreModelOf(state)), webRuleCards(state));
});

test('export-parity-3) adjusted（停课日 + 4 条调休 append）：卡片集合同样一致', () => {
  const state = adjusted();
  const core = coreModelOf(state);
  assert.deepEqual(coreCards(core), webRuleCards(state));
  const dates = new Set(core.entries.map((entry) => entry.date));
  assert.ok(dates.has('2026-10-10'), '调休目标日 2026-10-10 应出现在鸿蒙入口模型');
  assert.ok(!dates.has('2026-09-29'), '停课日 2026-09-29 不应出现课程');
  assert.ok(web.semesterOccurrences(state).some((row) => row.date === '2026-10-10'));
});

test('export-parity-4) 自定义课程（每周单周）：两边都进入最终课表且卡片一致', () => {
  const state = customState();
  const webCards = webRuleCards(state);
  const core = coreModelOf(state);
  assert.deepEqual(coreCards(core), webCards);
  const card = core.cards.find((item) => item.name === '社团活动');
  assert.ok(card, '鸿蒙入口模型应包含自定义课程');
  assert.equal(card.custom, true);
  assert.deepEqual(card.weeks, [3, 5]);
  const webCard = web.buildSemesterOverviewModel(state).days.flatMap((day) => day.courses)
    .find((item) => item.name === '社团活动');
  assert.equal(webCard.customCourse, true);
});

// web 的周次压缩规则（以 web/timetable-export.mjs:48-67 与 lead 给出的 7 组金样本为准）。
const weekGold = [
  { weeks: [3], total: 8, text: '第3周', pattern: '全部' },
  { weeks: [7, 9], total: 10, text: '第7、9周', pattern: '全部' },
  { weeks: [1, 3, 5], total: 10, text: '第1-5周', pattern: '单周' },
  { weeks: [2, 4, 6], total: 10, text: '第2-6周', pattern: '双周' },
  { weeks: [7, 9, 11], total: 12, text: '第7-11周', pattern: '单周' },
  { weeks: [2, 5], total: 10, text: '第2、5周', pattern: '全部' },
  { weeks: [], total: 10, text: '', pattern: '全部' }
];
const corePatternName = (pattern) => ({
  all: '全部', odd: '单周', even: '双周', single: '全部', range: '全部', list: '全部', none: ''
}[pattern] ?? pattern);

test('export-parity-5) web 周次金样本先自我验证（7 组逐字）', () => {
  for (const row of weekGold) {
    const parts = web.formatWeekParts(row.weeks, row.total);
    assert.equal(parts.text, row.text, JSON.stringify(row.weeks));
    assert.equal(parts.pattern, row.pattern, JSON.stringify(row.weeks));
  }
});

for (const row of weekGold) {
  test('export-parity-6) 周次 ' + JSON.stringify(row.weeks) + ' -> web「' + row.text + '(' + row.pattern + ')」逐字一致', () => {
    const core = T.formatWeekSpec(row.weeks, row.total, rulesCopy);
    assert.equal(core.text, web.formatWeekSpec(row.weeks, row.total));
    assert.equal(core.pattern, web.formatWeekParts(row.weeks, row.total).pattern);
  });
}

test('export-parity-7) 规则 TXT 结构：8 行头/4 列/按课程合并/末尾换行与 web 逐行一致', () => {
  const state = baseline();
  const webText = web.buildRulesText(state);
  const core = coreModelOf(state);
  const coreText = T.buildRulesText(core, rulesCopy, '2026-10-30 16:48');
  const webLines = webText.trimEnd().split('\n');
  const coreLines = coreText.trimEnd().split('\n');
  assert.equal(coreLines[0], webLines[0], '首行标题');
  const webHeaderIndex = webLines.findIndex((line) => !line.startsWith('#') && line.includes('\t'));
  const coreHeaderIndex = coreLines.findIndex((line) => !line.startsWith('#') && line.includes('\t'));
  assert.equal(webHeaderIndex, 7);
  assert.equal(coreHeaderIndex, 7);
  for (let i = 0; i <= 7; i++) {
    if (i === 3) continue; // 导出时间取当前时钟，无法逐字比较
    assert.equal(coreLines[i], webLines[i], '第 ' + (i + 1) + ' 行');
  }
  assert.equal(coreLines[7].split('\t').length, 4);
  assert.equal(webLines[7].split('\t').length, 4);
  const webUnscheduledAt = webLines.indexOf('# 未排时间的课程');
  const coreUnscheduledAt = coreLines.indexOf('# 未排时间的课程');
  assert.ok(webUnscheduledAt > 7 && coreUnscheduledAt > 7);
  assert.deepEqual(coreLines.slice(8, coreUnscheduledAt), webLines.slice(8, webUnscheduledAt), '课程行逐行一致（每课一行、多段分号合并）');
  assert.equal(coreLines.slice(8, coreUnscheduledAt).filter((line) => line.length > 0).length, web.buildRulesModel(state).courses.length);
  assert.ok(webText.endsWith('\n'), 'web 末尾有换行');
  assert.ok(coreText.endsWith('\n'), '鸿蒙末尾同样有换行');
});

test('export-parity-8) 规则 TXT 字段语义：课程/教师/教室/段文本两边一致', () => {
  const state = baseline();
  const webModel = web.buildRulesModel(state);
  const coreRows = T.buildRulesModel(coreModelOf(state), rulesCopy);
  assert.equal(coreRows.length, webModel.courses.length, '两边都按课程合并成一行');
  const webTriples = webModel.courses.map((course) => [course.name ?? '', course.teacher ?? '', course.rooms.join(';')].join('\t')).sort();
  const coreTriples = coreRows.map((row) => [row.name ?? '', row.teacher ?? '', row.rooms.join(';')].join('\t')).sort();
  assert.deepEqual(coreTriples, webTriples);
  for (let i = 0; i < webModel.courses.length; i++) {
    const webSegments = webModel.courses[i].segments.map((segment) => {
      const week = web.formatWeekParts(segment.weeks, webModel.totalWeeks);
      const periods = segment.periods.length ? '第' + segment.periods.join('、') + '节' : segment.startTime + '–' + segment.endTime;
      return '周' + WEEKDAYS[segment.weekday - 1].slice(1) + periods + '{' + week.text + '}(' + week.pattern + ')';
    });
    const coreSegments = coreRows[i].segments.map((segment) => {
      const periods = segment.periods.length ? '第' + segment.periods.join('、') + '节' : segment.startTime + '–' + segment.endTime;
      return WEEKDAYS[segment.weekday - 1] + periods + '{' + segment.week.text + '}(' + segment.week.pattern + ')';
    });
    assert.deepEqual(coreSegments, webSegments, '第 ' + i + ' 门课的段文本');
  }
});

test('export-parity-9) 规则 TXT 周次括注：单双周压缩与 web 一致', () => {
  const state = baseline();
  const webModel = web.buildRulesModel(state);
  const webSegment = webModel.courses.flatMap((course) => course.segments)
    .find((segment) => segment.weeks.length >= 3 && segment.weeks.every((week) => week % 2 === 1));
  assert.ok(webSegment, 'fixture 应包含连续单周课程');
  const spec = web.formatWeekParts(webSegment.weeks, state.snapshot.semester.weeks);
  const coreSpec = T.formatWeekSpec(webSegment.weeks, state.snapshot.semester.weeks, rulesCopy);
  assert.equal(spec.pattern, '单周');
  assert.equal(coreSpec.text, web.formatWeekSpec(webSegment.weeks, state.snapshot.semester.weeks));
  assert.equal(coreSpec.pattern, spec.pattern);
  const coreText = T.buildRulesText(coreModelOf(state), rulesCopy, '2026-10-30 16:48');
  assert.ok(coreText.includes('{' + spec.text + '}(' + spec.pattern + ')'), '正文段应带 web 的 {周次}(模式) 括注');
});

test('export-parity-10) 未排课课程：5 列结构一致；字符串周次是 web 独有容错（鸿蒙类型为 number[]）', () => {
  const state = baseline();
  const webModel = web.buildRulesModel(state);
  const core = coreModelOf(state);
  const coreText = T.buildRulesText(core, rulesCopy, '2026-10-30 16:48');
  assert.equal(webModel.unscheduled.length, core.snapshot.unscheduled.length);
  const coreLines = coreText.trimEnd().split('\n');
  const at = coreLines.indexOf('# 未排时间的课程');
  assert.ok(at > 0);
  const section = coreLines.slice(at + 1);
  for (const line of section) assert.equal(line.split('\t').length, 5, '未排课 5 列（课程名/教师/教室/周次/说明）');
  assert.ok(webModel.unscheduled.every((item) => item.weeksText && item.note));
  assert.equal(section[0], ['课程名', '教师', '教室', '周次', '说明'].join('\t'));
  // 数字周次（鸿蒙 SemesterSnapshot.unscheduled.weeks 的真实类型）逐字对齐 web。
  const numeric = Array.from({ length: 14 }, (_, i) => i + 5);
  assert.equal(T.unscheduledWeeksText(numeric, 18, rulesCopy), web.unscheduledWeeksText(numeric, 18));
  assert.equal(T.unscheduledWeeksText([], 18, rulesCopy), '待确认');
  // web fixture 里 unscheduled.weeks 是字符串（'5—18 周'），鸿蒙 core 类型是 number[]：
  // 字符串输入不做 web 的宽松归一化，回退「待确认」。这是类型契约差异，不是本次七项的范围。
  for (const item of core.snapshot.unscheduled) {
    const spec = T.formatWeekSpec(item.weeks, core.totalWeeks, rulesCopy);
    assert.equal(spec.text, '');
    assert.equal(T.unscheduledWeeksText(item.weeks, core.totalWeeks, rulesCopy), '待确认');
  }
  assert.ok(webModel.unscheduled.some((item) => item.weeksText === '待确认') === false);
});

test('export-parity-11) 文件名：三种格式与 web 同口径「江水课表-<种类>-<startDate>.<ext>」', async () => {
  const state = baseline();
  const result = await web.createTimetableExport(state, { kind: 'rules-text', yieldPage: async () => {} });
  assert.equal(result.filename, '江水课表-整学期规则-' + startDate + '.txt');
  assert.equal(result.mime, 'text/plain');
  assert.equal(result.pages, 1);
  const rulesName = F.buildWebExportFileName({ prefix: '江水课表', label: '整学期规则', startDate, kind: 'rules-text' });
  assert.equal(rulesName, result.filename);
  assert.equal(F.buildWebExportFileName({ prefix: '江水课表', label: '整学期总览', startDate, kind: 'semester-overview' }),
    '江水课表-整学期总览-' + startDate + '.png');
  assert.equal(F.buildWebExportFileName({ prefix: '江水课表', label: '整个学期', startDate, kind: 'semester-pages' }),
    '江水课表-整个学期-' + startDate + '.pdf');
  assert.equal(F.exportFileSpec('rules-text').mime, 'text/plain');
  assert.equal(F.exportFileSpec('semester-overview').mime, 'image/png');
  assert.equal(F.exportFileSpec('semester-pages').mime, 'application/pdf');
  assert.equal(F.exportFileSpec('semester-overview').extension, 'png');
  assert.equal(F.exportFileSpec('semester-pages').extension, 'pdf');
});

// PDF 结构解析：只按 PDF 语法取对象，不依赖对象编号顺序（web 与鸿蒙顺序不同但都应自洽）。
function parsePdf(bytes) {
  const buf = Buffer.from(bytes);
  const text = buf.toString('latin1');
  assert.equal(text.slice(0, 8), '%PDF-1.4');
  const tail = text.match(/startxref\n(\d+)\n%%EOF\n?$/);
  assert.ok(tail, '应以 startxref/%%EOF 收尾');
  const xrefOffset = Number(tail[1]);
  assert.equal(text.slice(xrefOffset, xrefOffset + 4), 'xref');
  const xref = text.slice(xrefOffset);
  const lines = xref.split('\n');
  const count = Number(lines[1].split(' ')[1]);
  assert.match(lines[2], /^0{10} 65535 f $/, 'xref 首项应为 free 项');
  const offsets = [];
  for (let i = 3; i < lines.length && lines[i].endsWith(' n '); i++) {
    const match = lines[i].match(/^(\d{10}) 00000 n $/);
    assert.ok(match, 'xref 行格式: ' + lines[i]);
    offsets.push(Number(match[1]));
  }
  assert.equal(offsets.length, count - 1);
  for (let id = 1; id < count; id++) {
    assert.ok(text.startsWith(id + ' 0 obj\n', offsets[id - 1]), 'xref 偏移应指向对象 ' + id);
  }
  const pages = (text.match(/\/Type \/Page(?!s)/g) || []).length;
  const images = (text.match(/\/Subtype \/Image/g) || []).length;
  const media = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(media, '存在 MediaBox');
  return { buf, text, count, pages, images, mediaBox: [Number(media[1]), Number(media[2])] };
}

const jpeg1 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const jpeg2 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 0xff, 0xd9]);

test('export-parity-12) 每周 PDF：页数/图像数/JPEG 字节/尺寸/xref 两边语义一致', () => {
  const webPages = [
    { width: 2520, height: 1782, bytes: jpeg1 },
    { width: 2520, height: 1782, bytes: jpeg2 }
  ];
  const corePages = [
    P.makePdfPageInput(jpeg1, 2520, 1782),
    P.makePdfPageInput(jpeg2, 2520, 1782)
  ];
  const webPdf = parsePdf(web.imagePagesPdf(webPages));
  const corePdf = parsePdf(P.buildImagePdf(corePages));
  for (const pdf of [webPdf, corePdf]) {
    assert.equal(pdf.pages, 2);
    assert.equal(pdf.images, 2);
    assert.ok(pdf.buf.includes(Buffer.from(jpeg1)));
    assert.ok(pdf.buf.includes(Buffer.from(jpeg2)));
    assert.match(pdf.text, /\/Filter \/DCTDecode/);
    assert.match(pdf.text, /\/ColorSpace \/DeviceRGB/);
    assert.match(pdf.text, /\/BitsPerComponent 8/);
    assert.match(pdf.text, /\/Width 2520 \/Height 1782/);
  }
  // MediaBox 与 web 逐字一致（841.89x595.28），内容矩阵同尺寸缩放。
  assert.deepEqual(webPdf.mediaBox, [841.89, 595.28]);
  assert.deepEqual(corePdf.mediaBox, webPdf.mediaBox);
  const mediaOf = (text) => (text.match(/\/MediaBox \[0 0 [\d.]+ [\d.]+\]/) || [''])[0];
  assert.equal(mediaOf(webPdf.text), '/MediaBox [0 0 841.89 595.28]');
  assert.equal(mediaOf(corePdf.text), mediaOf(webPdf.text));
  const scaleOf = (text) => {
    const match = text.match(/([\d.]+) 0 0 ([\d.]+) 0 0 cm\s+\/Im0 Do/);
    return match ? [Number(match[1]), Number(match[2])] : null;
  };
  const webScale = scaleOf(webPdf.text);
  const coreScale = scaleOf(corePdf.text);
  assert.deepEqual(webScale, [841.89, 595.28]);
  assert.deepEqual(coreScale, webScale);
});

test('export-parity-13) 空 PDF：web 抛错、鸿蒙返回 EXPORT_PAGES_EMPTY，语义都是拒绝', () => {
  assert.throws(() => web.imagePagesPdf([]), /没有可导出的课表/);
  const check = P.validatePdfPages([]);
  assert.equal(check.ok, false);
  assert.equal(check.code, 'EXPORT_PAGES_EMPTY');
  assert.throws(() => P.buildImagePdf([]));
});

test('export-parity-14) 总览模型：卡片集合与每周天数一致；页面固定 2520 宽、高度 1782..4096', () => {
  for (const make of [baseline, adjusted, customState]) {
    const state = make();
    const core = coreModelOf(state);
    assert.deepEqual(coreCards(core).map((card) => [card.name, card.weekday, card.startTime, card.endTime, card.weeks.join(',')]),
      webOverviewCards(state).map((card) => [card.name, card.weekday, card.startTime, card.endTime, card.weeks.join(',')]));
    const webDays = web.buildSemesterOverviewModel(state).days.map((day) => day.courses.length);
    const coreDays = [1, 2, 3, 4, 5, 6, 7].map((weekday) => core.cards.filter((card) => card.weekday === weekday).length);
    assert.deepEqual(coreDays, webDays);
  }
  const state = baseline();
  const page = L.buildOverviewPage(coreModelOf(state), pageCopy, '2026-10-30 16:48', L.defaultMeasure, weekLabelOf);
  assert.equal(page.width, web.PAGE_WIDTH);
  assert.ok(page.height >= web.PAGE_HEIGHT && page.height <= L.OVERVIEW_HARD_MAX);
  assert.equal(L.EXPORT_PAGE_WIDTH, web.PAGE_WIDTH);
  assert.equal(L.EXPORT_PAGE_HEIGHT, web.PAGE_HEIGHT);
});

test('export-parity-15) 总览/每周页：教师行与调休/自定义/冲突标签已进入页面模型', () => {
  const canvasSource = fs.readFileSync(path.join(harmonyRoot, 'entry/src/main/ets/core/export/CanvasLayout.ets'), 'utf8');
  assert.ok(canvasSource.includes('cardTeacher'), '周页/总览页渲染教师行');
  for (const field of ['weekTagShift', 'weekTagShiftFrom', 'weekTagPersonEdit', 'weekTagOverlap', 'weekTagConflict', 'weekTagConflictConfirm']) {
    assert.ok(canvasSource.includes(field), '总览标签缺少 ' + field);
  }
  for (const field of ['tagCustom', 'tagStudy']) {
    assert.ok(canvasSource.includes(field), '总览标签缺少 ' + field);
  }
  const adjustedState = adjusted();
  const webCards = web.buildSemesterOverviewModel(adjustedState).days.flatMap((day) => day.courses);
  assert.ok(webCards.some((card) => card.remap), 'adjusted fixture 应产生调休标记');
  const coreCardsNow = coreModelOf(adjustedState).cards;
  assert.ok(coreCardsNow.some((card) => card.remap), '鸿蒙卡片应带 remap 字段');
  const page = L.buildOverviewPage(coreModelOf(adjustedState), pageCopy, '2026-10-30 16:48', L.defaultMeasure, weekLabelOf);
  const texts = page.texts.map((item) => item.text);
  assert.ok(texts.includes(pageCopy.weekTagShift), '总览页应出现「调休」标签（web :404-412）');
  assert.ok(!texts.includes(pageCopy.tagRemap), '总览页不再用旧「已调课」标签');
  const customPage = L.buildOverviewPage(coreModelOf(customState()), pageCopy, '2026-10-30 16:48', L.defaultMeasure, weekLabelOf);
  assert.ok(customPage.texts.some((item) => item.text === pageCopy.tagCustom), '自定义课程页应出现标签');
});

test('export-parity-16) 备份互通：web 课表快照显式拒绝（LEGACY），鸿蒙信封可往返', () => {
  const state = baseline();
  const webBackup = wcustom.customCourseBackup(state);
  assert.ok(Object.hasOwn(webBackup, 'schemaVersion'));
  assert.ok(!Object.hasOwn(webBackup, 'version'));
  assert.ok(!Object.hasOwn(webBackup, 'state'));
  const parsed = B.parseBackupJson(JSON.stringify(webBackup));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.state, null);
  // 选定「不互通」：web 快照只有学期 + 自定义课程，缺 events/调休/设置，静默导入会覆盖好数据。
  assert.equal(parsed.code, B.CODE_BACKUP_LEGACY);
  const coreBackup = JSON.parse(B.buildBackupJson(harmonyStateOf(state), Date.UTC(2026, 9, 30, 8, 48), '1.3.1'));
  assert.equal(coreBackup.format, B.BACKUP_FORMAT);
  assert.equal(coreBackup.version, B.BACKUP_VERSION);
  assert.ok(Object.hasOwn(coreBackup, 'state'));
  assert.ok(!Object.hasOwn(coreBackup, 'schemaVersion'));
  const roundTrip = B.parseBackupJson(JSON.stringify(coreBackup));
  assert.equal(roundTrip.ok, true);
  assert.ok(roundTrip.state);
});

// 三种分页边界（正好占满一页 / +1 跨页 / 长课名换行）页数必须与 web 分页算法一致。
// 用确定性假 measure（每字符 28px）驱动 web 的 canvas 分页，避免依赖真实字体。
function fakeMeasureCanvas() {
  const ctx = {
    font: '',
    measureText: (value) => ({ width: [...String(value)].length * 28 }),
    fillRect() {}, strokeRect() {}, fillText() {}
  };
  return { width: 0, height: 0, getContext: () => ctx };
}
function webWeekModelOf(specs) {
  const dates = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];
  return {
    week: 1,
    semester: { name: 'S', startDate: '2026-09-07', weeks: 1 },
    days: dates.map((date, index) => ({
      date,
      courses: specs.filter((spec) => (spec.weekday || 1) === index + 1).map((spec) => ({
        name: spec.name, teacher: spec.teacher, room: spec.room,
        startTime: spec.startTime, endTime: spec.endTime,
        periods: [], weeks: [1], weekday: spec.weekday || 1
      }))
    })),
    unscheduled: []
  };
}
function coreWeekModelOf(specs) {
  const entries = specs.map((spec, index) => ({
    week: 1,
    weekday: spec.weekday || 1,
    date: '2026-09-07',
    row: {
      key: 'boundary-' + index,
      name: spec.name, teacher: spec.teacher, room: spec.room,
      startTime: spec.startTime, endTime: spec.endTime,
      weeks: [1], source: 'school', cancelled: false, vacant: false,
      custom: false, study: false, remap: false, override: false, conflict: false, overlap: false
    }
  }));
  return { snapshot: { name: 'S', startDate: '2026-09-07' }, totalWeeks: 1, entries, cards: [], columnCounts: [] };
}
function boundaryPagesOf(specs) {
  const webPages = web.renderWeekPages(webWeekModelOf(specs), () => fakeMeasureCanvas());
  const corePages = L.buildWeekPages(coreWeekModelOf(specs), 1, pageCopy, '2026-09-07');
  return { webPages, corePages };
}
const fullDay = (name) => ({ name, teacher: 'T', room: 'R', startTime: '00:00', endTime: '24:00' });
const longName = '超长课名'.repeat(8);
const boundaryCases = [
  { label: '课程正好占满一页', specs: [fullDay('Full')], pages: 1 },
  { label: '+1 课程跨页', specs: [fullDay('Full'), fullDay('Next')], pages: 2 },
  { label: '长课名换行', specs: [1, 2, 3].map(() => ({ name: longName, teacher: 'T', room: 'R', startTime: '08:30', endTime: '09:55' })), pages: 2 }
];
for (const boundary of boundaryCases) {
  test('export-parity-17) 分页边界「' + boundary.label + '」：页数与 web 算法一致', () => {
    const { webPages, corePages } = boundaryPagesOf(boundary.specs);
    assert.equal(webPages.length, boundary.pages, 'web 金样本页数');
    assert.equal(corePages.length, webPages.length, '鸿蒙页数应等于 web');
    const cardRects = corePages.reduce((sum, page) => sum + page.rects.filter((rect) => Math.round(rect.width) === Math.round(L.EXPORT_COLUMN_WIDTH - 16)).length, 0);
    assert.equal(cardRects, boundary.specs.length, '分页不得丢卡');
    if (boundary.specs.length === 1) {
      const rect = corePages[0].rects.find((item) => Math.round(item.width) === Math.round(L.EXPORT_COLUMN_WIDTH - 16));
      assert.equal(rect.y + rect.height, L.EXPORT_GRID_BOTTOM - 4, '单卡应正好占满到网格底部（余量 4px）');
    }
  });
}