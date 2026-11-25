// 职责：教务/学工 Web 会话契约与不可用降级实现，对应规格 §4.5。
// 依赖方向：platform -> core；Web 组件 API 只在后续 platform 实现中使用。
// 阶段：P0 骨架；P3/P4 再接 Web 组件（Cookie/CAS 行为待官方文档确认）。
// 待确认：WebviewController、runJavaScript、JavaScriptProxy 在 API 12 的签名。
import { ErrorCode } from '../../core/types/Common';
import { LeaveRecord } from '../../core/types/Leave';

export interface OfficeWebSession {
  open(url: string, warmupUrl?: string): Promise<void>;
  runJavaScript<T>(script: string, timeoutMs: number): Promise<T>;
  reload(): Promise<void>;
  close(): Promise<void>;
}

export interface WebOfficeBridge {
  openLeaveService(key: 'leave' | 'cancel' | 'renew'): Promise<void>;
  fetchLeaveRecords(): Promise<LeaveRecord[]>;
  openCalendarSettings(): Promise<void>;
}

export class OfficeWebSessionUnavailable implements OfficeWebSession {
  open(url: string, warmupUrl?: string): Promise<void> {
    return Promise.reject(new Error(ErrorCode.WEB_UNAVAILABLE));
  }

  runJavaScript<T>(script: string, timeoutMs: number): Promise<T> {
    return Promise.reject(new Error(ErrorCode.WEB_UNAVAILABLE));
  }

  reload(): Promise<void> {
    return Promise.reject(new Error(ErrorCode.WEB_UNAVAILABLE));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
