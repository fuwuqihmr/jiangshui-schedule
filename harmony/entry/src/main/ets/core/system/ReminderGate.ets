// 职责：上课提醒的通知权限门控（core 纯逻辑），把「提醒开关/课程数/通知状态/申请结果」映射为一次动作。
// 依赖方向：core 纯逻辑，不 import 任何平台 Kit，可在 Node 下直接测试（tools/tests/core-system.test.mjs）。
// 阶段：P6首次门控；第三轮：通知开关不可证——只有「可验证已开启」才 proceed，
// 平台口头 granted 只能 proceed-unverified（照常尝试登记，但登记失败必须按通知未验证归因）。

export type NotificationRequestResult = 'none' | 'granted' | 'denied';

export type ReminderGateAction = 'clear' | 'proceed' | 'proceed-unverified' | 'request' | 'blocked';

// 通知权限未授予且用户拒绝弹窗时的稳定错误码：UI 必须映射为「去系统设置开启通知」的可操作文案。
export const NOTIFY_PERMISSION_REQUIRED = 'NOTIFY_PERMISSION_REQUIRED';
// 申请流程未给出可验证结论（平台返回成功但无法确认用户可见）时的稳定错误码。
export const NOTIFY_PERMISSION_UNVERIFIED = 'NOTIFY_PERMISSION_UNVERIFIED';

export interface ReminderGateInput {
  remindersEnabled: boolean;
  targetCount: number;
  notificationEnabled: boolean;
  // 缺省视为未验证（安全默认）：调用方必须显式给出多路证据的结论。
  notificationVerified?: boolean;
  requestResult: NotificationRequestResult;
}

export interface ReminderGateDecision {
  action: ReminderGateAction;
  code: string;
  // 是否可以把「通知已开启」传给下游（决定 reconcile 的第二参数与日志口径）。
  notificationOn: boolean;
}

export function decideReminderGate(input: ReminderGateInput): ReminderGateDecision {
  if (!input.remindersEnabled || input.targetCount <= 0) {
    const clear: ReminderGateDecision = { action: 'clear', code: '', notificationOn: false };
    return clear;
  }
  const verifiedOn: boolean = input.notificationEnabled && input.notificationVerified === true;
  if (verifiedOn) {
    const proceed: ReminderGateDecision = { action: 'proceed', code: '', notificationOn: true };
    return proceed;
  }
  if (input.requestResult === 'granted') {
    // 平台调用成功但未通过发布探针等证据复验：照常尝试登记，但下游必须知道通知「不可证」。
    const unverified: ReminderGateDecision = { action: 'proceed-unverified', code: '', notificationOn: false };
    return unverified;
  }
  if (input.requestResult === 'none') {
    const request: ReminderGateDecision = { action: 'request', code: '', notificationOn: false };
    return request;
  }
  const blocked: ReminderGateDecision = {
    action: 'blocked',
    code: NOTIFY_PERMISSION_REQUIRED,
    notificationOn: false
  };
  return blocked;
}
