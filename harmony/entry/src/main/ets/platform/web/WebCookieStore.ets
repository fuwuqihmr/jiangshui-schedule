// 职责：Web 组件 cookie jar 的会话读写器（P4 79b 规格 §2.2；增补 SSO 换票写回）。
// 依赖方向：platform/web -> @ohos.web.webview（webview.WebCookieManager）；core 与页面不直接接触 Kit。
// 阶段：P4；只允许白名单 origin，origin 之外一律返回空串/false，不抛错。
//         白名单含 CAS 登录域（eapp2.juwp.edu.cn:9443），仅用于 SSO 静默换票时读取 TGC，
//         该域不参与任何页面 URL 校验（页面 URL 白名单在 core/parser/SchoolUrls）。
// 安全口径：cookie 返回值只允许作为 HttpGateway 的 Cookie 头（或换票请求的 CAS Cookie 头）使用；
//          不 console.log、不写 AppState/StateRepository、不经 runJavaScript/JSProxy 回传页面；
//          空串表示“无会话”，不是异常。applySessionCookies 只接受 bzb_jsxsd 一条，
//          绝不把 CAS TGC 或其它域的 cookie 写进教务域。
// 待确认：WebCookieManager.fetchCookie 在 API 12 的返回形态（全量 "k=v; k2=v2"）、HttpOnly 的 TGC
//         是否能被 fetchCookie 读到、以及 xgxt/教务是否共享 cookie jar，以官方文档与真机为准。

import webview from '@ohos.web.webview';
import { parseSchoolUrl } from '../../core/parser/SchoolUrls';
import type { ErrorCode } from '../../core/types/Common';

export const WEB_UNAVAILABLE: ErrorCode = 'WEB_UNAVAILABLE' as ErrorCode;

const ALLOWED_ORIGINS: string[] = [
  'http://jiaowu.juwp.edu.cn',
  'http://jiaowu.juwp.edu.cn:8080',
  'https://jiaowu.juwp.edu.cn',
  'https://jiaowu.juwp.edu.cn:81',
  'https://xgxt.juwp.edu.cn',
  // CAS 登录域，仅用于 SSO 静默换票读 TGC（与 core/parser/SchoolUrls 的 CAS_LOGIN 同源）。
  'https://eapp2.juwp.edu.cn:9443'
];

const SCHOOL_SESSION_COOKIE_NAME: string = 'bzb_jsxsd';

/**
 * 清教务会话 cookie 的目标（P1-1）。只动 jiaowu 两个 origin 的 /jsxsd 路径，不碰 xgxt（学工会话）。
 * WebCookieManager 没有“按名字删除”的接口，这里用 Max-Age=0 覆盖同名 cookie 来实现失效。
 * 待官方文档确认：configCookie 覆盖过期 cookie 是否立即对后续 fetchCookie/HTTP 生效；
 * 若平台另有删除接口，后续可替换，当前实现失败时只记 false 由调用方降级。
 */
const SCHOOL_COOKIE_CLEAR_TARGETS: string[] = [
  'http://jiaowu.juwp.edu.cn:8080/jsxsd/',
  'https://jiaowu.juwp.edu.cn:81/jsxsd/'
];
const EXPIRED_SESSION_COOKIE: string = SCHOOL_SESSION_COOKIE_NAME + '=; Max-Age=0; Path=/jsxsd';

export interface WebCookieStore {
  /** 读取 cookie 头；incognito 省略时用实例默认值（true=无痕内存 jar）。 */
  cookieHeaderFor(url: string, incognito?: boolean): Promise<string>;
  contains(url: string, name: string, incognito?: boolean): Promise<boolean>;
  /** 清除教务域会话 cookie（P1-1）；返回 true 表示至少有一个 origin 被覆盖。 */
  clearSchoolCookies(): Promise<boolean>;
  /**
   * 把 SSO 换票响应里的 Set-Cookie 写回教务域 jar。
   * 只接受名字为 bzb_jsxsd 的一条，其余一律忽略（防止把 CAS TGC 或别域 cookie 写进教务域）；
   * 目标固定 jiaowu 两个 origin 的 /jsxsd 路径。返回 true 表示至少写成功一个目标。
   */
  applySessionCookies(setCookies: string[]): Promise<boolean>;
}

function originAllowed(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  for (const origin of ALLOWED_ORIGINS) {
    if (url === origin) return true;
    if (url.indexOf(origin + '/') === 0) return true;
    if (url.indexOf(origin + '?') === 0) return true;
    if (url.indexOf(origin + '#') === 0) return true;
  }
  return false;
}

/**
 * 从一条 Set-Cookie 原文里只保留 bzb_jsxsd 那一条。
 * 名称不是会话 cookie 的 Set-Cookie 返回空串，由调用方跳过；属性（Path/Domain/HttpOnly 等）原样保留，
 * 由平台 configCookie 决定接受程度（Secure 属性在 http origin 上可能被拒，失败按 false 降级）。
 */
function sessionCookieOnly(raw: string): string {
  if (typeof raw !== 'string') return '';
  const text: string = raw.trim();
  if (text.length === 0) return '';
  const first: string = text.split(';')[0].trim();
  if (first.indexOf(SCHOOL_SESSION_COOKIE_NAME + '=') !== 0) return '';
  return text;
}

function cookieDomainMatches(cookieDomain: string, host: string): boolean {
  if (typeof cookieDomain !== 'string' || cookieDomain.length === 0) return false;
  let domain: string = cookieDomain.toLowerCase();
  if (domain.charAt(0) === '.') domain = domain.substring(1);
  if (domain === host) return true;
  if (host.length <= domain.length + 1) return false;
  return host.substring(host.length - domain.length - 1) === '.' + domain;
}

function cookiePathMatches(cookiePath: string, requestPath: string): boolean {
  let path: string = (typeof cookiePath === 'string' && cookiePath.length > 0) ? cookiePath : '/';
  if (path.charAt(0) !== '/') path = '/' + path;
  if (requestPath === path) return true;
  if (path.charAt(path.length - 1) === '/') return requestPath.indexOf(path) === 0;
  return requestPath.indexOf(path + '/') === 0;
}

function hasCookieName(header: string, name: string): boolean {
  if (header.length === 0) return false;
  const parts: string[] = header.split(';');
  for (const part of parts) {
    const item: string = part.trim();
    if (item.indexOf(name + '=') === 0) return true;
  }
  return false;
}

export class PlatformWebCookieStore implements WebCookieStore {
  // 登录 WebView 使用无痕模式，cookie 只在该 WebView 的内存 jar 中；
  // 构造为 true 时读取也走 incognito=true，避免读到用户日常浏览器的持久 cookie。
  private readonly incognito: boolean;

  constructor(incognito: boolean = false) {
    this.incognito = incognito;
  }

  async cookieHeaderFor(url: string, incognito?: boolean): Promise<string> {
    if (!originAllowed(url)) return '';
    const useIncognito: boolean = incognito === undefined ? this.incognito : incognito;
    try {
      const cookie: string = await webview.WebCookieManager.fetchCookie(url, useIncognito);
      if (typeof cookie !== 'string') return '';
      return cookie;
    } catch (error) {
      return '';
    }
  }

  /**
   * 无痕 WebView 的 HttpOnly cookie 是否能被 fetchCookie 读出只有真机能证；
   * 这里用 API 23+ 的 fetchAllCookies 作为第二层，按 URL host/path 过滤后重建 Cookie 头。
   * 返回值同样只允许用于日志外的内存判定、会话保存或 HttpGateway Cookie 头，禁止打印/导出。
   */
  async cookieHeaderForAll(url: string, incognito?: boolean): Promise<string> {
    if (!originAllowed(url)) return '';
    const parts = parseSchoolUrl(url);
    if (parts === null) return '';
    const useIncognito: boolean = incognito === undefined ? this.incognito : incognito;
    try {
      const all = await webview.WebCookieManager.fetchAllCookies(useIncognito);
      if (!Array.isArray(all) || all.length === 0) return '';
      const pairs: string[] = [];
      for (const cookie of all) {
        if (typeof cookie.name !== 'string' || cookie.name.length === 0) continue;
        if (typeof cookie.value !== 'string') continue;
        if (!cookieDomainMatches(cookie.domain, parts.host)) continue;
        if (!cookiePathMatches(cookie.path, parts.path)) continue;
        pairs.push(cookie.name + '=' + cookie.value);
      }
      return pairs.join('; ');
    } catch (error) {
      return '';
    }
  }

  async contains(url: string, name: string, incognito?: boolean): Promise<boolean> {
    if (typeof name !== 'string' || name.length === 0) return false;
    const header: string = await this.cookieHeaderFor(url, incognito);
    return hasCookieName(header, name);
  }

  async clearSchoolCookies(): Promise<boolean> {
    let cleared: boolean = false;
    for (const target of SCHOOL_COOKIE_CLEAR_TARGETS) {
      try {
        await webview.WebCookieManager.configCookie(target, EXPIRED_SESSION_COOKIE);
        cleared = true;
      } catch (error) {
        // 个别版本要求 cookie 串带 Domain/Path 才能覆盖；失败时保留其余 origin 的尝试。
      }
    }
    return cleared;
  }

  // SSO 换票成功后把新的 bzb_jsxsd 写回 jar，之后编排层重读到的才是新票。
  // 只写教务域的两个 /jsxsd 目标；Set-Cookie 里不是会话 cookie 的全部丢弃。
  async applySessionCookies(setCookies: string[]): Promise<boolean> {
    if (!Array.isArray(setCookies) || setCookies.length === 0) return false;
    let applied: boolean = false;
    for (const raw of setCookies) {
      const cookie: string = sessionCookieOnly(raw);
      if (cookie.length === 0) continue;
      for (const target of SCHOOL_COOKIE_CLEAR_TARGETS) {
        try {
          await webview.WebCookieManager.configCookie(target, cookie);
          applied = true;
        } catch (error) {
          // 个别 origin（如 http 页面上的 Secure cookie）可能被拒，保留其它目标的写入结果。
        }
      }
    }
    return applied;
  }
}
