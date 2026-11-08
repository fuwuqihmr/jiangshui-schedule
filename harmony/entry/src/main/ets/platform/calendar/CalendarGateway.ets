// 职责：系统日历网关契约与不可用降级实现，对应规格 §4.3。
// 依赖方向：platform -> core；禁止 pages 直接 import 本文件。
// 阶段：P0 骨架；P6 再接 Calendar Kit（导入名待官方文档确认）。
// 待确认：Calendar Kit 本地账户、事件插入/删除 API 与权限常量名。
import { CalendarGateway, CalendarStatus, CalendarSyncRequest, CalendarSyncResult } from '../../core/types/Calendar';
import { ErrorCode } from '../../core/types/Common';

export class CalendarGatewayUnavailable implements CalendarGateway {
  status(): Promise<CalendarStatus> {
    const value: CalendarStatus = {
      available: false,
      writable: false,
      permission: 'denied',
      lastSyncAt: 0,
      lastEventCount: 0,
      lastSemesterId: '',
      calendarId: '',
      error: ErrorCode.CALENDAR_UNAVAILABLE
    };
    return Promise.resolve(value);
  }

  sync(request: CalendarSyncRequest): Promise<CalendarSyncResult> {
    return Promise.reject(new Error(ErrorCode.CALENDAR_UNAVAILABLE));
  }

  remove(): Promise<CalendarSyncResult> {
    return Promise.reject(new Error(ErrorCode.CALENDAR_UNAVAILABLE));
  }

  openSettings(): Promise<void> {
    return Promise.reject(new Error(ErrorCode.CALENDAR_UNAVAILABLE));
  }
}
