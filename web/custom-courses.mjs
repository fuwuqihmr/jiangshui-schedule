const copy=value=>JSON.parse(JSON.stringify(value));
const validDate=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(Number(d))&&d.toISOString().slice(0,10)===value;};
const weekday=date=>new Date(date+'T00:00:00Z').getUTCDay()||7;
const weekOf=(snapshot,date)=>Math.floor((Date.parse(date+'T00:00:00Z')-Date.parse(snapshot.semester.startDate+'T00:00:00Z'))/604800000)+1;
const text=(value,label,required=false)=>{if(typeof value!=='string'||value.length>80||required&&!value.trim())throw Error(label+'应为'+(required?'1–80':'不超过80')+'字的文本');return value.trim()||'—';};
export function normalizeCustomCourse(input){
 if(!input||typeof input.id!=='string'||!/^custom-[a-zA-Z0-9-]{1,100}$/.test(input.id)||!['weekly','once'].includes(input.mode))throw Error('自定义课程格式不正确');
 const course={id:input.id,mode:input.mode,name:text(input.name,'课程名称',true),room:text(input.room??'','教室'),teacher:text(input.teacher??'','教师'),startTime:input.startTime,endTime:input.endTime};
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(course.startTime)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(course.endTime)||course.endTime<=course.startTime)throw Error('结束时间应晚于开始时间，课程须在同一天内');
 if(input.mode==='once'){
  if(!validDate(input.date))throw Error('请选择有效的上课日期');course.date=input.date;
 }else{
  if(typeof input.semesterId!=='string'||!validDate(input.semesterStartDate)||!Number.isInteger(input.startWeek)||!Number.isInteger(input.endWeek)||input.startWeek<1||input.endWeek<input.startWeek||input.endWeek>60||!['every','odd','even'].includes(input.weekPattern))throw Error('上课周次设置不正确');
  if(!Array.isArray(input.weekdays)||!input.weekdays.length||input.weekdays.some(d=>!Number.isInteger(d)||d<1||d>7))throw Error('请至少选择一个上课星期');
  if(!Array.from({length:input.endWeek-input.startWeek+1},(_,i)=>input.startWeek+i).some(w=>input.weekPattern==='every'||w%2===(input.weekPattern==='odd'?1:0)))throw Error('所选周次范围内没有符合单双周的上课周');
  Object.assign(course,{semesterId:input.semesterId,semesterStartDate:input.semesterStartDate,startWeek:input.startWeek,endWeek:input.endWeek,weekPattern:input.weekPattern,weekdays:[...new Set(input.weekdays)].sort((a,b)=>a-b)});
 }
 return course;
}
export function saveCustomCourse(state,input){
 const existing=(state.customCourses||[]).find(c=>c.id===input.id);
 const course=normalizeCustomCourse({...input,id:existing?.id||`custom-${Date.now()}-${Math.random().toString(36).slice(2,10)}`});
 if(course.mode==='weekly'&&(course.semesterId!==state.snapshot.semester.id||course.semesterStartDate!==state.snapshot.semester.startDate||course.endWeek>state.snapshot.semester.weeks))throw Error('规律课程的上课周次应在当前学期内');
 const courses=[...(state.customCourses||[]).filter(c=>c.id!==course.id),course];if(courses.length>500)throw Error('自定义课程数量已达上限');
 return {...state,customCourses:courses};
}
export function deleteCustomCourse(state,id){
 return {...state,customCourses:(state.customCourses||[]).filter(c=>c.id!==id),overrides:state.overrides.filter(o=>o.base?.customCourseId!==id),courseSettings:Object.fromEntries(Object.entries(state.courseSettings||{}).filter(([key])=>key!==`custom/${id}`))};
}
const selectedWeeks=course=>Array.from({length:course.endWeek-course.startWeek+1},(_,i)=>course.startWeek+i).filter(w=>course.weekPattern==='every'||w%2===(course.weekPattern==='odd'?1:0));
function occurrence(course,snapshot,date,origin=date,map=null){
 const row={...copy(course),ruleId:course.id,customCourse:true,customCourseId:course.id,date,originDate:origin,key:`${date}/${course.id}${map?'/map-'+map.id:''}`,source:'local',sourceLabel:'自定义课程',weekday:weekday(origin),periods:[],weeks:course.mode==='weekly'?selectedWeeks(course):[weekOf(snapshot,date)]};
 if(map)row.remapId=map.id;return row;
}
export function customCourseDay(snapshot,date,customCourses=[],localMaps=[]){
 const weekly=(customCourses||[]).filter(c=>c.mode==='weekly'&&c.semesterId===snapshot.semester.id&&c.semesterStartDate===snapshot.semester.startDate);
 const regular=d=>{const week=weekOf(snapshot,d);return week<1||week>snapshot.semester.weeks?[]:weekly.filter(c=>c.weekdays.includes(weekday(d))&&selectedWeeks(c).includes(week)).map(c=>occurrence(c,snapshot,d));};
 let list=(snapshot.closedDates||[]).includes(date)?[]:regular(date);
 for(const map of [...(snapshot.remaps||[]),...localMaps.map(m=>({...m,mode:'replace'}))])if(map.date===date){if(map.mode==='replace')list=[];list.push(...regular(map.fromDate).map(r=>occurrence(r,snapshot,date,map.fromDate,map)));}
 if(localMaps.some(m=>m.fromDate===date&&m.date!==date))list=list.filter(r=>r.remapId);
 list.push(...(customCourses||[]).filter(c=>c.mode==='once'&&c.date===date).map(c=>occurrence(c,snapshot,date)));
 return list;
}
export function customCourseSummary(course){
 if(course.mode==='once')return `${course.date} · ${course.startTime}–${course.endTime} · 独立加课`;
 return `${course.weekdays.map(d=>'周'+'一二三四五六日'[d-1]).join('、')} · 第 ${course.startWeek}–${course.endWeek} 周${course.weekPattern==='odd'?'（单周）':course.weekPattern==='even'?'（双周）':''} · ${course.startTime}–${course.endTime}`;
}
export function customCourseBackup(state){return {...copy(state.snapshot),customCourses:copy(state.customCourses||[]),manualLeaveCancels:copy(state.manualLeaveCancels||{schemaVersion:1,marks:[]})};}
// The same term can have a sample/export ID and a school ID. Match by its
// actual first Monday so existing personal courses survive school adoption.
export function alignCustomCoursesToSemester(courses,semester){
 return (courses||[]).map(course=>course.mode==='weekly'&&course.semesterStartDate===semester.startDate&&course.semesterId!==semester.id
  ?{...course,semesterId:semester.id}:course);
}
export function importCustomCourses(state,courses){
 if(!Array.isArray(courses)||courses.length>500)throw Error('自定义课程备份格式不正确');
 const incoming=courses.map(normalizeCustomCourse),merged=new Map((state.customCourses||[]).map(c=>[c.id,c]));
 if(new Set(incoming.map(c=>c.id)).size!==incoming.length)throw Error('自定义课程标识重复');
 for(const course of incoming)merged.set(course.id,course);
 if(merged.size>500)throw Error('自定义课程数量已达上限');
 return {...state,customCourses:alignCustomCoursesToSemester([...merged.values()],state.snapshot.semester)};
}