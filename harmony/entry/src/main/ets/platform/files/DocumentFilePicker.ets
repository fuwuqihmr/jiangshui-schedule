// 职责：FilePickPort / RichFilePickPort 的真实实现（DocumentViewPicker.select + file.fs 读取）。
// 依赖方向：platform -> core（纯逻辑 + UTF-8 解码）、features/export（接口类型）、util（脱敏日志）。
// 行为：取消 FILE_CANCELED；超 8MB FILE_TOO_LARGE；空文件 FILE_EMPTY；不可用 FILE_UNAVAILABLE；读失败 FILE_IO_FAILED。
// 真机口径：picker URI 先用 READ_ONLY 打开；个别 provider 只授予读写权限时回退 READ_WRITE。
// 待真机核实：select 的 fileSuffixFilters 取值格式；select 的 Promise<string[]> 返回；picker 返回 URI 能否被 fs.openSync/statSync 直接使用。
import picker from '@ohos.file.picker';
import fs from '@ohos.file.fs';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { ErrorCode } from '../../core/types/Common';
import type { FilePickPort } from '../../features/export/ExportWorkflow';
import type { FilePickOutcome, PickedTextFile, RichFilePickPort } from './FilePorts';
import { FilePortError } from './FilePorts';
import { decodeUtf8 } from '../../core/files/Utf8Text';
import { Logger } from '../../util/Logger';
import {
  FILE_CANCELED,
  FILE_INVALID_PATH,
  FILE_IO_FAILED,
  FILE_UNSUPPORTED,
  PICK_FILE_SUFFIXES,
  checkPickedSize,
  fileNameOfUri,
  isSafePickedUri,
  isSupportedPickName,
  mapPickerSaveResult,
} from '../../core/files/FileNaming';
import type { PickerResult } from '../../core/files/FileNaming';

// 本端口不可用时的稳定降级码；供 FilePortFactory/UI 在能力缺失时引用。
export const PICK_UNAVAILABLE: string = ErrorCode.FILE_UNAVAILABLE;

function errorCodeOf(error: Error): number {
  if (error === null || error === undefined) {
    return 0;
  }
  const typed: BusinessError = error as BusinessError;
  return typed.code === undefined ? 0 : typed.code;
}

// 日志只写稳定码与截断后的可打印字符；不写 URI、文件名或文件内容。
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

export class DocumentFilePicker implements FilePickPort, RichFilePickPort {
  private context: common.UIAbilityContext;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  async pickText(): Promise<string | null> {
    const outcome: FilePickOutcome = await this.pickTextFile();
    if (outcome.ok && outcome.file !== null) {
      return outcome.file.text;
    }
    if (outcome.code === FILE_CANCELED) {
      return null;
    }
    throw new FilePortError(outcome.code);
  }

  async pickTextFile(): Promise<FilePickOutcome> {
    const picked: PickerResult = await this.openSelectPicker();
    if (picked.status === 'canceled') {
      return { ok: false, code: picked.code, file: null };
    }
    if (picked.status === 'failed') {
      return { ok: false, code: picked.code, file: null };
    }
    const uri: string = picked.uri;
    if (!isSafePickedUri(uri)) {
      Logger.error('export-pick rejected stage=uri code=' + FILE_INVALID_PATH + ' scheme=' + uriSchemeOf(uri));
      return { ok: false, code: FILE_INVALID_PATH, file: null };
    }
    const name: string = fileNameOfUri(uri);
    if (!isSupportedPickName(name)) {
      Logger.warn('export-pick rejected stage=name code=' + FILE_UNSUPPORTED);
      return { ok: false, code: FILE_UNSUPPORTED, file: null };
    }
    let file: fs.File | null = null;
    try {
      const openedFile: fs.File = this.openReadable(uri);
      file = openedFile;
      const size: number = fs.statSync(openedFile.fd).size;
      const sizeCode: string = checkPickedSize(size);
      if (sizeCode.length > 0) {
        Logger.warn('export-pick rejected stage=size code=' + sizeCode + ' bytes=' + String(size));
        return { ok: false, code: sizeCode, file: null };
      }
      const buffer: ArrayBuffer = new ArrayBuffer(size);
      const read: number = fs.readSync(openedFile.fd, buffer, { offset: 0, length: size });
      if (read !== size) {
        Logger.error('export-pick failed stage=read code=' + FILE_IO_FAILED +
          ' expected=' + String(size) + ' actual=' + String(read));
        return { ok: false, code: FILE_IO_FAILED, file: null };
      }
      const text: string = decodeUtf8(new Uint8Array(buffer, 0, read));
      const picked: PickedTextFile = { uri: uri, name: name, bytes: read, text: text };
      Logger.info('export-pick ok stage=read scheme=' + uriSchemeOf(uri) + ' bytes=' + String(read));
      return { ok: true, code: 'OK', file: picked };
    } catch (error) {
      Logger.error('export-pick failed stage=read code=' + FILE_IO_FAILED + ' ' + safeDetail(error as Error));
      return { ok: false, code: FILE_IO_FAILED, file: null };
    } finally {
      if (file !== null) {
        try {
          fs.closeSync(file);
        } catch (error) {
          Logger.warn('export-pick close failed stage=close ' + safeDetail(error as Error));
        }
      }
    }
  }

  private openReadable(uri: string): fs.File {
    try {
      return fs.openSync(uri, fs.OpenMode.READ_ONLY);
    } catch (error) {
      Logger.warn('export-pick open failed stage=open mode=read-only scheme=' + uriSchemeOf(uri) + ' ' + safeDetail(error as Error));
    }
    return fs.openSync(uri, fs.OpenMode.READ_WRITE);
  }

  // Promise 形态（官方 d.ts）：select(option) resolve Array<string>，取消/失败走 reject。
  // URI 选择与保存的取消语义一致，复用同一个三态映射；旧 callback 形态与 save 同因被误判。
  private async openSelectPicker(): Promise<PickerResult> {
    try {
      const options: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
      options.maxSelectNumber = 1;
      options.fileSuffixFilters = PICK_FILE_SUFFIXES;
      const viewPicker: picker.DocumentViewPicker = new picker.DocumentViewPicker(this.context);
      const uris: Array<string> = await viewPicker.select(options);
      return mapPickerSaveResult(uris, 0);
    } catch (error) {
      return this.pickerFailure(error as Error);
    }
  }

  private pickerFailure(error: Error): PickerResult {
    const mapped: PickerResult = mapPickerSaveResult(null, errorCodeOf(error));
    if (mapped.status === 'canceled') {
      Logger.info('export-pick canceled stage=picker code=' + mapped.code);
    } else {
      Logger.error('export-pick failed stage=picker code=' + mapped.code + ' ' + safeDetail(error));
    }
    return mapped;
  }
}
