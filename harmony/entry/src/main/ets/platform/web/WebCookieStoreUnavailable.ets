// 职责：WebCookieStore 的静态降级实现（无 Web 组件/权限时）。
// 依赖方向：platform/web -> core/types（仅类型/枚举值），不访问任何 Kit。
// 阶段：P4；所有读取一律返回空串或 false，表示“无会话”，由编排层映射 SCHOOL_LOGIN_REQUIRED。
// 安全口径：不缓存、不落盘、不打印任何 cookie；不提供写入 jar 的能力。

import type { ErrorCode } from '../../core/types/Common';
import type { WebCookieStore } from './WebCookieStore';

export const WEB_UNAVAILABLE: ErrorCode = 'WEB_UNAVAILABLE' as ErrorCode;

export class WebCookieStoreUnavailable implements WebCookieStore {
  async cookieHeaderFor(url: string, incognito?: boolean): Promise<string> {
    return '';
  }

  async contains(url: string, name: string, incognito?: boolean): Promise<boolean> {
    return false;
  }

  async clearSchoolCookies(): Promise<boolean> {
    return false;
  }

  // 无 Web 组件时不具备写回 jar 的能力，换票结果无法落地 -> 一律 false。
  async applySessionCookies(setCookies: string[]): Promise<boolean> {
    return false;
  }
}
