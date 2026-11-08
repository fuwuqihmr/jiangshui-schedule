// 职责：AppState 持有与 load/save 编排，页面只经它访问 Repository。
// 依赖方向：platform/app -> data/core/platform；页面不 import Kit。
// 阶段：P3 收口；demoMode 经 core/demo/DemoState 切换示例状态，不写真实教务。
// 待确认：AppStateHost.initialize 的 Context 获取方式以 API 12 官方文档为准。

import { bundleManager } from '@kit.AbilityKit';
import type { common } from '@kit.AbilityKit';
import type { AppState } from '../../core/types/AppState';
import { createDefaultState } from '../../core/types/AppState';
import { createDemoLeaveStatus, createDemoState } from '../../core/demo/DemoState';
import type { LeaveStatusCache } from '../../core/types/Leave';
import { emptyLeaveStatus } from '../../core/viewmodel/LeaveStatusViewModel';
import { StateRepositoryImpl } from '../../data/StateRepository';
import { createPreferencesStore } from '../preferences/PreferencesGateway';
import { CoreFileStateStore } from '../files/StateFileGateway';

const STATE_FILE_UNAVAILABLE = 'STATE_FILE_UNAVAILABLE';

// 切换 demo 前复制草稿：共享的 AppStateHost.state 只在 save 成功后替换，失败时草稿丢弃。
function copyAppState(base: AppState): AppState {
  const copy: AppState = {
    version: base.version,
    snapshot: base.snapshot,
    events: base.events,
    changeRecords: base.changeRecords,
    overrides: base.overrides,
    localMaps: base.localMaps,
    holidaySettings: base.holidaySettings,
    courseSettings: base.courseSettings,
    customCourses: base.customCourses,
    theme: base.theme,
    showDayOverview: base.showDayOverview,
    settingsExpanded: base.settingsExpanded,
    leaveStatus: base.leaveStatus,
    demoMode: base.demoMode,
    calendarOptions: base.calendarOptions,
    notificationEnabled: base.notificationEnabled,
    classReminders: base.classReminders,
    autoCheckEnabled: base.autoCheckEnabled,
    lastSuccess: base.lastSuccess,
    lastAttempt: base.lastAttempt,
    error: base.error,
    _revision: base._revision
  };
  return copy;
}

export class AppStateHost {
  // API 26：getContext(this) 返回 common.Context（application/Context），不再窄化为 UIAbilityContext。
  private static context: common.Context | null = null;
  private static repo: StateRepositoryImpl | null = null;
  private static state: AppState = createDefaultState();

  static initialize(context: common.Context): void {
    AppStateHost.context = context;
  }

  // 版本信息从应用包读取，避免页面硬编码。失败时返回空串/0，由 UI 隐藏版本行。
  static appVersionName(): string {
    try {
      const info = bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT);
      return typeof info.versionName === 'string' ? info.versionName : '';
    } catch (error) {
      return '';
    }
  }

  static appVersionCode(): number {
    try {
      const info = bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT);
      return typeof info.versionCode === 'number' ? info.versionCode : 0;
    } catch (error) {
      return 0;
    }
  }

  static async load(): Promise<AppState> {
    if (AppStateHost.context === null) {
      throw new Error(STATE_FILE_UNAVAILABLE);
    }
    try {
      const preferences = await createPreferencesStore(AppStateHost.context, 'jiangshui-settings');
      AppStateHost.repo = new StateRepositoryImpl(preferences, new CoreFileStateStore(AppStateHost.context), 'default');
      AppStateHost.state = await AppStateHost.repo.load();
      return AppStateHost.state;
    } catch (error) {
      AppStateHost.state = createDefaultState();
      throw error instanceof Error ? error : new Error(STATE_FILE_UNAVAILABLE);
    }
  }

  static async save(state: AppState): Promise<number> {
    if (AppStateHost.repo === null) {
      throw new Error(STATE_FILE_UNAVAILABLE);
    }
    const revision: number = await AppStateHost.repo.save(state, state._revision === undefined ? 0 : state._revision);
    AppStateHost.state = state;
    return revision;
  }

  // 备份恢复专用：绕过乐观锁（恢复是整体替换），revision 语义见 StateRepositoryImpl.saveRestored。
  static async restore(state: AppState): Promise<number> {
    if (AppStateHost.repo === null) {
      throw new Error(STATE_FILE_UNAVAILABLE);
    }
    const revision: number = await AppStateHost.repo.saveRestored(state);
    AppStateHost.state = state;
    return revision;
  }

  static demoMode(): boolean { return AppStateHost.state.demoMode === true; }
  static async setDemoMode(enabled: boolean): Promise<void> {
    const next: AppState = copyAppState(AppStateHost.state);
    // 先发起 save（Repository.save 在首个 await 时才读取状态），再把开关写入这份独立草稿；
    // 共享内存不提前变更，save 失败时 next 直接丢弃，页面不会看到半成功状态。
    const persisted: Promise<number> = AppStateHost.save(next);
    next.demoMode = enabled;
    await persisted;
  }
  static leaveStatus(): LeaveStatusCache {
    if (AppStateHost.demoMode()) { return createDemoLeaveStatus(); }
    const stored: object | undefined = AppStateHost.state.leaveStatus;
    return stored === undefined ? emptyLeaveStatus('') : stored as LeaveStatusCache;
  }
  static async saveLeaveStatus(leave: object): Promise<void> {
    const next: AppState = AppStateHost.state;
    next.leaveStatus = leave;
    await AppStateHost.save(next);
  }
  static current(): AppState {
    return AppStateHost.state;
  }
  // demo 模式返回独立示例状态（每次新建，避免页面写入污染常量）；否则返回真实持有状态。
  static currentPretty(): AppState {
    if (AppStateHost.demoMode()) { return createDemoState(); }
    return AppStateHost.state;
  }
}

