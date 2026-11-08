// 职责：StateFileStore 的纯内存实现，供 Node/Fake 测试注入。
// 依赖方向：data -> core type-only StateFileStore；零运行时依赖。
// 阶段：P1 数据层；writeAtomic 模拟替换，保留旧值作 .bak 语义由测试检查。
// 待确认：真实 fsync/rename 行为由 platform/StateFileGateway 负责。
import type { StateFileStore } from '../core/store/StateFileStore';

export class MemoryStateFileStore implements StateFileStore {
  private payload: string | null;
  private corrupt: string | null;
  private failNextWrite: boolean;
  private failNextRemove: boolean;

  constructor() {
    this.payload = null;
    this.corrupt = null;
    this.failNextWrite = false;
    this.failNextRemove = false;
  }

  read(): Promise<string | null> {
    return Promise.resolve(this.payload);
  }

  writeAtomic(payload: string): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return Promise.reject(new Error('STATE_WRITE_FAILED'));
    }
    this.payload = payload;
    return Promise.resolve();
  }

  replaceWithBackup(payload: string): Promise<void> {
    return this.writeAtomic(payload);
  }

  preserveCorrupt(): Promise<string> {
    this.corrupt = this.payload;
    return Promise.resolve('state.json.corrupt-test');
  }

  remove(): Promise<void> {
    if (this.failNextRemove) {
      this.failNextRemove = false;
      return Promise.reject(new Error('STATE_WRITE_FAILED'));
    }
    this.payload = null;
    return Promise.resolve();
  }

  failNextWriteForTest(): void {
    this.failNextWrite = true;
  }

  failNextRemoveForTest(): void {
    this.failNextRemove = true;
  }

  corruptCopyForTest(): string | null {
    return this.corrupt;
  }
}
