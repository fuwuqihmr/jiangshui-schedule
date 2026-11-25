// 职责：完整 state JSON 的沙箱文件存储契约，供 StateRepository 注入。
// 依赖方向：core 最底层零 import；platform 用 CoreFileKit 实现，data 只依赖本接口。
// 阶段：P1 数据层；实现方负责 tmp→fsync→rename、写前 .bak 与坏文件副本。
// 待确认：CoreFileKit 的 fsync/rename 具体 API 以 API 12 官方文档为准。
export interface StateFileStore {
  read(): Promise<string | null>;
  writeAtomic(payload: string): Promise<void>;
  replaceWithBackup(payload: string): Promise<void>;
  preserveCorrupt(): Promise<string>;
  remove(): Promise<void>;
}
