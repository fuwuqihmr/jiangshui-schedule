import {studyDay} from './study.mjs';
import {holidayForDate,emptyHolidaySettings} from './holiday-settings.mjs';
import {customCourseDay,alignCustomCoursesToSemester} from './custom-courses.mjs';
import {courseSettingKey} from './interactions.mjs';
export const FIELDS = ['name','teacher','room','startTime','endTime','periods','cancelled'];
export const clone = x => JSON.parse(JSON.stringify(x));
export function latestIso(a,b){const ta=Date.parse(String(a??'')),tb=Date.parse(String(b??''));if(!Number.isFinite(ta)&&!Number.isFinite(tb))return null;if(!Number.isFinite(ta))return new Date(tb).toISOString();if(!Number.isFinite(tb)||ta>=tb)return new Date(ta).toISOString();return new Date(tb).toISOString();}
const equal = (a,b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s+'T00:00:00Z').toISOString().slice(0,10) === s; }
export function addDays(s,n) { if(!validDate(s)) throw Error('日期无效'); const d=new Date(s+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
export const daysBetween = (a,b) => Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
export const weekday = s => new Date(s+'T00:00:00Z').getUTCDay() || 7;
export const weekOf = (snapshot,date) => Math.floor(daysBetween(snapshot.semester.startDate,date)/7)+1;
export const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function validateSnapshot(s) {
  if(!s || s.schemaVersion!==1 || !s.semester || !validDate(s.semester.startDate) || weekday(s.semester.startDate)!==1 || !Number.isInteger(s.semester.weeks) || s.semester.weeks<1 || s.semester.weeks>60 || !Array.isArray(s.rules) || s.rules.length>1000) throw Error('课表文件格式不正确');
  const ids=new Set();
  for(const r of s.rules) {
    if(!r.id || ids.has(r.id) || typeof r.name!=='string' || !r.name.trim() || !Number.isInteger(r.weekday) || r.weekday<1 || r.weekday>7 || !Array.isArray(r.weeks) || !r.weeks.length || r.weeks.some(w=>!Number.isInteger(w)||w<1||w>s.semester.weeks) || !Array.isArray(r.periods) || !r.periods.length || r.periods.some(p=>!Number.isInteger(p)||p<1||p>16) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.endTime) || r.endTime<=r.startTime) throw Error('课程规则无效或标识重复');
    ids.add(r.id);
  }
  for(const d of s.closedDates||[]) if(!validDate(d)) throw Error('停课日期无效');
  const mids=new Set();
  for(const m of s.remaps||[]) { if(!m.id || mids.has(m.id)||!validDate(m.date)||!validDate(m.fromDate)||!['append','replace'].includes(m.mode)) throw Error('调休映射无效'); mids.add(m.id); }
  for(const e of s.exceptions||[]) { if(!validDate(e.date)||!ids.has(e.ruleId)) throw Error('课程例外无效'); }
  return s;
}
export function baseDay(s,date) {
  const w=weekOf(s,date);
  if(w<1 || w>s.semester.weeks) return [];
  return s.rules.filter(r=>r.weekday===weekday(date)&&r.weeks.includes(w)).map(r=>({...clone(r),ruleId:r.id,key:`${date}/${r.id}`,date,originDate:date,source:s.source?.kind||'sample'}));
}
export function sourceDay(s,date) {
  let list=(s.closedDates||[]).includes(date)?[]:baseDay(s,date);
  for(const m of s.remaps||[]) if(m.date===date) {
    if(m.mode==='replace') list=[];
    list.push(...baseDay(s,m.fromDate).map(r=>({...r,date,key:`${date}/${r.ruleId}/map-${m.id}`,originDate:m.fromDate,remapId:m.id})));
  }
  for(const e of s.exceptions||[]) if(e.date===date) list=list.flatMap(r=>r.ruleId===e.ruleId ? e.cancel ? [] : [{...r,...clone(e.patch||{})}] : [r]);
  return list.sort((a,b)=>a.startTime.localeCompare(b.startTime)||a.key.localeCompare(b.key));
}
export function effectiveDay(s,date,overrides=[],localMaps=[],courseSettings={},customCourses=[],holidaySettings=null) {
  // Manual rescheduling moves a day, including entries saved by older versions.
  const maps=localMaps.map(m=>({...m,mode:'replace'}));
  const mixed={...s,remaps:[...(s.remaps||[]),...maps]};
  const holiday=holidayForDate(holidaySettings,date);
  let list=holiday?[]:sourceDay(mixed,date).map(x=>({...x,source:localMaps.some(m=>m.id===x.remapId)?'local':x.source}));
  if(!holiday){
    if(maps.some(m=>m.fromDate===date&&m.date!==date)) list=list.filter(r=>r.remapId);
    list.push(...customCourseDay(s,date,customCourses,maps));
  }
  list.push(...studyDay(s,date,maps,holidaySettings));
  list=list.map(r=>applyCourseSetting(r,courseSettings));
  for(const o of overrides.filter(o=>o.date===date)) {
    const i=list.findIndex(r=>r.key===o.key), current=i<0?null:list[i];
    // Disabled or displaced local evening study must not be resurrected by an old override.
    if(!current && (o.base?.localActivity||o.base?.customCourse||holiday||maps.some(m=>m.date===date||m.fromDate===date&&m.date!==date))) continue;
    const compareCurrent=current?.original||current,compareBase=o.base.original||o.base;
    const conflict=!current || !current.customCourse&&Object.keys(o.patch).some(f=>!equal(compareCurrent[f],compareBase[f])&&!equal(compareCurrent[f],o.patch[f]));
    const local={...(current||o.base),...clone(o.patch),source:'local',overrideId:o.id,original:o.base};
    const result=conflict ? {...(current||o.base),cancelled:!current||current.cancelled,conflict:{school:current,local,at:o.createdAt},overrideId:o.id} : local;
    if(i<0) list.push(result); else list[i]=result;
  }
  // A real school class takes precedence over the optional locally generated study.
  list=list.filter(r=>!r.localActivity||!list.some(q=>q.key!==r.key&&!q.localActivity&&!q.cancelled&&q.startTime<r.endTime&&q.endTime>r.startTime));
  for(const r of list) r.overlap=list.some(q=>q.key!==r.key&&!q.cancelled&&!r.cancelled&&q.startTime<r.endTime&&q.endTime>r.startTime);
  return list.sort((a,b)=>a.startTime.localeCompare(b.startTime)||a.key.localeCompare(b.key));
}
// Grey vacancies are display records only; they never become attended courses.
export function timetableDay(s,date,overrides=[],localMaps=[],courseSettings={},customCourses=[],holidaySettings=null) {
  const list=effectiveDay(s,date,overrides,localMaps,courseSettings,customCourses,holidaySettings);
  if(holidayForDate(holidaySettings,date))return list;
  const moved=localMaps.find(m=>m.fromDate===date&&m.date!==date);
  if(!moved) return list;
  const originals=[...baseDay(s,date),...customCourseDay(s,date,customCourses).filter(r=>r.mode==='weekly')];
  for(const r of originals) {
    if(list.some(q=>q.key===r.key||(!q.cancelled&&q.startTime<r.endTime&&q.endTime>r.startTime))) continue;
    list.push({...r,cancelled:true,vacant:true,vacancyReason:'moved',movedTo:moved.date});
  }
  return list.sort((a,b)=>a.startTime.localeCompare(b.startTime)||a.key.localeCompare(b.key));
}
export function semesterOccurrences(s) {
  const result=[];
  for(let i=0;i<s.semester.weeks*7;i++) result.push(...sourceDay(s,addDays(s.semester.startDate,i)));
  return result;
}
export function diffSnapshots(before,after,now=new Date().toISOString()) {
  validateSnapshot(after);
  if(!before) return [];
  if(before.semester.startDate!==after.semester.startDate || before.semester.id!==after.semester.id) throw Error('不同学期请通过更换课表操作导入');
  const oldMap=new Map(semesterOccurrences(before).map(r=>[r.key,r]));
  const newMap=new Map(semesterOccurrences(after).map(r=>[r.key,r]));
  const result=[];
  for(const key of new Set([...oldMap.keys(),...newMap.keys()])) {
    const a=oldMap.get(key), b=newMap.get(key), r=b||a;
    if(Date.parse(`${r.date}T${r.endTime}:00+08:00`)<=Date.parse(now)) continue;
    const fields=FIELDS.filter(f=>!equal(a?.[f],b?.[f]));
    if(!fields.length) continue;
    result.push({id:`${now}/${key}`,key,date:r.date,name:r.name,before:a||null,after:b||null,fields,type:!a?'新增':!b?'停课':fields.includes('startTime')||fields.includes('periods')?'改时间':fields.includes('room')?'换教室':fields.includes('teacher')?'换教师':'课程调整',source:after.source?.kind||'sample',read:false,notifiedAt:null,detectedAt:now});
  }
  return result.sort((a,b)=>a.date.localeCompare(b.date));
}
export function noticeLevel(event,now=new Date()) {
  const r=event.after||event.before, hours=(Date.parse(`${event.date}T${r.startTime}:00+08:00`)-Number(now))/3600000;
  if(event.read || hours<0) return 'none';
  if(hours<=24) return 'urgent';
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(now);
  const sunday=addDays(date,7-weekday(date));
  return event.date<=sunday?'digest':'later';
}
export function applySnapshot(state,snapshot,now=new Date().toISOString()) {
  validateSnapshot(snapshot);
  // A school refresh replaces only the source snapshot. Local date mappings
  // (调休), one day edits, and their history belong to the device and must
  // survive every refresh, including the Android background reader.
  const localMaps=Array.isArray(state.localMaps)?clone(state.localMaps):[];
  const holidaySettings=clone(state.holidaySettings||emptyHolidaySettings());
  const overrides=Array.isArray(state.overrides)?clone(state.overrides):[];
  const events=Array.isArray(state.events)?state.events:[];
  if(!snapshot.studentProfile && state.snapshot?.studentProfile) snapshot.studentProfile=clone(state.snapshot.studentProfile);
  if(!snapshot.studyPolicy && state.snapshot?.studyPolicy) snapshot.studyPolicy=clone(state.snapshot.studyPolicy);
  const changes=diffSnapshots(state.snapshot,snapshot,now);
  return {...state,snapshot:clone(snapshot),customCourses:alignCustomCoursesToSemester(state.customCourses,snapshot.semester),events:[...changes,...events],overrides,localMaps,holidaySettings,lastSuccess:now,courseLastSuccess:now,lastAttempt:now,error:null};
}
export function adoptSchoolSnapshot(state,snapshot,now=new Date().toISOString()) {
  validateSnapshot(snapshot);
  const source=clone(snapshot);
  if(!source.studentProfile && state.snapshot?.studentProfile) source.studentProfile=clone(state.snapshot.studentProfile);
  if(!source.studyPolicy && state.snapshot?.studyPolicy) source.studyPolicy=clone(state.snapshot.studyPolicy);
  const next=createState(source), studySetting=state.courseSettings?.['local-evening-study'];
  if(studySetting) next.courseSettings['local-evening-study']=clone(studySetting);
  next.overrides=clone((state.overrides||[]).filter(o=>o.base?.customCourse));
  for(const [key,value] of Object.entries(state.courseSettings||{}))if(key.startsWith('custom/'))next.courseSettings[key]=clone(value);
  return {...next,customCourses:alignCustomCoursesToSemester(state.customCourses,source.semester),holidaySettings:clone(state.holidaySettings||emptyHolidaySettings()),manualLeaveCancels:clone(state.manualLeaveCancels||{schemaVersion:1,marks:[]}),_revision:state._revision??0,theme:state.theme??'system',showDayOverview:state.showDayOverview===true,notificationEnabled:!!state.notificationEnabled,classReminders:clone(state.classReminders||{enabled:true,leadMinutes:30,afterStartMinutes:5}),classReminderPreferenceSet:state.classReminderPreferenceSet===true,reminderIntroAcknowledged:state.reminderIntroAcknowledged===true,reminderPermissionAsked:state.reminderPermissionAsked===true,autoCheckEnabled:state.autoCheckEnabled??true,settingsExpanded:clone(state.settingsExpanded||{auto:true,display:false,leave:false,course:false,data:false,about:false}),calendarOptions:clone(state.calendarOptions||{school:true,custom:true,study:true}),lastSuccess:now,courseLastSuccess:now,leaveLastSuccess:state.leaveLastSuccess??null};
}
export function recordFailure(state,message,now=new Date().toISOString()) { return {...state,lastAttempt:now,error:String(message)}; }
export function saveOverride(state,occurrence,patch,now=new Date().toISOString()) {
  const allowed=Object.fromEntries(Object.entries(patch).filter(([key])=>FIELDS.includes(key)));
  if(allowed.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(allowed.startTime) || allowed.endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(allowed.endTime)) throw Error('时间格式错误');
  if((allowed.endTime||occurrence.endTime)<=(allowed.startTime||occurrence.startTime)) throw Error('结束时间应晚于开始时间');
  const prev=state.overrides.find(o=>o.key===occurrence.key);
  const o={id:prev?.id||`local-${now}-${occurrence.key}`,key:occurrence.key,date:occurrence.date,base:clone(prev?.base||occurrence),patch:{...(prev?.patch||{}),...allowed},createdAt:now};
  return {...state,overrides:[...state.overrides.filter(o=>o.key!==occurrence.key),o]};
}
function applyCourseSetting(row,settings){
  const key=courseSettingKey(row),setting=settings?.[key];if(!setting?.patch)return row;
  const base=setting.baseByRule?.[row.ruleId];
  const local={...row,...clone(setting.patch),source:'local',courseSettingKey:key,original:clone(row)};
  const conflict=base&&Object.keys(setting.patch).some(f=>!equal(row[f],base[f])&&!equal(row[f],setting.patch[f]));
  return conflict?{...row,courseSettingKey:key,conflict:{school:clone(row),local,at:setting.createdAt,kind:'course'}}:local;
}
export function saveCourseSettings(state,occurrence,patch,now=new Date().toISOString()){
  const clean={};for(const field of ['room','teacher'])if(Object.hasOwn(patch,field)){if(typeof patch[field]!=='string'||patch[field].length>80)throw Error('课程属性应为不超过80字的文本');clean[field]=patch[field].trim()||'—';}
  const key=courseSettingKey(occurrence),bases={};
  if(!Object.keys(clean).length){const settings={...state.courseSettings};delete settings[key];return {...state,courseSettings:settings};}
  for(const row of state.snapshot.rules.filter(r=>courseSettingKey(r)===key))bases[row.id]={room:row.room,teacher:row.teacher};
  if(occurrence.localActivity)bases[occurrence.ruleId]={room:'—',teacher:'—'};
  return {...state,courseSettings:{...state.courseSettings,[key]:{name:occurrence.name,patch:clean,baseByRule:bases,createdAt:now}}};
}
export function createState(snapshot) { validateSnapshot(snapshot); return {version:1,snapshot:clone(snapshot),events:[],overrides:[],localMaps:[],holidaySettings:emptyHolidaySettings(),courseSettings:{},customCourses:[],theme:'system',showDayOverview:false,lastSuccess:null,courseLastSuccess:null,lastAttempt:null,error:null,notificationEnabled:false,classReminders:{enabled:true,leadMinutes:30,afterStartMinutes:5},classReminderPreferenceSet:false,reminderIntroAcknowledged:false,reminderPermissionAsked:false,digestDate:null,autoCheckEnabled:true,settingsExpanded:{auto:true,display:false,leave:false,course:false,data:false,about:false},calendarOptions:{school:true,custom:true,study:true},leaveLastSuccess:null}; }
