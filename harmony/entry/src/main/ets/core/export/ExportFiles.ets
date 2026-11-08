// 职责：导出文件名 / MIME / 体积上限契约，对齐 web/timetable-export.mjs 与 Android exportFile 校验。
// 依赖方向：只 import type core/types；零运行时 import，Node 可直接断言。
// 阶段：P5 导出落地；底层写盘由 platform/export 走 file.picker(SAF) 完成，本文件不接系统能力。
// 待确认：鸿蒙 DocumentViewPicker 的 MIME 过滤参数以官方文档为准，本文件只给校验口径。
import type { ExportKind } from '../types/Export';

export const MIME_PNG: string = 'image/png';
export const MIME_PDF: string = 'application/pdf';
export const MIME_TEXT: string = 'text/plain';
export const MIME_JSON: string = 'application/json';
export const MAX_EXPORT_BYTES: number = 33 * 1024 * 1024;
export const MAX_FILE_NAME_LENGTH: number = 180;
export const MAX_DIAGNOSTICS_TEXT: number = 200000;
export const UNSAFE_FILE_CHARS: string = '\\/:*?"<>|';

export const CODE_NAME_UNSAFE: string = 'EXPORT_NAME_UNSAFE';
export const CODE_TOO_LARGE: string = 'EXPORT_TOO_LARGE';
export const CODE_BAD_MIME: string = 'EXPORT_MIME_UNSUPPORTED';
export const CODE_BAD_EXTENSION: string = 'EXPORT_EXTENSION_UNSUPPORTED';
export const CODE_INVALID_TIME: string = 'EXPORT_TIME_INVALID';

export interface ExportFileSpec {
  mime: string;
  extension: string;
}

export interface ExportValidation {
  ok: boolean;
  code: string;
}

export interface ExportFileNameOptions {
  prefix: string;
  label: string;
  kind: ExportKind;
  nowMs: number;
  offsetMinutes: number;
}

// web 口径文件名：<前缀>-<种类标签>-<学期开始日期>.<扩展名>。
export interface WebExportFileNameOptions {
  prefix: string;
  label: string;
  startDate: string;
  kind: ExportKind;
}

export function exportFileSpec(kind: ExportKind): ExportFileSpec {
  if (kind === 'semester-overview') {
    return { mime: MIME_PNG, extension: 'png' };
  }
  if (kind === 'rules-text') {
    return { mime: MIME_TEXT, extension: 'txt' };
  }
  return { mime: MIME_PDF, extension: 'pdf' };
}

export function isAllowedMime(mime: string): boolean {
  return mime === MIME_PNG || mime === MIME_PDF || mime === MIME_TEXT || mime === MIME_JSON;
}

function isUnsafeChar(ch: string): boolean {
  return UNSAFE_FILE_CHARS.indexOf(ch) >= 0;
}

function pad2(value: number): string {
  return value < 10 ? '0' + String(value) : String(value);
}

export function requireFiniteTime(nowMs: number): number {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    throw new Error(CODE_INVALID_TIME);
  }
  return nowMs;
}

// 展示用时间戳：yyyy-MM-dd HH:mm（固定 +08:00，避免 core 依赖 Intl 时区数据）。
export function formatStamp(nowMs: number, offsetMinutes: number): string {
  const shifted = new Date(requireFiniteTime(nowMs) + offsetMinutes * 60000).toISOString();
  return shifted.slice(0, 10) + ' ' + shifted.slice(11, 16);
}

// 文件名用紧凑时间戳：yyyyMMdd-HHmm（只含数字与连字符，满足 Android 排查日志文件名规则）。
export function compactStamp(nowMs: number, offsetMinutes: number): string {
  const shifted = new Date(requireFiniteTime(nowMs) + offsetMinutes * 60000).toISOString();
  return shifted.slice(0, 4) + shifted.slice(5, 7) + shifted.slice(8, 10) + '-' + shifted.slice(11, 13) + shifted.slice(14, 16);
}

export function sanitizeFileName(name: string, fallback: string): string {
  const source: string = typeof name === 'string' ? name : '';
  let out: string = '';
  let lastSpace: boolean = false;
  for (let i = 0; i < source.length; i++) {
    const ch: string = source.charAt(i);
    const code: number = source.charCodeAt(i);
    const control: boolean = code < 32 || code === 127;
    if (control || isUnsafeChar(ch)) {
      continue;
    }
    const space: boolean = ch === ' ' || ch === '\t';
    if (space) {
      if (lastSpace || out.length === 0) {
        continue;
      }
      out += ' ';
      lastSpace = true;
      continue;
    }
    out += ch;
    lastSpace = false;
  }
  while (out.length > 0 && (out.charAt(out.length - 1) === ' ' || out.charAt(out.length - 1) === '.')) {
    out = out.slice(0, out.length - 1);
  }
  while (out.length > 0 && (out.charAt(0) === ' ' || out.charAt(0) === '.')) {
    out = out.slice(1);
  }
  if (out.length === 0) {
    out = fallback;
  }
  if (out.length > MAX_FILE_NAME_LENGTH) {
    out = out.slice(0, MAX_FILE_NAME_LENGTH);
  }
  return out;
}

export function ensureExtension(name: string, extension: string): string {
  const suffix: string = '.' + extension;
  if (name.length >= suffix.length && name.toLowerCase().slice(name.length - suffix.length) === suffix) {
    return name;
  }
  return name + suffix;
}

export function isSafeFileName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_FILE_NAME_LENGTH) {
    return false;
  }
  for (let i = 0; i < name.length; i++) {
    const code: number = name.charCodeAt(i);
    if (code < 32 || code === 127 || isUnsafeChar(name.charAt(i))) {
      return false;
    }
  }
  if (name.charAt(0) === '.' || name.charAt(0) === ' ') {
    return false;
  }
  return name.charAt(name.length - 1) !== ' ' && name.charAt(name.length - 1) !== '.';
}

// 课表导出：<前缀>-<标签>-<紧凑时间戳>.<扩展名>；前缀/标签由 UI 给中文，core 不拼中文。
export function buildExportFileName(options: ExportFileNameOptions): string {
  const spec: ExportFileSpec = exportFileSpec(options.kind);
  const raw: string = options.prefix + '-' + options.label + '-' + compactStamp(options.nowMs, options.offsetMinutes);
  const safe: string = sanitizeFileName(raw, 'export');
  return ensureExtension(safe, spec.extension);
}

// web timetable-export.mjs:658/666/689 同口径：不带导出时刻，只有学期开始日期。
// Demo mode only changes the file-name prefix, never course names.
export function buildExportPrefix(filePrefix: string, samplePrefix: string, demoMode: boolean): string {
  const base: string = typeof filePrefix === 'string' && filePrefix.length > 0 ? filePrefix : 'export';
  if (demoMode === true) {
    return (typeof samplePrefix === 'string' ? samplePrefix : '') + base;
  }
  return base;
}

export function buildWebExportFileName(options: WebExportFileNameOptions): string {
  const spec: ExportFileSpec = exportFileSpec(options.kind);
  const datePart: string = sanitizeFileName(options.startDate, '');
  const raw: string = datePart.length > 0
    ? options.prefix + '-' + options.label + '-' + datePart
    : options.prefix + '-' + options.label;
  return ensureExtension(sanitizeFileName(raw, 'export'), spec.extension);
}

// 排查日志文件名：<前缀>-<标签>-<yyyyMMdd-HHmm>.txt（Android 侧正则要求只有数字与连字符）。
export function buildDiagnosticsFileName(prefix: string, label: string, nowMs: number, offsetMinutes: number): string {
  const raw: string = prefix + '-' + label + '-' + compactStamp(nowMs, offsetMinutes);
  return ensureExtension(sanitizeFileName(raw, 'diagnostics'), 'txt');
}

export function validateExportPayload(mime: string, extension: string, name: string, byteLength: number): ExportValidation {
  if (!isAllowedMime(mime)) {
    return { ok: false, code: CODE_BAD_MIME };
  }
  const expected: string = extension.toLowerCase();
  if (expected !== 'png' && expected !== 'pdf' && expected !== 'txt' && expected !== 'json') {
    return { ok: false, code: CODE_BAD_EXTENSION };
  }
  if (!isSafeFileName(name)) {
    return { ok: false, code: CODE_NAME_UNSAFE };
  }
  if (typeof byteLength !== 'number' || !Number.isFinite(byteLength) || byteLength <= 0 || byteLength > MAX_EXPORT_BYTES) {
    return { ok: false, code: CODE_TOO_LARGE };
  }
  return { ok: true, code: 'OK' };
}
