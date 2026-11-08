// 职责：稳定错误码、主题与权限/诊断等公共契约，对应规格 §4.8。
// 依赖方向：core 内部最底层，禁止 import 其他业务模块或 Kit。
// 阶段：P0 骨架；只定义类型，不接入系统能力。
// 待确认：错误码中文文案由 string.json 映射，Core 不保存中文。
export enum ErrorCode {
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
  STATE_REVISION_CONFLICT = 'STATE_REVISION_CONFLICT',
  STATE_CORRUPT = 'STATE_CORRUPT',
  STATE_MIGRATION_FAILED = 'STATE_MIGRATION_FAILED',
  STATE_WRITE_FAILED = 'STATE_WRITE_FAILED',
  STATE_FILE_UNAVAILABLE = 'STATE_FILE_UNAVAILABLE',
  CALENDAR_UNAVAILABLE = 'CALENDAR_UNAVAILABLE',
  CALENDAR_NOT_WRITABLE = 'CALENDAR_NOT_WRITABLE',
  CALENDAR_INVALID_EVENT = 'CALENDAR_INVALID_EVENT',
  CALENDAR_WRITE_FAILED = 'CALENDAR_WRITE_FAILED',
  CALENDAR_NO_OPTIONS = 'CALENDAR_NO_OPTIONS',
  CALENDAR_TOO_MANY_EVENTS = 'CALENDAR_TOO_MANY_EVENTS',
  CALENDAR_TIMEOUT = 'CALENDAR_TIMEOUT',
  EXPORT_CANCELLED = 'EXPORT_CANCELLED',
  EXPORT_UNAVAILABLE = 'EXPORT_UNAVAILABLE',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  PERMISSION_UNAVAILABLE = 'PERMISSION_UNAVAILABLE',
  NOTIFY_UNAVAILABLE = 'NOTIFY_UNAVAILABLE',
  BACKGROUND_UNAVAILABLE = 'BACKGROUND_UNAVAILABLE',
  REMINDER_UNAVAILABLE = 'REMINDER_UNAVAILABLE',
  WEB_UNAVAILABLE = 'WEB_UNAVAILABLE',
  CLIPBOARD_UNAVAILABLE = 'CLIPBOARD_UNAVAILABLE',
  DIAGNOSTICS_UNAVAILABLE = 'DIAGNOSTICS_UNAVAILABLE',
  PREFERENCES_UNAVAILABLE = 'PREFERENCES_UNAVAILABLE',
  FORMAT_UNAVAILABLE = 'FORMAT_UNAVAILABLE',
  NETWORK_UNAVAILABLE = 'NETWORK_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  SCHOOL_LOGIN_REQUIRED = 'SCHOOL_LOGIN_REQUIRED',
  SCHOOL_CAPTCHA_REQUIRED = 'SCHOOL_CAPTCHA_REQUIRED',
  SCHOOL_NETWORK_FAILED = 'SCHOOL_NETWORK_FAILED',
  SCHOOL_TIMEOUT = 'SCHOOL_TIMEOUT',
  SCHOOL_SESSION_EXPIRED = 'SCHOOL_SESSION_EXPIRED',
  SCHOOL_PARSE_FAILED = 'SCHOOL_PARSE_FAILED',
  SCHOOL_EMPTY_TIMETABLE = 'SCHOOL_EMPTY_TIMETABLE',
  OFFICE_SESSION_REQUIRED = 'OFFICE_SESSION_REQUIRED',
  OFFICE_UNAVAILABLE = 'OFFICE_UNAVAILABLE',
  FILE_UNAVAILABLE = 'FILE_UNAVAILABLE',
  FILE_CANCELED = 'FILE_CANCELED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  FILE_WRITE_FAILED = 'FILE_WRITE_FAILED'
}

export interface ParseError { code: ErrorCode; message?: string; field?: string; }
export interface ParseResult<T> { ok: boolean; data?: T; error?: ParseError; }
export type ThemeId = 'system' | 'blue' | 'black' | 'white' | 'purple';

export interface OperationResult {
  ok: boolean;
  error?: string;
}

export interface PermissionResult {
  granted: boolean;
  error?: string;
}

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable';

export interface PermissionSnapshot {
  calendar: PermissionState;
  notification: PermissionState;
  background: PermissionState;
}

export interface DiagnosticsSnapshot {
  appVersion: string;
  systemVersion: string;
  apiVersion: number;
  stateRevision: number;
  lastSyncAt: number;
  errors: string[];
}

export interface ReminderStatus {
  enabled: boolean;
  permission: 'granted' | 'denied';
  count: number;
}




