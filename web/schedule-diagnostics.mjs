import {addDays,weekday,weekOf,sourceDay,timetableDay,today,validDate} from './core.mjs';

// Export only dates, periods, counts and origin categories. Never serialize a rule,
// school response, course name, location, teacher or credential into diagnostics.
const kind = value => ['school','sample','local'].includes(value) ? value : 'other';
const safeDate = value => {try{return validDate(value)?value:null;}catch{return null;}};
const safeTime = value => typeof value==='string' && /^\d{2}:\d{2}$/.test(value) ? value : '--:--';
const stamp = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString().slice(0,19)+'Z' : 'unknown';
const dayRows = (state,date) => timetableDay(state.snapshot,date,state.overrides||[],state.localMaps||[],state.courseSettings||{},state.customCourses||[],state.holidaySettings);
const sourceRows = (state,date) => sourceDay(state.snapshot,date);
const slot = row => Array.isArray(row.periods) && row.periods.length && row.periods.every(p=>Number.isInteger(p)&&p>0&&p<=16)
  ? `${String(Math.min(...row.periods)).padStart(2,'0')}-${String(Math.max(...row.periods)).padStart(2,'0')}`
  : `${safeTime(row.startTime)}-${safeTime(row.endTime)}`;
const slots = (state,date) => sourceRows(state,date).filter(row=>!row.cancelled).map(slot).sort().join('/') || '-';
const count = value => Array.isArray(value) ? value.length : 0;

export function appendScheduleTrace(before,after,mode,at=new Date().toISOString()) {
 const action=['foreground','background','adopt','foreground-error','background-error'].includes(mode) ? mode : 'foreground-error';
 const normalized=stamp(at);
 const date=normalized==='unknown'?today():new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
 const monday=addDays(date,1-weekday(date));
 const history=Array.isArray(before?.diagnosticSyncHistory)?before.diagnosticSyncHistory:[];
 const record={at:normalized,action,date,sourceBefore:kind(before?.snapshot?.source?.kind),sourceAfter:kind(after?.snapshot?.source?.kind),days:[]};
 try {for(let i=0;i<7;i++){const day=addDays(monday,i);record.days.push({date:day,before:slots(before,day),after:slots(after,day)});}}
 catch {record.days=[];}
 return {...after,diagnosticSyncHistory:[...history.slice(-11),record]};
}

export function scheduleDiagnosticLines(state,date=today()) {
 if(!state?.snapshot || !safeDate(date))return [];
 try {
  const s=state.snapshot,monday=addDays(date,1-weekday(date)),lines=[
   `快照：来源=${kind(s.source?.kind)} 学期起始=${safeDate(s.semester?.startDate)||'unknown'} 总周数=${Number.isInteger(s.semester?.weeks)?s.semester.weeks:0} 规则数=${count(s.rules)} 上次成功=${stamp(state.lastSuccess)} 上次尝试=${stamp(state.lastAttempt)} 状态=${state.error?'failed':'ok'}`,
   `本地修改：单次=${count(state.overrides)} 调休=${count(state.localMaps)} 自定义=${count(state.customCourses)} 课程设置=${Object.keys(state.courseSettings||{}).length}`
  ];
  for(let i=0;i<7;i++){
   const day=addDays(monday,i),base=sourceRows(state,day),shown=dayRows(state,day),active=shown.filter(r=>!r.cancelled);
   lines.push(`日期=${day} 周次=${weekOf(s,day)} 来源课=${base.length} 显示课=${active.length} 停课或空位=${shown.length-active.length} 时段=${slots(state,day)}`);
   for(const r of shown){
    const origin=r.localActivity?'study':r.customCourse?'custom':kind(r.source),inSource=base.some(x=>x.ruleId===r.ruleId&&x.originDate===r.originDate);
    lines.push(`课程位置=${day}/${slot(r)} 来源=${origin} 学校快照内=${inSource?'yes':'no'} 状态=${r.vacant?'vacant':r.cancelled?'cancelled':'active'} 覆盖=${r.overrideId?'yes':'no'} 调休=${r.remapId?'yes':'no'} 冲突=${r.conflict?'yes':'no'}`);
   }
  }
  for(const r of (Array.isArray(state.diagnosticSyncHistory)?state.diagnosticSyncHistory.slice(-12):[])){
   if(!r||stamp(r.at)==='unknown'||!safeDate(r.date)||!['foreground','background','adopt','foreground-error','background-error'].includes(r.action))continue;
   const changed=(Array.isArray(r.days)?r.days:[]).filter(d=>safeDate(d.date)&&/^(?:-|\d{2}-\d{2}(?:\/\d{2}-\d{2})*)$/.test(d.before)&&/^(?:-|\d{2}-\d{2}(?:\/\d{2}-\d{2})*)$/.test(d.after)&&d.before!==d.after);
   lines.push(`核对记录=${stamp(r.at)} 模式=${r.action} 旧来源=${kind(r.sourceBefore)} 新来源=${kind(r.sourceAfter)} 本周变化日=${changed.length}`);
   for(const d of changed)lines.push(`核对变化=${safeDate(d.date)} 旧时段=${d.before} 新时段=${d.after}`);
  }
  return lines;
 }catch{return ['课表分析：无法完成；原始课程和凭据均未导出'];}
}
