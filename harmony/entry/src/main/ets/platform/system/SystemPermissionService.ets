// 职责：PermissionService 的真实平台实现，处理日历/通知/后台权限查询与申请、设置页跳转。
// 依赖方向：platform -> core 类型与契约；页面经 features/system 读取状态。
// 阶段：P6 权限接入；请求被拒返回 granted=false + PERMISSION_DENIED，接口异常返回 PERMISSION_UNAVAILABLE。

import { abilityAccessCtrl } from '@kit.AbilityKit';
import type { common, Permissions } from '@kit.AbilityKit';
import { ErrorCode } from '../../core/types/Common';
import type { PermissionResult, PermissionSnapshot, PermissionState } from '../../core/types/Common';
import { PermissionService } from '../../core/types/Services';
import { NotificationKitGateway } from './NotificationKitGateway';
import { notificationFailureClass } from '../../core/system/NotificationState';
import { NOTIFY_PERMISSION_UNVERIFIED } from '../../core/system/ReminderGate';

const READ_CALENDAR: Permissions = 'ohos.permission.READ_CALENDAR';
const WRITE_CALENDAR: Permissions = 'ohos.permission.WRITE_CALENDAR';
const KEEP_BACKGROUND: Permissions = 'ohos.permission.KEEP_BACKGROUND_RUNNING';
const SETTINGS_BUNDLE = 'com.huawei.hmos.settings';
const SETTINGS_ABILITY = 'com.huawei.hmos.settings.MainAbility';

export class SystemPermissionService implements PermissionService {
  private context: common.UIAbilityContext;

  constructor(context: object) {
    this.context = context as common.UIAbilityContext;
  }

  private granted(permission: Permissions): boolean {
    try {
      const manager = abilityAccessCtrl.createAtManager();
      const tokenId = this.context.applicationInfo.accessTokenId;
      return manager.checkAccessTokenSync(tokenId, permission) === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
    } catch (error) {
      return false;
    }
  }

  async status(): Promise<PermissionSnapshot> {
    const calendar: PermissionState = this.granted(READ_CALENDAR) && this.granted(WRITE_CALENDAR) ? 'granted' : 'prompt';
    // 通知状态交给 NotificationKitGateway 的可验证查询，避免旧接口 true 造成「已开启」谎报。
    const gateway = new NotificationKitGateway(this.context);
    const notification: PermissionState = (await gateway.status()).permission;
    const background: PermissionState = this.granted(KEEP_BACKGROUND) ? 'granted' : 'prompt';
    const value: PermissionSnapshot = { calendar: calendar, notification: notification, background: background };
    return value;
  }

  async requestCalendar(): Promise<PermissionResult> {
    try {
      const manager = abilityAccessCtrl.createAtManager();
      const result = await manager.requestPermissionsFromUser(this.context, [READ_CALENDAR, WRITE_CALENDAR]);
      const granted = result.authResults.length >= 2 && result.authResults[0] === 0 && result.authResults[1] === 0;
      const value: PermissionResult = granted ? { granted: true } : { granted: false, error: ErrorCode.PERMISSION_DENIED };
      return value;
    } catch (error) {
      const failed: PermissionResult = { granted: false, error: ErrorCode.PERMISSION_UNAVAILABLE };
      return failed;
    }
  }

  // 申请成功也不再返回 granted=true——api26 上无法确认用户可见，只能如实报「无法确认」。
  async requestNotification(): Promise<PermissionResult> {
    const gateway = new NotificationKitGateway(this.context);
    const outcome = await gateway.requestEnable();
    const failure = notificationFailureClass(outcome);
    if (failure === 'unavailable') {
      const failed: PermissionResult = { granted: false, error: ErrorCode.NOTIFY_UNAVAILABLE };
      return failed;
    }
    if (failure === 'permission') {
      const denied: PermissionResult = { granted: false, error: ErrorCode.PERMISSION_DENIED };
      return denied;
    }
    const unverified: PermissionResult = { granted: false, error: NOTIFY_PERMISSION_UNVERIFIED };
    return unverified;
  }

  openSystemSettings(kind: 'calendar' | 'notification' | 'battery' | 'autostart'): Promise<void> {
    const target = kind;
    if (target === 'calendar' || target === 'notification' || target === 'battery' || target === 'autostart') {
      return this.context.startAbility({ bundleName: SETTINGS_BUNDLE, abilityName: SETTINGS_ABILITY })
        .catch((): void => {
          throw new Error(ErrorCode.PERMISSION_UNAVAILABLE);
        });
    }
    return Promise.reject(new Error(ErrorCode.PERMISSION_UNAVAILABLE));
  }
}
