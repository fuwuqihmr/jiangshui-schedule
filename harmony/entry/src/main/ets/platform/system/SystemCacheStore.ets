// 职责：把未读数与最新变更摘要缓存到 preferences，供后台扩展读取。
// 依赖方向：platform -> core 类型；只有 features/system 与 SystemWorkAbility 使用。
// 阶段：P6 每日后台检查；写入失败返回 PREFERENCES_UNAVAILABLE，后台读取失败则静默用空缓存。

import preferences from '@ohos.data.preferences';
import type { common } from '@kit.AbilityKit';
import { ErrorCode } from '../../core/types/Common';

export interface SystemCache {
  unread: number;
  latestTitle: string;
  latestDetail: string;
}

const STORE_NAME = 'jiangshui-system-cache';
const KEY_UNREAD = 'unread';
const KEY_LATEST_TITLE = 'latestTitle';
const KEY_LATEST_DETAIL = 'latestDetail';

export class SystemCacheStore {
  private context: common.Context;

  constructor(context: object) {
    this.context = context as common.Context;
  }

  async read(): Promise<SystemCache> {
    const empty: SystemCache = { unread: 0, latestTitle: '', latestDetail: '' };
    try {
      const handle = await preferences.getPreferences(this.context, STORE_NAME);
      const unreadValue = await handle.get(KEY_UNREAD, 0);
      const titleValue = await handle.get(KEY_LATEST_TITLE, '');
      const detailValue = await handle.get(KEY_LATEST_DETAIL, '');
      const value: SystemCache = {
        unread: Number(unreadValue),
        latestTitle: String(titleValue),
        latestDetail: String(detailValue)
      };
      return value;
    } catch (error) {
      return empty;
    }
  }

  async write(value: SystemCache): Promise<void> {
    try {
      const handle = await preferences.getPreferences(this.context, STORE_NAME);
      await handle.put(KEY_UNREAD, value.unread);
      await handle.put(KEY_LATEST_TITLE, value.latestTitle);
      await handle.put(KEY_LATEST_DETAIL, value.latestDetail);
      await handle.flush();
    } catch (error) {
      throw new Error(ErrorCode.PREFERENCES_UNAVAILABLE);
    }
  }
}
