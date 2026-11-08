// 职责：课程提醒网关契约与不可用降级实现，对应规格 §4.8。
// 依赖方向：platform -> core；页面只读状态，不直接调用 Reminder Agent。
// 阶段：P0 骨架；P6 再接 Reminder Agent Kit（权限名待确认）。
// 待确认：Reminder Agent 的发布/取消/查询接口与 API 12 权限常量。
import { CourseRow, ClassReminderSettings } from '../../core/types/AppState';
import { ErrorCode, ReminderStatus } from '../../core/types/Common';

export interface ReminderGateway {
  reconcile(rows: CourseRow[], settings: ClassReminderSettings): Promise<void>;
  status(): Promise<ReminderStatus>;
  preview(): Promise<void>;
  close(): Promise<void>;
}

export class ReminderGatewayUnavailable implements ReminderGateway {
  reconcile(rows: CourseRow[], settings: ClassReminderSettings): Promise<void> {
    return Promise.reject(new Error(ErrorCode.REMINDER_UNAVAILABLE));
  }

  status(): Promise<ReminderStatus> {
    const value: ReminderStatus = {
      enabled: false,
      permission: 'denied',
      count: 0
    };
    return Promise.resolve(value);
  }

  preview(): Promise<void> {
    return Promise.reject(new Error(ErrorCode.REMINDER_UNAVAILABLE));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
