// 职责：DiagnosticsService 的平台不可用降级实现，避免页面直连诊断 Kit。
// 依赖方向：platform -> core/types；导出能力后续走 FileSaveService。
// 阶段：P0 骨架；P6 再接系统版本/错误摘要读取（待官方文档确认）。
// 待确认：应用版本/系统版本 API 12 的获取方式与 ExportResult 字段。
import { DiagnosticsSnapshot, ErrorCode } from '../../core/types/Common';
import { DiagnosticsService } from '../../core/types/Services';
import { ExportResult } from '../../core/types/Export';

export class DiagnosticsServiceUnavailable implements DiagnosticsService {
  snapshot(): Promise<DiagnosticsSnapshot> {
    return Promise.reject(new Error(ErrorCode.DIAGNOSTICS_UNAVAILABLE));
  }

  exportText(): Promise<ExportResult> {
    return Promise.reject(new Error(ErrorCode.DIAGNOSTICS_UNAVAILABLE));
  }
}
