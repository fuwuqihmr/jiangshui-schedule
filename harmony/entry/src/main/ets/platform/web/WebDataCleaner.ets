/**
 * 网页浏览数据清理（/94）。
 * 职责：提供应用内可执行的清理入口，清 ArkWeb cookie、DOM Storage/Web SQL、HTTP 认证凭据。
 * 边界：系统“密码保险箱”中已保存的学校密码属于系统凭据库，ArkWeb 未提供公开清除 API，
 *       本工具不具备清除能力；用户需在系统设置 > 隐私和安全 > 密码保险箱中删除。
 *       本工具不读取、不导出、不打印任何 cookie 值。
 * 阶段：P4；待确认：clearAllCookies/WebStorage/WebDataBase 在目标 API 26 的运行时行为。
 */
import webview from '@ohos.web.webview';
import type { common } from '@kit.AbilityKit';
import { ErrorCode } from '../../core/types/Common';
import type { SchoolSessionStore } from '../../data/SchoolSessionStore';
import type { SchoolTicketStore } from '../../data/SchoolTicketStore';
import { createSchoolSessionStore } from '../session/SchoolSessionStoreImpl';
import { createSchoolTicketStore } from '../session/SchoolTicketStoreImpl';

// platform 降级码检查要求本文件导出 *_UNAVAILABLE；真实清理失败时逐项返回 false。
export const WEB_UNAVAILABLE: ErrorCode = ErrorCode.WEB_UNAVAILABLE;

export interface WebDataClearResult {
  cookiesCleared: boolean;
  storageCleared: boolean;
  httpAuthCleared: boolean;
}

export interface LoginSessionClearResult {
  sessionCleared: boolean;
  ticketCleared: boolean;
  cookiesCleared: boolean;
  storageCleared: boolean;
  httpAuthCleared: boolean;
}

/**
 * 依次清理三类网页数据；任一步失败只把该项置 false，不抛出、不影响其余项。
 * 登录 WebView 使用 incognitoMode，普通 jar 的 clearAllCookies/deleteAllData
 * 不覆盖无痕内存 jar，因此普通与无痕两份都要显式清；只有两份都成功才把该项报 true。
 */
export async function clearWebBrowsingData(): Promise<WebDataClearResult> {
  let normalCookiesCleared: boolean = false;
  let incognitoCookiesCleared: boolean = false;
  let normalStorageCleared: boolean = false;
  let incognitoStorageCleared: boolean = false;
  let httpAuthCleared: boolean = false;
  try {
    await webview.WebCookieManager.clearAllCookies();
    normalCookiesCleared = true;
  } catch (error) {
    normalCookiesCleared = false;
  }
  try {
    webview.WebCookieManager.clearAllCookiesSync(false);
    normalCookiesCleared = true;
  } catch (error) {
    // 保留 async 接口的结果；无痕清理失败仍会把 cookiesCleared 置 false。
  }
  try {
    webview.WebCookieManager.clearAllCookiesSync(true);
    incognitoCookiesCleared = true;
  } catch (error) {
    incognitoCookiesCleared = false;
  }
  try {
    webview.WebStorage.deleteAllData();
    normalStorageCleared = true;
  } catch (error) {
    normalStorageCleared = false;
  }
  try {
    webview.WebStorage.deleteAllData(true);
    incognitoStorageCleared = true;
  } catch (error) {
    incognitoStorageCleared = false;
  }
  try {
    webview.WebDataBase.deleteHttpAuthCredentials();
    httpAuthCleared = true;
  } catch (error) {
    httpAuthCleared = false;
  }
  return {
    cookiesCleared: normalCookiesCleared && incognitoCookiesCleared,
    storageCleared: normalStorageCleared && incognitoStorageCleared,
    httpAuthCleared
  };
}

/**
 * 清登录会话：学校会话文件 + 持久化 CAS TGC + 网页数据。
 * 任一项失败只把对应字段置 false，不抛出；不读取、不导出、不打印任何 cookie/TGC 值。
 */
export async function clearLoginSessionData(context: object): Promise<LoginSessionClearResult> {
  // 页面/组件不 import @kit，只传 object；在这里收窄为 UIAbilityContext。
  const abilityContext: common.UIAbilityContext = context as common.UIAbilityContext;
  let sessionCleared: boolean = false;
  let ticketCleared: boolean = false;
  try {
    const sessionStore: SchoolSessionStore = await createSchoolSessionStore(abilityContext);
    await sessionStore.clear();
    sessionCleared = true;
  } catch (error) {
    sessionCleared = false;
  }
  try {
    const ticketStore: SchoolTicketStore = await createSchoolTicketStore(abilityContext);
    await ticketStore.clear();
    ticketCleared = true;
  } catch (error) {
    ticketCleared = false;
  }
  const webResult: WebDataClearResult = await clearWebBrowsingData();
  return {
    sessionCleared,
    ticketCleared,
    cookiesCleared: webResult.cookiesCleared,
    storageCleared: webResult.storageCleared,
    httpAuthCleared: webResult.httpAuthCleared
  };
}
