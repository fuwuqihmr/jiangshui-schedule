/*
 * jsxsd timetable parser.
 *
 * Pure logic: every human-readable label, day name, status token and range
 * separator is injected through SchoolLexicon (see SchoolLexicon.ets and
 * platform/school/ParserLexiconFactory.ets). This file must stay ASCII-only
 * and must only use `import type`.
 *
 * The parser is synchronous and throws SchoolParseError with a stable `code`
 * on bad input; the caller (SchoolReadOrchestrator) maps that to UI errors.
 */
import type { CourseException, CourseExceptionPatch, CourseRule, UnscheduledCourse } from '../types/AppState';
import type { StudentProfile } from '../types/Leave';
import type { SchoolLexicon } from './SchoolLexicon';

const MAX_INPUT: number = 2 * 1024 * 1024;
const MAX_WEEKS: number = 60;
const MAX_PERIOD: number = 11;
const MAX_PROFILE_TAIL: number = 32;

const CODE_PARSE_FAILED: string = 'SCHOOL_PARSE_FAILED';
const CODE_EMPTY: string = 'SCHOOL_EMPTY_TIMETABLE';
const CODE_LOGIN: string = 'SCHOOL_LOGIN_REQUIRED';
const CODE_CAPTCHA: string = 'SCHOOL_CAPTCHA_REQUIRED';

const FULL_LPAREN: string = String.fromCharCode(0xff08);
const FULL_RPAREN: string = String.fromCharCode(0xff09);
const FULL_COMMA: string = String.fromCharCode(0xff0c);
const IDEOGRAPHIC_COMMA: string = String.fromCharCode(0x3001);
const DASH: string = String.fromCharCode(0x2014);

export interface JsxsdRow {
  kc_mc?: string;
  jg0101mc?: string;
  sktime?: string;
  skddmc?: string;
  jx0404id?: string;
  kch?: string;
}

export interface JsxsdPayload {
  code?: number;
  data?: JsxsdRow[];
}

export interface TimetableParseOptions {
  semesterId: string;
  totalWeeks?: number;
  modeId?: string;
  sourceLabel?: string;
  /** Monday of week 1, ISO yyyy-mm-dd; enables date-based exceptions. */
  startDate?: string;
}

export interface PageMeta {
  semesterId: string;
  modeId: string;
}

export type WeekPattern = 'every' | 'odd' | 'even';

export interface WeekSpec {
  weeks: number[];
  pattern: WeekPattern;
  classWeek: string;
}

export interface TimetableSegment {
  day: number;
  first: number;
  last: number;
  weeks: number[];
  pattern: WeekPattern;
  room: string;
  classWeek: string;
}

export interface PeriodTime {
  start: string;
  end: string;
}

export interface ParsedTimetable {
  semesterId: string;
  totalWeeks: number;
  modeId: string;
  sourceLabel: string;
  rules: CourseRule[];
  unscheduled: UnscheduledCourse[];
  exceptions: CourseException[];
  /**
   * Rows that carried a course name but produced no usable class time (P1-B).
   * 0 means the payload was parsed completely; anything else means classes were
   * dropped and the caller must not present the result as a full timetable.
   */
  skippedRows: number;
  /** Stable reason codes for skippedRows: 'invalid-time' / 'invalid-period'. */
  skippedReasons: string[];
}

export const PERIOD_TIMES: PeriodTime[] = [
  { start: '08:30', end: '09:10' },
  { start: '09:15', end: '09:55' },
  { start: '10:15', end: '10:55' },
  { start: '11:00', end: '11:40' },
  { start: '14:00', end: '14:40' },
  { start: '14:45', end: '15:25' },
  { start: '15:45', end: '16:25' },
  { start: '16:30', end: '17:10' },
  { start: '19:00', end: '19:40' },
  { start: '19:45', end: '20:25' },
  { start: '20:30', end: '21:10' }
];

class SchoolParseError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new SchoolParseError(code, message);
}

function rawText(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  return value;
}

function trimText(value: string | null | undefined): string {
  return rawText(value).trim();
}

function isFullWidthParen(ch: string): boolean {
  return ch === FULL_LPAREN || ch === FULL_RPAREN;
}

function normalize(value: string, lexicon: SchoolLexicon): string {
  let out: string = rawText(value);
  out = out.split(FULL_LPAREN).join('(');
  out = out.split(FULL_RPAREN).join(')');
  out = out.split(FULL_COMMA).join(',');
  out = out.split(IDEOGRAPHIC_COMMA).join(',');
  for (const separator of lexicon.rangeSeparators) {
    if (separator.length > 0 && separator !== '-') {
      out = out.split(separator).join('-');
    }
  }
  return out;
}

function weekInRange(week: number, totalWeeks: number): boolean {
  return week >= 1 && week <= totalWeeks;
}

function validatePeriod(period: number): number {
  if (period < 1 || period > MAX_PERIOD) {
    fail(CODE_PARSE_FAILED, 'period out of range');
  }
  return period;
}

/**
 * Runtime shape guard for one row of the jsxsd payload. JSON payloads can
 * contain null entries even though the declared type says otherwise, so the
 * loop must check before touching any field.
 */
function isRowRecord(value: JsxsdRow | null | undefined): boolean {
  return value !== null && value !== undefined && typeof value === 'object';
}

/**
 * P2 round 3: a row with no known field at all ("{}" or "[]") is an empty row and must be
 * skipped silently (no skippedRows, no error). A row with a key but an empty course
 * name still fails with "missing course name". ArkTS forbids dynamic property access, so the
 * check lists the known schema fields explicitly instead of using Object.keys().
 */
function isEmptyRow(row: JsxsdRow): boolean {
  const hasIdentity: boolean = row.kc_mc !== undefined || row.jg0101mc !== undefined;
  const hasTime: boolean = row.sktime !== undefined || row.skddmc !== undefined;
  const hasPlan: boolean = row.jx0404id !== undefined || row.kch !== undefined;
  return !hasIdentity && !hasTime && !hasPlan;
}

function sortUnique(values: number[]): number[] {
  const result: number[] = [];
  for (const value of values) {
    if (result.indexOf(value) < 0) {
      result.push(value);
    }
  }
  result.sort((a: number, b: number): number => a - b);
  return result;
}

/**
 * Parse a week spec such as "{di}1-4{zhou}(all)" / "{di}3-8{zhou}(odd)".
 * Throws SCHOOL_PARSE_FAILED when the filtered week list is empty.
 */
export function parseWeekSpec(value: string, lexicon: SchoolLexicon): WeekSpec {
  const source: string = trimText(value);
  let pattern: WeekPattern = 'every';
  if (source.indexOf(lexicon.weekOdd) >= 0) {
    pattern = 'odd';
  } else if (source.indexOf(lexicon.weekEven) >= 0) {
    pattern = 'even';
  }

  let text: string = normalize(source, lexicon);
  text = text.split(',').join(' ');
  text = text.split(lexicon.weekAll).join(' ');
  text = text.split(lexicon.weekOdd).join(' ');
  text = text.split(lexicon.weekEven).join(' ');
  text = text.split(lexicon.weekPrefix).join(' ');
  text = text.split(lexicon.weekSuffix).join(' ');
  text = text.split('(').join(' ');
  text = text.split(')').join(' ');

  const weeks: number[] = [];
  for (const chunk of text.split(' ')) {
    const piece: string = chunk.trim();
    if (piece.length === 0) {
      continue;
    }
    const dashIndex: number = piece.indexOf('-');
    if (dashIndex > 0) {
      const left: string = piece.substring(0, dashIndex).trim();
      const right: string = piece.substring(dashIndex + 1).trim();
      const from: number = parseInt(left, 10);
      const to: number = parseInt(right, 10);
      if (isNaN(from) || isNaN(to) || from < 1 || to < from || to > MAX_WEEKS) {
        fail(CODE_PARSE_FAILED, 'invalid week range');
      }
      for (let week: number = from; week <= to; week++) {
        weeks.push(week);
      }
    } else {
      const single: number = parseInt(piece, 10);
      if (isNaN(single) || single < 1 || single > MAX_WEEKS) {
        fail(CODE_PARSE_FAILED, 'invalid week number');
      }
      weeks.push(single);
    }
  }

  const filtered: number[] = [];
  for (const week of sortUnique(weeks)) {
    if (pattern === 'odd' && week % 2 === 0) {
      continue;
    }
    if (pattern === 'even' && week % 2 === 1) {
      continue;
    }
    filtered.push(week);
  }
  if (filtered.length === 0) {
    fail(CODE_PARSE_FAILED, 'week spec is empty');
  }
  return { weeks: filtered, pattern: pattern, classWeek: source };
}

function braceWeeks(value: string, lexicon: SchoolLexicon): number[] {
  const text: string = normalize(value, lexicon);
  const open: number = text.indexOf('{');
  if (open < 0) {
    return [];
  }
  const close: number = text.indexOf('}', open + 1);
  if (close <= open) {
    return [];
  }
  const spec: WeekSpec = parseWeekSpec(text.substring(open + 1, close), lexicon);
  return spec.weeks;
}

function periodNumber(piece: string): number {
  const value: number = parseInt(piece, 10);
  if (isNaN(value)) {
    fail(CODE_PARSE_FAILED, 'invalid period');
  }
  return validatePeriod(value);
}

function periodList(body: string): number[] {
  const periods: number[] = [];
  for (const chunk of body.split(',')) {
    const piece: string = chunk.trim();
    if (piece.length === 0) {
      continue;
    }
    const dashIndex: number = piece.indexOf('-');
    if (dashIndex > 0) {
      const from: number = periodNumber(piece.substring(0, dashIndex).trim());
      const to: number = periodNumber(piece.substring(dashIndex + 1).trim());
      for (let period: number = from; period <= to; period++) {
        periods.push(validatePeriod(period));
      }
    } else {
      periods.push(periodNumber(piece));
    }
  }
  return periods;
}

function dayOf(text: string, lexicon: SchoolLexicon): number {
  for (let index: number = 0; index < lexicon.dayChars.length; index++) {
    const dayChar: string = lexicon.dayChars[index];
    if (dayChar.length > 0 && text.indexOf(dayChar) >= 0) {
      return index + 1;
    }
  }
  return 0;
}

function segmentOf(piece: string, rooms: string[], index: number, lexicon: SchoolLexicon): TimetableSegment | null {
  const text: string = normalize(piece, lexicon);
  const day: number = dayOf(text, lexicon);
  if (day === 0) {
    return null;
  }
  const prefixIndex: number = text.indexOf(lexicon.periodPrefix);
  if (prefixIndex < 0) {
    return null;
  }
  const suffixIndex: number = text.indexOf(lexicon.periodSuffix, prefixIndex + lexicon.periodPrefix.length);
  if (suffixIndex <= prefixIndex) {
    return null;
  }
  const body: string = text.substring(prefixIndex + lexicon.periodPrefix.length, suffixIndex);
  const periods: number[] = periodList(body);
  if (periods.length === 0) {
    return null;
  }
  let first: number = periods[0];
  let last: number = periods[0];
  for (const period of periods) {
    if (period < first) {
      first = period;
    }
    if (period > last) {
      last = period;
    }
  }
  let weeks: number[] = braceWeeks(text, lexicon);
  let pattern: WeekPattern = 'every';
  if (text.indexOf(lexicon.weekOdd) >= 0) {
    pattern = 'odd';
  } else if (text.indexOf(lexicon.weekEven) >= 0) {
    pattern = 'even';
  }
  if (pattern === 'odd') {
    weeks = weeks.filter((week: number): boolean => week % 2 === 1);
  } else if (pattern === 'even') {
    weeks = weeks.filter((week: number): boolean => week % 2 === 0);
  }
  if (weeks.length === 0) {
    return null;
  }
  let room: string = '';
  if (index < rooms.length) {
    room = rooms[index].trim();
  }
  if (room.length === 0) {
    room = DASH;
  }
  return {
    day: day,
    first: first,
    last: last,
    weeks: weeks,
    pattern: pattern,
    room: room,
    classWeek: piece
  };
}

/** Split one sktime cell into segments (day + periods + weeks + room). */
export function parseSegments(sktime: string | null, rooms: string | null, lexicon: SchoolLexicon): TimetableSegment[] {
  const pieces: string[] = rawText(sktime).split(';');
  const roomPieces: string[] = rawText(rooms).split(';');
  const segments: TimetableSegment[] = [];
  for (let index: number = 0; index < pieces.length; index++) {
    const piece: string = pieces[index].trim();
    if (piece.length === 0) {
      continue;
    }
    const segment: TimetableSegment | null = segmentOf(piece, roomPieces, index, lexicon);
    if (segment !== null) {
      segments.push(segment);
    }
  }
  return segments;
}

function planIdOf(row: JsxsdRow, rowIndex: number, segmentIndex: number): string {
  const jx: string = trimText(row.jx0404id);
  if (jx.length > 0) {
    return jx;
  }
  const kch: string = trimText(row.kch);
  if (kch.length > 0) {
    return kch;
  }
  const name: string = trimText(row.kc_mc);
  if (name.length > 0) {
    return name;
  }
  return 'row' + rowIndex + '-plan' + segmentIndex;
}

function isUnscheduled(value: string, lexicon: SchoolLexicon): boolean {
  const text: string = normalize(value, lexicon).trim();
  if (text.length === 0) {
    return true;
  }
  for (const token of lexicon.unscheduledValues) {
    if (token.length > 0 && text.indexOf(token) >= 0) {
      return true;
    }
  }
  if (text.indexOf(lexicon.periodSuffix) < 0 && dayOf(text, lexicon) === 0) {
    return true;
  }
  return false;
}

function hasWeekInfo(value: string, lexicon: SchoolLexicon): boolean {
  const text: string = normalize(value, lexicon);
  return text.indexOf(lexicon.weekPrefix) >= 0 && text.indexOf(lexicon.weekSuffix) >= 0;
}

/** Weeks stated directly (no braces), e.g. week 2 only; [] when absent. */
function weekTextWeeks(value: string, lexicon: SchoolLexicon): number[] {
  const text: string = normalize(value, lexicon);
  const open: number = text.indexOf(lexicon.weekPrefix);
  if (open < 0) {
    return [];
  }
  const after: number = open + lexicon.weekPrefix.length;
  const close: number = text.indexOf(lexicon.weekSuffix, after);
  if (close <= after) {
    return [];
  }
  try {
    return parseWeekSpec(text.substring(after, close), lexicon).weeks;
  } catch (error) {
    return [];
  }
}

function isoDateFrom(startDate: string, week: number, day: number): string {
  const parts: string[] = startDate.split('-');
  if (parts.length !== 3) {
    return '';
  }
  const year: number = parseInt(parts[0], 10);
  const month: number = parseInt(parts[1], 10);
  const date: number = parseInt(parts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(date)) {
    return '';
  }
  const millis: number = Date.UTC(year, month - 1, date) + ((week - 1) * 7 + (day - 1)) * 86400000;
  const text: string = new Date(millis).toISOString();
  return text.substring(0, 10);
}

function findRule(rules: CourseRule[], id: string): CourseRule | null {
  for (const rule of rules) {
    if (rule.id === id) {
      return rule;
    }
  }
  return null;
}

function mergeWeeks(rule: CourseRule, weeks: number[]): void {
  for (const week of weeks) {
    if (rule.weeks.indexOf(week) < 0) {
      rule.weeks.push(week);
    }
  }
  rule.weeks.sort((a: number, b: number): number => a - b);
}

function periodsOf(first: number, last: number): number[] {
  const periods: number[] = [];
  for (let period: number = first; period <= last; period++) {
    periods.push(period);
  }
  return periods;
}

/**
 * Build rules / unscheduled entries / date exceptions from jsxsd rows.
 * The returned weeks are filtered by options.totalWeeks.
 */
export function parseTimetableRows(
  rows: JsxsdRow[],
  options: TimetableParseOptions,
  lexicon: SchoolLexicon
): ParsedTimetable {
  if (!Array.isArray(rows)) {
    fail(CODE_PARSE_FAILED, 'invalid timetable rows');
  }
  const rules: CourseRule[] = [];
  const unscheduled: UnscheduledCourse[] = [];
  const exceptions: CourseException[] = [];
  const declaredWeeks: number = options.totalWeeks !== undefined ? options.totalWeeks : 0;
  const effectiveWeeks: number = declaredWeeks > 0 ? declaredWeeks : MAX_WEEKS;
  const startDate: string = trimText(options.startDate);
  // P1-B: a named row whose class time cannot be parsed must not be dropped silently.
  // Count it and record a stable reason code so callers can refuse a partial timetable.
  const skippedReasons: string[] = [];
  let skippedRows: number = 0;

  for (let rowIndex: number = 0; rowIndex < rows.length; rowIndex++) {
    if (!isRowRecord(rows[rowIndex])) {
      continue;
    }
    const row: JsxsdRow = rows[rowIndex];
    if (isEmptyRow(row)) {
      continue;
    }
    if (row.sktime !== undefined && row.sktime !== null && typeof row.sktime !== 'string') {
      fail(CODE_PARSE_FAILED, 'invalid sktime');
    }
    const name: string = trimText(row.kc_mc);
    if (name.length === 0) {
      fail(CODE_PARSE_FAILED, 'missing course name');
    }
    const teacher: string = trimText(row.jg0101mc);
    const rawTime: string = rawText(row.sktime).trim();
    const rawRoom: string = trimText(row.skddmc);

    if (isUnscheduled(rawTime, lexicon)) {
      const weeks: number[] = weekTextWeeks(rawTime, lexicon);
      const note: string = hasWeekInfo(rawTime, lexicon) ? lexicon.unscheduledNoteWeeksOnly : lexicon.unscheduledNoteNoTime;
      const planId: string = planIdOf(row, rowIndex, 0);
      unscheduled.push({
        id: 'jsxsd-pending-' + planId + '-' + unscheduled.length,
        name: name,
        teacher: teacher,
        room: rawRoom,
        weeks: weeks,
        note: note
      });
      continue;
    }

    const segments: TimetableSegment[] = parseSegments(rawTime, rawRoom, lexicon);
    if (segments.length === 0) {
      // The row has a course name but sktime yields no segment (for example missing week
      // markers or an unrecognised date word): count it as skipped (P1-B).
      skippedRows = skippedRows + 1;
      skippedReasons.push('invalid-time');
      continue;
    }
    let usableSegment: boolean = false;

    for (let segmentIndex: number = 0; segmentIndex < segments.length; segmentIndex++) {
      const segment: TimetableSegment = segments[segmentIndex];
      if (segment.first < 1 || segment.first > MAX_PERIOD || segment.last < 1 || segment.last > MAX_PERIOD) {
        continue;
      }
      usableSegment = true;
      const weeks: number[] = segment.weeks.filter((week: number): boolean => weekInRange(week, effectiveWeeks));
      if (weeks.length === 0) {
        continue;
      }
      const planId: string = planIdOf(row, rowIndex, segmentIndex);
      const id: string =
        'jsxsd-' + planId + '-' + segment.day + '-' + segment.first + '-' + segment.last + '-' + segmentIndex;
      const existing: CourseRule | null = findRule(rules, id);
      if (existing === null) {
        const rule: CourseRule = {
          id: id,
          name: name,
          teacher: teacher,
          room: segment.room.length > 0 ? segment.room : DASH,
          dayOfWeek: segment.day,
          weekday: segment.day,
          startPeriod: segment.first,
          endPeriod: segment.last,
          periods: periodsOf(segment.first, segment.last),
          weeks: weeks,
          startTime: PERIOD_TIMES[segment.first - 1].start,
          endTime: PERIOD_TIMES[segment.last - 1].end,
          cancelled: false,
          source: 'school',
          sourceLabel: options.sourceLabel
        };
        rules.push(rule);
        continue;
      }

      mergeWeeks(existing, weeks);
      if (startDate.length === 0) {
        continue;
      }
      const room: string = segment.room;
      if (room.length > 0 && room !== existing.room) {
        for (const week of weeks) {
          const date: string = isoDateFrom(startDate, week, segment.day);
          if (date.length === 0) {
            continue;
          }
          const patch: CourseExceptionPatch = { room: room };
          exceptions.push({ date: date, ruleId: id, cancel: false, patch: patch });
        }
      }
      if (teacher.length > 0 && teacher !== existing.teacher) {
        for (const week of weeks) {
          const date: string = isoDateFrom(startDate, week, segment.day);
          if (date.length === 0) {
            continue;
          }
          const patch: CourseExceptionPatch = { teacher: teacher };
          exceptions.push({ date: date, ruleId: id, cancel: false, patch: patch });
        }
      }
    }
    if (!usableSegment) {
      // The row provided periods but all of them fall outside 1..11, so it has no usable
      // class time either: count it as skipped (P1-B).
      skippedRows = skippedRows + 1;
      skippedReasons.push('invalid-period');
    }
  }

  exceptions.sort((a: CourseException, b: CourseException): number => {
    if (a.date < b.date) {
      return -1;
    }
    if (a.date > b.date) {
      return 1;
    }
    return 0;
  });

  return {
    semesterId: options.semesterId,
    totalWeeks: declaredWeeks,
    modeId: options.modeId !== undefined ? options.modeId : '',
    sourceLabel: options.sourceLabel !== undefined ? options.sourceLabel : '',
    rules: rules,
    unscheduled: unscheduled,
    exceptions: exceptions,
    skippedRows: skippedRows,
    skippedReasons: skippedReasons
  };
}

function matchInputValue(html: string, id: string): string | null {
  const patternA: RegExp = new RegExp('id="' + id + '"[^>]*value="([^"]*)"');
  const matchA: RegExpMatchArray | null = html.match(patternA);
  if (matchA !== null) {
    return matchA[1];
  }
  const patternB: RegExp = new RegExp('value="([^"]*)"[^>]*id="' + id + '"');
  const matchB: RegExpMatchArray | null = html.match(patternB);
  if (matchB !== null) {
    return matchB[1];
  }
  return null;
}

export function parseTimetablePage(html: string): PageMeta | null {
  const semesterId: string | null = matchInputValue(html, 'xnxq01id');
  const modeId: string | null = matchInputValue(html, 'kbjcmsid');
  if (semesterId === null || modeId === null) {
    return null;
  }
  if (semesterId.length === 0 || modeId.length === 0) {
    return null;
  }
  return { semesterId: semesterId, modeId: modeId };
}

export function isLoginPage(html: string, lexicon: SchoolLexicon): boolean {
  const lower: string = html.toLowerCase();
  if (lower.indexOf('useraccount') >= 0) {
    return true;
  }
  if (lower.indexOf('name="password"') >= 0) {
    return true;
  }
  if (lower.indexOf('j_username') >= 0) {
    return true;
  }
  return lower.indexOf('name="execution"') >= 0 && lower.indexOf('name="username"') >= 0;
}

export function isCaptchaPage(html: string, lexicon: SchoolLexicon): boolean {
  return html.toLowerCase().indexOf('captcha') >= 0;
}

function payloadFromHtml(html: string): string {
  const marker: number = html.indexOf('jsxsd-payload');
  if (marker < 0) {
    return html;
  }
  const open: number = html.indexOf('>', marker);
  if (open < 0) {
    return html;
  }
  const close: number = html.indexOf('</', open + 1);
  if (close <= open) {
    return html;
  }
  return html.substring(open + 1, close);
}

export function parseTimetable(
  html: string,
  options: TimetableParseOptions,
  lexicon: SchoolLexicon
): ParsedTimetable {
  if (html.length === 0) {
    fail(CODE_PARSE_FAILED, 'empty timetable body');
  }
  if (html.length > MAX_INPUT) {
    fail(CODE_PARSE_FAILED, 'timetable body too large');
  }
  if (isLoginPage(html, lexicon)) {
    fail(CODE_LOGIN, 'login required');
  }
  if (isCaptchaPage(html, lexicon)) {
    fail(CODE_CAPTCHA, 'captcha required');
  }

  let payload: JsxsdPayload | null = null;
  try {
    payload = JSON.parse(payloadFromHtml(html)) as JsxsdPayload;
  } catch (error) {
    payload = null;
  }
  if (payload === null) {
    fail(CODE_PARSE_FAILED, 'invalid timetable payload');
  }
  const parsed: JsxsdPayload = payload as JsxsdPayload;
  if (parsed.code !== undefined && parsed.code !== 0) {
    fail(CODE_PARSE_FAILED, 'server returned an error code');
  }
  if (parsed.data === undefined || parsed.data === null || !Array.isArray(parsed.data)) {
    fail(CODE_PARSE_FAILED, 'missing timetable data');
  }
  const rows: JsxsdRow[] = parsed.data;
  if (rows.length === 0) {
    fail(CODE_EMPTY, 'timetable is empty');
  }
  let result: ParsedTimetable | null = null;
  try {
    result = parseTimetableRows(rows, options, lexicon);
  } catch (error) {
    if (error instanceof SchoolParseError) {
      throw error;
    }
    fail(CODE_PARSE_FAILED, 'unexpected timetable row');
  }
  const timetable: ParsedTimetable = result as ParsedTimetable;
  if (timetable.skippedRows > 0) {
    // P1-B: a named row that was dropped must never look like a clean parse. Spec 2.3
    // requires SCHOOL_PARSE_FAILED for period 12 / missing class time, and spec 2.10 only
    // allows the stable codes PARSE_FAILED / EMPTY_TIMETABLE, so reuse PARSE_FAILED and put
    // the dropped row count in detail (visible in logs; the UI keeps the existing parse text).
    fail(CODE_PARSE_FAILED, 'dropped ' + String(timetable.skippedRows) + ' course rows without valid class time');
  }
  if (timetable.rules.length === 0 && timetable.unscheduled.length === 0) {
    fail(CODE_EMPTY, 'timetable has no usable rows');
  }
  return timetable;
}

function plainText(html: string): string {
  let text: string = html.replace(/<script[^>]*>[^<]*<\/script>/g, ' ');
  text = text.replace(/<style[^>]*>[^<]*<\/style>/g, ' ');
  text = text.replace(/<[^>]*>/g, ' ');
  text = text.split('&nbsp;').join(' ');
  text = text.split('&amp;').join(' ');
  return text;
}

function firstYear(text: string): number {
  const match: RegExpMatchArray | null = text.match(/(20[0-9]{2})/);
  if (match === null) {
    return 0;
  }
  return parseInt(match[1], 10);
}

function academicYearOf(text: string): number {
  const match: RegExpMatchArray | null = text.match(/(20[0-9]{2})\s*-\s*(20[0-9]{2})/);
  if (match === null) {
    return 0;
  }
  return parseInt(match[1], 10);
}

/** Best-effort profile extraction; returns null when nothing is recognized. */
export function parseProfile(html: string, lexicon: SchoolLexicon): StudentProfile | null {
  const text: string = plainText(html);
  let enrollmentYear: number = 0;
  let academicYear: number = 0;

  for (const label of lexicon.profileLabels) {
    let from: number = 0;
    while (from < text.length) {
      const index: number = text.indexOf(label, from);
      if (index < 0) {
        break;
      }
      const tail: string = text.substring(index + label.length, index + label.length + MAX_PROFILE_TAIL);
      const year: number = firstYear(tail);
      if (year > 0 && enrollmentYear === 0) {
        enrollmentYear = year;
      }
      const span: number = academicYearOf(tail);
      if (span > 0 && academicYear === 0) {
        academicYear = span;
      }
      from = index + label.length;
    }
  }

  let grade: number = 0;
  for (let index: number = 0; index < lexicon.dayChars.length; index++) {
    const dayChar: string = lexicon.dayChars[index];
    if (dayChar.length > 0 && text.indexOf(lexicon.profileGradePrefix + dayChar) >= 0) {
      grade = index + 1;
      break;
    }
  }

  if (enrollmentYear === 0 && grade === 0) {
    return null;
  }

  const profile: StudentProfile = { name: '', studentId: '', major: '' };
  if (enrollmentYear > 0) {
    profile.enrollmentYear = enrollmentYear;
  }
  if (academicYear > 0) {
    profile.academicYear = academicYear;
  }
  if (grade > 0) {
    profile.grade = grade;
  }
  return profile;
}
