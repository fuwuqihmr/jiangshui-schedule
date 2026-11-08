// 职责：学校会话持久化契约与纯内存实现（P4 79b，规格 §2.3）。
// 依赖方向：data -> core/types（仅 import type），可被 Node strip-types 加载。
// 安全口径：cookieHeader 只允许写入应用沙箱私有文件；Preferences 只存 updatedAt / hasCookie / semesterId 元数据。
// 待确认：HUKS / Asset 加密存储的可用性与合规口径以官方文档与安全评审为准，当前不声明“已加密”。
// 说明：SchoolSession 的 domain 固定为 jiaowu.juwp.edu.cn，P3 契约不改。

import type { SchoolSession } from '../core/types/Leave';

export const SCHOOL_SESSION_COOKIE_NAME: string = 'bzb_jsxsd';
export const SCHOOL_SESSION_DOMAIN: string = 'jiaowu.juwp.edu.cn';
export const SCHOOL_SESSION_META_UPDATED_AT: string = 'jiangshui.school.session.updatedAt';
export const SCHOOL_SESSION_META_HAS_COOKIE: string = 'jiangshui.school.session.hasCookie';
export const SCHOOL_SESSION_META_SEMESTER_ID: string = 'jiangshui.school.session.semesterId';

export interface SchoolSessionMetadata {
  updatedAt: number;
  hasCookie: boolean;
  semesterId: string;
}

export interface SchoolSessionStore {
  load(): Promise<SchoolSession | null>;
  save(session: SchoolSession): Promise<void>;
  clear(): Promise<void>;
  metadata(): Promise<SchoolSessionMetadata>;
}

/** 从 Cookie 头里取会话语义 cookie 的完整 name=value（精确匹配，取第一个）；没有返回空串。 */
export function extractSessionCookie(header: string): string {
  if (typeof header !== 'string' || header.length === 0) return '';
  const parts: string[] = header.split(';');
  for (const part of parts) {
    const item: string = part.trim();
    if (item.indexOf(SCHOOL_SESSION_COOKIE_NAME + '=') === 0) return item;
  }
  return '';
}

export function hasSessionCookie(header: string): boolean {
  return extractSessionCookie(header).length > 0;
}

export function isSchoolSessionUsable(session: SchoolSession | null): boolean {
  if (session === null) return false;
  if (typeof session.cookieHeader !== 'string') return false;
  if (session.cookieHeader.length === 0) return false;
  if (session.cookieHeader.indexOf(SCHOOL_SESSION_COOKIE_NAME) < 0) return false;
  if (typeof session.updatedAt !== 'number' || !Number.isFinite(session.updatedAt)) return false;
  return session.updatedAt > 0;
}

export function normalizeSchoolSession(session: SchoolSession): SchoolSession {
  const semesterId: string = typeof session.semesterId === 'string' ? session.semesterId : '';
  const normalized: SchoolSession = {
    cookieHeader: session.cookieHeader,
    updatedAt: session.updatedAt,
    domain: SCHOOL_SESSION_DOMAIN,
    semesterId: semesterId
  };
  return normalized;
}

export function sessionMetadata(session: SchoolSession | null): SchoolSessionMetadata {
  if (session === null || !isSchoolSessionUsable(session)) {
    return { updatedAt: 0, hasCookie: false, semesterId: '' };
  }
  const semesterId: string = typeof session.semesterId === 'string' ? session.semesterId : '';
  return { updatedAt: session.updatedAt, hasCookie: true, semesterId: semesterId };
}

export class MemorySchoolSessionStore implements SchoolSessionStore {
  private current: SchoolSession | null = null;

  async load(): Promise<SchoolSession | null> {
    if (this.current === null) return null;
    if (!isSchoolSessionUsable(this.current)) return null;
    return normalizeSchoolSession(this.current);
  }

  async save(session: SchoolSession): Promise<void> {
    this.current = normalizeSchoolSession(session);
  }

  async clear(): Promise<void> {
    this.current = null;
  }

  async metadata(): Promise<SchoolSessionMetadata> {
    return sessionMetadata(this.current);
  }
}
