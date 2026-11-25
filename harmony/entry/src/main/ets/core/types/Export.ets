// 职责：三种导出的请求/结果与 TimetableExporter 契约，对应规格 §4.4。
// 依赖方向：core 类型层；PDF/PNG/Text 的 Kit 实现放 platform/export。
// 阶段：P0 骨架；只定义接口，不接 PDF Kit。
// 待确认：PDF Kit 在 API 12 的导入名与能力，以及导出文件名策略。
import type { AppState } from './AppState';

export type ExportKind = 'semester-pages' | 'semester-overview' | 'rules-text';

export interface ExportRequest {
  kind: ExportKind;
  state: AppState;
  outputName: string;
}

export interface ExportResult {
  uri: string;
  mime: string;
  bytes: number;
  pages: number;
}

export interface TimetableExporter {
  export(request: ExportRequest): Promise<ExportResult>;
}
