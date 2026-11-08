// 职责：Preferences 的纯接口契约，供 StateRepository 与测试 Fake 注入。
// 依赖方向：core 最底层，零 import；platform 实现，data 只依赖本接口。
// 阶段：P1 数据层；全异步，所有键名由 StateRepository 约定。
// 待确认：Preferences 的 flush 时机与失败语义以 API 12 官方文档为准。

export interface PreferencesStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
