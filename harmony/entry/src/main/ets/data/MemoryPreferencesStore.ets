// 职责：PreferencesStore 的纯内存实现，供 Node/Fake 测试注入。
// 依赖方向：data -> core type-only 接口；零运行时依赖。
// 阶段：P1 数据层；行为与 platform PreferencesGateway 对齐。
// 待确认：是否需要模拟 flush 失败；P1 测试暂不注入故障。

import type { PreferencesStore } from '../core/types/PreferencesStore';

export class MemoryPreferencesStore implements PreferencesStore {
  private values: Map<string, string>;
  private failNextSet: boolean;
  private failNextDelete: boolean;

  constructor() {
    this.values = new Map<string, string>();
    this.failNextSet = false;
    this.failNextDelete = false;
  }

  get(key: string): Promise<string | null> {
    const value = this.values.get(key);
    return Promise.resolve(value === undefined ? null : value);
  }

  set(key: string, value: string): Promise<void> {
    if (this.failNextSet) {
      this.failNextSet = false;
      return Promise.reject(new Error('STATE_WRITE_FAILED'));
    }
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      return Promise.reject(new Error('STATE_WRITE_FAILED'));
    }
    this.values.delete(key);
    return Promise.resolve();
  }

  failNextSetForTest(): void {
    this.failNextSet = true;
  }

  failNextDeleteForTest(): void {
    this.failNextDelete = true;
  }

  size(): number {
    return this.values.size;
  }
}

