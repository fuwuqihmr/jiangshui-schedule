// 职责：请假记录、假条标记、学校会话与 SchoolReader 契约，对应规格 §4.8。
// 依赖方向：core 类型层；页面只消费 LeaveMark，不自行比较时间。
// 阶段：P0 骨架；只定义字段，不接入真实教务。
// 待确认：假条接口字段与 SchoolReader HTML fixture 的解析形态。
import type { CourseRow, SemesterSnapshot } from './AppState';

export interface LeaveRecord {
  id: string;
  type: 'leave' | 'cancel' | 'renew';
  status: 'approved' | 'pending' | 'rejected' | 'unknown';
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
}

export interface StudentProfile {
  name: string;
  studentId: string;
  major: string;
}

export interface SchoolReader {
  readTimetable(session: SchoolSession): Promise<SemesterSnapshot>;
  readProfile(session: SchoolSession): Promise<StudentProfile | null>;
}

export interface LeaveStatusCache { schemaVersion: 1; semesterId: string; provider: 'school' | null; fetchedAt: string | null; records: LeaveRecord[]; }\nexport interface LeaveStatusSummary { total: number; approved: number; pending: number; rejected: number; unknown: number; expired: number; }\n
