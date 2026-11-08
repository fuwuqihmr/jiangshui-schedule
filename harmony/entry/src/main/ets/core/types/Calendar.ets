// 职责：系统日历事件、同步结果与 CalendarGateway 契约，对应规格 §4.3。
// 依赖方向：core 只依赖 AppState/Common；Kit 访问只在 platform/calendar。
// 阶段：P0 骨架；构建函数只签名并抛 NOT_IMPLEMENTED。
// 待确认：Calendar Kit API 12 的本地账户与事件字段名。
import type { AppState, CalendarOptions } from './AppState';

export interface CalendarEvent {
  key: string;
  title: string;
  location: string;
  description: string;
  startMillis: number;
  endMillis: number;
  startDate: string;
  startTime: string;
  endTime: string;
  source: string;
}

export interface CalendarBuildResult {
  events: CalendarEvent[];
  total: number;
  skipped: number;
  error: string | null;
}

export interface CalendarSyncRequest {
  semesterId: string;
  events: CalendarEvent[];
}

export interface CalendarSyncResult {
  ok: boolean;
  written: number;
  deleted: number;
  failed: number;
  skipped: number;
  calendarId: string;
  lastSyncAt: number;
  lastEventCount: number;
  remainingEventIds?: number[];
}

export interface CalendarStatus {
  available: boolean;
  writable: boolean;
  permission: 'granted' | 'denied' | 'prompt';
  lastSyncAt: number;
  lastEventCount: number;
  lastSemesterId: string;
  calendarId: string;
  error?: string;
}

export interface CalendarGateway {
  status(): Promise<CalendarStatus>;
  sync(request: CalendarSyncRequest): Promise<CalendarSyncResult>;
  remove(): Promise<CalendarSyncResult>;
  openSettings(): Promise<void>;
}

export function buildCalendarEvents(state: AppState, options: CalendarOptions): CalendarBuildResult {
  // core 只走 type-only import，enum 不能运行时取值，直接抛稳定码字符串（与 ErrorCode.NOT_IMPLEMENTED 一致）。
  throw new Error('NOT_IMPLEMENTED');
}
