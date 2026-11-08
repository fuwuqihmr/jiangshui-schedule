// Responsibility:render contract tests: canvas pixel sizing, page budgets, stable codes,
// plus source-level guards that the UI draws in page pixels and yields between PDF pages.
// Run via: node harmony/tools/run-core-tests.mjs (HARMONY_CORE_TMP points at the stripped core copy).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');
const HARMONY_ROOT = process.env.HARMONY_ROOT || path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..');
const ETS = path.join(HARMONY_ROOT, 'entry/src/main/ets');
const load = async (relative, tag) => import(pathToFileURL(path.join(tmp, relative)).href + '?' + tag + '=' + Date.now());
const B = await load('core/export/RenderBudget.ts', 'budget');
const S = await load('core/export/ImageSize.ts', 'size');
const read = (file) => fs.readFileSync(file, 'utf8');
const PANEL = read(path.join(ETS, 'features/export/ExportPanel.ets'));
const WORKFLOW = read(path.join(ETS, 'features/export/ExportWorkflow.ets'));

// 1) Canvas 单位合同：组件 vp = pagePx * px2vp(1)，乘回 density 必须精确等于 pagePx。
test('render-1 canvasSizeInVp 在 density 2/3/3.5/4 下回乘精确等于页面像素', () => {
  for (const density of [2, 3, 3.5, 4]) {
    for (const height of [1782, 2400, 4096]) {
      const size = B.canvasSizeInVp(2520, height, 1 / density);
      assert.equal(Math.round(size.width * density), 2520, 'density=' + density + ' width');
      assert.equal(Math.round(size.height * density), height, 'density=' + density + ' height');
    }
  }
  assert.equal(B.safeVpPerPx(0), 1);
  assert.equal(B.safeVpPerPx(-1), 1);
  assert.equal(B.safeVpPerPx(Number.NaN), 1);
  assert.equal(B.safeVpPerPx(0.25), 0.25);
});

test('render-2 页面预算：宽 2520 / 高 1782..4096 接受，越界返回稳定码', () => {
  assert.equal(B.pageBudgetCode(2520, 1782), '');
  assert.equal(B.pageBudgetCode(2520, 4096), '');
  assert.equal(B.pageBudgetCode(2520, 4097), B.CODE_RENDER_BUDGET);
  assert.equal(B.pageBudgetCode(2521, 1782), B.CODE_RENDER_BUDGET);
  assert.equal(B.pageBudgetCode(0, 1782), B.CODE_PAGE_INVALID);
  assert.equal(B.pageBudgetCode(2520, 1.5), B.CODE_PAGE_INVALID);
  assert.equal(B.pageBudgetCode(4000, 4000), B.CODE_RENDER_BUDGET);
  assert.equal(B.isExportPageSize(2520, 1782), true);
  assert.equal(B.isExportPageSize(8820, 6237), false);
});

test('render-3 页数与累计字节预算边界', () => {
  assert.equal(B.pageCountBudgetCode(1), '');
  assert.equal(B.pageCountBudgetCode(200), '');
  assert.equal(B.pageCountBudgetCode(201), B.CODE_RENDER_BUDGET);
  assert.equal(B.pageCountBudgetCode(0), B.CODE_PAGES_EMPTY);
  assert.equal(B.pageCountBudgetCode(-3), B.CODE_PAGES_EMPTY);
  assert.equal(B.imageBytesBudgetExceeded(0, B.RENDER_MAX_IMAGE_BYTES), false);
  assert.equal(B.imageBytesBudgetExceeded(B.RENDER_MAX_IMAGE_BYTES, 1), true);
  assert.equal(B.imageBytesBudgetExceeded(-1, -1), false);
});

test('render-4 PNG 尺寸解析：IHDR 宽高、坏签名与截断返回 null', () => {
  const png = new Uint8Array(32);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(png.buffer);
  view.setUint32(16, 2520);
  view.setUint32(20, 1782);
  assert.deepEqual(S.pngSizeOf(png), { width: 2520, height: 1782 });
  assert.deepEqual(S.imageSizeOf(png, 'image/png'), { width: 2520, height: 1782 });
  assert.equal(S.pngSizeOf(png.slice(0, 20)), null);
  const bad = png.slice();
  bad[0] = 0;
  assert.equal(S.pngSizeOf(bad), null);
});

test('render-5 JPEG 尺寸解析：SOF0 宽高、非 JPEG 与截断返回 null', () => {
  const jpeg = new Uint8Array(24);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00], 0);
  jpeg.set([0xff, 0xc0, 0x00, 0x0b, 0x08], 8);
  const view = new DataView(jpeg.buffer);
  view.setUint16(13, 2400);
  view.setUint16(15, 2520);
  assert.deepEqual(S.jpegSizeOf(jpeg), { width: 2520, height: 2400 });
  assert.deepEqual(S.imageSizeOf(jpeg, 'image/jpeg'), { width: 2520, height: 2400 });
  assert.equal(S.jpegSizeOf(new Uint8Array([1, 2, 3, 4])), null);
  assert.equal(S.jpegSizeOf(jpeg.slice(0, 12)), null);
  assert.equal(S.imageSizeOf(jpeg, 'image/webp'), null);
});

// 2) 源码合同：UI 必须按 px 构造画布并自检，PDF 编排必须让出主线程并先做预算。
test('render-6 ExportPanel 画布按 px2vp 换算、缩放绘制、尺寸容差且只建一个 ctx', () => {
  assert.match(PANEL, /px2vp\(1\)/);
  assert.match(PANEL, /canvasSizeInVp\(page\.width, page\.height, vpPerPx\)/);
  assert.match(PANEL, /ctx\.save\(\)/);
  assert.match(PANEL, /ctx\.scale\(vpPerPx, vpPerPx\)/);
  assert.match(PANEL, /ctx\.restore\(\)/);
  assert.match(PANEL, /imageSizeOf\(bytes, mime\)/);
  assert.match(PANEL, /classifyRenderSize\(actual\.width, actual\.height, page\.width, page\.height\)/);
  assert.match(PANEL, /SIZE_VERDICT_TOLERANCE/);
  assert.match(PANEL, /SIZE_VERDICT_REJECT/);
  assert.match(PANEL, /correctedCanvasVp\(/);
  assert.match(PANEL, /export-render-size-tolerance/);
  assert.ok(!/actual\.width !== page\.width/.test(PANEL), '不得再按精确 px 相等直接拒绝（整机舍入会整体不可用）');
  assert.ok(!PANEL.includes('this.previewWidth = page.width'), '不得再把页面像素直接当组件 vp 宽');
  assert.equal((PANEL.match(/new CanvasRenderingContext2D/g) || []).length, 1, '画布应单实例复用');
});

test('render-7 ExportWorkflow 先预算后渲染、逐页让出且暴露稳定码', () => {
  assert.match(WORKFLOW, /export function yieldToMainThread/);
  assert.match(WORKFLOW, /pageCountBudgetCode\(planned\.length\)/);
  assert.match(WORKFLOW, /pageBudgetCode\(page\.width, page\.height\)/);
  assert.match(WORKFLOW, /imageBytesBudgetExceeded\(imageBytes, jpeg\.jpeg\.length\)/);
  assert.match(WORKFLOW, /await yieldToMainThread\(\)/);
  assert.match(WORKFLOW, /STATUS_RENDER_BUDGET: string = CODE_RENDER_BUDGET/);
  assert.ok(WORKFLOW.indexOf('pageCountBudgetCode(planned.length)') < WORKFLOW.indexOf('render.renderJpeg(page)'), '预算检查必须先于任何渲染');
});

test('render-8 新 core 文件零 import、无 CJK、无硬编码颜色', () => {
  for (const file of ['RenderBudget.ets', 'ImageSize.ets']) {
    const src = read(path.join(ETS, 'core/export', file));
    assert.ok(!/^\s*import\b/m.test(src), file + ' 不得有 import（core 纯度门禁）');
    assert.ok(!/[\u3400-\u9fff]/.test(src), file + ' 不得含 CJK');
    assert.ok(!/#[0-9a-fA-F]{3,8}/.test(src), file + ' 不得含 #hex 颜色');
  }
});

// 3) 行为合同：把 ExportWorkflow 复制进 tmp 真执行（同做法）。
const dest = path.join(tmp, 'features/export/ExportWorkflow.ts');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, WORKFLOW.replace(/from '([^']+)'/g, (full, spec) => spec.startsWith('../../core/') ? "from '" + spec + ".ts'" : full));
const W = await import(pathToFileURL(dest).href + '?v=' + Date.now());
const A = await import(pathToFileURL(path.join(tmp, 'core/types/AppState.ts')).href);

const COPY = {
  rules: {
    title: 'T', generatedAt: 'AT {0}', semester: 'SEM {0}', weekdays: ['W1','W2','W3','W4','W5','W6','W7'],
    nameLabel: 'N', teacherLabel: 'TEA', roomLabel: 'ROOM', timeLabel: 'TIME', weeksLabel: 'WEEKS',
    studyLabel: 'STUDY', customLabel: 'CUSTOM', unscheduledTitle: 'UNSCHEDULED', emptyNote: 'EMPTY',
    timeRange: '{0}-{1}', weekRange: '{0}-{1}w', weekSingle: '{0}w', weekAll: 'ALL', weekOdd: 'ODD', weekEven: 'EVEN',
    fieldSeparator: '\t', listSeparator: ',', commentPrefix: '#', lineBreak: '\n',
    webTitle: '# T', semesterLine: 'SEM {0}', teachingWeeks: 'TEACH {0}', weekSpan: 'W{0}-{1}', weekOne: 'W{0}',
    generatedLine: 'GEN {0}', sourceLine: 'SRC {0}', sourceNote: 'NOTE', notesLine: 'NOTES', formatLine: 'FORMAT',
    courseName: 'COURSE', classTime: 'CLASS', emptyLine: 'EMPTYLINE', period: 'P{0}', periodJoin: '+', segmentSpan: '{0}~{1}',
    noteLabel: 'NOTE-LABEL', unknownWeeks: 'UNKNOWN', unscheduledNote: 'UNSCHED-NOTE', conflictLine: 'CONFLICT {0}',
    patternAll: 'ALL', sourceSchool: 'SCHOOL', sourceSample: 'SAMPLE', normalizeOpen: '(', normalizeClose: ')',
    normalizeComma: ',', normalizeDash: '-', ordinalPrefix: '', weekSuffix: '', weekdayPrefix: 'W', unnamed: 'UNNAMED'
  },
  panel: {
    title: 'E', intro: 'I', overviewAction: 'O', pagesAction: 'P', rulesAction: 'R', backupAction: 'B', restoreAction: 'RS',
    diagnosticsAction: 'D', statusDone: 'DONE', statusFailed: 'FAILED', statusEmpty: 'EMPTY', statusBusy: 'BUSY',
    statusNoSemester: 'NOSEM', filePrefix: 'jiangshui', pickerCancelled: 'CANCELED', restoreConfirmMessage: 'CONFIRM',
    cancel: 'NO', confirm: 'YES', restoreOk: 'ROK', restoreFailed: 'RFAIL', renderFailed: 'RENDER-FAIL',
    renderBudget: 'RENDER-BUDGET', restoreLegacy: 'LEGACY', fileOverview: 'overview', fileSemester: 'semester',
    fileRules: 'rules', samplePrefix: 'sample-'
  },
  page: {
    weekTitle: 'WEEK {0}/{1}', semesterTitle: 'SEMESTER', timeColumn: 'TIME', weekdays: ['W1','W2','W3','W4','W5','W6','W7'],
    stampLabel: 'AT {0}', emptyNote: 'EMPTY', overflowNote: 'OVER {0}/{1}', cardTime: '{0}-{1}', cardRoom: 'R {0}',
    cardTeacher: 'T {0}', tagRemap: 'REM', tagOverride: 'OVR', tagCustom: 'CUS', tagStudy: 'STU', tagOverlap: 'OVL',
    tagConflict: 'CON', continuation: 'CONT {0}/{1}', unscheduledTitle: 'UNSCHED', unscheduledItem: '{0} {1}',
    unscheduledMeta: '{0} {1}', overviewTitle: 'OVER', overviewSubtitleRange: 'R {0}-{1}', overviewSubtitleOne: 'O {0}',
    overviewNote: 'N', overviewTimeColumn: 'T', weeksPrefix: 'W {0}', overviewTimeRange: '{0}-{1}', placePrefix: 'P {0}',
    roomUnknown: 'RU', teacherPrefix: 'T {0}', teacherNone: 'TN', teacherUnknown: 'TU', overviewFooterEmpty: 'FE',
    overviewFooterEmptyPending: 'FEP {0}', overviewFooterPending: 'FP {0}', overviewFooterWeeks: 'FW {0}',
    overviewFooterWeeksOne: 'FW1', overviewFooterLegend: 'FL', overviewRight: 'FR', overviewNotice: 'FN',
    weekTagShift: 'S', weekTagShiftFrom: 'SF {0}', weekTagPersonEdit: 'PE', weekTagOverlap: 'O',
    weekTagConflict: 'C', weekTagConflictConfirm: 'CC'
  },
  diagnostics: {
    title: 'D', generatedAt: 'AT {0}', appVersion: 'APP {0}', systemVersion: 'SYS {0}', apiVersion: 'API {0}',
    stateRevision: 'REV {0}', lastSyncAt: 'SYNC {0}', lastAttempt: 'TRY {0}', sectionEvents: 'EVENTS',
    sectionSources: 'SOURCES', none: 'NONE', unknownValue: 'UNKNOWN', eventLine: '- {0} {1}', sourceLine: '* {0} {1}',
    truncatedNote: 'TRUNC {0}/{1}'
  }
};

function stateWithWeeks(weeks) {
  const state = A.createDefaultState();
  state.snapshot = { id: 's1', name: 'Semester', startDate: '2026-09-07', weeks: weeks, rules: [], source: { kind: 'sample', label: 'x' } };
  return state;
}
function renderer(counter, mode) {
  return {
    renderPng: async () => null,
    renderJpeg: async (page) => {
      counter.calls += 1;
      if (mode === 'null') return null;
      return { jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: page.width, height: page.height };
    }
  };
}

test('render-9 单周空课表 PDF：1 页、成功落盘、渲染 1 次', async () => {
  let saved = null;
  const saver = { save: async (name, mime, data, pages) => { saved = { name, pages, size: data.length }; return { uri: 'file://docs/a.pdf', mime: mime, bytes: data.length, pages: pages }; } };
  const counter = { calls: 0 };
  const w = new W.ExportWorkflow(COPY, saver, { pickText: async () => null });
  const outcome = await w.exportSemesterPages(stateWithWeeks(1), () => [], renderer(counter, 'ok'), 1700000000000, 480);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(counter.calls, 1);
  assert.equal(outcome.result.pages, 1);
  assert.match(saved.name, /^jiangshui-semester-2026-09-07\.pdf$/);
});

test('render-10 渲染返回 null → EXPORT_RENDER_FAILED，且不写盘', async () => {
  let saves = 0;
  const saver = { save: async () => { saves += 1; return { uri: 'x', mime: 'application/pdf', bytes: 1, pages: 1 }; } };
  const w = new W.ExportWorkflow(COPY, saver, { pickText: async () => null });
  const outcome = await w.exportSemesterPages(stateWithWeeks(1), () => [], renderer({ calls: 0 }, 'null'), 1700000000000, 480);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, W.STATUS_RENDER_FAILED);
  assert.equal(saves, 0);
});

test('render-11 超页数预算 → EXPORT_RENDER_BUDGET_EXCEEDED，一张都不渲染', async () => {
  let saves = 0;
  const saver = { save: async () => { saves += 1; return { uri: 'x', mime: 'application/pdf', bytes: 1, pages: 1 }; } };
  const counter = { calls: 0 };
  const w = new W.ExportWorkflow(COPY, saver, { pickText: async () => null });
  // 60 周上限 × 每日 4 张满时段卡 = 每周 4 页 → 240 页 > 200 页预算。
  const dense = [1, 2, 3, 4].map((i) => ({
    key: 'dense-' + i, name: 'DENSE-' + i, teacher: 'T', room: 'R', weekday: 1, dayOfWeek: 1,
    startTime: '00:00', endTime: '24:00', periods: [1], weeks: [1], cancelled: false, vacant: false, source: 'school'
  }));
  const outcome = await w.exportSemesterPages(stateWithWeeks(60), () => dense, renderer(counter, 'ok'), 1700000000000, 480);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, W.STATUS_RENDER_BUDGET);
  assert.equal(outcome.code, B.CODE_RENDER_BUDGET);
  assert.equal(counter.calls, 0);
  assert.equal(saves, 0);
  assert.equal(B.pageCountBudgetCode(201), B.CODE_RENDER_BUDGET);
});

// 4) m02356: +/-2 px tolerance, scale/crop instead of hard failure, catastrophic reject.
test('render-12 尺寸分类：容差内产出、超容差缩放、离谱才拒绝', () => {
  assert.equal(B.RENDER_SIZE_TOLERANCE, 2);
  assert.equal(B.RENDER_SIZE_RETRY_LIMIT, 2);
  const exact = B.classifyRenderSize(2520, 1782, 2520, 1782);
  assert.deepEqual(exact, { verdict: B.SIZE_VERDICT_OK, deltaWidth: 0, deltaHeight: 0 });
  const near = B.classifyRenderSize(2519, 1781, 2520, 1782);
  assert.equal(near.verdict, B.SIZE_VERDICT_TOLERANCE);
  assert.equal(near.deltaWidth, -1);
  assert.equal(near.deltaHeight, -1);
  const scale = B.classifyRenderSize(2510, 1770, 2520, 1782);
  assert.equal(scale.verdict, B.SIZE_VERDICT_SCALE);
  const tooLarge = B.classifyRenderSize(8820, 6237, 2520, 1782);
  assert.equal(tooLarge.verdict, B.SIZE_VERDICT_REJECT);
  const tooSmall = B.classifyRenderSize(1000, 600, 2520, 1782);
  assert.equal(tooSmall.verdict, B.SIZE_VERDICT_REJECT);
  assert.equal(B.classifyRenderSize(0, 1782, 2520, 1782).verdict, B.SIZE_VERDICT_REJECT);
  assert.equal(B.classifyRenderSize(2520, 1782, -1, 1782).verdict, B.SIZE_VERDICT_REJECT);
  const corrected = B.correctedCanvasVp(100, 100, 90, 80, 100, 100, 0.5);
  assert.equal(corrected.width, 105);
  assert.equal(corrected.height, 110);
  assert.deepEqual(B.correctedCanvasVp(100, 100, 100, 100, 100, 100, 0.5), { width: 100, height: 100 });
});

// 5) PDF must reserve the picker URI before any page is rendered.
test('render-13 PDF 渲染前先 reserve、渲染后 writeReserved', () => {
  assert.match(WORKFLOW, /export interface SaveReservation/);
  assert.match(WORKFLOW, /reserve\?:/);
  assert.match(WORKFLOW, /writeReserved\?:/);
  const reserveCall = WORKFLOW.indexOf('await port.reserve(name, spec.mime)');
  const renderCall = WORKFLOW.indexOf('render.renderJpeg(page)');
  assert.ok(reserveCall > 0, 'PDF 路径必须在渲染前调用 reserve');
  assert.ok(reserveCall < renderCall, 'reserve 必须先于第一页渲染');
  assert.match(WORKFLOW, /port\.writeReserved\(reservation, spec\.mime, data, pages\)/);
  assert.match(WORKFLOW, /export function savePortOf/);
  assert.ok(!/const reserve = this\.saver\.reserve/.test(WORKFLOW), '不得再解构端口方法（this 会丢失）');

  const savePort = read(path.join(ETS, 'platform/files/DocumentFileSavePort.ets'));
  assert.match(savePort, /async reserve\(suggestedName: string, mime: string\): Promise<SaveReservation>/);
  assert.match(savePort, /async writeReserved\(reservation: SaveReservation/);
  assert.ok(savePort.indexOf('openSavePicker(name)') < savePort.indexOf('return { token: uri }'), 'reserve 只选 URI，不写字节');
  assert.match(savePort, /this\.writeBytes\(reservation\.token, data\)/);

  const adapter = read(path.join(ETS, 'features/files/ExportFilePorts.ets'));
  assert.match(adapter, /reserve: \(name: string, mime: string\) => Promise<SaveReservation>/);
  assert.match(adapter, /writeReserved: \(reservation: SaveReservation, mime: string/);
  assert.match(adapter, /function callReserve\(port: FileSavePort/);
  assert.match(adapter, /return port\.reserve\(name, mime\)/);
  assert.match(adapter, /return port\.writeReserved\(reservation, mime, data, pages\)/);
  assert.ok(!/const target = ports\.saver\.reserve/.test(adapter), '适配层不得解构 platform 端口方法');
});

test('render-14 真实编排：先 reserve -> 渲染 -> writeReserved，不再第二次 save', async () => {
  const events = [];
  let reservedName = '';
  const saver = {
    save: async () => { events.push('save'); return { uri: 'file://docs/save.pdf', mime: 'application/pdf', bytes: 1, pages: 1 }; },
    reserve: async (name, mime) => { events.push('reserve'); reservedName = name; return { token: 'file://docs/reserved.pdf' }; },
    writeReserved: async (reservation, mime, data, pages) => {
      events.push('writeReserved');
      return { uri: reservation.token, mime: mime, bytes: data.length, pages: pages };
    }
  };
  const render = {
    renderPng: async () => null,
    renderJpeg: async (page) => {
      events.push('render');
      return { jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: page.width, height: page.height };
    }
  };
  const w = new W.ExportWorkflow(COPY, saver, { pickText: async () => null });
  const outcome = await w.exportSemesterPages(stateWithWeeks(1), () => [], render, 1700000000000, 480);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.deepEqual(events, ['reserve', 'render', 'writeReserved']);
  assert.equal(reservedName, 'jiangshui-semester-2026-09-07.pdf');
  assert.equal(outcome.result.uri, 'file://docs/reserved.pdf');
});

test('render-15 reserve 取消 -> EXPORT_CANCELLED，且一张都不渲染、不写盘', async () => {
  let renders = 0;
  let saves = 0;
  const saver = {
    save: async () => { saves += 1; return { uri: 'x', mime: 'application/pdf', bytes: 1, pages: 1 }; },
    reserve: async () => { throw { code: 'FILE_CANCELED' }; },
    writeReserved: async () => { throw { code: 'FILE_CANCELED' }; }
  };
  const render = {
    renderPng: async () => null,
    renderJpeg: async () => { renders += 1; return null; }
  };
  const w = new W.ExportWorkflow(COPY, saver, { pickText: async () => null });
  const outcome = await w.exportSemesterPages(stateWithWeeks(1), () => [], render, 1700000000000, 480);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, W.STATUS_CANCELLED);
  assert.equal(renders, 0);
  assert.equal(saves, 0);
});

// r5 真机 reserve 阶段 this 丢失（Cannot read property openSavePicker of undefined）。
class MethodSaver {
  constructor() {
    this.events = [];
    this.reservedName = "";
  }
  async openSavePicker() {
    this.events.push("picker");
    return { status: "success", uri: "file://docs/reserved.pdf", code: "OK" };
  }
  async save() {
    this.events.push("save");
    return { uri: "file://docs/save.pdf", mime: "application/pdf", bytes: 1, pages: 1 };
  }
  async reserve(name, mime) {
    this.events.push("reserve");
    this.reservedName = name;
    const picked = await this.openSavePicker();
    return { token: picked.uri };
  }
  async writeBytes() {
    this.events.push("writeBytes");
    return true;
  }
  async writeReserved(reservation, mime, data, pages) {
    this.events.push("writeReserved");
    await this.writeBytes();
    return { uri: reservation.token, mime: mime, bytes: data.length, pages: pages };
  }
}

test("port-1 注入真实类端口：PDF 走 reserve -> picker -> render -> writeReserved（this 不丢）", async () => {
  const saver = new MethodSaver();
  const render = {
    renderPng: async () => null,
    renderJpeg: async (page) => {
      saver.events.push("render");
      return { jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: page.width, height: page.height };
    }
  };
  const w = new W.ExportWorkflow(COPY, saver, { pickText: async () => null });
  const outcome = await w.exportSemesterPages(stateWithWeeks(1), () => [], render, 1700000000000, 480);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.code, W.STATUS_OK);
  assert.deepEqual(saver.events, ["reserve", "picker", "render", "writeReserved", "writeBytes"]);
  assert.equal(saver.reservedName, "jiangshui-semester-2026-09-07.pdf");
  assert.equal(outcome.result.uri, "file://docs/reserved.pdf");
});

test("port-2 未注入端口：PNG/PDF/TXT 都返回 FILE_UNAVAILABLE，零渲染零写盘", async () => {
  let renders = 0;
  const w = new W.ExportWorkflow(COPY, null, { pickText: async () => null });
  const render = {
    renderPng: async () => { renders += 1; return new Uint8Array([1]); },
    renderJpeg: async () => { renders += 1; return null; }
  };
  const state = stateWithWeeks(1);
  const overview = await w.exportOverview(state, () => [], render, 1700000000000, 480);
  const pdf = await w.exportSemesterPages(state, () => [], render, 1700000000000, 480);
  const rules = await w.exportRulesText(state, () => [], () => new Uint8Array([1]), 1700000000000, 480);
  for (const outcome of [overview, pdf, rules]) {
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "FILE_UNAVAILABLE");
    assert.equal(outcome.code, W.STATUS_UNAVAILABLE);
  }
  assert.equal(renders, 0);
});

test("port-3 三格式共用 savePortOf/savePort，适配层不再解构端口方法", () => {
  assert.match(WORKFLOW, /export function savePortOf\(saver: FileSavePort \| null \| undefined\): SavePortAccess \| null/);
  assert.match(WORKFLOW, /private savePort\(stage: string\): SavePortAccess \| null/);
  for (const method of ["exportOverview", "exportSemesterPages", "exportRulesText"]) {
    const start = WORKFLOW.indexOf("async " + method + "(");
    assert.ok(start > 0, method + " 必须存在");
    const block = WORKFLOW.slice(start, start + 1200);
    assert.match(block, /this\.savePort\('(save|reserve)'\)/, method + ' 必须通过统一入口取端口');
  }
  assert.equal((WORKFLOW.match(/deliver\(port,/g) || []).length >= 3, true, "三格式必须共用 deliver(port, ...)");
  assert.ok(!/const reserve = this\.saver\.reserve/.test(WORKFLOW), "不得解构 saver.reserve");
  assert.ok(!/const writer = saver\.writeReserved/.test(WORKFLOW), "不得解构 writeReserved");
  const adapter = read(path.join(ETS, "features/files/ExportFilePorts.ets"));
  assert.match(adapter, /function callReserve\(port: FileSavePort/);
  assert.match(adapter, /return port\.reserve\(name, mime\)/);
  assert.match(adapter, /return port\.writeReserved\(reservation, mime, data, pages\)/);
  assert.ok(!/const target = ports\.saver\.reserve/.test(adapter), "适配层不得解构 platform 端口方法");
});