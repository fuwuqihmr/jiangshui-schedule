// 职责：文件错误码到可见文案的映射。取消（FILE_CANCELED）也有文案键，但 UI 默认不弹红错。
// 依赖方向：platform -> core（稳定码）。
// 说明：$r 必须使用字面量键（静态门禁只扫描字面量）；资源键登记在
//       harmony/tools/resource-requests/harmony-files.json，待合并 string.json。
import {
  FILE_CANCELED,
  FILE_EMPTY,
  FILE_INVALID_PATH,
  FILE_NAME_INVALID,
  FILE_TIME_INVALID,
  FILE_TOO_LARGE,
  FILE_UNAVAILABLE,
  FILE_UNSUPPORTED,
} from '../../core/files/FileNaming';
import { FILE_WRITE_FAILED } from './FilePorts';

export function fileErrorText(code: string): Resource {
  switch (code) {
    case FILE_CANCELED:
      return $r('app.string.file_error_canceled');
    case FILE_TOO_LARGE:
      return $r('app.string.file_error_too_large');
    case FILE_UNAVAILABLE:
      return $r('app.string.file_error_unavailable');
    case FILE_UNSUPPORTED:
      return $r('app.string.file_error_unsupported');
    case FILE_EMPTY:
      return $r('app.string.file_error_empty');
    case FILE_INVALID_PATH:
      return $r('app.string.file_error_invalid_path');
    case FILE_NAME_INVALID:
      return $r('app.string.file_error_name');
    case FILE_TIME_INVALID:
      return $r('app.string.file_error_time');
    case FILE_WRITE_FAILED:
      return $r('app.string.file_error_write_failed');
    default:
      return $r('app.string.file_error_io');
  }
}
