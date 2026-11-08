// 职责：@ohos.data.preferences 对 PreferencesStore 的平台实现，对应规格 §4.2。
// 依赖方向：platform -> core 接口；页面与 data 不直接 import 本文件。
// 阶段：P1；创建/读取/写入/删除均异步并 flush，失败返回稳定错误码。
// 备注：API 26 中 @ohos.data.preferences 以默认导出暴露 preferences 命名空间（无具名导出）。

import preferences from '@ohos.data.preferences';
import type { common } from '@kit.AbilityKit';
import type { PreferencesStore } from '../../core/types/PreferencesStore';

const PREFERENCES_UNAVAILABLE = 'PREFERENCES_UNAVAILABLE';
const STATE_WRITE_FAILED = 'STATE_WRITE_FAILED';

class PlatformPreferencesStore implements PreferencesStore {
  private handle: preferences.Preferences;

  constructor(handle: preferences.Preferences) {
    this.handle = handle;
  }

  async get(key: string): Promise<string | null> {
    try {
      const value = await this.handle.get(key, '');
      const text = String(value);
      return text === '' ? null : text;
    } catch (error) {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await this.handle.put(key, value);
      await this.handle.flush();
    } catch (error) {
      throw new Error(STATE_WRITE_FAILED);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.handle.delete(key);
      await this.handle.flush();
    } catch (error) {
      throw new Error(PREFERENCES_UNAVAILABLE);
    }
  }
}

export async function createPreferencesStore(
  context: common.Context,
  name: string
): Promise<PreferencesStore> {
  try {
    const handle = await preferences.getPreferences(context, name);
    return new PlatformPreferencesStore(handle);
  } catch (error) {
    throw new Error(PREFERENCES_UNAVAILABLE);
  }
}

