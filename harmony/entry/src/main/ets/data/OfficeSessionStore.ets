// 职责：office 页面会话（apply.html query）契约与纯内存实现（P4 79b，规格 §2.7 / §3.3）。
// 依赖方向：data -> core/types（仅 import type），可被 Node strip-types 加载。
// 安全口径：uid / formId / pageEnc 只允许用于页面内 fetch 的请求体，不写日志、不拼 URL、不导出 Cookie；
//           本层不持久化任何 Cookie，内存会话过期即清；页面内 fetch 失败给 OFFICE_SESSION_REQUIRED，不回退导出 Cookie。
// 待确认：office 页面 query 的真实参数名（formid/formId、pageEnc 大小写）以真机抓取结果为准。

export const OFFICE_SESSION_TTL_MS: number = 900000;
export const OFFICE_SESSION_ORIGIN: string = 'https://xgxt.juwp.edu.cn';
const OFFICE_ORIGIN_PREFIX: string = 'https://xgxt.juwp.edu.cn/';
const UID_RE: RegExp = /^[0-9]{1,30}$/;
const FORM_ID_RE: RegExp = /^[0-9]{1,20}$/;
const PAGE_ENC_RE: RegExp = /^[A-Za-z0-9_-]{8,256}$/;

export interface OfficePageSession {
  pageUrl: string;
  uid: string;
  formId: string;
  pageEnc: string;
  capturedAt: number;
}

export interface OfficeSessionStore {
  get(): Promise<OfficePageSession | null>;
  set(session: OfficePageSession): Promise<void>;
  clear(): Promise<void>;
}

export function isOfficeApplyUrl(raw: string): boolean {
  if (typeof raw !== 'string') return false;
  const text: string = raw.trim();
  if (text.length === 0 || text.length > 2048) return false;
  if (text.indexOf(OFFICE_ORIGIN_PREFIX) !== 0) return false;
  const question: number = text.indexOf('?');
  let path: string = question < 0 ? text : text.slice(0, question);
  const hash: number = path.indexOf('#');
  if (hash >= 0) path = path.slice(0, hash);
  if (path.length <= OFFICE_ORIGIN_PREFIX.length) return false;
  if (path.indexOf('/office/') < 0) return false;
  if (path.slice(path.length - 11) !== '/apply.html') return false;
  return true;
}

function decodeQueryValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

export function officeSessionFromQuery(pageUrl: string, now: number): OfficePageSession | null {
  if (!isOfficeApplyUrl(pageUrl)) return null;
  const question: number = pageUrl.indexOf('?');
  if (question < 0) return null;
  let query: string = pageUrl.slice(question + 1);
  const hash: number = query.indexOf('#');
  if (hash >= 0) query = query.slice(0, hash);
  const pairs: string[] = query.split('&');
  let uid: string = '';
  let formId: string = '';
  let pageEnc: string = '';
  for (let i = 0; i < pairs.length; i++) {
    const pair: string = pairs[i];
    const eq: number = pair.indexOf('=');
    if (eq <= 0) continue;
    const key: string = decodeQueryValue(pair.slice(0, eq)).toLowerCase();
    const value: string = decodeQueryValue(pair.slice(eq + 1));
    if (key === 'uid') {
      uid = value;
    } else if (key === 'formid' || key === 'form_id') {
      formId = value;
    } else if (key === 'pageenc' || key === 'page_enc') {
      pageEnc = value;
    }
  }
  if (!UID_RE.test(uid)) return null;
  if (!FORM_ID_RE.test(formId)) return null;
  if (!PAGE_ENC_RE.test(pageEnc)) return null;
  const session: OfficePageSession = {
    pageUrl: pageUrl,
    uid: uid,
    formId: formId,
    pageEnc: pageEnc,
    capturedAt: now
  };
  return session;
}

export class MemoryOfficeSessionStore implements OfficeSessionStore {
  private current: OfficePageSession | null = null;
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(ttlMs?: number, clock?: () => number) {
    this.ttlMs = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : OFFICE_SESSION_TTL_MS;
    this.clock = clock !== undefined ? clock : (): number => Date.now();
  }

  async get(): Promise<OfficePageSession | null> {
    const current: OfficePageSession | null = this.current;
    if (current === null) return null;
    if (this.clock() - current.capturedAt > this.ttlMs) {
      this.current = null;
      return null;
    }
    return current;
  }

  async set(session: OfficePageSession): Promise<void> {
    const stored: OfficePageSession = {
      pageUrl: session.pageUrl,
      uid: session.uid,
      formId: session.formId,
      pageEnc: session.pageEnc,
      capturedAt: session.capturedAt
    };
    this.current = stored;
  }

  async clear(): Promise<void> {
    this.current = null;
  }
}
