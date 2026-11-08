// 职责：三种导出格式里的「纯文本规则（TXT）」模型与文本拼装，逐字对齐 web/timetable-export.mjs
// buildRulesModel/buildRulesText/formatWeekParts/formatWeekSpec/unscheduledWeeksText。
// 依赖方向：只 import type 同层 copy/model；零运行时 import（run-core-tests 纯度门禁要求）。
//          表头、周次、分隔符全部由 ExportCopy 注入，core 内不出现中文字面量。
// 阶段：P5 导出与备份；model 由调用方用 ExportModel.buildSemesterModel 生成后传入。
// 待确认：输出为 UTF-8、Tab 分列、每门课一行、多段以分号合并，末尾带一个换行（与 web 一致）。

import type { RulesTextCopy } from './ExportCopy';
import type { SemesterCard, SemesterModel } from './ExportModel';

export interface WeekSpec {
  text: string;
  pattern: string;
}

export interface RulesSegment {
  weekday: number;
  periods: number[];
  startTime: string;
  endTime: string;
  room: string;
  week: WeekSpec;
}

export interface RulesCourse {
  name: string;
  teacher: string;
  rooms: string[];
  segments: RulesSegment[];
}

export interface RulesUnscheduled {
  name: string;
  teacher: string;
  room: string;
  weeksText: string;
  note: string;
}

// 预览行：每门课一行，保持与 TXT 行的列顺序一致（课程名/教师/教室/上课时间）。
export interface RulesTextRow {
  name: string;
  teacher: string;
  room: string;
  time: string;
  weeks: string;
}

export const WEEK_PATTERN_ALL: string = 'all';
export const WEEK_PATTERN_ODD: string = 'odd';
export const WEEK_PATTERN_EVEN: string = 'even';
export const WEEK_PATTERN_SINGLE: string = 'single';
export const WEEK_PATTERN_RANGE: string = 'range';
export const WEEK_PATTERN_LIST: string = 'list';
export const WEEK_PATTERN_NONE: string = 'none';

export const MAX_FIELD_LENGTH: number = 200;
export const UNNAMED_FALLBACK: string = '\u2014';

// 与 web/jsxsd.mjs PERIOD_TIMES 同一份作息表（core 不能运行时 import core/parser，故内联）。
const PERIOD_STARTS: string[] = ['08:30', '09:15', '10:15', '11:00', '14:00', '14:45', '15:45', '16:30', '19:00', '19:45', '20:30'];
const PERIOD_ENDS: string[] = ['09:10', '09:55', '10:55', '11:40', '14:40', '15:25', '16:25', '17:10', '19:40', '20:25', '21:10'];

// 顺序替换 {0}/{1}；缺失的占位符保留原样，便于测试定位文案缺参。
export function fillPattern(pattern: string, values: string[]): string {
  let out: string = typeof pattern === 'string' ? pattern : '';
  for (let i = 0; i < values.length; i++) {
    out = out.split('{' + String(i) + '}').join(values[i]);
  }
  return out;
}

function minuteOf(value: string): number {
  if (typeof value !== 'string' || value.length < 4) {
    return -1;
  }
  const hour: number = Number(value.slice(0, 2));
  const minute: number = Number(value.slice(3, 5));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return -1;
  }
  return hour * 60 + minute;
}

// 与 web occurrencePeriods 同口径：按作息表由起止时间反推节次，越界回退空数组。
export function occurrencePeriods(startTime: string, endTime: string): number[] {
  const start: number = minuteOf(startTime);
  const end: number = minuteOf(endTime);
  const periods: number[] = [];
  if (start < 0 || end < 0) {
    return periods;
  }
  let first: number = -1;
  let last: number = -1;
  for (let i = 0; i < PERIOD_STARTS.length; i++) {
    if (first < 0 && minuteOf(PERIOD_ENDS[i]) > start) {
      first = i + 1;
    }
    if (minuteOf(PERIOD_STARTS[i]) < end) {
      last = i + 1;
    }
  }
  if (first < 0 || last < first) {
    return periods;
  }
  for (let period = first; period <= last; period++) {
    periods.push(period);
  }
  return periods;
}

// web cleanField：Tab/CR/LF 折叠为空格、trim、限长 200；空值用 fallback。
export function cleanField(value: string, fallback: string): string {
  const source: string = typeof value === 'string' ? value : '';
  const flattened: string = source.split('\t').join(' ').split('\r').join(' ').split('\n').join(' ');
  const trimmed: string = flattened.trim();
  const out: string = trimmed.length === 0 ? fallback : trimmed;
  return out.length > MAX_FIELD_LENGTH ? out.slice(0, MAX_FIELD_LENGTH) : out;
}

function uniqueSorted(weeks: number[], limit: number): number[] {
  const seen: number[] = [];
  for (const week of weeks) {
    if (typeof week !== 'number' || !Number.isInteger(week) || week < 1) {
      continue;
    }
    if (Number.isFinite(limit) && week > limit) {
      continue;
    }
    if (seen.indexOf(week) < 0) {
      seen.push(week);
    }
  }
  seen.sort((a: number, b: number): number => a - b);
  return seen;
}

// web formatWeekParts：连续全段 / 全奇 / 全偶压缩为「第a-b周」，其余按连续段枚举「第7、9周」。
export function formatWeekParts(weeks: number[], totalWeeks: number, copy: RulesTextCopy): WeekSpec {
  const limit: number = typeof totalWeeks === 'number' && Number.isInteger(totalWeeks) && totalWeeks > 0 ? totalWeeks : Infinity;
  const list: number[] = uniqueSorted(weeks, limit);
  if (list.length === 0) {
    return { text: '', pattern: copy.patternAll };
  }
  const min: number = list[0];
  const max: number = list[list.length - 1];
  if (max - min + 1 === list.length) {
    return {
      text: min === max ? fillPattern(copy.weekOne, [String(min)]) : fillPattern(copy.weekSpan, [String(min), String(max)]),
      pattern: copy.patternAll
    };
  }
  let stepTwo: boolean = list.length >= 3 && max - min === 2 * (list.length - 1);
  if (stepTwo) {
    for (let i = 0; i < list.length; i++) {
      if (list[i] !== min + i * 2) {
        stepTwo = false;
        break;
      }
    }
  }
  if (stepTwo) {
    return {
      text: fillPattern(copy.weekSpan, [String(min), String(max)]),
      pattern: min % 2 === 1 ? copy.weekOdd : copy.weekEven
    };
  }
  const labels: string[] = [];
  let runStart: number = list[0];
  let runEnd: number = list[0];
  const flush = (): void => {
    labels.push(runStart === runEnd ? String(runStart) : String(runStart) + '-' + String(runEnd));
  };
  for (let i = 1; i < list.length; i++) {
    const week: number = list[i];
    if (week === runEnd + 1) {
      runEnd = week;
      continue;
    }
    flush();
    runStart = week;
    runEnd = week;
  }
  flush();
  return {
    text: copy.ordinalPrefix + labels.join(copy.periodJoin) + copy.weekSuffix,
    pattern: copy.patternAll
  };
}

// web formatWeekSpec：text 非空时输出「第a-b周(全部)」，否则空串。
export function formatWeekSpec(weeks: number[], totalWeeks: number, copy: RulesTextCopy): WeekSpec {
  const part: WeekSpec = formatWeekParts(weeks, totalWeeks, copy);
  if (part.text.length === 0) {
    return { text: '', pattern: part.pattern };
  }
  return { text: part.text + '(' + part.pattern + ')', pattern: part.pattern };
}

export function weekdayName(copy: RulesTextCopy, weekday: number): string {
  if (weekday >= 1 && weekday <= copy.weekdays.length) {
    return copy.weekdays[weekday - 1];
  }
  return '';
}

function segmentKey(card: SemesterCard): string {
  return [
    String(card.weekday),
    card.startTime,
    card.endTime,
    card.room,
    card.name,
    card.teacher
  ].join('|');
}

// web buildRulesModel：按 课程名+教师 合并，多段以分号连接；segments 排序 weekday/start/periods[0]/room。
// 周次聚合用「段索引」而不是复制键，避免键字段不一致导致回查 miss。
export function buildRulesModel(model: SemesterModel, copy: RulesTextCopy): RulesCourse[] {
  const courses: RulesCourse[] = [];
  const byCourse: Map<string, RulesCourse> = new Map<string, RulesCourse>();
  const bySegment: Map<string, number> = new Map<string, number>();
  const allSegments: RulesSegment[] = [];
  const allWeeks: number[][] = [];
  for (const card of model.cards) {
    const courseKey: string = card.name + '|' + card.teacher;
    let course: RulesCourse | undefined = byCourse.get(courseKey);
    if (course === undefined) {
      course = { name: card.name, teacher: card.teacher, rooms: [], segments: [] };
      byCourse.set(courseKey, course);
      courses.push(course);
    }
    const key: string = segmentKey(card);
    const found: number | undefined = bySegment.get(key);
    let index: number = found === undefined ? -1 : found;
    if (index < 0) {
      const periods: number[] = occurrencePeriods(card.startTime, card.endTime);
      const segment: RulesSegment = {
        weekday: card.weekday,
        periods: periods,
        startTime: card.startTime,
        endTime: card.endTime,
        room: card.room,
        week: { text: '', pattern: WEEK_PATTERN_NONE }
      };
      index = allSegments.length;
      allSegments.push(segment);
      allWeeks.push([]);
      bySegment.set(key, index);
      course.segments.push(segment);
      if (course.rooms.indexOf(card.room) < 0) {
        course.rooms.push(card.room);
      }
    }
    const weeks: number[] = allWeeks[index];
    for (const week of card.weeks) {
      if (weeks.indexOf(week) < 0) {
        weeks.push(week);
      }
    }
  }
  for (const course of courses) {
    course.segments.sort((a: RulesSegment, b: RulesSegment): number => {
      if (a.weekday !== b.weekday) {
        return a.weekday - b.weekday;
      }
      if (a.startTime !== b.startTime) {
        return a.startTime.localeCompare(b.startTime);
      }
      const ap: number = a.periods.length > 0 ? a.periods[0] : 0;
      const bp: number = b.periods.length > 0 ? b.periods[0] : 0;
      if (ap !== bp) {
        return ap - bp;
      }
      return a.room.localeCompare(b.room);
    });
  }
  for (let i = 0; i < allSegments.length; i++) {
    allSegments[i].week = formatWeekParts(allWeeks[i], model.totalWeeks, copy);
  }
  courses.sort((a: RulesCourse, b: RulesCourse): number => {
    const dayDiff: number = minWeekdayOf(a) - minWeekdayOf(b);
    if (dayDiff !== 0) {
      return dayDiff;
    }
    const timeDiff: number = minStartTimeOf(a).localeCompare(minStartTimeOf(b));
    if (timeDiff !== 0) {
      return timeDiff;
    }
    const nameDiff: number = a.name.localeCompare(b.name);
    if (nameDiff !== 0) {
      return nameDiff;
    }
    return a.teacher.localeCompare(b.teacher);
  });
  return courses;
}

// 预览行：与 buildRulesText 的正文列一致（课程名/教师/教室/上课时间/周次说明），用于 UI 预览。
export function buildRulesRows(model: SemesterModel, copy: RulesTextCopy): RulesTextRow[] {
  const rows: RulesTextRow[] = [];
  for (const course of buildRulesModel(model, copy)) {
    const parts: string[] = [];
    for (const segment of course.segments) {
      parts.push(segmentText(segment, copy));
    }
    rows.push({
      name: course.name,
      teacher: course.teacher,
      room: course.rooms.join(';'),
      time: parts.join(';'),
      weeks: ''
    });
  }
  return rows;
}

function minWeekdayOf(course: RulesCourse): number {
  let min: number = 99;
  for (const segment of course.segments) {
    if (segment.weekday < min) {
      min = segment.weekday;
    }
  }
  return min;
}

function minStartTimeOf(course: RulesCourse): string {
  let min: string = '99:99';
  for (const segment of course.segments) {
    if (segment.startTime < min) {
      min = segment.startTime;
    }
  }
  return min;
}

function segmentText(segment: RulesSegment, copy: RulesTextCopy): string {
  const prefix: string = weekdayName(copy, segment.weekday) + periodTextOf(segment, copy);
  return prefix + '{' + segment.week.text + '}' + '(' + segment.week.pattern + ')';
}

function periodTextOf(segment: RulesSegment, copy: RulesTextCopy): string {
  if (segment.periods.length > 0) {
    const names: string[] = segment.periods.map((value: number): string => String(value));
    return fillPattern(copy.period, [names.join(copy.periodJoin)]);
  }
  return fillPattern(copy.segmentSpan, [segment.startTime, segment.endTime]);
}

function addDaysKey(dateKey: string, amount: number): string {
  const time: number = Date.parse(dateKey + 'T00:00:00Z');
  if (!Number.isFinite(time)) {
    return '';
  }
  return new Date(time + amount * 86400000).toISOString().slice(0, 10);
}

// web unscheduledWeeksText：数字周次数组按同一周次文案输出；空/无效回退「待确认」。
export function unscheduledWeeksText(weeks: number[], totalWeeks: number, copy: RulesTextCopy): string {
  const spec: WeekSpec = formatWeekSpec(weeks, totalWeeks, copy);
  return spec.text.length > 0 ? spec.text : copy.unknownWeeks;
}

function headerLines(model: SemesterModel | null, copy: RulesTextCopy, stamp: string): string[] {
  const comment: string = copy.commentPrefix;
  const totalWeeks: number = model === null ? 0 : model.totalWeeks;
  const startDate: string = model === null ? '' : model.snapshot.startDate;
  const endDate: string = model === null || startDate.length === 0 ? '' : addDaysKey(startDate, totalWeeks * 7 - 1);
  const totalText: string = totalWeeks <= 0 ? '' : totalWeeks === 1 ? fillPattern(copy.weekOne, ['1']) : fillPattern(copy.weekSpan, ['1', String(totalWeeks)]);
  const sourceLabel: string = model === null || model.sourceLabel.length === 0
    ? copy.sourceSample
    : model.sourceLabel;
  const sourceSuffix: string = model !== null && model.sourceKind === 'school' ? '' : copy.sourceNote;
  const semesterName: string = model === null ? '' : cleanField(model.snapshot.name, '');
  return [
    copy.webTitle,
    comment + ' ' + fillPattern(copy.semesterLine, [semesterName]),
    comment + ' ' + fillPattern(copy.teachingWeeks, [totalText, startDate, endDate]),
    comment + ' ' + fillPattern(copy.generatedLine, [stamp]),
    comment + ' ' + fillPattern(copy.sourceLine, [sourceLabel + sourceSuffix]),
    comment + ' ' + copy.notesLine,
    comment + ' ' + copy.formatLine
  ];
}

// 生成 TXT 内容（web buildRulesText 口径）：8 行头 + 4 列表头 + 每门课一行 + 未排课 5 列 + 冲突尾注。
export function buildRulesText(model: SemesterModel | null, copy: RulesTextCopy, stamp: string): string {
  const comment: string = copy.commentPrefix;
  const lines: string[] = headerLines(model, copy, stamp);
  lines.push([copy.courseName, copy.teacherLabel, copy.roomLabel, copy.classTime].join(copy.fieldSeparator));
  if (model === null || model.cards.length === 0) {
    lines.push(comment + ' ' + copy.emptyLine);
    return lines.join(copy.lineBreak) + copy.lineBreak;
  }
  const courses: RulesCourse[] = buildRulesModel(model, copy);
  for (const course of courses) {
    const segments: string[] = [];
    for (const segment of course.segments) {
      segments.push(segmentText(segment, copy));
    }
    lines.push([
      cleanField(course.name, copy.unnamed),
      cleanField(course.teacher, ''),
      cleanField(course.rooms.join(';'), ''),
      segments.join(';')
    ].join(copy.fieldSeparator));
  }
  const unscheduled = model.snapshot.unscheduled || [];
  if (unscheduled.length > 0) {
    lines.push('');
    lines.push(comment + ' ' + copy.unscheduledTitle);
    lines.push([copy.courseName, copy.teacherLabel, copy.roomLabel, copy.weeksLabel, copy.noteLabel].join(copy.fieldSeparator));
    for (const course of unscheduled) {
      const weeksText: string = unscheduledWeeksText(course.weeks, model.totalWeeks, copy);
      const note: string = cleanField(course.note, copy.unscheduledNote);
      lines.push([
        cleanField(course.name, copy.unnamed),
        cleanField(course.teacher, UNNAMED_FALLBACK),
        cleanField(course.room, UNNAMED_FALLBACK),
        weeksText,
        note
      ].join(copy.fieldSeparator));
    }
  }
  if (model.conflictCount > 0) {
    lines.push(comment + ' ' + fillPattern(copy.conflictLine, [String(model.conflictCount)]));
  }
  return lines.join(copy.lineBreak) + copy.lineBreak;
}
