/*
 * Redirect host canonicalization for the school HTTP gateway (P1-A).
 *
 * Pure logic: no imports, no Kit, ASCII-only. The rules are deliberately strict and
 * conservative: a URL shape that a browser would canonicalize in a non-obvious way is
 * rejected (canonicalHostOf returns an empty string), so a redirect can never be
 * "allowed" by accident through a parsing mismatch.
 *
 * Rules:
 *  1. only http/https URLs are accepted;
 *  2. backslash (0x5c), control characters (<= 0x20 or 0x7f) and '%' are rejected
 *     anywhere in the URL (the WHATWG parser treats '\' as a path separator, which
 *     turns "https://evil.example\@jiaowu..." into host "evil.example");
 *  3. the authority ends at the first '/', '?' or '#'; any '@' (userinfo) is rejected;
 *  4. host must match [a-z0-9.-]: non-empty labels, no leading/trailing '.' or '-',
 *     no IPv6 brackets (the school whitelist only contains plain hostnames);
 *  5. port must be a plain number in 1..65535; default ports (http:80 / https:443)
 *     are dropped, everything else is kept as "host:port".
 *
 * Rule 6 (P1-A, round 3): the whitelist key is the full origin scheme://host[:port].
 * canonicalOriginOf() returns that key so a host that is whitelisted for HTTPS cannot be
 * reached over plain HTTP (no downgrade). isRedirectHostAllowed() accepts origin-form
 * entries (scheme included) and still accepts legacy host[:port] entries, which older
 * fixtures use; the platform whitelist uses origin form only.
 * Keep this file in sync with SCHOOL_REDIRECT_ORIGINS in platform/school.
 */

/** Returns canonical host[:port] or '' when the URL must not be followed. */
export function canonicalHostOf(url: string): string {
  if (typeof url !== 'string' || url.length === 0) {
    return '';
  }
  for (let index: number = 0; index < url.length; index++) {
    const code: number = url.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || code === 0x5c) {
      return '';
    }
  }
  const schemeEnd: number = url.indexOf('://');
  if (schemeEnd <= 0) {
    return '';
  }
  const scheme: string = url.substring(0, schemeEnd).toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    return '';
  }
  const rest: string = url.substring(schemeEnd + 3);
  let end: number = rest.length;
  const slash: number = rest.indexOf('/');
  if (slash >= 0 && slash < end) {
    end = slash;
  }
  const question: number = rest.indexOf('?');
  if (question >= 0 && question < end) {
    end = question;
  }
  const sharp: number = rest.indexOf('#');
  if (sharp >= 0 && sharp < end) {
    end = sharp;
  }
  const authority: string = rest.substring(0, end);
  if (authority.length === 0) {
    return '';
  }
  if (authority.indexOf('@') >= 0 || authority.indexOf('%') >= 0) {
    return '';
  }
  const colon: number = authority.lastIndexOf(':');
  let host: string = authority;
  let port: number = 0;
  if (colon >= 0) {
    host = authority.substring(0, colon);
    const portText: string = authority.substring(colon + 1);
    if (!/^[0-9]{1,5}$/.test(portText)) {
      return '';
    }
    port = parseInt(portText, 10);
    if (port < 1 || port > 65535) {
      return '';
    }
  }
  host = host.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) {
    return '';
  }
  if (port === 80 && scheme === 'http') {
    port = 0;
  }
  if (port === 443 && scheme === 'https') {
    port = 0;
  }
  return port > 0 ? host + ':' + String(port) : host;
}

/**
 * Returns the canonical origin scheme://host[:port] or '' when the URL must not be followed.
 * Scheme and host are lowercased; default ports (http:80 / https:443) are dropped.
 */
export function canonicalOriginOf(url: string): string {
  const host: string = canonicalHostOf(url);
  if (host.length === 0) {
    return '';
  }
  const schemeEnd: number = url.indexOf('://');
  const scheme: string = url.substring(0, schemeEnd).toLowerCase();
  return scheme + '://' + host;
}

/**
 * True when the URL exactly matches an allowed whitelist entry.
 * Origin-form entries ("https://host:port") are compared scheme-exactly, so a host that is
 * whitelisted for HTTPS is not reachable over HTTP; legacy host[:port] entries keep the old
 * host-only comparison for older fixtures/tools.
 */
export function isRedirectHostAllowed(url: string, allowed: string[]): boolean {
  const host: string = canonicalHostOf(url);
  if (host.length === 0) {
    return false;
  }
  const origin: string = canonicalOriginOf(url);
  for (const entry of allowed) {
    const text: string = entry.trim().toLowerCase();
    if (text.length === 0) {
      continue;
    }
    if (text.indexOf('://') >= 0) {
      const entryOrigin: string = canonicalOriginOf(text);
      if (entryOrigin.length > 0 && entryOrigin === origin) {
        return true;
      }
    } else if (text === host) {
      return true;
    }
  }
  return false;
}
