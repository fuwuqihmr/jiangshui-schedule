// 职责：导出/备份/排查日志的全部中文文案注入契约（core 只留字段名，文案由 UI 层 $r 填充）。
// 依赖方向：只 import type core/types；零运行时 import，Node 可直接断言。
// 阶段：P5 导出与备份；新增文案写 tools/resource-requests/harmony-export.json，由 harmony-system 合入 string.json。
// 待确认：占位符统一 {0}/{1}，由 fillPattern 替换；core 内因此不出现任何中文字面量。

export interface RulesTextCopy {
  title: string;
  generatedAt: string;
  semester: string;
  weekdays: string[];
  nameLabel: string;
  teacherLabel: string;
  roomLabel: string;
  timeLabel: string;
  weeksLabel: string;
  studyLabel: string;
  customLabel: string;
  unscheduledTitle: string;
  emptyNote: string;
  timeRange: string;
  weekRange: string;
  weekSingle: string;
  weekAll: string;
  weekOdd: string;
  weekEven: string;
  fieldSeparator: string;
  listSeparator: string;
  commentPrefix: string;
  lineBreak: string;
  // —— 以下为 web buildRulesText 逐字口径——
  webTitle: string;
  semesterLine: string;
  teachingWeeks: string;
  weekSpan: string;
  weekOne: string;
  generatedLine: string;
  sourceLine: string;
  sourceNote: string;
  notesLine: string;
  formatLine: string;
  courseName: string;
  classTime: string;
  emptyLine: string;
  period: string;
  periodJoin: string;
  segmentSpan: string;
  noteLabel: string;
  unknownWeeks: string;
  unscheduledNote: string;
  conflictLine: string;
  patternAll: string;
  sourceSchool: string;
  sourceSample: string;
  normalizeOpen: string;
  normalizeClose: string;
  normalizeComma: string;
  normalizeDash: string;
  ordinalPrefix: string;
  weekSuffix: string;
  weekdayPrefix: string;
  unnamed: string;
}

export interface PageCopy {
  weekTitle: string;
  semesterTitle: string;
  timeColumn: string;
  weekdays: string[];
  stampLabel: string;
  emptyNote: string;
  overflowNote: string;
  cardTime: string;
  cardRoom: string;
  cardTeacher: string;
  // —— 以下为整学期 PNG / 每周 PDF 的标签与未排课附页（/④）——
  tagRemap: string;
  tagOverride: string;
  tagCustom: string;
  tagStudy: string;
  tagOverlap: string;
  tagConflict: string;
  continuation: string;
  unscheduledTitle: string;
  unscheduledItem: string;
  unscheduledMeta: string;
  // —— 以下为整学期单图（B）与周页（A）的 web 逐字口径——
  overviewTitle: string;
  overviewSubtitleRange: string;
  overviewSubtitleOne: string;
  overviewNote: string;
  overviewTimeColumn: string;
  weeksPrefix: string;
  overviewTimeRange: string;
  placePrefix: string;
  roomUnknown: string;
  teacherPrefix: string;
  teacherNone: string;
  teacherUnknown: string;
  overviewFooterEmpty: string;
  overviewFooterEmptyPending: string;
  overviewFooterPending: string;
  overviewFooterWeeks: string;
  overviewFooterWeeksOne: string;
  overviewFooterLegend: string;
  overviewRight: string;
  overviewNotice: string;
  weekTagShift: string;
  weekTagShiftFrom: string;
  weekTagPersonEdit: string;
  weekTagOverlap: string;
  weekTagConflict: string;
  weekTagConflictConfirm: string;
}

export interface DiagnosticsCopy {
  title: string;
  generatedAt: string;
  appVersion: string;
  systemVersion: string;
  apiVersion: string;
  stateRevision: string;
  lastSyncAt: string;
  lastAttempt: string;
  sectionEvents: string;
  sectionSources: string;
  none: string;
  unknownValue: string;
  eventLine: string;
  sourceLine: string;
  truncatedNote: string;
}

export interface PanelCopy {
  title: string;
  intro: string;
  overviewAction: string;
  pagesAction: string;
  rulesAction: string;
  backupAction: string;
  restoreAction: string;
  diagnosticsAction: string;
  statusDone: string;
  statusFailed: string;
  statusEmpty: string;
  statusBusy: string;
  statusNoSemester: string;
  filePrefix: string;
  pickerCancelled: string;
  restoreConfirmMessage: string;
  cancel: string;
  confirm: string;
  restoreOk: string;
  restoreFailed: string;
  renderFailed: string;
  renderBudget: string;
  restoreLegacy: string;
  restoreDemoExit: string;
  fileOverview: string;
  fileSemester: string;
  fileRules: string;
  samplePrefix: string;
}

export interface ExportCopy {
  rules: RulesTextCopy;
  page: PageCopy;
  diagnostics: DiagnosticsCopy;
  panel: PanelCopy;
}
