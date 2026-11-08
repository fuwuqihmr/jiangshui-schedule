// 职责：文件端口的公共契约与结果类型（save/pick 的成功、取消、超限、不可用）。
// 依赖方向：platform -> core/types、features/export（只 import type 契约，不反向依赖）。
// 设计：FileSavePort / FilePickPort 是 features/export/ExportWorkflow 现有窄接口；
//       Rich* 接口额外携带稳定错误码，便于 UI 区分“用户取消”与“真失败”。
import type { ExportResult } from '../../core/types/Export';
import type { FileSavePort, FilePickPort } from '../../features/export/ExportWorkflow';
import { ErrorCode } from '../../core/types/Common';

// 文件端口不可用时的契约码；与 core/files/FileNaming.FILE_UNAVAILABLE 同值。
export const FILE_PORT_UNAVAILABLE: string = ErrorCode.FILE_UNAVAILABLE;
// 写盘阶段失败：picker 已返回 URI，但 open/write/校验未成功；与“用户取消”严格分开。
export const FILE_WRITE_FAILED: string = ErrorCode.FILE_WRITE_FAILED;

export interface FileSaveRequest {
  suggestedName: string;
  mime: string;
  data: Uint8Array;
  pages?: number;
}

export interface FileSaveOutcome {
  ok: boolean;
  code: string;
  result: ExportResult | null;
}

export interface RichFileSavePort {
  saveFile(request: FileSaveRequest): Promise<FileSaveOutcome>;
}

export interface PickedTextFile {
  uri: string;
  name: string;
  bytes: number;
  text: string;
}

export interface FilePickOutcome {
  ok: boolean;
  code: string;
  file: PickedTextFile | null;
}

export interface RichFilePickPort {
  pickTextFile(): Promise<FilePickOutcome>;
}

// 端口失败统一抛这个错误，code 取 core/files/FileNaming 的稳定码。
export class FilePortError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = 'FilePortError';
    this.code = code;
  }
}

export interface FilePortSet {
  saver: FileSavePort;
  picker: FilePickPort;
  richSaver: RichFileSavePort;
  richPicker: RichFilePickPort;
  available: boolean;
  reason: string;
}
