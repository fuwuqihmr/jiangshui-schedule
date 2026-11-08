// 职责：每日检查后台调度契约与不可用降级实现。
// 依赖方向：platform -> core；页面不直接调用 WorkScheduler。
// 阶段：P0 骨架；P3/P6 再接 WorkScheduler（API 12 可用性待确认）。
// 待确认：WorkScheduler 持续任务/延迟任务字段与系统配额限制。
import { ErrorCode } from '../../core/types/Common';

export interface DailyCheckScheduler {
  schedule(): Promise<void>;
  cancel(): Promise<void>;
  isScheduled(): Promise<boolean>;
}

export class DailyCheckSchedulerUnavailable implements DailyCheckScheduler {
  schedule(): Promise<void> {
    return Promise.reject(new Error(ErrorCode.BACKGROUND_UNAVAILABLE));
  }

  cancel(): Promise<void> {
    return Promise.reject(new Error(ErrorCode.BACKGROUND_UNAVAILABLE));
  }

  isScheduled(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
