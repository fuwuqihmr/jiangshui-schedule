// 职责：文件端口装配入口——能力探测失败时返回可用性为 false 的降级实现。
// 依赖方向：platform -> features/export（接口由 FilePorts 汇总）。
import { common } from '@kit.AbilityKit';
import type { FilePortSet } from './FilePorts';
import { DocumentFileSavePort } from './DocumentFileSavePort';
import { DocumentFilePicker } from './DocumentFilePicker';
import { FilePortsUnavailable } from './FilePortsUnavailable';
import { FILE_UNAVAILABLE } from '../../core/files/FileNaming';

const USER_FILE_SERVICE_CAPABILITY: string = 'SystemCapability.FileManagement.UserFileService';

export function createFilePorts(context: common.UIAbilityContext): FilePortSet {
  try {
    const supported: boolean = canIUse(USER_FILE_SERVICE_CAPABILITY);
    if (!supported) {
      return unavailableFilePorts();
    }
    const saver: DocumentFileSavePort = new DocumentFileSavePort(context);
    const picker: DocumentFilePicker = new DocumentFilePicker(context);
    return {
      saver: saver,
      picker: picker,
      richSaver: saver,
      richPicker: picker,
      available: true,
      reason: '',
    };
  } catch (error) {
    return unavailableFilePorts();
  }
}

// features 层不 import SDK Kit，统一以 object 传入 getContext(this)；这里再窄化为 UIAbilityContext。
// 与 platform/system/SystemPermissionService 的 constructor(context: object) 同一模式。
export function createFilePortsFromContext(context: object): FilePortSet {
  return createFilePorts(context as common.UIAbilityContext);
}

export function unavailableFilePorts(): FilePortSet {
  const unavailable: FilePortsUnavailable = new FilePortsUnavailable();
  return {
    saver: unavailable,
    picker: unavailable,
    richSaver: unavailable,
    richPicker: unavailable,
    available: false,
    reason: FILE_UNAVAILABLE,
  };
}
