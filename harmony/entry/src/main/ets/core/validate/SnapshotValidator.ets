// 职责：snapshot 结构校验（对应 web validateSnapshot），坏字段返回 STATE_MIGRATION_FAILED。
// 依赖方向：core 内 type-only；零运行时 import；由 StateRepository 在迁移/加载时调用。
// 阶段：P1 数据层；只校验文件可恢复性，不访问网络或文件。
// 待确认：schemaVersion 包装由 StateRepository 负责，本文件只校验已解包 snapshot。
import type { SemesterSnapshot } from '../types/AppState';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidDate(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const time = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(time)) {
    return false;
  }
  return new Date(time).toISOString().slice(0, 10) === value;
}

function weekdayOf(dateKey: string): number {
  return new Date(dateKey + 'T00:00:00Z').getUTCDay() || 7;
}

export function validateSnapshot(snapshot: SemesterSnapshot): void {
  if (snapshot === null || snapshot === undefined) {
    throw new Error('STATE_MIGRATION_FAILED');
  }
  if (typeof snapshot.startDate !== 'string' || !isValidDate(snapshot.startDate) || weekdayOf(snapshot.startDate) !== 1) {
    throw new Error('STATE_MIGRATION_FAILED');
  }
  if (typeof snapshot.weeks !== 'number' || !Number.isInteger(snapshot.weeks) || snapshot.weeks < 1 || snapshot.weeks > 60) {
    throw new Error('STATE_MIGRATION_FAILED');
  }
  if (!(snapshot.rules instanceof Array) || snapshot.rules.length > 1000) {
    throw new Error('STATE_MIGRATION_FAILED');
  }
  const ids = new Set<string>();
  for (const rule of snapshot.rules) {
    if (typeof rule.id !== 'string' || rule.id === '' || ids.has(rule.id)) {
      throw new Error('STATE_MIGRATION_FAILED');
    }
    if (typeof rule.name !== 'string' || rule.name.trim() === '' || rule.name.trim().length < 1) {
      throw new Error('STATE_MIGRATION_FAILED');
    }
    if (typeof rule.weekday !== 'number' || !Number.isInteger(rule.weekday) || rule.weekday < 1 || rule.weekday > 7) {
      throw new Error('STATE_MIGRATION_FAILED');
    }
    if (!(rule.weeks instanceof Array) || rule.weeks.length === 0) {
      throw new Error('STATE_MIGRATION_FAILED');
    }
    for (const week of rule.weeks) {
      if (typeof week !== 'number' || !Number.isInteger(week) || week < 1 || week > snapshot.weeks) {
        throw new Error('STATE_MIGRATION_FAILED');
      }
    }
    if (!(rule.periods instanceof Array) || rule.periods.length === 0) {
      throw new Error('STATE_MIGRATION_FAILED');
    }
    for (const period of rule.periods) {
      if (typeof period !== 'number' || !Number.isInteger(period) || period < 1 || period > 16) {
        throw new Error('STATE_MIGRATION_FAILED');
      }
    }
    if (typeof rule.startTime !== 'string' || !TIME_PATTERN.test(rule.startTime) ||
      typeof rule.endTime !== 'string' || !TIME_PATTERN.test(rule.endTime) ||
      rule.endTime <= rule.startTime) {
      throw new Error('STATE_MIGRATION_FAILED');
    }
    ids.add(rule.id);
  }
  for (const date of snapshot.closedDates || []) {
    if (!isValidDate(date)) {
      throw new Error('STATE_MIGRATION_FAILED');
    }
  }
  const remapIds = new Set<string>();
  for (const remap of snapshot.remaps || []) {
    if (typeof remap.id !== 'string' || remap.id === '' || remapIds.has(remap.id) ||
      !isValidDate(remap.date) || !isValidDate(remap.fromDate) ||
      (remap.mode !== 'append' && remap.mode !== 'replace')) {
      throw new Error('STATE_MIGRATION_FAILED');
    }
    remapIds.add(remap.id);
  }
  for (const exception of snapshot.exceptions || []) {
    if (!isValidDate(exception.date) || typeof exception.ruleId !== 'string' || !ids.has(exception.ruleId)) {
      throw new Error('STATE_MIGRATION_FAILED');
    }
  }
}
