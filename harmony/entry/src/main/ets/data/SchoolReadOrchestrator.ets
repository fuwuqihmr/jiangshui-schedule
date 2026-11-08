// 职责：学校课表读取编排（P4 79b 实现，从 core/parser 迁至 data/，规格 §2.9 / §3.2）。
// 依赖方向：data -> core/types + core/parser 的纯类型；纯逻辑、依赖注入，不 import platform/pages/Kit。
// 阶段：P4；所有网络、Cookie、解析能力由 SchoolReadDeps 注入，平台层负责装配。
// 迁移说明：本文件是 data 层实现的唯一位置；core/parser 下不再保留同名实现，调用方一律 import 本文件。
// 安全口径：错误码用 ASCII 字符串（Node strip-types 不能运行时 import enum）；
//           错误信息只含状态码与阶段，不含服务器原文、Cookie 头、查询串与响应体；
//           cookieHeader 只作为 Cookie 请求头传给注入的 http，不写日志、不进 AppState。
// 待确认：学期开始日期只能来自实测表；未知学期一律 SCHOOL_PARSE_FAILED，不臆造校历。
import type { SemesterSnapshot } from '../core/types/AppState';
import type { SchoolReadResult, SchoolSession, StudentProfile } from '../core/types/Leave';
import type { SchoolReadService } from '../core/types/Services';
import type { JsxsdRow, PageMeta, ParsedTimetable, TimetableParseOptions } from '../core/parser/JsxsdParser';
import type { SchoolLexicon } from '../core/parser/SchoolLexicon';

export const SCHOOL_LOGIN_REQUIRED: string = 'SCHOOL_LOGIN_REQUIRED';
export const SCHOOL_CAPTCHA_REQUIRED: string = 'SCHOOL_CAPTCHA_REQUIRED';
export const SCHOOL_SESSION_EXPIRED: string = 'SCHOOL_SESSION_EXPIRED';
export const SCHOOL_NETWORK_FAILED: string = 'SCHOOL_NETWORK_FAILED';
export const SCHOOL_TIMEOUT: string = 'SCHOOL_TIMEOUT';
export const SCHOOL_PARSE_FAILED: string = 'SCHOOL_PARSE_FAILED';
export const SCHOOL_EMPTY_TIMETABLE: string = 'SCHOOL_EMPTY_TIMETABLE';

export const JIAOWU_ORIGIN: string = 'http://jiaowu.juwp.edu.cn:8080';
export const FRAME_URL: string = JIAOWU_ORIGIN + '/jsxsd/framework/xsMainV.htmlx';
export const TABLE_PROBE_URL: string = JIAOWU_ORIGIN + '/jsxsd/xskb/xskb_list.do?viweType=1';
export const WEEKS_URL_PREFIX: string = JIAOWU_ORIGIN + '/jsxsd/xskb/jxzlzc_xnxq_ajax?xnxq01id=';
export const ROWS_PATH_PREFIX: string = '/jsxsd/xskb/xskb_list.do?viweType=1&demoStr=&needData=1&baseUrl=/jsxsd&sfykb=2&pageNum=1&pageSize=500';
export const ROWS_FILTER_PARAM: string = '&xsflMapListJsonStr=';
export const ROWS_TAIL: string = '&xnxq01id=';
export const ROWS_TAIL_MODE: string = '&zc=&kbjcmsid=';
export const DEFAULT_TIMEOUT_MS: number = 20000;
export const SCHOOL_SESSION_COOKIE: string = 'bzb_jsxsd';
export const SCHOOL_READ_STAGES: string[] = ['session-check', 'page-meta', 'weeks', 'rows', 'parse', 'save'];

// 参与“是否需要静默重登”判断的稳定码：会话类三项触发换票，网络/超时项由换票层按原码上抛。
const RELOGIN_CODES: string[] = [
  SCHOOL_SESSION_EXPIRED,
  SCHOOL_LOGIN_REQUIRED,
  SCHOOL_CAPTCHA_REQUIRED,
  SCHOOL_TIMEOUT,
  SCHOOL_NETWORK_FAILED
];

const SEMESTER_ID_RE: RegExp = /^[0-9A-Za-z-]{1,32}$/;
const ISO_DATE_RE: RegExp = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const MONTH_DAYS: number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MAX_WEEKS: number = 60;
/** 平台层 HttpError 的稳定字段（ArkTS 不允许匿名对象类型）。 */
export interface PlatformFailure {
  code?: string;
  message?: string;
}

export interface SchoolHttpResponse {
  status: number;
  body: string;
}

export interface SchoolHttpClient {
  get(url: string, cookieHeader: string, timeoutMs: number): Promise<SchoolHttpResponse>;
}

export interface SchoolCookieReader {
  read(url: string): Promise<string>;
  /**
   * 清除教务域 cookie（P1-B round 3）：静默重登前先清死票，避免把旧的 bzb_jsxsd 再读一遍。
   * 可选：测试替身/降级实现可不提供，此时重登流程只重新读取 Cookie。
   */
  clear?: () => Promise<boolean>;
}

export interface SchoolParserApi {
  parseTimetablePage: (html: string) => PageMeta | null;
  parseTimetable: (body: string, options: TimetableParseOptions, lexicon: SchoolLexicon) => ParsedTimetable;
  isLoginPage: (html: string, lexicon: SchoolLexicon) => boolean;
  isCaptchaPage: (html: string, lexicon: SchoolLexicon) => boolean;
  parseProfile: (html: string, lexicon: SchoolLexicon) => StudentProfile | null;
}

/**
 * 静默重登端口（规格 §3.1 第 7 条 / §3.2）。
 * 由 platform 层实现真实 SSO 换票：用 Web 组件持有的 CAS TGC 走 sso.jsp -> CAS login?service=... -> 教务 Set-Cookie，
 * 换到新的 bzb_jsxsd 才算成功；没有 TGC 或换票失败必须抛错（绝不返回旧 cookie 假装已登录）。
 * 端口定义留在 data 层、实现放 platform/school/SchoolRelogin.ets，data/ 仍不 import 任何 Kit。
 */
export interface SchoolReloginPort {
  exchange(): Promise<string>;
}

export interface SchoolReadDeps {
  http: SchoolHttpClient;
  cookies: SchoolCookieReader;
  parser: SchoolParserApi;
  lexicon: SchoolLexicon;
  now: () => number;
  timeoutMs?: number;
  sourceLabel?: string;
  semesterName?: string;
  // 课程类别过滤串（“理论学时,...”）：core 禁 CJK，由平台从资源注入；
  // 缺省时 URL 不带该参数（服务端按默认类别返回），仍符合可读性要求。
  rowsFilter?: string;
  // 真实 SSO 换票端口。缺省时退回“清死票 + 重读 jar”的历史降级路径。
  relogin?: SchoolReloginPort;
}

export interface WeekRow {
  jszc?: number | string;
}

export interface RowsPayload {
  code?: number;
  data?: JsxsdRow[];
  flag1?: number;
}

export interface SemesterCalendarEntry {
  semesterId: string;
  monday: string;
}

export const SEMESTER_MONDAY_TABLE: SemesterCalendarEntry[] = [
  { semesterId: '2026-2027-1', monday: '2026-08-31' }
];

export class SchoolReadError extends Error {
  code: string;
  detail: string;

  constructor(code: string, detail: string) {
    super(detail.length > 0 ? code + ': ' + detail : code);
    this.name = 'SchoolReadError';
    this.code = code;
    this.detail = detail;
  }
}

function isLeapYear(year: number): boolean {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return MONTH_DAYS[month - 1];
}

// 纯整数星期算法（Sakamoto）：0 = 周日，1 = 周一；不使用字符串 Date 解析，避免运行环境差异。
export function weekdayOf(year: number, month: number, day: number): number {
  const offsets: number[] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let adjusted: number = year;
  if (month < 3) adjusted = adjusted - 1;
  const sum: number = adjusted + Math.floor(adjusted / 4) - Math.floor(adjusted / 100) + Math.floor(adjusted / 400) + offsets[month - 1] + day;
  return sum % 7;
}

export function isMondayDate(value: string): boolean {
  const match: RegExpExecArray | null = ISO_DATE_RE.exec(value);
  if (match === null) return false;
  const year: number = Number(match[1]);
  const month: number = Number(match[2]);
  const day: number = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return weekdayOf(year, month, day) === 1;
}

export function semesterMonday(semesterId: string): string {
  for (let i = 0; i < SEMESTER_MONDAY_TABLE.length; i++) {
    const entry: SemesterCalendarEntry = SEMESTER_MONDAY_TABLE[i];
    if (entry.semesterId === semesterId) return entry.monday;
  }
  return '';
}

export function rowsUrl(semesterId: string, modeId: string, rowsFilter?: string): string {
  const filter: string = typeof rowsFilter === 'string' ? rowsFilter : '';
  const filterPart: string = filter.length > 0 ? ROWS_FILTER_PARAM + encodeURIComponent(filter) : '';
  return JIAOWU_ORIGIN + ROWS_PATH_PREFIX + filterPart + ROWS_TAIL + encodeURIComponent(semesterId) + ROWS_TAIL_MODE + encodeURIComponent(modeId);
}

export class SchoolReadOrchestrator implements SchoolReadService {
  private readonly deps: SchoolReadDeps;
  private inflight: Promise<SchoolReadResult> | null = null;

  constructor(deps: SchoolReadDeps) {
    this.deps = deps;
  }

  // onProgress 可选：按真实发生顺序回调 §5.2 stage 白名单（session-check/page-meta/weeks/rows/parse/save），
  // 供 UI 显示 §6.3 的读取阶段；单飞命中时复用首次调用的进度流，后续调用不再重复回调。
  // 会话失效（401/403、flag1=2/3、登录页/验证码页）只做一次静默重登 + 再读一次，第二次仍失败才把稳定码抛给 UI。
  async read(session: SchoolSession, onProgress?: (stage: string) => void): Promise<SchoolReadResult> {
    const cookieHeader: string = this.assertSession(session);
    if (this.inflight !== null) return this.inflight;
    const task: Promise<SchoolReadResult> = this.runWithRelogin(cookieHeader, onProgress);
    this.inflight = task;
    task.then((): void => {
      this.inflight = null;
    }, (): void => {
      this.inflight = null;
    });
    return task;
  }

  async readProfile(session: SchoolSession): Promise<StudentProfile | null> {
    const cookieHeader: string = this.assertSession(session);
    const frameBody: string = await this.fetchPage(FRAME_URL, cookieHeader, 'session-check');
    return this.parseProfile(frameBody);
  }

  // 一次静默重登守卫（P1，规格 §3.1 第 7 条）：attempt 最多递增到 1，绝不循环。
  // 起静默重登走真实 SSO 换票（deps.relogin）：由平台层用 CAS TGC 换回新的 bzb_jsxsd；
  // 换票失败按稳定码上抛（登录/验证码/网络），不新增导航、也不假装登录成功。
  /// 规格 §3.2:386、§4.2:451：重登后再次 401/403/flag1 必须转 SCHOOL_LOGIN_REQUIRED，
  // 不能把第二次 SESSION_EXPIRED 抛给 UI（否则 UI 会误以为还能再静默重登）。
  private async runWithRelogin(cookieHeader: string, onProgress?: (stage: string) => void): Promise<SchoolReadResult> {
    let liveCookie: string = cookieHeader;
    let attempt: number = 0;
    for (;;) {
      try {
        return await this.run(liveCookie, onProgress);
      } catch (error) {
        const code: string = readErrorCode(error instanceof Error ? error : new Error(''));
        const needsRelogin: boolean = code === SCHOOL_SESSION_EXPIRED
          || code === SCHOOL_LOGIN_REQUIRED
          || code === SCHOOL_CAPTCHA_REQUIRED;
        if (!needsRelogin || attempt >= 1) {
          // 规格 §3.2:386 / §4.2:451：静默重登后仍过期 -> 人工登录（转 LOGIN_REQUIRED）。
          if (attempt >= 1 && code === SCHOOL_SESSION_EXPIRED) {
            throw new SchoolReadError(SCHOOL_LOGIN_REQUIRED, 'session expired after relogin');
          }
          // ArkTS 只允许 throw Error 子类（arkts-limited-throw）：非 Error 的抛出物包成 Error 再抛。
          throw error instanceof Error ? error : new Error(code.length > 0 ? code : SCHOOL_PARSE_FAILED);
        }
        attempt = attempt + 1;
        console.info('school read attempt ' + String(attempt) + ' code ' + code + ' silent relogin');
        liveCookie = await this.exchangeSessionCookie();
      }
    }
  }

  /**
   * 静默重登取新 cookie。
   * 有 deps.relogin（平台装配）时走真实 SSO 换票：清掉教务域死票 -> 平台层用 CAS TGC 换票 ->
   * 只在新 cookie 里确有 bzb_jsxsd 时才允许重读；换不到就抛 SCHOOL_LOGIN_REQUIRED 交给 UI 人工登录。
   * 没有 relogin 端口（单元测试替身/历史接线）时保留旧降级：清死票后重读 WebCookieManager。
   * 两条路径都不返回旧 cookie、不把“没换到票”当成成功。
   */
  private async exchangeSessionCookie(): Promise<string> {
    await this.clearSessionCookies();
    const port: SchoolReloginPort | undefined = this.deps.relogin;
    if (port === undefined) {
      const refreshed: string = await this.refreshSessionCookie();
      if (refreshed.length === 0) {
        throw new SchoolReadError(SCHOOL_LOGIN_REQUIRED, 'session cookie unavailable after relogin');
      }
      return refreshed;
    }
    let fresh: string = '';
    try {
      fresh = await port.exchange();
    } catch (error) {
      const reloginCode: string = readErrorCode(error instanceof Error ? error : new Error(''));
      if (reloginCode === SCHOOL_CAPTCHA_REQUIRED) {
        throw new SchoolReadError(SCHOOL_CAPTCHA_REQUIRED, 'sso relogin needs captcha');
      }
      if (reloginCode === SCHOOL_TIMEOUT) {
        throw new SchoolReadError(SCHOOL_TIMEOUT, 'sso relogin timed out');
      }
      if (reloginCode === SCHOOL_NETWORK_FAILED) {
        throw new SchoolReadError(SCHOOL_NETWORK_FAILED, 'sso relogin network failed');
      }
      // 没有 TGC / TGC 失效 / CAS 返回登录页：转人工 SSO，不假装登录成功。
      throw new SchoolReadError(SCHOOL_LOGIN_REQUIRED, 'sso relogin required');
    }
    if (typeof fresh !== 'string' || fresh.trim().length === 0 || fresh.indexOf(SCHOOL_SESSION_COOKIE) < 0) {
      throw new SchoolReadError(SCHOOL_LOGIN_REQUIRED, 'sso relogin without session cookie');
    }
    return fresh.trim();
  }

  private async refreshSessionCookie(): Promise<string> {
    try {
      const live: string = await this.deps.cookies.read(FRAME_URL);
      if (typeof live === 'string' && live.indexOf(SCHOOL_SESSION_COOKIE) >= 0) return live;
    } catch (error) {
      return '';
    }
    return '';
  }

  // P1-B round 3：重登前清掉教务域 cookie。接口是可选实现，旧替身没有 clear 时直接跳过。
  private async clearSessionCookies(): Promise<void> {
    const holder: SchoolCookieReader = this.deps.cookies;
    if (holder.clear === undefined) {
      return;
    }
    try {
      await holder.clear();
    } catch (error) {
      // 清理失败不阻塞重登：下一轮 refreshSessionCookie 仍会尝试读取现有 Cookie。
    }
  }

  private assertSession(session: SchoolSession): string {
    const cookieHeader: string = typeof session.cookieHeader === 'string' ? session.cookieHeader.trim() : '';
    if (cookieHeader.length === 0 || cookieHeader.indexOf(SCHOOL_SESSION_COOKIE) < 0) {
      throw new SchoolReadError(SCHOOL_LOGIN_REQUIRED, 'session cookie missing');
    }
    return cookieHeader;
  }

  private async run(cookieHeader: string, onProgress?: (stage: string) => void): Promise<SchoolReadResult> {
    this.emitProgress(onProgress, 'session-check');
    const frameBody: string = await this.fetchPage(FRAME_URL, cookieHeader, 'session-check');
    const frameProfile: StudentProfile | null = this.parseProfile(frameBody);

    this.emitProgress(onProgress, 'page-meta');
    const metaBody: string = await this.fetchPage(TABLE_PROBE_URL, cookieHeader, 'page-meta');
    const meta: PageMeta | null = this.deps.parser.parseTimetablePage(metaBody);
    if (meta === null) {
      throw new SchoolReadError(SCHOOL_PARSE_FAILED, 'timetable page meta missing');
    }
    if (!SEMESTER_ID_RE.test(meta.semesterId)) {
      throw new SchoolReadError(SCHOOL_PARSE_FAILED, 'semester id invalid');
    }
    const semesterId: string = meta.semesterId;
    const modeId: string = meta.modeId;

    this.emitProgress(onProgress, 'weeks');
    const totalWeeks: number = await this.fetchTotalWeeks(semesterId, cookieHeader);
    const monday: string = semesterMonday(semesterId);
    if (monday.length === 0 || !isMondayDate(monday)) {
      throw new SchoolReadError(SCHOOL_PARSE_FAILED, 'semester start date unknown');
    }

    this.emitProgress(onProgress, 'rows');
    const rowsBody: string = await this.fetchRows(semesterId, modeId, cookieHeader);
    const options: TimetableParseOptions = {
      semesterId: semesterId,
      totalWeeks: totalWeeks,
      modeId: modeId,
      sourceLabel: this.sourceLabel(),
      startDate: monday
    };
    this.emitProgress(onProgress, 'parse');
    const parsed: ParsedTimetable = this.parseTimetable(rowsBody, options);
    if (parsed.rules.length < 1) {
      throw new SchoolReadError(SCHOOL_EMPTY_TIMETABLE, 'no timetable rules');
    }

    const snapshot: SemesterSnapshot = {
      id: 'jsxsd-' + monday,
      name: this.semesterName(semesterId),
      startDate: monday,
      weeks: totalWeeks,
      rules: parsed.rules,
      unscheduled: parsed.unscheduled,
      exceptions: parsed.exceptions,
      source: { kind: 'school', label: this.sourceLabel() },
      studentProfile: frameProfile
    };
    this.emitProgress(onProgress, 'save');
    return { snapshot: snapshot, profile: frameProfile, fetchedAt: this.deps.now() };
  }

  // 进度回调只用于展示：回调本身抛错不得中断读取（吞掉并继续）。
  private emitProgress(onProgress: ((stage: string) => void) | undefined, stage: string): void {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress(stage);
    } catch (error) {
      // ignore progress callback failure
    }
  }

  private async fetchPage(url: string, cookieHeader: string, stage: string): Promise<string> {
    const liveCookie: string = await this.cookieFor(url, cookieHeader);
    const timeoutMs: number = this.timeoutMs();
    let response: SchoolHttpResponse;
    try {
      response = await this.deps.http.get(url, liveCookie, timeoutMs);
    } catch (error) {
      const failure: Error | null = error instanceof Error ? error : null;
      throw this.mapHttpFailure(failure);
    }
    const status: number = typeof response.status === 'number' ? response.status : 0;
    if (status === 401 || status === 403) {
      throw new SchoolReadError(SCHOOL_SESSION_EXPIRED, 'http status ' + String(status));
    }
    if (status !== 200) {
      throw new SchoolReadError(SCHOOL_NETWORK_FAILED, 'http status ' + String(status));
    }
    const body: string = typeof response.body === 'string' ? response.body : '';
    if (body.length === 0) {
      throw new SchoolReadError(SCHOOL_NETWORK_FAILED, 'empty response');
    }
    this.checkSessionPage(body);
    return body;
  }

  private async cookieFor(url: string, fallback: string): Promise<string> {
    try {
      const live: string = await this.deps.cookies.read(url);
      if (typeof live === 'string' && live.indexOf(SCHOOL_SESSION_COOKIE) >= 0) return live;
    } catch (error) {
      return fallback;
    }
    return fallback;
  }

  // 登录页优先于验证码页：同一页同时含登录表单与验证码时按 SCHOOL_LOGIN_REQUIRED 处理，
  // SCHOOL_CAPTCHA_REQUIRED 只用于没有登录表单、仅出现验证码的页面（Lead 裁定，与 parser/§7.3 一致）。
  private checkSessionPage(body: string): void {
    if (this.deps.parser.isLoginPage(body, this.deps.lexicon)) {
      throw new SchoolReadError(SCHOOL_LOGIN_REQUIRED, 'login page detected');
    }
    if (this.deps.parser.isCaptchaPage(body, this.deps.lexicon)) {
      throw new SchoolReadError(SCHOOL_CAPTCHA_REQUIRED, 'captcha page detected');
    }
  }

  private async fetchTotalWeeks(semesterId: string, cookieHeader: string): Promise<number> {
    const url: string = WEEKS_URL_PREFIX + encodeURIComponent(semesterId);
    const body: string = await this.fetchPage(url, cookieHeader, 'weeks');
    let rows: WeekRow[];
    try {
      rows = JSON.parse(body) as WeekRow[];
    } catch (error) {
      throw new SchoolReadError(SCHOOL_PARSE_FAILED, 'weeks payload is not valid json');
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new SchoolReadError(SCHOOL_PARSE_FAILED, 'weeks payload is not a non-empty array');
    }
    // 空值/类型防御（P1-2）：weeks 载荷可能是 [null] 或 [1,null]，直接读 .jszc 会抛 TypeError，
    // 必须在 rows 阶段前转成稳定码 SCHOOL_PARSE_FAILED，避免未捕获异常冒到 UI。
    const first: WeekRow | null = rows.length > 0 ? rows[0] : null;
    if (first === null || typeof first !== 'object') {
      throw new SchoolReadError(SCHOOL_PARSE_FAILED, 'weeks first row is not an object');
    }
    let raw: number | string | undefined;
    try {
      raw = first.jszc;
    } catch (error) {
      const reason: string = error instanceof Error ? error.message : 'unreadable row';
      throw new SchoolReadError(SCHOOL_PARSE_FAILED, 'weeks first row is not readable: ' + reason);
    }
    const value: number = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(value)) {
      throw new SchoolReadError(SCHOOL_PARSE_FAILED, 'total weeks is not a number');
    }
    const totalWeeks: number = Math.trunc(value);
    if (totalWeeks < 1 || totalWeeks > MAX_WEEKS) {
      throw new SchoolReadError(SCHOOL_PARSE_FAILED, 'total weeks out of range');
    }
    return totalWeeks;
  }

  private async fetchRows(semesterId: string, modeId: string, cookieHeader: string): Promise<string> {
    const url: string = rowsUrl(semesterId, modeId, this.deps.rowsFilter);
    const body: string = await this.fetchPage(url, cookieHeader, 'rows');
    let payload: RowsPayload;
    try {
      payload = JSON.parse(body) as RowsPayload;
    } catch (error) {
      throw new SchoolReadError(SCHOOL_PARSE_FAILED, 'rows payload is not valid json');
    }
    if (payload === null || typeof payload !== 'object') {
      throw new SchoolReadError(SCHOOL_PARSE_FAILED, 'rows payload is not an object');
    }
    if (payload.flag1 === 2 || payload.flag1 === 3) {
      throw new SchoolReadError(SCHOOL_SESSION_EXPIRED, 'session flag ' + String(payload.flag1));
    }
    if (payload.code !== 0) {
      throw new SchoolReadError(SCHOOL_PARSE_FAILED, 'rows code is not zero');
    }
    if (!Array.isArray(payload.data)) {
      throw new SchoolReadError(SCHOOL_PARSE_FAILED, 'rows data is not an array');
    }
    if (payload.data.length === 0) {
      throw new SchoolReadError(SCHOOL_EMPTY_TIMETABLE, 'rows data is empty');
    }
    return body;
  }

  private parseTimetable(body: string, options: TimetableParseOptions): ParsedTimetable {
    try {
      return this.deps.parser.parseTimetable(body, options, this.deps.lexicon);
    } catch (error) {
      const message: string = error instanceof Error ? error.message : '';
      throw this.mapParserFailure(message);
    }
  }

  private parseProfile(body: string): StudentProfile | null {
    try {
      return this.deps.parser.parseProfile(body, this.deps.lexicon);
    } catch (error) {
      return null;
    }
  }

  private mapHttpFailure(error: Error | null): SchoolReadError {
    // 优先读取平台 HttpError.code（稳定 ASCII），其次才回退 message 文本；
    // 两者都不依赖服务器原文，错误 detail 只含状态码与阶段。
    let failure: PlatformFailure = { code: '', message: '' };
    if (error !== null && typeof error === 'object') {
      failure = error as PlatformFailure;
    }
    const code: string = typeof failure.code === 'string' ? failure.code : '';
    const message: string = typeof failure.message === 'string' ? failure.message : '';
    const text: string = code.length > 0 ? code : message;
    if (text.indexOf(SCHOOL_TIMEOUT) >= 0) {
      return new SchoolReadError(SCHOOL_TIMEOUT, 'request timed out');
    }
    const statusMatch: RegExpExecArray | null = /HTTP_([0-9]{3})/.exec(text);
    if (statusMatch !== null) {
      const status: number = Number(statusMatch[1]);
      if (status === 401 || status === 403) {
        return new SchoolReadError(SCHOOL_SESSION_EXPIRED, 'http status ' + String(status));
      }
      return new SchoolReadError(SCHOOL_NETWORK_FAILED, 'http status ' + String(status));
    }
    return new SchoolReadError(SCHOOL_NETWORK_FAILED, 'network request failed');
  }

  private mapParserFailure(message: string): SchoolReadError {
    if (message.indexOf(SCHOOL_LOGIN_REQUIRED) === 0) {
      return new SchoolReadError(SCHOOL_LOGIN_REQUIRED, 'login page detected');
    }
    if (message.indexOf(SCHOOL_CAPTCHA_REQUIRED) === 0) {
      return new SchoolReadError(SCHOOL_CAPTCHA_REQUIRED, 'captcha page detected');
    }
    if (message.indexOf(SCHOOL_EMPTY_TIMETABLE) === 0) {
      return new SchoolReadError(SCHOOL_EMPTY_TIMETABLE, 'timetable is empty');
    }
    return new SchoolReadError(SCHOOL_PARSE_FAILED, 'timetable parse failed');
  }

  private timeoutMs(): number {
    const value: number | undefined = this.deps.timeoutMs;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value);
    return DEFAULT_TIMEOUT_MS;
  }

  private sourceLabel(): string {
    const label: string | undefined = this.deps.sourceLabel;
    return typeof label === 'string' && label.length > 0 ? label : 'school';
  }

  private semesterName(semesterId: string): string {
    const name: string | undefined = this.deps.semesterName;
    return typeof name === 'string' && name.length > 0 ? name : semesterId;
  }
}

/**
 * 归一出“是否需要重登”的判断码。
 * 优先 SchoolReadError.code，其次平台错误对象上的 code，最后才看 message 前缀；
 * 不认识的一律返回空串（不触发重登、原样上抛），避免把解析/空表错误误判成会话问题。
 */
function readErrorCode(error: Error): string {
  if (error instanceof SchoolReadError) return error.code;
  const failure: PlatformFailure = error as PlatformFailure;
  const code: string = typeof failure.code === 'string' ? failure.code : '';
  if (code.length > 0) return code;
  const message: string = typeof failure.message === 'string' ? failure.message : '';
  for (const known of RELOGIN_CODES) {
    if (message.indexOf(known) === 0) return known;
  }
  return '';
}
