// 职责：PermissionService 的平台不可用降级实现，返回 PERMISSION_UNAVAILABLE。
// 依赖方向：platform -> core/types；页面只依赖接口，不直接调用系统权限 API。
// 阶段：P0 骨架；P3/P6 再接权限申请与设置跳转（API 12 权限名待确认）。
// 待确认：requestPermissionsFromUser / 系统设置页 Ability 的最终签名。
import { PermissionResult, PermissionSnapshot, PermissionState, ErrorCode } from '../../core/types/Common';
import { PermissionService } from '../../core/types/Services';

export class PermissionServiceUnavailable implements PermissionService {
  status(): Promise<PermissionSnapshot> {
    const calendar: PermissionState = 'denied';
    const notification: PermissionState = 'denied';
    const value: PermissionSnapshot = {
      calendar: calendar,
      notification: notification
    };
    return Promise.resolve(value);
  }

  requestCalendar(): Promise<PermissionResult> {
    return Promise.reject(new Error(ErrorCode.PERMISSION_UNAVAILABLE));
  }

  requestNotification(): Promise<PermissionResult> {
    return Promise.reject(new Error(ErrorCode.PERMISSION_UNAVAILABLE));
  }

  openSystemSettings(kind: 'calendar' | 'notification' | 'battery' | 'autostart'): Promise<void> {
    return Promise.reject(new Error(ErrorCode.PERMISSION_UNAVAILABLE));
  }
}
