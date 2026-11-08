// 职责：状态与课表的公开 DTO、接口签名，对应规格 §4.1/§4.8。
// 依赖方向：core 内部只依赖 Common；禁止 import pages/platform/Kit。
// 阶段：P1 数据层；字段与 web/core.mjs 金样本保持可迁移。
// 待确认：调休/例外/晚自习 DTO 的最终字段以官方旧状态迁移样本为准。
import type { ThemeId } from './Common';

export type CourseSource = 'school' | 'custom' | 'study' | 'local';

export interface SemesterSource {
  kind: 'school' | 'sample';
  label: string;
}

export interface CourseRule {
  id: string;
  name: string;
  teacher: string;
  room: string;
  dayOfWeek: number;
  weekday?: number;
  startPeriod: number;
  endPeriod: number;
  periods?: number[];
  weeks: number[];
  startTime: string;
  endTime: string;
  cancelled: boolean;
  source: CourseSource;
  sourceLabel?: string;
}

export interface RemapRule {
  id: string;
  date: string;
  fromDate: string;
  mode: 'append' | 'replace';
}

export interface CourseExceptionPatch {
  name?: string;
  teacher?: string;
  room?: string;
  startTime?: string;
  endTime?: string;
  periods?: number[];
  cancelled?: boolean;
}

export interface CourseException {
  date: string;
  ruleId: string;
  cancel: boolean;
  patch?: CourseExceptionPatch;
}

export interface StudyProfile {
  enrollmentYear?: number;
  academicYear?: number;
  grade?: number;
}

/** P4：教务页面可识别的学生概况；不包含姓名/学号/专业，避免猜测。 */
export interface StudentProfileSummary {
  enrollmentYear?: number;
  academicYear?: number;
  grade?: number;
  sourceLabel?: string;
  checkedAt?: number;
}

/** P4：学校未排时间的课程，保留在快照中但不进入日课表。 */
export interface UnscheduledCourse {
  id: string;
  name: string;
  teacher: string;
  room: string;
  weeks: number[];
  note: string;
}

export interface StudyPolicy {
  enabled: boolean;
  userEnabled: boolean;
  userDisabled: boolean;
  profile: StudyProfile | null;
  holidayDates: string[];
  verifiedYears: number[];
  sourceLabel: string;
  startTime: string;
  endTime: string;
}

export interface SemesterSnapshot {
  id: string;
  name: string;
  startDate: string;
  weeks: number;
  rules: CourseRule[];
  source: SemesterSource;
  closedDates?: string[];
  remaps?: RemapRule[];
  exceptions?: CourseException[];
  studyPolicy?: StudyPolicy;
  unscheduled?: UnscheduledCourse[];
  studentProfile?: StudentProfileSummary | null;
}

export interface CourseRow {
  key: string;
  date: string;
  startTime: string;
  endTime: string;
  periods: number[];
  name: string;
  teacher: string;
  room: string;
  cancelled: boolean;
  vacant: boolean;
  localActivity: boolean;
  customCourse: boolean;
  remapId: string | null;
  conflict: boolean;
  overlap: boolean;
  source: CourseSource;
  originDate: string | null;
  ruleId?: string;
  weekday?: number;
  leave?: boolean;
  pendingLeave?: boolean;
  sourceLabel?: string;
  customCourseId?: string;
  vacancyReason?: string;
  movedTo?: string;
}

export interface ChangeEvent {
  id: string;
  date: string;
  kind: string;
  label: string;
  createdAt: number;
}

export interface ChangeRecord {
  id: string;
  key: string;
  kind: 'add' | 'remove' | 'update';
  stableKey: string;
  date: string;
  title: string;
  detail: string;
  before: CourseRow | null;
  after: CourseRow | null;
  fields: string[];
  type: string;
  source: string;
  read: boolean;
  notifiedAt: string | null;
  detectedAt: string;
  at: number;
}

export interface DayOverride {
  id: string;
  key: string;
  date: string;
  base: CourseRow;
  patch: CourseExceptionPatch;
  createdAt: string;
}

export interface LocalMapRule {
  id: string;
  date: string;
  fromDate: string;
  mode: 'append' | 'replace';
}

export interface HolidayRange {
  startDate: string;
  endDate: string;
}

export interface HolidayDay {
  date: string;
  skipStudy: boolean;
}

export interface HolidaySettings {
  winter: HolidayRange | null;
  summer: HolidayRange | null;
  days: HolidayDay[];
}

export interface CourseSettings {
  showEveningStudy: boolean;
  grade: string;
}

export interface CustomCourse {
  id: string;
  mode: 'weekly' | 'once';
  name: string;
  teacher: string;
  room: string;
  startTime: string;
  endTime: string;
  dayOfWeek?: number;
  startPeriod?: number;
  endPeriod?: number;
  weeks?: number[];
  date?: string;
  semesterId?: string;
  semesterStartDate?: string;
  startWeek?: number;
  endWeek?: number;
  weekPattern?: 'every' | 'odd' | 'even';
  weekdays?: number[];
}

export interface ClassReminderSettings {
  enabled: boolean;
  leadMinutes: number;
}

export interface SettingsExpanded {
  auto: boolean;
  display: boolean;
  leave: boolean;
  course: boolean;
  data: boolean;
  about: boolean;
}

export interface CalendarOptions {
  school: boolean;
  custom: boolean;
  study: boolean;
}

export interface AppState {
  version: number;
  snapshot: SemesterSnapshot | null;
  events: ChangeEvent[];
  changeRecords: ChangeRecord[];
  overrides: DayOverride[];
  localMaps: LocalMapRule[];
  holidaySettings: HolidaySettings | null;
  courseSettings: CourseSettings;
  customCourses: CustomCourse[];
  theme: ThemeId;
  showDayOverview: boolean;
  settingsExpanded: SettingsExpanded;
  leaveStatus?: object;
  demoMode?: boolean;
  calendarOptions: CalendarOptions;
  notificationEnabled: boolean;
  classReminders: ClassReminderSettings;
  autoCheckEnabled: boolean;
  lastSuccess: number;
  lastAttempt: number;
  error: string | null;
  _revision?: number;
}

export interface StateSnapshot {
  state: AppState;
  revision: number;
}

export function createDefaultState(): AppState {
  return {
    version: 2,
    snapshot: null,
    events: [],
    changeRecords: [],
    overrides: [],
    localMaps: [],
    holidaySettings: null,
    courseSettings: { showEveningStudy: false, grade: '' },
    customCourses: [],
    theme: 'system',
    showDayOverview: false,
    settingsExpanded: { auto: true, display: false, leave: false, course: false, data: false, about: false },
    calendarOptions: { school: true, custom: true, study: true },
    notificationEnabled: false,
    classReminders: { enabled: true, leadMinutes: 30 },
    autoCheckEnabled: true,
    lastSuccess: 0,
    lastAttempt: 0,
    error: null,
    _revision: 0
  };
}




