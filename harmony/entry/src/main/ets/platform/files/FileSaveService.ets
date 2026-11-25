// 职责：文件保存适配层契约与不可用降级实现。
// 依赖方向：platform -> core；页面只调用 FileSaveService 接口。
// 阶段：P0 骨架；P5 再接 DocumentViewPicker（API 名称待确认）。
// 待确认：DocumentViewPicker 在 API 12 的导入路径与取消返回语义。
import { ExportResult } from '../../core/types/Export';
import { ErrorCode } from '../../core/types/Common';

export interface FileSaveRequest {
  suggestedName: string;
  mime: string;
  data: Uint8Array;
}

export interface FileSaveService {
  save(request: FileSaveRequest): Promise<ExportResult>;
}

export class FileSaveServiceUnavailable implements FileSaveService {
  save(request: FileSaveRequest): Promise<ExportResult> {
    return Promise.reject(new Error(ErrorCode.EXPORT_UNAVAILABLE));
  }
}
