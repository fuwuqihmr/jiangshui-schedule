// 职责：demo 模式的纯常量示例状态（课表/变更/请假），不读取文件系统、不连网。
// 依赖方向：core/demo -> core/types；零 Kit、零中文字面量（用户可见文案由 string.json 渲染）。
// 数据来源：fixtures/normal-state.json 与 fixtures/edge-state.json 的等价内容；因 core 禁中文字面量，
// 示例课名/事由使用 ASCII，页面仍按真实视图模型渲染。
// 阶段：P3 收口；待官方文档确认 demo 模式与真实同步互斥的产品行为。

import type { AppState, ChangeRecord, CourseRule, SemesterSnapshot } from '../types/AppState';
import type { LeaveRecord, LeaveStatusCache } from '../types/Leave';

const DEMO_SEMESTER_ID: string = '2026-2027-1';
const DEMO_LEAVE_FETCHED_AT: string = '2026-10-25T20:00:00+08:00';
const DEMO_TODAY: string = '2026-10-26';

function demoRules(): CourseRule[] {
  const weeks: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  const oddWeeks: number[] = [1, 3, 5, 7, 9, 11, 13, 15, 17];
  const math: CourseRule = {
    id: 'r-math', name: 'Advanced Mathematics (demo)', teacher: 'Li', room: 'A101',
    dayOfWeek: 1, weekday: 1, startPeriod: 1, endPeriod: 2, periods: [1, 2], weeks: weeks,
    startTime: '08:30', endTime: '09:55', cancelled: false, source: 'school'
  };
  const english: CourseRule = {
    id: 'r-english', name: 'College English (demo)', teacher: 'Du', room: 'North C103',
    dayOfWeek: 2, weekday: 2, startPeriod: 3, endPeriod: 4, periods: [3, 4], weeks: weeks,
    startTime: '10:15', endTime: '11:40', cancelled: false, source: 'school'
  };
  const lab: CourseRule = {
    id: 'r-lab', name: 'Physics Lab (demo)', teacher: 'Zhao', room: 'Lab Building',
    dayOfWeek: 4, weekday: 4, startPeriod: 5, endPeriod: 6, periods: [5, 6], weeks: oddWeeks,
    startTime: '14:00', endTime: '15:25', cancelled: false, source: 'school'
  };
  return [math, english, lab];
}

function demoSnapshot(): SemesterSnapshot {
  return {
    id: DEMO_SEMESTER_ID,
    name: '2026-2027 Fall (demo)',
    startDate: '2026-08-31',
    weeks: 18,
    source: { kind: 'sample', label: 'fixture-demo' },
    closedDates: ['2026-10-01'],
    remaps: [{ id: 'demo-map-1', date: '2026-10-08', fromDate: '2026-09-28', mode: 'replace' }],
    exceptions: [{ date: '2026-09-28', ruleId: 'r-math', cancel: true }],
    rules: demoRules(),
    studyPolicy: {
      enabled: true, userEnabled: true, userDisabled: false,
      profile: { enrollmentYear: 2026 },
      holidayDates: ['2026-10-01'], verifiedYears: [2026],
      sourceLabel: 'demo', startTime: '19:00', endTime: '20:30'
    }
  };
}

function demoChanges(): ChangeRecord[] {
  const unread: ChangeRecord = {
    id: 'demo-change-1', key: 'demo-room', kind: 'update', stableKey: 'r-math:room',
    date: DEMO_TODAY, title: 'Room changed (sample)', detail: 'A101 -> B203 (sample)',
    before: null, after: null, fields: ['room'], type: 'room', source: 'demo',
    read: false, notifiedAt: null, detectedAt: '2026-10-26T07:30:00+08:00', at: 1793403000000
  };
  const read: ChangeRecord = {
    id: 'demo-change-2', key: 'demo-time', kind: 'update', stableKey: 'r-lab:time',
    date: '2026-10-25', title: 'Time shifted (sample)', detail: '14:00 -> 15:25 (sample)',
    before: null, after: null, fields: ['time'], type: 'time', source: 'demo',
    read: true, notifiedAt: null, detectedAt: '2026-10-25T09:00:00+08:00', at: 1793310000000
  };
  return [unread, read];
}

function demoLeaveRecords(): LeaveRecord[] {
  const approved: LeaveRecord = {
    id: 'demo-leave-1', type: 'leave', status: 'approved',
    startDate: DEMO_TODAY, startTime: '08:30', endDate: DEMO_TODAY, endTime: '09:55',
    reason: 'Demo leave reason', approver: 'Advisor', comment: 'Approved (sample)',
    rawStatus: 'approved', semesterId: DEMO_SEMESTER_ID, demo: true
  };
  const pending: LeaveRecord = {
    id: 'demo-leave-2', type: 'leave', status: 'pending',
    startDate: '2026-10-27', startTime: '10:15', endDate: '2026-10-27', endTime: '11:40',
    reason: 'Demo pending reason', approver: '', comment: '',
    rawStatus: 'pending', semesterId: DEMO_SEMESTER_ID, demo: true
  };
  const expired: LeaveRecord = {
    id: 'demo-leave-3', type: 'leave', status: 'approved',
    startDate: '2026-10-19', startTime: '08:30', endDate: '2026-10-19', endTime: '09:55',
    reason: 'Demo expired reason', approver: 'Advisor', comment: 'Approved (sample)',
    rawStatus: 'approved', semesterId: DEMO_SEMESTER_ID, demo: true
  };
  const cancel: LeaveRecord = {
    id: 'demo-leave-4', type: 'cancel', status: 'approved',
    startDate: DEMO_TODAY, startTime: '08:30', endDate: DEMO_TODAY, endTime: '09:55',
    reason: 'Demo cancel reason', approver: 'Advisor', comment: 'Approved (sample)',
    rawStatus: 'approved', semesterId: DEMO_SEMESTER_ID, demo: true
  };
  return [approved, pending, expired, cancel];
}

export function createDemoLeaveStatus(): LeaveStatusCache {
  const cache: LeaveStatusCache = {
    schemaVersion: 1,
    semesterId: DEMO_SEMESTER_ID,
    provider: null,
    fetchedAt: DEMO_LEAVE_FETCHED_AT,
    records: demoLeaveRecords()
  };
  return cache;
}

export function createDemoState(): AppState {
  const state: AppState = {
    version: 2,
    snapshot: demoSnapshot(),
    events: [],
    changeRecords: demoChanges(),
    overrides: [],
    localMaps: [{ id: 'local-map-demo', date: '2026-10-09', fromDate: '2026-10-05', mode: 'replace' }],
    holidaySettings: {
      winter: { startDate: '2026-12-28', endDate: '2027-01-03' },
      summer: { startDate: '2027-07-05', endDate: '2027-08-29' },
      days: [{ date: '2026-10-01', skipStudy: true }]
    },
    courseSettings: { showEveningStudy: true, grade: 'Freshman' },
    customCourses: [{
      id: 'demo-custom-1', mode: 'weekly', name: 'Club activity (demo)', teacher: 'Zhang',
      room: 'Activity room', startTime: '16:00', endTime: '17:00',
      semesterId: DEMO_SEMESTER_ID, semesterStartDate: '2026-08-31',
      startWeek: 1, endWeek: 18, weekPattern: 'every', weekdays: [1]
    }],
    theme: 'system',
    showDayOverview: false,
    settingsExpanded: { auto: true, display: false, leave: true, course: false, data: true, about: false },
    leaveStatus: createDemoLeaveStatus(),
    demoMode: true,
    calendarOptions: { school: true, custom: true, study: true },
    notificationEnabled: false,
    classReminders: { enabled: true, leadMinutes: 30 },
    autoCheckEnabled: true,
    lastSuccess: 0,
    lastAttempt: 0,
    error: null,
    _revision: 0
  };
  return state;
}
