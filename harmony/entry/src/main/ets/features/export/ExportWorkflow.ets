// 职责：导出/备份/排查日志的编排层（构建内容 → 校验体积与 MIME → 交给落盘端口），不含 ArkUI 与渲染。
// 依赖方向：features/export -> core/export 纯逻辑 + core/types；渲染端口与文件端口由调用方注入，
//          本文件不 import SDK，便于在无 IDE 时按代码顺序审查。
// 阶段：P5；页面接线见同目录 NAV.md，module.json5 权限清单由 harmony-system 统一改。
import type { AppState } from '../../core/types/AppState';
import type { ExportKind, ExportResult } from '../../core/types/Export';
import type { DiagnosticsSnapshot } from '../../core/types/Common';
import type { DayResolver, SemesterModel } from '../../core/export/ExportModel';
import type { ExportPage } from '../../core/export/CanvasLayout';
import type { ExportCopy } from '../../core/export/ExportCopy';
import type { PdfPageInput } from '../../core/export/PdfPages';
import type { DiagnosticsInput } from '../../core/export/DiagnosticsReport';
import { buildSemesterModel } from '../../core/export/ExportModel';
import { appendPageNumbers, buildOverviewPage, buildTextPages, buildWeekPages, defaultMeasure } from '../../core/export/CanvasLayout';
import { buildRulesText, formatWeekSpec, unscheduledWeeksText } from '../../core/export/ExportText';
import { buildImagePdf, buildSemesterPdfPlan, validatePdfPages } from '../../core/export/PdfPages';
import { CODE_RENDER_BUDGET, imageBytesBudgetExceeded, pageBudgetCode, pageCountBudgetCode } from '../../core/export/RenderBudget';
import {
  buildBackupJson,
  buildBackupFileName,
  parseBackupJson,
  summarizeBackup,
  validateRestoreState
} from '../../core/export/Backup';
import { buildDiagnosticsText } from '../../core/export/DiagnosticsReport';
import {
  buildDiagnosticsFileName,
  buildExportPrefix,
  buildWebExportFileName,
  exportFileSpec,
  formatStamp,
  validateExportPayload
} from '../../core/export/ExportFiles';

// 渲染端口：把 ExportPage 画成 PNG/JPEG 字节；实现见 PagePainter.ets + ExportPanel 的组件快照。
export interface PageRenderPort {
  renderPng: (page: ExportPage) => Promise<Uint8Array | null>;
  renderJpeg: (page: ExportPage) => Promise<PdfPageInput | null>;
}

// 预选保存位置：多页 PDF 渲染耗时长，先让用户选 URI 再渲染；渲染失败也不会白等。
// platform 实现（DocumentFileSavePort）提供这两个可选方法；只有 save 的端口走旧时序。
export interface SaveReservation {
  token: string;
}

// 落盘端口：实现见 platform/files/FileSaveService（DocumentViewPicker）。
export interface FileSavePort {
  save: (suggestedName: string, mime: string, data: Uint8Array, pages: number) => Promise<ExportResult>;
  reserve?: (suggestedName: string, mime: string) => Promise<SaveReservation>;
  writeReserved?: (reservation: SaveReservation, mime: string, data: Uint8Array, pages: number) => Promise<ExportResult>;
}

// 端口缺失/不可用的稳定码。PDF reserve 崩溃（r5）曾被误报成 FILE_WRITE_FAILED，必须区分。
export const STATUS_UNAVAILABLE: string = 'FILE_UNAVAILABLE';

// 端口访问的唯一获取点：三个导出格式 + 备份 + 日志都从这里取端口。
// 真机事故：把 saver.reserve 从实例上摘下再调用时 this 为 undefined，
// 于是 DocumentFileSavePort.reserve 内的 this.openSavePicker 抛 TypeError。这里用成员调用保住接收者。
export interface SavePortAccess {
  save: (suggestedName: string, mime: string, data: Uint8Array, pages: number) => Promise<ExportResult>;
  canTwoPhase: boolean;
  reserve: (suggestedName: string, mime: string) => Promise<SaveReservation>;
  writeReserved: (reservation: SaveReservation, mime: string, data: Uint8Array, pages: number) => Promise<ExportResult>;
}

function callReserve(port: FileSavePort, name: string, mime: string): Promise<SaveReservation> {
  if (port.reserve === undefined) {
    return Promise.reject(new Error(STATUS_UNAVAILABLE));
  }
  return port.reserve(name, mime);
}

function callWriteReserved(
  port: FileSavePort,
  reservation: SaveReservation,
  mime: string,
  data: Uint8Array,
  pages: number
): Promise<ExportResult> {
  if (port.writeReserved === undefined) {
    return Promise.reject(new Error(STATUS_UNAVAILABLE));
  }
  return port.writeReserved(reservation, mime, data, pages);
}

// 缺失端口返回 null；调用方必须在渲染/选文件之前转成 STATUS_UNAVAILABLE，不能落成 JS 异常。
export function savePortOf(saver: FileSavePort | null | undefined): SavePortAccess | null {
  if (saver === null || saver === undefined) {
    return null;
  }
  const port: FileSavePort = saver;
  if (typeof port.save !== 'function') {
    return null;
  }
  const canTwoPhase: boolean = typeof port.reserve === 'function' && typeof port.writeReserved === 'function';
  const access: SavePortAccess = {
    save: (name: string, mime: string, data: Uint8Array, pages: number): Promise<ExportResult> => port.save(name, mime, data, pages),
    canTwoPhase: canTwoPhase,
    reserve: (name: string, mime: string): Promise<SaveReservation> => callReserve(port, name, mime),
    writeReserved: (reservation: SaveReservation, mime: string, data: Uint8Array, pages: number): Promise<ExportResult> =>
      callWriteReserved(port, reservation, mime, data, pages)
  };
  return access;
}

// 选文件端口：备份导入读取文本；取消时返回 null。
export interface FilePickPort {
  pickText: () => Promise<string | null>;
}

// 状态落地端口：备份导入校验通过后才允许调用（坏数据绝不能覆盖现有状态）。
export interface StateApplyPort {
  apply: (next: AppState) => Promise<boolean>;
}

// ArkTS 的 arkts-no-untyped-obj-literals 不允许跨模块用字面量直接实现接口方法，
// 端口实例统一从本文件的工厂函数生成（接口与字面量在同一模块内）。
export function makePageRenderPort(
  renderPng: (page: ExportPage) => Promise<Uint8Array | null>,
  renderJpeg: (page: ExportPage) => Promise<PdfPageInput | null>
): PageRenderPort {
  return { renderPng: renderPng, renderJpeg: renderJpeg };
}

export function makeStateApplyPort(apply: (next: AppState) => Promise<boolean>): StateApplyPort {
  return { apply: apply };
}

// 逐页渲染之间让出主线程：toDataURL 是同步重活，连续多页不 yield 会触发 THREAD_BLOCK_3S。
const RENDER_YIELD_MS: number = 1;

export function yieldToMainThread(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(() => { resolve(); }, RENDER_YIELD_MS);
  });
}

export interface ExportOutcome {
  ok: boolean;
  code: string;
  result: ExportResult | null;
}

export interface RestoreOutcome {
  ok: boolean;
  code: string;
  summary: string;
  // 导入前处于示例模式、而备份是真实数据：UI 据此提示「已退出示例模式」。
  leftDemo: boolean;
}

export interface RestorePreview {
  ok: boolean;
  code: string;
  summary: string;
  state: AppState | null;
}

export const STATUS_OK: string = 'OK';
export const STATUS_CANCELLED: string = 'EXPORT_CANCELLED';
export const STATUS_NO_SEMESTER: string = 'EXPORT_NO_SEMESTER';
export const STATUS_RENDER_FAILED: string = 'EXPORT_RENDER_FAILED';
// 页数/像素/累计字节超预算：在渲染前或渲染中尽早失败，避免 OOM 与写半截文件。
export const STATUS_RENDER_BUDGET: string = CODE_RENDER_BUDGET;
// 写盘阶段失败：picker 已返回 URI，但 open/write/校验失败；不得再伪装成用户取消。
export const STATUS_WRITE_FAILED: string = 'FILE_WRITE_FAILED';
// 备份恢复失败分阶段码：解析用 parseBackupJson 的原生码（如 BACKUP_INVALID_JSON）；
// 校验失败用 validateRestoreState 的 BACKUP_STATE_INVALID；写盘/应用分开，禁止再统一成 APPLY_FAILED。
export const STATUS_RESTORE_SAVE_FAILED: string = 'EXPORT_BACKUP_SAVE_FAILED';
export const STATUS_RESTORE_APPLY_FAILED: string = 'EXPORT_BACKUP_APPLY_FAILED';

// 备份导入的错误码文案由 UI 用 resource 描述；这里只保留机器码，便于测试断言。
function invalid(code: string): ExportOutcome {
  return { ok: false, code, result: null };
}

function outcomeOf(result: ExportResult | null, code: string): ExportOutcome {
  if (result === null) {
    return { ok: false, code, result: null };
  }
  return { ok: true, code, result };
}

// 端口异常只带稳定 code（platform 的 FilePortError）；不 import platform，避免 features 反向依赖。
interface CodedError {
  code?: string;
  message?: string;
}

function codeOfError(error: Error): string {
  if (error === null || error === undefined) {
    return '';
  }
  const typed: CodedError = error as CodedError;
  return typed.code === undefined ? '' : typed.code;
}

// 日志只写阶段名、稳定码与截断后的可打印 message；不写文件内容、URI、Cookie。
function safeMessageOf(error: Error): string {
  if (error === null || error === undefined) {
    return '';
  }
  const typed: CodedError = error as CodedError;
  const raw: string = typed.message === undefined ? '' : typed.message;
  let text: string = '';
  for (let i = 0; i < raw.length; i++) {
    const unit: number = raw.charCodeAt(i);
    if (unit >= 32 && unit !== 127) {
      text += raw.charAt(i);
    }
  }
  return text.length > 160 ? text.slice(0, 160) : text;
}

function logStageFailure(stage: string, code: string, error: Error): void {
  console.error('export-failure stage=' + stage + ' code=' + code + ' message=' + safeMessageOf(error));
}

// 取消只认 FILE_CANCELED / EXPORT_CANCELLED；写盘阶段的其它异常一律保留原稳定码或落 FILE_WRITE_FAILED。
function statusForSaveFailure(error: Error): string {
  const code: string = codeOfError(error);
  if (code === STATUS_CANCELLED || code === 'FILE_CANCELED') {
    return STATUS_CANCELLED;
  }
  const known: string[] = [
    STATUS_WRITE_FAILED,
    'FILE_IO_FAILED',
    'FILE_TOO_LARGE',
    'FILE_UNAVAILABLE',
    'FILE_UNSUPPORTED',
    'FILE_EMPTY',
    'FILE_INVALID_PATH',
    'FILE_NAME_INVALID',
    'FILE_TIME_INVALID'
  ];
  return known.indexOf(code) >= 0 ? code : STATUS_WRITE_FAILED;
}

function statusForPickFailure(error: Error): string {
  const code: string = codeOfError(error);
  if (code === STATUS_CANCELLED || code === 'FILE_CANCELED') {
    return STATUS_CANCELLED;
  }
  return code.length > 0 ? code : 'FILE_IO_FAILED';
}

function renderFailure(error: Error): ExportOutcome {
  logStageFailure('render', STATUS_RENDER_FAILED, error);
  return invalid(STATUS_RENDER_FAILED);
}

// 统一落盘：任何端口异常都按稳定码映射，绝不把写盘失败当取消。
async function savePayload(
  port: SavePortAccess,
  name: string,
  mime: string,
  data: Uint8Array,
  pages: number
): Promise<ExportOutcome> {
  try {
    const result = await port.save(name, mime, data, pages);
    return outcomeOf(result, STATUS_OK);
  } catch (err) {
    const code: string = statusForSaveFailure(err as Error);
    logStageFailure('save', code, err as Error);
    return invalid(code);
  }
}

function exportNameOf(prefix: string, kind: ExportKind, label: string, startDate: string): string {
  return buildWebExportFileName({
    prefix: prefix,
    label: label,
    startDate: startDate,
    kind: kind
  });
}

// 统一「校验 → 落盘」：校验失败直接返回错误码，不调用 save，避免写入半截文件。
// reservation 非空表示渲染前已经让用户选好 URI；此时只写预留位置，不再弹第二次 picker。
async function deliver(
  port: SavePortAccess,
  prefix: string,
  kind: ExportKind,
  label: string,
  startDate: string,
  data: Uint8Array,
  pages: number,
  nowMs: number,
  offsetMinutes: number,
  reservation: SaveReservation | null
): Promise<ExportOutcome> {
  const spec = exportFileSpec(kind);
  const name = exportNameOf(prefix, kind, label, startDate);
  const check = validateExportPayload(spec.mime, spec.extension, name, data.length);
  if (!check.ok) {
    return invalid(check.code);
  }
  if (reservation !== null) {
    try {
      const result = await port.writeReserved(reservation, spec.mime, data, pages);
      return outcomeOf(result, STATUS_OK);
    } catch (err) {
      const code: string = statusForSaveFailure(err as Error);
      logStageFailure('save', code, err as Error);
      return invalid(code);
    }
  }
  return await savePayload(port, name, spec.mime, data, pages);
}

function requireModel(state: AppState, resolve: DayResolver): SemesterModel | null {
  return buildSemesterModel(state, resolve);
}

function fillPlaceholders(pattern: string, values: string[]): string {
  let out: string = typeof pattern === 'string' ? pattern : '';
  for (let i = 0; i < values.length; i++) {
    out = out.split('{' + String(i) + '}').join(values[i]);
  }
  return out;
}

export class ExportWorkflow {
  private copy: ExportCopy;
  private port: SavePortAccess | null;
  private picker: FilePickPort;

  constructor(copy: ExportCopy, saver: FileSavePort | null, picker: FilePickPort) {
    this.copy = copy;
    this.port = savePortOf(saver);
    this.picker = picker;
  }

  // 三格式 + 备份/日志共用：缺失端口在渲染/弹窗之前就返回稳定码，绝不把异常留到 reserve。
  private savePort(stage: string): SavePortAccess | null {
    const port: SavePortAccess | null = this.port;
    if (port === null) {
      logStageFailure(stage, STATUS_UNAVAILABLE, new Error('save-port-missing'));
      return null;
    }
    return port;
  }

  // ① 整学期单图 PNG：总览页一张，超长时内部加高（1782..4096），不做分页。
  async exportOverview(
    state: AppState,
    resolve: DayResolver,
    render: PageRenderPort,
    nowMs: number,
    offsetMinutes: number
  ): Promise<ExportOutcome> {
    const port = this.savePort('save');
    if (port === null) {
      return invalid(STATUS_UNAVAILABLE);
    }
    const model = requireModel(state, resolve);
    if (model === null) {
      return invalid(STATUS_NO_SEMESTER);
    }
    const stamp = formatStamp(nowMs, offsetMinutes);
    let png: Uint8Array | null = null;
    try {
      const page = buildOverviewPage(model, this.copy.page, stamp, defaultMeasure, (weeks: number[], total: number): string => formatWeekSpec(weeks, total, this.copy.rules).text);
      png = await render.renderPng(page);
    } catch (err) {
      return renderFailure(err as Error);
    }
    if (png === null || png.length === 0) {
      logStageFailure('render', STATUS_RENDER_FAILED, new Error('png-empty'));
      return invalid(STATUS_RENDER_FAILED);
    }
    const label = this.copy.panel.fileOverview;
    return await deliver(port, this.filePrefixOf(state), 'semester-overview', label, this.startDateOf(model), png, 1, nowMs, offsetMinutes, null);
  }

  // ② 每周一页 PDF：一页位图一张，横向 A4，页序与周次一致（对齐 web timetable-export.mjs）。
  async exportSemesterPages(
    state: AppState,
    resolve: DayResolver,
    render: PageRenderPort,
    nowMs: number,
    offsetMinutes: number
  ): Promise<ExportOutcome> {
    const port = this.savePort('reserve');
    if (port === null) {
      return invalid(STATUS_UNAVAILABLE);
    }
    const model = requireModel(state, resolve);
    if (model === null) {
      return invalid(STATUS_NO_SEMESTER);
    }
    const plan = buildSemesterPdfPlan(model.totalWeeks);
    if (plan.pageCount === 0) {
      return invalid(STATUS_NO_SEMESTER);
    }
    const stamp = formatStamp(nowMs, offsetMinutes);
    try {
      // 先把排版页全部算出来（纯内存、无位图），在渲染任何一张之前做页数与像素预算检查。
      const planned: ExportPage[] = [];
      for (const week of plan.weeks) {
        for (const page of buildWeekPages(model, week, this.copy.page, stamp)) {
          planned.push(page);
        }
      }
      const extras: string[] = this.unscheduledLines(model);
      if (extras.length > 0) {
        for (const page of buildTextPages(extras, this.copy.page.unscheduledTitle, this.copy.page)) {
          planned.push(page);
        }
      }
      // 页码按整份 PDF 的总页数编号（含未排课附页），必须在收齐所有页、开始渲染之前补。
      appendPageNumbers(planned);
      const countCode: string = pageCountBudgetCode(planned.length);
      if (countCode.length > 0) {
        logStageFailure('render', countCode, new Error('page-count-budget'));
        return invalid(countCode);
      }
      for (const page of planned) {
        const sizeCode: string = pageBudgetCode(page.width, page.height);
        if (sizeCode.length > 0) {
          logStageFailure('render', sizeCode, new Error('page-size-budget'));
          return invalid(sizeCode);
        }
      }
      // PDF 多页渲染前先弹 picker 拿 URI：用户取消时一张都不渲染，渲染失败也不会白等。
      // 只有 save 的窄端口仍走旧时序（渲染后 save），不会因缺少两阶段方法而失败。
      let reservation: SaveReservation | null = null;
      if (port.canTwoPhase) {
        const spec = exportFileSpec('semester-pages');
        const name = exportNameOf(this.filePrefixOf(state), 'semester-pages', this.copy.panel.fileSemester, this.startDateOf(model));
        try {
          reservation = await port.reserve(name, spec.mime);
        } catch (err) {
          const code: string = statusForSaveFailure(err as Error);
          logStageFailure('reserve', code, err as Error);
          return invalid(code);
        }
      }
      // 顺序渲染并逐页让出主线程；同一 Canvas 复用，仅尺寸变化时才等布局。
      const pages: PdfPageInput[] = [];
      let imageBytes: number = 0;
      await yieldToMainThread();
      for (const page of planned) {
        const jpeg = await render.renderJpeg(page);
        if (jpeg === null) {
          logStageFailure('render', STATUS_RENDER_FAILED, new Error('jpeg-empty'));
          return invalid(STATUS_RENDER_FAILED);
        }
        if (imageBytesBudgetExceeded(imageBytes, jpeg.jpeg.length)) {
          logStageFailure('render', STATUS_RENDER_BUDGET, new Error('image-bytes-budget'));
          return invalid(STATUS_RENDER_BUDGET);
        }
        imageBytes += jpeg.jpeg.length;
        pages.push(jpeg);
        await yieldToMainThread();
      }
      const check = validatePdfPages(pages);
      if (!check.ok) {
        logStageFailure('render', check.code, new Error('pdf-pages-invalid'));
        return invalid(check.code);
      }
      let pdf: Uint8Array;
      try {
        pdf = buildImagePdf(pages);
      } catch (err) {
        return renderFailure(err as Error);
      }
      return await deliver(port, this.filePrefixOf(state), 'semester-pages', this.copy.panel.fileSemester, this.startDateOf(model), pdf, pages.length, nowMs, offsetMinutes, reservation);
    } catch (err) {
      return renderFailure(err as Error);
    }
  }

  // ③ 规则文本 TXT：UTF-8，Tab 分列，与 Web/Android 导出互通。
  async exportRulesText(
    state: AppState,
    resolve: DayResolver,
    encodeUtf8: (text: string) => Uint8Array,
    nowMs: number,
    offsetMinutes: number
  ): Promise<ExportOutcome> {
    const port = this.savePort('save');
    if (port === null) {
      return invalid(STATUS_UNAVAILABLE);
    }
    const model = requireModel(state, resolve);
    if (model === null) {
      return invalid(STATUS_NO_SEMESTER);
    }
    const stamp = formatStamp(nowMs, offsetMinutes);
    try {
      const text = buildRulesText(model, this.copy.rules, stamp);
      const data = encodeUtf8(text);
      return await deliver(port, this.filePrefixOf(state), 'rules-text', this.copy.panel.fileRules, this.startDateOf(model), data, 1, nowMs, offsetMinutes, null);
    } catch (err) {
      return renderFailure(err as Error);
    }
  }

  // 备份导出：JSON 全量状态 + 信封（format/version/exportedAt/appVersion），与 Android state.json 可互导。
  async exportBackup(
    state: AppState,
    appVersion: string,
    encodeUtf8: (text: string) => Uint8Array,
    nowMs: number,
    offsetMinutes: number
  ): Promise<ExportOutcome> {
    const port = this.savePort('save');
    if (port === null) {
      return invalid(STATUS_UNAVAILABLE);
    }
    try {
      const raw = buildBackupJson(state, nowMs, appVersion);
      const name = buildBackupFileName(this.copy.panel.filePrefix, this.labelOfState(state), nowMs, offsetMinutes);
      const data = encodeUtf8(raw);
      const check = validateExportPayload('application/json', 'json', name, data.length);
      if (!check.ok) {
        logStageFailure('render', check.code, new Error('backup-payload-invalid'));
        return invalid(check.code);
      }
      return await savePayload(port, name, 'application/json', data, 1);
    } catch (err) {
      return renderFailure(err as Error);
    }
  }

  // 备份导入第一步：只读取 + 校验，不落地；UI 先弹确认再调 commitRestore。
  async previewRestore(): Promise<RestorePreview> {
    let raw: string | null = null;
    try {
      raw = await this.picker.pickText();
    } catch (err) {
      const code: string = statusForPickFailure(err as Error);
      logStageFailure('pick', code, err as Error);
      return { ok: false, code: code, summary: '', state: null };
    }
    if (raw === null) {
      return { ok: false, code: STATUS_CANCELLED, summary: '', state: null };
    }
    const parsed = parseBackupJson(raw);
    if (!parsed.ok || parsed.state === null) {
      logStageFailure('parse', parsed.code, new Error('backup-parse-failed'));
      return { ok: false, code: parsed.code, summary: '', state: null };
    }
    return { ok: true, code: STATUS_OK, summary: this.summaryOf(parsed.state), state: parsed.state };
  }

  // 备份导入第二步：确认后才 apply；apply 失败（写盘失败）保持旧状态不变。
  async commitRestore(preview: RestorePreview, apply: StateApplyPort, currentDemoMode: boolean = false): Promise<RestoreOutcome> {
    if (!preview.ok || preview.state === null) {
      return { ok: false, code: preview.code, summary: '', leftDemo: false };
    }
    // 纵深防御：预览对象可能被伪造，写盘前必须再校验完整状态。
    const code: string = validateRestoreState(preview.state);
    if (code !== '') {
      logStageFailure('validate', code, new Error('restore-state-invalid'));
      return { ok: false, code, summary: '', leftDemo: false };
    }
    try {
      const applied = await apply.apply(preview.state);
      if (!applied) {
        logStageFailure('save', STATUS_RESTORE_SAVE_FAILED, new Error('restore-save-rejected'));
        return { ok: false, code: STATUS_RESTORE_SAVE_FAILED, summary: '', leftDemo: false };
      }
      const leftDemo: boolean = currentDemoMode && preview.state.demoMode !== true;
      return { ok: true, code: STATUS_OK, summary: preview.summary, leftDemo: leftDemo };
    } catch (err) {
      const applyCode: string = codeOfError(err as Error) === '' ? STATUS_RESTORE_APPLY_FAILED : codeOfError(err as Error);
      logStageFailure('apply', applyCode, err as Error);
      return { ok: false, code: STATUS_RESTORE_APPLY_FAILED, summary: '', leftDemo: false };
    }
  }

  // 排查日志导出：事件与来源逐行脱敏（util/Redactor 注入），带行数/字符双上限。
  async exportDiagnostics(
    snapshot: DiagnosticsSnapshot,
    events: string[],
    sources: string[],
    redact: (line: string) => string,
    encodeUtf8: (text: string) => Uint8Array,
    nowMs: number,
    offsetMinutes: number
  ): Promise<ExportOutcome> {
    const port = this.savePort('save');
    if (port === null) {
      return invalid(STATUS_UNAVAILABLE);
    }
    const input: DiagnosticsInput = {
      appVersion: snapshot.appVersion,
      systemVersion: snapshot.systemVersion,
      apiVersion: snapshot.apiVersion,
      stateRevision: snapshot.stateRevision,
      lastSyncAt: snapshot.lastSyncAt > 0 ? new Date(snapshot.lastSyncAt).toISOString() : '',
      lastAttempt: '',
      events: events,
      sources: sources
    };
    try {
      const text = buildDiagnosticsText(input, this.copy.diagnostics, nowMs, offsetMinutes, redact, 200000);
      const name = buildDiagnosticsFileName(this.copy.panel.filePrefix, 'diagnostics', nowMs, offsetMinutes);
      const data = encodeUtf8(text);
      const check = validateExportPayload('text/plain', 'txt', name, data.length);
      if (!check.ok) {
        logStageFailure('render', check.code, new Error('diagnostics-payload-invalid'));
        return invalid(check.code);
      }
      return await savePayload(port, name, 'text/plain', data, 1);
    } catch (err) {
      return renderFailure(err as Error);
    }
  }

  // Demo mode prefix "sample-" only (web/app.mjs:414), course names stay intact.
  private filePrefixOf(state: AppState): string {
    return buildExportPrefix(this.copy.panel.filePrefix, this.copy.panel.samplePrefix, state.demoMode === true);
  }

  private labelOfState(state: AppState): string {
    const snapshot = state.snapshot;
    if (snapshot !== null && typeof snapshot.name === 'string' && snapshot.name.trim().length > 0) {
      return snapshot.name.trim();
    }
    return 'backup';
  }

  private startDateOf(model: SemesterModel): string {
    return typeof model.snapshot.startDate === 'string' ? model.snapshot.startDate : '';
  }

  // 未排课附页（web :375-396）：总览底栏与整学期 PDF 尾页共用同一份行文本。
  private unscheduledLines(model: SemesterModel): string[] {
    const lines: string[] = [];
    const list = model.snapshot.unscheduled || [];
    if (list.length === 0) {
      return lines;
    }
    lines.push(this.copy.page.unscheduledTitle);
    for (const course of list) {
      const weeks: string = unscheduledWeeksText(course.weeks, model.totalWeeks, this.copy.rules);
      lines.push(fillPlaceholders(this.copy.page.unscheduledItem, [course.name, weeks]));
      lines.push(fillPlaceholders(this.copy.page.unscheduledMeta, [course.room, course.teacher]));
    }
    return lines;
  }

  private summaryOf(state: AppState): string {
    const summary = summarizeBackup(state);
    if (summary.semesterName.length > 0) {
      return summary.semesterName;
    }
    return '';
  }
}

// 备份文件预览摘要的对外字段（供 UI 确认弹窗展示）。
export function restoreSummaryText(state: AppState): string {
  const summary = summarizeBackup(state);
  return summary.semesterName + ' | ' + String(summary.weeks) + ' | ' + String(summary.customCourses);
}
