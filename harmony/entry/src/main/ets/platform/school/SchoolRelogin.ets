// 职责：教务静默重登的真实 SSO 换票实现（规格 §3.1 第 7 条、§3.2 第 7 步）。
// 依赖方向：platform/school -> platform/network(HttpGateway)、platform/web(WebCookieStore)、
//          core/parser(SchoolUrls)、data/SchoolReadOrchestrator(端口/错误码)、data/SchoolTicketStore(纯契约)。
// 阶段：P4；本类是 SchoolReloginPort 的唯一平台实现，数据层仍不接触任何 Kit。
// 语义（必须如实）：优先用 Web 组件里人工登录留下的 CAS TGC；无痕模式重启后 jar 里没有 TGC 时，
// 回落到自有沙箱持久化的 TGC，再向 CAS 申请 service ticket，让教务下发新的
//          bzb_jsxsd；只有“拿到的新 bzb_jsxsd 与旧值不同”才算换票成功。
//          没有 TGC、CAS 回登录页/验证码页、或响应里没有新会话 cookie 时一律抛稳定码
//          （SCHOOL_LOGIN_REQUIRED / SCHOOL_CAPTCHA_REQUIRED），绝不返回旧 cookie 假装已登录。
// 安全口径：TGC 等价于登录凭据，只在内存里作为 CAS 请求的 Cookie 头传递，并明文持久化到应用私有目录
//          （安全待确认，未加密）；不打印、不写 state、不写日志、不导出给页面；换票成功刷新持久化值，
//          失败清除持久化值。换票失败不改变已保存的旧教务会话（由编排层决定清理）。
// 待确认（官方文档/真机）：WebCookieManager.fetchCookie 能否读到 CAS 的 HttpOnly TGC；
//          CAS 在 302 链上是否用 Set-Cookie 下发新的教务会话；本层已按“响应 Set-Cookie 或 jar 变化”双路径判定。

import { ErrorCode } from '../../core/types/Common';
import {
  CAS_LOGIN,
  CAS_SERVICE_URL,
  JIAOWU_SESSION_URL,
  parseSchoolUrl,
  SCHOOL_REDIRECT_ORIGINS as CORE_REDIRECT_ORIGINS
} from '../../core/parser/SchoolUrls';
import type { SchoolLexicon } from '../../core/parser/SchoolLexicon';
import {
  SCHOOL_CAPTCHA_REQUIRED,
  SCHOOL_LOGIN_REQUIRED,
  SchoolReadError
} from '../../data/SchoolReadOrchestrator';
import type { SchoolParserApi, SchoolReloginPort } from '../../data/SchoolReadOrchestrator';
import {
  extractTicketGrantingCookie,
  hasTicketGrantingCookie,
  isSchoolTicketUsable,
  SCHOOL_TICKET_DOMAIN,
  ticketGrantingCookieFromSetCookies
} from '../../data/SchoolTicketStore';
import type { SchoolTicket, SchoolTicketStore } from '../../data/SchoolTicketStore';
import type { HttpGateway, HttpRedirect, HttpResponse } from '../network/HttpGateway';
import type { WebCookieStore } from '../web/WebCookieStore';
import { Logger } from '../../util/Logger';

// 静态降级标记（platform 目录规范）：无 Web/网络能力时本类退化为 SCHOOL_LOGIN_REQUIRED。
export const WEB_UNAVAILABLE: ErrorCode = 'WEB_UNAVAILABLE' as ErrorCode;

// 会话 cookie 名（与 data/SchoolReadOrchestrator 的 SCHOOL_SESSION_COOKIE 一致）。
const SESSION_COOKIE_NAME: string = 'bzb_jsxsd';

/**
 * 换票链允许跟随的重定向 origin（与 SchoolReader 共用 core/parser/SchoolUrls 的单一真源）。
 * 这里不 import SchoolReader，避免 platform/school 内部循环依赖：
 * sso.jsp(jiaowu https:81) -> CAS(eapp2 https:9443) -> service 回 jiaowu(http:80/https:443) -> jsxsd(http:8080)。
 */
const RELOGIN_REDIRECT_ORIGINS: string[] = CORE_REDIRECT_ORIGINS;

const DEFAULT_RELOGIN_TIMEOUT_MS: number = 20000;

/** 从 Cookie 头里取某个 cookie 的值（精确 name 匹配，取第一个）；没有返回空串。 */
function cookieValueOf(header: string, name: string): string {
  if (typeof header !== 'string' || header.length === 0) return '';
  const parts: string[] = header.split(';');
  for (const part of parts) {
    const item: string = part.trim();
    if (item.indexOf(name + '=') !== 0) continue;
    return item.substring(name.length + 1);
  }
  return '';
}

/** 从 Set-Cookie 列表里取 bzb_jsxsd 的值（多次下发取最后一个）；没有返回空串。 */
function sessionCookieValue(setCookies: string[]): string {
  let value: string = '';
  for (const raw of setCookies) {
    if (typeof raw !== 'string') continue;
    const text: string = raw.trim();
    if (text.length === 0) continue;
    const first: string = text.split(';')[0].trim();
    const prefix: string = SESSION_COOKIE_NAME + '=';
    if (first.indexOf(prefix) !== 0) continue;
    value = first.substring(prefix.length);
  }
  return value;
}

/** 用新值替换/追加 cookie 头里的会话 cookie，其余 cookie 原样保留（不新增任何外部值）。 */
function upsertSessionCookie(header: string, value: string): string {
  const kept: string[] = [];
  if (typeof header === 'string' && header.length > 0) {
    const parts: string[] = header.split(';');
    for (const part of parts) {
      const item: string = part.trim();
      if (item.length === 0) continue;
      if (item.indexOf(SESSION_COOKIE_NAME + '=') === 0) continue;
      kept.push(item);
    }
  }
  kept.push(SESSION_COOKIE_NAME + '=' + value);
  return kept.join('; ');
}

/** CAS 登录页的兜底特征（parser 的词库面向教务登录页，CAS 页结构不同，需要额外识别）。 */
function looksLikeCasLogin(body: string): boolean {
  const text: string = typeof body === 'string' ? body.toLowerCase() : '';
  if (text.length === 0) return false;
  if (text.indexOf('name="password"') >= 0) return true;
  if (text.indexOf('name="execution"') >= 0) return true;
  return text.indexOf('/cas/login') >= 0 && text.indexOf('name="username"') >= 0;
}

/** 验证码页的兜底特征（纯 ASCII 关键字，仅用于选择稳定错误码，不记录页面内容）。 */
function looksLikeCaptcha(body: string): boolean {
  const text: string = typeof body === 'string' ? body.toLowerCase() : '';
  if (text.length === 0) return false;
  return text.indexOf('captcha') >= 0 || text.indexOf('kaptcha') >= 0;
}

/** Read one query parameter without decoding it (used only to test ticket presence, never logged). */
function queryParamOf(raw: string, name: string): string {
  const queryStart: number = raw.indexOf('?');
  if (queryStart < 0) return '';
  let query: string = raw.substring(queryStart + 1);
  const hash: number = query.indexOf('#');
  if (hash >= 0) query = query.substring(0, hash);
  const segments: string[] = query.split('&');
  for (let i = 0; i < segments.length; i++) {
    const segment: string = segments[i];
    const eq: number = segment.indexOf('=');
    if (eq < 0) continue;
    if (segment.substring(0, eq) === name) {
      return segment.substring(eq + 1);
    }
  }
  return '';
}

/**
 * a successful CAS exchange is observable as a 302/303 whose Location is the fixed
 * CAS_SERVICE_URL and carries a non-empty ticket. We compare scheme/host/port/path exactly and
 * never log the Location, so the service ticket cannot leak into logs. Redirects are captured by
 * HttpGateway before it follows them; if the platform follows internally this returns false and
 * the new bzb_jsxsd fallback below still decides success.
 */
function hasTicketRedirect(redirects: HttpRedirect[] | undefined, serviceUrl: string): boolean {
  if (redirects === undefined || redirects.length === 0) return false;
  const expected = parseSchoolUrl(serviceUrl);
  if (expected === null) return false;
  for (let i = 0; i < redirects.length; i++) {
    const hop: HttpRedirect = redirects[i];
    if (hop.status !== 302 && hop.status !== 303) continue;
    const target = parseSchoolUrl(hop.url);
    if (target === null) continue;
    if (target.scheme !== expected.scheme || target.host !== expected.host || target.port !== expected.port) continue;
    if (target.path !== expected.path) continue;
    if (queryParamOf(hop.url, 'ticket').length === 0) continue;
    return true;
  }
  return false;
}

export class PlatformSchoolRelogin implements SchoolReloginPort {
  private readonly http: HttpGateway;
  private readonly cookies: WebCookieStore;
  private readonly parser: SchoolParserApi;
  private readonly lexicon: SchoolLexicon;
  private readonly timeoutMs: number;
  private tickets: SchoolTicketStore | null = null;
  private now: () => number = (): number => Date.now();
  private inFlight: Promise<string> | null = null;

  constructor(http: HttpGateway, cookies: WebCookieStore, parser: SchoolParserApi, lexicon: SchoolLexicon,
    timeoutMs?: number) {
    this.http = http;
    this.cookies = cookies;
    this.parser = parser;
    this.lexicon = lexicon;
    this.timeoutMs = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.trunc(timeoutMs) : DEFAULT_RELOGIN_TIMEOUT_MS;
  }

  /**
   * 由装配层注入 TGC 持久化端口；不注入时只使用无痕 jar（旧行为）。
   * now 仅用于测试，生产不传（默认 Date.now）。
   */
  attachTicketStore(tickets: SchoolTicketStore, now?: () => number): void {
    this.tickets = tickets;
    if (now !== undefined) {
      this.now = now;
    }
  }

  /**
   * 执行一次 SSO 换票，返回换票后的完整教务 Cookie 头（必含新的 bzb_jsxsd）。
   * 任一环节换不到新票都抛错：调用方只允许把它映射成“需要人工登录/验证码”，不得当成成功。
   * 并发调用共享同一个 in-flight Promise，避免两次换票互相覆盖 TGC/会话。
   */
  exchange(): Promise<string> {
    if (this.inFlight !== null) return this.inFlight;
    const run: Promise<string> = this.performExchange();
    this.inFlight = run;
    const settle = (): void => {
      if (this.inFlight === run) this.inFlight = null;
    };
    run.then(settle, settle);
    return run;
  }

  private async performExchange(): Promise<string> {
    const jiaowuCookie: string = await this.cookies.cookieHeaderFor(JIAOWU_SESSION_URL);
    const previous: string = cookieValueOf(jiaowuCookie, SESSION_COOKIE_NAME);

    // 1) 优先读无痕 jar 里的 CAS TGC；无痕模式重启后 jar 为空，回落到自有沙箱持久化值。
    let casCookie: string = await this.cookies.cookieHeaderFor(CAS_LOGIN);
    if (!hasTicketGrantingCookie(casCookie)) {
      const stored: SchoolTicket | null = await this.loadPersistedTicket();
      if (stored === null) {
        Logger.info('school relogin sso exchange skipped tgc=absent');
        throw new SchoolReadError(SCHOOL_LOGIN_REQUIRED, 'cas ticket granting cookie absent');
      }
      casCookie = stored.cookieHeader;
      Logger.info('school relogin sso exchange tgc=persisted');
    } else {
      Logger.info('school relogin sso exchange tgc=jar');
    }

    // 2) service 是固定常量（真实 sso.jsp 返回 200 + JS，不能从 finalUrl 猜）。
    //    CAS 要求 URL 编码后的 service；不再发 sso.jsp 请求，因此 200/JS 页不影响重登。
    const service: string = encodeURIComponent(CAS_SERVICE_URL);

    // 3) 带 TGC 请求 CAS：成功时 CAS 302 回 service?ticket=ST-...，教务再 302 到 jsxsd 并下发新会话 cookie。
    //    重定向各跳由 HttpGateway 手动跟随并按 origin 白名单校验，跨 origin 不转发 Cookie（TGC 不外泄）。
    const casUrl: string = CAS_LOGIN + '?service=' + service;
    const response: HttpResponse = await this.http.request({
      url: casUrl,
      method: 'GET',
      headers: { 'Cookie': casCookie },
      timeoutMs: this.timeoutMs,
      allowedRedirectOrigins: RELOGIN_REDIRECT_ORIGINS,
      // 真实 CAS 链可达 6 跳（CAS -> sso.jsp?ticket -> https:443 -> http:80 -> LoginToXk -> 框架页）；
      // 默认 5 跳会在最后一步前截断，换票请求单独放宽到 8。
      maxRedirects: 8
    });
    const redirectCount: number = response.redirects === undefined ? 0 : response.redirects.length;
    Logger.info('school relogin sso exchange status=' + String(response.status)
      + ' setCookies=' + String(response.setCookies.length)
      + ' redirects=' + String(redirectCount));

    // 4) 判定是否真的换到新票：只认 Set-Cookie 里的 bzb_jsxsd 或 jar 里变化后的值，旧值复现不算成功。
    const fromSetCookie: string = sessionCookieValue(response.setCookies);
    let nextCookie: string = '';
    if (fromSetCookie.length > 0 && fromSetCookie !== previous) {
      nextCookie = upsertSessionCookie(jiaowuCookie, fromSetCookie);
    }
    if (nextCookie.length === 0) {
      // 平台可能已把换票 Set-Cookie 落到 jar（或 Web 组件先写了），重读一次并同样要求值变化。
      const jarCookie: string = await this.cookies.cookieHeaderFor(JIAOWU_SESSION_URL);
      const jarValue: string = cookieValueOf(jarCookie, SESSION_COOKIE_NAME);
      if (jarValue.length > 0 && jarValue !== previous) {
        nextCookie = jarCookie;
      }
    }
    if (nextCookie.length === 0) {
      // 5) 没有新会话：先清持久化 TGC（它已无法换到新会话），再按页面形态给出可操作码。
      await this.clearPersistedTicket();
      const ticketSeen: boolean = hasTicketRedirect(response.redirects, CAS_SERVICE_URL);
      const body: string = response.body;
      if (!ticketSeen && (this.parser.isLoginPage(body, this.lexicon) || looksLikeCasLogin(body))) {
        throw new SchoolReadError(SCHOOL_LOGIN_REQUIRED, 'cas login page');
      }
      if (!ticketSeen && (this.parser.isCaptchaPage(body, this.lexicon) || looksLikeCaptcha(body))) {
        throw new SchoolReadError(SCHOOL_CAPTCHA_REQUIRED, 'cas captcha required');
      }
      throw new SchoolReadError(SCHOOL_LOGIN_REQUIRED, 'cas ticket exchange failed');
    }

    // 6) 换票成功：刷新持久化 TGC（响应 Set-Cookie 优先，否则保留请求里那个），再写回 jar。
    const refreshedTgc: string = ticketGrantingCookieFromSetCookies(response.setCookies);
    const ticketHeader: string = refreshedTgc.length > 0 ? refreshedTgc : extractTicketGrantingCookie(casCookie);
    await this.persistTicket(ticketHeader);

    // 7) 写回 jar（只 bzb_jsxsd 一条）：写失败也返回新 cookie，本次读取仍用新票。
    const applied: boolean = await this.cookies.applySessionCookies(response.setCookies);
    Logger.info('school relogin sso exchange applied=' + String(applied));
    return nextCookie;
  }

  private async loadPersistedTicket(): Promise<SchoolTicket | null> {
    if (this.tickets === null) return null;
    try {
      const stored: SchoolTicket | null = await this.tickets.load();
      if (stored === null || !isSchoolTicketUsable(stored)) return null;
      return stored;
    } catch (error) {
      // 持久化不可用只降级为“无 TGC”，不影响 jar 路径；日志不带任何 cookie 值。
      Logger.info('school relogin ticket load=failed');
      return null;
    }
  }

  private async persistTicket(ticketHeader: string): Promise<void> {
    if (this.tickets === null) return;
    const tgc: string = extractTicketGrantingCookie(ticketHeader);
    if (tgc.length === 0) {
      Logger.info('school relogin ticket persist=empty');
      return;
    }
    const rawNow: number = this.now();
    const updatedAt: number = Number.isFinite(rawNow) && rawNow > 0 ? rawNow : Date.now();
    try {
      const ticket: SchoolTicket = {
        cookieHeader: tgc,
        updatedAt: updatedAt,
        domain: SCHOOL_TICKET_DOMAIN
      };
      await this.tickets.save(ticket);
      Logger.info('school relogin ticket persist=ok');
    } catch (error) {
      // 持久化写失败不改变本次换票结果；下次重启会退回人工登录。日志不带值。
      Logger.info('school relogin ticket persist=failed');
    }
  }

  private async clearPersistedTicket(): Promise<void> {
    if (this.tickets === null) return;
    try {
      await this.tickets.clear();
      Logger.info('school relogin ticket clear=ok');
    } catch (error) {
      Logger.info('school relogin ticket clear=failed');
    }
  }
}
