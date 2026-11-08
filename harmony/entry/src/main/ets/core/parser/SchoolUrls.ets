// Responsibility: school URL constants, parsing and allow-listing for the CAS chain.
// Dependency direction: core/parser only; no Kit, no Chinese literals.
// Stage: P4-a. Hosts/ports mirror the existing Android/Web probe results.

export const JIAOWU_HTTP: string = 'http://jiaowu.juwp.edu.cn:8080';
export const JIAOWU_HTTPS: string = 'https://jiaowu.juwp.edu.cn:81';
export const SSO_ENTRY: string = JIAOWU_HTTPS + '/sso.jsp';
// the CAS service value is a fixed constant, not guessed from a redirect URL.
// The real probe shows http (default port 80) even though the page is entered via https:81.
export const CAS_SERVICE_URL: string = 'http://jiaowu.juwp.edu.cn/sso.jsp';
// bzb_jsxsd is set with Path=/jsxsd, so read it via the jsxsd root, not the bare port root.
export const JIAOWU_SESSION_URL: string = JIAOWU_HTTP + '/jsxsd/';
export const CAS_LOGIN: string = 'https://eapp2.juwp.edu.cn:9443/cas/login';
export const FRAME_PATH: string = '/jsxsd/framework/xsMainV.htmlx';
export const TABLE_PATH: string = '/jsxsd/xskb/xskb_list.do?viweType=1';
export const XK_PATH: string = '/jsxsd/xk/LoginToXk';
export const SCHOOL_DOMAIN: string = 'jiaowu.juwp.edu.cn';
export const CAS_HOST: string = 'eapp2.juwp.edu.cn';
export const CAS_HOST_ALT: string = 'eapp2.nit.edu.cn';
export const PORTAL_HOST: string = 'portal.juwp.edu.cn';
export const JIAOWUH5_HOST: string = 'jiaowuh5.juwp.edu.cn';

const HTTP_SCHEME: string = 'http://';
const HTTPS_SCHEME: string = 'https://';
const MAX_URL_LENGTH: number = 2048;
const DEFAULT_HTTP_PORT: number = 80;
const DEFAULT_HTTPS_PORT: number = 443;
const JIAOWU_HTTP_PORT: number = 8080;
const JIAOWU_HTTPS_PORT: number = 81;
const CAS_PORT: number = 9443;

export interface SchoolUrlParts {
  scheme: string;
  host: string;
  port: number;
  path: string;
}

function parsePort(text: string): number {
  if (text.length === 0) { return -1; }
  let value: number = 0;
  for (let i = 0; i < text.length; i++) {
    const code: number = text.charCodeAt(i);
    if (code < 48 || code > 57) { return -1; }
    value = value * 10 + (code - 48);
    if (value > 65535) { return -1; }
  }
  return value;
}

export function parseSchoolUrl(raw: string): SchoolUrlParts | null {
  const url: string = raw.trim();
  if (url.length === 0 || url.length > MAX_URL_LENGTH) { return null; }
  if (url.indexOf('\\') >= 0 || url.indexOf('@') >= 0 || url.indexOf(' ') >= 0) { return null; }
  let scheme: string = '';
  let rest: string = '';
  if (url.indexOf(HTTP_SCHEME) === 0) {
    scheme = 'http';
    rest = url.substring(HTTP_SCHEME.length);
  } else if (url.indexOf(HTTPS_SCHEME) === 0) {
    scheme = 'https';
    rest = url.substring(HTTPS_SCHEME.length);
  } else {
    return null;
  }
  if (rest.length === 0) { return null; }
  const slash: number = rest.indexOf('/');
  const authority: string = slash < 0 ? rest : rest.substring(0, slash);
  let path: string = slash < 0 ? '/' : rest.substring(slash);
  const hash: number = path.indexOf('#');
  if (hash >= 0) { path = path.substring(0, hash); }
  if (authority.length === 0 || path.length === 0) { return null; }
  let host: string = authority;
  let portText: string = '';
  const colon: number = authority.lastIndexOf(':');
  if (colon >= 0) {
    host = authority.substring(0, colon);
    portText = authority.substring(colon + 1);
  }
  if (host.length === 0 || host.indexOf('[') >= 0) { return null; }
  const defaultPort: number = scheme === 'http' ? DEFAULT_HTTP_PORT : DEFAULT_HTTPS_PORT;
  let port: number = defaultPort;
  if (portText.length > 0) {
    port = parsePort(portText);
    if (port < 0) { return null; }
  }
  const parts: SchoolUrlParts = {
    scheme: scheme,
    host: host.toLowerCase(),
    port: port,
    path: path
  };
  return parts;
}

function pathIs(path: string, expected: string): boolean {
  return path === expected || path.indexOf(expected + '?') === 0;
}

function isJiaowuHost(host: string): boolean {
  return host === SCHOOL_DOMAIN;
}

function isCasHost(host: string): boolean {
  return host === CAS_HOST || host === CAS_HOST_ALT;
}

// the four legal jiaowu origins (http 80/8080, https 443/81). Cross-host,
// unknown ports and non-http(s) are still rejected. http:80 is allowed because the real
// CAS success callback observed in the probe is http://jiaowu.../sso.jsp (credentials stay in the CAS form).
function isJiaowuOrigin(parts: SchoolUrlParts): boolean {
  if (parts.scheme === 'http') {
    return parts.port === DEFAULT_HTTP_PORT || parts.port === JIAOWU_HTTP_PORT;
  }
  if (parts.scheme === 'https') {
    return parts.port === DEFAULT_HTTPS_PORT || parts.port === JIAOWU_HTTPS_PORT;
  }
  return false;
}

function pathHasPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.indexOf(prefix) === 0;
}

// jiaowu allows the root/login page, the CAS callback page and the jsxsd application;
// other paths are still rejected.
function isJiaowuSchoolPath(path: string): boolean {
  return path === '/' || path === '/jsxsd' || pathIs(path, '/sso.jsp') || pathHasPrefix(path, '/jsxsd/');
}

/**
 * Returns the rejection reason (host/scheme/port/path); empty means the strict allow-list passed.
 * Only for logs: returns no URL or query, so ticket-like parameters never reach the log.
 */
export function schoolUrlBlockReason(url: string): string {
  const parts: SchoolUrlParts | null = parseSchoolUrl(url);
  if (parts === null) {
    return 'scheme';
  }
  if (isJiaowuHost(parts.host)) {
    if (!isJiaowuOrigin(parts)) {
      return 'port';
    }
    return isJiaowuSchoolPath(parts.path) ? '' : 'path';
  }
  if (isCasHost(parts.host)) {
    if (parts.scheme !== 'https' || parts.port !== CAS_PORT) {
      return 'port';
    }
    return pathHasPrefix(parts.path, '/cas/') ? '' : 'path';
  }
  if (parts.host === PORTAL_HOST || parts.host === JIAOWUH5_HOST) {
    if (parts.scheme !== 'https' || parts.port !== DEFAULT_HTTPS_PORT) {
      return 'scheme';
    }
    return '';
  }
  return 'host';
}

export function isAllowedSchoolUrl(url: string): boolean {
  return schoolUrlBlockReason(url) === '';
}

export function isJiaowuTimetableUrl(url: string): boolean {
  const parts: SchoolUrlParts | null = parseSchoolUrl(url);
  if (parts === null) { return false; }
  if (!isJiaowuHost(parts.host)) { return false; }
  if (!isJiaowuOrigin(parts)) { return false; }
  return pathIs(parts.path, TABLE_PATH);
}

export function isAllowedSchoolRedirect(url: string): boolean {
  const parts: SchoolUrlParts | null = parseSchoolUrl(url);
  if (parts === null) { return false; }
  if (isJiaowuHost(parts.host)) {
    return isJiaowuOrigin(parts);
  }
  if (isCasHost(parts.host)) {
    return parts.scheme === 'https' && parts.port === CAS_PORT;
  }
  if (parts.host === PORTAL_HOST || parts.host === JIAOWUH5_HOST) {
    return parts.scheme === 'https' && parts.port === DEFAULT_HTTPS_PORT;
  }
  return false;
}

/**
 * Single source of truth: HttpGateway / SchoolRelogin / SchoolReader share this origin list.
 * Keys are full origins (scheme://host[:port]) with default ports omitted, matching
 * core/network/RedirectPolicy canonicalOriginOf. Only same-school origins may be added;
 * no wildcards and no cross-domain entries.
 */
export const SCHOOL_REDIRECT_ORIGINS: string[] = [
  'http://jiaowu.juwp.edu.cn',
  'http://jiaowu.juwp.edu.cn:8080',
  'https://jiaowu.juwp.edu.cn',
  'https://jiaowu.juwp.edu.cn:81',
  'https://eapp2.juwp.edu.cn:9443',
  'https://eapp2.nit.edu.cn:9443',
  'https://portal.juwp.edu.cn',
  'https://jiaowuh5.juwp.edu.cn'
];

export function extractServiceParam(url: string): string | null {
  const queryStart: number = url.indexOf('?');
  if (queryStart < 0) { return null; }
  let query: string = url.substring(queryStart + 1);
  const hash: number = query.indexOf('#');
  if (hash >= 0) { query = query.substring(0, hash); }
  const segments: string[] = query.split('&');
  for (let i = 0; i < segments.length; i++) {
    const segment: string = segments[i];
    const eq: number = segment.indexOf('=');
    if (eq < 0) { continue; }
    if (segment.substring(0, eq) === 'service') {
      return segment.substring(eq + 1);
    }
  }
  return null;
}
