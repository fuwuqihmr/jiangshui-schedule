// 职责：通用 HTTP 网关（P4 79b，规格 §2.1）。
// 依赖方向：platform/network -> @kit.NetworkKit；页面不得 import 本层的 Kit。
// 阶段：P4；基于 @ohos.net.http（API 12）的最小封装，只返回状态码与文本体。
// 安全口径：不打印请求/响应头、Cookie 与响应体；不自动持久化 Set-Cookie；
//           Cookie 由调用方显式放进 headers；超时/网络/HTTP 非 200 统一抛 HttpError{code}。
// 重定向：API 12 的 HttpRequestOptions 字段表里没有 followRedirects（只到 certificatePinning），
//          所以本层不依赖平台自动跟随，而是自己处理 301/302/303/307/308：只有调用方显式给出
//          allowedRedirectOrigins 白名单才跟随；白名单键是完整 origin scheme://host[:port]
//          （P1-A round 3，scheme 精确比对，禁止 HTTPS→HTTP 降级），首跳 URL 与每一跳 Location
//          都要命中白名单，最多 5 跳；否则抛 SCHOOL_NETWORK_FAILED（日志只记跳数与 origin，
//          不含完整 URL/query）。
// 安全（P1-A）：origin 解析采用保守白名单——反斜杠/控制字符/百分号编码/userinfo/非法 host/端口
//          一律判为“取不到 host”（白名单不通过）。任何 origin 变化（含同 host 换 scheme）都不
//          转发任何请求头，Cookie / Referer / Origin 一并清掉，避免把教务会话泄露给重定向目标。
//          待官方文档确认：若运行时底层仍自动跟随（错误码 2300047“重定向次数达到上限”暗示
//          libcurl 可能默认跟随），本层的手动分支就不会触发，白名单也看不到中间跳，需真机抓包复核。
// 取消：HttpRequest.destroy() 官方文档为“中断请求任务”，abortAll() 用它断开在途请求；
//          取消后本实例标记为不可用（页面每次读取新建一个网关）。
import { http } from '@kit.NetworkKit';
import { Logger } from '../../util/Logger';
import { canonicalHostOf, canonicalOriginOf, isRedirectHostAllowed } from '../../core/network/RedirectPolicy';

export type HttpMethod = 'GET' | 'POST';

export interface HttpRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** 显式给出时才允许跟随 3xx；未给 = 不跟随（旧行为：抛 HTTP_3xx）。
   *  条目必须是完整 origin（scheme://host[:port]），scheme 参与比对；不接受通配。 */
  allowedRedirectOrigins?: string[];
  /** 单次请求可提高 3xx 跟随上限（默认 MAX_REDIRECTS=5）；CAS 换票链需要 6-8 跳。
   *  只影响本请求；origin 白名单仍逐跳校验，不能借它放宽白名单。 */
  maxRedirects?: number;
}

/** One followed 3xx hop : used to inspect the CAS Location before the cookie jar changes. */
export interface HttpRedirect {
  status: number;
  url: string;
}

export interface HttpResponse {
  status: number;
  body: string;
  finalUrl: string;
  bytes: number;
  durationMs: number;
  /**
   * 本次请求（含手动跟随的重定向各跳）收到的 Set-Cookie 原文列表。
   * 只供平台层 SSO 换票把新的 bzb_jsxsd 写回 WebCookieManager；本层不持久化、不打印、不写状态。
   */
  setCookies: string[];
  /** followed 3xx hops, in order; used by CAS relogin to inspect the ticket-bearing Location. */
  redirects?: HttpRedirect[];
}

export interface HttpGateway {
  request(request: HttpRequest): Promise<HttpResponse>;
}

export class HttpError extends Error {
  code: string;

  constructor(code: string, detail: string) {
    super(detail.length > 0 ? code + ': ' + detail : code);
    this.name = 'HttpError';
    this.code = code;
  }
}

export const NETWORK_UNAVAILABLE: string = 'NETWORK_UNAVAILABLE';
/** 中性取消码：不是业务错误，页面按 token 丢弃即可，不写 snapshot/lastSuccess。 */
export const CANCELLED: string = 'CANCELLED';

const DEFAULT_TIMEOUT_MS: number = 20000;
const CONNECT_TIMEOUT_MS: number = 8000;
const READ_TIMEOUT_MS: number = 12000;
const DEFAULT_MAX_BYTES: number = 2000000;
const MAX_REDIRECTS: number = 5;

function readPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.trunc(value);
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

// P1-A：origin 规范化与白名单比较提取到 core/network/RedirectPolicy（纯逻辑、无 Kit），
// 这样 rules 可被 Node 侧用例直接覆盖，platform 只负责“跟随/不跟随”。
// 规则见该文件的 canonicalHostOf / canonicalOriginOf：反斜杠/控制字符/百分号/userinfo/非法 host
// 一律判为不可跟随；白名单键是 scheme://host[:port]，scheme 变化（含同 host）一律清空请求头。

/** 把 Location 解析成绝对 URL（支持绝对地址、绝对路径、查询串与相对路径）。 */
function resolveLocation(baseUrl: string, location: string): string {
  const target: string = location.trim();
  if (target.length === 0) return '';
  const lowerTarget: string = target.toLowerCase();
  if (lowerTarget.indexOf('http://') === 0 || lowerTarget.indexOf('https://') === 0) {
    return target;
  }
  const schemeEnd: number = baseUrl.indexOf('://');
  if (schemeEnd < 0) return '';
  const pathStart: number = baseUrl.indexOf('/', schemeEnd + 3);
  const origin: string = pathStart < 0 ? baseUrl : baseUrl.substring(0, pathStart);
  let basePath: string = pathStart < 0 ? '/' : baseUrl.substring(pathStart);
  const query: number = basePath.indexOf('?');
  if (query >= 0) basePath = basePath.substring(0, query);
  const fragment: number = basePath.indexOf('#');
  if (fragment >= 0) basePath = basePath.substring(0, fragment);
  if (target.charAt(0) === '/') {
    return origin + target;
  }
  if (target.charAt(0) === '?') {
    return origin + basePath + target;
  }
  const cut: number = basePath.lastIndexOf('/');
  const dir: string = cut < 0 ? '/' : basePath.substring(0, cut + 1);
  return origin + dir + target;
}

/**
 * 从 response.header 里取 Location。header 的类型是 Object，ArkTS 不允许动态属性访问，
 * 所以用 JSON 文本 + 大小写无关正则读取（只取单值头，够本场景用）。
 */
function locationFrom(header: Object): string {
  try {
    const text: string = JSON.stringify(header);
    if (typeof text !== 'string' || text.length === 0) return '';
    const match: RegExpMatchArray | null = text.match(/"location"\s*:\s*"([^"]*)"/i);
    if (match === null) return '';
    return match[1];
  } catch (error) {
    return '';
  }
}

/**
 * 从 response.header 里取 Set-Cookie（SSO 换票用）。
 * header 类型是 Object，ArkTS 禁止动态属性访问，与 locationFrom 一样走 JSON 文本 + 大小写无关匹配；
 * 兼容单值字符串与数组两种形态。cookie 值里出现引号属于异常站点行为，按“没有该条”跳过。
 */
function setCookiesFrom(header: Object): string[] {
  const result: string[] = [];
  try {
    const text: string = JSON.stringify(header);
    if (typeof text !== 'string' || text.length === 0) return result;
    const singles: RegExpMatchArray | null = text.match(/"set-cookie"\s*:\s*"[^"]*"/gi);
    if (singles !== null) {
      for (const single of singles) {
        const cut: number = single.indexOf(':"');
        if (cut < 0) continue;
        const value: string = single.substring(cut + 2, single.length - 1);
        if (value.length > 0) result.push(value);
      }
    }
    const arrays: RegExpMatchArray | null = text.match(/"set-cookie"\s*:\s*\[[^\]]*\]/gi);
    if (arrays !== null) {
      for (const arrayText of arrays) {
        const items: RegExpMatchArray | null = arrayText.match(/"[^"]*"/g);
        if (items === null) continue;
        for (const item of items) {
          const value: string = item.substring(1, item.length - 1);
          if (value.length > 0) result.push(value);
        }
      }
    }
  } catch (error) {
    // 解析失败按“本轮没有 Set-Cookie”处理，不打断请求。
  }
  return result;
}

interface HttpAttempt {
  status: number;
  body: string;
  bytes: number;
  location: string;
  setCookies: string[];
}

export class NetworkHttpGateway implements HttpGateway {
  private clients: http.HttpRequest[] = [];
  private cancelled: boolean = false;

  /**
   * 断开当前在途请求（P1-6）。destroy() 在官方文档里的说明是“中断请求任务”，
   * 待官方文档确认：请求进行中调用 destroy 的具体错误码与回调时序以真机为准。
   */
  abortAll(): void {
    this.cancelled = true;
    const pending: http.HttpRequest[] = this.clients;
    this.clients = [];
    for (const client of pending) {
      try {
        client.destroy();
      } catch (error) {
        // 已结束的请求重复 destroy 可能抛错，忽略。
      }
    }
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    const maxBytes: number = readPositive(request.maxBytes, DEFAULT_MAX_BYTES);
    const allowed: string[] = request.allowedRedirectOrigins !== undefined ? request.allowedRedirectOrigins : [];
    const maxRedirects: number = readPositive(request.maxRedirects, MAX_REDIRECTS);
    const startedAt: number = Date.now();
    let currentUrl: string = request.url;
    // 安全（P1-A）：当前跳要带的请求头。首跳原样；origin 变化（含换 scheme）后换成空表。
    let currentHeaders: Record<string, string> = request.headers;
    let hop: number = 0;
    // 跨跳累积 Set-Cookie，供 SSO 换票把新的 bzb_jsxsd 写回 WebCookieManager。
    let collectedCookies: string[] = [];
    // 记录已经跟随的 3xx 跳（只保留状态与目标 URL，供 CAS 换票判断 ticket）。
    const redirects: HttpRedirect[] = [];
    try {
      if (canonicalHostOf(currentUrl).length === 0) {
        throw new HttpError('SCHOOL_NETWORK_FAILED', 'invalid request url');
      }
      // P1-A round 3：首跳也必须命中同一份 origin 白名单，不能只校验“跳转目标”，
      // 否则调用方传进来的任意 URL（含 http 降级）都会被当成合法起点。
      if (allowed.length > 0 && !isRedirectHostAllowed(currentUrl, allowed)) {
        Logger.warn('http request blocked origin=' + canonicalOriginOf(currentUrl));
        throw new HttpError('SCHOOL_NETWORK_FAILED', 'request url not allowed');
      }
      for (;;) {
        if (this.cancelled) {
          throw new HttpError(CANCELLED, 'aborted');
        }
        const attempt: HttpAttempt = await this.send(currentUrl, request, currentHeaders);
        if (attempt.setCookies.length > 0) {
          collectedCookies = collectedCookies.concat(attempt.setCookies);
        }
        if (attempt.status !== 200) {
          if (isRedirectStatus(attempt.status) && allowed.length > 0) {
            // 默认上限保持 5（既有契约）；调用方显式给 maxRedirects 时使用更宽的请求级上限。
            if (request.maxRedirects === undefined && hop >= MAX_REDIRECTS) {
              throw new HttpError(NETWORK_UNAVAILABLE, 'too many redirects');
            }
            if (hop >= maxRedirects) {
              throw new HttpError(NETWORK_UNAVAILABLE, 'too many redirects');
            }
            const next: string = resolveLocation(currentUrl, attempt.location);
            if (next.length === 0) {
              throw new HttpError(NETWORK_UNAVAILABLE, 'redirect without location');
            }
            if (!isRedirectHostAllowed(next, allowed)) {
              // 脱敏：只记跳数与 origin（scheme://host[:port]），不记完整 URL/query
              // （Logger 内还会再走一次 redactLine）。
              Logger.warn('http redirect blocked hop=' + String(hop + 1) + ' origin=' + canonicalOriginOf(next));
              throw new HttpError('SCHOOL_NETWORK_FAILED', 'redirect host not allowed');
            }
            if (canonicalOriginOf(next) !== canonicalOriginOf(currentUrl)) {
              // 安全（P1-A round 3）：只要 origin 变了——包括同 host 换 scheme（http→https）与
              // 跨 host——就不转发任何请求头：Cookie / Referer / Origin 一并清掉，
              // 避免把教务会话泄露给重定向目标或降级链路。ArkTS 禁止动态删属性，直接换空表。
              currentHeaders = {};
            }
            redirects.push({ status: attempt.status, url: next });
            hop = hop + 1;
            currentUrl = next;
            continue;
          }
          throw new HttpError('HTTP_' + String(attempt.status), '');
        }
        if (attempt.bytes > maxBytes) {
          throw new HttpError('SCHOOL_NETWORK_FAILED', 'response exceeds limit');
        }
        const result: HttpResponse = {
          status: attempt.status,
          body: attempt.body,
          finalUrl: currentUrl,
          bytes: attempt.bytes,
          durationMs: Date.now() - startedAt,
          setCookies: collectedCookies,
          redirects: redirects
        };
        return result;
      }
    } catch (error) {
      if (this.cancelled) {
        throw new HttpError(CANCELLED, 'aborted');
      }
      if (error instanceof HttpError) throw error;
      const message: string = error instanceof Error ? error.message : '';
      const lower: string = message.toLowerCase();
      if (lower.indexOf('timeout') >= 0 || lower.indexOf('timed out') >= 0) {
        throw new HttpError('SCHOOL_TIMEOUT', '');
      }
      throw new HttpError('SCHOOL_NETWORK_FAILED', '');
    }
  }

  private async send(url: string, request: HttpRequest, headers: Record<string, string>): Promise<HttpAttempt> {
    const timeoutMs: number = readPositive(request.timeoutMs, DEFAULT_TIMEOUT_MS);
    const connectTimeout: number = timeoutMs < CONNECT_TIMEOUT_MS ? timeoutMs : CONNECT_TIMEOUT_MS;
    const readTimeout: number = timeoutMs < READ_TIMEOUT_MS ? timeoutMs : READ_TIMEOUT_MS;
    const client: http.HttpRequest = http.createHttp();
    this.clients.push(client);
    try {
      const options: http.HttpRequestOptions = {
        method: request.method === 'POST' ? http.RequestMethod.POST : http.RequestMethod.GET,
        header: headers,
        extraData: request.body,
        connectTimeout: connectTimeout,
        readTimeout: readTimeout,
        expectDataType: http.HttpDataType.STRING,
        usingCache: false
      };
      const response: http.HttpResponse = await client.request(url, options);
      const body: string = this.resultText(response.result);
      const attempt: HttpAttempt = {
        status: response.responseCode,
        body: body,
        bytes: body.length,
        location: locationFrom(response.header),
        setCookies: setCookiesFrom(response.header)
      };
      return attempt;
    } finally {
      const index: number = this.clients.indexOf(client);
      if (index >= 0) {
        this.clients.splice(index, 1);
      }
      try {
        client.destroy();
      } catch (error) {
        // 取消路径可能已 destroy 过，重复销毁忽略。
      }
    }
  }

  private resultText(result: string | Object | ArrayBuffer): string {
    if (typeof result === 'string') return result;
    return '';
  }
}
