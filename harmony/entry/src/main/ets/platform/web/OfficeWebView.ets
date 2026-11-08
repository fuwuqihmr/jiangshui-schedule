// 职责：教务/学工网页容器：Web 组件 + 白名单二次校验 + 降级复制链接。
// 依赖方向：platform -> core/viewmodel + platform/clipboard；pages 只传 url 与回调。
// 阶段：P3/P4；API 26 下 webview 为 @ohos.web.webview 的默认导出（非具名导出），故用 default import。
// 增补：refreshToken 由页面自增触发重载申请页并清掉“同一 URL 不重复抓取”的标记，
//              实现手动刷新；重载失败通过 onStateChange('error') 让页面显示可见错误。
import webview from '@ohos.web.webview';
import { copyText } from '../clipboard/ClipboardGateway';
import { decideOfficeNav, detectWebPageIssue, isAllowedWebUrl, XGXT_ORIGIN } from '../../core/viewmodel/WebEntryViewModel';
import type { WebPageIssue } from '../../core/viewmodel/WebEntryViewModel';
import { PlatformWebCookieStore } from './WebCookieStore';
import { redactLine, redactUrl } from '../../util/Redactor';
import { Logger } from '../../util/Logger';
import type { WebCookieStore } from './WebCookieStore';
import { MemoryOfficeSessionStore, isOfficeApplyUrl } from '../../data/OfficeSessionStore';
import { createSchoolLexicon } from '../school/ParserLexiconFactory';
import { OfficeWebSessionImpl } from './OfficeWebSessionImpl';
import type { SchoolLexicon } from '../../core/parser/SchoolLexicon';
import { ErrorCode } from '../../core/types/Common';
import type { LeaveRecord } from '../../core/types/Leave';

// 只取标题与正文（截断 4000 字符）用于错误页特征判定；不上传、不写日志、不落盘。
const PAGE_TEXT_SCRIPT: string = '(function(){var b=document.body;var t=b?(b.innerText||b.textContent||""):"";return (document.title||"")+"\\n"+t.slice(0,4000);})()';

export interface OfficeWebCapability { available: boolean; }
// 能力探测统一走 canIUse；不可用时仍展示复制链接降级分支（P3 行为不变）。
export function officeWebCapability(): OfficeWebCapability { return { available: canIUse('SystemCapability.Web.Webview.Core') }; }
export function officeWebUnavailableCode(): string { return 'WEB_UNAVAILABLE'; }

// 假条抓取失败码归一：只区分「需要重新打开申请页」与「暂时不可用」，服务器原文不进入 UI。
function officeLeaveErrorCode(error: Error): string {
  const message: string = error instanceof Error ? error.message : '';
  if (message === ErrorCode.OFFICE_SESSION_REQUIRED) { return ErrorCode.OFFICE_SESSION_REQUIRED; }
  return ErrorCode.OFFICE_UNAVAILABLE;
}

@Component
export struct OfficeWebView {
  url: string = '';
  warmupUrl: string = '';
  onStateChange: (state: string) => void = () => {};
  closed: () => void = () => {};
  // 会话就绪回调：把带 controller 的 OfficeWebSessionImpl 交给页面（页面只经接口调用，不接触 webview）。
  onSessionReady: (session: OfficeWebSessionImpl) => void = () => {};
  // 申请页加载完成后的假条抓取结果：页面负责显示条数并写入既有状态仓库。
  onLeaveRecords: (records: LeaveRecord[]) => void = () => {};
  onLeaveError: (code: string) => void = () => {};
  // 当前学期 id：页面传入后只保留本学期假条（源记录缺学期字段时由解析器回填）。
  semesterId: string = '';
  // 手动刷新信号：页面自增该值（@Watch）→ 重载申请页，并在重载完成后重新抓取假条。
  @Prop @Watch('onRefreshToken') refreshToken: number = 0;
  @State copyStatus: number = 0;
  @State errorText: string = '';
  private controller: webview.WebviewController = new webview.WebviewController();
  // 只读 xgxt 的 UID 布尔判断登录是否完成，cookie 值不进入页面/日志/状态。
  // 与 Web 组件的 incognitoMode 一致，UID 检查只读无痕内存 jar，绝不读普通浏览器的持久 cookie。
  private readonly cookieStore: WebCookieStore = new PlatformWebCookieStore(true);
  private session: OfficeWebSessionImpl | null = null;
  private currentUrl: string = '';
  private leaveFetchUrl: string = '';
  private hasUid: boolean = false;
  private warmupLoaded: boolean = false;
  private targetRequested: boolean = false;
  private retargetTried: boolean = false;
  private navigationStarted: boolean = false;
  private lastHttpStatus: number = 200;

  private urlAllowed(): boolean { return isAllowedWebUrl(this.url); }

  // 刷新：清掉“同一 URL 只抓一次”的标记并重载页面；重载失败上报 error，由页面显示可见错误。
  private onRefreshToken(): void {
    this.leaveFetchUrl = '';
    const session: OfficeWebSessionImpl | null = this.session;
    if (session === null) { return; }
    // 登录页/OOPS 页刷新时重新决策：先看 UID，再决定回到 warmup 还是 target；
    // 已登录或已在申请页仍按原行为重载当前页，避免刷新把用户踢回登录页。
    if (!this.hasUid && !isOfficeApplyUrl(this.currentUrl)) {
      this.navigationStarted = false;
      this.warmupLoaded = false;
      this.targetRequested = false;
      this.retargetTried = false;
      this.startNavigation().catch((error: Error) => { this.onStateChange('error'); });
      return;
    }
    session.reload().catch((error: Error) => {
      this.onStateChange('error');
    });
  }

  // 组件持有 controller，因此由组件装配实现；lexicon 不可用时保持不建会话（不改变 P3 展示）。
  private initSession(): void {
    if (this.session !== null) { return; }
    let lexicon: SchoolLexicon;
    try {
      lexicon = createSchoolLexicon(getContext(this));
    } catch (error) {
      return;
    }
    const impl: OfficeWebSessionImpl = new OfficeWebSessionImpl(this.controller, new MemoryOfficeSessionStore(), lexicon);
    this.session = impl;
    this.onSessionReady(impl);
  }

  // 只加载登录页；warmup 非法时退回 target（target 仍会经白名单校验）。
  private loadWarmup(): void {
    if (this.warmupUrl.length === 0 || !isAllowedWebUrl(this.warmupUrl)) {
      this.loadTarget();
      return;
    }
    this.warmupLoaded = true;
    this.controller.loadUrl(this.warmupUrl);
  }

  // target 只在白名单校验后加载；由调用方置 targetRequested/retargetTried。
  private loadTarget(): void {
    if (!this.urlAllowed()) {
      this.onStateChange('blocked');
      return;
    }
    this.targetRequested = true;
    this.controller.loadUrl(this.url);
  }

  // 统一前缀的 Web 诊断日志；URL 先脱敏（ticket/uid/pageEnc 等值不落日志），
  // 一次真机尝试即可区分网络错误、白名单拦截、HTTP 4xx/5xx 与学校侧错误页。
  private logWeb(message: string): void {
    Logger.info('school-web ' + message);
  }

  private pageTitle(): string {
    try {
      return this.controller.getTitle();
    } catch (error) {
      return '';
    }
  }

  private logPageEnd(url: string): void {
    // 最终 URL 优先取 controller 当前地址（onPageEnd 的 event 参数会破坏既有静态契约，
    // 故用 getUrl 兜底）；都取不到时退回 onPageBegin 记录的地址。
    const title: string = this.pageTitle();
    let finalUrl: string = url;
    try {
      const liveUrl: string = this.controller.getUrl();
      if (liveUrl.length > 0) { finalUrl = liveUrl; }
    } catch (error) {
      finalUrl = url;
    }
    this.logWeb('page-end url=' + redactUrl(finalUrl) + ' title=' + redactLine(title).slice(0, 120) +
      ' status=' + String(this.lastHttpStatus) + ' uid=' + String(this.hasUid));
  }

  private async pageIssue(): Promise<WebPageIssue> {
    let text: string = '';
    try {
      const raw: string = await this.controller.runJavaScript(PAGE_TEXT_SCRIPT);
      if (typeof raw === 'string') { text = raw; }
    } catch (error) {
      text = '';
    }
    return detectWebPageIssue(this.pageTitle(), text, this.lastHttpStatus);
  }

  // OOPS/“can not enter this page” 是站点返回 HTTP 200 的内容错误页；不静默，给稳定错误码并停止抓取。
  private reportPageIssue(issue: WebPageIssue): void {
    this.logWeb('page-error kind=' + issue + ' url=' + redactUrl(this.currentUrl) +
      ' title=' + redactLine(this.pageTitle()).slice(0, 120) + ' status=' + String(this.lastHttpStatus));
    this.errorText = 'web_office_error_hint';
    this.onStateChange('page-error');
    this.onLeaveError(ErrorCode.OFFICE_UNAVAILABLE);
  }

  // 首屏只发起一个导航（Android openWebApp 同语义），不再让 Web(src=target) 与 warmup 并发，
  // 避免 openPcApp 的未登录响应先写 WFW_SESSION、再被 CAS 登录流程误用。
  private async startNavigation(): Promise<void> {
    if (this.navigationStarted) { return; }
    this.navigationStarted = true;
    this.initSession();
    this.hasUid = await this.cookieStore.contains(XGXT_ORIGIN, 'UID');
    const action: string = decideOfficeNav({
      targetUrl: this.url,
      warmupUrl: this.warmupUrl,
      targetRequested: this.targetRequested,
      warmupLoaded: this.warmupLoaded,
      retargetTried: this.retargetTried,
      hasUid: this.hasUid,
      isApplyPage: false
    });
    if (action === 'load-warmup') { this.loadWarmup(); return; }
    if (action === 'load-target') { this.loadTarget(); return; }
    this.onStateChange('blocked');
  }

  // 页面加载完成后复检 UID；登录成功或落回 xgxt 首页时只重载 target 一次，对齐 Android webAppPageFinished。
  private async handlePageEnd(): Promise<void> {
    this.onStateChange('loaded');
    const issue: WebPageIssue = await this.pageIssue();
    this.logPageEnd(this.currentUrl);
    if (issue !== 'none') {
      this.reportPageIssue(issue);
      return;
    }
    this.hasUid = await this.cookieStore.contains(XGXT_ORIGIN, 'UID');
    if (isOfficeApplyUrl(this.currentUrl)) {
      this.targetRequested = true;
      this.maybeFetchLeave();
      return;
    }
    const action: string = decideOfficeNav({
      targetUrl: this.url,
      warmupUrl: this.warmupUrl,
      targetRequested: this.targetRequested,
      warmupLoaded: this.warmupLoaded,
      retargetTried: this.retargetTried,
      hasUid: this.hasUid,
      isApplyPage: false
    });
    if (action === 'load-target') {
      this.retargetTried = true;
      this.loadTarget();
      return;
    }
    if (action === 'load-warmup') { this.loadWarmup(); }
  }

  // 只在申请页加载完成后自动抓取一次：同一 URL 不重复触发；失败只上报错误码，不回退其它读取方式。
  private maybeFetchLeave(): void {
    const session: OfficeWebSessionImpl | null = this.session;
    const url: string = this.currentUrl;
    if (session === null || url.length === 0 || !isOfficeApplyUrl(url)) { return; }
    if (this.leaveFetchUrl === url) { return; }
    this.leaveFetchUrl = url;
    session.fetchLeaveRecords(this.semesterId).then((records: LeaveRecord[]) => {
      this.onLeaveRecords(records);
    }).catch((error: Error) => {
      this.onLeaveError(officeLeaveErrorCode(error));
    });
  }

  private async copyLink(): Promise<void> {
    const ok: boolean = await copyText(this.url);
    this.copyStatus = ok ? 1 : 2;
  }

  build() {
    Column() {
      if (!this.urlAllowed()) {
        Text($r('app.string.web_office_invalid_url')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_danger')).width('100%').textAlign(TextAlign.Center)
      } else if (!officeWebCapability().available) {
        Text($r('app.string.web_office_unavailable_title')).fontSize($r('app.float.float_font_20')).fontColor($r('app.color.color_text_primary')).fontWeight(FontWeight.Medium).width('100%').textAlign(TextAlign.Center)
        Text($r('app.string.web_unavailable_hint')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary')).width('100%').textAlign(TextAlign.Center)
        Button($r('app.string.web_office_copy_link')).width('100%').height($r('app.float.float_touch_min')).backgroundColor($r('app.color.color_accent_button')).fontColor($r('app.color.color_on_accent')).onClick(() => { this.copyLink(); })
        if (this.copyStatus === 2) { Text($r('app.string.web_office_copy_failed')).fontSize($r('app.float.float_font_12')).fontColor($r('app.color.color_danger')).width('100%').textAlign(TextAlign.Center) }
      } else {
        if (this.errorText.length > 0) {
          Text($r('app.string.web_office_error_hint')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_danger')).width('100%').textAlign(TextAlign.Center)
        }
        Web({ src: 'about:blank', controller: this.controller, incognitoMode: true })
          .width('100%').layoutWeight(1)
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .enableAutoFill(false)
          .onControllerAttached(() => {
            // 先不加载 target，等 UID 检查后只发起一个导航（warmup 或 target），
            // 避免 openPcApp 未登录响应与 CAS 登录页并发写 cookie。
            this.startNavigation().catch((error: Error) => { this.onStateChange('error'); });
          })
          .onPageBegin((event) => {
            this.lastHttpStatus = 200;
            // 让实现跟踪当前页：离开申请页时清空页内会话，防止旧 uid/pageEnc 被复用。
            if (this.session !== null && event !== undefined) {
              this.currentUrl = event.url;
              this.logWeb('page-begin url=' + redactUrl(event.url));
              this.session.noteUrl(event.url).catch(() => {});
            }
          })
          .onLoadIntercept((event) => {
            // 待官方文档确认：event.data.getRequestUrl() 与返回 true=拦截 的签名。
            const target: string = event.data.getRequestUrl();
            // 空 URL/about:blank 不是网络导航，放行；其余仍严格走白名单。
            if (target.length === 0 || target === 'about:blank') { return false; }
            const allowed: boolean = isAllowedWebUrl(target);
            const mainFrame: boolean = event.data.isMainFrame();
            if (mainFrame || !allowed) {
              this.logWeb('intercept main=' + String(mainFrame) + ' allowed=' + String(allowed) +
                ' url=' + redactUrl(target));
            }
            if (!allowed) { this.onStateChange('blocked'); return true; }
            return false;
          })
          .onPageEnd(() => {
            // 申请页抓取在 handlePageEnd 内通过 maybeFetchLeave() 触发，且先判错误页；
            // 同一 URL 由 leaveFetchUrl 去重。错误页（OOPS）不抓取。
            this.handlePageEnd().catch((error: Error) => { this.onStateChange('error'); });
          })
          .onErrorReceive((event) => {
            if (event !== undefined) {
              const mainFrame: boolean = event.request.isMainFrame();
              this.logWeb('error main=' + String(mainFrame) + ' code=' + String(event.error.getErrorCode()) +
                ' info=' + redactLine(event.error.getErrorInfo()).slice(0, 160) +
                ' url=' + redactUrl(event.request.getRequestUrl()));
            }
            this.errorText = 'web_office_error_hint';
            this.onStateChange('error');
          })
          .onHttpErrorReceive((event) => {
            if (event !== undefined) {
              const mainFrame: boolean = event.request.isMainFrame();
              if (mainFrame) { this.lastHttpStatus = event.response.getResponseCode(); }
              this.logWeb('http-error main=' + String(mainFrame) +
                ' status=' + String(event.response.getResponseCode()) +
                ' reason=' + redactLine(event.response.getReasonMessage()).slice(0, 120) +
                ' url=' + redactUrl(event.request.getRequestUrl()));
            }
          })
          .onSslErrorEventReceive((event) => {
            this.logWeb('ssl-error detail=' + String(event.error));
            event.handler.handleCancel();
          })
      }
    }.width('100%').height('100%').padding($r('app.float.float_page_padding')).backgroundColor($r('app.color.color_background'))
  }
}