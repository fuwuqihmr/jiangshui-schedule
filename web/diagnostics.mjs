import {scheduleDiagnosticLines} from './schedule-diagnostics.mjs';
// Only fixed diagnostic fields are exported; never copy errors, URLs, state or credentials verbatim.
export function failureCategory(message){
 const text=String(message||'');
 const code=/\bHTTP\s+(\d{3})\b/i.exec(text);
 const kind=!text?'none':code?'http':/取消/.test(text)?'cancelled':/登录|会话/.test(text)?'session':/超时/.test(text)?'timeout':/格式|结构|字段|节次|上课时间|周次/.test(text)?'structure':/连接|网络/.test(text)?'network':'other';
 return {kind,httpStatus:code?Number(code[1]):0};
}
export function safeDiagnosticLines(lines){
 const patterns=[/^read-start background=(?:true|false) profile-known=(?:true|false)$/, /^read-failed background=(?:true|false)$/,
 /^school-page http-error=\d{3}$/, /^school-page network-error=-?\d+$/,
 /^school-login (?:awaiting-user|accepted)$/,
 /^school-session expired; recovery-used=(?:true|false)$/,
 /^school-session tgc-expired$/,
 /^school-ssl-error page=(?:portal|school-login|academic-home|timetable|academic|mobile-academic|school)$/,
 /^session-cookie-state tgc=(?:true|false) academic=(?:true|false)$/,
 /^session-cookie-restore tgc=(?:true|false) academic=(?:true|false)$/,
 /^session-cookie-restored name=(?:tgc|academic)$/,
 /^session-store (?:read-failed|write-failed|clear-failed)$/,
 /^session-renewal start reason=(?:expired-school-cookie|missing-school-cookie)$/,
 /^session-renewal reached-academic-home$/,
 /^session-renewal failed reason=repeat$/, /^profile-read recognized=(?:true|false) links=\d+$/,
 /^web-read ok weeks=\d+ rows=\d+ elapsed-ms=\d+ sso=(?:true|false) background=(?:true|false)$/,
 /^reader-selection semester=(?:\d{4}-\d{4}-[12]|unknown) mode-known=(?:true|false) calendar-cached=(?:true|false)$/,
 /^school-page (?:http-error=\d{3}|network-error=-?\d+) page=(?:portal|school-login|academic-home|timetable|academic|mobile-academic|school) method=(?:GET|POST|OTHER)$/,
 /^reader-error stage=(?:weeks|courses|unknown) http-status=\d{1,3} kind=(?:http|session|timeout|format|other)$/,
 /^import-error kind=(?:http|cancelled|session|timeout|structure|network|other) http-status=\d{1,3}$/,
 /^desktop-read step=(?:page|weeks|courses|mobile-weeks|mobile-modes|mobile-courses) status=\d{1,3}$/,
 /^desktop-page page=(?:portal|school-login|academic-home|timetable|academic|mobile-academic|school)$/];
 return (Array.isArray(lines)?lines:[]).flatMap(raw=>{
  if(typeof raw!=='string'||raw.length>600)return [];
  const stamp=/^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (.*)$/.exec(raw.trim());
  if(!stamp)return [];
  let event=stamp[2];
  // Older logs can contain an arbitrary profile path: retain its two scalar fields only.
  const profile=/^profile-read recognized=(true|false) links=(\d+)(?: path=.*)?$/.exec(event);
  if(profile)event=`profile-read recognized=${profile[1]} links=${profile[2]}`;
  return patterns.some(pattern=>pattern.test(event))?[`${stamp[1]} ${event}`]:[];
 }).slice(-200);
}
function version(value){return /^\d+(?:\.\d+){0,5}(?:-rc\d+|-?beta\d+)?$/.test(String(value||''))?String(value):'未知';}
export function notificationDiagnosticLines(input){
 if(!input||typeof input!=='object')return [];
 const flag=(v)=>typeof v==='boolean'?String(v):'unknown',number=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max?String(v):'unknown';
 const focus=input.focus||{};
 return [`notifications enabled=${flag(input.enabled)} importance=${number(input.importance,-1000,5)} lock-visibility=${number(input.lockVisibility,-1000,1)} device-locked=${flag(input.deviceLocked)}`,
 `class-notifications active=${number(input.activeCount,0,1000)} grouped=${number(input.groupedCount,0,1000)}`,
 `xiaomi-focus device=${flag(focus.xiaomi)} checked=${flag(focus.checked)} protocol=${number(focus.protocol,0,3)} allowed=${flag(focus.allowed)} permission=${flag(focus.permission)} configured=${flag(focus.configured)}`];
}
export function formatDiagnostics(data={},message='',state=null){
 const platform=['android','windows','browser'].includes(data.platform)?data.platform:'browser';
 const category=failureCategory(message);
 const lines=['江水课表 · 排查日志','生成时间：'+new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),
  '应用版本：'+version(data.appVersion),'运行平台：'+platform,
  '系统版本：'+version(data.systemVersion),'Android API：'+(Number.isInteger(data.androidApi)?data.androidApi:'不适用'),
  '网页内核版本：'+version(data.engineVersion),'最近失败分类：'+category.kind+(category.httpStatus?' · HTTP '+category.httpStatus:''),
  '本文件不包含账号、密码、Cookie、登录票据或课程内容，不会自动上传。','','最近读取事件：'];
 if(data.notificationStatus)lines.push('系统通知检查：',...notificationDiagnosticLines(data.notificationStatus),'');
 const events=safeDiagnosticLines(data.events);
 lines.push(...(events.length?events:['暂无可导出的读取事件。请尝试读取课表，出现问题后再次导出。']));
 if(state)lines.push('', '当周课表来源与核对记录：',...scheduleDiagnosticLines(state));
 return lines.join('\n')+'\n';
}
