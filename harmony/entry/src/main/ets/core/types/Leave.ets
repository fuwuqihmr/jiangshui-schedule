// 职责：请假记录、假条标记、学校会话与 SchoolReader 契约，对应规格 §4.8。
// 依赖方向：core 类型层；页面只消费 LeaveMark，不自行比较时间。
// 阶段：P0 骨架；只定义字段，不接入真实教务。
// 待确认：假条接口字段与 SchoolReader HTML fixture 的解析形态。
import type { CourseRow, SemesterSnapshot, StudentProfileSummary } from './AppState';

// ArkTS 不支持索引访问类型（arkts-no-aliases-by-index），把 LeaveRecord 的联合字段提为具名别名。
export type LeaveType = 'leave' | 'cancel' | 'renew';
export type LeaveStatus = 'approved' | 'pending' | 'rejected' | 'unknown';

export interface LeaveRecord {
  id: string;
  type: LeaveType;
  status: LeaveStatus;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  reason: string;
  approver: string;
  comment: string;
  rawStatus: string;
  semesterId: string;
  demo: boolean;
  submittedAt?: string;
}

export interface LeaveMark {
  recordId: string;
  status: 'approved' | 'pending';
  label: string;
  reason: string;
}

export interface LeaveStatusService {
  load(semesterId: string): Promise<LeaveRecord[]>;
  refresh(): Promise<LeaveRecord[]>;
  marksForCourse(row: CourseRow): LeaveMark | null;
}

export interface SchoolSession {
  cookieHeader: string;
  updatedAt: number;
  domain: string;
  semesterId?: string;
}

export interface StudentProfile extends StudentProfileSummary {
  name: string;
  studentId: string;
  major: string;
}

export interface SchoolReader {
  readTimetable(session: SchoolSession): Promise<SemesterSnapshot>;
  readProfile(session: SchoolSession): Promise<StudentProfile | null>;
}

export interface SchoolReadResult {
  snapshot: SemesterSnapshot;
  profile: StudentProfile | null;
  fetchedAt: number;
}

export interface OfficeSession {
  pageUrl: string;
  uid: string;
  formId: string;
  pageEnc: string;
  capturedAt: number;
}

export interface LeaveStatusCache { schemaVersion: 1; semesterId: string; provider: 'school' | 'sample' | 'local' | null; fetchedAt: string | null; records: LeaveRecord[]; }
export interface LeaveStatusSummary { total: number; approved: number; pending: number; rejected: number; unknown: number; expired: number; }
