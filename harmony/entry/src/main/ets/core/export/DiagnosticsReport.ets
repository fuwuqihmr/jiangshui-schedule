// 职责：「导出排查日志」的纯文本装配（第④项），对齐 web diagnostics.mjs 的可读分段格式。
// 依赖方向：import type 只有同层 ExportCopy；零运行时 import（core 纯度门禁）。
// 阶段：P5 导出与备份；脱敏函数由调用方注入（util/Redactor.redactText），core 不 import 平台/工具层。
// 待确认：日志里可能出现 Cookie/token；本文件只保证「注入的 redact 一定作用于每一行」，脱敏强度取决于注入实现。

import type { DiagnosticsCopy } from './ExportCopy';

export const MAX_DIAGNOSTICS_LINES: number = 400;
export const MAX_SOURCE_LINES: number = 100;
export const MAX_LINE_LENGTH: number = 2000;
export const MAX_DIAGNOSTICS_CHARS: number = 200000;

export interface DiagnosticsInput {
  appVersion: string;
  systemVersion: string;
  apiVersion: number;
  stateRevision: number;
  lastSyncAt: string;
  lastAttempt: string;
  events: string[];
  sources: string[];
}

export type RedactLine = (line: string) => string;

function pad2(value: number): string {
  return value < 10 ? '0' + String(value) : String(value);
}

function clockStamp(nowMs: number, offsetMinutes: number): string {
  const time: number = Number.isFinite(nowMs) ? nowMs : 0;
  const offset: number = Number.isFinite(offsetMinutes) ? offsetMinutes : 0;
  const local: Date = new Date(time + offset * 60000);
  return String(local.getUTCFullYear()) + '-' + pad2(local.getUTCMonth() + 1) + '-' + pad2(local.getUTCDate()) + ' ' +
    pad2(local.getUTCHours()) + ':' + pad2(local.getUTCMinutes());
}

function fill(pattern: string, values: string[]): string {
  let out: string = typeof pattern === 'string' ? pattern : '';
  for (let i = 0; i < values.length; i++) {
    out = out.split('{' + String(i) + '}').join(values[i]);
  }
  return out;
}

function safeValue(value: string, copy: DiagnosticsCopy): string {
  if (typeof value !== 'string' || value.length === 0) {
    return copy.unknownValue;
  }
  return value;
}

function safeNumber(value: number, copy: DiagnosticsCopy): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : copy.unknownValue;
}

function clipLine(line: string, limit: number): string {
  if (typeof line !== 'string') {
    return '';
  }
  return line.length > limit ? line.slice(0, limit) : line;
}

// 兜底二次脱敏：util/Redactor 已覆盖 cookie/token/uid 等键，这里补 session/authorization 这类
// 常见但不在其键表里的写法，保证「诊断日志不泄漏会话」不依赖注入实现的完备性。
const REDACTED: string = '[redacted]';
const AUTH_RE: RegExp = /\bauthorization\b\s*[:=]\s*[^\n]*/gi;
const BEARER_RE: RegExp = /\bbearer\s+(?!\[redacted\])[^\s,;]+/gi;
const SESSION_RE: RegExp = /\b(sessionid|jsessionid)\b\s*[:=]\s*(?!\[redacted\])[^\s,;]+/gi;

export function redactDiagnosticsLine(raw: string, redact: RedactLine): string {
  const base: string = typeof redact === 'function' ? redact(raw) : raw;
  let out: string = base.replace(AUTH_RE, REDACTED);
  out = out.replace(BEARER_RE, REDACTED);
  out = out.replace(SESSION_RE, REDACTED);
  return out;
}

function cleanLines(lines: string[], redact: RedactLine): string[] {
  const out: string[] = [];
  if (!Array.isArray(lines)) {
    return out;
  }
  for (const line of lines) {
    if (typeof line !== 'string') {
      continue;
    }
    const redacted: string = redactDiagnosticsLine(line, redact);
    const clipped: string = clipLine(redacted, MAX_LINE_LENGTH);
    if (clipped.length > 0) {
      out.push(clipped);
    }
  }
  return out;
}

// 生成排查日志文本：固定头部 + 事件段 + 数据源段，超长按行数与总字符双上限截断并给出 truncatedNote。
export function buildDiagnosticsText(input: DiagnosticsInput, copy: DiagnosticsCopy, nowMs: number, offsetMinutes: number, redact: RedactLine, maxChars: number): string {
  const cap: number = Number.isFinite(maxChars) && maxChars > 0 ? Math.min(maxChars, MAX_DIAGNOSTICS_CHARS) : MAX_DIAGNOSTICS_CHARS;
  const lines: string[] = [];
  lines.push(fill(copy.title, []));
  lines.push(fill(copy.generatedAt, [clockStamp(nowMs, offsetMinutes)]));
  lines.push(fill(copy.appVersion, [safeValue(input.appVersion, copy)]));
  lines.push(fill(copy.systemVersion, [safeValue(input.systemVersion, copy)]));
  lines.push(fill(copy.apiVersion, [safeNumber(input.apiVersion, copy)]));
  lines.push(fill(copy.stateRevision, [safeNumber(input.stateRevision, copy)]));
  lines.push(fill(copy.lastSyncAt, [safeValue(input.lastSyncAt, copy)]));
  lines.push(fill(copy.lastAttempt, [safeValue(input.lastAttempt, copy)]));

  const events: string[] = cleanLines(input.events, redact);
  const sources: string[] = cleanLines(input.sources, redact);
  let eventsShown: number = events.length;
  if (eventsShown > MAX_DIAGNOSTICS_LINES) {
    eventsShown = MAX_DIAGNOSTICS_LINES;
  }
  let sourcesShown: number = sources.length;
  if (sourcesShown > MAX_SOURCE_LINES) {
    sourcesShown = MAX_SOURCE_LINES;
  }
  lines.push('');
  lines.push(fill(copy.sectionEvents, []));
  if (eventsShown === 0) {
    lines.push(fill(copy.none, []));
  } else {
    for (let i = 0; i < eventsShown; i++) {
      lines.push(fill(copy.eventLine, [String(i + 1), events[i]]));
    }
    if (eventsShown < events.length) {
      lines.push(fill(copy.truncatedNote, [String(eventsShown), String(events.length)]));
    }
  }
  lines.push('');
  lines.push(fill(copy.sectionSources, []));
  if (sourcesShown === 0) {
    lines.push(fill(copy.none, []));
  } else {
    for (let i = 0; i < sourcesShown; i++) {
      lines.push(fill(copy.sourceLine, [String(i + 1), sources[i]]));
    }
    if (sourcesShown < sources.length) {
      lines.push(fill(copy.truncatedNote, [String(sourcesShown), String(sources.length)]));
    }
  }

  let text: string = lines.join('\n');
  if (text.length <= cap) {
    return text;
  }
  // 超字符上限：逐行回退，保留可按行读的尾部提示。
  let kept: string[] = [];
  let size: number = 0;
  for (const line of lines) {
    const next: number = size + line.length + 1;
    if (next > cap) {
      break;
    }
    kept.push(line);
    size = next;
  }
  if (kept.length === 0) {
    return text.slice(0, cap);
  }
  kept.push(fill(copy.truncatedNote, [String(kept.length), String(lines.length)]));
  text = kept.join('\n');
  return text.length > cap ? text.slice(0, cap) : text;
}
