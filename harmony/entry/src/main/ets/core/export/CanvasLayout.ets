// 职责：整学期课表单图 / 周视图的纯布局计算（矩形与文本 op 数据），不含任何绘制与系统能力。
// 依赖方向：只 import type 同层 copy/model；零运行时 import（run-core-tests 纯度门禁要求）。
// 阶段：P5 导出与备份；像素渲染由 features/export/ExportPageView 用 ArkUI 组件还原，
//       位图编码由 platform/export（ImagePacker / componentSnapshot）负责，core 不 import Kit。
// 待确认：画布尺寸与配色沿用 web timetable-export.mjs 的 2520x1782 五色板；升级视觉需同步本文件与 Web。

import type { PageCopy } from './ExportCopy';
import type { CourseRow } from '../types/AppState';
import type { SemesterCard, SemesterEntry, SemesterModel } from './ExportModel';

export const EXPORT_PAGE_WIDTH: number = 2520;
export const EXPORT_PAGE_HEIGHT: number = 1782;
export const EXPORT_MARGIN: number = 68;
export const EXPORT_TIME_WIDTH: number = 126;
export const EXPORT_HEADER_BOTTOM: number = 316;
export const EXPORT_GRID_BOTTOM: number = 1610;
// 页头三段与表头的纵向基准（pageShell 使用；测试按这些常量断言互不重叠）。
// PageText.y 是文字顶，PagePainter 画时按 y + size*0.85 求 baseline。
export const PAGE_TITLE_TOP: number = 52;
export const PAGE_SEMESTER_TOP: number = 124;
export const PAGE_STAMP_TOP: number = 176;
export const PAGE_STAMP_SIZE: number = 26;
export const PAGE_HEADER_TOP: number = EXPORT_HEADER_BOTTOM - 64;
export const PAGE_HEADER_LABEL_TOP: number = EXPORT_HEADER_BOTTOM - 28;
export const PAGE_NUMBER_TOP: number = 1696;
export const PAGE_NUMBER_SIZE: number = 26;
export const EXPORT_COLUMN_COUNT: number = 7;
export const EXPORT_COLUMN_WIDTH: number = (EXPORT_PAGE_WIDTH - EXPORT_MARGIN * 2 - EXPORT_TIME_WIDTH) / EXPORT_COLUMN_COUNT;

export const OVERVIEW_BASE_HEIGHT: number = 1782;
export const OVERVIEW_SOFT_MAX: number = 3600;
export const OVERVIEW_HARD_MAX: number = 4096;
export const OVERVIEW_ROW_MIN: number = 120;
export const OVERVIEW_FOOTER_RESERVE: number = 172;
export const OVERVIEW_COMPACT_THRESHOLD: number = 5;
export const OVERVIEW_COMPACT_MAX_COLUMNS: number = 4;

export const PAGE_BACKGROUND: number = -1;
export const PALETTE_COUNT: number = 5;

// RGB 三元组：0 号是淡底，1 号是深字，对应 web PALETTE 的五组配色。
export const PALETTE_BACKGROUND: number[][] = [
  [237, 243, 255],
  [239, 247, 241],
  [244, 240, 252],
  [255, 245, 235],
  [237, 247, 250]
];
export const PALETTE_FOREGROUND: number[][] = [
  [48, 91, 157],
  [53, 111, 75],
  [110, 87, 150],
  [148, 97, 41],
  [45, 111, 131]
];

export interface BandSpec {
  startMinute: number;
  endMinute: number;
  optional: boolean;
}

// 三段作息带 + 早/午/晚三个可选带，与 web BAND_DEFS 一致（分钟为当日零点起算）。
export const BAND_DEFS: BandSpec[] = [
  { startMinute: 0, endMinute: 510, optional: true },
  { startMinute: 510, endMinute: 615, optional: false },
  { startMinute: 615, endMinute: 720, optional: false },
  { startMinute: 720, endMinute: 840, optional: true },
  { startMinute: 840, endMinute: 945, optional: false },
  { startMinute: 945, endMinute: 1080, optional: false },
  { startMinute: 1080, endMinute: 1440, optional: true }
];

export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: number;
  stroke: number;
  radius: number;
}

export interface PageText {
  text: string;
  x: number;
  y: number;
  size: number;
  color: number;
  bold: boolean;
}

export interface ExportPage {
  width: number;
  height: number;
  background: number;
  rects: PageRect[];
  texts: PageText[];
}

export type TextMeasure = (text: string, size: number, maxWidth: number) => number;

export interface BandBox {
  startMinute: number;
  endMinute: number;
  top: number;
  bottom: number;
}

export interface OverviewLayout {
  level: string;
  density: number;
  height: number;
  columns: number;
  cardWidth: number;
  scaleY: number;
  contentHeight: number;
  notice: string;
}

export const OVERVIEW_LEVEL_FULL: string = 'full';
export const OVERVIEW_LEVEL_COMPACT: string = 'compact';
const OVERVIEW_DENSITIES: number[] = [1, 0.92, 0.84, 0.72, 0.68, 0.64];
const TITLE_FONT_SIZE: number = 56;
const SUBTITLE_FONT_SIZE: number = 34;
const HEADER_FONT_SIZE: number = 30;
const CARD_TITLE_SIZE: number = 30;
const CARD_META_SIZE: number = 24;
const CARD_LINE_HEIGHT: number = 38;
const CARD_PADDING: number = 18;
const CARD_GAP: number = 10;

function localFill(pattern: string, values: string[]): string {
  let out: string = typeof pattern === 'string' ? pattern : '';
  for (let i = 0; i < values.length; i++) {
    out = out.split('{' + String(i) + '}').join(values[i]);
  }
  return out;
}

// 粗略字宽估算：CJK 记 1em，其余记 0.55em；无字体度量的平台上足够做换行估高。
export function defaultMeasure(text: string, size: number, maxWidth: number): number {
  const source: string = typeof text === 'string' ? text : '';
  if (source.length === 0) {
    return 1;
  }
  let width: number = 0;
  for (let i = 0; i < source.length; i++) {
    const code: number = source.charCodeAt(i);
    width += code >= 0x2e80 ? size : size * 0.55;
  }
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
    return 1;
  }
  const lines: number = Math.ceil(width / maxWidth);
  return lines < 1 ? 1 : lines;
}

// 按字符估算把一行文本切成多行（CJK 1em、其余 0.55em），与 defaultMeasure 同一套字宽假设。
export function wrapTextLines(text: string, size: number, maxWidth: number): string[] {
  const source: string = typeof text === 'string' ? text : '';
  const width: number = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : 0;
  const lines: string[] = [];
  if (source.length === 0 || width === 0) {
    return lines;
  }
  let line: string = '';
  let used: number = 0;
  for (let i = 0; i < source.length; i++) {
    const code: number = source.charCodeAt(i);
    const charWidth: number = code >= 0x2e80 ? size : size * 0.55;
    if (line.length > 0 && used + charWidth > width) {
      lines.push(line);
      line = source.charAt(i);
      used = charWidth;
    } else {
      line = line + source.charAt(i);
      used = used + charWidth;
    }
  }
  if (line.length > 0) {
    lines.push(line);
  }
  return lines;
}

// 周页卡片内容高度：标题按实际折行估高，其余行沿用固定行距。
function cardContentHeight(row: CourseRow, copy: PageCopy, innerWidth: number): number {
  const titleLines: string[] = wrapTextLines(row.name, CARD_TITLE_SIZE, innerWidth);
  const extraTitle: number = titleLines.length > 1 ? (titleLines.length - 1) * (CARD_TITLE_SIZE + 8) : 0;
  return CARD_PADDING * 2 + CARD_TITLE_SIZE + extraTitle + CARD_LINE_HEIGHT * weekMetaLinesOf(row, copy).length;
}

export function formatMinute(minute: number): string {
  const total: number = Math.max(0, Math.min(1439, Math.round(minute)));
  const hour: number = Math.floor(total / 60);
  const rest: number = total % 60;
  const hourText: string = hour < 10 ? '0' + String(hour) : String(hour);
  const restText: string = rest < 10 ? '0' + String(rest) : String(rest);
  return hourText + ':' + restText;
}

export function parseMinute(value: string): number {
  if (typeof value !== 'string' || value.length < 4) {
    return -1;
  }
  const hour: number = Number(value.slice(0, 2));
  const minute: number = Number(value.slice(3, 5));
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return -1;
  }
  return hour * 60 + minute;
}

export function totalBandMinutes(): number {
  let total: number = 0;
  for (const band of BAND_DEFS) {
    total += band.endMinute - band.startMinute;
  }
  return total;
}

export function layoutBands(top: number, bottom: number): BandBox[] {
  const boxes: BandBox[] = [];
  const totalHeight: number = Math.max(0, bottom - top);
  const minutes: number = totalBandMinutes();
  let cursor: number = top;
  for (const band of BAND_DEFS) {
    const span: number = band.endMinute - band.startMinute;
    const height: number = minutes === 0 ? 0 : totalHeight * span / minutes;
    boxes.push({ startMinute: band.startMinute, endMinute: band.endMinute, top: cursor, bottom: cursor + height });
    cursor += height;
  }
  return boxes;
}

export function minuteToY(minute: number, boxes: BandBox[]): number {
  if (boxes.length === 0) {
    return 0;
  }
  const target: number = Math.max(0, Math.min(1440, minute));
  for (const box of boxes) {
    if (target >= box.startMinute && target <= box.endMinute) {
      const span: number = box.endMinute - box.startMinute;
      const ratio: number = span === 0 ? 0 : (target - box.startMinute) / span;
      return box.top + (box.bottom - box.top) * ratio;
    }
  }
  return target < boxes[0].startMinute ? boxes[0].top : boxes[boxes.length - 1].bottom;
}

export function columnX(column: number, columnWidth: number): number {
  return EXPORT_MARGIN + EXPORT_TIME_WIDTH + column * columnWidth;
}

export function cardPalette(weekday: number): number {
  const index: number = Math.abs(weekday - 1) % PALETTE_COUNT;
  return index;
}

function weekdayNameOf(copy: PageCopy, weekday: number): string {
  if (weekday >= 1 && weekday <= copy.weekdays.length) {
    return copy.weekdays[weekday - 1];
  }
  return '';
}

function pushText(page: ExportPage, text: string, x: number, y: number, size: number, color: number, bold: boolean): void {
  if (text === null || text === undefined || text.length === 0) {
    return;
  }
  page.texts.push({ text, x, y, size, color, bold });
}

function entriesOfWeek(model: SemesterModel, week: number): SemesterEntry[] {
  const list: SemesterEntry[] = model.entries.filter((entry: SemesterEntry): boolean => entry.week === week);
  list.sort((a: SemesterEntry, b: SemesterEntry): number => {
    if (a.weekday !== b.weekday) {
      return a.weekday - b.weekday;
    }
    return a.row.startTime.localeCompare(b.row.startTime) || a.row.key.localeCompare(b.row.key);
  });
  return list;
}

// A 周页标签：调休自 <日期> / 本人修改 / 自定义 / 时间重叠 / 来源冲突（web :258-262）。
export function weekTagsOf(row: CourseRow, copy: PageCopy): string[] {
  const tags: string[] = [];
  const remapId: string = typeof row.remapId === 'string' ? row.remapId : '';
  if (remapId.length > 0) {
    const origin: string = typeof row.originDate === 'string' ? row.originDate : '';
    tags.push(origin.length > 0 ? localFill(copy.weekTagShiftFrom, [origin]) : copy.weekTagShift);
  }
  if (row.source === 'local' && row.customCourse !== true) {
    tags.push(copy.weekTagPersonEdit);
  }
  if (row.customCourse === true) {
    tags.push(copy.tagCustom);
  }
  if (row.overlap === true) {
    tags.push(copy.weekTagOverlap);
  }
  if (row.conflict === true) {
    tags.push(copy.weekTagConflict);
  }
  return tags;
}

function weekMetaLinesOf(row: CourseRow, copy: PageCopy): string[] {
  const lines: string[] = [];
  lines.push(localFill(copy.cardTime, [row.startTime, row.endTime]));
  lines.push(localFill(copy.cardRoom, [row.room]));
  if (row.teacher.length > 0) {
    lines.push(localFill(copy.cardTeacher, [row.teacher]));
  }
  const tags: string[] = weekTagsOf(row, copy);
  if (tags.length > 0) {
    lines.push(tags.join(' · '));
  }
  return lines;
}

// B 总览标签：自定义 / 晚自习 / 本人修改 / 调休 / 时间重叠 / 来源冲突，请确认（web :404-412）。
export function overviewTagsOf(card: SemesterCard, copy: PageCopy): string[] {
  const tags: string[] = [];
  if (card.custom) {
    tags.push(copy.tagCustom);
  }
  if (card.localActivity) {
    tags.push(copy.tagStudy);
  }
  if (card.override) {
    tags.push(copy.weekTagPersonEdit);
  }
  if (card.remap) {
    tags.push(copy.weekTagShift);
  }
  if (card.overlap) {
    tags.push(copy.weekTagOverlap);
  }
  if (card.conflict) {
    tags.push(copy.weekTagConflictConfirm);
  }
  return tags;
}

function pageShell(model: SemesterModel, copy: PageCopy, stamp: string, title: string): ExportPage {
  const page: ExportPage = {
    width: EXPORT_PAGE_WIDTH,
    height: EXPORT_PAGE_HEIGHT,
    background: PAGE_BACKGROUND,
    rects: [],
    texts: []
  };
  pushText(page, title, EXPORT_MARGIN, PAGE_TITLE_TOP, TITLE_FONT_SIZE, 0, true);
  pushText(page, model.snapshot.name, EXPORT_MARGIN, PAGE_SEMESTER_TOP, SUBTITLE_FONT_SIZE, 1, false);
  pushText(page, localFill(copy.stampLabel, [stamp]), EXPORT_MARGIN, PAGE_STAMP_TOP, PAGE_STAMP_SIZE, 1, false);
  pushText(page, copy.timeColumn, EXPORT_MARGIN, PAGE_HEADER_LABEL_TOP, HEADER_FONT_SIZE, 1, false);
  for (let weekday = 1; weekday <= EXPORT_COLUMN_COUNT; weekday++) {
    const x: number = columnX(weekday - 1, EXPORT_COLUMN_WIDTH);
    page.rects.push({ x, y: PAGE_HEADER_TOP, width: EXPORT_COLUMN_WIDTH - 8, height: 56, fill: cardPalette(weekday), stroke: -1, radius: 12 });
    pushText(page, weekdayNameOf(copy, weekday), x + 18, PAGE_HEADER_LABEL_TOP, HEADER_FONT_SIZE, cardPalette(weekday), true);
  }
  return page;
}

function gridLinesOf(page: ExportPage, boxes: BandBox[]): void {
  for (const box of boxes) {
    page.rects.push({ x: EXPORT_MARGIN, y: box.bottom - 1, width: EXPORT_PAGE_WIDTH - EXPORT_MARGIN * 2, height: 2, fill: -1, stroke: 0, radius: 0 });
  }
}

function paintWeekCard(page: ExportPage, entry: SemesterEntry, top: number, copy: PageCopy): number {
  const boxes: BandBox[] = layoutBands(EXPORT_HEADER_BOTTOM, EXPORT_GRID_BOTTOM);
  const start: number = parseMinute(entry.row.startTime);
  const end: number = parseMinute(entry.row.endTime);
  const bottom: number = minuteToY(end < 0 ? 1440 : end, boxes);
  const column: number = entry.weekday - 1;
  const palette: number = cardPalette(entry.weekday);
  const x: number = columnX(column, EXPORT_COLUMN_WIDTH) + 4;
  const width: number = EXPORT_COLUMN_WIDTH - 16;
  const lines: string[] = weekMetaLinesOf(entry.row, copy);
  const innerWidth: number = width - CARD_PADDING * 2;
  const titleLines: string[] = wrapTextLines(entry.row.name, CARD_TITLE_SIZE, innerWidth);
  const extraTitle: number = titleLines.length > 1 ? (titleLines.length - 1) * (CARD_TITLE_SIZE + 8) : 0;
  const contentHeight: number = cardContentHeight(entry.row, copy, innerWidth);
  const height: number = Math.max(Math.max(OVERVIEW_ROW_MIN / 2, bottom - top - 8), contentHeight);
  page.rects.push({ x, y: top + 4, width, height, fill: palette, stroke: palette, radius: 12 });
  for (let i = 0; i < titleLines.length; i++) {
    pushText(page, titleLines[i], x + CARD_PADDING, top + CARD_PADDING + CARD_TITLE_SIZE + i * (CARD_TITLE_SIZE + 8), CARD_TITLE_SIZE, palette, true);
  }
  for (let i = 0; i < lines.length; i++) {
    pushText(page, lines[i], x + CARD_PADDING, top + CARD_PADDING + CARD_TITLE_SIZE + extraTitle + CARD_LINE_HEIGHT * (i + 1), CARD_META_SIZE, palette, false);
  }
  return top + 4 + height;
}

export interface PlacedCard {
  entry: SemesterEntry;
  top: number;
}

// 单周页：按星期列贪心堆放，列内放不下就换页，保证不丢卡。
export function buildWeekPages(model: SemesterModel, week: number, copy: PageCopy, stamp: string): ExportPage[] {
  const boxes: BandBox[] = layoutBands(EXPORT_HEADER_BOTTOM, EXPORT_GRID_BOTTOM);
  const entries: SemesterEntry[] = entriesOfWeek(model, week);
  const pageCards: PlacedCard[][] = [];
  const pageTops: number[][] = [];
  const ensurePage = (index: number): void => {
    while (pageCards.length <= index) {
      pageCards.push([]);
      pageTops.push([EXPORT_HEADER_BOTTOM, EXPORT_HEADER_BOTTOM, EXPORT_HEADER_BOTTOM, EXPORT_HEADER_BOTTOM, EXPORT_HEADER_BOTTOM, EXPORT_HEADER_BOTTOM, EXPORT_HEADER_BOTTOM]);
    }
  };
  ensurePage(0);
  for (const entry of entries) {
    const start: number = parseMinute(entry.row.startTime);
    const timeTop: number = minuteToY(start < 0 ? 0 : start, boxes);
    const end: number = parseMinute(entry.row.endTime);
    const bottom: number = minuteToY(end < 0 ? 1440 : end, boxes);
    const innerWidth: number = EXPORT_COLUMN_WIDTH - 16 - CARD_PADDING * 2;
    const estimated: number = Math.max(Math.max(OVERVIEW_ROW_MIN / 2, bottom - timeTop - 8), cardContentHeight(entry.row, copy, innerWidth));
    let pageIndex: number = 0;
    let placed: boolean = false;
    while (!placed) {
      ensurePage(pageIndex);
      const column: number = entry.weekday - 1;
      const top: number = Math.max(pageTops[pageIndex][column], timeTop);
      if (top + 4 + estimated <= EXPORT_GRID_BOTTOM || pageCards[pageIndex].length === 0) {
        pageCards[pageIndex].push({ entry: entry, top: top });
        pageTops[pageIndex][column] = top + 4 + estimated + CARD_GAP;
        placed = true;
      } else {
        pageIndex++;
      }
    }
  }
  const pages: ExportPage[] = [];
  for (let index = 0; index < pageCards.length; index++) {
    const title: string = pageCards.length > 1
      ? localFill(copy.weekTitle, [String(week), String(model.totalWeeks)]) + ' · ' + String(index + 1) + '/' + String(pageCards.length)
      : localFill(copy.weekTitle, [String(week), String(model.totalWeeks)]);
    const page: ExportPage = pageShell(model, copy, stamp, title);
    gridLinesOf(page, boxes);
    if (pageCards[index].length === 0) {
      pushText(page, copy.emptyNote, EXPORT_MARGIN + EXPORT_TIME_WIDTH + 24, EXPORT_HEADER_BOTTOM + 48, HEADER_FONT_SIZE, 0, false);
    }
    for (const placedCard of pageCards[index]) {
      paintWeekCard(page, placedCard.entry, placedCard.top, copy);
    }
    if (pageCards.length > 1) {
      pushText(page, localFill(copy.continuation, [String(index + 1), String(pageCards.length)]), EXPORT_MARGIN, page.height - OVERVIEW_FOOTER_RESERVE / 2, HEADER_FONT_SIZE, 1, false);
    }
    pages.push(page);
  }
  return pages;
}

// 单页别名：保留旧调用点，等价于 buildWeekPages(...)[0]（起内部分页）。
export function buildWeekPage(model: SemesterModel, week: number, copy: PageCopy, stamp: string): ExportPage {
  return buildWeekPages(model, week, copy, stamp)[0];
}

// B overview card height (web :423-442 scope, simplified to fixed line metrics).
function overviewWeekText(card: SemesterCard, totalWeeks: number, weekLabel: (weeks: number[], total: number) => string): string {
  const text: string = weekLabel(card.weeks, totalWeeks);
  return typeof text === 'string' ? text : '';
}

export function overviewLinesOf(card: SemesterCard, copy: PageCopy, totalWeeks: number, weekLabel: (weeks: number[], total: number) => string): string[] {
  const lines: string[] = [];
  lines.push(localFill(copy.weeksPrefix, [overviewWeekText(card, totalWeeks, weekLabel)]));
  lines.push(localFill(copy.overviewTimeRange, [card.startTime, card.endTime]));
  const room: string = card.room.length > 0 ? card.room : copy.roomUnknown;
  lines.push(localFill(copy.placePrefix, [room]));
  const teacher: string = card.localActivity ? copy.teacherNone : (card.teacher.length > 0 ? card.teacher : copy.teacherUnknown);
  lines.push(localFill(copy.teacherPrefix, [teacher]));
  const tags: string[] = overviewTagsOf(card, copy);
  if (tags.length > 0) {
    lines.push(tags.join(' · '));
  }
  return lines;
}

function overviewCardHeightOf(card: SemesterCard, copy: PageCopy, measure: TextMeasure, density: number, cardWidth: number, totalWeeks: number, weekLabel: (weeks: number[], total: number) => string): number {
  const titleSize: number = Math.max(12, Math.round(CARD_TITLE_SIZE * density));
  const metaSize: number = Math.max(10, Math.round(CARD_META_SIZE * density));
  const lineHeight: number = Math.max(20, Math.round(CARD_LINE_HEIGHT * density));
  const padding: number = Math.max(8, Math.round(CARD_PADDING * density));
  const inner: number = Math.max(40, cardWidth - padding * 2);
  const titleCount: number = measure(card.name, titleSize, inner);
  let lineCount: number = 0;
  for (const line of overviewLinesOf(card, copy, totalWeeks, weekLabel)) {
    lineCount += measure(line, metaSize, inner);
  }
  const height: number = padding * 2 + titleCount * titleSize + (titleCount - 1) * 8 + lineCount * lineHeight;
  return Math.max(Math.round(OVERVIEW_ROW_MIN * density), height);
}

function columnHeightsOf(model: SemesterModel, copy: PageCopy, measure: TextMeasure, density: number, cardWidth: number, weekLabel: (weeks: number[], total: number) => string): number[] {
  const heights: number[] = [];
  for (let weekday = 1; weekday <= EXPORT_COLUMN_COUNT; weekday++) {
    let total: number = 0;
    const cards: SemesterCard[] = model.cards.filter((card: SemesterCard): boolean => card.weekday === weekday);
    for (const card of cards) {
      total += overviewCardHeightOf(card, copy, measure, density, cardWidth, model.totalWeeks, weekLabel) + CARD_GAP;
    }
    heights.push(total);
  }
  return heights;
}

function maxOf(values: number[]): number {
  let max: number = 0;
  for (const value of values) {
    max = Math.max(max, value);
  }
  return max;
}

function layoutOf(density: number, height: number, scaleY: number, contentHeight: number, notice: string): OverviewLayout {
  const cardWidth: number = (EXPORT_PAGE_WIDTH - EXPORT_MARGIN * 2 - EXPORT_TIME_WIDTH) / EXPORT_COLUMN_COUNT - CARD_GAP * 2;
  return {
    level: OVERVIEW_LEVEL_FULL,
    density: density,
    height: height,
    columns: EXPORT_COLUMN_COUNT,
    cardWidth: cardWidth,
    scaleY: scaleY,
    contentHeight: contentHeight,
    notice: notice
  };
}

// B is one image by contract (web :397-399, :512-529): height <=3600 grows the
// canvas, 3601..4096 keeps natural height, beyond that the image is fixed at
// 4096 and the content is squeezed vertically with a notice.
export function selectOverviewLayout(model: SemesterModel, copy: PageCopy, measure: TextMeasure, weekLabel: (weeks: number[], total: number) => string): OverviewLayout {
  let minimalContent: number = 0;
  for (const density of OVERVIEW_DENSITIES) {
    const heights: number[] = columnHeightsOf(model, copy, measure, density, layoutOf(density, OVERVIEW_BASE_HEIGHT, 1, 0, '').cardWidth, weekLabel);
    const content: number = maxOf(heights);
    const natural: number = EXPORT_HEADER_BOTTOM + content + OVERVIEW_FOOTER_RESERVE;
    if (natural <= OVERVIEW_SOFT_MAX) {
      return layoutOf(density, Math.max(OVERVIEW_BASE_HEIGHT, Math.round(natural)), 1, content, '');
    }
    minimalContent = content;
  }
  const natural: number = EXPORT_HEADER_BOTTOM + minimalContent + OVERVIEW_FOOTER_RESERVE;
  if (natural <= OVERVIEW_HARD_MAX) {
    return layoutOf(OVERVIEW_DENSITIES[OVERVIEW_DENSITIES.length - 1], Math.max(OVERVIEW_BASE_HEIGHT, Math.round(natural)), 1, minimalContent, '');
  }
  const available: number = OVERVIEW_HARD_MAX - EXPORT_HEADER_BOTTOM - OVERVIEW_FOOTER_RESERVE;
  const scaleY: number = Math.min(1, available / Math.max(1, minimalContent));
  return layoutOf(OVERVIEW_DENSITIES[OVERVIEW_DENSITIES.length - 1], OVERVIEW_HARD_MAX, scaleY, minimalContent, copy.overviewNotice);
}

function pendingCountOf(model: SemesterModel): number {
  const list = model.snapshot.unscheduled;
  return list === undefined ? 0 : list.length;
}

export function overviewFooterBase(model: SemesterModel, copy: PageCopy): string {
  const pending: number = pendingCountOf(model);
  const hasCourses: boolean = model.cards.length > 0;
  if (!hasCourses && pending === 0) {
    return copy.overviewFooterEmpty;
  }
  if (!hasCourses) {
    return localFill(copy.overviewFooterEmptyPending, [String(pending)]);
  }
  if (pending > 0) {
    return localFill(copy.overviewFooterPending, [String(pending)]);
  }
  const legend: string = model.totalWeeks >= 8 ? copy.overviewFooterLegend : '';
  const weeks: string = model.totalWeeks === 1
    ? copy.overviewFooterWeeksOne
    : localFill(copy.overviewFooterWeeks, [String(model.totalWeeks)]);
  return legend + weeks;
}

// B overview page: always exactly one image, no PDF branch .
export function buildOverviewPage(model: SemesterModel, copy: PageCopy, stamp: string, measure: TextMeasure, weekLabel: (weeks: number[], total: number) => string): ExportPage {
  const layout: OverviewLayout = selectOverviewLayout(model, copy, measure, weekLabel);
  const height: number = Math.max(OVERVIEW_BASE_HEIGHT, Math.min(OVERVIEW_HARD_MAX, Math.round(layout.height)));
  const page: ExportPage = {
    width: EXPORT_PAGE_WIDTH,
    height: height,
    background: PAGE_BACKGROUND,
    rects: [],
    texts: []
  };
  const scaleY: number = layout.scaleY;
  const scaleYOf = (rawY: number): number => EXPORT_HEADER_BOTTOM + (rawY - EXPORT_HEADER_BOTTOM) * scaleY;
  const title: string = copy.overviewTitle;
  pushText(page, title, EXPORT_MARGIN, EXPORT_MARGIN + TITLE_FONT_SIZE, TITLE_FONT_SIZE, 0, true);
  const subtitle: string = model.totalWeeks === 1
    ? localFill(copy.overviewSubtitleOne, [String(model.totalWeeks)])
    : localFill(copy.overviewSubtitleRange, ['1', String(model.totalWeeks)]);
  pushText(page, subtitle, EXPORT_MARGIN, EXPORT_MARGIN + TITLE_FONT_SIZE + SUBTITLE_FONT_SIZE + 8, SUBTITLE_FONT_SIZE, 1, false);
  pushText(page, model.snapshot.name, EXPORT_MARGIN, EXPORT_MARGIN + TITLE_FONT_SIZE + SUBTITLE_FONT_SIZE + HEADER_FONT_SIZE + 18, HEADER_FONT_SIZE, 1, false);
  pushText(page, copy.overviewNote, EXPORT_MARGIN, EXPORT_HEADER_BOTTOM - HEADER_FONT_SIZE - 12, HEADER_FONT_SIZE, 1, false);
  pushText(page, copy.overviewTimeColumn, EXPORT_MARGIN + 16, EXPORT_HEADER_BOTTOM - 28, HEADER_FONT_SIZE, 1, true);
  for (let weekday = 1; weekday <= EXPORT_COLUMN_COUNT; weekday++) {
    const x: number = columnX(weekday - 1, EXPORT_COLUMN_WIDTH);
    page.rects.push({ x, y: EXPORT_HEADER_BOTTOM - 64, width: EXPORT_COLUMN_WIDTH - 8, height: 56, fill: cardPalette(weekday), stroke: -1, radius: 12 });
    pushText(page, weekdayNameOf(copy, weekday), x + 16, EXPORT_HEADER_BOTTOM - 28, HEADER_FONT_SIZE, cardPalette(weekday), true);
  }
  if (model.cards.length === 0) {
    pushText(page, copy.emptyNote, EXPORT_MARGIN + EXPORT_TIME_WIDTH + 24, EXPORT_HEADER_BOTTOM + 48, HEADER_FONT_SIZE, 0, false);
  }
  const cursors: number[] = [];
  for (let weekday = 1; weekday <= EXPORT_COLUMN_COUNT; weekday++) {
    cursors.push(EXPORT_HEADER_BOTTOM + 10);
  }
  for (let weekday = 1; weekday <= EXPORT_COLUMN_COUNT; weekday++) {
    const x: number = columnX(weekday - 1, EXPORT_COLUMN_WIDTH) + CARD_GAP;
    const cards: SemesterCard[] = model.cards.filter((card: SemesterCard): boolean => card.weekday === weekday);
    const cardWidth: number = EXPORT_COLUMN_WIDTH - CARD_GAP * 2;
    for (const card of cards) {
      const top: number = cursors[weekday - 1];
      const rawHeight: number = overviewCardHeightOf(card, copy, measure, layout.density, cardWidth, model.totalWeeks, weekLabel);
      const palette: number = cardPalette(weekday);
      const padding: number = Math.max(8, Math.round(CARD_PADDING * layout.density));
      const titleSize: number = Math.max(12, Math.round(CARD_TITLE_SIZE * layout.density));
      const metaSize: number = Math.max(10, Math.round(CARD_META_SIZE * layout.density));
      const lineHeight: number = Math.max(20, Math.round(CARD_LINE_HEIGHT * layout.density));
      const inner: number = Math.max(40, cardWidth - padding * 2);
      const drawTop: number = scaleYOf(top);
      const drawHeight: number = rawHeight * scaleY;
      page.rects.push({ x, y: drawTop, width: cardWidth, height: drawHeight, fill: palette, stroke: palette, radius: 12 });
      const titleLines: string[] = wrapTextLines(card.name, titleSize, inner);
      let y: number = drawTop + padding * scaleY + Math.max(8, Math.round(titleSize * scaleY));
      for (const line of titleLines) {
        pushText(page, line, x + padding, y, Math.max(8, Math.round(titleSize * scaleY)), palette, true);
        y += (titleSize + 8) * scaleY;
      }
      y += lineHeight * scaleY;
      for (const line of overviewLinesOf(card, copy, model.totalWeeks, weekLabel)) {
        pushText(page, line, x + padding, y, Math.max(8, Math.round(metaSize * scaleY)), palette, false);
        y += lineHeight * scaleY;
      }
      cursors[weekday - 1] = top + rawHeight + CARD_GAP;
    }
  }
  const notice: string = layout.notice;
  const base: string = overviewFooterBase(model, copy);
  const showBase: boolean = !(notice.length > 0 && model.cards.length > 0 && pendingCountOf(model) === 0);
  const footer: string = notice.length > 0 && showBase ? notice + ' · ' + base : (notice.length > 0 ? notice : base);
  pushText(page, footer, EXPORT_MARGIN, height - 130, HEADER_FONT_SIZE, 1, notice.length > 0);
  pushText(page, copy.overviewRight, EXPORT_PAGE_WIDTH - EXPORT_MARGIN - 295, height - 88, HEADER_FONT_SIZE, 1, false);
  return page;
}

// 未排课附页（web :375-396 追加到整学期 PDF）：把预先拼好的纯文本行分页渲染成 2520x1782 页面。
export function buildTextPages(lines: string[], title: string, copy: PageCopy): ExportPage[] {
  const step: number = 56;
  const top: number = EXPORT_HEADER_BOTTOM;
  const capacity: number = Math.max(1, Math.floor((EXPORT_PAGE_HEIGHT - top - OVERVIEW_FOOTER_RESERVE) / step));
  const pages: ExportPage[] = [];
  const pageCount: number = Math.max(1, Math.ceil(lines.length / capacity));
  for (let index = 0; index < pageCount; index++) {
    const page: ExportPage = {
      width: EXPORT_PAGE_WIDTH,
      height: EXPORT_PAGE_HEIGHT,
      background: PAGE_BACKGROUND,
      rects: [],
      texts: []
    };
    const pageTitle: string = pageCount > 1 ? title + ' · ' + String(index + 1) + '/' + String(pageCount) : title;
    pushText(page, pageTitle, EXPORT_MARGIN, PAGE_TITLE_TOP, TITLE_FONT_SIZE, 0, true);
    const start: number = index * capacity;
    const end: number = Math.min(lines.length, start + capacity);
    for (let i = start; i < end; i++) {
      pushText(page, lines[i], EXPORT_MARGIN, top + (i - start + 1) * step, HEADER_FONT_SIZE, 0, false);
    }
    if (pageCount > 1) {
      pushText(page, localFill(copy.continuation, [String(index + 1), String(pageCount)]), EXPORT_MARGIN, EXPORT_PAGE_HEIGHT - OVERVIEW_FOOTER_RESERVE / 2, HEADER_FONT_SIZE, 1, false);
    }
    pages.push(page);
  }
  return pages;
}

// 页码统一为 n/N（web baseCanvas 的多页标题/页脚同款）。非法值按第 1 页兜底，n 不超过总页数。
export function formatPageNumber(pageNumber: number, pageCount: number): string {
  const total: number = Number.isFinite(pageCount) && pageCount > 0 ? Math.floor(pageCount) : 1;
  const raw: number = Number.isFinite(pageNumber) && pageNumber > 0 ? Math.floor(pageNumber) : 1;
  const current: number = Math.min(raw, total);
  return String(current) + '/' + String(total);
}

// 给整份 PDF 的每一页右下角补 n/N；总页数取传入数组长度，调用方必须在渲染前收齐所有页。
export function appendPageNumbers(pages: ExportPage[]): ExportPage[] {
  for (let i = 0; i < pages.length; i++) {
    pushText(
      pages[i],
      formatPageNumber(i + 1, pages.length),
      EXPORT_PAGE_WIDTH - EXPORT_MARGIN - 100,
      PAGE_NUMBER_TOP,
      PAGE_NUMBER_SIZE,
      1,
      false
    );
  }
  return pages;
}