// 职责：学校 URL 策略门面（P4 79b，规格 §3.1）。
// 依赖方向：platform/web -> core/parser/SchoolUrls（纯函数）；本层只做拒绝语义与门面封装。
// 阶段：P4；页面、WebView 与 SchoolReader 统一经本策略判断 URL，不各自复制白名单。
// 安全口径：requireAllowed 在拒绝时以 WEB_UNAVAILABLE 明确失败；service 参数只从当前 URL 的 query
//          原样取出，不做解码、不拼接、不回写。
// 待确认：eapp2 备用域、门户域与 443/9443 端口口径以官方文档与真机为准。

import {
  extractServiceParam,
  isAllowedSchoolRedirect,
  isAllowedSchoolUrl,
  isJiaowuTimetableUrl,
  schoolUrlBlockReason
} from '../../core/parser/SchoolUrls';
import type { ErrorCode } from '../../core/types/Common';

export const WEB_UNAVAILABLE: ErrorCode = 'WEB_UNAVAILABLE' as ErrorCode;

export class SchoolUrlPolicy {
  isAllowed(url: string): boolean {
    try {
      return isAllowedSchoolUrl(url);
    } catch (error) {
      return false;
    }
  }

  /**
   * 拒绝原因只用于日志分层（host/scheme/port/path），不返回 URL/query，
   * 避免把 ticket 等参数带进日志。空串表示严格白名单通过。
   */
  blockReason(url: string): string {
    try {
      return schoolUrlBlockReason(url);
    } catch (error) {
      return 'host';
    }
  }

  isAllowedRedirect(url: string): boolean {
    try {
      return isAllowedSchoolRedirect(url);
    } catch (error) {
      return false;
    }
  }

  isTimetableUrl(url: string): boolean {
    try {
      return isJiaowuTimetableUrl(url);
    } catch (error) {
      return false;
    }
  }

  serviceParam(url: string): string | null {
    try {
      return extractServiceParam(url);
    } catch (error) {
      return null;
    }
  }

  requireAllowed(url: string): string {
    if (!this.isAllowed(url)) {
      throw new Error(WEB_UNAVAILABLE);
    }
    return url;
  }
}
