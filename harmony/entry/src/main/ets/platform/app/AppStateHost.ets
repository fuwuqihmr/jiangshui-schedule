// 职责：AppState 持有与 load/save 编排，页面只经它访问 Repository。
// 依赖方向：platform/app -> data/core/platform；页面不 import Kit。
// 阶段：P3 收口；demoMode 经 core/demo/DemoState 切换示例状态，不写真实教务。
// 待确认：AppStateHost.initialize 的 Context 获取方式以 API 12 官方文档为准。

import type { common } from '@kit.AbilityKit';
import type { AppState } from '../../core/types/AppState';
import { createDefaultState } from '../../core/types/AppState';
import { createDemoLeaveStatus, createDemoState } from '../../core/demo/DemoState';
import { StateRepositoryImpl } from '../../data/StateRepository';
import { createPreferencesStore } from '../preferences/PreferencesGateway';
import { CoreFileStateStore } from '../files/StateFileGateway';

const STATE_FILE_UNAVAILABLE = 'STATE_FILE_UNAVAILABLE';

export class AppStateHost {
  private static context: common.UIAbilityContext | null = null;
  private static repo: StateRepositoryImpl | null = null;
  private static state: AppState = createDefaultState();

  static initialize(context: common.UIAbilityContext): void {
    AppStateHost.context = context;
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

  static demoMode(): boolean { return AppStateHost.state.demoMode === true; }
  static async setDemoMode(enabled: boolean): Promise<void> {
    const next: AppState = AppStateHost.state;
    next.demoMode = enabled;
    await AppStateHost.save(next);
  }
  static leaveStatus(): object {
    if (AppStateHost.demoMode()) { return createDemoLeaveStatus(); }
    return AppStateHost.state.leaveStatus === undefined ? {} : AppStateHost.state.leaveStatus;
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

