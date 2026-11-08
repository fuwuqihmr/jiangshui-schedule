// 职责：假条状态/过期/交集/摘要纯逻辑，对应 P3 §5。
// 依赖：仅 core/types；零 Kit、零中文。
// 阶段：P3；待确认：时间按 +08:00 解析。
import type { CourseRow } from '../types/AppState';
import type { LeaveRecord, LeaveMark, LeaveStatusCache, LeaveStatusSummary } from '../types/Leave';

/** 假条在列表中的展示状态：原始状态 + 已过期（由 leaveDisplayStatus 计算）。 */
export type LeaveDisplayStatus = 'approved' | 'pending' | 'rejected' | 'unknown' | 'expired';
export interface LeaveStatusRowView { id: string; typeLabelKey: string; displayStatus: LeaveDisplayStatus; statusLabelKey: string; periodText: string; reason: string; approver: string; demo: boolean; }
export interface LeaveStatusView { titleKey: string; isSample: boolean; rows: LeaveStatusRowView[]; summary: LeaveStatusSummary; isEmpty: boolean; errorKey: string | null; }
export interface LeaveStatusCopy { statusKey: (s: LeaveDisplayStatus) => string; typeKey: (t: string) => string; formatPeriod: (r: LeaveRecord) => string; titleKey: () => string; emptyKey: () => string; errorKey: () => string; }
export function statusFromRaw(raw: string | undefined): 'approved' | 'pending' | 'rejected' | 'unknown' { const v = (raw ?? '').trim().toLowerCase(); if (v === 'approved' || v === 'pending' || v === 'rejected') return v; return 'unknown'; }
export function statusFromRawWith(raw: string | undefined, classify: (value: string) => string): 'approved' | 'pending' | 'rejected' | 'unknown' { const v = classify((raw ?? '').trim()); if (v === 'approved' || v === 'pending' || v === 'rejected') return v; return 'unknown'; }
/** 时间区间（ArkTS 不支持 Record 字面量，用具名接口）。 */
export interface LeaveInterval { start: number; end: number; }
export function parseLeaveMs(date: string, time: string): number { return Date.parse(date + 'T' + time + ':00+08:00'); }
export function leaveInterval(record: LeaveRecord): LeaveInterval { return { start: parseLeaveMs(record.startDate, record.startTime), end: parseLeaveMs(record.endDate, record.endTime) }; }
export function courseInterval(row: CourseRow): LeaveInterval { return { start: parseLeaveMs(row.date, row.startTime), end: parseLeaveMs(row.date, row.endTime) }; }
export function validLeaveRecord(record: LeaveRecord): boolean { const i = leaveInterval(record); return Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start && i.end - i.start <= 90 * 86400000; }
export function overlapsCourse(record: LeaveRecord, row: CourseRow): boolean { const l = leaveInterval(record); const c = courseInterval(row); return c.start < l.end && l.start < c.end; }
export function activeForMark(record: LeaveRecord, nowMs: number): boolean { const i = leaveInterval(record); return (record.type === 'leave' || record.type === 'renew') && (record.status === 'approved' || record.status === 'pending') && i.end > nowMs; }
export function leaveMarkForCourse(records: LeaveRecord[], row: CourseRow, nowMs: number): LeaveMark | null {
  if (row.cancelled || row.vacant || row.localActivity) return null;
  let approved: LeaveRecord | null = null; let pending: LeaveRecord | null = null;
  for (const r of records) { if (!activeForMark(r, nowMs) || !overlapsCourse(r, row)) continue; if (r.status === 'approved' && (approved === null || leaveInterval(r).start > leaveInterval(approved).start)) approved = r; if (r.status === 'pending' && (pending === null || leaveInterval(r).start > leaveInterval(pending).start)) pending = r; }
  const pick = approved !== null ? approved : pending;
  if (pick === null) return null;
  const mark: LeaveMark = { recordId: pick.id, status: pick.status as 'approved' | 'pending', label: pick.status, reason: pick.reason };
  return mark;
}
export function leaveDisplayStatus(record: LeaveRecord, nowMs: number): LeaveDisplayStatus { if ((record.status === 'approved' || record.status === 'pending') && leaveInterval(record).end <= nowMs) return 'expired'; return record.status; }
export function leaveRecordsForDate(records: LeaveRecord[], dateKey: string): LeaveRecord[] { const start = parseLeaveMs(dateKey, '00:00'); const end = start + 86400000; return records.filter((r) => { const i = leaveInterval(r); return i.start < end && start < i.end; }).sort((a, b) => leaveInterval(a).start - leaveInterval(b).start); }
export function sortLeaveRecords(records: LeaveRecord[]): LeaveRecord[] { return records.slice().sort((a, b) => leaveInterval(a).start - leaveInterval(b).start); }
export function emptyLeaveStatus(semesterId: string): LeaveStatusCache { return { schemaVersion: 1, semesterId, provider: null, fetchedAt: null, records: [] }; }
export function summarizeLeaveStatus(records: LeaveRecord[], nowMs: number): LeaveStatusSummary { const s: LeaveStatusSummary = { total: records.length, approved: 0, pending: 0, rejected: 0, unknown: 0, expired: 0 }; for (const r of records) { const d = leaveDisplayStatus(r, nowMs); if (d === 'expired') s.expired++; else if (d === 'approved') s.approved++; else if (d === 'pending') s.pending++; else if (d === 'rejected') s.rejected++; else s.unknown++; } return s; }
function normalizeRecord(raw: LeaveRecord): LeaveRecord | null { if (raw === null || raw === undefined || typeof raw !== 'object') return null; const r: LeaveRecord = { id: String(raw.id ?? ''), type: raw.type, status: raw.status, startDate: String(raw.startDate ?? ''), startTime: String(raw.startTime ?? ''), endDate: String(raw.endDate ?? ''), endTime: String(raw.endTime ?? ''), reason: String(raw.reason ?? ''), approver: String(raw.approver ?? ''), comment: String(raw.comment ?? ''), rawStatus: String(raw.rawStatus ?? ''), semesterId: String(raw.semesterId ?? ''), demo: raw.demo === true }; return r.id.length > 0 && validLeaveRecord(r) ? r : null; }
export function normalizeLeaveStatusCache(raw: LeaveStatusCache | LeaveRecord[] | null | undefined, semesterId: string): LeaveStatusCache {
  const empty = emptyLeaveStatus(semesterId);
  if (raw === null || raw === undefined) return empty;
  let source: LeaveStatusCache | null = null;
  if (raw instanceof Array) source = { schemaVersion: 1, semesterId, provider: null, fetchedAt: null, records: raw as LeaveRecord[] };
  else if (typeof raw === 'object') source = raw as LeaveStatusCache;
  if (source === null || source.semesterId !== semesterId || !(source.records instanceof Array)) return empty;
  const seen: Record<string, boolean> = {}; const rs: LeaveRecord[] = [];
  for (const item of source.records) { const n = normalizeRecord(item); if (n === null || n.demo === true || seen[n.id] === true) continue; seen[n.id] = true; rs.push(n); }
  rs.sort((a, b) => leaveInterval(b).start - leaveInterval(a).start); const limited = rs.slice(0, 200).sort((a, b) => leaveInterval(a).start - leaveInterval(b).start);
  empty.records = limited; empty.fetchedAt = typeof source.fetchedAt === 'string' && !Number.isNaN(Date.parse(source.fetchedAt)) ? source.fetchedAt : null;
  return empty;
}
export function leaveStatusCacheFromRecords(records: LeaveRecord[], semesterId: string): LeaveStatusCache { const seen: Record<string, boolean> = {}; const rs: LeaveRecord[] = []; for (const r of records) { if (r.demo === true || seen[r.id] === true || !validLeaveRecord(r)) continue; seen[r.id] = true; rs.push(r); } rs.sort((a, b) => leaveInterval(b).start - leaveInterval(a).start); const cache = emptyLeaveStatus(semesterId); cache.records = rs.slice(0, 200).sort((a, b) => leaveInterval(a).start - leaveInterval(b).start); return cache; }
// 展示排序权重：approved < pending < expired < rejected < unknown。
export function leaveDisplayRank(status: LeaveDisplayStatus): number {
  if (status === 'approved') return 0;
  if (status === 'pending') return 1;
  if (status === 'expired') return 2;
  if (status === 'rejected') return 3;
  return 4;
}
export function buildLeaveStatusView(cache: LeaveStatusCache, nowMs: number, copy: LeaveStatusCopy): LeaveStatusView {
  const rows: LeaveStatusRowView[] = cache.records.map((r: LeaveRecord): LeaveStatusRowView => {
    const display: LeaveDisplayStatus = leaveDisplayStatus(r, nowMs);
    const row: LeaveStatusRowView = { id: r.id, typeLabelKey: copy.typeKey(r.type), displayStatus: display, statusLabelKey: copy.statusKey(display), periodText: copy.formatPeriod(r), reason: r.reason, approver: r.approver, demo: r.demo };
    return row;
  });
  rows.sort((a: LeaveStatusRowView, b: LeaveStatusRowView): number => leaveDisplayRank(a.displayStatus) - leaveDisplayRank(b.displayStatus));
  const isSample = cache.provider === 'sample' || cache.records.some((r: LeaveRecord): boolean => r.demo === true);
  return { titleKey: copy.titleKey(), isSample: isSample, rows, summary: summarizeLeaveStatus(cache.records, nowMs), isEmpty: rows.length === 0, errorKey: null }; }



