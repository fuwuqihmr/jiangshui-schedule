// 职责：通知与桌面角标的平台适配（platform 层），负责权限查询/申请、通知设置跳转、角标数字与变更通知。
// 依赖方向：platform -> core 类型与纯判定；页面只经 features/system 调用。
// 阶段：P7 通知诚信化（多轮真机回炉；本轮「不可证⇔不声称」）。
// 真机教训：API26 部分机型上 getNotificationSetting().notificationEnabled 返回 true，而 bm dump 的
// allowEnableNotification 为 false；旧接口 isNotificationEnabled 同样可能虚报 true；
// 更关键的是发布探针成功也可能与系统开关 false 并存——发布成功只说明通道可用，不能证明用户看得到。
// 因此本网关不产出任何「已开启」结论：setting/legacy 只作「关闭」佐证，探针只用于 1600004 判关闭；
// 其余一律 unverified（无法确认），UI 如实显示并引导用户去系统设置确认。
// 同时删除首轮「查询到 enabled 就返回 already、不真调系统」的短路——授权按钮永远真调系统。

import { notificationManager } from '@kit.NotificationKit';
import type { BusinessError } from '@kit.BasicServicesKit';
import type { common } from '@kit.AbilityKit';
import { ErrorCode } from '../../core/types/Common';
import type { PermissionState } from '../../core/types/Common';
import {
  crossCheckNotify,
  notificationPermissionState,
  notificationVerified,
  probeFailureResult,
  requestResultFromCode
} from '../../core/system/NotificationState';
import type {
  NotifyEvidence,
  NotifyProbeOutcome,
  NotifyProbeResult,
  NotifyQuery,
  NotifyRequestOutcome,
  NotifySettingsOutcome
} from '../../core/system/NotificationState';

export interface NotificationStatus {
  enabled: boolean;
  permission: PermissionState;
  error: string;
  verified: boolean;
  source: string;
}

/** 探针通知 id：用一个不会与业务通知（22002/22001/21000+）冲突的固定 id，发布后立即取消。 */
const PROBE_NOTIFICATION_ID = 22901;
/** 探针结果缓存时长：避免每次页面刷新都发一条通知；授权申请/打开设置后强制重跑。 */
const PROBE_CACHE_MS = 120000;

type NotifyFlag = 'on' | 'off' | 'unknown';

function errorCodeOf(error: Error): string {
  const business: BusinessError = error as BusinessError;
  const code: number = business.code;
  if (typeof code === 'number') {
    return String(code);
  }
  return '';
}

export class NotificationKitGateway {
  private context: common.UIAbilityContext;
  private static probeDone: boolean = false;
  private static probeAt: number = 0;
  private static probeResult: NotifyProbeResult = 'failed';
  private static probeCode: string = '';

  constructor(context: object) {
    this.context = context as common.UIAbilityContext;
  }

  /** 新版查询：只取三态标志，不再直接当成结论。 */
  private async settingFlag(): Promise<NotifyFlag> {
    try {
      const setting: notificationManager.NotificationSetting = await notificationManager.getNotificationSetting();
      const flag = setting.notificationEnabled;
      if (flag === true) {
        return 'on';
      }
      if (flag === false) {
        return 'off';
      }
      return 'unknown';
    } catch (error) {
      console.info('notify-evidence setting=error code=' + errorCodeOf(error as Error));
      return 'unknown';
    }
  }

  /** 旧接口：只能证明关闭；返回 true 也只算「on 标志」，不足以判已开启。 */
  private async legacyFlag(): Promise<NotifyFlag> {
    try {
      const legacy: boolean = await notificationManager.isNotificationEnabled();
      return legacy ? 'on' : 'off';
    } catch (error) {
      console.info('notify-evidence legacy=error code=' + errorCodeOf(error as Error));
      return 'unknown';
    }
  }

  /** 真实发布探针：系统允许发通知才返回 ok；1600004 说明应用通知被关闭。 */
  private async runProbe(): Promise<NotifyProbeOutcome> {
    const request: notificationManager.NotificationRequest = {
      id: PROBE_NOTIFICATION_ID,
      content: {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: {
          title: 'Jiangshui timetable self-check',
          text: 'Notification channel is available.'
        }
      }
    };
    try {
      await notificationManager.publish(request);
      await this.cancelProbe();
      console.info('notify-probe result=ok');
      const ok: NotifyProbeOutcome = { result: 'ok', code: '' };
      return ok;
    } catch (error) {
      const code: string = errorCodeOf(error as Error);
      const result: NotifyProbeResult = probeFailureResult(code);
      console.info('notify-probe result=' + result + ' code=' + code);
      await this.cancelProbe();
      const failed: NotifyProbeOutcome = { result: result, code: code };
      return failed;
    }
  }

  private async cancelProbe(): Promise<void> {
    try {
      await notificationManager.cancel(PROBE_NOTIFICATION_ID);
    } catch (error) {
      // 取消探针通知失败不影响判定，静默忽略。
    }
  }

  /** 探针带缓存（120s）；force=true 用于「刚申请完/刚从设置页回来」必须重新取证。 */
  private async probeCached(force: boolean): Promise<NotifyProbeOutcome> {
    const now: number = Date.now();
    if (!force && NotificationKitGateway.probeDone &&
      now - NotificationKitGateway.probeAt < PROBE_CACHE_MS) {
      const cached: NotifyProbeOutcome = {
        result: NotificationKitGateway.probeResult,
        code: NotificationKitGateway.probeCode
      };
      return cached;
    }
    const fresh: NotifyProbeOutcome = await this.runProbe();
    NotificationKitGateway.probeDone = true;
    NotificationKitGateway.probeAt = now;
    NotificationKitGateway.probeResult = fresh.result;
    NotificationKitGateway.probeCode = fresh.code;
    return fresh;
  }

  /** 多路取证：setting + legacy + 发布探针；任一路明确 off 时跳过探针（避免明知关闭还发通知）。 */
  private async evidence(force: boolean): Promise<NotifyEvidence> {
    const setting: NotifyFlag = await this.settingFlag();
    const legacy: NotifyFlag = await this.legacyFlag();
    let probe: NotifyProbeResult = 'failed';
    let probeCode = '';
    if (setting !== 'off' && legacy !== 'off') {
      const outcome: NotifyProbeOutcome = await this.probeCached(force);
      probe = outcome.result;
      probeCode = outcome.code;
    } else {
      console.info('notify-probe skipped reason=flag-off setting=' + setting + ' legacy=' + legacy);
    }
    const value: NotifyEvidence = { setting: setting, legacy: legacy, probe: probe, probeCode: probeCode };
    return value;
  }

  /** 交叉验证后的查询结论；source 记录三路证据，便于 hilog 复盘。 */
  private async query(force: boolean): Promise<NotifyQuery> {
    const evidence: NotifyEvidence = await this.evidence(force);
    const result = crossCheckNotify(evidence);
    const source: string = 'setting:' + evidence.setting + ',legacy:' + evidence.legacy +
      ',probe:' + evidence.probe;
    console.info('notify-evidence setting=' + evidence.setting + ' legacy=' + evidence.legacy +
      ' probe=' + evidence.probe + ' result=' + result + ' code=' + evidence.probeCode);
    const value: NotifyQuery = { result: result, source: source, code: evidence.probeCode };
    return value;
  }

  async status(): Promise<NotificationStatus> {
    const query: NotifyQuery = await this.query(false);
    const permission: PermissionState = notificationPermissionState(query);
    console.info('notify-status result=' + query.result + ' display=' + permission +
      ' source=' + query.source + ' code=' + query.code);
    const value: NotificationStatus = {
      // 不再把任何查询结果当成「已开启」，enabled 恒为 false，只保留字段兼容旧调用方。
      enabled: false,
      permission: permission,
      error: query.result === 'failed' ? ErrorCode.NOTIFY_UNAVAILABLE : '',
      verified: notificationVerified(query),
      source: query.source
    };
    return value;
  }

  /** 供 features 在关键节点显式重跑发布探针（如打开设置返回后），返回探针原始结果。 */
  async verifyByPublish(force: boolean): Promise<NotifyProbeOutcome> {
    return await this.probeCached(force);
  }

  /**
   * 真调系统授权：无论查询结果是什么都调用 requestEnableNotification（不再 already 短路），
   * 随后用发布探针复验；探针成功才算 granted，其余按真实结果降级，不谎报开启。
   */
  async requestEnable(): Promise<NotifyRequestOutcome> {
    let code = '';
    try {
      await notificationManager.requestEnableNotification(this.context);
      console.info('notify-request dialog=returned');
    } catch (error) {
      code = errorCodeOf(error as Error);
      console.info('notify-request dialog=error code=' + code);
    }
    const probe: NotifyProbeOutcome = await this.verifyByPublish(true);
    console.info('notify-request verify probe=' + probe.result + ' code=' + probe.code);
    if (probe.result === 'ok') {
      const granted: NotifyRequestOutcome = { result: 'granted', code: code };
      return granted;
    }
    if (code !== '') {
      const byCode: NotifyRequestOutcome = { result: requestResultFromCode(code), code: code };
      return byCode;
    }
    if (probe.result === 'failed') {
      const failed: NotifyRequestOutcome = { result: 'failed', code: probe.code };
      return failed;
    }
    const noEffect: NotifyRequestOutcome = { result: 'no-effect', code: probe.code };
    return noEffect;
  }

  /**
   * 打开应用通知设置：半模态与旧接口都只负责「把用户送到设置」，
   * 是否已开启仍以打开后的发布探针为准（真机上 NotificationSetting 标志不可信）。
   */
  async openSettings(): Promise<NotifySettingsOutcome> {
    try {
      await notificationManager.openNotificationSettingsWithResult(this.context);
      const probe: NotifyProbeOutcome = await this.verifyByPublish(true);
      const enabled: boolean = probe.result === 'ok';
      const verified: boolean = probe.result === 'ok' || probe.result === 'disabled';
      console.info('notify-settings via=with-result level=with-result probe=' + probe.result +
        ' enabled=' + (enabled ? 'on' : 'off'));
      const value: NotifySettingsOutcome = {
        opened: true,
        enabled: enabled,
        verified: verified,
        code: probe.code,
        level: 'with-result'
      };
      return value;
    } catch (error) {
      console.info('notify-settings via=with-result failed code=' + errorCodeOf(error as Error));
    }
    try {
      await notificationManager.openNotificationSettings(this.context);
      const probe: NotifyProbeOutcome = await this.verifyByPublish(true);
      const enabled: boolean = probe.result === 'ok';
      const verified: boolean = probe.result === 'ok' || probe.result === 'disabled';
      console.info('notify-settings via=legacy level=legacy probe=' + probe.result +
        ' enabled=' + (enabled ? 'on' : 'off'));
      const value: NotifySettingsOutcome = {
        opened: true,
        enabled: enabled,
        verified: verified,
        code: probe.code,
        level: 'legacy'
      };
      return value;
    } catch (error) {
      const code = errorCodeOf(error as Error);
      console.info('notify-settings open=failed code=' + code);
      const failed: NotifySettingsOutcome = {
        opened: false,
        enabled: false,
        verified: false,
        code: code,
        level: 'none'
      };
      return failed;
    }
  }

  async syncBadge(count: number): Promise<number> {
    try {
      const value = count < 0 ? 0 : (count > 99 ? 99 : Math.round(count));
      await notificationManager.setBadgeNumber(value);
      return value;
    } catch (error) {
      throw new Error(ErrorCode.NOTIFY_UNAVAILABLE);
    }
  }

  async publish(title: string, text: string): Promise<void> {
    const request: notificationManager.NotificationRequest = {
      id: 22002,
      content: {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: {
          title: title,
          text: text
        }
      }
    };
    try {
      await notificationManager.publish(request);
    } catch (error) {
      throw new Error(ErrorCode.NOTIFY_UNAVAILABLE);
    }
  }
}
