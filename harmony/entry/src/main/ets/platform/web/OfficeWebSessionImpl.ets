/**
 * 学工 Web 会话实现（P4 79c，规格 §3.3/§4.5）。
 * 职责：打开白名单网页、在申请页内用页面自身登录态 fetch 请假记录、解析并返回 LeaveRecord。
 * 安全口径：cookie 由 WebView 自己携带（credentials: 'include'），本类不读、不传、不记录；
 *           注入脚本只返回 JSON 字符串，不 console 请求体/cookie/响应体；请求体与响应体不落日志。
 * 依赖方向：platform/web -> core/parser + core/viewmodel + data 契约；pages 只经接口调用。
 */
import webview from '@ohos.web.webview';
import { ErrorCode } from '../../core/types/Common';
import type { LeaveRecord } from '../../core/types/Leave';
import type { SchoolLexicon } from '../../core/parser/SchoolLexicon';
import { parseOfficeLeave } from '../../core/parser/OfficeLeaveParser';
import type { OfficeParseResult } from '../../core/parser/OfficeLeaveParser';
import { buildPortalWebParam, buildWebOfficeParam, isAllowedWebUrl } from '../../core/viewmodel/WebEntryViewModel';
import type { LeaveServiceKey, WebOfficeParam } from '../../core/viewmodel/WebEntryViewModel';
import { isOfficeApplyUrl, officeSessionFromQuery } from '../../data/OfficeSessionStore';
import type { OfficePageSession, OfficeSessionStore } from '../../data/OfficeSessionStore';
import { logFields } from '../../util/Redactor';
import { Logger } from '../../util/Logger';
import type { OfficeWebSession, WebOfficeBridge } from './OfficeWebSession';

const OFFICE_SCRIPT_TIMEOUT_MS: number = 15000;
const OFFICE_FETCH_MAX_BYTES: number = 2000000;

/** 页内只读抓取脚本（§3.3 逐字）：不读 cookie、不 console 任何内容、只回 JSON 字符串。 */
const OFFICE_FETCH_SCRIPT: string = `(async () => {
  const u = new URL(location.href);
  const uid = u.searchParams.get('uid') || '';
  const formId = u.searchParams.get('formid') || u.searchParams.get('formId') || '';
  const pageEnc = u.searchParams.get('pageEnc') || '';
  if (!/^[0-9]{1,30}$/.test(uid) || !/^[0-9]{1,20}$/.test(formId) || !/^[A-Za-z0-9_-]{8,256}$/.test(pageEnc)) {
    return JSON.stringify({ ok: false, code: 'NEED_SESSION' });
  }
  const body = new URLSearchParams({ formId, uid, formUserId: '0', aprvAppId: formId,
    pageEnc, cpage: '1', pageSize: '50', desensitization: '', startTime: '', endTime: '' });
  const r = await fetch('/office/data/approve/apps/forms/fore/user/list', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
    body: body.toString()
  });
  if (r.status === 401 || r.status === 403) return JSON.stringify({ ok: false, code: 'NEED_LOGIN' });
  if (!r.ok) return JSON.stringify({ ok: false, code: 'HTTP_' + r.status });
  return JSON.stringify({ ok: true, body: (await r.text()).slice(0, 2000000) });
})()`;

interface OfficeFetchEnvelope {
  ok: boolean;
  code?: string;
  body?: string;
}

export class OfficeWebSessionImpl implements OfficeWebSession, WebOfficeBridge {
  private readonly controller: webview.WebviewController;
  private readonly sessions: OfficeSessionStore;
  private readonly lexicon: SchoolLexicon;
  private readonly available: boolean;
  private readonly clock: () => number;
  private currentUrl: string = '';

  constructor(controller: webview.WebviewController, sessions: OfficeSessionStore, lexicon: SchoolLexicon,
              available: boolean = true, clock: () => number = () => Date.now()) {
    this.controller = controller;
    this.sessions = sessions;
    this.lexicon = lexicon;
    this.available = available;
    this.clock = clock;
  }

  /** 导航监听：离开申请页时清空页内会话，防止旧 uid/pageEnc 被复用。 */
  async noteUrl(url: string): Promise<void> {
    if (this.currentUrl.length > 0 && isOfficeApplyUrl(this.currentUrl) && !isOfficeApplyUrl(url)) {
      await this.sessions.clear();
    }
    this.currentUrl = url;
  }

  async open(url: string, warmupUrl?: string): Promise<void> {
    if (!this.available) {
      throw new Error(ErrorCode.OFFICE_UNAVAILABLE);
    }
    if (!isAllowedWebUrl(url)) {
      throw new Error(ErrorCode.OFFICE_UNAVAILABLE);
    }
    if (warmupUrl !== undefined && warmupUrl.length > 0 && isAllowedWebUrl(warmupUrl)) {
      this.controller.loadUrl(warmupUrl);
    }
    this.controller.loadUrl(url);
    await this.noteUrl(url);
  }

  async runJavaScript<T>(script: string, timeoutMs: number): Promise<T> {
    if (!this.available) {
      throw new Error(ErrorCode.OFFICE_UNAVAILABLE);
    }
    const budget: number = timeoutMs > 0 ? timeoutMs : OFFICE_SCRIPT_TIMEOUT_MS;
    const raw: string = await this.raceTimeout<string>(this.controller.runJavaScript(script), budget);
    return raw as T;
  }

  private raceTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve: (value: T) => void, reject: (error: Error) => void) => {
      let settled: boolean = false;
      const timer: number = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(ErrorCode.OFFICE_UNAVAILABLE));
        }
      }, timeoutMs);
      task.then((value: T) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      }).catch((error: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  async reload(): Promise<void> {
    if (!this.available) {
      throw new Error(ErrorCode.OFFICE_UNAVAILABLE);
    }
    if (this.currentUrl.length > 0) {
      this.controller.loadUrl(this.currentUrl);
    }
  }

  async close(): Promise<void> {
    this.currentUrl = '';
    await this.sessions.clear();
  }

  async openLeaveService(key: LeaveServiceKey): Promise<void> {
    const param: WebOfficeParam = buildWebOfficeParam(key);
    await this.open(param.url, param.warmupUrl);
  }

  async openCalendarSettings(): Promise<void> {
    const param: WebOfficeParam = buildPortalWebParam();
    await this.open(param.url, param.warmupUrl);
  }

  async fetchLeaveRecords(semesterId?: string): Promise<LeaveRecord[]> {
    if (!this.available) {
      throw new Error(ErrorCode.OFFICE_UNAVAILABLE);
    }
    const startedAt: number = this.clock();
    const pageUrl: string = this.pageUrl();
    if (!isOfficeApplyUrl(pageUrl)) {
      throw new Error(ErrorCode.OFFICE_SESSION_REQUIRED);
    }
    const page: OfficePageSession | null = officeSessionFromQuery(pageUrl, startedAt);
    if (page === null) {
      throw new Error(ErrorCode.OFFICE_SESSION_REQUIRED);
    }
    await this.sessions.set(page);
    let raw: string = '';
    try {
      raw = await this.runJavaScript<string>(OFFICE_FETCH_SCRIPT, OFFICE_SCRIPT_TIMEOUT_MS);
    } catch (error) {
      Logger.warn(JSON.stringify(logFields({ stage: 'office-fetch', code: ErrorCode.OFFICE_UNAVAILABLE })));
      throw new Error(ErrorCode.OFFICE_UNAVAILABLE);
    }
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new Error(ErrorCode.OFFICE_UNAVAILABLE);
    }
    let envelope: OfficeFetchEnvelope;
    try {
      envelope = JSON.parse(raw) as OfficeFetchEnvelope;
    } catch (error) {
      throw new Error(ErrorCode.OFFICE_UNAVAILABLE);
    }
    if (envelope.ok !== true || typeof envelope.body !== 'string') {
      const code: string = typeof envelope.code === 'string' ? envelope.code : '';
      if (code === 'NEED_SESSION' || code === 'NEED_LOGIN') {
        throw new Error(ErrorCode.OFFICE_SESSION_REQUIRED);
      }
      throw new Error(ErrorCode.OFFICE_UNAVAILABLE);
    }
    const parsed: OfficeParseResult = semesterId !== undefined && semesterId.length > 0
      ? parseOfficeLeave(envelope.body, this.lexicon, { semesterId: semesterId })
      : parseOfficeLeave(envelope.body, this.lexicon);
    if (parsed.error !== null) {
      throw new Error(parsed.error === ErrorCode.OFFICE_SESSION_REQUIRED ? ErrorCode.OFFICE_SESSION_REQUIRED : ErrorCode.OFFICE_UNAVAILABLE);
    }
    Logger.info(JSON.stringify(logFields({
      stage: 'office-fetch',
      code: 'OK',
      durationMs: this.clock() - startedAt,
      bytes: envelope.body.length
    })));
    return parsed.records;
  }

  private pageUrl(): string {
    if (this.currentUrl.length > 0) {
      return this.currentUrl;
    }
    try {
      const live: string = this.controller.getUrl();
      this.currentUrl = typeof live === 'string' ? live : '';
    } catch (error) {
      this.currentUrl = '';
    }
    return this.currentUrl;
  }
}
