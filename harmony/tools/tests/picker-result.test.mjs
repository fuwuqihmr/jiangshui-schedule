// 职责：picker Promise 形态回归——三态纯映射 + 真实 ExportWorkflow 三态 + 端口静态契约。
// 运行：node harmony/tools/run-core-tests.mjs（本文件被其收集）。
// 说明：本机无 DevEco；ExportWorkflow 复制到 tmp 后由 Node 真执行，platform 文件只做源码级断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP is not set; run via run-core-tests.mjs');
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

const naming = await import(pathToFileURL(path.join(tmp, 'core/files/FileNaming.ts')).href);
const A = await import(pathToFileURL(path.join(tmp, 'core/types/AppState.ts')).href);
const dest = path.join(tmp, 'features/export/ExportWorkflowPicker.ts');
fs.mkdirSync(path.dirname(dest), { recursive: true });
const patched = read(WORKFLOW).replace(/from '([^']+)'/g, (full, spec) => spec.startsWith('../../core/') ? "from '" + spec + ".ts'" : full);
fs.writeFileSync(dest, patched);
const W = await import(pathToFileURL(dest).href + '?v=' + Date.now());

const COPY = {
  rules: {
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
  },
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
function pickerSaver(uris, errorCode) {
  return {
    save: async () => {
      const picked = naming.mapPickerSaveResult(uris, errorCode);
      if (picked.status === 'canceled') throw { code: picked.code };
      if (picked.status === 'failed') throw { code: picked.code };
      return { uri: picked.uri, mime: 'text/plain', bytes: 100, pages: 1 };
    }
  };
}
async function exportWith(saver) {
  return await workflowWith(saver).exportRulesText(makeState(), () => [], () => new Uint8Array(100), 1, 480);
}

test('picker-result-1 picker 结果三态：非空 URI 成功、空列表取消、null/undefined 失败', () => {
  const success = naming.mapPickerSaveResult(['  file://docs/a.txt  '], 0);
  assert.deepEqual(success, { status: 'success', uri: 'file://docs/a.txt', code: '' });
  assert.deepEqual(naming.mapPickerSaveResult([], 0), { status: 'canceled', uri: '', code: 'FILE_CANCELED' });
  assert.deepEqual(naming.mapPickerSaveResult([''], 0), { status: 'canceled', uri: '', code: 'FILE_CANCELED' });
  assert.deepEqual(naming.mapPickerSaveResult(null, 0), { status: 'failed', uri: '', code: 'FILE_IO_FAILED' });
  assert.deepEqual(naming.mapPickerSaveResult(undefined, 0), { status: 'failed', uri: '', code: 'FILE_IO_FAILED' });
  assert.deepEqual(naming.mapPickerSaveResult('file://docs/a.txt', 0), { status: 'failed', uri: '', code: 'FILE_IO_FAILED' });
});

test('picker-result-2 取消码 13900042 与真机 -1 都映射取消，其它码映射失败', () => {
  assert.equal(naming.isPickerCancelCode(13900042), true);
  assert.equal(naming.isPickerCancelCode(-1), true);
  assert.equal(naming.isPickerCancelCode(0), false);
  assert.equal(naming.isPickerCancelCode(13900020), false);
  for (const code of [13900042, -1]) {
    assert.deepEqual(naming.mapPickerSaveResult(null, code), { status: 'canceled', uri: '', code: 'FILE_CANCELED' });
    assert.deepEqual(naming.mapPickerSaveResult(['file://docs/a.txt'], code), { status: 'canceled', uri: '', code: 'FILE_CANCELED' });
  }
  for (const code of [13900020, 801, 202]) {
    assert.deepEqual(naming.mapPickerSaveResult(null, code), { status: 'failed', uri: '', code: 'FILE_IO_FAILED' });
  }
});

test('picker-result-3 真实 ExportWorkflow：成功/取消/失败三态与映射串联', async () => {
  const ok = await exportWith(pickerSaver(['file://docs/rules.txt'], 0));
  assert.equal(ok.ok, true);
  assert.equal(ok.code, W.STATUS_OK);
  assert.equal(ok.result.uri, 'file://docs/rules.txt');

  const canceledByList = await exportWith(pickerSaver([], 0));
  assert.equal(canceledByList.ok, false);
  assert.equal(canceledByList.code, W.STATUS_CANCELLED);

  const canceledByCode = await exportWith(pickerSaver(null, 13900042));
  assert.equal(canceledByCode.code, W.STATUS_CANCELLED);

  const canceledByMinusOne = await exportWith(pickerSaver(null, -1));
  assert.equal(canceledByMinusOne.code, W.STATUS_CANCELLED);

  const failed = await exportWith(pickerSaver(undefined, 0));
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'FILE_IO_FAILED');
  assert.notEqual(failed.code, W.STATUS_CANCELLED);

  const failedByCode = await exportWith(pickerSaver(null, 801));
  assert.equal(failedByCode.code, 'FILE_IO_FAILED');
  assert.notEqual(failedByCode.code, W.STATUS_CANCELLED);
});

test('picker-result-4 SavePort 改为 Promise 形态且不再有 callback 判定', () => {
  const code = stripComments(read(SAVE_PORT));
  assert.match(code, /await\s+viewPicker\.save\(options\)/);
  assert.ok(!/viewPicker\.save\(options\s*,/.test(code), 'save must not use callback overload');
  assert.ok(!/new Promise<string\[\]>/.test(code), 'save must be a direct Promise, not a manual wrapper');
  assert.match(code, /mapPickerSaveResult\(uris,\s*0\)/);
  assert.match(code, /mapPickerSaveResult\(null,\s*errorCodeOf\(error\)\)/);
  assert.match(code, /stage=picker/);
  assert.match(code, /isSafePickedUri\(uri\)/);
});

test('picker-result-5 Picker 导入侧同样改为 Promise 形态', () => {
  const code = stripComments(read(PICK_PORT));
  assert.match(code, /await\s+viewPicker\.select\(options\)/);
  assert.ok(!/viewPicker\.select\(options\s*,/.test(code), 'select must not use callback overload');
  assert.ok(!/new Promise<string\[\]>/.test(code), 'select must be a direct Promise, not a manual wrapper');
  assert.match(code, /mapPickerSaveResult\(uris,\s*0\)/);
  assert.match(code, /mapPickerSaveResult\(null,\s*errorCodeOf\(error\)\)/);
  assert.match(code, /stage=picker/);
});

test('picker-result-6 取消仍有可见文案键且资源请求已登记', () => {
  const messages = stripComments(read(MESSAGES));
  assert.match(messages, /FILE_CANCELED/);
  assert.match(messages, /file_error_canceled/);
  const requests = JSON.parse(read(REQUESTS));
  assert.equal(typeof requests.file_error_canceled, 'string');
  assert.ok(requests.file_error_canceled.length > 0);
});
