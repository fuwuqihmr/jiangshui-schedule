// 职责：最终生效课表的纯逻辑实现，对应规格 §4.1/§6 P1。
// 依赖方向：仅 import type core/types；零运行时依赖，可被 Node type-strip 直接执行。
// 阶段：P1 数据层；覆盖周次、调休、休假、自定义课、晚自习、请假标记、变更 diff。
// 待确认：overrides/courseSettings 的复杂冲突合并规则以 web/core.mjs 后续金样本为准。
import type {
  AppState,
  ChangeRecord,
  CourseException,
  CourseRow,
  CourseRule,
  CourseSource,
  CustomCourse,
  DayOverride,
  HolidaySettings,
  LocalMapRule,
  RemapRule,
  SemesterSnapshot,
  StudyPolicy
} from '../types/AppState';
import type { LeaveRecord } from '../types/Leave';

export type DayCourse = CourseRow;

const MS_PER_DAY = 86400000;

export function isValidDate(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const time = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(time)) {
    return false;
  }
  return new Date(time).toISOString().slice(0, 10) === value;
}

export function addDays(dateKey: string, amount: number): string {
  if (!isValidDate(dateKey)) {
    throw new Error('STATE_CORRUPT');
  }
  const time = Date.parse(dateKey + 'T00:00:00Z') + amount * MS_PER_DAY;
  return new Date(time).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / MS_PER_DAY);
}

export function weekdayOf(dateKey: string): number {
  return new Date(dateKey + 'T00:00:00Z').getUTCDay() || 7;
}

export function weekOf(snapshot: SemesterSnapshot, dateKey: string): number {
  return Math.floor(daysBetween(snapshot.startDate, dateKey) / 7) + 1;
}

function ruleWeekday(rule: CourseRule): number {
  return typeof rule.weekday === 'number' ? rule.weekday : rule.dayOfWeek;
}

function rulePeriods(rule: CourseRule): number[] {
  if (rule.periods instanceof Array && rule.periods.length > 0) {
    return rule.periods.slice();
  }
  const result: number[] = [];
  for (let p = rule.startPeriod; p <= rule.endPeriod; p++) {
    result.push(p);
  }
  return result;
}

function customPeriods(course: CustomCourse): number[] {
  if (typeof course.startPeriod === 'number' && typeof course.endPeriod === 'number') {
    const result: number[] = [];
    for (let p = course.startPeriod; p <= course.endPeriod; p++) {
      result.push(p);
    }
    return result;
  }
  return [];
}

function cloneRow(row: CourseRow): CourseRow {
  return {
    key: row.key,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    periods: row.periods.slice(),
    name: row.name,
    teacher: row.teacher,
    room: row.room,
    cancelled: row.cancelled,
    vacant: row.vacant,
    localActivity: row.localActivity,
    customCourse: row.customCourse,
    remapId: row.remapId,
    conflict: row.conflict,
    overlap: row.overlap,
    source: row.source,
    originDate: row.originDate,
    ruleId: row.ruleId,
    weekday: row.weekday,
    leave: row.leave === true,
    pendingLeave: row.pendingLeave === true,
    sourceLabel: row.sourceLabel,
    customCourseId: row.customCourseId,
    vacancyReason: row.vacancyReason,
    movedTo: row.movedTo
  };
}

function applyPatch(row: CourseRow, override: DayOverride): CourseRow {
  const next = cloneRow(row);
  const patch = override.patch;
  if (patch.name !== undefined) {
    next.name = patch.name;
  }
  if (patch.teacher !== undefined) {
    next.teacher = patch.teacher;
  }
  if (patch.room !== undefined) {
    next.room = patch.room;
  }
  if (patch.startTime !== undefined) {
    next.startTime = patch.startTime;
  }
  if (patch.endTime !== undefined) {
    next.endTime = patch.endTime;
  }
  if (patch.periods !== undefined) {
    next.periods = patch.periods.slice();
  }
  if (patch.cancelled !== undefined) {
    next.cancelled = patch.cancelled;
  }
  next.source = 'local';
  return next;
}

interface HolidayInfo {
  kind: string;
  skipStudy: boolean;
}

function holidayForDate(settings: HolidaySettings | null, dateKey: string): HolidayInfo | null {
  if (!isValidDate(dateKey)) {
    return null;
  }
  const day = (settings?.days || []).find((item) => item.date === dateKey);
  for (const kind of ['winter', 'summer']) {
    const range = kind === 'winter' ? settings?.winter : settings?.summer;
    if (range && range.startDate <= dateKey && dateKey <= range.endDate) {
      return { kind, skipStudy: day === undefined ? false : day.skipStudy === true };
    }
  }
  if (day) {
    return { kind: 'day', skipStudy: day.skipStudy === true };
  }
  return null;
}

function localRemapMode(value: string | undefined): 'append' | 'replace' {
  // 旧版本地调休记录只按替换显示；仅显式 append 才合并。
  return value === 'append' ? 'append' : 'replace';
}

function allRemaps(snapshot: SemesterSnapshot, localMaps: LocalMapRule[]): RemapRule[] {
  const result: RemapRule[] = [];
  for (const remap of snapshot.remaps || []) {
    result.push(remap);
  }
  for (const local of localMaps) {
    result.push({ id: local.id, date: local.date, fromDate: local.fromDate, mode: localRemapMode(local.mode) });
  }
  return result;
}

function sourceDay(snapshot: SemesterSnapshot, dateKey: string, localMaps: LocalMapRule[]): CourseRow[] {
  const week = weekOf(snapshot, dateKey);
  if (week < 1 || week > snapshot.weeks) {
    return [];
  }
  const remaps = allRemaps(snapshot, localMaps);
  let list: CourseRow[] = [];
  if (!(snapshot.closedDates || []).includes(dateKey)) {
    list = baseDay(snapshot, dateKey, snapshot.rules.filter(
      (rule) => ruleWeekday(rule) === weekdayOf(dateKey) && rule.weeks.includes(week)
    ));
  }
  for (const remap of remaps) {
    if (remap.date !== dateKey) {
      continue;
    }
    if (remap.mode === 'replace') {
      list = [];
    }
    const mapped = baseDay(snapshot, remap.fromDate, snapshot.rules.filter(
      (rule) => ruleWeekday(rule) === weekdayOf(remap.fromDate)
    ));
    for (const row of mapped) {
      row.date = dateKey;
      row.key = `${dateKey}/${row.ruleId || row.key}/map-${remap.id}`;
      row.originDate = remap.fromDate;
      row.remapId = remap.id;
      list.push(row);
    }
  }
  for (const exception of snapshot.exceptions || []) {
    if (exception.date !== dateKey) {
      continue;
    }
    const filtered: CourseRow[] = [];
    for (const row of list) {
      if (row.ruleId !== exception.ruleId) {
        filtered.push(row);
        continue;
      }
      if (exception.cancel) {
        continue;
      }
      const patched = cloneRow(row);
      const patch = exception.patch;
      if (patch) {
        if (patch.name !== undefined) { patched.name = patch.name; }
        if (patch.teacher !== undefined) { patched.teacher = patch.teacher; }
        if (patch.room !== undefined) { patched.room = patch.room; }
        if (patch.startTime !== undefined) { patched.startTime = patch.startTime; }
        if (patch.endTime !== undefined) { patched.endTime = patch.endTime; }
        if (patch.periods !== undefined) { patched.periods = patch.periods.slice(); }
        if (patch.cancelled !== undefined) { patched.cancelled = patch.cancelled; }
      }
      filtered.push(patched);
    }
    list = filtered;
  }
  // 当天被手动调走时，原日普通课不再显示；目标日由 remapId 标记。
  if (localMaps.some((item) => item.fromDate === dateKey && item.date !== dateKey)) {
    list = list.filter((row) => row.remapId !== null);
  }
  return sortRows(list);
}

function baseDay(snapshot: SemesterSnapshot, dateKey: string, rules: CourseRule[]): CourseRow[] {
  const week = weekOf(snapshot, dateKey);
  if (week < 1 || week > snapshot.weeks) {
    return [];
  }
  // snapshot.source.kind 含 'sample'，不是合法 CourseSource；示例学期缺 source 的规则归为 'local'。
  const fallbackSource: CourseSource = snapshot.source.kind === 'school' ? 'school' : 'local';
  return rules.map((rule: CourseRule): CourseRow => {
    const row: CourseRow = {
      key: `${dateKey}/${rule.id}`,
      date: dateKey,
      startTime: rule.startTime,
      endTime: rule.endTime,
      periods: rulePeriods(rule),
      name: rule.name,
      teacher: rule.teacher,
      room: rule.room,
      cancelled: rule.cancelled,
      vacant: false,
      localActivity: false,
      customCourse: false,
      remapId: null,
      conflict: false,
      overlap: false,
      source: rule.source || fallbackSource,
      originDate: dateKey,
      ruleId: rule.id,
      weekday: ruleWeekday(rule),
      leave: false,
      pendingLeave: false,
      sourceLabel: rule.sourceLabel
    };
    return row;
  });
}

function selectedWeeks(course: CustomCourse): number[] {
  if (course.mode === 'once') {
    return [];
  }
  const result: number[] = [];
  const start = course.startWeek || 1;
  const end = course.endWeek || 1;
  for (let week = start; week <= end; week++) {
    const pattern = course.weekPattern || 'every';
    if (pattern === 'every' || week % 2 === (pattern === 'odd' ? 1 : 0)) {
      result.push(week);
    }
  }
  return result;
}

function customOccurrence(course: CustomCourse, dateKey: string, originDate: string, remapId: string | null): CourseRow {
  return {
    key: remapId === null ? `${dateKey}/${course.id}` : `${dateKey}/${course.id}/map-${remapId}`,
    date: dateKey,
    startTime: course.startTime,
    endTime: course.endTime,
    periods: customPeriods(course),
    name: course.name,
    teacher: course.teacher,
    room: course.room,
    cancelled: false,
    vacant: false,
    localActivity: false,
    customCourse: true,
    remapId,
    conflict: false,
    overlap: false,
    source: 'local',
    originDate,
    ruleId: course.id,
    customCourseId: course.id,
    sourceLabel: 'custom'
  };
}

function customDay(snapshot: SemesterSnapshot, dateKey: string, courses: CustomCourse[], localMaps: LocalMapRule[]): CourseRow[] {
  const remaps = allRemaps(snapshot, localMaps);
  const week = weekOf(snapshot, dateKey);
  const regular = (dayKey: string): CourseRow[] => {
    const dayWeek = weekOf(snapshot, dayKey);
    if (dayWeek < 1 || dayWeek > snapshot.weeks) {
      return [];
    }
    return courses.filter((course) => {
      if (course.mode !== 'weekly' || course.semesterId !== snapshot.id || course.semesterStartDate !== snapshot.startDate) {
        return false;
      }
      const weekdays = course.weekdays || (typeof course.dayOfWeek === 'number' ? [course.dayOfWeek] : []);
      return weekdays.includes(weekdayOf(dayKey)) && selectedWeeks(course).includes(dayWeek);
    }).map((course) => customOccurrence(course, dayKey, dayKey, null));
  };
  let list = (snapshot.closedDates || []).includes(dateKey) ? [] : regular(dateKey);
  for (const remap of remaps) {
    if (remap.date !== dateKey) {
      continue;
    }
    if (remap.mode === 'replace') {
      list = [];
    }
    const mapped = regular(remap.fromDate);
    for (const row of mapped) {
      row.key = `${dateKey}/${row.ruleId || row.key}/map-${remap.id}`;
      row.originDate = remap.fromDate;
      row.date = dateKey;
      row.remapId = remap.id;
      list.push(row);
    }
  }
  if (localMaps.some((item) => item.fromDate === dateKey && item.date !== dateKey)) {
    list = list.filter((row) => row.remapId !== null);
  }
  for (const once of courses) {
    if (once.mode === 'once' && once.date === dateKey) {
      list.push(customOccurrence(once, dateKey, dateKey, null));
    }
  }
  void week;
  return sortRows(list);
}

function academicYear(dateKey: string): number {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  return month >= 9 ? year : year - 1;
}

function resolveGrade(policy: StudyPolicy, dateKey: string): number | null {
  const profile = policy.profile;
  if (!profile) {
    return null;
  }
  const cohort = profile.enrollmentYear;
  const currentYear = academicYear(dateKey);
  if (typeof cohort === 'number' && Number.isInteger(cohort) && cohort >= 2000 && cohort <= currentYear) {
    const grade = currentYear - cohort + 1;
    return grade;
  }
  if (profile.academicYear === currentYear && typeof profile.grade === 'number') {
    return profile.grade;
  }
  return null;
}

function studyDay(
  snapshot: SemesterSnapshot,
  dateKey: string,
  localMaps: LocalMapRule[],
  holiday: HolidayInfo | null
): CourseRow[] {
  const policy = snapshot.studyPolicy;
  if (!isValidDate(dateKey) || !policy || policy.enabled !== true || policy.userEnabled !== true) {
    return [];
  }
  if (resolveGrade(policy, dateKey) !== 1) {
    return [];
  }
  const week = weekOf(snapshot, dateKey);
  if (week < 1 || week > snapshot.weeks) {
    return [];
  }
  // 晚自习独立于寒暑假/单日休假：仅显式 skipStudy=true 才停，默认保留。
  if (holiday !== null && holiday.skipStudy) {
    return [];
  }
  const remaps = allRemaps(snapshot, localMaps).filter((item) => item.date === dateKey);
  const origins: string[] = [dateKey];
  for (const remap of remaps) {
    origins.push(remap.fromDate);
  }
  const origin = origins.find((key) => {
    const day = weekdayOf(key);
    const originWeek = weekOf(snapshot, key);
    return [1, 2, 3, 4, 7].includes(day) && originWeek >= 1 && originWeek <= snapshot.weeks;
  });
  if (!origin) {
    return [];
  }
  const start = policy.startTime || '19:00';
  const end = policy.endTime || '20:30';
  const row: CourseRow = {
    key: `${dateKey}/local-evening-study`,
    date: dateKey,
    startTime: start,
    endTime: end,
    periods: [9, 10],
    name: 'study',
    teacher: '-',
    room: '-',
    cancelled: false,
    vacant: false,
    localActivity: true,
    customCourse: false,
    remapId: origin === dateKey ? null : (remaps.find((item) => item.fromDate === origin)?.id || null),
    conflict: false,
    overlap: false,
    source: 'local',
    originDate: origin,
    ruleId: 'local-evening-study',
    weekday: weekdayOf(dateKey),
    leave: false,
    pendingLeave: false,
    sourceLabel: policy.sourceLabel
  };
  return [row];
}

function sortRows(rows: CourseRow[]): CourseRow[] {
  return rows.sort((a: CourseRow, b: CourseRow): number => a.startTime.localeCompare(b.startTime) || a.key.localeCompare(b.key));
}

function overlaps(row: CourseRow, other: CourseRow): boolean {
  return !row.cancelled && !other.cancelled && row.startTime < other.endTime && other.startTime < row.endTime;
}

export function resolveDay(state: AppState, dateKey: string): CourseRow[] {
  const snapshot = state.snapshot;
  if (!snapshot || !isValidDate(dateKey)) {
    return [];
  }
  const holiday = holidayForDate(state.holidaySettings, dateKey);
  const localMaps = state.localMaps || [];
  let list: CourseRow[] = [];
  if (!holiday) {
    list = sourceDay(snapshot, dateKey, localMaps);
    list = list.concat(customDay(snapshot, dateKey, state.customCourses || [], localMaps));
  }
  list = list.concat(studyDay(snapshot, dateKey, localMaps, holiday));
  for (const override of state.overrides || []) {
    if (override.date !== dateKey) {
      continue;
    }
    const index = list.findIndex((row) => row.key === override.key);
    if (index >= 0) {
      list[index] = applyPatch(list[index], override);
    }
  }
  list = list.filter((row) => {
    if (!row.localActivity) {
      return true;
    }
    return !list.some((other) => other.key !== row.key && !other.localActivity && !other.cancelled && overlaps(row, other));
  });
  if (!holiday) {
    const moved = localMaps.find((item) => item.fromDate === dateKey && item.date !== dateKey);
    if (moved) {
      const originals = baseDay(snapshot, dateKey, snapshot.rules.filter(
        (rule) => ruleWeekday(rule) === weekdayOf(dateKey) && rule.weeks.includes(weekOf(snapshot, dateKey))
      ));
      const customRows = customDay(snapshot, dateKey, state.customCourses || [], []);
      for (const row of customRows) {
        const course = (state.customCourses || []).find((item) => item.id === row.customCourseId);
        if (course !== undefined && course.mode === 'weekly') {
          originals.push(row);
        }
      }
      for (const original of originals) {
        const occupied = list.some((row) => row.key === original.key ||
          (!row.cancelled && overlaps(row, original)));
        if (occupied) {
          continue;
        }
        const vacant = cloneRow(original);
        vacant.cancelled = true;
        vacant.vacant = true;
        vacant.vacancyReason = 'moved';
        vacant.movedTo = moved.date;
        list.push(vacant);
      }
    }
  }
  for (const row of list) {
    row.overlap = list.some((other) => other.key !== row.key && overlaps(row, other));
  }
  return sortRows(list);
}

export function markLeave(day: CourseRow[], records: LeaveRecord[]): CourseRow[] {
  const result = day.map((row) => {
    const next = cloneRow(row);
    next.leave = false;
    next.pendingLeave = false;
    return next;
  });
  for (const record of records || []) {
    // 只有请假/续假影响课程标记；销假记录不把课程标成请假。
    if (record.type !== 'leave' && record.type !== 'renew') {
      continue;
    }
    if (record.status !== 'approved' && record.status !== 'pending') {
      continue;
    }
    const recordStart = Date.parse(`${record.startDate}T${record.startTime}:00+08:00`);
    const recordEnd = Date.parse(`${record.endDate}T${record.endTime}:00+08:00`);
    if (!Number.isFinite(recordStart) || !Number.isFinite(recordEnd) || recordStart >= recordEnd) {
      continue;
    }
    for (const row of result) {
      if (!isValidDate(row.date)) {
        continue;
      }
      const courseStart = Date.parse(`${row.date}T${row.startTime}:00+08:00`);
      const courseEnd = Date.parse(`${row.date}T${row.endTime}:00+08:00`);
      if (!Number.isFinite(courseStart) || !Number.isFinite(courseEnd)) {
        continue;
      }
      if (courseStart < recordEnd && recordStart < courseEnd) {
        if (record.status === 'approved') {
          row.leave = true;
        } else if (row.leave !== true) {
          row.pendingLeave = true;
        }
      }
    }
  }
  return result;
}

export function semesterOccurrences(snapshot: SemesterSnapshot): CourseRow[] {
  const result: CourseRow[] = [];
  for (let i = 0; i < snapshot.weeks * 7; i++) {
    result.push(...sourceDay(snapshot, addDays(snapshot.startDate, i), []));
  }
  return result;
}

function signature(row: CourseRow): string {
  return [row.name, row.teacher, row.room, row.startTime, row.endTime,
    row.periods.join(','), row.cancelled ? '1' : '0'].join('|');
}

const DIFF_FIELDS: string[] = ['name', 'teacher', 'room', 'startTime', 'endTime', 'periods', 'cancelled'];

function diffFieldValue(row: CourseRow, field: string): string {
  if (field === 'periods') {
    return row.periods.join(',');
  }
  if (field === 'cancelled') {
    return row.cancelled ? '1' : '0';
  }
  if (field === 'name') {
    return row.name;
  }
  if (field === 'teacher') {
    return row.teacher;
  }
  if (field === 'room') {
    return row.room;
  }
  if (field === 'startTime') {
    return row.startTime;
  }
  if (field === 'endTime') {
    return row.endTime;
  }
  return '';
}

function diffType(kind: string, fields: string[]): string {
  if (kind === 'add') {
    return 'add';
  }
  if (kind === 'remove') {
    return 'remove';
  }
  if (fields.includes('startTime') || fields.includes('endTime') || fields.includes('periods')) {
    return 'time';
  }
  if (fields.includes('room')) {
    return 'room';
  }
  if (fields.includes('teacher')) {
    return 'teacher';
  }
  return 'update';
}

export function diffState(prev: AppState | null, next: AppState, nowMs: number = Date.now()): ChangeRecord[] {
  if (prev === null || prev.snapshot === null || next.snapshot === null) {
    return [];
  }
  const before = new Map<string, CourseRow>();
  for (const row of semesterOccurrences(prev.snapshot)) {
    before.set(row.key, row);
  }
  const after = new Map<string, CourseRow>();
  for (const row of semesterOccurrences(next.snapshot)) {
    after.set(row.key, row);
  }
  const result: ChangeRecord[] = [];
  const keys = new Set<string>();
  for (const key of before.keys()) {
    keys.add(key);
  }
  for (const key of after.keys()) {
    keys.add(key);
  }
  const nowIso = new Date(nowMs).toISOString();
  for (const key of keys) {
    const oldRow = before.get(key);
    const newRow = after.get(key);
    const row = newRow || oldRow;
    if (!row) {
      continue;
    }
    // 已结束的课程不再产生变更记录。
    const endAt = Date.parse(`${row.date}T${row.endTime}:00+08:00`);
    if (Number.isFinite(endAt) && endAt <= nowMs) {
      continue;
    }
    const changed: string[] = [];
    if (oldRow === undefined || newRow === undefined) {
      changed.push('name');
    } else {
      for (const field of DIFF_FIELDS) {
        if (diffFieldValue(oldRow, field) !== diffFieldValue(newRow, field)) {
          changed.push(field);
        }
      }
    }
    if (changed.length === 0 && oldRow !== undefined && newRow !== undefined &&
      signature(oldRow) === signature(newRow)) {
      continue;
    }
    const kind: 'add' | 'remove' | 'update' = oldRow === undefined ? 'add' : newRow === undefined ? 'remove' : 'update';
    const stable = row.ruleId !== undefined && row.ruleId !== '' ? row.ruleId :
      (row.customCourseId !== undefined && row.customCourseId !== '' ? row.customCourseId : row.key);
    result.push({
      id: `${nowIso}/${key}`,
      key,
      kind,
      stableKey: stable,
      date: row.date,
      title: row.name,
      detail: `start=${row.startTime};end=${row.endTime};room=${row.room}`,
      before: oldRow === undefined ? null : cloneRow(oldRow),
      after: newRow === undefined ? null : cloneRow(newRow),
      fields: changed,
      type: diffType(kind, changed),
      source: next.snapshot.source.kind,
      read: false,
      notifiedAt: null,
      detectedAt: nowIso,
      at: nowMs
    });
  }
  return result.sort((a: ChangeRecord, b: ChangeRecord): number => a.date.localeCompare(b.date) || a.stableKey.localeCompare(b.stableKey));
}
