// 职责：权限/诊断等 §4.8 服务接口，放 core 类型层，禁止接 Kit。
// 依赖方向：core -> core/types；data/platform/pages 单向依赖本文件。
// 阶段：P0 骨架；只定义签名，实现由 platform 的 *Unavailable 占位。
// 待确认：PermissionState 名称与系统权限常量在 API 12 的对应关系。
import type { DiagnosticsSnapshot, PermissionResult, PermissionSnapshot } from './Common';
import type { ExportResult } from './Export';
import type { SchoolReadResult, SchoolSession, StudentProfile } from './Leave';

export interface PermissionService {
  status(): Promise<PermissionSnapshot>;
  requestCalendar(): Promise<PermissionResult>;
  requestNotification(): Promise<PermissionResult>;
  openSystemSettings(kind: 'calendar' | 'notification' | 'battery' | 'autostart'): Promise<void>;
}

export interface DiagnosticsService {
  snapshot(): Promise<DiagnosticsSnapshot>;
  exportText(): Promise<ExportResult>;
}

// P4 79b：学校课表读取服务（UI 只依赖本接口，不直接依赖 orchestrator / platform）。
export interface SchoolReadService {
  read(session: SchoolSession): Promise<SchoolReadResult>;
  readProfile(session: SchoolSession): Promise<StudentProfile | null>;
}
