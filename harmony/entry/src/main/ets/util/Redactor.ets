// 职责：日志/URL/请求头的脱敏工具（P4 81b，规格 §5.1 / §5.2）；util 层，不接 Kit。
// 依赖方向：util 最底层；只被 data / platform / pages 调用，不反向依赖任何业务层。
// 口径：Cookie / Set-Cookie / TGC / ticket / token / pageEnc / fidEnc / uid / enc / service 的值一律
//       替换为 [redacted]，保留键名与 URL 结构便于定位；不把原始值写进日志、错误文案或界面。
// 单实现：P1-4 起本文件是脱敏的唯一实现（redactLine/redactUrl/redactHeaderMap 供日志与 URL；
//       redactText/logFields 供带白名单的结构化日志）。原 core 侧兼容副本已删除，
//       两侧不得再各自维护一份敏感键表（service 之类的漏网就是双实现造成的）。
// 待确认：纯字符串处理，无系统 API，可在 Node 直接加载断言。

const SENSITIVE_KEYS: string[] = [
  'cookie',
  'set-cookie',
  'cookieheader',
  'tgc',
  'ticket',
  'token',
  'pageenc',
  'fidenc',
  'uid',
  'enc',
  'service'
];
const REDACTED: string = '[redacted]';

// cookie 类头/字段的值可能包含空格与分号，整段吞掉比逐段替换更安全。
const COOKIE_VALUE_RE: RegExp = /\b(cookie|set-cookie|cookieheader)\b(\s*[:=]\s*)[^\n]*/gi;
const PAIR_VALUE_RE: RegExp = /([A-Za-z0-9_-]+)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^&;\s,)]*)/g;

function maskCookieValue(match: string, key: string, separator: string): string {
  return key + separator + REDACTED;
}

function maskPairValue(match: string, key: string, separator: string, value: string): string {
  const lower: string = key.toLowerCase();
  if (SENSITIVE_KEYS.indexOf(lower) < 0) {
    return match;
  }
  return key + separator + REDACTED;
}

// 单行日志/错误文案脱敏；空输入返回空串，不抛异常。
export function redactLine(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }
  let out: string = value.replace(COOKIE_VALUE_RE, maskCookieValue);
  out = out.replace(PAIR_VALUE_RE, maskPairValue);
  return out;
}

function redactQuery(query: string): string {
  if (query.length === 0) {
    return query;
  }
  const pairs: string[] = query.split('&');
  const out: string[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const pair: string = pairs[i];
    const eq: number = pair.indexOf('=');
    if (eq <= 0) {
      out.push(pair);
      continue;
    }
    const key: string = pair.slice(0, eq);
    if (SENSITIVE_KEYS.indexOf(key.toLowerCase()) >= 0) {
      out.push(key + '=' + REDACTED);
    } else {
      out.push(pair);
    }
  }
  return out.join('&');
}

// URL 脱敏：去 userinfo、按白名单替换 query 敏感值、fragment 走 redactLine；保留 scheme/host/path 便于定位。
export function redactUrl(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    return '';
  }
  let text: string = raw;
  const schemeEnd: number = text.indexOf('://');
  if (schemeEnd >= 0) {
    const authorityStart: number = schemeEnd + 3;
    const slash: number = text.indexOf('/', authorityStart);
    const authorityEnd: number = slash < 0 ? text.length : slash;
    const authority: string = text.slice(authorityStart, authorityEnd);
    const at: number = authority.lastIndexOf('@');
    if (at >= 0) {
      text = text.slice(0, authorityStart) + REDACTED + '@' + authority.slice(at + 1) + text.slice(authorityEnd);
    }
  }
  const question: number = text.indexOf('?');
  if (question < 0) {
    return redactLine(text);
  }
  const head: string = text.slice(0, question);
  const hash: number = text.indexOf('#', question);
  const query: string = hash < 0 ? text.slice(question + 1) : text.slice(question + 1, hash);
  const fragment: string = hash < 0 ? '' : redactLine(text.slice(hash));
  return head + '?' + redactQuery(query) + fragment;
}

// 请求头脱敏：只用于日志/诊断展示，禁止把返回值拼进网络请求。
export function redactHeaderMap(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const keys: string[] = Object.keys(headers);
  for (let i = 0; i < keys.length; i++) {
    const key: string = keys[i];
    if (SENSITIVE_KEYS.indexOf(key.toLowerCase()) >= 0) {
      out[key] = REDACTED;
    } else {
      out[key] = headers[key];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 结构化日志白名单（原 core 侧兼容副本的能力并入本文件，P1-4）。
// ---------------------------------------------------------------------------

export interface LogFields {
  stage?: string;
  code?: string;
  httpStatus?: number;
  durationMs?: number;
  bytes?: number;
  ruleCount?: number;
  weekCount?: number;
  sessionPresent?: boolean;
}

const ALLOWED_STAGES: string[] = [
  'session-check',
  'page-meta',
  'weeks',
  'rows',
  'parse',
  'save',
  'office-session',
  'office-fetch'
];

const SECRET_PAIR_RE: RegExp = /\b(cookieheader|set-cookie|cookie|tgc|ticket|token|pageenc|fidenc|uid|enc|service)\b["']?\s*[:=]\s*[^\n]*/gi;
const SECRET_BARE_RE: RegExp = /\b(cookieheader|set-cookie|cookie|tgc|ticket|token|pageenc|fidenc|uid|enc|service)\b\s*[:=]\s*\S+/gi;

// 任意文本脱敏：用于错误文案、code 字段与页面展示；空输入返回空串，不抛异常。
export function redactText(value: string): string {
  if (typeof value !== 'string') return '';
  if (value.length === 0) return '';
  let out: string = value.replace(SECRET_PAIR_RE, REDACTED);
  out = out.replace(SECRET_BARE_RE, REDACTED);
  return out;
}

function copyNumber(value: number | undefined): number {
  if (typeof value !== 'number') return -1;
  if (!Number.isFinite(value)) return -1;
  return Math.trunc(value);
}

// 结构化日志：只保留白名单字段，数值取整，code 再过一层 redactText。
export function logFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  if (typeof fields.stage === 'string' && ALLOWED_STAGES.indexOf(fields.stage) >= 0) {
    out.stage = fields.stage;
  }
  if (typeof fields.code === 'string' && fields.code.length > 0) {
    out.code = redactText(fields.code);
  }
  const httpStatus: number = copyNumber(fields.httpStatus);
  if (httpStatus >= 100 && httpStatus <= 599) out.httpStatus = httpStatus;
  const durationMs: number = copyNumber(fields.durationMs);
  if (durationMs >= 0) out.durationMs = durationMs;
  const bytes: number = copyNumber(fields.bytes);
  if (bytes >= 0) out.bytes = bytes;
  const ruleCount: number = copyNumber(fields.ruleCount);
  if (ruleCount >= 0) out.ruleCount = ruleCount;
  const weekCount: number = copyNumber(fields.weekCount);
  if (weekCount >= 0) out.weekCount = weekCount;
  if (typeof fields.sessionPresent === 'boolean') out.sessionPresent = fields.sessionPresent;
  return out;
}
