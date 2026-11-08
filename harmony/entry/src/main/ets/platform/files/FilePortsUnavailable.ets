// 职责：能力不可用时的降级实现，保证调用方永远拿到稳定码而不是未捕获异常。
// 依赖方向：platform -> core（稳定码）、features/export（接口类型）。
import type { ExportResult } from '../../core/types/Export';
import type { FileSavePort, FilePickPort } from '../../features/export/ExportWorkflow';
import type { FilePickOutcome, FileSaveOutcome, FileSaveRequest, RichFilePickPort, RichFileSavePort } from './FilePorts';
import { FilePortError } from './FilePorts';
import { FILE_UNAVAILABLE } from '../../core/files/FileNaming';

export class FilePortsUnavailable implements FileSavePort, FilePickPort, RichFileSavePort, RichFilePickPort {
  save(suggestedName: string, mime: string, data: Uint8Array, pages: number): Promise<ExportResult> {
    return Promise.reject(new FilePortError(FILE_UNAVAILABLE));
  }

  saveFile(request: FileSaveRequest): Promise<FileSaveOutcome> {
    const outcome: FileSaveOutcome = { ok: false, code: FILE_UNAVAILABLE, result: null };
    return Promise.resolve(outcome);
  }

  pickText(): Promise<string | null> {
    return Promise.reject(new FilePortError(FILE_UNAVAILABLE));
  }

  pickTextFile(): Promise<FilePickOutcome> {
    const outcome: FilePickOutcome = { ok: false, code: FILE_UNAVAILABLE, file: null };
    return Promise.resolve(outcome);
  }
}
