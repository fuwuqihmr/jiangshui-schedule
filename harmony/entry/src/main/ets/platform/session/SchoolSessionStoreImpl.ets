// 职责：学校会话的沙箱持久化实现（P4 79b，规格 §2.3）。
// 依赖方向：platform/session -> @kit.CoreFileKit、@ohos.data.preferences、data/SchoolSessionStore 契约。
// 阶段：P4；cookieHeader 只写应用私有目录下的 school-session.bin，Preferences 只存
//          updatedAt / hasCookie / semesterId 三个元数据键，不把 cookie 写进 Preferences。
// 安全口径：不写日志、不导出、不参与备份；文件内容不加密——HUKS/Asset 方案待安全评审，
//          当前口径是“沙箱文件 + 应用私有目录（安全待确认）”，不得对外声称“已加密”。
// 待确认：fileIo 原子写与 preferences.get/put 在 API 12 的签名以官方文档/真机为准。

import { fileIo as fs } from '@kit.CoreFileKit';
import preferences from '@ohos.data.preferences';
import type { common } from '@kit.AbilityKit';
import { ErrorCode } from '../../core/types/Common';
import type { SchoolSession } from '../../core/types/Leave';
import {
  isSchoolSessionUsable,
  normalizeSchoolSession,
  SCHOOL_SESSION_META_HAS_COOKIE,
  SCHOOL_SESSION_META_SEMESTER_ID,
  SCHOOL_SESSION_META_UPDATED_AT
} from '../../data/SchoolSessionStore';
import type { SchoolSessionMetadata, SchoolSessionStore } from '../../data/SchoolSessionStore';

const SESSION_FILE_NAME: string = '/school-session.bin';
const PREFS_NAME: string = 'jiangshui.school.session';

const EMPTY_METADATA: SchoolSessionMetadata = { updatedAt: 0, hasCookie: false, semesterId: '' };

class CoreSchoolSessionStore implements SchoolSessionStore {
  private readonly path: string;
  private readonly prefs: preferences.Preferences;

  constructor(context: common.UIAbilityContext, prefs: preferences.Preferences) {
    this.path = context.filesDir + SESSION_FILE_NAME;
    this.prefs = prefs;
  }

  async load(): Promise<SchoolSession | null> {
    let raw: string = '';
    try {
      raw = fs.readTextSync(this.path);
    } catch (error) {
      return null;
    }
    if (typeof raw !== 'string' || raw.length === 0) return null;
    let parsed: SchoolSession | null = null;
    try {
      parsed = JSON.parse(raw) as SchoolSession;
    } catch (error) {
      return null;
    }
    if (parsed === null || !isSchoolSessionUsable(parsed)) return null;
    return normalizeSchoolSession(parsed);
  }

  async save(session: SchoolSession): Promise<void> {
    const normalized: SchoolSession = normalizeSchoolSession(session);
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
      // 写入/rename 失败时清理临时文件，避免含 cookie 的 .tmp 残留（明文不落盘）。
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
      await this.prefs.delete(SCHOOL_SESSION_META_UPDATED_AT);
      await this.prefs.delete(SCHOOL_SESSION_META_HAS_COOKIE);
      await this.prefs.delete(SCHOOL_SESSION_META_SEMESTER_ID);
      await this.prefs.flush();
    } catch (error) {
      throw new Error(ErrorCode.PREFERENCES_UNAVAILABLE);
    }
  }

  async metadata(): Promise<SchoolSessionMetadata> {
    try {
      const updatedRaw = await this.prefs.get(SCHOOL_SESSION_META_UPDATED_AT, 0);
      const hasRaw = await this.prefs.get(SCHOOL_SESSION_META_HAS_COOKIE, false);
      const semesterRaw = await this.prefs.get(SCHOOL_SESSION_META_SEMESTER_ID, '');
      const updatedValue: number = typeof updatedRaw === 'number' ? updatedRaw : Number(updatedRaw);
      return {
        updatedAt: Number.isFinite(updatedValue) ? updatedValue : 0,
        hasCookie: hasRaw === true,
        semesterId: typeof semesterRaw === 'string' ? semesterRaw : ''
      };
    } catch (error) {
      return EMPTY_METADATA;
    }
  }

  private async writeMetadata(session: SchoolSession): Promise<void> {
    const semesterId: string = typeof session.semesterId === 'string' ? session.semesterId : '';
    try {
      await this.prefs.put(SCHOOL_SESSION_META_UPDATED_AT, session.updatedAt);
      await this.prefs.put(SCHOOL_SESSION_META_HAS_COOKIE, true);
      await this.prefs.put(SCHOOL_SESSION_META_SEMESTER_ID, semesterId);
      await this.prefs.flush();
    } catch (error) {
      throw new Error(ErrorCode.PREFERENCES_UNAVAILABLE);
    }
  }
}

export async function createSchoolSessionStore(context: common.UIAbilityContext): Promise<SchoolSessionStore> {
  try {
    const prefs: preferences.Preferences = await preferences.getPreferences(context, PREFS_NAME);
    return new CoreSchoolSessionStore(context, prefs);
  } catch (error) {
    throw new Error(ErrorCode.PREFERENCES_UNAVAILABLE);
  }
}

export class SchoolSessionStoreUnavailable implements SchoolSessionStore {
  async load(): Promise<SchoolSession | null> {
    return null;
  }

  async save(session: SchoolSession): Promise<void> {
    return Promise.reject(new Error(ErrorCode.STATE_FILE_UNAVAILABLE));
  }

  async clear(): Promise<void> {
    return Promise.resolve();
  }

  async metadata(): Promise<SchoolSessionMetadata> {
    return EMPTY_METADATA;
  }
}
