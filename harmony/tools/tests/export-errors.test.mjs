// 职责：导出错误映射回归（真机 P0）——阶段化失败映射（取消/渲染/写盘/超限/不可用）与写盘实现静态契约。
// 运行：node harmony/tools/run-core-tests.mjs（本文件被其收集）。
// 说明：本机无 DevEco；ExportWorkflow 复制到 tmp 后由 Node 真执行，platform 文件只做源码级断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');
const HARMONY_ROOT = process.env.HARMONY_ROOT || path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..');
const ETS = path.join(HARMONY_ROOT, 'entry/src/main/ets');
const WORKFLOW = path.join(ETS, 'features/export/ExportWorkflow.ets');
const SAVE_PORT = path.join(ETS, 'platform/files/DocumentFileSavePort.ets');
const PICK_PORT = path.join(ETS, 'platform/files/DocumentFilePicker.ets');
const MESSAGES = path.join(ETS, 'platform/files/FilePortMessages.ets');
const REQUESTS = path.join(HARMONY_ROOT, 'tools/resource-requests/harmony-files.json');
const read = (file) => fs.readFileSync(file, 'utf8');
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
}

// 把 features 文件复制进 tmp，并给它依赖的 core 相对 import 补 .ts 扩展名（ArkTS 源码保持无扩展名）。
const dest = path.join(tmp, 'features/export/ExportWorkflow.ts');
fs.mkdirSync(path.dirname(dest), { recursive: true });
const patched = read(WORKFLOW).replace(/from '([^']+)'/g, (full, spec) => spec.startsWith('../../core/') ? "from '" + spec + ".ts'" : full);
fs.writeFileSync(dest, patched);
const W = await import(pathToFileURL(dest).href + '?v=' + Date.now());
const A = await import(pathToFileURL(path.join(tmp, 'core/types/AppState.ts')).href);

const RULES_COPY = {
  title: 'TITLE', generatedAt: 'AT {0}', semester: 'SEM {0}', weekdays: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'],
  nameLabel: 'NAME', teacherLabel: 'TEACHER', roomLabel: 'ROOM', timeLabel: 'TIME', weeksLabel: 'WEEKS',
  studyLabel: 'STUDY', customLabel: 'CUSTOM', unscheduledTitle: 'UNSCHEDULED', emptyNote: 'EMPTY',
  timeRange: '{0}-{1}', weekRange: '{0}-{1}w', weekSingle: '{0}w', weekAll: 'ALL', weekOdd: 'ODD', weekEven: 'EVEN',
  fieldSeparator: '\t', listSeparator: ',', commentPrefix: '#', lineBreak: '\n',
  webTitle: '# TITLE', semesterLine: 'SEM {0}', teachingWeeks: 'TEACH {0}|{1}|{2}',
  weekSpan: 'W{0}-{1}', weekOne: 'W{0}', generatedLine: 'GEN {0}', sourceLine: 'SRC {0}',
  sourceNote: 'NOTE', notesLine: 'NOTES', formatLine: 'FORMAT', courseName: 'COURSE', classTime: 'CLASSTIME',
  emptyLine: 'EMPTYLINE', period: 'P{0}', periodJoin: '+', segmentSpan: '{0}~{1}', noteLabel: 'NOTE-LABEL',
  unknownWeeks: 'UNKNOWN-WEEKS', unscheduledNote: 'UNSCHED-NOTE', conflictLine: 'CONFLICT {0}',
  patternAll: 'ALL', sourceSchool: 'SCHOOL', sourceSample: 'SAMPLE',
  normalizeOpen: '(', normalizeClose: ')', normalizeComma: ',', normalizeDash: '-',
  ordinalPrefix: '', weekSuffix: '', weekdayPrefix: 'W', unnamed: 'UNNAMED'
};
const COPY = {
  rules: RULES_COPY,
  panel: {
    title: 'EXPORT', intro: 'INTRO', overviewAction: 'OVERVIEW', pagesAction: 'PAGES', rulesAction: 'RULES',
    backupAction: 'BACKUP', restoreAction: 'RESTORE', diagnosticsAction: 'DIAG',
    statusBusy: 'BUSY', statusDone: 'DONE', statusFailed: 'FAILED', statusEmpty: 'EMPTY',
    pickerCancelled: 'CANCELLED', restoreOk: 'RESTORE-OK', restoreLegacy: 'LEGACY',
    restoreConfirmMessage: 'CONFIRM', fileOverview: 'overview', fileSemester: 'semester', fileRules: 'rules',
    filePrefix: 'jiangshui', samplePrefix: 'sample-', cancel: 'CANCEL', confirm: 'OK'
  },
  page: {
    weekTitle: 'WEEK {0}/{1}', semesterTitle: 'SEM {0}', timeColumn: 'TIME', weekdays: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'],
    stampLabel: 'AT {0}', emptyNote: 'EMPTY', overflowNote: 'OVER {0}/{1}', cardTime: '{0}-{1}', cardRoom: 'R {0}',
    cardTeacher: 'T {0}', tagRemap: 'R', tagOverride: 'O', tagCustom: 'C', tagStudy: 'S', tagOverlap: 'X',
    tagConflict: 'X2', continuation: 'C {0}/{1}', unscheduledTitle: 'UNSCHED', unscheduledItem: '{0} {1}',
    unscheduledMeta: '{0} {1}', overviewTitle: 'OVER', overviewSubtitleRange: 'R {0}-{1}', overviewSubtitleOne: 'O {0}',
    overviewNote: 'N', overviewTimeColumn: 'T', weeksPrefix: 'W {0}', overviewTimeRange: '{0}-{1}',
    placePrefix: 'P {0}', roomUnknown: 'RU', teacherPrefix: 'T {0}', teacherNone: 'TN', teacherUnknown: 'TU',
    overviewFooterEmpty: 'FE', overviewFooterEmptyPending: 'FEP {0}', overviewFooterPending: 'FP {0}',
    overviewFooterWeeks: 'FW {0}', overviewFooterWeeksOne: 'FW1', overviewFooterLegend: 'FL|',
    overviewRight: 'FR', overviewNotice: 'FN', weekTagShift: 'S', weekTagShiftFrom: 'SF {0}', weekTagPersonEdit: 'E',
    weekTagOverlap: 'O', weekTagConflict: 'C', weekTagConflictConfirm: 'CC'
  },
  diagnostics: {
    title: 'DIAG', generatedAt: 'AT {0}', appVersion: 'APP {0}', systemVersion: 'SYS {0}', apiVersion: 'API {0}',
    stateRevision: 'REV {0}', lastSyncAt: 'SYNC {0}', lastAttempt: 'TRY {0}', sectionEvents: 'EVENTS',
    sectionSources: 'SOURCES', none: 'NONE', unknownValue: 'UNKNOWN', eventLine: '- {0} {1}', sourceLine: '* {0} {1}',
    truncatedNote: 'TRUNC {0}/{1}'
  }
};

function makeState() {
  const state = A.createDefaultState();
  state.snapshot = { id: 's1', name: 'Semester', startDate: '2026-09-07', weeks: 2, rules: [], source: { kind: 'sample', label: 'x' } };
  return state;
}
function workflowWith(saver, picker) {
  return new W.ExportWorkflow(COPY, saver, picker || { pickText: async () => null });
}
const okSaver = { save: async () => ({ uri: 'file://docs/a.txt', mime: 'text/plain', bytes: 100, pages: 1 }) };

async function exportWith(saver) {
  return await workflowWith(saver).exportRulesText(makeState(), () => [], () => new Uint8Array(100), 1, 480);
}

test('export-errors-1 取消只映射为 EXPORT_CANCELLED，不再吞掉写盘失败', async () => {
  const canceled = await exportWith({ save: async () => { throw { code: 'FILE_CANCELED', message: 'user cancel' }; } });
  assert.equal(canceled.ok, false);
  assert.equal(canceled.code, W.STATUS_CANCELLED);
  const writeFailed = await exportWith({ save: async () => { throw { code: 'FILE_WRITE_FAILED', message: 'open failed' }; } });
  assert.equal(writeFailed.code, W.STATUS_WRITE_FAILED);
  assert.notEqual(writeFailed.code, W.STATUS_CANCELLED);
});

test('export-errors-2 写盘阶段未知异常落 FILE_WRITE_FAILED，保留已知稳定码', async () => {
  const unknown = await exportWith({ save: async () => { throw new Error('boom'); } });
  assert.equal(unknown.code, W.STATUS_WRITE_FAILED);
  const nullThrown = await exportWith({ save: async () => { throw null; } });
  assert.equal(nullThrown.code, W.STATUS_WRITE_FAILED);
  for (const code of ['FILE_TOO_LARGE', 'FILE_UNAVAILABLE', 'FILE_IO_FAILED', 'FILE_INVALID_PATH']) {
    const out = await exportWith({ save: async () => { throw { code: code }; } });
    assert.equal(out.code, code, code);
    assert.notEqual(out.code, W.STATUS_CANCELLED, code);
  }
});

test('export-errors-3 渲染/生成阶段异常映射为 EXPORT_RENDER_FAILED', async () => {
  const out = await workflowWith(okSaver).exportRulesText(makeState(), () => [], () => { throw new Error('encode failed'); }, 1, 480);
  assert.equal(out.ok, false);
  assert.equal(out.code, W.STATUS_RENDER_FAILED);
});

test('export-errors-4 成功写入保持 OK 与原 ExportResult', async () => {
  const out = await exportWith(okSaver);
  assert.equal(out.ok, true);
  assert.equal(out.code, W.STATUS_OK);
  assert.equal(out.result.bytes, 100);
});

test('export-errors-5 导入读取失败不再伪装取消，取消仍静默', async () => {
  const canceled = await workflowWith(okSaver, { pickText: async () => { throw { code: 'FILE_CANCELED' }; } }).previewRestore();
  assert.equal(canceled.code, W.STATUS_CANCELLED);
  const tooLarge = await workflowWith(okSaver, { pickText: async () => { throw { code: 'FILE_TOO_LARGE' }; } }).previewRestore();
  assert.equal(tooLarge.code, 'FILE_TOO_LARGE');
  const unknown = await workflowWith(okSaver, { pickText: async () => { throw new Error('read failed'); } }).previewRestore();
  assert.equal(unknown.code, 'FILE_IO_FAILED');
  const nullPick = await workflowWith(okSaver, { pickText: async () => null }).previewRestore();
  assert.equal(nullPick.code, W.STATUS_CANCELLED);
});

test('export-errors-6 写盘实现按官方 READ_WRITE 优先，且不再用 READ_WRITE|CREATE|TRUNC', () => {
  const code = stripComments(read(SAVE_PORT));
  assert.match(code, /fs\.OpenMode\.READ_WRITE\s*,/);
  assert.ok(!/READ_WRITE\s*\|\s*CREATE\s*\|\s*TRUNC/.test(code), '不得再用 READ_WRITE|CREATE|TRUNC 打开 picker URI');
  assert.ok(!/OpenMode\.TRUNC/.test(code), 'picker URI 写盘不再使用 TRUNC');
  assert.match(code, /FILE_WRITE_FAILED/);
  assert.match(code, /fs\.writeSync\(openedFile\.fd/);
  assert.match(code, /stat\.size\s*!==\s*copy\.byteLength/);
  assert.match(code, /Logger\.(info|warn|error)/);
});

test('export-errors-7 读盘失败有阶段日志，READ_ONLY 失败可回退 READ_WRITE', () => {
  const code = stripComments(read(PICK_PORT));
  assert.match(code, /OpenMode\.READ_ONLY/);
  assert.match(code, /OpenMode\.READ_WRITE/);
  assert.match(code, /read\s*!==\s*size/);
  assert.match(code, /Logger\.(info|warn|error)/);
});

test('export-errors-8 写失败有独立可见文案键并登记资源请求', () => {
  const messages = stripComments(read(MESSAGES));
  assert.match(messages, /FILE_WRITE_FAILED/);
  assert.match(messages, /file_error_write_failed/);
  const requests = JSON.parse(read(REQUESTS));
  assert.equal(typeof requests.file_error_write_failed, 'string');
  assert.ok(requests.file_error_write_failed.length > 0);
});

test('export-errors-9 适配层给 FILE_WRITE_FAILED 独立文案键，不落回 io', () => {
  const adapter = stripComments(read(path.join(ETS, 'features/files/ExportFilePorts.ets')));
  assert.match(adapter, /FILE_WRITE_FAILED/);
  assert.match(adapter, /file_error_write_failed/);
  assert.match(adapter, /statusOf\(/);
});
