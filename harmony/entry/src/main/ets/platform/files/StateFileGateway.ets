// 职责：CoreFileKit 对 StateFileStore 的沙箱实现，对应规格 §4.2/§6 P1。
// 依赖方向：platform -> core/store 接口；data 不直接 import 本文件。
// 阶段：P1；tmp→fsync→rename + .bak，坏文件副本保留。
// 待确认：CoreFileKit 的 fsync/rename 与 sandbox 路径 API 以 API 12 官方文档为准。

import { fileIo as fs } from '@kit.CoreFileKit';
import type { common } from '@kit.AbilityKit';
import type { StateFileStore } from '../../core/store/StateFileStore';
import { ErrorCode } from '../../core/types/Common';

const STATE_FILE_UNAVAILABLE = 'STATE_FILE_UNAVAILABLE';

export class CoreFileStateStore implements StateFileStore {
  private readonly path: string;

  constructor(context: common.Context) {
    this.path = context.filesDir + '/jiangshui-state.json';
  }

  async read(): Promise<string | null> {
    try {
      return fs.readTextSync(this.path);
    } catch (error) {
      return null;
    }
  }

  async writeAtomic(payload: string): Promise<void> {
    const tmp = this.path + '.tmp';
    const bak = this.path + '.bak';
    try {
      try {
        fs.copyFileSync(this.path, bak);
      } catch (error) {
        // 首次写入没有旧文件，无需备份。
      }
      const file = fs.openSync(tmp, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      try {
        fs.writeSync(file.fd, payload);
        fs.fsyncSync(file.fd);
      } finally {
        fs.closeSync(file);
      }
      fs.renameSync(tmp, this.path);
    } catch (error) {
      throw new Error(ErrorCode.STATE_WRITE_FAILED);
    }
  }

  async replaceWithBackup(payload: string): Promise<void> {
    await this.writeAtomic(payload);
  }

  async preserveCorrupt(): Promise<string> {
    const target = this.path + '.corrupt-' + Date.now();
    try {
      fs.copyFileSync(this.path, target);
    } catch (error) {
      throw new Error(ErrorCode.STATE_CORRUPT);
    }
    return target;
  }

  async remove(): Promise<void> {
    try {
      fs.unlinkSync(this.path);
    } catch (error) {
      // 文件不存在按已删除处理。
    }
  }
}

export class StateFileGatewayUnavailable implements StateFileStore {
  read(): Promise<string | null> {
    return Promise.reject(new Error(STATE_FILE_UNAVAILABLE));
  }

  writeAtomic(payload: string): Promise<void> {
    return Promise.reject(new Error(STATE_FILE_UNAVAILABLE));
  }

  replaceWithBackup(payload: string): Promise<void> {
    return Promise.reject(new Error(STATE_FILE_UNAVAILABLE));
  }

  preserveCorrupt(): Promise<string> {
    return Promise.reject(new Error(STATE_FILE_UNAVAILABLE));
  }

  remove(): Promise<void> {
    return Promise.reject(new Error(STATE_FILE_UNAVAILABLE));
  }
}
