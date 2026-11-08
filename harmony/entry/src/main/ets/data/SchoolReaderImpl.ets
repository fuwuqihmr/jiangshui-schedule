// 职责：data 层学校读取实现（P4 81b，规格 §2.10 / §3.2）：组合 data/SchoolReadOrchestrator + StateRepository 持久化。
// 依赖方向：data -> core/types、data/SchoolReadOrchestrator、data/StateRepository；不 import platform/Kit。
//           Kit 装配仍留在 platform/school/SchoolReader.ets（HttpGateway + WebCookieStore 适配器）。
// 口径：成功路径才更新 snapshot/lastSuccess，经 StateRepository 的原子写 + revision 校验落盘；
// 失败路径（P1）也更新 lastAttempt 与稳定错误码，但绝不覆盖旧 snapshot / lastSuccess；
//       原始读取错误原样透传，不被本层吞掉；失败态持久化异常也不得覆盖原始错误。
// 隐私：AppState.error 只存 9 个 ASCII 稳定码之一（等价于经 Redactor 过滤），不写服务器原文、Cookie 或响应体。
// 待确认：编排器的构造参数由 platform 层装配；本类不新增任何 Kit API。

import type { PlatformFailure, SchoolReadOrchestrator } from './SchoolReadOrchestrator';
import type { AppState, SemesterSnapshot } from '../core/types/AppState';
import type { SchoolReadResult, SchoolReader, SchoolSession, StudentProfile } from '../core/types/Leave';
import type { SchoolReadService } from '../core/types/Services';
import type { StateRepository } from './StateRepository';

// 与 core/types/Common 的 ErrorCode 稳定码一一对应（ASCII 白名单；不运行时 import enum，保持 core 可 Node 跑）。
const STABLE_READ_CODES: string[] = [
  'SCHOOL_LOGIN_REQUIRED',
  'SCHOOL_CAPTCHA_REQUIRED',
  'SCHOOL_NETWORK_FAILED',
  'SCHOOL_TIMEOUT',
  'SCHOOL_SESSION_EXPIRED',
  'SCHOOL_PARSE_FAILED',
  'SCHOOL_EMPTY_TIMETABLE',
  'OFFICE_SESSION_REQUIRED',
  'OFFICE_UNAVAILABLE'
];

const FALLBACK_READ_CODE: string = 'SCHOOL_PARSE_FAILED';

// 把任意读取异常归一为稳定错误码：优先取 code 字段，其次取消息前缀；不接受服务器原文。
function stableReadCode(error: Error): string {
  const failure: PlatformFailure = error as PlatformFailure;
  const code: string = typeof failure.code === 'string' ? failure.code : '';
  for (let i = 0; i < STABLE_READ_CODES.length; i++) {
    if (STABLE_READ_CODES[i] === code) return code;
  }
  const message: string = typeof failure.message === 'string' ? failure.message : '';
  for (let i = 0; i < STABLE_READ_CODES.length; i++) {
    const candidate: string = STABLE_READ_CODES[i];
    if (message.indexOf(candidate) === 0) return candidate;
  }
  return FALLBACK_READ_CODE;
}

export interface SchoolReadPersistenceOptions {
  clock?: () => number;
}

export class SchoolReaderImpl implements SchoolReader, SchoolReadService {
  private readonly orchestrator: SchoolReadOrchestrator;
  private readonly repository: StateRepository;
  private readonly clock: () => number;

  constructor(orchestrator: SchoolReadOrchestrator, repository: StateRepository, options?: SchoolReadPersistenceOptions) {
    this.orchestrator = orchestrator;
    this.repository = repository;
    this.clock = options !== undefined && options.clock !== undefined ? options.clock : (): number => Date.now();
  }

  async read(session: SchoolSession): Promise<SchoolReadResult> {
    let result: SchoolReadResult;
    try {
      result = await this.orchestrator.read(session);
    } catch (error) {
      await this.persistFailure(error instanceof Error ? error : new Error('school read failed'));
      throw error;
    }
    await this.persistSuccess(result);
    return result;
  }

  async readTimetable(session: SchoolSession): Promise<SemesterSnapshot> {
    const result: SchoolReadResult = await this.read(session);
    return result.snapshot;
  }

  async readProfile(session: SchoolSession): Promise<StudentProfile | null> {
    return this.orchestrator.readProfile(session);
  }

  private async persistSuccess(result: SchoolReadResult): Promise<void> {
    const state: AppState = await this.repository.load();
    const now: number = this.clock();
    state.snapshot = result.snapshot;
    state.lastSuccess = now;
    state.lastAttempt = now;
    state.error = null;
    const expectedRevision: number = typeof state._revision === 'number' ? state._revision : 0;
    await this.repository.save(state, expectedRevision);
  }

  // 失败也更新 lastAttempt：只改 lastAttempt/error，不触碰 snapshot/lastSuccess；
  // 若失败态落盘本身出错，吞掉该持久化异常并继续抛出原始读取错误（错误码透传不吞）。
  private async persistFailure(error: Error): Promise<void> {
    const code: string = stableReadCode(error);
    try {
      const state: AppState = await this.repository.load();
      state.lastAttempt = this.clock();
      state.error = code;
      const expectedRevision: number = typeof state._revision === 'number' ? state._revision : 0;
      await this.repository.save(state, expectedRevision);
    } catch (persistError) {
      // 失败态持久化异常不得覆盖原始读取错误；lastAttempt 在内存状态上已更新。
    }
  }
}
