// 职责：请假 Web 入口白名单与三服务目标，纯逻辑零 Kit。
// 依赖：无；仅字符串/URL 解析。
// 阶段：P3；待确认：URL 解析语义以官方 API12 文档为准。
export type LeaveServiceKey = 'leave' | 'cancel' | 'renew';
export interface LeaveServiceTarget { key: LeaveServiceKey; mappId: string; formId: string; entryUrl: string; titleKey: string; }
export interface WebOfficeParam { key: LeaveServiceKey; url: string; warmupUrl: string; titleKey: string; }
export interface WebFallbackView { capability: 'available' | 'unavailable'; messageKey: string; copyUrl: string; }
export const XGXT_ORIGIN: string = 'https://xgxt.juwp.edu.cn';
export const SSO_ENTRY: string = XGXT_ORIGIN + '/sfrz/login343962';
export const LEAVE_SERVICES: Record<LeaveServiceKey, LeaveServiceTarget> = {
  leave: { key: 'leave', mappId: '19998425', formId: '278616', entryUrl: XGXT_ORIGIN + '/wfw/appInter/openPcApp?mappId=19998425', titleKey: 'web_office_title_leave' },
  cancel: { key: 'cancel', mappId: '19998424', formId: '278615', entryUrl: XGXT_ORIGIN + '/wfw/appInter/openPcApp?mappId=19998424', titleKey: 'web_office_title_cancel' },
  renew: { key: 'renew', mappId: '19998423', formId: '278618', entryUrl: XGXT_ORIGIN + '/wfw/appInter/openPcApp?mappId=19998423', titleKey: 'web_office_title_renew' }
};
export function buildLeaveServiceTarget(key: LeaveServiceKey): LeaveServiceTarget { return LEAVE_SERVICES[key]; }
export function buildWebOfficeParam(key: LeaveServiceKey): WebOfficeParam {
  const t = LEAVE_SERVICES[key];
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

