// 职责：把未来若干天的课程行规划成提醒时刻（纯逻辑，无 Kit）。
// 依赖方向：core/system -> core/types；禁止 import pages/platform/data/features。
// 阶段：P6 上课提醒；跨天、提前量为 0、已开始的课都不提醒。

import type { CourseRow } from '../types/AppState';

const MS_PER_MINUTE = 60000;
const MS_PER_DAY = 86400000;
const MAX_TARGETS = 64;

export interface ReminderDay {
  date: string;
  rows: CourseRow[];
}

export interface ReminderTarget {
  key: string;
  date: string;
  name: string;
  room: string;
  teacher: string;
  startTime: string;
  endTime: string;
  startMillis: number;
  triggerMillis: number;
  leadMinutes: number;
}

export interface ReminderPlan {
  targets: ReminderTarget[];
  skipped: number;
  nextMillis: number;
}

function pad2(value: number): string {
  return value < 10 ? '0' + String(value) : String(value);
}

function localMillis(date: string, time: string): number {
  const dp = date.split('-');
  const tp = time.split(':');
  if (dp.length < 3 || tp.length < 2) {
    return -1;
  }
  const year = Number(dp[0]);
  const month = Number(dp[1]);
  const day = Number(dp[2]);
  const hour = Number(tp[0]);
  const minute = Number(tp[1]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)
    || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return -1;
  }
  return new Date(year, month - 1, day, hour, minute, 0).getTime();
}

function formatMillis(millis: number): string {
  const value = new Date(millis);
  return String(value.getFullYear()) + '-' + pad2(value.getMonth() + 1) + '-' + pad2(value.getDate());
}

export function normalizeLeadMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    return 30;
  }
  const rounded = Math.round(value);
  if (rounded < 1) {
    return 1;
  }
  return rounded > 240 ? 240 : rounded;
}

/** 提前量上限 240 分钟、至少提前 1 分钟，避免把已经开始的课排成提醒。 */
export function planReminders(days: ReminderDay[], nowMillis: number, leadMinutes: number): ReminderPlan {
  const lead = normalizeLeadMinutes(leadMinutes);
  const horizon = nowMillis + MS_PER_DAY * 8;
  const seen = new Set<string>();
  const targets: ReminderTarget[] = [];
  let skipped = 0;
  for (let d = 0; d < days.length; d++) {
    const day = days[d];
    for (let r = 0; r < day.rows.length; r++) {
      const row = day.rows[r];
      if (row.cancelled || row.vacant) {
        skipped++;
        continue;
      }
      const startMillis = localMillis(day.date, row.startTime);
      if (startMillis <= 0) {
        skipped++;
        continue;
      }
      if (startMillis > nowMillis + MS_PER_DAY * 8) {
        skipped++;
        continue;
      }
      const triggerMillis = startMillis - lead * MS_PER_MINUTE;
      if (triggerMillis <= nowMillis + 5000) {
        skipped++;
        continue;
      }
      const key = day.date + '/' + row.key + '/' + String(lead);
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      const target: ReminderTarget = {
        key: key,
        date: day.date,
        name: row.name,
        room: row.room,
        teacher: row.teacher,
        startTime: row.startTime,
        endTime: row.endTime,
        startMillis: startMillis,
        triggerMillis: triggerMillis,
        leadMinutes: lead
      };
      targets.push(target);
      if (targets.length >= MAX_TARGETS) {
        break;
      }
    }
    if (targets.length >= MAX_TARGETS) {
      break;
    }
  }
  targets.sort((a: ReminderTarget, b: ReminderTarget): number => a.triggerMillis - b.triggerMillis);
  const nextMillis = targets.length > 0 ? targets[0].triggerMillis : 0;
  return { targets: targets, skipped: skipped, nextMillis: nextMillis };
}

/** 只保留未来 horizonDays 天内的提醒（供 UI 预览下一节课用）。 */
export function nextTarget(plan: ReminderPlan, nowMillis: number): ReminderTarget | null {
  for (let i = 0; i < plan.targets.length; i++) {
    if (plan.targets[i].triggerMillis > nowMillis) {
      return plan.targets[i];
    }
  }
  return null;
}

export const REMINDER_MAX_TARGETS = MAX_TARGETS;
export const REMINDER_MINUTE_MILLIS = MS_PER_MINUTE;
