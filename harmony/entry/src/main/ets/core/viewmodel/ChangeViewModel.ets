// 职责：变更记录页视图模型（分组、未读、类型文案），纯逻辑。
// 依赖方向：core/viewmodel -> core/types（仅 import type）。
// 阶段：P2 变更记录页；P2 常态为空态，记录由后续阶段注入。
// 待确认：ChangeRecord 字段命名以规格 §4 为准。

import type { ChangeRecord } from '../types/AppState';
import type { ViewModelCopy } from './ViewModelCopy';

export interface ChangeViewItem {
  record: ChangeRecord;
  title: string;
  dateText: string;
  typeKey: 'add' | 'remove' | 'update' | 'time' | 'room' | 'teacher';
  typeLabel: string;
  detailText: string;
  fieldsText: string;
  isUnread: boolean;
  a11yText: string;
}

export interface ChangeGroupView {
  key: 'today' | 'earlier';
  title: string;
  items: ChangeViewItem[];
}

export interface ChangeViewModel {
  isEmpty: boolean;
  total: number;
  unreadCount: number;
  groups: ChangeGroupView[];
}

function typeKeyOf(record: ChangeRecord): 'add' | 'remove' | 'update' | 'time' | 'room' | 'teacher' {
  if (record.type === 'time' || record.type === 'room' || record.type === 'teacher') {
    return record.type;
  }
  if (record.type === 'add' || record.type === 'remove' || record.type === 'update') {
    return record.type;
  }
  return record.kind;
}

function typeLabelOf(key: string, copy: ViewModelCopy): string {
  if (key === 'add') return copy.changes.typeAdd;
  if (key === 'remove') return copy.changes.typeRemove;
  if (key === 'time') return copy.changes.typeTime;
  if (key === 'room') return copy.changes.typeRoom;
  if (key === 'teacher') return copy.changes.typeTeacher;
  return copy.changes.typeUpdate;
}

function changeItem(record: ChangeRecord, copy: ViewModelCopy): ChangeViewItem {
  const typeKey: 'add' | 'remove' | 'update' | 'time' | 'room' | 'teacher' = typeKeyOf(record);
  const typeLabel: string = typeLabelOf(typeKey, copy);
  const fields: string[] = [];
  const recordFields: string[] = record.fields === undefined ? [] : record.fields;
  for (const field of recordFields) {
    fields.push(typeLabelOf(field, copy));
  }
  const detailText: string = record.detail === undefined ? '' : record.detail;
  const a11yText: string = copy.a11yChange.replaceAll('{title}', record.title)
    .replaceAll('{type}', typeLabel).replaceAll('{detail}', detailText);
  return {
    record: record,
    title: record.title,
    dateText: record.date,
    typeKey: typeKey,
    typeLabel: typeLabel,
    detailText: detailText,
    fieldsText: fields.join(', '),
    isUnread: !record.read,
    a11yText: a11yText
  };
}

function sortRecords(records: ChangeRecord[]): ChangeRecord[] {
  const copyRecords: ChangeRecord[] = records.slice();
  copyRecords.sort((a: ChangeRecord, b: ChangeRecord): number => {
    if (a.detectedAt < b.detectedAt) return 1;
    if (a.detectedAt > b.detectedAt) return -1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  return copyRecords;
}

export function buildChangeViewModel(records: ChangeRecord[], todayKey: string, copy: ViewModelCopy): ChangeViewModel {
  const sorted: ChangeRecord[] = sortRecords(records);
  const todayItems: ChangeViewItem[] = [];
  const earlierItems: ChangeViewItem[] = [];
  let unread: number = 0;
  for (const record of sorted) {
    const item: ChangeViewItem = changeItem(record, copy);
    if (item.isUnread) {
      unread++;
    }
    if (record.date === todayKey) {
      todayItems.push(item);
    } else {
      earlierItems.push(item);
    }
  }
  const groups: ChangeGroupView[] = [];
  if (todayItems.length > 0) {
    groups.push({ key: 'today', title: copy.changes.today, items: todayItems });
  }
  if (earlierItems.length > 0) {
    groups.push({ key: 'earlier', title: copy.changes.earlier, items: earlierItems });
  }
  return { isEmpty: records.length === 0, total: records.length, unreadCount: unread, groups: groups };
}

export function markChangeRead(records: ChangeRecord[], id: string): ChangeRecord[] {
  const result: ChangeRecord[] = [];
  for (const record of records) {
    if (record.id === id && !record.read) {
      result.push({
        id: record.id, key: record.key, kind: record.kind, stableKey: record.stableKey,
        date: record.date, title: record.title, detail: record.detail, before: record.before,
        after: record.after, fields: record.fields, type: record.type, source: record.source,
        read: true, notifiedAt: record.notifiedAt, detectedAt: record.detectedAt, at: record.at
      });
    } else {
      result.push(record);
    }
  }
  return result;
}

export function markAllChangeRead(records: ChangeRecord[]): ChangeRecord[] {
  const result: ChangeRecord[] = [];
  for (const record of records) {
    if (record.read) {
      result.push(record);
    } else {
      result.push({
        id: record.id, key: record.key, kind: record.kind, stableKey: record.stableKey,
        date: record.date, title: record.title, detail: record.detail, before: record.before,
        after: record.after, fields: record.fields, type: record.type, source: record.source,
        read: true, notifiedAt: record.notifiedAt, detectedAt: record.detectedAt, at: record.at
      });
    }
  }
  return result;
}


