// 职责：CAS 票据授权 cookie（TGC）的沙箱持久化实现（配合无痕 WebView 的静默重登）。
// 依赖方向：platform/session -> @kit.CoreFileKit、@ohos.data.preferences、data/SchoolTicketStore 契约。
// 阶段：P4；TGC 只写应用私有目录下的 school-ticket.bin，Preferences 只存
//          updatedAt / hasTgc 两个元数据键，不把 TGC 值写进 Preferences。
// 安全口径：TGC 等价于登录凭据，明文、未加密；不写日志、不导出、不参与备份。
//          当前口径是“沙箱文件 + 应用私有目录（安全待确认）”，不得对外声称“已加密”。
// 待确认：fileIo 原子写与 preferences.get/put 在 API 12 的签名以官方文档/真机为准。

import { fileIo as fs } from '@kit.CoreFileKit';
import preferences from '@ohos.data.preferences';
import type { common } from '@kit.AbilityKit';
import { ErrorCode } from '../../core/types/Common';
import {
  isSchoolTicketUsable,
  normalizeSchoolTicket,
  SCHOOL_TICKET_META_HAS_TGC,
  SCHOOL_TICKET_META_UPDATED_AT
} from '../../data/SchoolTicketStore';
import type { SchoolTicket, SchoolTicketMetadata, SchoolTicketStore } from '../../data/SchoolTicketStore';

export const STATE_FILE_UNAVAILABLE: ErrorCode = 'STATE_FILE_UNAVAILABLE' as ErrorCode;

const TICKET_FILE_NAME: string = '/school-ticket.bin';
const PREFS_NAME: string = 'jiangshui.school.ticket';

const EMPTY_METADATA: SchoolTicketMetadata = { updatedAt: 0, hasTgc: false };

class CoreSchoolTicketStore implements SchoolTicketStore {
  private readonly path: string;
  private readonly prefs: preferences.Preferences;

  constructor(context: common.UIAbilityContext, prefs: preferences.Preferences) {
    this.path = context.filesDir + TICKET_FILE_NAME;
    this.prefs = prefs;
  }

  async load(): Promise<SchoolTicket | null> {
    let raw: string = '';
    try {
      raw = fs.readTextSync(this.path);
    } catch (error) {
      return null;
    }
    if (typeof raw !== 'string' || raw.length === 0) return null;
    let parsed: SchoolTicket | null = null;
    try {
      parsed = JSON.parse(raw) as SchoolTicket;
    } catch (error) {
      return null;
    }
    if (parsed === null || !isSchoolTicketUsable(parsed)) return null;
    return normalizeSchoolTicket(parsed);
  }

  async save(ticket: SchoolTicket): Promise<void> {
    const normalized: SchoolTicket = normalizeSchoolTicket(ticket);
    const tmp: string = this.path + '.tmp';
    try {
      const payload: string = JSON.stringify(normalized);
      const file = fs.openSync(tmp, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      try {
        fs.writeSync(file.fd, payload);
        fs.fsyncSync(file.fd);
      } finally {
        fs.closeSync(file);
      }
      fs.renameSync(tmp, this.path);
    } catch (error) {
      // 写入/rename 失败时清理临时文件，避免含 TGC 的 .tmp 残留。
      try {
        fs.unlinkSync(tmp);
      } catch (cleanupError) {
        // 临时文件不存在或已被清理时忽略。
      }
      throw new Error(ErrorCode.STATE_WRITE_FAILED);
    }
    await this.writeMetadata(normalized);
  }

  async clear(): Promise<void> {
    try {
      fs.unlinkSync(this.path);
    } catch (error) {
      // 文件不存在按已清理处理，继续清理元数据。
    }
    try {
      await this.prefs.delete(SCHOOL_TICKET_META_UPDATED_AT);
      await this.prefs.delete(SCHOOL_TICKET_META_HAS_TGC);
      await this.prefs.flush();
    } catch (error) {
      throw new Error(ErrorCode.PREFERENCES_UNAVAILABLE);
    }
  }

  async metadata(): Promise<SchoolTicketMetadata> {
    try {
      const updatedRaw = await this.prefs.get(SCHOOL_TICKET_META_UPDATED_AT, 0);
      const hasRaw = await this.prefs.get(SCHOOL_TICKET_META_HAS_TGC, false);
      const updatedValue: number = typeof updatedRaw === 'number' ? updatedRaw : Number(updatedRaw);
      return {
        updatedAt: Number.isFinite(updatedValue) ? updatedValue : 0,
        hasTgc: hasRaw === true
      };
    } catch (error) {
      return EMPTY_METADATA;
    }
  }

  private async writeMetadata(ticket: SchoolTicket): Promise<void> {
    try {
      await this.prefs.put(SCHOOL_TICKET_META_UPDATED_AT, ticket.updatedAt);
      await this.prefs.put(SCHOOL_TICKET_META_HAS_TGC, true);
      await this.prefs.flush();
    } catch (error) {
      throw new Error(ErrorCode.PREFERENCES_UNAVAILABLE);
    }
  }
}

export async function createSchoolTicketStore(context: common.UIAbilityContext): Promise<SchoolTicketStore> {
  try {
    const prefs: preferences.Preferences = await preferences.getPreferences(context, PREFS_NAME);
    return new CoreSchoolTicketStore(context, prefs);
  } catch (error) {
    throw new Error(ErrorCode.PREFERENCES_UNAVAILABLE);
  }
}

/**
 * 延迟解析 UIAbilityContext 的包装：SchoolReader 在生产装配时没有 context 参数，
 * 第一次真正读/写 TGC 时再从当前 UI 上下文取。取不到时 load 返回 null、save 抛稳定码，
 * 由 PlatformSchoolRelogin 按“持久化不可用”降级，不影响 jar 里已有 TGC 的路径。
 */
class LazySchoolTicketStore implements SchoolTicketStore {
  private readonly context: common.UIAbilityContext | null;
  private store: SchoolTicketStore | null = null;

  constructor(context?: common.UIAbilityContext) {
    this.context = context === undefined ? null : context;
  }

  async load(): Promise<SchoolTicket | null> {
    try {
      const target: SchoolTicketStore = await this.resolve();
      return await target.load();
    } catch (error) {
      return null;
    }
  }

  async save(ticket: SchoolTicket): Promise<void> {
    const target: SchoolTicketStore = await this.resolve();
    await target.save(ticket);
  }

  async clear(): Promise<void> {
    const target: SchoolTicketStore = await this.resolve();
    await target.clear();
  }

  async metadata(): Promise<SchoolTicketMetadata> {
    try {
      const target: SchoolTicketStore = await this.resolve();
      return await target.metadata();
    } catch (error) {
      return EMPTY_METADATA;
    }
  }

  private async resolve(): Promise<SchoolTicketStore> {
    if (this.store !== null) return this.store;
    const ctx: common.UIAbilityContext = this.context !== null
      ? this.context
      : (getContext() as common.UIAbilityContext);
    const created: SchoolTicketStore = await createSchoolTicketStore(ctx);
    this.store = created;
    return created;
  }
}

export function createLazySchoolTicketStore(context?: common.UIAbilityContext): SchoolTicketStore {
  return new LazySchoolTicketStore(context);
}

export class SchoolTicketStoreUnavailable implements SchoolTicketStore {
  async load(): Promise<SchoolTicket | null> {
    return null;
  }

  async save(ticket: SchoolTicket): Promise<void> {
    return Promise.reject(new Error(ErrorCode.STATE_FILE_UNAVAILABLE));
  }

  async clear(): Promise<void> {
    return Promise.resolve();
  }

  async metadata(): Promise<SchoolTicketMetadata> {
    return EMPTY_METADATA;
  }
}
