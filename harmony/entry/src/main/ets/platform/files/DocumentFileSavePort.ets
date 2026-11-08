// 职责：FileSavePort / RichFileSavePort 的真实实现（DocumentViewPicker.save + file.fs 写入）。
// 依赖方向：platform -> core（纯逻辑）、features/export（接口类型）、util（脱敏日志）。
// 行为：取消 FILE_CANCELED；超限 FILE_TOO_LARGE；能力/参数异常 FILE_UNAVAILABLE；写盘失败 FILE_WRITE_FAILED。
// 真机口径（OpenHarmony save-user-file）：picker 默认已创建空文件，应用只应用 READ_WRITE 打开 URI；
//       CREATE/TRUNC 不是 picker URI 的必需项，旧实现把它们与 READ_WRITE 一起使用，失败后被误报成用户取消。
// 待真机核验：DocumentViewPicker 构造函数接收 UIAbilityContext；save 的 Promise<string[]> 返回；fs 能否直接写 picker 返回的 URI。
import picker from '@ohos.file.picker';
import fs from '@ohos.file.fs';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { ErrorCode } from '../../core/types/Common';
import type { ExportResult } from '../../core/types/Export';
import type { FileSavePort, SaveReservation } from '../../features/export/ExportWorkflow';
import type { FileSaveRequest, FileSaveOutcome, RichFileSavePort } from './FilePorts';
import { FilePortError, FILE_WRITE_FAILED } from './FilePorts';
import { Logger } from '../../util/Logger';
import {
  FILE_INVALID_PATH,
  FILE_NAME_INVALID,
  MAX_FILE_NAME_LENGTH,
  checkSaveSize,
  ensureFileExtension,
  extensionForMime,
  isSafePickedUri,
  isValidFileName,
  mapPickerSaveResult,
  sanitizeFileStem,
  trimFileName,
} from '../../core/files/FileNaming';
import type { PickerResult } from '../../core/files/FileNaming';

// 本端口不可用时的稳定降级码；供 FilePortFactory/UI 在能力缺失时引用。
export const SAVE_UNAVAILABLE: string = ErrorCode.FILE_UNAVAILABLE;

function errorCodeOf(error: Error): number {
  if (error === null || error === undefined) {
    return 0;
  }
  const typed: BusinessError = error as BusinessError;
  return typed.code === undefined ? 0 : typed.code;
}

// 日志只保留稳定码与截断后的 ASCII 可打印字符；不写 URI、文件名或文件内容。
function safeDetail(error: Error): string {
  if (error === null || error === undefined) {
    return 'detailCode=0';
  }
  const typed: BusinessError = error as BusinessError;
  const code: number = typed.code === undefined ? 0 : typed.code;
  const raw: string = typed.message === undefined ? '' : typed.message;
  let text: string = '';
  for (let i = 0; i < raw.length; i++) {
    const unit: number = raw.charCodeAt(i);
    if (unit >= 32 && unit !== 127) {
      text += raw.charAt(i);
    }
  }
  if (text.length > 160) {
    text = text.slice(0, 160);
  }
  return 'detailCode=' + String(code) + ' detail=' + text;
}

function uriSchemeOf(uri: string): string {
  const sep: number = uri.indexOf('://');
  return sep > 0 ? uri.slice(0, sep) : 'unknown';
}

export class DocumentFileSavePort implements FileSavePort, RichFileSavePort {
  private context: common.UIAbilityContext;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  async save(suggestedName: string, mime: string, data: Uint8Array, pages: number): Promise<ExportResult> {
    const outcome: FileSaveOutcome = await this.saveFile({
      suggestedName: suggestedName,
      mime: mime,
      data: data,
      pages: pages,
    });
    if (outcome.ok && outcome.result !== null) {
      return outcome.result;
    }
    throw new FilePortError(outcome.code);
  }

  // 两阶段落盘（PDF 专用）：先只弹 picker 拿 URI，渲染完成后再写。
  // 这样多页/大图渲染失败时，用户已经选好位置，不会等半天才被告知没地方存。
  async reserve(suggestedName: string, mime: string): Promise<SaveReservation> {
    const ext: string = extensionForMime(mime);
    let name: string = sanitizeFileStem(suggestedName, 'export');
    name = trimFileName(name, MAX_FILE_NAME_LENGTH - ext.length - 2);
    name = ensureFileExtension(name, ext);
    if (!isValidFileName(name)) {
      Logger.warn('export-reserve rejected stage=name code=' + FILE_NAME_INVALID);
      throw new FilePortError(FILE_NAME_INVALID);
    }
    const picked: PickerResult = await this.openSavePicker(name);
    if (picked.status !== 'success') {
      throw new FilePortError(picked.code);
    }
    const uri: string = picked.uri;
    if (!isSafePickedUri(uri)) {
      Logger.error('export-reserve rejected stage=uri code=' + FILE_INVALID_PATH + ' scheme=' + uriSchemeOf(uri));
      throw new FilePortError(FILE_INVALID_PATH);
    }
    Logger.info('export-reserve ok stage=picker scheme=' + uriSchemeOf(uri));
    return { token: uri };
  }

  async writeReserved(reservation: SaveReservation, mime: string, data: Uint8Array, pages: number): Promise<ExportResult> {
    const sizeCode: string = checkSaveSize(data.length);
    if (sizeCode.length > 0) {
      Logger.warn('export-save rejected stage=size code=' + sizeCode + ' bytes=' + String(data.length));
      throw new FilePortError(sizeCode);
    }
    if (!isSafePickedUri(reservation.token)) {
      Logger.error('export-save rejected stage=uri code=' + FILE_INVALID_PATH + ' scheme=' + uriSchemeOf(reservation.token));
      throw new FilePortError(FILE_INVALID_PATH);
    }
    const written: boolean = this.writeBytes(reservation.token, data);
    if (!written) {
      throw new FilePortError(FILE_WRITE_FAILED);
    }
    const pageCount: number = pages === undefined ? 1 : pages;
    return { uri: reservation.token, mime: mime, bytes: data.length, pages: pageCount };
  }

  async saveFile(request: FileSaveRequest): Promise<FileSaveOutcome> {
    const sizeCode: string = checkSaveSize(request.data.length);
    if (sizeCode.length > 0) {
      Logger.warn('export-save rejected stage=size code=' + sizeCode + ' bytes=' + String(request.data.length));
      return { ok: false, code: sizeCode, result: null };
    }
    const ext: string = extensionForMime(request.mime);
    let name: string = sanitizeFileStem(request.suggestedName, 'export');
    name = trimFileName(name, MAX_FILE_NAME_LENGTH - ext.length - 2);
    name = ensureFileExtension(name, ext);
    if (!isValidFileName(name)) {
      Logger.warn('export-save rejected stage=name code=' + FILE_NAME_INVALID);
      return { ok: false, code: FILE_NAME_INVALID, result: null };
    }
    const picked: PickerResult = await this.openSavePicker(name);
    if (picked.status === 'canceled') {
      return { ok: false, code: picked.code, result: null };
    }
    if (picked.status === 'failed') {
      return { ok: false, code: picked.code, result: null };
    }
    const uri: string = picked.uri;
    if (!isSafePickedUri(uri)) {
      Logger.error('export-save rejected stage=uri code=' + FILE_INVALID_PATH + ' scheme=' + uriSchemeOf(uri));
      return { ok: false, code: FILE_INVALID_PATH, result: null };
    }
    const written: boolean = this.writeBytes(uri, request.data);
    if (!written) {
      return { ok: false, code: FILE_WRITE_FAILED, result: null };
    }
    const pages: number = request.pages === undefined ? 1 : request.pages;
    return {
      ok: true,
      code: 'OK',
      result: { uri: uri, mime: request.mime, bytes: request.data.length, pages: pages },
    };
  }

  // Promise 形态（官方 d.ts）：save(option) resolve Array<string>，取消/失败走 reject。
  // 旧 callback 形态会把首个回调参数当 err，真机 errorcode=0 被误判为失败，r3 因此没到 write。
  private async openSavePicker(name: string): Promise<PickerResult> {
    try {
      const options: picker.DocumentSaveOptions = new picker.DocumentSaveOptions();
      options.newFileNames = [name];
      const viewPicker: picker.DocumentViewPicker = new picker.DocumentViewPicker(this.context);
      const uris: Array<string> = await viewPicker.save(options);
      return mapPickerSaveResult(uris, 0);
    } catch (error) {
      return this.pickerFailure(error as Error);
    }
  }

  private pickerFailure(error: Error): PickerResult {
    const mapped: PickerResult = mapPickerSaveResult(null, errorCodeOf(error));
    if (mapped.status === 'canceled') {
      Logger.info('export-picker canceled stage=picker code=' + mapped.code);
    } else {
      Logger.error('export-picker failed stage=picker code=' + mapped.code + ' ' + safeDetail(error));
    }
    return mapped;
  }

  // 写盘策略按官方路径优先：READ_WRITE（不带 CREATE/TRUNC）打开 picker 已创建的空文件。
  // 仅当 READ_WRITE 打不开时才回退 READ_WRITE|CREATE；每次失败都记录稳定码与截断后的错误信息。
  // 写入后校验 writeSync 返回值和文件大小，避免“成功返回但文件仍为 0 字节”。
  private writeBytes(uri: string, data: Uint8Array): boolean {
    const copy: Uint8Array = new Uint8Array(data.length);
    copy.set(data);
    const modes: number[] = [
      fs.OpenMode.READ_WRITE,
      fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE,
    ];
    let file: fs.File | null = null;
    let openedMode: number = -1;
    for (let i = 0; i < modes.length; i++) {
      try {
        file = fs.openSync(uri, modes[i]);
        openedMode = modes[i];
        break;
      } catch (error) {
        Logger.warn('export-write open failed stage=open attempt=' + String(i + 1) +
          ' mode=' + String(modes[i]) + ' scheme=' + uriSchemeOf(uri) + ' ' + safeDetail(error as Error));
      }
    }
    if (file === null) {
      Logger.error('export-write failed stage=open code=' + FILE_WRITE_FAILED +
        ' scheme=' + uriSchemeOf(uri) + ' bytes=' + String(copy.byteLength));
      return false;
    }
    const openedFile: fs.File = file;
    try {
      // picker 默认预置空文件；truncate 只是覆盖旧内容的兜底，失败不单独判死，最终以 size 校验为准。
      try {
        fs.truncateSync(openedFile.fd, 0);
      } catch (error) {
        Logger.warn('export-write truncate failed stage=truncate ' + safeDetail(error as Error));
      }
      let written: number = 0;
      try {
        written = fs.writeSync(openedFile.fd, copy.buffer as ArrayBuffer);
      } catch (error) {
        Logger.error('export-write failed stage=write code=' + FILE_WRITE_FAILED + ' ' + safeDetail(error as Error));
        return false;
      }
      if (written !== copy.byteLength) {
        Logger.error('export-write failed stage=write code=' + FILE_WRITE_FAILED +
          ' expected=' + String(copy.byteLength) + ' written=' + String(written));
        return false;
      }
      try {
        const stat = fs.statSync(openedFile.fd);
        if (stat.size !== copy.byteLength) {
          Logger.error('export-write failed stage=verify code=' + FILE_WRITE_FAILED +
            ' expected=' + String(copy.byteLength) + ' actual=' + String(stat.size));
          return false;
        }
      } catch (error) {
        Logger.warn('export-write verify unavailable stage=verify ' + safeDetail(error as Error));
      }
      Logger.info('export-write ok stage=write mode=' + String(openedMode) +
        ' scheme=' + uriSchemeOf(uri) + ' bytes=' + String(copy.byteLength));
      return true;
    } finally {
      try {
        fs.closeSync(openedFile);
      } catch (error) {
        Logger.warn('export-write close failed stage=close ' + safeDetail(error as Error));
      }
    }
  }
}
