// 职责：Work Scheduler 每日后台检查的调度入口（platform 适配层）。
// 依赖方向：platform -> core 类型；页面只经 features/system 调用。
// 阶段：P6 每日后台检查；启动/停止/查询均真实调用系统接口，失败返回 BACKGROUND_UNAVAILABLE。

import { workScheduler } from '@kit.BackgroundTasksKit';
import { ErrorCode } from '../../core/types/Common';

const WORK_ID = 12001;
const BUNDLE_NAME = 'cn.local.tomorrow';
const ABILITY_NAME = 'SystemWorkAbility';
const REPEAT_MILLIS = 86400000;

export interface BackgroundStatus {
  available: boolean;
  started: boolean;
  error: string;
}

export class BackgroundScheduler {
  private buildWork(): workScheduler.WorkInfo {
    const work: workScheduler.WorkInfo = {
      workId: WORK_ID,
      bundleName: BUNDLE_NAME,
      abilityName: ABILITY_NAME,
      networkType: workScheduler.NetworkType.NETWORK_TYPE_ANY,
      isPersisted: true,
      isRepeat: true,
      repeatCycleTime: REPEAT_MILLIS
    };
    return work;
  }

  async status(): Promise<BackgroundStatus> {
    try {
      await workScheduler.getWorkStatus(WORK_ID);
      const running: BackgroundStatus = { available: true, started: true, error: '' };
      return running;
    } catch (error) {
      const idle: BackgroundStatus = { available: true, started: false, error: '' };
      return idle;
    }
  }

  async start(): Promise<BackgroundStatus> {
    try {
      workScheduler.startWork(this.buildWork());
    } catch (error) {
      const failed: BackgroundStatus = { available: false, started: false, error: ErrorCode.BACKGROUND_UNAVAILABLE };
      return failed;
    }
    const started: BackgroundStatus = { available: true, started: true, error: '' };
    return started;
  }

  async stop(): Promise<BackgroundStatus> {
    try {
      workScheduler.stopWork(this.buildWork(), true);
    } catch (error) {
      const failed: BackgroundStatus = { available: false, started: false, error: ErrorCode.BACKGROUND_UNAVAILABLE };
      return failed;
    }
    const stopped: BackgroundStatus = { available: true, started: false, error: '' };
    return stopped;
  }
}
