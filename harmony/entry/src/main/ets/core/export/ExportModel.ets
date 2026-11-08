// 职责：整学期课表导出模型（周视图行 / 整学期聚合卡片），对应 web timetable-export.mjs 的 exportWeekModel
//       与 buildSemesterOverviewModel。
// 依赖方向：只 import type core/types；最终课表由调用方注入 DayResolver（通常传 TimetableCore.resolveDay），
//       core 内不做运行时 import，因此这里不复制调课/请假/自定义课规则。
// 阶段：P5 导出与备份；日期换算最小实现与 TimetableCore 同口径（UTC 日期键）。
// 待确认：web 的 semesterOccurrences 只用学校原始行；鸿蒙导出统一走最终生效课表（resolveDay），口径更贴近用户所见。

import type { AppState, CourseRow, SemesterSnapshot } from '../types/AppState';

export type DayResolver = (dateKey: string) => CourseRow[];

export interface SemesterEntry {
  week: number;
  weekday: number;
  date: string;
  row: CourseRow;
}

export interface SemesterCard {
  key: string;
  weekday: number;
  startTime: string;
  endTime: string;
  name: string;
  teacher: string;
  room: string;
  study: boolean;
  custom: boolean;
  localActivity: boolean;
  remap: boolean;
  override: boolean;
  conflict: boolean;
  overlap: boolean;
  weeks: number[];
  firstDate: string;
  lastDate: string;
  count: number;
}

export interface SemesterModel {
  snapshot: SemesterSnapshot;
  totalWeeks: number;
  entries: SemesterEntry[];
  cards: SemesterCard[];
  columnCounts: number[];
  conflictCount: number;
  sourceKind: string;
  sourceLabel: string;
}

const WEEKDAY_COUNT: number = 7;
const MAX_WEEKS: number = 60;
const DAY_MS: number = 86400000;

export function isValidDateKey(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const time: number = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(time)) {
    return false;
  }
  return new Date(time).toISOString().slice(0, 10) === value;
}

export function addDaysKey(dateKey: string, amount: number): string {
  if (!isValidDateKey(dateKey)) {
    return '';
  }
  return new Date(Date.parse(dateKey + 'T00:00:00Z') + amount * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOfKey(dateKey: string): number {
  if (!isValidDateKey(dateKey)) {
    return 0;
  }
  return new Date(dateKey + 'T00:00:00Z').getUTCDay() || 7;
}

export function weekOfKey(snapshot: SemesterSnapshot, dateKey: string): number {
  if (!isValidDateKey(snapshot.startDate) || !isValidDateKey(dateKey)) {
    return 0;
  }
  const diff: number = Date.parse(dateKey + 'T00:00:00Z') - Date.parse(snapshot.startDate + 'T00:00:00Z');
  return Math.floor(diff / DAY_MS / 7) + 1;
}

function normalizeWeeks(weeks: number): number {
  if (typeof weeks !== 'number' || !Number.isInteger(weeks) || weeks < 1) {
    return 1;
  }
  return weeks > MAX_WEEKS ? MAX_WEEKS : weeks;
}

function isSkipped(row: CourseRow): boolean {
  return row.cancelled === true || row.vacant === true;
}

export function cardKeyOf(row: CourseRow): string {
  const study: string = row.source === 'study' ? '1' : '0';
  const custom: string = row.customCourse === true ? '1' : '0';
  return [
    String(weekdayOfKey(row.date)),
    row.startTime,
    row.endTime,
    row.name,
    row.teacher,
    row.room,
    study,
    custom
  ].join('|');
}

// 逐周逐日展开最终生效课表；跳过停课与空课位（与 web semesterOccurrences 口径一致）。
export function collectEntries(snapshot: SemesterSnapshot, resolve: DayResolver): SemesterEntry[] {
  const entries: SemesterEntry[] = [];
  if (snapshot === null || snapshot === undefined || !isValidDateKey(snapshot.startDate)) {
    return entries;
  }
  const total: number = normalizeWeeks(snapshot.weeks);
  for (let week = 1; week <= total; week++) {
    for (let index = 0; index < WEEKDAY_COUNT; index++) {
      const date: string = addDaysKey(snapshot.startDate, (week - 1) * WEEKDAY_COUNT + index);
      if (date === '') {
        continue;
      }
      const rows: CourseRow[] = resolve(date) || [];
      for (const row of rows) {
        if (row === null || row === undefined || isSkipped(row)) {
          continue;
        }
        entries.push({ week, weekday: weekdayOfKey(date), date, row });
      }
    }
  }
  return entries;
}

function addWeek(weeks: number[], week: number): void {
  if (weeks.indexOf(week) < 0) {
    weeks.push(week);
  }
}

export function cardsOf(entries: SemesterEntry[]): SemesterCard[] {
  const order: string[] = [];
  const byKey: Map<string, SemesterCard> = new Map<string, SemesterCard>();
  for (const entry of entries) {
    const row: CourseRow = entry.row;
    const key: string = cardKeyOf(row);
    let card: SemesterCard | undefined = byKey.get(key);
    if (card === undefined) {
      card = {
        key,
        weekday: weekdayOfKey(row.date),
        startTime: row.startTime,
        endTime: row.endTime,
        name: row.name,
        teacher: row.teacher,
        room: row.room,
        study: row.source === 'study',
        custom: row.customCourse === true,
        localActivity: row.localActivity === true,
        remap: row.remapId !== null && row.remapId !== undefined && row.remapId !== '',
        // CourseRow 没有 overrideId；本地来源且非自定义课程视为「本人修改」（数据源限制见报告）。
        override: row.source === 'local' && row.customCourse !== true,
        conflict: row.conflict === true,
        overlap: row.overlap === true,
        weeks: [],
        firstDate: entry.date,
        lastDate: entry.date,
        count: 0
      };
      byKey.set(key, card);
      order.push(key);
    }
    addWeek(card.weeks, entry.week);
    card.count = card.count + 1;
    if (entry.date < card.firstDate) {
      card.firstDate = entry.date;
    }
    if (entry.date > card.lastDate) {
      card.lastDate = entry.date;
    }
  }
  const cards: SemesterCard[] = [];
  for (const key of order) {
    const card: SemesterCard | undefined = byKey.get(key);
    if (card === undefined) {
      continue;
    }
    card.weeks.sort((a: number, b: number): number => a - b);
    cards.push(card);
  }
  cards.sort((a: SemesterCard, b: SemesterCard): number => {
    if (a.weekday !== b.weekday) {
      return a.weekday - b.weekday;
    }
    return a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name);
  });
  return cards;
}

export function buildSemesterModel(state: AppState, resolve: DayResolver): SemesterModel | null {
  const snapshot: SemesterSnapshot | null = state === null || state === undefined ? null : state.snapshot;
  if (snapshot === null || snapshot === undefined) {
    return null;
  }
  const entries: SemesterEntry[] = collectEntries(snapshot, resolve);
  const cards: SemesterCard[] = cardsOf(entries);
  let conflictCount: number = 0;
  for (const entry of entries) {
    if (entry.row.conflict === true) {
      conflictCount = conflictCount + 1;
    }
  }
  const source = snapshot.source;
  const sourceKind: string = source !== null && source !== undefined && typeof source.kind === 'string' ? source.kind : '';
  const sourceLabel: string = source !== null && source !== undefined && typeof source.label === 'string' ? source.label : '';
  const columnCounts: number[] = [0, 0, 0, 0, 0, 0, 0];
  for (const card of cards) {
    if (card.weekday >= 1 && card.weekday <= WEEKDAY_COUNT) {
      columnCounts[card.weekday - 1] = columnCounts[card.weekday - 1] + 1;
    }
  }
  return {
    snapshot,
    totalWeeks: normalizeWeeks(snapshot.weeks),
    entries,
    cards,
    columnCounts,
    conflictCount,
    sourceKind,
    sourceLabel
  };
}

export function weekEntries(model: SemesterModel, week: number): SemesterEntry[] {
  const list: SemesterEntry[] = model.entries.filter((entry: SemesterEntry): boolean => entry.week === week);
  list.sort((a: SemesterEntry, b: SemesterEntry): number => {
    if (a.weekday !== b.weekday) {
      return a.weekday - b.weekday;
    }
    return a.row.startTime.localeCompare(b.row.startTime) || a.row.key.localeCompare(b.row.key);
  });
  return list;
}

export function cardsForWeekday(cards: SemesterCard[], weekday: number): SemesterCard[] {
  return cards.filter((card: SemesterCard): boolean => card.weekday === weekday);
}

export function semesterSpanDays(model: SemesterModel): number {
  return model.totalWeeks * WEEKDAY_COUNT;
}
