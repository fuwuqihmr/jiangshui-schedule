// 职责：设置六组纯逻辑（顺序/展开/摘要），零 Kit。
// 依赖：仅 core/types 的 SettingsExpanded；不依赖页面。
// 阶段：P3；待确认：无。
import type { SettingsExpanded } from '../types/AppState';

export type SettingsGroupId = 'auto' | 'display' | 'leave' | 'course' | 'data' | 'about';
export interface SettingsGroupMeta {
  id: SettingsGroupId;
  titleKey: string;
  summaryKey: string;
  order: number;
}
export const SETTINGS_GROUPS: SettingsGroupMeta[] = [
  { id: 'auto', titleKey: 'settings_group_auto', summaryKey: 'settings_summary_auto', order: 0 },
  { id: 'display', titleKey: 'settings_group_display', summaryKey: 'settings_summary_display', order: 1 },
  { id: 'leave', titleKey: 'settings_group_leave', summaryKey: 'settings_summary_leave', order: 2 },
  { id: 'course', titleKey: 'settings_group_course', summaryKey: 'settings_summary_course', order: 3 },
  { id: 'data', titleKey: 'settings_group_data', summaryKey: 'settings_summary_data', order: 4 },
  { id: 'about', titleKey: 'settings_group_about', summaryKey: 'settings_summary_about', order: 5 }
];
export interface SettingsGroupView { id: SettingsGroupId; titleKey: string; summaryKey: string; order: number; expanded: boolean; }
export function defaultSettingsExpanded(): SettingsExpanded { return { auto: true, display: false, leave: false, course: false, data: false, about: false }; }
export function normalizeSettingsExpanded(raw: Partial<SettingsExpanded> | null | undefined): SettingsExpanded {
  const d = defaultSettingsExpanded();
  if (raw === null || raw === undefined || typeof raw !== 'object') { return d; }
  d.auto = typeof raw.auto === 'boolean' ? raw.auto : d.auto;
  d.display = typeof raw.display === 'boolean' ? raw.display : d.display;
  d.leave = typeof raw.leave === 'boolean' ? raw.leave : d.leave;
  d.course = typeof raw.course === 'boolean' ? raw.course : d.course;
  d.data = typeof raw.data === 'boolean' ? raw.data : d.data;
  d.about = typeof raw.about === 'boolean' ? raw.about : d.about;
  return d;
}
export function toggleSettingsGroup(current: SettingsExpanded, id: SettingsGroupId): SettingsExpanded {
  const next = normalizeSettingsExpanded(current);
  if (id === 'auto') next.auto = !next.auto;
  else if (id === 'display') next.display = !next.display;
  else if (id === 'leave') next.leave = !next.leave;
  else if (id === 'course') next.course = !next.course;
  else if (id === 'data') next.data = !next.data;
  else if (id === 'about') next.about = !next.about;
  return next;
}
export function expandAllSettingsGroups(): SettingsExpanded { return { auto: true, display: true, leave: true, course: true, data: true, about: true }; }
export function collapseAllSettingsGroups(): SettingsExpanded { return { auto: false, display: false, leave: false, course: false, data: false, about: false }; }
export function isAllSettingsExpanded(value: SettingsExpanded): boolean { const v = normalizeSettingsExpanded(value); return v.auto && v.display && v.leave && v.course && v.data && v.about; }
export function buildSettingsGroupViews(value: SettingsExpanded): SettingsGroupView[] {
  const v = normalizeSettingsExpanded(value);
  return SETTINGS_GROUPS.map((g) => {
    const view: SettingsGroupView = { id: g.id, titleKey: g.titleKey, summaryKey: g.summaryKey, order: g.order, expanded: false };
    if (g.id === 'auto') view.expanded = v.auto; else if (g.id === 'display') view.expanded = v.display; else if (g.id === 'leave') view.expanded = v.leave; else if (g.id === 'course') view.expanded = v.course; else if (g.id === 'data') view.expanded = v.data; else view.expanded = v.about;
    return view;
  });
}
