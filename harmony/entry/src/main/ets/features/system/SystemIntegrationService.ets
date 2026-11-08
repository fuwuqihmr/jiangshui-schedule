// 职责：系统集成的应用层编排（features 层），串起日历写入、上课提醒、后台检查与红点/通知。
// 依赖方向：features -> core 纯逻辑与 platform 适配器；页面只调用本服务，不直接碰 Kit。
// 阶段：P6 系统集成；所有失败返回稳定 code，由 SystemIntegrationCard 显示可操作文案。

import type { AppState, CourseRow } from '../../core/types/AppState';
import type { CalendarSyncResult } from '../../core/types/Calendar';
import type { PermissionSnapshot, ReminderStatus } from '../../core/types/Common';
import { ErrorCode } from '../../core/types/Common';
import { addDays, resolveDay } from '../../core/timetable/TimetableCore';
import { planCalendarEvents } from '../../core/system/CalendarPlanner';
import { planReminders } from '../../core/system/ReminderPlanner';
import type { ReminderDay, ReminderPlan, ReminderTarget } from '../../core/system/ReminderPlanner';
import { decideReminderGate, NOTIFY_PERMISSION_REQUIRED, NOTIFY_PERMISSION_UNVERIFIED } from '../../core/system/ReminderGate';
import type { NotificationRequestResult, ReminderGateDecision, ReminderGateInput } from '../../core/system/ReminderGate';
import { NOTIFY_SETTINGS_FAILED_CODE, notificationDisplayState, notificationFailureClass } from '../../core/system/NotificationState';
import type { NotifyRequestOutcome, NotifySettingsOutcome } from '../../core/system/NotificationState';
import { badgeNumber, summarizeUnread } from '../../core/system/UnreadSummary';
import type { UnreadSummary } from '../../core/system/UnreadSummary';
import { CalendarKitGateway } from '../../platform/system/CalendarKitGateway';
import { ReminderKitGateway } from '../../platform/system/ReminderKitGateway';
import { BackgroundScheduler } from '../../platform/system/BackgroundScheduler';
import type { BackgroundStatus } from '../../platform/system/BackgroundScheduler';
import { NotificationKitGateway } from '../../platform/system/NotificationKitGateway';
import { SystemPermissionService } from '../../platform/system/SystemPermissionService';
import { SystemCacheStore } from '../../platform/system/SystemCacheStore';
import type { SystemCache } from '../../platform/system/SystemCacheStore';
import { calendarDisplayState } from './CalendarDisplay';

const REMINDER_HORIZON_DAYS = 8;

export interface SystemStatusView {
  calendarPermission: string;
  notificationPermission: string;
  notificationEnabled: boolean;
  // true=开关由多路证据确认（含发布探针）；false=无法可靠读取，卡片必须提示去系统设置确认。
  notificationVerified: boolean;
  backgroundPermission: string;
  calendarAvailable: boolean;
  reminderCount: number;
  reminderPermission: string;
  backgroundStarted: boolean;
  unread: number;
  error: string;
}

export interface NotificationView {
  permission: string;
  enabled: boolean;
  verified: boolean;
  source: string;
}

// 日历展示态只由「能力是否可用 + 授权是否已知」决定；能力不可用或授权未知一律 unavailable。
export interface CalendarView {
  available: boolean;
  permission: string;
}

export interface SystemActionView {
  ok: boolean;
  code: string;
  written: number;
  deleted: number;
  failed: number;
  unread: number;
  // 失败来源：'reminder' 表示上课提醒链路，用于区分同一错误码的不同文案口径。
  scope: string;
}

function pad2(value: number): string {
  return value < 10 ? '0' + String(value) : String(value);
}

function todayKey(): string {
  const now = new Date();
  return String(now.getFullYear()) + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
}

function failure(code: string, scope: string = ''): SystemActionView {
  const value: SystemActionView = {
    ok: false,
    code: code,
    written: 0,
    deleted: 0,
    failed: 0,
    unread: 0,
    scope: scope
  };
  return value;
}

function success(written: number, deleted: number, failed: number, scope: string = ''): SystemActionView {
  const value: SystemActionView = {
    ok: failed === 0,
    code: '',
    written: written,
    deleted: deleted,
    failed: failed,
    unread: 0,
    scope: scope
  };
  return value;
}

export class SystemIntegrationService {
  static unreadSummary(state: AppState): UnreadSummary {
    return summarizeUnread(state);
  }

  static async loadStatus(context: object, state: AppState): Promise<SystemStatusView> {
    const permissions = new SystemPermissionService(context);
    const calendar = new CalendarKitGateway(context);
    const reminders = new ReminderKitGateway();
    const background = new BackgroundScheduler();
    const notifications = new NotificationKitGateway(context);
    const permissionSnapshot: PermissionSnapshot = await permissions.status();
    const calendarStatus = await calendar.status();
    const notificationStatus = await notifications.status();
    const reminderStatus: ReminderStatus = await reminders.status();
    const backgroundStatus: BackgroundStatus = await background.status();
    const summary = summarizeUnread(state);
    // 不可证即不声称：只允许 unavailable/denied/unverified 三种显示，granted/prompt 一律显示「无法确认」。
    const notificationPermission: string = notificationDisplayState(notificationStatus.permission);
    const value: SystemStatusView = {
      // 只有能力可用且授权状态已知时才透出 granted/prompt；能力不可用时统一显示「本机暂不可用」。
      calendarPermission: calendarDisplayState(calendarStatus.available, permissionSnapshot.calendar),
      // 通知开关不再作为「已开启」依据（api26 标志不可信），字段保留仅为兼容。
      notificationPermission: notificationPermission,
      notificationEnabled: false,
      // 只有系统明确关闭（denied）才算状态可确认；unverified/unavailable 都不可确认。
      notificationVerified: notificationPermission === 'denied',
      backgroundPermission: permissionSnapshot.background,
      calendarAvailable: calendarStatus.available,
      reminderCount: reminderStatus.count,
      reminderPermission: reminderStatus.permission,
      backgroundStarted: backgroundStatus.started,
      unread: summary.unread,
      error: calendarStatus.error !== undefined && calendarStatus.error !== null ? calendarStatus.error : ''
    };
    return value;
  }

  static async writeCalendar(context: object, state: AppState): Promise<SystemActionView> {
    try {
      const plan = planCalendarEvents(state, state.calendarOptions, resolveDay);
      if (plan.error !== undefined && plan.error !== null && plan.error !== '') {
        return failure(plan.error);
      }
      const gateway = new CalendarKitGateway(context);
      const semesterId = state.snapshot !== null ? state.snapshot.id : '';
      const result: CalendarSyncResult = await gateway.sync({ semesterId: semesterId, events: plan.events });
      if (!result.ok) {
        const failedView = failure(ErrorCode.CALENDAR_WRITE_FAILED);
        failedView.written = result.written;
        failedView.deleted = result.deleted;
        failedView.failed = result.failed;
        return failedView;
      }
      return success(result.written, result.deleted, result.failed);
    } catch (error) {
      return failure(ErrorCode.CALENDAR_UNAVAILABLE);
    }
  }

  static async removeCalendar(context: object): Promise<SystemActionView> {
    try {
      const gateway = new CalendarKitGateway(context);
      const result: CalendarSyncResult = await gateway.remove();
      if (!result.ok) {
        const failedView = failure(ErrorCode.CALENDAR_WRITE_FAILED);
        failedView.written = result.written;
        failedView.deleted = result.deleted;
        failedView.failed = result.failed;
        return failedView;
      }
      return success(result.written, result.deleted, result.failed);
    } catch (error) {
      return failure(ErrorCode.CALENDAR_UNAVAILABLE);
    }
  }

  // 通知权限门：api26 上通知开关不可证，所以首次输入固定为「未验证」→ 必走系统申请；
  // 平台口头成功只算 proceed-unverified（照常尝试登记），拒绝才 blocked。
  // 下游 reconcile 的第二参数永远来自「可验证已开启」证据；当前没有任何路径能给出该证据，即恒为 false。
  static async applyReminders(context: object, state: AppState): Promise<SystemActionView> {
    try {
      const notifications = new NotificationKitGateway(context);
      const notificationStatus = await notifications.status();
      if (notificationStatus.error === ErrorCode.NOTIFY_UNAVAILABLE) {
        return failure(ErrorCode.NOTIFY_UNAVAILABLE, 'reminder');
      }
      let targets: ReminderTarget[] = [];
      if (state.classReminders.enabled) {
        targets = SystemIntegrationService.buildReminderPlan(state).targets;
      }
      let requestResult: NotificationRequestResult = 'none';
      const firstInput: ReminderGateInput = {
        remindersEnabled: state.classReminders.enabled,
        targetCount: targets.length,
        // 不信任任何开关标志：未经证据复验的 enabled 一律按 false 处理。
        notificationEnabled: false,
        notificationVerified: false,
        requestResult: requestResult
      };
      let decision: ReminderGateDecision = decideReminderGate(firstInput);
      if (decision.action === 'request') {
        const outcome: NotifyRequestOutcome = await notifications.requestEnable();
        const failureClass = notificationFailureClass(outcome);
        console.info('reminder-gate request=' + outcome.result + ' code=' + outcome.code + ' class=' + failureClass);
        if (failureClass === 'unavailable') {
          return failure(ErrorCode.NOTIFY_UNAVAILABLE, 'reminder');
        }
        // permission=用户拒绝/系统不再弹框 → blocked；其余（含 granted/unverified）→ 尝试登记但不声称已开启。
        requestResult = failureClass === 'permission' ? 'denied' : 'granted';
        const secondInput: ReminderGateInput = {
          remindersEnabled: state.classReminders.enabled,
          targetCount: targets.length,
          notificationEnabled: false,
          notificationVerified: false,
          requestResult: requestResult
        };
        decision = decideReminderGate(secondInput);
      }
      console.info('reminder-gate action=' + decision.action +
        ' notificationOn=' + (decision.notificationOn ? 'on' : 'off') +
        ' request=' + requestResult + ' targets=' + String(targets.length) + ' code=' + decision.code);
      const gateway = new ReminderKitGateway();
      if (decision.action === 'clear') {
        await gateway.clear();
        return success(0, 0, 0, 'reminder');
      }
      if (decision.action === 'blocked') {
        return failure(decision.code, 'reminder');
      }
      // decision.notificationOn 才代表「可验证已开启」；为 false 时提醒失败按通知未验证归因。
      const result = await gateway.reconcile(targets, decision.notificationOn);
      console.info('reminder-result written=' + String(result.written) + ' failed=' + String(result.failed) +
        ' code=' + result.error);
      const view = success(result.written, 0, result.failed, 'reminder');
      if (result.error !== '') {
        view.code = result.error;
      }
      return view;
    } catch (error) {
      return failure(ErrorCode.REMINDER_UNAVAILABLE, 'reminder');
    }
  }

  static async clearReminders(): Promise<SystemActionView> {
    try {
      const gateway = new ReminderKitGateway();
      await gateway.clear();
      return success(0, 0, 0);
    } catch (error) {
      return failure(ErrorCode.REMINDER_UNAVAILABLE);
    }
  }

  /** 供权限卡读取日历能力与授权：能力不可用/查询失败一律 unavailable，绝不把未知状态当 granted。 */
  static async calendarView(context: object): Promise<CalendarView> {
    try {
      const permissions = new SystemPermissionService(context);
      const gateway = new CalendarKitGateway(context);
      const snapshot: PermissionSnapshot = await permissions.status();
      const status = await gateway.status();
      const value: CalendarView = {
        available: status.available,
        permission: calendarDisplayState(status.available, snapshot.calendar)
      };
      return value;
    } catch (error) {
      const value: CalendarView = { available: false, permission: 'unavailable' };
      return value;
    }
  }

  /** 供页面入口（设置页「去开启」）读取通知真值：只透出 unavailable/denied/unverified。 */
  static async notificationView(context: object): Promise<NotificationView> {
    const gateway = new NotificationKitGateway(context);
    const status = await gateway.status();
    const permission: string = notificationDisplayState(status.permission);
    const value: NotificationView = {
      permission: permission,
      // 任何查询结果都不构成「已开启」证据。
      enabled: false,
      verified: permission === 'denied',
      source: status.source
    };
    return value;
  }

  // 同 applyReminders：用户拒绝时返回可操作错误码（去系统设置），而不是泛化的「通知不可用」。
  static async enableNotifications(context: object): Promise<SystemActionView> {
    try {
      const gateway = new NotificationKitGateway(context);
      // 点击后立即留痕：即使系统弹框迟迟不返回，真机日志也能证明申请已发起。
      console.info('notify-enable requested=1 source=integration-card');
      const outcome: NotifyRequestOutcome = await gateway.requestEnable();
      const failureClass = notificationFailureClass(outcome);
      console.info('notify-enable result=' + outcome.result + ' code=' + outcome.code + ' class=' + failureClass);
      if (failureClass === 'unavailable') {
        return failure(ErrorCode.NOTIFY_UNAVAILABLE);
      }
      if (failureClass === 'permission') {
        // 用户拒绝、系统不再弹框、或调用无效：一律提示去系统设置，不能报「已开启」。
        return failure(NOTIFY_PERMISSION_REQUIRED);
      }
      // 平台返回成功/无效果但无法确认用户可见：不能报成功，也不能谎称已开启。
      return failure(NOTIFY_PERMISSION_UNVERIFIED);
    } catch (error) {
      return failure(ErrorCode.NOTIFY_UNAVAILABLE);
    }
  }

  static async syncBadge(context: object, state: AppState): Promise<SystemActionView> {
    try {
      const summary = summarizeUnread(state);
      const badge = badgeNumber(summary.unread);
      const gateway = new NotificationKitGateway(context);
      const applied = await gateway.syncBadge(badge);
      const value = success(0, 0, 0);
      value.unread = applied;
      return value;
    } catch (error) {
      return failure(ErrorCode.NOTIFY_UNAVAILABLE);
    }
  }

  static async notifyChanges(context: object, state: AppState): Promise<SystemActionView> {
    const summary = summarizeUnread(state);
    if (summary.unread <= 0) {
      return success(0, 0, 0);
    }
    try {
      const gateway = new NotificationKitGateway(context);
      const text = summary.latestDetail !== '' ? summary.latestDetail : summary.latestDate;
      await gateway.publish(summary.latestTitle, text);
      const value = success(0, 0, 0);
      try {
        await SystemIntegrationService.writeCache(context, summary);
      } catch (error) {
        value.code = ErrorCode.PREFERENCES_UNAVAILABLE;
      }
      value.unread = summary.unread;
      return value;
    } catch (error) {
      return failure(ErrorCode.NOTIFY_UNAVAILABLE);
    }
  }

  static async startBackground(context: object, state: AppState): Promise<SystemActionView> {
    try {
      const scheduler = new BackgroundScheduler();
      const started: BackgroundStatus = await scheduler.start();
      if (!started.started) {
        return failure(started.error !== '' ? started.error : ErrorCode.BACKGROUND_UNAVAILABLE);
      }
      const view = success(0, 0, 0);
      try {
        await SystemIntegrationService.writeCache(context, summarizeUnread(state));
      } catch (error) {
        view.code = ErrorCode.PREFERENCES_UNAVAILABLE;
      }
      return view;
    } catch (error) {
      return failure(ErrorCode.BACKGROUND_UNAVAILABLE);
    }
  }

  static async stopBackground(): Promise<SystemActionView> {
    try {
      const scheduler = new BackgroundScheduler();
      const stopped: BackgroundStatus = await scheduler.stop();
      if (stopped.available) {
        return success(0, 0, 0);
      }
      return failure(ErrorCode.BACKGROUND_UNAVAILABLE);
    } catch (error) {
      return failure(ErrorCode.BACKGROUND_UNAVAILABLE);
    }
  }

  static async requestCalendarPermission(context: object): Promise<SystemActionView> {
    try {
      const permissions = new SystemPermissionService(context);
      const result = await permissions.requestCalendar();
      if (!result.granted) {
        return failure(result.error !== undefined ? result.error : ErrorCode.PERMISSION_DENIED);
      }
      return success(0, 0, 0);
    } catch (error) {
      return failure(ErrorCode.PERMISSION_UNAVAILABLE);
    }
  }

  static async requestNotificationPermission(context: object): Promise<SystemActionView> {
    try {
      const permissions = new SystemPermissionService(context);
      const result = await permissions.requestNotification();
      if (!result.granted) {
        return failure(result.error !== undefined ? result.error : ErrorCode.PERMISSION_DENIED);
      }
      return success(0, 0, 0);
    } catch (error) {
      return failure(ErrorCode.PERMISSION_UNAVAILABLE);
    }
  }

  // 引导去系统通知设置：半模态打不开时再跳系统设置页；两条都失败才报 NOTIFY_SETTINGS_FAILED。
  static async openNotificationSettings(context: object): Promise<SystemActionView> {
    const gateway = new NotificationKitGateway(context);
    try {
      const result: NotifySettingsOutcome = await gateway.openSettings();
      // 入口取证：记录三级跳转到底停在哪一层，真机 hilog 可直接确认按钮是否真的被点到。
      console.info('permission-entry kind=notification-settings level=' + result.level +
        ' opened=' + (result.opened ? 'on' : 'off') + ' enabled=' + (result.enabled ? 'on' : 'off') +
        ' code=' + result.code);
      console.info('notify-settings opened=' + (result.opened ? 'on' : 'off') + ' verified=' +
        (result.verified ? 'on' : 'off') + ' enabled=' + (result.enabled ? 'on' : 'off') +
        ' level=' + result.level + ' code=' + result.code);
      if (result.opened) {
        // 半模态关闭后探针仍发不出通知 = 用户没开；如实返回「去通知设置」，不报成功。
        if (!result.enabled) {
          return failure(NOTIFY_PERMISSION_REQUIRED);
        }
        // 探针成功也只说明已打开设置，文案不得声称已开启（见 system_feedback_notify_settings）。
        return success(0, 0, 0);
      }
    } catch (error) {
      console.info('notify-settings modal threw');
    }
    try {
      const permissions = new SystemPermissionService(context);
      await permissions.openSystemSettings('notification');
      console.info('permission-entry kind=notification-settings level=system-settings opened=on');
      console.info('notify-settings opened via=system-settings');
      return success(0, 0, 0);
    } catch (error) {
      console.info('permission-entry kind=notification-settings level=system-settings opened=off');
      console.info('notify-settings system-settings failed');
      return failure(NOTIFY_SETTINGS_FAILED_CODE);
    }
  }

  private static buildReminderPlan(state: AppState): ReminderPlan {
    const days: ReminderDay[] = [];
    const start = todayKey();
    for (let i = 0; i < REMINDER_HORIZON_DAYS; i++) {
      const date = addDays(start, i);
      const rows: CourseRow[] = resolveDay(state, date);
      days.push({ date: date, rows: rows });
    }
    return planReminders(days, Date.now(), state.classReminders.leadMinutes);
  }

  private static async writeCache(context: object, summary: UnreadSummary): Promise<void> {
    const store = new SystemCacheStore(context);
    const cache: SystemCache = {
      unread: summary.unread,
      latestTitle: summary.latestTitle,
      latestDetail: summary.latestDetail
    };
    await store.write(cache);
  }
}
