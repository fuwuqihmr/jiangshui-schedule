// 职责：Work Scheduler 扩展入口，每日后台读取缓存并刷新角标/变更通知。
// 依赖方向：platform -> core 类型；由系统按 workScheduler 计划拉起，页面不直接调用。
// 阶段：P6 每日后台检查；系统限制单次执行时长，失败只记录 BACKGROUND_UNAVAILABLE 不阻塞下次。

import { WorkSchedulerExtensionAbility, workScheduler } from '@kit.BackgroundTasksKit';
import { notificationManager } from '@kit.NotificationKit';
import { ErrorCode } from '../../core/types/Common';
import { SystemCacheStore } from './SystemCacheStore';
import type { SystemCache } from './SystemCacheStore';

export default class SystemWorkAbility extends WorkSchedulerExtensionAbility {
  private lastError: string = '';

  onWorkStart(work: workScheduler.WorkInfo): void {
    this.runCheck(work);
  }

  onWorkStop(work: workScheduler.WorkInfo): void {
    this.lastError = '';
  }

  private async runCheck(work: workScheduler.WorkInfo): Promise<void> {
    try {
      const store = new SystemCacheStore(this.context);
      const cache: SystemCache = await store.read();
      if (cache.unread <= 0) {
        return;
      }
      const badge = cache.unread > 99 ? 99 : cache.unread;
      await notificationManager.setBadgeNumber(badge);
      const request: notificationManager.NotificationRequest = {
        id: 22003,
        content: {
          notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: {
            title: cache.latestTitle,
            text: cache.latestDetail
          }
        }
      };
      await notificationManager.publish(request);
    } catch (error) {
      this.lastError = ErrorCode.BACKGROUND_UNAVAILABLE;
    }
  }
}
