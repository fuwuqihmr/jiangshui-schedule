// 职责：通知授权状态的纯判定（core 层）。把平台查询/申请结果统一映射为 UI 状态与失败类别。
// 诚信原则（第三轮，A 项）：不可证 ⇔ 不声称。
// - 「已开启」不再由任何路径产出：开关标志、旧接口、发布探针成功都只能说明「应用把通知交给了系统」，
//   不能证明用户真的能看到；API26 真机上发布成功与系统开关为 false 可以同时出现。
// - 因此 UI 只允许三种诚实话术：denied（系统明确关闭）/ unavailable（能力异常）/ unverified（无法确认）。
// - 提醒登记失败不再一条 1700002 就报「提醒不可用」，改为按「通知是否已验证 + 是否真达 120 条上限」归因，
//   见 classifyReminderFailure。
// 依赖方向：core -> core 类型（纯逻辑门禁只允许 import type）。
// 真机取证见 build-harmony/notify-honesty-report.md。

import type { PermissionState } from '../types/Common';

/**
 * 平台通知开关查询结果。
 * enabled 仅为历史兼容保留：起 crossCheckNotify 不再产出它，收到也按「不可验证」处理。
 * disabled=系统明确关闭；unverified=读不出真值；failed=查询异常。
 */
export type NotifyQueryResult = 'enabled' | 'disabled' | 'unverified' | 'failed';

/**
 * 授权申请结果。
 * granted=平台调用返回成功（不等于用户可见，UI 不得据此显示已开启）；already=历史值（起网关不再返回）；
 * denied=申请后仍未开启或用户拒绝；busy=已有授权框在显示；no-effect=调用未报错但状态未变；
 * unverified=申请后旧接口 true 但无法验证；failed=平台服务/能力异常。
 */
export type NotifyRequestResult = 'none' | 'granted' | 'already' | 'denied' | 'busy' | 'no-effect' | 'unverified' | 'failed';

/**
 * 失败类别：unverified=申请成功与否都无法确认（去系统设置确认，而不是声称已开启）；
 * permission=未授权（引导去系统设置）；unavailable=通知能力/服务不可用。
 * 起新增 unverified，并取消 none：本应用不再声称任何「已授权」结论。
 */
export type NotifyFailureClass = 'unverified' | 'permission' | 'unavailable';

export interface NotifyQuery {
  result: NotifyQueryResult;
  source: string;
  code: string;
}

export interface NotifyRequestOutcome {
  result: NotifyRequestResult;
  code: string;
}

/** 打开通知设置的层级：with-result=新半模态；legacy=旧半模态；none=都打不开。 */
export type NotifySettingsLevel = 'with-result' | 'legacy' | 'none';

export interface NotifySettingsOutcome {
  opened: boolean;
  enabled: boolean;
  verified: boolean;
  code: string;
  level: NotifySettingsLevel;
}

/** 打开通知设置失败（半模态与系统设置跳转都失败）时给 UI 的稳定错误码。 */
export const NOTIFY_SETTINGS_FAILED_CODE = 'NOTIFY_SETTINGS_FAILED';

/**
 * UI 权限状态：只有系统明确关闭才是 denied；查询失败是 unavailable；其余（含旧接口 true）一律 prompt，
 * 由页面再按 verified=false 显示「无法确认」。granted 不再由本函数产出。
 */
export function notificationPermissionState(query: NotifyQuery): PermissionState {
  if (query.result === 'failed') {
    return 'unavailable';
  }
  if (query.result === 'disabled') {
    return 'denied';
  }
  return 'prompt';
}

/**
 * 平台状态 -> UI 显示状态。不可证即不声称：除 unavailable/denied 外一律 unverified，
 * 绝不允许把 granted 透传到界面（A）。
 */
export function notificationDisplayState(permission: PermissionState): string {
  if (permission === 'unavailable') {
    return 'unavailable';
  }
  if (permission === 'denied') {
    return 'denied';
  }
  return 'unverified';
}

/** 查询是否拿到系统明确开关：只有 disabled 算确认；enabled 已不再由 crossCheckNotify 产出，也不采信。 */
export function notificationVerified(query: NotifyQuery): boolean {
  return query.result === 'disabled';
}

/** 申请结果 → 失败类别；决定 UI 显示「去设置确认」还是「通知不可用」，任何路径都不返回 none。 */
export function notificationFailureClass(outcome: NotifyRequestOutcome): NotifyFailureClass {
  if (outcome.result === 'failed') {
    return 'unavailable';
  }
  if (outcome.result === 'denied' || outcome.result === 'busy') {
    return 'permission';
  }
  // granted/already/no-effect/unverified/none：平台没给出可验证结论 → 只能算 unverified。
  return 'unverified';
}

/**
 * requestEnableNotification 抛错码 → 申请结果。
 * 1600013=授权框已在显示；1600004=通知被禁用（用户拒绝过，系统不再弹框）；
 * 1600001/1600002/1600003/801=平台服务或能力异常；其余未知错误按「未授权/需手动」处理，避免谎报可用。
 */
export function requestResultFromCode(code: string): NotifyRequestResult {
  if (code === '1600013') {
    return 'busy';
  }
  if (code === '1600004') {
    return 'denied';
  }
  if (code === '1600001' || code === '1600002' || code === '1600003' || code === '801') {
    return 'failed';
  }
  if (code === '') {
    return 'none';
  }
  return 'denied';
}

/** 提醒登记失败码 → 未授权还是提醒能力不可用。1700001=通知未开启；201=权限被拒。 */
export function reminderFailureClass(code: string): 'permission' | 'reminder' {
  if (code === '1700001' || code === '201') {
    return 'permission';
  }
  return 'reminder';
}

/**
 * 提醒数量超限码。SDK @ohos.reminderAgentManager.d.ts 中 publishReminder 的 1700002 注释原文：
 * "The number of reminders exceeds the limit."（:52/:73）——它不是权限错误，
 * 但也不代表提醒真的登记成功，所以归为「提醒能力不可用」，不能谎报已开启。
 */
export function isReminderLimitCode(code: string): boolean {
  return code === '1700002';
}

/** App 自己的提醒登记上限（notificationId 分配上限，见 ReminderKitGateway）。 */
export const REMINDER_NOTIFICATION_LIMIT = 120;

/**
 * 提醒登记失败归因（B）：
 * ok=没有失败；notify-permission=通知未验证或受系统限制（UI 应引导去开通知）；
 * reminder-limit=确实达到 120 条上限；reminder-unavailable=其它提醒能力异常。
 */
export type ReminderFailureKind = 'ok' | 'notify-permission' | 'reminder-limit' | 'reminder-unavailable';

export function classifyReminderFailure(failed: number, targetCount: number, firstCode: string,
  notificationsVerifiedOn: boolean): ReminderFailureKind {
  if (failed <= 0) {
    return 'ok';
  }
  if (!notificationsVerifiedOn) {
    // 通知没有可验证的「已开启」证据：无论首个错误码是什么，都先按通知受限处理。
    return 'notify-permission';
  }
  if (reminderFailureClass(firstCode) === 'permission') {
    return 'notify-permission';
  }
  if (isReminderLimitCode(firstCode)) {
    // 1700002 只有在真的排到 120 条时才可能是系统容量上限；没到上限却报 1700002，
    // 说明系统按「通知受限」拒绝，不能显示成「权限正常、只是提醒太多」。
    if (targetCount < REMINDER_NOTIFICATION_LIMIT) {
      return 'notify-permission';
    }
    return 'reminder-limit';
  }
  return 'reminder-unavailable';
}

/** 真实发布探针结果：ok=应用当前确实能发出通知；disabled=系统以「通知已关闭」拒绝；failed=探针本身异常。 */
export type NotifyProbeResult = 'ok' | 'disabled' | 'failed';

export interface NotifyProbeOutcome {
  result: NotifyProbeResult;
  code: string;
}

/**
 * 多路证据。setting=新版 getNotificationSetting().notificationEnabled（on/off/unknown），
 * legacy=旧版 isNotificationEnabled()（on/off/unknown），probe=真实发布通知探针。
 * 真机教训：API26 上 setting 标志与 bm dump allowEnableNotification 不一致，单路不可信。
 */
export interface NotifyEvidence {
  setting: 'on' | 'off' | 'unknown';
  legacy: 'on' | 'off' | 'unknown';
  probe: NotifyProbeResult;
  probeCode: string;
}

/**
 * 发布探针失败码 → 探针结果。1600004="Notification disabled"（@ohos.notificationManager.d.ts
 * publish 声明 :100/:134），即系统明确拒绝发布；其余异常只能算探针失败，不能据此推断开关。
 */
export function probeFailureResult(code: string): NotifyProbeResult {
  if (code === '1600004') {
    return 'disabled';
  }
  return 'failed';
}

/**
 * 多路交叉验证。起不再产出 enabled：
 * 1) 任一路明确 off、或探针被系统以 1600004 拒绝 → disabled（这是唯一能确认的「关闭」）；
 * 2) 两路查询都读不到且探针也失败 → failed（不可用）；
 * 3) 其余（含探针发布成功）一律 unverified——发布成功只证明通道可用，不能证明用户在系统里看得到。
 */
export function crossCheckNotify(evidence: NotifyEvidence): NotifyQueryResult {
  if (evidence.setting === 'off' || evidence.legacy === 'off' || evidence.probe === 'disabled') {
    return 'disabled';
  }
  if (evidence.setting === 'unknown' && evidence.legacy === 'unknown' && evidence.probe === 'failed') {
    return 'failed';
  }
  return 'unverified';
}
