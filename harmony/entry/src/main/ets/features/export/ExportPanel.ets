// 职责：设置页「导出与备份」面板：三种导出（整学期单图 / 每周一页 PDF / 规则 TXT）+ 备份导入导出 + 排查日志导出。
// 依赖方向：features/export -> ExportWorkflow（编排）+ PagePainter（Canvas 绘制）+ ArkUI 资源；
//          落盘/选文件/状态落地由父页面注入端口，页面接线见同目录 NAV.md。
// 阶段：P5；未编译（本机无 DevEco IDE），Canvas 抓图与 DocumentViewPicker 需按 API 12 复核。
// 约束：本文件不出现中文字面量，全部文案走 $r('app.string.export_*')，键见 tools/resource-requests/harmony-export.json。
import type { AppState } from '../../core/types/AppState';
import type { DiagnosticsSnapshot } from '../../core/types/Common';
import type { ExportPage } from '../../core/export/CanvasLayout';
import type { ExportCopy } from '../../core/export/ExportCopy';
import type { DayResolver } from '../../core/export/ExportModel';
import type { PdfPageInput } from '../../core/export/PdfPages';
import type {
  ExportOutcome,
  FilePickPort,
  FileSavePort,
  PageRenderPort,
  RestoreOutcome,
  RestorePreview
} from './ExportWorkflow';
import {
  ExportWorkflow,
  STATUS_CANCELLED,
  STATUS_NO_SEMESTER,
  STATUS_OK,
  STATUS_RENDER_BUDGET,
  STATUS_RENDER_FAILED,
  STATUS_UNAVAILABLE,
  makePageRenderPort,
  makeStateApplyPort
} from './ExportWorkflow';
import { base64ToBytes, encodeUtf8, paintPage } from './PagePainter';
import { makePdfPageInput } from '../../core/export/PdfPages';
import {
  RENDER_SIZE_RETRY_LIMIT,
  SIZE_VERDICT_OK,
  SIZE_VERDICT_REJECT,
  SIZE_VERDICT_TOLERANCE,
  canvasSizeInVp,
  classifyRenderSize,
  correctedCanvasVp,
  safeVpPerPx
} from '../../core/export/RenderBudget';
import type { CanvasSize, RenderSizeCheck } from '../../core/export/RenderBudget';
import { imageSizeOf } from '../../core/export/ImageSize';
import type { EncodedImageSize } from '../../core/export/ImageSize';
import { validateRestoreState } from '../../core/export/Backup';
import { FILE_IO_FAILED } from '../../core/files/FileNaming';
import { fileErrorText } from '../../platform/files/FilePortMessages';
import { redactText } from '../../util/Redactor';

const SAVE_PNG: string = 'image/png';
const SAVE_JPEG: string = 'image/jpeg';
const JPEG_QUALITY: number = 0.92;
const PREVIEW_SCALE: number = 0.22;
const PREVIEW_MAX_SCALE: number = 1;
const MAX_LOG_LINES: number = 200;

@Component
export struct ExportPanel {
  @Prop state: AppState;
  @Prop copy: ExportCopy;
  @Prop diagnostics: DiagnosticsSnapshot;
  @Prop appVersion: string = '';
  @Prop logLines: string[] = [];
  @Prop logSources: string[] = [];
  resolve: DayResolver = () => [];
  saver: FileSavePort | null = null;
  picker: FilePickPort | null = null;
  // 默认脱敏：复用 util/Redactor 的唯一实现，调用方仍可注入自定义实现。
  redact: (line: string) => string = redactText;
  onApplyState: (next: AppState) => Promise<boolean> = async (next: AppState) => false;

  @State private busy: boolean = false;
  @State private status: string = '';
  @State private restoreErrorCode: string = '';
  // 失败时只保留文件/导出错误码，渲染时统一经 fileErrorText 转资源文案；机器码不直出面板。
  @State private failureCode: string = '';
  @State private previewWidth: number = 1;
  @State private previewHeight: number = 1;
  @State private previewScale: number = PREVIEW_SCALE;
  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);
  private ready: boolean = false;

  private workflow(): ExportWorkflow | null {
    if (this.saver === null || this.picker === null) {
      return null;
    }
    return new ExportWorkflow(this.copy, this.saver, this.picker);
  }

  private nowMs(): number {
    return Date.now();
  }

  private offsetMinutes(): number {
    return -new Date().getTimezoneOffset();
  }

  private utf8(text: string): Uint8Array {
    return encodeUtf8(text);
  }

  private waitLayout(): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      setTimeout(() => { resolve(); }, 48);
    });
  }

  // 把页面画进 Canvas 再取 base64；Canvas 未 onReady 时返回 null（调用方判 EXPORT_RENDER_FAILED）。
  // 单位合同：ExportPage 坐标是物理像素，而 Canvas 组件宽高与绘制坐标是 vp。
  // 因此组件宽高设为 pagePx * px2vp(1) vp，绘制前 ctx.scale(px2vp(1))，后备位图才等于 pagePx。
  // 实测位图与目标页的偏差按容差分类：±2 px 直接产出（WARN）；容差外先反算画布 vp 重渲染，
  // 多轮仍偏则保留最接近的一张产出（不因舍入差让整个导出失败）；>2 倍或非法才拒绝。
  // 改尺寸后先等布局生效；同尺寸的后续页复用同一画布，不再重建。
  private async capture(page: ExportPage, mime: string): Promise<Uint8Array | null> {
    if (!this.ready) {
      return null;
    }
    const vpPerPx: number = safeVpPerPx(px2vp(1));
    const base: CanvasSize = canvasSizeInVp(page.width, page.height, vpPerPx);
    let vpWidth: number = base.width;
    let vpHeight: number = base.height;
    let bestBytes: Uint8Array | null = null;
    for (let attempt = 0; attempt <= RENDER_SIZE_RETRY_LIMIT; attempt++) {
      const resized: boolean = this.previewWidth !== vpWidth || this.previewHeight !== vpHeight;
      this.previewWidth = vpWidth;
      this.previewHeight = vpHeight;
      this.previewScale = Math.min(PREVIEW_MAX_SCALE, (page.width * PREVIEW_SCALE) / vpWidth);
      if (resized) {
        await this.waitLayout();
      }
      try {
        this.ctx.save();
        this.ctx.scale(vpPerPx, vpPerPx);
        paintPage(this.ctx, page);
      } finally {
        this.ctx.restore();
      }
      const url: string = this.ctx.toDataURL(mime, JPEG_QUALITY);
      const bytes: Uint8Array | null = base64ToBytes(url);
      if (bytes === null) {
        return null;
      }
      bestBytes = bytes;
      // 尺寸自检：框架按 density 分配后备缓冲；留 ±2 px 容差给 px2vp/vp2px 的舍入。
      const actual: EncodedImageSize | null = imageSizeOf(bytes, mime);
      if (actual === null) {
        console.error('export-render-size-unknown expected=' + String(page.width) + 'x' + String(page.height));
        return null;
      }
      const check: RenderSizeCheck = classifyRenderSize(actual.width, actual.height, page.width, page.height);
      if (check.verdict === SIZE_VERDICT_OK) {
        return bytes;
      }
      if (check.verdict === SIZE_VERDICT_TOLERANCE) {
        console.warn('export-render-size-tolerance expected=' + String(page.width) + 'x' + String(page.height) +
          ' actual=' + String(actual.width) + 'x' + String(actual.height));
        return bytes;
      }
      if (check.verdict === SIZE_VERDICT_REJECT) {
        console.error('export-render-size-reject expected=' + String(page.width) + 'x' + String(page.height) +
          ' actual=' + String(actual.width) + 'x' + String(actual.height));
        return null;
      }
      // scale：先反算画布 vp 再试；已是最后一轮则按「最接近的一张」产出并记 WARN。
      if (attempt >= RENDER_SIZE_RETRY_LIMIT) {
        console.warn('export-render-size-scaled expected=' + String(page.width) + 'x' + String(page.height) +
          ' actual=' + String(actual.width) + 'x' + String(actual.height));
        return bytes;
      }
      const corrected: CanvasSize = correctedCanvasVp(vpWidth, vpHeight, actual.width, actual.height,
        page.width, page.height, vpPerPx);
      if (corrected.width === vpWidth && corrected.height === vpHeight) {
        console.warn('export-render-size-scaled expected=' + String(page.width) + 'x' + String(page.height) +
          ' actual=' + String(actual.width) + 'x' + String(actual.height));
        return bytes;
      }
      vpWidth = corrected.width;
      vpHeight = corrected.height;
    }
    return bestBytes;
  }

  private renderer(): PageRenderPort {
    return makePageRenderPort(
      async (page: ExportPage): Promise<Uint8Array | null> => {
        return await this.capture(page, SAVE_PNG);
      },
      async (page: ExportPage): Promise<PdfPageInput | null> => {
        const bytes = await this.capture(page, SAVE_JPEG);
        if (bytes === null) {
          return null;
        }
        return makePdfPageInput(bytes, page.width, page.height);
      }
    );
  }

  private noteFailure(code: string): void {
    this.failureCode = code;
    // 机器码只进日志，面板统一显示 fileErrorText 的资源文案。
    console.warn('export-ui-failure code=' + code);
  }

  private applyOutcome(result: ExportOutcome): void {
    if (result.ok && result.code === STATUS_OK) {
      const bytes = result.result === null ? 0 : result.result.bytes;
      const pages = result.result === null ? 1 : result.result.pages;
      this.status = this.copy.panel.statusDone + ' ' + String(pages) + ' / ' + String(bytes);
      this.failureCode = '';
      return;
    }
    if (result.code === STATUS_CANCELLED) {
      this.status = this.copy.panel.pickerCancelled;
      this.failureCode = '';
      return;
    }
    if (result.code === STATUS_RENDER_BUDGET) {
      this.status = this.copy.panel.renderBudget;
      this.failureCode = '';
      return;
    }
    if (result.code === STATUS_RENDER_FAILED) {
      this.status = this.copy.panel.renderFailed;
      this.failureCode = '';
      return;
    }
    if (result.code === STATUS_NO_SEMESTER) {
      this.status = this.copy.panel.statusNoSemester;
      this.failureCode = '';
      return;
    }
    this.status = '';
    this.noteFailure(result.code);
  }

  private async run(kind: string): Promise<void> {
    const flow = this.workflow();
    if (flow === null) {
      this.status = '';
      this.noteFailure(STATUS_UNAVAILABLE);
      return;
    }
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.failureCode = '';
    this.restoreErrorCode = '';
    this.status = this.copy.panel.statusBusy;
    try {
      let result: ExportOutcome;
      if (kind === 'overview') {
        result = await flow.exportOverview(this.state, this.resolve, this.renderer(), this.nowMs(), this.offsetMinutes());
      } else if (kind === 'pages') {
        result = await flow.exportSemesterPages(this.state, this.resolve, this.renderer(), this.nowMs(), this.offsetMinutes());
      } else if (kind === 'rules') {
        result = await flow.exportRulesText(this.state, this.resolve, (text: string) => this.utf8(text), this.nowMs(), this.offsetMinutes());
      } else if (kind === 'backup') {
        result = await flow.exportBackup(this.state, this.appVersion, (text: string) => this.utf8(text), this.nowMs(), this.offsetMinutes());
      } else {
        result = await flow.exportDiagnostics(
          this.diagnostics,
          this.logLines.slice(0, MAX_LOG_LINES),
          this.logSources,
          this.redact,
          (text: string) => this.utf8(text),
          this.nowMs(),
          this.offsetMinutes()
        );
      }
      this.applyOutcome(result);
    } catch (err) {
      this.status = '';
      this.noteFailure(FILE_IO_FAILED);
    } finally {
      this.busy = false;
    }
  }

  // 备份导入：先读取 + 校验，弹确认后再落地；校验失败不会调用 onApplyState（坏数据不覆盖好数据）。
  private async restore(): Promise<void> {
    const flow = this.workflow();
    if (flow === null || this.busy) {
      return;
    }
    this.busy = true;
    this.status = this.copy.panel.statusBusy;
    this.restoreErrorCode = '';
    this.failureCode = '';
    try {
      const preview: RestorePreview = await flow.previewRestore();
      if (!preview.ok || preview.state === null) {
        if (preview.code === STATUS_CANCELLED) {
          this.status = this.copy.panel.pickerCancelled;
        } else if (preview.code === 'BACKUP_LEGACY_UNSUPPORTED') {
          this.status = this.copy.panel.restoreLegacy;
        } else {
          this.restoreErrorCode = preview.code;
          this.status = this.copy.panel.restoreFailed;
          this.noteFailure(preview.code);
        }
        return;
      }
      // 预览阶段就用与写盘相同的校验函数，非法文件不弹确认框。
      const restoreCode: string = validateRestoreState(preview.state);
      if (restoreCode !== '') {
        this.restoreErrorCode = restoreCode;
        this.status = this.copy.panel.restoreFailed;
        this.noteFailure(restoreCode);
        return;
      }
      AlertDialog.show({
        title: this.copy.panel.restoreAction,
        message: this.copy.panel.restoreConfirmMessage + ' ' + preview.summary,
        primaryButton: {
          value: this.copy.panel.cancel,
          action: () => {
            this.status = this.copy.panel.pickerCancelled;
          }
        },
        secondaryButton: {
          value: this.copy.panel.confirm,
          action: () => {
            this.commit(preview);
          }
        }
      });
    } catch (err) {
      this.restoreErrorCode = '';
      this.status = '';
      this.noteFailure(FILE_IO_FAILED);
    } finally {
      this.busy = false;
    }
  }

  private async commit(preview: RestorePreview): Promise<void> {
    const flow = this.workflow();
    if (flow === null) {
      return;
    }
    const result: RestoreOutcome = await flow.commitRestore(preview, makeStateApplyPort((next: AppState) => this.onApplyState(next)), this.state.demoMode === true);
    if (result.ok) {
      this.restoreErrorCode = '';
      this.failureCode = '';
      this.status = result.leftDemo ? this.copy.panel.restoreDemoExit : this.copy.panel.restoreOk;
    } else {
      this.restoreErrorCode = result.code;
      this.status = this.copy.panel.restoreFailed;
      this.noteFailure(result.code);
    }
  }

  build() {
    Column({ space: 10 }) {
      Text(this.copy.panel.title).fontSize(16).fontWeight(FontWeight.Medium)
      Text(this.copy.panel.intro).fontSize(11).opacity(0.7)
      Row({ space: 10 }) {
        Button(this.copy.panel.overviewAction).fontSize(12).layoutWeight(1)
          .onClick(() => { this.run('overview'); })
        Button(this.copy.panel.pagesAction).fontSize(12).layoutWeight(1)
          .onClick(() => { this.run('pages'); })
      }.width('100%')
      Row({ space: 10 }) {
        Button(this.copy.panel.rulesAction).fontSize(12).layoutWeight(1)
          .onClick(() => { this.run('rules'); })
        Button(this.copy.panel.diagnosticsAction).fontSize(12).layoutWeight(1)
          .onClick(() => { this.run('diagnostics'); })
      }.width('100%')
      Row({ space: 10 }) {
        Button(this.copy.panel.backupAction).fontSize(12).layoutWeight(1)
          .onClick(() => { this.run('backup'); })
        Button(this.copy.panel.restoreAction).fontSize(12).layoutWeight(1)
          .onClick(() => { this.restore(); })
      }.width('100%')
      if (this.status.length > 0) {
        Text(this.status).fontSize(11).opacity(0.8)
      }
      if (this.failureCode.length > 0) {
        Text(fileErrorText(this.failureCode)).fontSize(11).fontColor($r('app.color.color_danger')).width('100%')
      }
      if (this.restoreErrorCode.length > 0) {
        Text($r('app.string.export_panel_restore_failed_hint'))
          .fontSize(11).fontColor($r('app.color.color_danger')).width('100%')
      }
      // 导出预览：按页面原尺寸绘制后缩放，Canvas onReady 后才允许抓图。
      Column() {
        Canvas(this.ctx)
          .width(this.previewWidth)
          .height(this.previewHeight)
          .scale({ x: this.previewScale, y: this.previewScale, centerX: 0, centerY: 0 })
          .onReady(() => { this.ready = true; })
      }
      .width('100%')
      .height(400)
      .clip(true)
      .borderRadius(8)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(12)
  }
}
