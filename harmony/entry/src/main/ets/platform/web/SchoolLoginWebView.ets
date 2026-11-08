/**
 * 学校统一身份认证登录 WebView（P4 79c，规格 §3.1/§6.2）。
 * 职责：加载 SSO 入口、按白名单拦截导航、判定 CAS 登录/验证码页、成功后保存学校会话并回调。
 * 安全口径：只经 WebCookieStore 读写 cookie；cookie 不交给页面 JS、不写日志、不展示；
 *           URL 可能含 ticket，只保存在内存 currentUrl，不落日志/界面；日志只写 Redactor 白名单字段。
 * 依赖方向：platform/web -> core/parser + platform/school + platform/session + data 契约；pages 只传回调。
 */
import webview from '@ohos.web.webview';
import type { common } from '@kit.AbilityKit';
import type { SchoolLexicon } from '../../core/parser/SchoolLexicon';
import { isCaptchaPage, isLoginPage } from '../../core/parser/JsxsdParser';
import { SSO_ENTRY, CAS_LOGIN, CAS_SERVICE_URL, JIAOWU_HTTP, JIAOWU_SESSION_URL, parseSchoolUrl } from '../../core/parser/SchoolUrls';
import { ErrorCode } from '../../core/types/Common';
import type { SchoolSession } from '../../core/types/Leave';
import { logFields, redactLine, redactUrl } from '../../util/Redactor';
import { detectWebPageIssue, isSchoolLoginSuccessParts, planLoginCapture } from '../../core/viewmodel/WebEntryViewModel';
import type { LoginCapturePlan, LoginCaptureSources, WebPageIssue } from '../../core/viewmodel/WebEntryViewModel';
import { SCHOOL_SESSION_COOKIE_NAME, SCHOOL_SESSION_DOMAIN, extractSessionCookie } from '../../data/SchoolSessionStore';
import { extractTicketGrantingCookie, SCHOOL_TICKET_DOMAIN } from '../../data/SchoolTicketStore';
import { createSchoolTicketStore } from '../session/SchoolTicketStoreImpl';
import type { SchoolSessionStore } from '../../data/SchoolSessionStore';
import { Logger } from '../../util/Logger';
import { SchoolUrlPolicy } from './SchoolUrlPolicy';
import { PlatformWebCookieStore } from './WebCookieStore';
import { createSchoolLexicon } from '../school/ParserLexiconFactory';
import { createSchoolSessionStore } from '../session/SchoolSessionStoreImpl';

const LOGIN_LOAD_TIMEOUT_MS: number = 30000;
const LOGIN_HTML_SCRIPT: string = 'document.documentElement.outerHTML';
// bzb_jsxsd 的 Path=/jsxsd，按 8080 根路径 fetchCookie 可能读不到；
// 先按 JIAOWU_SESSION_URL（/jsxsd/）读，空时再退回 JIAOWU_HTTP 根路径（保留旧行为作兜底）。

/** 登录入口固定为 SSO，不拼 service、不带账号密码。 */
export function schoolSsoEntryUrl(): string {
  return SSO_ENTRY;
}

/** Web 能力探测；pages 不直接 import @kit，只调本门面。 */
export function schoolWebAvailable(): boolean {
  return canIUse('SystemCapability.Web.Webview.Core');
}

/** 学期名兜底：首读没有历史快照时避免 snapshot.name 落成学期号（§6.1 卡片/课表标题使用）。 */
export function schoolSemesterFallback(context: object): string {
  try {
    const ability: common.UIAbilityContext = context as common.UIAbilityContext;
    return ability.resourceManager.getStringSync($r('app.string.school_semester_name').id);
  } catch (error) {
    return '';
  }
}

/** 由开学周一推导「2026-2027学年第一学期」；日期不合法时回退 fallback。 */
export function schoolSemesterDisplayName(context: object, startDate: string, fallback: string): string {
  const parts: string[] = startDate.split('-');
  if (parts.length !== 3 || parts[0].length !== 4 || parts[1].length !== 2) {
    return fallback;
  }
  const year: number = Number(parts[0]);
  const month: number = Number(parts[1]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return fallback;
  }
  const firstTerm: boolean = month >= 8;
  const startYear: number = firstTerm ? year : year - 1;
  try {
    const ability: common.UIAbilityContext = context as common.UIAbilityContext;
    const suffix: string = ability.resourceManager.getStringSync($r('app.string.school_semester_year_suffix').id);
    let term: string = '';
    if (firstTerm) {
      term = ability.resourceManager.getStringSync($r('app.string.school_semester_term_first').id);
    } else {
      term = ability.resourceManager.getStringSync($r('app.string.school_semester_term_second').id);
    }
    return String(startYear) + '-' + String(startYear + 1) + suffix + term;
  } catch (error) {
    return fallback;
  }
}

/** 读取上次保存的学校会话（供设置卡恢复「已登录/未登录」）。 */
export async function loadStoredSchoolSession(context: object): Promise<SchoolSession | null> {
  try {
    const store: SchoolSessionStore = await createSchoolSessionStore(context as common.UIAbilityContext);
    return await store.load();
  } catch (error) {
    Logger.warn(JSON.stringify(logFields({ stage: 'session-check', code: 'SESSION_LOAD_FAILED' })));
    return null;
  }
}

/** 由保存的学校会话创建会话存储（页面装配只用本门面，不接触 @kit 类型）。 */
export async function openSchoolSessionStore(context: object): Promise<SchoolSessionStore> {
  return createSchoolSessionStore(context as common.UIAbilityContext);
}

/**
 * 清除上次保存的学校会话（P1-1：读到 SCHOOL_SESSION_EXPIRED 时由页面调用，只清教务域会话）。
 * 返回 true 表示存储层确认已清空；失败只记脱敏日志，不阻断页面的错误态展示。
 */
export async function clearStoredSchoolSession(context: object): Promise<boolean> {
  try {
    const store: SchoolSessionStore = await createSchoolSessionStore(context as common.UIAbilityContext);
    await store.clear();
    return true;
  } catch (error) {
    Logger.warn(JSON.stringify(logFields({ stage: 'session-check', code: 'SESSION_CLEAR_FAILED' })));
    return false;
  }
}

@Component
export struct SchoolLoginWebView {
  entryUrl: string = SSO_ENTRY;
  onSuccess: () => void = () => {};
  onWebError: (code: string) => void = () => {};
  onPageNotice: (kind: string) => void = () => {};

  private controller: webview.WebviewController = new webview.WebviewController();
  private policy: SchoolUrlPolicy = new SchoolUrlPolicy();
  private currentUrl: string = '';
  private serviceHint: string = '';

  /** login page only treats the fixed CAS service as the expected service. */
  private serviceIsExpected(): boolean {
    const raw: string | null = this.policy.serviceParam(this.currentUrl);
    if (raw === null || raw.length === 0) return false;
    try {
      return decodeURIComponent(raw) === CAS_SERVICE_URL;
    } catch (error) {
      return false;
    }
  }
  private loadTimer: number = -1;
  private successPending: boolean = false;
  private finished: boolean = false;
  private lastHttpStatus: number = 200;
  // 分层采集结果只留在内存，禁止进日志/快照/UI。请求头层按名提取后立即丢弃原文。
  private requestSessionCookie: string = '';
  private requestTgc: string = '';
  private fetchedCookieHeader: string = '';
  private allCookieHeader: string = '';
  private fetchedCasCookie: string = '';
  private allCasCookie: string = '';
  private fetchedCookiePresent: boolean = false;

  aboutToAppear(): void {
    this.startLoadTimer();
  }

  aboutToDisappear(): void {
    this.clearLoadTimer();
  }

  private startLoadTimer(): void {
    this.clearLoadTimer();
    this.loadTimer = setTimeout(() => {
      this.fail('SCHOOL_TIMEOUT');
    }, LOGIN_LOAD_TIMEOUT_MS);
  }

  private clearLoadTimer(): void {
    if (this.loadTimer >= 0) {
      clearTimeout(this.loadTimer);
      this.loadTimer = -1;
    }
  }

  private fail(code: string): void {
    if (this.finished || this.successPending) {
      return;
    }
    this.finished = true;
    this.clearLoadTimer();
    Logger.warn(JSON.stringify(logFields({ stage: 'session-check', code: code })));
    this.onWebError(code);
  }

  /** onPageEnd 可能拿不到 event.url，用 controller 的最终 URL 兜底；不写日志原文。 */
  private resolvedUrl(): string {
    try {
      const current: string = this.controller.getUrl();
      if (typeof current === 'string' && current.length > 0) return current;
    } catch (error) {
      // 回落到 onPageBegin 记录的 URL。
    }
    return this.currentUrl;
  }

  private pageTitle(): string {
    try {
      return this.controller.getTitle();
    } catch (error) {
      return '';
    }
  }

  private logPageEnd(): void {
    const title: string = this.pageTitle();
    Logger.info(JSON.stringify(logFields({
      stage: 'session-check',
      code: 'school-web page-end url=' + redactUrl(this.resolvedUrl()) + ' title=' + redactLine(title),
      httpStatus: this.lastHttpStatus
    })));
  }

  private logPageIssue(issue: WebPageIssue): void {
    Logger.info(JSON.stringify(logFields({
      stage: 'session-check',
      code: 'school-web page-error kind=' + issue + ' url=' + redactUrl(this.currentUrl) +
        ' title=' + redactLine(this.pageTitle()),
      httpStatus: this.lastHttpStatus
    })));
  }

  /**
   * 第一层：fetchCookie（HttpOnly 是否可读待真机）+ API 23 fetchAllCookies 兜底。
   * 只把结果留在内存，绝不写日志；后续由 planLoginCapture 决定取哪一层。
   */
  private async captureCookieLayers(): Promise<void> {
    try {
      // 登录 WebView 为无痕模式，必须按 incognito 读取内存 jar；
      // 登录成功后仅把 bzb_jsxsd 写入沙箱会话（见 SchoolSessionStoreImpl），不回写普通 cookie jar。
      const cookies: PlatformWebCookieStore = new PlatformWebCookieStore(true);
      this.fetchedCookieHeader = await cookies.cookieHeaderFor(JIAOWU_SESSION_URL);
      if (this.fetchedCookieHeader.length === 0) {
        this.fetchedCookieHeader = await cookies.cookieHeaderFor(JIAOWU_HTTP);
      }
      this.allCookieHeader = await cookies.cookieHeaderForAll(JIAOWU_SESSION_URL);
      if (this.allCookieHeader.length === 0) {
        this.allCookieHeader = await cookies.cookieHeaderForAll(JIAOWU_HTTP);
      }
      this.fetchedCookiePresent = extractSessionCookie(this.fetchedCookieHeader).length > 0;
      if (!this.fetchedCookiePresent) {
        this.fetchedCookiePresent = await cookies.contains(JIAOWU_HTTP, SCHOOL_SESSION_COOKIE_NAME);
      }
      this.fetchedCasCookie = await cookies.cookieHeaderFor(CAS_LOGIN);
      this.allCasCookie = await cookies.cookieHeaderForAll(CAS_LOGIN);
    } catch (error) {
      // 单层失败不阻断登录成功判定；缺失的层会由 planLoginCapture 回落到下一层/none。
    }
  }

  private async completeLogin(): Promise<void> {
    if (this.finished) {
      return;
    }
    this.successPending = true;
    try {
      await this.captureCookieLayers();
      const sources: LoginCaptureSources = {
        sessionFromRequestHeader: this.requestSessionCookie,
        sessionFromFetchCookie: extractSessionCookie(this.fetchedCookieHeader),
        sessionFromAllCookies: extractSessionCookie(this.allCookieHeader),
        tgcFromRequestHeader: this.requestTgc,
        tgcFromFetchCookie: extractTicketGrantingCookie(this.fetchedCasCookie),
        tgcFromAllCookies: extractTicketGrantingCookie(this.allCasCookie)
      };
      // 成功判定只依赖 onPageEnd 的 URL 命中（page-url），不依赖 cookie 是否可读；
      // 三层都拿不到 bzb_jsxsd 时仍视为登录成功，但本次会话无法保存，静默重登降级。
      const plan: LoginCapturePlan = planLoginCapture(true, sources);
      const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
      let sessionSaved: boolean = false;
      if (plan.sessionCookie.length > 0) {
        try {
          const store: SchoolSessionStore = await createSchoolSessionStore(context);
          const session: SchoolSession = {
            cookieHeader: plan.sessionCookie,
            updatedAt: Date.now(),
            domain: SCHOOL_SESSION_DOMAIN
          };
          await store.save(session);
          sessionSaved = true;
        } catch (sessionError) {
          // 会话落盘失败只降级为“下次需要重新登录”，不改变本次登录成功结论。
          Logger.info(JSON.stringify(logFields({ stage: 'session-check', code: 'session-save-failed' })));
        }
      } else {
        Logger.info(JSON.stringify(logFields({ stage: 'session-check', code: 'session-capture miss layer=none' })));
      }
      // 无痕 jar 重启即丢，登录成功时把 CAS 域 TGC 另存到自有沙箱文件，供静默重登回落。
      // TGC 等价凭据：只经 createSchoolTicketStore 写入私有目录，不打印、不导出；失败不影响本次登录。
      if (plan.tgc.length > 0) {
        try {
          const ticketStore = await createSchoolTicketStore(context);
          await ticketStore.save({ cookieHeader: plan.tgc, updatedAt: Date.now(), domain: SCHOOL_TICKET_DOMAIN });
          Logger.info(JSON.stringify(logFields({ stage: 'session-check', code: 'TICKET_SAVED' })));
        } catch (ticketError) {
          Logger.info(JSON.stringify(logFields({ stage: 'session-check', code: 'TICKET_SAVE_FAILED' })));
        }
      } else {
        // 精确口径：只记录降级层级，不记录任何 cookie/TGC 值。
        Logger.info(JSON.stringify(logFields({ stage: 'session-check', code: 'tgc-capture miss layer=none' })));
      }
      this.finished = true;
      this.clearLoadTimer();
      const requestHit: boolean = this.requestSessionCookie.length > 0 || this.requestTgc.length > 0;
      const allHit: boolean = extractSessionCookie(this.allCookieHeader).length > 0 ||
        extractTicketGrantingCookie(this.allCasCookie).length > 0;
      Logger.info(JSON.stringify(logFields({
        stage: 'session-check',
        code: 'login-success layer=' + plan.successLayer + ' session=' + plan.sessionLayer + ' tgc=' + plan.tgcLayer +
          ' fetch=' + String(this.fetchedCookiePresent) + ' request=' + String(requestHit) +
          ' all=' + String(allHit),
        sessionPresent: sessionSaved
      })));
      this.onSuccess();
    } catch (error) {
      this.successPending = false;
      this.fail('SCHOOL_LOGIN_REQUIRED');
    }
  }

  private async classifyPage(): Promise<void> {
    if (this.finished || this.successPending) {
      return;
    }
    let html: string = '';
    try {
      html = await this.controller.runJavaScript(LOGIN_HTML_SCRIPT);
    } catch (error) {
      return;
    }
    if (typeof html !== 'string' || html.length === 0) {
      return;
    }
    const issue: WebPageIssue = detectWebPageIssue(this.pageTitle(), html.slice(0, 8000), this.lastHttpStatus);
    if (issue !== 'none') {
      this.logPageIssue(issue);
      this.fail(ErrorCode.WEB_UNAVAILABLE);
      return;
    }
    let lexicon: SchoolLexicon;
    try {
      lexicon = createSchoolLexicon(getContext(this));
    } catch (error) {
      return;
    }
    // 判定顺序：登录页优先、验证码页其次；同页并存按登录页提示（§3.1 裁定）。
    if (isLoginPage(html, lexicon)) {
      this.onPageNotice('login');
      return;
    }
    if (isCaptchaPage(html, lexicon)) {
      this.onPageNotice('captcha');
    }
  }

  private onPageFinished(): void {
    if (this.finished || this.successPending) {
      return;
    }
    this.clearLoadTimer();
    this.logPageEnd();
    const pageUrl: string = this.resolvedUrl();
    // 第三层：URL 命中教务框架/课表页即登录成功，不依赖 cookie 是否可读。
    const parts = parseSchoolUrl(pageUrl);
    if (parts !== null && isSchoolLoginSuccessParts(parts.scheme, parts.host, parts.port, parts.path)) {
      this.completeLogin();
      return;
    }
    this.classifyPage();
  }

  /**
   * 被拦截的导航只记 reason/scheme/host/port（redact 白名单字段在前，URL 放最后），
   * 不记录 ticket 原值。ArkWeb WebResourceRequest 的官方方法是 isRedirect()；
   * 设备日志里的服务端重定向字段是 Chromium 日志字段，不是 ArkTS API，不能调用。
   */
  private logBlockedIntercept(target: string, reason: string, mainFrame: boolean, redirected: boolean): void {
    const parts = parseSchoolUrl(target);
    const scheme: string = parts === null ? 'unsupported' : parts.scheme;
    const host: string = parts === null ? '-' : parts.host;
    const port: string = parts === null ? '-' : String(parts.port);
    Logger.info(JSON.stringify(logFields({
      stage: 'session-check',
      code: 'school-web blocked reason=' + reason + ' scheme=' + scheme + ' host=' + host +
        ' port=' + port + ' main=' + String(mainFrame) + ' redirect=' + String(redirected) +
        ' url=' + redactUrl(target)
    })));
  }

  build() {
    Web({ src: this.entryUrl, controller: this.controller, incognitoMode: true })
      .width('100%')
      .layoutWeight(1)
      .javaScriptAccess(true)
      .domStorageAccess(true)
      .enableAutoFill(false)
      .onLoadIntercept((event) => {
        const target: string = event.data.getRequestUrl();
        const allowed: boolean = this.policy.isAllowed(target);
        const mainFrame: boolean = event.data.isMainFrame();
        const redirected: boolean = event.data.isRedirect();
        // 只有主帧服务端重定向才走“同校 origin 不限 path”的宽松规则；
        // 普通导航仍必须过严格 path 矩阵。真实 CAS 回跳是
        // http://jiaowu.juwp.edu.cn/sso.jsp?ticket=...（http:80），由该规则放行；跨域仍拦。
        const redirectAllowed: boolean = mainFrame && redirected && this.policy.isAllowedRedirect(target);
        if (!allowed && !redirectAllowed) {
          this.logBlockedIntercept(target, this.policy.blockReason(target), mainFrame, redirected);
          this.fail(ErrorCode.WEB_UNAVAILABLE);
          return true;
        }
        if (mainFrame && redirected) {
          Logger.info(JSON.stringify(logFields({
            stage: 'session-check',
            code: 'school-web redirect allowed rule=' + (allowed ? 'strict' : 'redirect') +
              ' url=' + redactUrl(target)
          })));
        }
        // 第二层：主框架请求头里的 Cookie 只按名提取 bzb_jsxsd/TGC 到内存，
        // 原文立即丢弃；不打印、不写 state、不交给页面 JS。
        if (mainFrame) {
          try {
            const headers = event.data.getRequestHeader();
            for (const header of headers) {
              if (header.headerKey.toLowerCase() !== 'cookie') continue;
              const sessionCookie: string = extractSessionCookie(header.headerValue);
              if (sessionCookie.length > 0) this.requestSessionCookie = sessionCookie;
              const tgc: string = extractTicketGrantingCookie(header.headerValue);
              if (tgc.length > 0) this.requestTgc = tgc;
            }
          } catch (headerError) {
            // 读不到请求头只表示该层不可用，继续走 cookie jar 与 URL 层。
          }
        }
        return false;
      })
      .onPageBegin((event) => {
        this.lastHttpStatus = 200;
        if (event !== undefined) {
          this.currentUrl = event.url;
          this.serviceHint = this.serviceIsExpected() ? 'service' : '';
          if (this.serviceHint.length > 0 && !this.finished) {
            this.onPageNotice('login');
          }
        }
        this.startLoadTimer();
      })
      .onPageEnd(() => {
        this.onPageFinished();
      })
      .onHttpErrorReceive((event) => {
        if (event !== undefined) {
          const main: boolean = event.request.isMainFrame();
          const status: number = event.response.getResponseCode();
          if (main) { this.lastHttpStatus = status; }
          Logger.info(JSON.stringify(logFields({
            stage: 'session-check',
            code: 'school-web http-error main=' + String(main) + ' url=' + redactUrl(event.request.getRequestUrl()),
            httpStatus: status
          })));
        }
      })
      .onErrorReceive((event) => {
        if (event !== undefined) {
          Logger.info(JSON.stringify(logFields({
            stage: 'session-check',
            code: 'school-web error main=' + String(event.request.isMainFrame()) + ' code=' +
              String(event.error.getErrorCode()) + ' info=' + redactLine(event.error.getErrorInfo())
          })));
        }
        this.clearLoadTimer();
        this.fail('SCHOOL_NETWORK_FAILED');
      })
  }
}
