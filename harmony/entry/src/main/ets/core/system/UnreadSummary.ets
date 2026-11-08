// 职责：汇总变更记录里的未读数量与最新一条摘要（纯逻辑，无 Kit）。
// 依赖方向：core/system -> core/types；禁止 import pages/platform/data/features。
// 阶段：P6 红点/通知联动；只暴露计数与文案字段，不改动记录本身。

import type { AppState } from '../types/AppState';

export interface UnreadSummary {
  unread: number;
  latestTitle: string;
  latestDetail: string;
  latestDate: string;
}

function isUnread(state: AppState, index: number): boolean {
  const record = state.changeRecords[index];
  return record !== undefined && record !== null && record.read !== true;
}

/** 未读数直接由 changeRecords 的 read 标记算出，与 diffState 写入同一份数据。 */
export function summarizeUnread(state: AppState): UnreadSummary {
  let unread = 0;
  let latestTitle = '';
  let latestDetail = '';
  let latestDate = '';
  for (let i = 0; i < state.changeRecords.length; i++) {
    if (!isUnread(state, i)) {
      continue;
    }
    unread++;
    const record = state.changeRecords[i];
    if (latestDate === '' || record.date >= latestDate) {
      latestDate = record.date;
      latestTitle = record.title;
      latestDetail = record.detail;
    }
  }
  return { unread: unread, latestTitle: latestTitle, latestDetail: latestDetail, latestDate: latestDate };
}

/** 桌面图标角标：华为角标上限 99，超过按 99 显示；0 表示清除。 */
export function badgeNumber(unread: number): number {
  if (!Number.isFinite(unread) || unread <= 0) {
    return 0;
  }
  return unread > 99 ? 99 : Math.round(unread);
}
