// 职责：Reminder Agent Kit 上课提醒网关（platform 适配层）。
// 依赖方向：platform -> core 类型与纯逻辑；页面只经 features/system 调用。
// 阶段：P6 上课提醒；先清掉本应用全部提醒再按最新计划排，保证幂等、不重复。

import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { notificationManager } from '@kit.NotificationKit';
import type { BusinessError } from '@kit.BasicServicesKit';
import { ErrorCode, ReminderStatus } from '../../core/types/Common';
import type { ReminderTarget } from '../../core/system/ReminderPlanner';
import { classifyReminderFailure, REMINDER_NOTIFICATION_LIMIT } from '../../core/system/NotificationState';
import { NOTIFY_PERMISSION_REQUIRED } from '../../core/system/ReminderGate';

export interface ReminderReconcileResult {
  written: number;
  failed: number;
  error: string;
}

interface ReminderPublishResult {
  ok: boolean;
  code: string;
}

const NOTIFICATION_BASE = 21000;
// 上限与 core 的归因逻辑共用同一常量：只有真的排到上限，1700002 才算「提醒数量超限」。
const NOTIFICATION_LIMIT = REMINDER_NOTIFICATION_LIMIT;

function errorCodeOf(error: Error): string {
  const business: BusinessError = error as BusinessError;
  const code: number = business.code;
  if (typeof code === 'number') {
    return String(code);
  }
  return '';
}

export class ReminderKitGateway {
  private async publishOne(target: ReminderTarget, index: number): Promise<ReminderPublishResult> {
    const dateParts = target.date.split('-');
    const timeParts = target.startTime.split(':');
    if (dateParts.length < 3 || timeParts.length < 2) {
      const invalid: ReminderPublishResult = { ok: false, code: 'REMINDER_DATE_INVALID' };
      return invalid;
    }
    const dateTime: reminderAgentManager.LocalDateTime = {
      year: Number(dateParts[0]),
      month: Number(dateParts[1]),
      day: Number(dateParts[2]),
      hour: Number(timeParts[0]),
      minute: Number(timeParts[1]),
      second: 0
    };
    const request: reminderAgentManager.ReminderRequestCalendar = {
      reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
      dateTime: dateTime,
      title: target.name,
      content: target.room + ' ' + target.startTime + '-' + target.endTime,
      notificationId: NOTIFICATION_BASE + index,
      slotType: notificationManager.SlotType.SOCIAL_COMMUNICATION
    };
    try {
      await reminderAgentManager.publishReminder(request);
      const ok: ReminderPublishResult = { ok: true, code: '' };
      return ok;
    } catch (error) {
      const code = errorCodeOf(error as Error);
      console.info('reminder-publish failed code=' + code + ' notificationId=' + String(NOTIFICATION_BASE + index));
      const failed: ReminderPublishResult = { ok: false, code: code };
      return failed;
    }
  }

  async status(): Promise<ReminderStatus> {
    try {
      const valid = await reminderAgentManager.getValidReminders();
      const count = valid.length;
      const value: ReminderStatus = {
        enabled: count > 0,
        permission: 'granted',
        count: count
      };
      return value;
    } catch (error) {
      const denied: ReminderStatus = {
        enabled: false,
        permission: 'denied',
        count: 0
      };
      return denied;
    }
  }

  /**
   * 返回成功/失败条数与降级码；失败时仍尽量清空旧提醒，避免残留过期提醒。
   * notificationsVerifiedOn：调用方多路证据得出的「通知可验证已开启」结论（api26 上通常为 false）。
   * 起归因统一走 core.classifyReminderFailure：未验证时一律「通知受限」；
   * 只有真的排到 120 条上限，1700002 才按「提醒数量超限」处理，绝不显示成权限正常。
   */
  async reconcile(targets: ReminderTarget[], notificationsVerifiedOn: boolean = true): Promise<ReminderReconcileResult> {
    try {
      await reminderAgentManager.cancelAllReminders();
    } catch (error) {
      const code = ErrorCode.REMINDER_UNAVAILABLE;
      console.info('reminder-reconcile written=0 failed=' + String(targets.length) +
        ' firstCode=- stage=cancel error=' + code);
      return { written: 0, failed: targets.length, error: code };
    }
    let validBefore = -1;
    try {
      const valid = await reminderAgentManager.getValidReminders();
      validBefore = valid.length;
    } catch (error) {
      validBefore = -1;
    }
    console.info('reminder-reconcile valid-before=' + String(validBefore) +
      ' verifiedOn=' + (notificationsVerifiedOn ? 'on' : 'off') + ' targets=' + String(targets.length));
    let written = 0;
    let failed = 0;
    let firstCode = '';
    const limit = targets.length < NOTIFICATION_LIMIT ? targets.length : NOTIFICATION_LIMIT;
    for (let i = 0; i < limit; i++) {
      const outcome = await this.publishOne(targets[i], i);
      if (outcome.ok) {
        written++;
      } else {
        failed++;
        if (firstCode === '') {
          firstCode = outcome.code;
        }
      }
    }
    const over = targets.length - limit;
    if (over > 0) {
      failed += over;
      if (firstCode === '') {
        firstCode = 'REMINDER_LIMIT_EXCEEDED';
      }
    }
    let error = '';
    const kind = classifyReminderFailure(failed, targets.length, firstCode, notificationsVerifiedOn);
    if (kind === 'notify-permission') {
      // 通知未验证/受系统限制：先让用户去系统设置确认通知，不能显示成权限正常。
      error = NOTIFY_PERMISSION_REQUIRED;
      console.info('reminder-classify result=notify-permission firstCode=' + firstCode +
        ' targets=' + String(targets.length) + ' failed=' + String(failed));
    } else if (kind === 'reminder-limit') {
      // 只有真的到了 120 条上限，1700002 才能解释为「提醒数量超限」。
      error = ErrorCode.REMINDER_UNAVAILABLE;
      console.info('reminder-limit code=' + firstCode + ' written=' + String(written) +
        ' failed=' + String(failed) + ' limit=' + String(NOTIFICATION_LIMIT));
    } else if (kind === 'reminder-unavailable') {
      error = ErrorCode.REMINDER_UNAVAILABLE;
      console.info('reminder-classify result=reminder-unavailable firstCode=' + firstCode);
    }
    console.info('reminder-reconcile written=' + String(written) + ' failed=' + String(failed) +
      ' firstCode=' + firstCode + ' error=' + error);
    return { written: written, failed: failed, error: error };
  }

  async preview(title: string, content: string): Promise<void> {
    const request: notificationManager.NotificationRequest = {
      id: 22001,
      content: {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: {
          title: title,
          text: content
        }
      }
    };
    try {
      await notificationManager.publish(request);
    } catch (error) {
      throw new Error(ErrorCode.REMINDER_UNAVAILABLE);
    }
  }

  async clear(): Promise<void> {
    try {
      await reminderAgentManager.cancelAllReminders();
    } catch (error) {
      throw new Error(ErrorCode.REMINDER_UNAVAILABLE);
    }
  }
}
