// 职责：文件端口结果码到导出层四态（成功/取消/失败/超大）的纯映射，并给出可见文案资源键。
// 依赖方向：core 纯逻辑，无 SDK、无装饰器、无副作用 import；供 features/files/ExportFilePorts 适配 platform 端口。
// 阶段：四态映射；文案键复用 platform/files 已合并的 file_error_*（不新增 string.json 键）。

export type ExportPortState = 'ok' | 'canceled' | 'too_large' | 'unavailable' | 'failed';

export interface ExportPortStatus {
  state: ExportPortState;
  code: string;
  messageKey: string;
  silent: boolean;
}

const CODE_OK: string = 'OK';
const CODE_CANCELED: string = 'FILE_CANCELED';
const CODE_WORKFLOW_CANCELED: string = 'EXPORT_CANCELLED';
const CODE_TOO_LARGE: string = 'FILE_TOO_LARGE';
const CODE_UNAVAILABLE: string = 'FILE_UNAVAILABLE';
const CODE_UNSUPPORTED: string = 'FILE_UNSUPPORTED';
const CODE_EMPTY: string = 'FILE_EMPTY';
const CODE_INVALID_PATH: string = 'FILE_INVALID_PATH';
const CODE_NAME_INVALID: string = 'FILE_NAME_INVALID';
const CODE_TIME_INVALID: string = 'FILE_TIME_INVALID';

export const KEY_CANCELED: string = 'file_error_canceled';
export const KEY_TOO_LARGE: string = 'file_error_too_large';
export const KEY_UNAVAILABLE: string = 'file_error_unavailable';
export const KEY_UNSUPPORTED: string = 'file_error_unsupported';
export const KEY_EMPTY: string = 'file_error_empty';
export const KEY_INVALID_PATH: string = 'file_error_invalid_path';
export const KEY_NAME_INVALID: string = 'file_error_name';
export const KEY_TIME_INVALID: string = 'file_error_time';
export const KEY_IO_FAILED: string = 'file_error_io';

// 把端口 outcome（ok + 稳定码）映射为 UI 可直接展示的语义状态；取消静默，其余带文案键。
export function mapExportPortCode(ok: boolean, code: string): ExportPortStatus {
  if (ok || code === CODE_OK || code === '') {
    return { state: 'ok', code: CODE_OK, messageKey: '', silent: false };
  }
  if (code === CODE_CANCELED || code === CODE_WORKFLOW_CANCELED) {
    return { state: 'canceled', code: code, messageKey: KEY_CANCELED, silent: true };
  }
  if (code === CODE_TOO_LARGE) {
    return { state: 'too_large', code: code, messageKey: KEY_TOO_LARGE, silent: false };
  }
  if (code === CODE_UNAVAILABLE) {
    return { state: 'unavailable', code: code, messageKey: KEY_UNAVAILABLE, silent: false };
  }
  if (code === CODE_UNSUPPORTED) {
    return { state: 'failed', code: code, messageKey: KEY_UNSUPPORTED, silent: false };
  }
  if (code === CODE_EMPTY) {
    return { state: 'failed', code: code, messageKey: KEY_EMPTY, silent: false };
  }
  if (code === CODE_INVALID_PATH) {
    return { state: 'failed', code: code, messageKey: KEY_INVALID_PATH, silent: false };
  }
  if (code === CODE_NAME_INVALID) {
    return { state: 'failed', code: code, messageKey: KEY_NAME_INVALID, silent: false };
  }
  if (code === CODE_TIME_INVALID) {
    return { state: 'failed', code: code, messageKey: KEY_TIME_INVALID, silent: false };
  }
  return { state: 'failed', code: code, messageKey: KEY_IO_FAILED, silent: false };
}
