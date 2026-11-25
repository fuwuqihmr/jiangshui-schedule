// 请假 / 销假 / 续假入口：只生成学校学工系统的稳定深链，不接触任何凭据。
// 登录、填写和提交全部发生在学校 WebView 页面内；本模块不读取 cookie/TGC。
export const XGXT_ORIGIN = 'https://xgxt.juwp.edu.cn';
export const SSO_ENTRY = `${XGXT_ORIGIN}/sfrz/login343962`;

export const LEAVE_SERVICES = Object.freeze([
  Object.freeze({key:'leave',label:'请假',mappId:19998425,formId:'278616',description:'发起请假申请'}),
  Object.freeze({key:'cancel',label:'销假',mappId:19998424,formId:'278615',description:'对已批准的请假销假'}),
  Object.freeze({key:'renew',label:'续假',mappId:19998423,formId:'278618',description:'延长已批准的请假'})
]);
export const LEAVE_SERVICE_KEYS = Object.freeze(LEAVE_SERVICES.map(service => service.key));

/** mappId → 稳定深链；绝不拼接 apply.html / pageEnc / uuid / OAuth code。 */
export function entryUrl(mappId) {
  const service = LEAVE_SERVICES.find(item => String(item.mappId) === String(mappId));
  if (!service) throw new Error('未知的请假服务');
  return `${XGXT_ORIGIN}/wfw/appInter/openPcApp?mappId=${service.mappId}`;
}

/**
 * 打开某个请假服务。
 * @param {{native?:object,call?:Function}} bridge bridge.mjs 导出的 {native, call}
 * @param {'leave'|'cancel'|'renew'} key
 * @param {{warmup?:boolean,android?:boolean}} [opts]
 */
export async function openLeaveService(bridge, key, opts = {}) {
  const service = LEAVE_SERVICES.find(item => item.key === key);
  if (!service) throw new Error('未知的请假服务');

  const url = entryUrl(service.mappId);
  const android = opts.android ?? !!globalThis.Android;
  const warmup = opts.warmup !== false;
  const hasNative = !!(bridge?.native && typeof bridge.call === 'function');

  // Android 原生桥和 Electron 桌面桥都走 openWebApp；桌面端由主进程用系统
  // 浏览器打开，不会假装打开了应用内窗口。只有纯浏览器才 window.open。
  if (hasNative) {
    const payload = {url};
    if (warmup) payload.warmupUrl = SSO_ENTRY;
    const result = await bridge.call('openWebApp', payload);
    if (result && result.ok === false) throw new Error(result.error || '学校页面暂时无法打开');
    return {via:'native',key:service.key,label:service.label,url};
  }

  if (android) throw new Error('当前版本暂不支持应用内打开');
  if (typeof globalThis.open !== 'function') throw new Error('当前环境无法打开外部页面');
  // Do not pass 'noopener' to window.open: browsers then return null even when
  // the window opened. Open normally, clear opener, and use the return value.
  const win = globalThis.open(url, '_blank');
  if (win) { try { win.opener = null; } catch {} }
  if (!win) throw new Error('浏览器拦截了新窗口，请允许弹窗后重试');
  return {via:'window',key:service.key,label:service.label,url};
}
