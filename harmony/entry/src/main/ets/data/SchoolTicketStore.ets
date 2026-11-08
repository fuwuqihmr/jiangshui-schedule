// 职责：CAS 票据授权 cookie（TGC）的持久化契约与纯内存实现（配合无痕 WebView 的静默重登）。
// 依赖方向：data -> core/types（本文件不 import Kit），可被 Node strip-types 加载。
// 安全口径：TGC 等价于登录凭据，只允许写应用沙箱私有文件；Preferences 只存 updatedAt / hasTgc 元数据。
//          文件内容明文、未加密，口径固定为“安全待确认”，不得对外声称“已加密”。
// 说明：TGC 只用于向 CAS 换 service ticket；不写日志、不写 state、不导出给 Web 页面。

export const SCHOOL_TICKET_DOMAIN: string = 'eapp2.juwp.edu.cn:9443';
export const SCHOOL_TICKET_META_UPDATED_AT: string = 'jiangshui.school.ticket.updatedAt';
export const SCHOOL_TICKET_META_HAS_TGC: string = 'jiangshui.school.ticket.hasTgc';

// Apereo CAS 常见 TGC 名；只用于识别/持久化，不读取值做其他用途。
export const SCHOOL_TICKET_NAMES: string[] = ['TGC', 'CASTGC', 'CAS_TGC', 'TGC2'];

export interface SchoolTicket {
  cookieHeader: string;
  updatedAt: number;
  domain: string;
}

export interface SchoolTicketMetadata {
  updatedAt: number;
  hasTgc: boolean;
}

export interface SchoolTicketStore {
  load(): Promise<SchoolTicket | null>;
  save(ticket: SchoolTicket): Promise<void>;
  clear(): Promise<void>;
  metadata(): Promise<SchoolTicketMetadata>;
}

/** 从 Cookie 头里取某个 cookie 的完整 name=value（精确 name 匹配，取第一个）；没有返回空串。 */
function cookiePairOf(header: string, name: string): string {
  if (typeof header !== 'string' || header.length === 0) return '';
  const parts: string[] = header.split(';');
  for (const part of parts) {
    const item: string = part.trim();
    if (item.indexOf(name + '=') !== 0) continue;
    return item;
  }
  return '';
}

/** 按 SCHOOL_TICKET_NAMES 优先级取一个存在的 CAS 票据授权 cookie（返回完整 name=value）；没有返回空串。 */
export function extractTicketGrantingCookie(header: string): string {
  for (const name of SCHOOL_TICKET_NAMES) {
    const pair: string = cookiePairOf(header, name);
    if (pair.length > 0) return pair;
  }
  return '';
}

/** 是否带有 CAS 票据授权 cookie（只看存在性，不读值）。 */
export function hasTicketGrantingCookie(header: string): boolean {
  return extractTicketGrantingCookie(header).length > 0;
}

/** 从 Set-Cookie 列表里取刷新后的 TGC（只取 name=value，丢弃 Path/HttpOnly 等属性）；没有返回空串。 */
export function ticketGrantingCookieFromSetCookies(setCookies: string[]): string {
  if (!Array.isArray(setCookies)) return '';
  for (const raw of setCookies) {
    if (typeof raw !== 'string') continue;
    const first: string = raw.trim().split(';')[0].trim();
    const pair: string = extractTicketGrantingCookie(first);
    if (pair.length > 0) return pair;
  }
  return '';
}

export function isSchoolTicketUsable(ticket: SchoolTicket | null): boolean {
  if (ticket === null) return false;
  if (typeof ticket.cookieHeader !== 'string') return false;
  if (extractTicketGrantingCookie(ticket.cookieHeader).length === 0) return false;
  if (ticket.domain !== SCHOOL_TICKET_DOMAIN) return false;
  if (typeof ticket.updatedAt !== 'number' || !Number.isFinite(ticket.updatedAt)) return false;
  return ticket.updatedAt > 0;
}

export function normalizeSchoolTicket(ticket: SchoolTicket): SchoolTicket {
  const normalized: SchoolTicket = {
    cookieHeader: extractTicketGrantingCookie(ticket.cookieHeader),
    updatedAt: ticket.updatedAt,
    domain: SCHOOL_TICKET_DOMAIN
  };
  return normalized;
}

export function ticketMetadata(ticket: SchoolTicket | null): SchoolTicketMetadata {
  if (ticket === null || !isSchoolTicketUsable(ticket)) {
    return { updatedAt: 0, hasTgc: false };
  }
  return { updatedAt: ticket.updatedAt, hasTgc: true };
}

export class MemorySchoolTicketStore implements SchoolTicketStore {
  private current: SchoolTicket | null = null;

  async load(): Promise<SchoolTicket | null> {
    if (this.current === null) return null;
    if (!isSchoolTicketUsable(this.current)) return null;
    return normalizeSchoolTicket(this.current);
  }

  async save(ticket: SchoolTicket): Promise<void> {
    this.current = normalizeSchoolTicket(ticket);
  }

  async clear(): Promise<void> {
    this.current = null;
  }

  async metadata(): Promise<SchoolTicketMetadata> {
    return ticketMetadata(this.current);
  }
}
