// 职责：学校教务读取的装配层（P4 79b，规格 §2.10）：HttpGateway + WebCookieStore + JsxsdParser -> 编排器。
// 依赖方向：platform/school -> platform/network、platform/web、core/parser、core/types；页面只拿接口。
// 阶段：P4；本层不做解析、不驻留业务状态，只做接口适配与依赖注入。
// 安全口径：cookieHeader 只在内存中作为 Cookie 头传给 HttpGateway；不打印、不落盘、不进页面。
//           “登录/验证码/会话失效”等中文文案由页面按 ErrorCode 映射，本层只抛稳定码。

import { ErrorCode } from '../../core/types/Common';
import {
  isCaptchaPage,
  isLoginPage,
  parseProfile,
  parseTimetable,
  parseTimetablePage
} from '../../core/parser/JsxsdParser';
import type { PageMeta, ParsedTimetable, TimetableParseOptions } from '../../core/parser/JsxsdParser';
import { SCHOOL_REDIRECT_ORIGINS as CORE_REDIRECT_ORIGINS } from '../../core/parser/SchoolUrls';
import { SchoolReadOrchestrator } from '../../data/SchoolReadOrchestrator';
import type {
  SchoolCookieReader,
  SchoolHttpClient,
  SchoolHttpResponse,
  SchoolParserApi,
  SchoolReadDeps,
  SchoolReloginPort
} from '../../data/SchoolReadOrchestrator';
import type { SchoolLexicon } from '../../core/parser/SchoolLexicon';
import type { SemesterSnapshot } from '../../core/types/AppState';
import type { SchoolReadResult, SchoolReader, SchoolSession, StudentProfile } from '../../core/types/Leave';
import type { SchoolReadService } from '../../core/types/Services';
import type { HttpGateway } from '../network/HttpGateway';
import type { WebCookieStore } from '../web/WebCookieStore';
import { PlatformSchoolRelogin } from './SchoolRelogin';
import { createLazySchoolTicketStore } from '../session/SchoolTicketStoreImpl';

// 静态降级标记：本文件在 platform 层，保留已定义的 NETWORK_UNAVAILABLE 作为网关不可用标记；
// 运行时对 UI 抛稳定码 SCHOOL_NETWORK_FAILED（与编排层 mapHttpFailure 的归一结果一致）。
export const NETWORK_UNAVAILABLE: ErrorCode = 'NETWORK_UNAVAILABLE' as ErrorCode;

/**
 * 教务链路允许跟随的重定向 origin 白名单（单一真源）。
 * 键是完整 origin scheme://host[:port]（scheme 精确比对，禁止 HTTPS→HTTP 降级）；
 * 数组本体在 core/parser/SchoolUrls.SCHOOL_REDIRECT_ORIGINS，这里只 re-export 给 HttpGateway。
 * 含 CAS 成功回跳实测出现的 http:80 与 https:443 两个默认端口 origin。
 * 白名单外的 3xx 一律由 HttpGateway 抛 SCHOOL_NETWORK_FAILED，不做跳转（不用通配）。
 */
export const SCHOOL_REDIRECT_ORIGINS: string[] = CORE_REDIRECT_ORIGINS;

const JXS_PARSER: SchoolParserApi = {
  parseTimetablePage: (html: string): PageMeta | null => parseTimetablePage(html),
  parseTimetable: (body: string, options: TimetableParseOptions, lexicon: SchoolLexicon): ParsedTimetable =>
    parseTimetable(body, options, lexicon),
  isLoginPage: (html: string, lexicon: SchoolLexicon): boolean => isLoginPage(html, lexicon),
  isCaptchaPage: (html: string, lexicon: SchoolLexicon): boolean => isCaptchaPage(html, lexicon),
  parseProfile: (html: string, lexicon: SchoolLexicon): StudentProfile | null => parseProfile(html, lexicon)
};

class GatewaySchoolHttpClient implements SchoolHttpClient {
  private readonly gateway: HttpGateway;

  constructor(gateway: HttpGateway) {
    this.gateway = gateway;
  }

  async get(url: string, cookieHeader: string, timeoutMs: number): Promise<SchoolHttpResponse> {
    const response = await this.gateway.request({
      url: url,
      method: 'GET',
      headers: { 'Cookie': cookieHeader },
      timeoutMs: timeoutMs,
      allowedRedirectOrigins: SCHOOL_REDIRECT_ORIGINS
    });
    const result: SchoolHttpResponse = { status: response.status, body: response.body };
    return result;
  }
}

class CookieReaderAdapter implements SchoolCookieReader {
  private readonly cookies: WebCookieStore;

  constructor(cookies: WebCookieStore) {
    this.cookies = cookies;
  }

  async read(url: string): Promise<string> {
    return this.cookies.cookieHeaderFor(url);
  }

  // P1-B round 3：静默重登前清除教务域 cookie（死票），实现委托给 PlatformWebCookieStore。
  async clear(): Promise<boolean> {
    try {
      return await this.cookies.clearSchoolCookies();
    } catch (error) {
      return false;
    }
  }
}

function buildOrchestrator(
  http: HttpGateway,
  cookies: WebCookieStore,
  lexicon: SchoolLexicon,
  sourceLabel: string,
  semesterName: string,
  rowsFilter: string,
  relogin: SchoolReloginPort
): SchoolReadOrchestrator {
  const deps: SchoolReadDeps = {
    http: new GatewaySchoolHttpClient(http),
    cookies: new CookieReaderAdapter(cookies),
    parser: JXS_PARSER,
    lexicon: lexicon,
    now: () => Date.now(),
    sourceLabel: sourceLabel,
    semesterName: semesterName,
    rowsFilter: rowsFilter,
    relogin: relogin
  };
  return new SchoolReadOrchestrator(deps);
}

export class SchoolReaderImpl implements SchoolReader, SchoolReadService {
  private readonly orchestrator: SchoolReadOrchestrator;

  constructor(
    http: HttpGateway,
    cookies: WebCookieStore,
    lexicon: SchoolLexicon,
    sourceLabel?: string,
    semesterName?: string,
    rowsFilter?: string,
    relogin?: SchoolReloginPort
  ) {
    const label: string = typeof sourceLabel === 'string' && sourceLabel.length > 0 ? sourceLabel : 'school';
    const name: string = typeof semesterName === 'string' && semesterName.length > 0 ? semesterName : '';
    const filter: string = typeof rowsFilter === 'string' ? rowsFilter : '';
    // 静默重登端口：缺省装配真实 TGC 换票实现；测试/降级场景可注入替身。
    let port: SchoolReloginPort;
    if (relogin !== undefined) {
      port = relogin;
    } else {
      const real: PlatformSchoolRelogin = new PlatformSchoolRelogin(http, cookies, JXS_PARSER, lexicon);
      // 无痕 jar 重启后没有 TGC，换票时回落读自有沙箱文件；延迟到首次使用才解析 context。
      real.attachTicketStore(createLazySchoolTicketStore());
      port = real;
    }
    this.orchestrator = buildOrchestrator(http, cookies, lexicon, label, name, filter, port);
  }

  // onProgress 可选：透传编排层的阶段进度（§5.2 stage 白名单），供 UI 显示 §6.3 读取阶段。
  async read(session: SchoolSession, onProgress?: (stage: string) => void): Promise<SchoolReadResult> {
    return this.orchestrator.read(session, onProgress);
  }

  async readTimetable(session: SchoolSession): Promise<SemesterSnapshot> {
    const result: SchoolReadResult = await this.orchestrator.read(session);
    return result.snapshot;
  }

  async readProfile(session: SchoolSession): Promise<StudentProfile | null> {
    return this.orchestrator.readProfile(session);
  }
}

export class SchoolReaderUnavailable implements SchoolReader, SchoolReadService {
  async read(session: SchoolSession): Promise<SchoolReadResult> {
    return Promise.reject(new Error(ErrorCode.SCHOOL_NETWORK_FAILED));
  }

  async readTimetable(session: SchoolSession): Promise<SemesterSnapshot> {
    return Promise.reject(new Error(ErrorCode.SCHOOL_NETWORK_FAILED));
  }

  async readProfile(session: SchoolSession): Promise<StudentProfile | null> {
    return Promise.reject(new Error(ErrorCode.SCHOOL_NETWORK_FAILED));
  }
}
