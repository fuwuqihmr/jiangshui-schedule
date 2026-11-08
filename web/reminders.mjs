import {addDays,effectiveDay} from './core.mjs';

export const REMINDER_DEFAULTS=Object.freeze({enabled:true,leadMinutes:30,afterStartMinutes:5});
export function reminderSettings(input={}){
 const value=(name,fallback,max)=>Number.isInteger(input?.[name])&&input[name]>=0&&input[name]<=max?input[name]:fallback;
 return {enabled:input?.enabled===undefined||input.enabled===true,leadMinutes:value('leadMinutes',30,180),afterStartMinutes:value('afterStartMinutes',5,120)};
}
export function validateReminderSettings(input){
 for(const [name,max] of [['leadMinutes',180],['afterStartMinutes',120]])if(!Number.isInteger(input[name])||input[name]<0||input[name]>max)throw Error(name==='leadMinutes'?'提前提醒时间应为 0–180 分钟的整数':'开课后保留时间应为 0–120 分钟的整数');
 if(input.leadMinutes===0&&input.afterStartMinutes===0)throw Error('提前提醒和开课后保留时间不能同时为 0');
 return reminderSettings(input);
}
export function reminderStatus(reminder,now=Date.now()){
 const start=Number(reminder.startAt),end=Date.parse(`${reminder.date}T${reminder.endTime}:00+08:00`);
 if(now<start)return `${Math.max(1,Math.ceil((start-now)/60000))}分钟后上课`;
 return now<end?'课程进行中':'课程已结束';
}
// The app and native notifications use the same date/course key for one occurrence.
export function reminderWindows(state,now=Date.now()){
 const settings=reminderSettings(state.classReminders);if(!settings.enabled)return [];
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now)),rows=[];
 for(let offset=-1;offset<=7;offset++){
  const day=addDays(date,offset);
  for(const r of effectiveDay(state.snapshot,day,state.overrides,state.localMaps,state.courseSettings,state.customCourses,state.holidaySettings)){
   // A default-on reminder must never notify for bundled demonstration courses.
   if(r.cancelled||(state.snapshot.source?.kind==='sample'&&!r.customCourse))continue;
   const startAt=Date.parse(`${day}T${r.startTime}:00+08:00`),endAt=startAt+settings.afterStartMinutes*60000,showAt=startAt-settings.leadMinutes*60000;
   if(!Number.isFinite(startAt)||endAt<=showAt)continue;
   rows.push({id:`${day}|${r.key}`,date:day,key:r.key,name:r.name,room:r.room,teacher:r.teacher,startTime:r.startTime,endTime:r.endTime,startAt,showAt,expiresAt:endAt});
  }
 }
 return rows.sort((a,b)=>a.startAt-b.startAt||a.id.localeCompare(b.id));
}
export function activeReminderWindows(state,now=Date.now(),closed=new Set()){
 return reminderWindows(state,now).filter(r=>r.showAt<=now&&now<r.expiresAt&&!closed.has(r.id));
}
