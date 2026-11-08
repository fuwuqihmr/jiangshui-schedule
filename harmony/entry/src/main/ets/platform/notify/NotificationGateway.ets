// 职责：系统通知通道契约与不可用降级实现。
// 依赖方向：platform -> core；页面不直接调用 Notification Kit。
// 阶段：P0 骨架；P3/P6 再接 Notification Kit（权限名待确认）。
// 待确认：通知渠道创建与授权 API 在 API 12 的具体签名。
import { ErrorCode, PermissionResult } from '../../core/types/Common';

export interface NotificationShowRequest {
  title: string;
  body: string;
  route?: string;
}

export interface NotificationGateway {
  ensureChannel(): Promise<void>;
  show(request: NotificationShowRequest): Promise<void>;
  requestPermission(): Promise<PermissionResult>;
}

export class NotificationGatewayUnavailable implements NotificationGateway {
  ensureChannel(): Promise<void> {
    return Promise.reject(new Error(ErrorCode.NOTIFY_UNAVAILABLE));
  }

  show(request: NotificationShowRequest): Promise<void> {
    return Promise.reject(new Error(ErrorCode.NOTIFY_UNAVAILABLE));
  }

  requestPermission(): Promise<PermissionResult> {
    const value: PermissionResult = {
      granted: false,
      error: ErrorCode.NOTIFY_UNAVAILABLE
    };
    return Promise.resolve(value);
  }
}
