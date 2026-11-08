// 职责：把 platform/files 的富端口（四态稳定码）适配成 ExportWorkflow 的窄端口，并把四态映射为可见文案键。
// 依赖方向：features/files -> core（纯映射）、platform/files（端口实现）、features/export（窄接口契约）；不 import SDK Kit。
// 阶段：端口适配；页面接线见同目录 NAV.md，string.json 由 harmony-ui 合并，module.json5 由 harmony-system 统一改。
import type { ExportResult } from '../../core/types/Export';
import type { FileSavePort, FilePickPort, SaveReservation } from '../export/ExportWorkflow';
import type { FilePortSet, FileSaveOutcome, FilePickOutcome } from '../../platform/files/FilePorts';
import { FilePortError, FILE_PORT_UNAVAILABLE, FILE_WRITE_FAILED } from '../../platform/files/FilePorts';
import { createFilePortsFromContext, unavailableFilePorts } from '../../platform/files/FilePortFactory';
import type { ExportPortStatus } from '../../core/export/ExportPortStatus';
import { mapExportPortCode } from '../../core/export/ExportPortStatus';

// 富端口的四态结果：status.silent 为 true 表示用户取消，UI 静默；其余按 messageKey 展示 file_error_* 文案。
export interface ExportSaveState {
  status: ExportPortStatus;
  result: ExportResult | null;
}

export interface ExportPickState {
  status: ExportPortStatus;
  name: string;
  text: string | null;
}

export interface ExportFilePortSet {
  saver: FileSavePort;
  picker: FilePickPort;
  available: boolean;
  reason: string;
  saveExport: (name: string, mime: string, data: Uint8Array, pages: number) => Promise<ExportSaveState>;
  pickTextExport: () => Promise<ExportPickState>;
}

// 窄接口实现用类承载，避免跨模块对象字面量触发 arkts-no-untyped-obj-literals。
// 可选两阶段入口必须通过端口实例调用；解构方法会让 this 丢失，真机 reserve 因此崩溃。
function callReserve(port: FileSavePort, name: string, mime: string): Promise<SaveReservation> {
  if (port.reserve === undefined) {
    return Promise.reject(new FilePortError(FILE_PORT_UNAVAILABLE));
  }
  return port.reserve(name, mime);
}

function callWriteReserved(
  port: FileSavePort,
  reservation: SaveReservation,
  mime: string,
  data: Uint8Array,
  pages: number
): Promise<ExportResult> {
  if (port.writeReserved === undefined) {
    return Promise.reject(new FilePortError(FILE_PORT_UNAVAILABLE));
  }
  return port.writeReserved(reservation, mime, data, pages);
}

class DelegatingSaver implements FileSavePort {
  save: (name: string, mime: string, data: Uint8Array, pages: number) => Promise<ExportResult>;
  // 透传 platform 的可选两阶段入口（PDF 渲染前先选 URI）。底层没有时抛不可用，让编排层尽早失败。
  reserve: (name: string, mime: string) => Promise<SaveReservation>;
  writeReserved: (reservation: SaveReservation, mime: string, data: Uint8Array, pages: number) => Promise<ExportResult>;

  constructor(ports: FilePortSet) {
    this.save = (name: string, mime: string, data: Uint8Array, pages: number): Promise<ExportResult> => {
      return ports.saver.save(name, mime, data, pages);
    };
    this.reserve = (name: string, mime: string): Promise<SaveReservation> => {
      return callReserve(ports.saver, name, mime);
    };
    this.writeReserved = (reservation: SaveReservation, mime: string, data: Uint8Array, pages: number): Promise<ExportResult> => {
      return callWriteReserved(ports.saver, reservation, mime, data, pages);
    };
  }
}

class DelegatingPicker implements FilePickPort {
  pickText: () => Promise<string | null>;

  constructor(ports: FilePortSet) {
    this.pickText = (): Promise<string | null> => {
      return ports.picker.pickText();
    };
  }
}

function codeOf(error: Object): string {
  if (error instanceof FilePortError) {
    return error.code;
  }
  return 'FILE_IO_FAILED';
}

// core 的通用映射把未知码归 io；写盘失败必须有独立文案键，供后续 UI 使用 rich saveExport 时直接展示。
function statusOf(ok: boolean, code: string): ExportPortStatus {
  if (!ok && code === FILE_WRITE_FAILED) {
    return { state: 'failed', code: code, messageKey: 'file_error_write_failed', silent: false };
  }
  return mapExportPortCode(ok, code);
}

function failedStatus(error: Object): ExportPortStatus {
  return statusOf(false, codeOf(error));
}

// 包一层：保留窄端口原语义（供既有 ExportPanel 注入），另加 saveExport/pickTextExport 返回四态。
export function wrapFilePorts(ports: FilePortSet): ExportFilePortSet {
  const saveExport = async (name: string, mime: string, data: Uint8Array, pages: number): Promise<ExportSaveState> => {
    if (!ports.available) {
      return { status: statusOf(false, FILE_PORT_UNAVAILABLE), result: null };
    }
    try {
      const outcome: FileSaveOutcome = await ports.richSaver.saveFile({ suggestedName: name, mime: mime, data: data, pages: pages });
      return { status: statusOf(outcome.ok, outcome.code), result: outcome.ok ? outcome.result : null };
    } catch (error) {
      return { status: failedStatus(error as Object), result: null };
    }
  };

  const pickTextExport = async (): Promise<ExportPickState> => {
    if (!ports.available) {
      return { status: statusOf(false, FILE_PORT_UNAVAILABLE), name: '', text: null };
    }
    try {
      const outcome: FilePickOutcome = await ports.richPicker.pickTextFile();
      const file = outcome.file;
      return {
        status: statusOf(outcome.ok, outcome.code),
        name: file !== null ? file.name : '',
        text: file !== null ? file.text : null
      };
    } catch (error) {
      return { status: failedStatus(error as Object), name: '', text: null };
    }
  };

  return {
    saver: new DelegatingSaver(ports),
    picker: new DelegatingPicker(ports),
    available: ports.available,
    reason: ports.reason,
    saveExport: saveExport,
    pickTextExport: pickTextExport
  };
}

// 接线入口：页面只传 getContext(this)（object），不 import Kit；工厂内部再窄化为 UIAbilityContext。
export function createExportFilePorts(context: object): ExportFilePortSet {
  try {
    return wrapFilePorts(createFilePortsFromContext(context));
  } catch (error) {
    return unavailableExportFilePorts();
  }
}

export function unavailableExportFilePorts(): ExportFilePortSet {
  return wrapFilePorts(unavailableFilePorts());
}
