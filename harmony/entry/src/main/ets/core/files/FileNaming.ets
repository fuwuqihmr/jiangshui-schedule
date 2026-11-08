// 职责：文件端口纯逻辑——文件名生成与校验、扩展名/MIME 映射、字节数格式化、
//       picker URI 安全性、错误码归一（FILE_CANCELED / FILE_TOO_LARGE / FILE_UNAVAILABLE ...）。
// 依赖方向：core 叶子，零运行时 import；platform/files 直接复用这些纯函数。
// 说明：本文件不出现中文字面量（门禁会扫字符串字面量），文件名中的中文由调用方数据传入。
// 阶段：P4；真机 picker 适配见 platform/files/DocumentFileSavePort.ets 与 DocumentFilePicker.ets。

// 稳定错误码：UI 与日志共用，禁止在各层另造字符串。
export const FILE_CANCELED: string = 'FILE_CANCELED';
export const FILE_TOO_LARGE: string = 'FILE_TOO_LARGE';
export const FILE_UNAVAILABLE: string = 'FILE_UNAVAILABLE';
export const FILE_IO_FAILED: string = 'FILE_IO_FAILED';
export const FILE_UNSUPPORTED: string = 'FILE_UNSUPPORTED';
export const FILE_EMPTY: string = 'FILE_EMPTY';
export const FILE_INVALID_PATH: string = 'FILE_INVALID_PATH';
export const FILE_NAME_INVALID: string = 'FILE_NAME_INVALID';
export const FILE_TIME_INVALID: string = 'FILE_TIME_INVALID';

// 上限：与 core/export/ExportFiles 的 33MB 导出上限保持一致；pick 侧更保守（8MB）。
export const MAX_FILE_NAME_LENGTH: number = 180;
export const MAX_PICK_BYTES: number = 8 * 1024 * 1024;
export const MAX_SAVE_BYTES: number = 33 * 1024 * 1024;
export const MAX_PICKED_URI_LENGTH: number = 2048;
export const PICK_FILE_SUFFIXES: string[] = ['.json', '.txt', '.csv'];

export interface FileNameOptions {
  prefix: string;
  label: string;
  kind: string;
  nowMs: number;
  offsetMinutes?: number;
}

function isForbiddenCode(code: number): boolean {
  if (code < 32 || code === 127) {
    return true;
  }
  if (code === 92 || code === 47 || code === 58 || code === 42) {
    return true;
  }
  if (code === 63 || code === 34 || code === 60 || code === 62 || code === 124) {
    return true;
  }
  return false;
}

export function sanitizeFileStem(name: string, fallback: string): string {
  const input: string = name === null || name === undefined ? '' : name;
  let out: string = '';
  for (let i = 0; i < input.length; i++) {
    const code: number = input.charCodeAt(i);
    if (isForbiddenCode(code)) {
      continue;
    }
    out = out + input.charAt(i);
  }
  out = out.trim();
  let start: number = 0;
  while (start < out.length && (out.charAt(start) === '.' || out.charAt(start) === ' ')) {
    start++;
  }
  out = out.slice(start).trim();
  while (out.length > 0) {
    const last: string = out.charAt(out.length - 1);
    if (last === '.' || last === ' ') {
      out = out.slice(0, out.length - 1);
    } else {
      break;
    }
  }
  if (out.length === 0) {
    return fallback;
  }
  return out;
}

export function normalizeExtension(extension: string): string {
  const input: string = extension === null || extension === undefined ? '' : extension;
  let out: string = input.trim().toLowerCase();
  while (out.length > 0 && out.charAt(0) === '.') {
    out = out.slice(1);
  }
  if (out.length === 0 || out.length > 8) {
    return '';
  }
  for (let i = 0; i < out.length; i++) {
    const code: number = out.charCodeAt(i);
    const isDigit: boolean = code >= 48 && code <= 57;
    const isLower: boolean = code >= 97 && code <= 122;
    if (!isDigit && !isLower) {
      return '';
    }
  }
  return out;
}

export function extensionOfFileName(name: string): string {
  const input: string = name === null || name === undefined ? '' : name;
  const dot: number = input.lastIndexOf('.');
  if (dot < 0 || dot === input.length - 1) {
    return '';
  }
  return normalizeExtension(input.slice(dot + 1));
}

export function trimFileName(name: string, maxLength: number): string {
  if (!Number.isFinite(maxLength) || maxLength < 1) {
    return '';
  }
  let out: string = name.length <= maxLength ? name : name.slice(0, maxLength);
  while (out.length > 0) {
    const last: string = out.charAt(out.length - 1);
    if (last === '.' || last === ' ') {
      out = out.slice(0, out.length - 1);
    } else {
      break;
    }
  }
  return out;
}

export function ensureFileExtension(name: string, extension: string): string {
  const ext: string = normalizeExtension(extension);
  if (ext.length === 0) {
    return name;
  }
  const suffix: string = '.' + ext;
  const lower: string = name.toLowerCase();
  if (lower.length >= suffix.length && lower.slice(lower.length - suffix.length) === suffix) {
    return name;
  }
  let base: string = name;
  while (base.length > 0) {
    const last: string = base.charAt(base.length - 1);
    if (last === '.' || last === ' ') {
      base = base.slice(0, base.length - 1);
    } else {
      break;
    }
  }
  return base + suffix;
}

export function isValidFileName(name: string): boolean {
  if (name === null || name === undefined) {
    return false;
  }
  if (name.length === 0 || name.length > MAX_FILE_NAME_LENGTH) {
    return false;
  }
  if (name === '.' || name === '..') {
    return false;
  }
  if (name.trim().length === 0) {
    return false;
  }
  for (let i = 0; i < name.length; i++) {
    if (isForbiddenCode(name.charCodeAt(i))) {
      return false;
    }
  }
  const last: string = name.charAt(name.length - 1);
  if (last === '.' || last === ' ') {
    return false;
  }
  return true;
}

export function buildTimestamp(nowMs: number, offsetMinutes: number): string {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new Error(FILE_TIME_INVALID);
  }
  const shift: number = Number.isFinite(offsetMinutes) ? Math.trunc(offsetMinutes) : 0;
  let iso: string = '';
  try {
    iso = new Date(nowMs + shift * 60000).toISOString();
  } catch (error) {
    throw new Error(FILE_TIME_INVALID);
  }
  return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) + '-' +
    iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19);
}

export function extensionForKind(kind: string): string {
  switch (kind) {
    case 'semester-overview':
      return 'png';
    case 'semester-pages':
      return 'pdf';
    case 'rules-text':
      return 'txt';
    case 'rules-csv':
      return 'csv';
    case 'backup':
      return 'json';
    case 'diagnostics':
      return 'txt';
    default:
      return '';
  }
}

export function extensionForMime(mime: string): string {
  const input: string = mime === null || mime === undefined ? '' : mime.toLowerCase();
  switch (input) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'application/pdf':
      return 'pdf';
    case 'text/plain':
      return 'txt';
    case 'application/json':
      return 'json';
    case 'text/csv':
      return 'csv';
    default:
      return '';
  }
}

export function mimeForExtension(extension: string): string {
  const ext: string = normalizeExtension(extension);
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
      return 'image/jpeg';
    case 'jpeg':
      return 'image/jpeg';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
      return 'text/plain';
    case 'json':
      return 'application/json';
    case 'csv':
      return 'text/csv';
    default:
      return 'application/octet-stream';
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return Math.round(bytes).toString() + ' B';
  }
  const units: string[] = ['KB', 'MB', 'GB'];
  let value: number = bytes;
  let unitIndex: number = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value = value / 1024;
    unitIndex++;
  }
  const rounded: number = Math.round(value * 10) / 10;
  return rounded.toString() + ' ' + units[unitIndex];
}

export function isSupportedPickName(name: string): boolean {
  const ext: string = extensionOfFileName(name);
  return ext === 'json' || ext === 'txt' || ext === 'csv';
}

export function isSafePickedUri(uri: string): boolean {
  if (uri === null || uri === undefined) {
    return false;
  }
  if (uri.length < 8 || uri.length > MAX_PICKED_URI_LENGTH) {
    return false;
  }
  for (let i = 0; i < uri.length; i++) {
    const code: number = uri.charCodeAt(i);
    if (code <= 32 || code === 127 || code === 92) {
      return false;
    }
  }
  const sep: number = uri.indexOf('://');
  if (sep <= 0) {
    return false;
  }
  const scheme: string = uri.slice(0, sep).toLowerCase();
  if (scheme !== 'file' && scheme !== 'datashare' && scheme !== 'content') {
    return false;
  }
  const rest: string = uri.slice(sep + 3);
  if (rest.length === 0) {
    return false;
  }
  if (rest.charAt(0) === '/' && (scheme === 'file' || rest.length <= 1)) {
    return false;
  }
  if (uri.indexOf('..') >= 0) {
    return false;
  }
  return true;
}

export function fileNameOfUri(uri: string): string {
  const input: string = uri === null || uri === undefined ? '' : uri;
  let path: string = input;
  const hash: number = path.indexOf('#');
  if (hash >= 0) {
    path = path.slice(0, hash);
  }
  const query: number = path.indexOf('?');
  if (query >= 0) {
    path = path.slice(0, query);
  }
  const slash: number = path.lastIndexOf('/');
  let name: string = slash >= 0 ? path.slice(slash + 1) : path;
  try {
    name = decodeURIComponent(name);
  } catch (error) {
    name = name;
  }
  const safe: string = sanitizeFileStem(name, 'file');
  return trimFileName(safe, MAX_FILE_NAME_LENGTH);
}

// picker 保存/选择的三态结果：成功 URI、用户取消、失败。
// 依据：DocumentViewPicker.save/select 的 Promise 形态 resolve Array<string>，取消走 reject；
// 13900042 是社区与项目沿用的取消码（官方错误码表记为 Unknown error），-1 是 r3 真机取消观测值；
// 两者都按取消处理。空 URI 列表按取消；null/undefined 列表按失败；其余非 0 码按失败。
export type PickerResultStatus = 'success' | 'canceled' | 'failed';

export interface PickerResult {
  status: PickerResultStatus;
  uri: string;
  code: string;
}

export function isPickerCancelCode(code: number): boolean {
  return code === 13900042 || code === -1;
}

export function mapPickerSaveResult(uris: string[] | null | undefined, errorCode: number): PickerResult {
  if (typeof errorCode === 'number' && errorCode !== 0) {
    if (isPickerCancelCode(errorCode)) {
      return { status: 'canceled', uri: '', code: FILE_CANCELED };
    }
    return { status: 'failed', uri: '', code: FILE_IO_FAILED };
  }
  if (uris === null || uris === undefined || !Array.isArray(uris)) {
    return { status: 'failed', uri: '', code: FILE_IO_FAILED };
  }
  if (uris.length === 0) {
    return { status: 'canceled', uri: '', code: FILE_CANCELED };
  }
  const first: string = typeof uris[0] === 'string' ? uris[0].trim() : '';
  if (first.length === 0) {
    return { status: 'canceled', uri: '', code: FILE_CANCELED };
  }
  return { status: 'success', uri: first, code: '' };
}

export function mapPickerFailure(code: number | string, message: string): string {
  let numeric: number = NaN;
  if (typeof code === 'number') {
    numeric = code;
  } else {
    numeric = Number(code);
  }
  const text: string = message === null || message === undefined ? '' : message.toLowerCase();
  if (numeric === 13900042 || text.indexOf('cancel') >= 0) {
    return FILE_CANCELED;
  }
  if (numeric === 801 || numeric === 202 || numeric === 13900020) {
    return FILE_UNAVAILABLE;
  }
  if (text.indexOf('not support') >= 0 || text.indexOf('unavailable') >= 0 ||
    text.indexOf('not available') >= 0) {
    return FILE_UNAVAILABLE;
  }
  return FILE_IO_FAILED;
}

export function checkPickedSize(bytes: number, maxBytes: number = MAX_PICK_BYTES): string {
  const limit: number = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : MAX_PICK_BYTES;
  if (!Number.isFinite(bytes) || bytes < 0) {
    return FILE_IO_FAILED;
  }
  if (bytes === 0) {
    return FILE_EMPTY;
  }
  if (bytes > limit) {
    return FILE_TOO_LARGE;
  }
  return '';
}

export function checkSaveSize(bytes: number, maxBytes: number = MAX_SAVE_BYTES): string {
  const limit: number = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : MAX_SAVE_BYTES;
  return checkPickedSize(bytes, limit);
}

export function messageKeyForFileError(code: string): string {
  switch (code) {
    case FILE_CANCELED:
      return 'file_error_canceled';
    case FILE_TOO_LARGE:
      return 'file_error_too_large';
    case FILE_UNAVAILABLE:
      return 'file_error_unavailable';
    case FILE_UNSUPPORTED:
      return 'file_error_unsupported';
    case FILE_EMPTY:
      return 'file_error_empty';
    case FILE_INVALID_PATH:
      return 'file_error_invalid_path';
    case FILE_NAME_INVALID:
      return 'file_error_name';
    case FILE_TIME_INVALID:
      return 'file_error_time';
    default:
      return 'file_error_io';
  }
}

export function buildFileName(options: FileNameOptions): string {
  const ext: string = extensionForKind(options.kind);
  const safeExt: string = ext.length > 0 ? ext : 'bin';
  const offset: number = options.offsetMinutes === undefined ? 0 : options.offsetMinutes;
  const stamp: string = buildTimestamp(options.nowMs, offset);
  const label: string = options.label === null || options.label === undefined ? '' : options.label;
  const prefix: string = options.prefix === null || options.prefix === undefined ? 'export' : options.prefix;
  let stem: string = sanitizeFileStem(prefix + '-' + label + '-' + stamp, 'export-' + stamp);
  const maxStem: number = MAX_FILE_NAME_LENGTH - safeExt.length - 1;
  stem = trimFileName(stem, maxStem > 0 ? maxStem : 1);
  if (stem.length === 0) {
    stem = 'file-' + stamp;
  }
  return ensureFileExtension(stem, safeExt);
}
