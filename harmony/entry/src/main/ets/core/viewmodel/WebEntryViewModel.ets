// 职责：请假 Web 入口白名单与三服务目标，纯逻辑零 Kit。
// 依赖：core/parser/SchoolUrls（纯字符串/URL 解析，无 Kit）。
// 阶段：P3；待确认：URL 解析语义以官方 API12 文档为准。
export type LeaveServiceKey = 'leave' | 'cancel' | 'renew';
export interface LeaveServiceTarget { key: LeaveServiceKey; mappId: string; formId: string; entryUrl: string; titleKey: string; }
export interface WebOfficeParam { key: LeaveServiceKey; url: string; warmupUrl: string; titleKey: string; }
export interface WebFallbackView { capability: 'available' | 'unavailable'; messageKey: string; copyUrl: string; }
// ArkTS 禁止 Record<K,V> 字面量（arkts-no-untyped-obj-literals），三服务用具名接口承载。
export interface LeaveServiceMap { leave: LeaveServiceTarget; cancel: LeaveServiceTarget; renew: LeaveServiceTarget; }
export const XGXT_ORIGIN: string = 'https://xgxt.juwp.edu.cn';
export const SSO_ENTRY: string = XGXT_ORIGIN + '/sfrz/login343962';
/** 学工统一入口的显式名；与教务 SchoolUrls.SSO_ENTRY（jiaowu:81/sso.jsp）不是同一系统。 */
export const XGXT_SSO_ENTRY: string = SSO_ENTRY;
export const LEAVE_SERVICES: LeaveServiceMap = {
  leave: { key: 'leave', mappId: '19998425', formId: '278616', entryUrl: XGXT_ORIGIN + '/wfw/appInter/openPcApp?mappId=19998425', titleKey: 'web_office_title_leave' },
  cancel: { key: 'cancel', mappId: '19998424', formId: '278615', entryUrl: XGXT_ORIGIN + '/wfw/appInter/openPcApp?mappId=19998424', titleKey: 'web_office_title_cancel' },
  renew: { key: 'renew', mappId: '19998423', formId: '278618', entryUrl: XGXT_ORIGIN + '/wfw/appInter/openPcApp?mappId=19998423', titleKey: 'web_office_title_renew' }
};
function leaveServiceOf(key: LeaveServiceKey): LeaveServiceTarget {
  if (key === 'cancel') { return LEAVE_SERVICES.cancel; }
  if (key === 'renew') { return LEAVE_SERVICES.renew; }
  return LEAVE_SERVICES.leave;
}
export function buildLeaveServiceTarget(key: LeaveServiceKey): LeaveServiceTarget { return leaveServiceOf(key); }
export function buildWebOfficeParam(key: LeaveServiceKey): WebOfficeParam {
  const t: LeaveServiceTarget = leaveServiceOf(key);
  return { key: t.key, url: t.entryUrl, warmupUrl: SSO_ENTRY, titleKey: t.titleKey };
}
export function buildPortalWebParam(): WebOfficeParam {
  return { key: 'leave', url: SSO_ENTRY, warmupUrl: SSO_ENTRY, titleKey: 'web_portal_title' };
}
export function buildMobileWebParam(): WebOfficeParam {
  return { key: 'leave', url: XGXT_ORIGIN + '/', warmupUrl: SSO_ENTRY, titleKey: 'web_mobile_title' };
}
export function isAllowedWebUrl(raw: string): boolean {
  if (raw.length === 0 || raw.length > 2048 || /[\u0000-\u001f\\\r\n]/.test(raw) || raw.indexOf('@') >= 0) { return false; }
  if (!raw.startsWith('https://')) { return false; }
  let rest = raw.slice(8); let hostPart = rest; const slash = rest.indexOf('/');
  if (slash >= 0) hostPart = rest.slice(0, slash);
  const colon = hostPart.lastIndexOf(':');
  const host = colon >= 0 ? hostPart.slice(0, colon) : hostPart;
  const portText = colon >= 0 ? hostPart.slice(colon + 1) : '';
  let port = -1;
  if (portText.length > 0) { const n = Number(portText); if (!Number.isInteger(n)) return false; port = n; }
  if (host === 'xgxt.juwp.edu.cn') return port === -1 || port === 443;
  if (host === 'eapp2.juwp.edu.cn' || host === 'eapp2.nit.edu.cn') return port === -1 || port === 443 || port === 9443;
  return false;
}
export function buildWebFallbackView(capability: 'available' | 'unavailable', param: WebOfficeParam): WebFallbackView {
  return { capability, messageKey: capability === 'available' ? 'web_available_hint' : 'web_unavailable_hint', copyUrl: param.url };
}

// 学工 WebView 导航决策（纯逻辑，便于 Node 回归）。
// 与 Android MainActivity.webAppPageFinished 对齐：先看是否已在申请页，再看 UID 决定重载 target，
// 没有 UID 时先加载 warmup 登录页；target/warmup 仍必须通过 isAllowedWebUrl 白名单。
export type OfficeNavAction = 'none' | 'load-target' | 'load-warmup';
export interface OfficeNavState {
  targetUrl: string;
  warmupUrl: string;
  targetRequested: boolean;
  warmupLoaded: boolean;
  retargetTried: boolean;
  hasUid: boolean;
  isApplyPage: boolean;
}

export function decideOfficeNav(state: OfficeNavState): OfficeNavAction {
  if (!isAllowedWebUrl(state.targetUrl)) { return 'none'; }
  if (state.isApplyPage) { return 'none'; }
  if (state.hasUid) {
    if (state.retargetTried) { return 'none'; }
    return 'load-target';
  }
  if (state.warmupLoaded || state.targetRequested) { return 'none'; }
  if (state.warmupUrl.length > 0 && isAllowedWebUrl(state.warmupUrl)) { return 'load-warmup'; }
  return 'load-target';
}

// 站点错误页特征判定（纯逻辑）。OOPS/“can not enter this page” 是学校站点 HTTP 200 的
// 内容错误页，不是 ArkWeb 网络错误；访问拒绝类文案与 401/403 归为权限问题，便于 UI 给稳定错误码。
export type WebPageIssue = 'none' | 'site-error' | 'permission';

export function detectWebPageIssue(title: string, text: string, httpStatus: number = 200): WebPageIssue {
  if (httpStatus === 401 || httpStatus === 403) { return 'permission'; }
  const lower: string = (title + '\n' + text).toLowerCase();
  if (lower.indexOf('oops') >= 0 || lower.indexOf('webmaster') >= 0 ||
    lower.indexOf('can not enter this page') >= 0 || lower.indexOf('cannot enter this page') >= 0) {
    return 'site-error';
  }
  if (lower.indexOf('access denied') >= 0 || lower.indexOf('forbidden') >= 0 ||
    lower.indexOf('not authorized') >= 0 || lower.indexOf('permission denied') >= 0 ||
    lower.indexOf('unauthorized') >= 0) {
    return 'permission';
  }
  if (httpStatus >= 500) { return 'site-error'; }
  return 'none';
}

// 登录成功判定的分层最后一级——URL 命中教务框架/课表页，不依赖 cookie 是否可读。
// pure core 不能 import 运行时模块，因此这里只接收已解析的 URL 字段；常量与
// core/parser/SchoolUrls 的 FRAME_PATH/TABLE_PATH/SCHOOL_DOMAIN 保持一致，由静态测试盯漂移。
const SCHOOL_LOGIN_HOST: string = 'jiaowu.juwp.edu.cn';
const SCHOOL_LOGIN_FRAME_PATH: string = '/jsxsd/framework/xsMainV.htmlx';
const SCHOOL_LOGIN_TABLE_PATH: string = '/jsxsd/xskb/xskb_list.do';

function loginPathIs(path: string, expected: string): boolean {
  return path === expected || path.indexOf(expected + '?') === 0;
}

export function isSchoolLoginSuccessParts(scheme: string, host: string, port: number, path: string): boolean {
  if (host !== SCHOOL_LOGIN_HOST) { return false; }
  const portOk: boolean = (scheme === 'http' && port === 8080) ||
    (scheme === 'https' && port === 81);
  if (!portOk) { return false; }
  return loginPathIs(path, SCHOOL_LOGIN_FRAME_PATH) || loginPathIs(path, SCHOOL_LOGIN_TABLE_PATH);
}

// 登录成功后的会话/TGC 采集优先级（纯逻辑，便于 Node 回归，不接触 Kit）。
// 成功与否只由 pageUrlSuccess 决定；cookie 三层都拿不到时 success 仍为 true，
// 只是 sessionLayer/tgcLayer 回落到 none，由平台层把静默重登降级并记录 tgc-capture miss。
export type LoginCaptureLayer = 'none' | 'page-url' | 'request-header' | 'cookie-fetch' | 'cookie-all';

export interface LoginCaptureSources {
  sessionFromRequestHeader: string;
  sessionFromFetchCookie: string;
  sessionFromAllCookies: string;
  tgcFromRequestHeader: string;
  tgcFromFetchCookie: string;
  tgcFromAllCookies: string;
}

export interface LoginCapturePlan {
  success: boolean;
  successLayer: LoginCaptureLayer;
  sessionCookie: string;
  sessionLayer: LoginCaptureLayer;
  tgc: string;
  tgcLayer: LoginCaptureLayer;
}

export function planLoginCapture(pageUrlSuccess: boolean, sources: LoginCaptureSources): LoginCapturePlan {
  let sessionCookie: string = '';
  let sessionLayer: LoginCaptureLayer = 'none';
  // jar 优先：fetchCookie 命中时它是最新会话；请求头只作为 jar 读不到 HttpOnly 时的兜底，
  // 避免登录过程中较早请求留下的旧 Cookie 覆盖新会话。
  if (sources.sessionFromFetchCookie.length > 0) {
    sessionCookie = sources.sessionFromFetchCookie;
    sessionLayer = 'cookie-fetch';
  } else if (sources.sessionFromAllCookies.length > 0) {
    sessionCookie = sources.sessionFromAllCookies;
    sessionLayer = 'cookie-all';
  } else if (sources.sessionFromRequestHeader.length > 0) {
    sessionCookie = sources.sessionFromRequestHeader;
    sessionLayer = 'request-header';
  }
  let tgc: string = '';
  let tgcLayer: LoginCaptureLayer = 'none';
  if (sources.tgcFromFetchCookie.length > 0) {
    tgc = sources.tgcFromFetchCookie;
    tgcLayer = 'cookie-fetch';
  } else if (sources.tgcFromAllCookies.length > 0) {
    tgc = sources.tgcFromAllCookies;
    tgcLayer = 'cookie-all';
  } else if (sources.tgcFromRequestHeader.length > 0) {
    tgc = sources.tgcFromRequestHeader;
    tgcLayer = 'request-header';
  }
  return {
    success: pageUrlSuccess,
    successLayer: pageUrlSuccess ? 'page-url' : 'none',
    sessionCookie: sessionCookie,
    sessionLayer: sessionLayer,
    tgc: tgc,
    tgcLayer: tgcLayer
  };
}
