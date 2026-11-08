import {normalizeSchool} from './school.mjs';
import {buildBundle,SEMESTER_MONDAYS} from './jsxsd.mjs';
import {applySnapshot,recordFailure,noticeLevel,today} from './core.mjs';
import {withStudyPolicy} from './study.mjs';
import {appendScheduleTrace} from './schedule-diagnostics.mjs';
const calendar=await (await fetch('./data/holidays.json')).json();
const post=(action,data)=>Android.post(action,JSON.stringify(data));
globalThis.processBackground=(state,result)=>{
 try{
  if(!state?.snapshot||state.snapshot.source.kind!=='school'){post('failure',{message:'请先在应用内采用学校课表'});return;}
  let next;
  if(result.error)next=recordFailure(state,result.error);
  else{
   const snapshot=normalizeSchool(buildBundle(result.rows,{monday:SEMESTER_MONDAYS[result.semesterId],totalWeeks:result.totalWeeks,semesterId:result.semesterId}));
   next=applySnapshot(state,withStudyPolicy(snapshot,result.studentProfile,calendar,state.snapshot));
  }
  next=appendScheduleTrace(state,next,result.error?'background-error':'background');
  next.lastBackgroundAttempt=new Date().toISOString();if(!result.error)next.lastBackgroundSuccess=next.lastBackgroundAttempt;
  const now=new Date(),date=today();
  const items=next.notificationEnabled?next.events.filter(e=>!e.notifiedAt&&(noticeLevel(e,now)==='urgent'||(noticeLevel(e,now)==='digest'&&next.digestDate!==date))):[];
  post('commit',{state:next,expectedRevision:state._revision||0,notice:items.length?{title:`课表有 ${items.length} 处变化`,body:items.slice(0,3).map(e=>`${e.date} ${e.name}：${e.type}`).join('；'),ids:items.map(e=>e.id),digestDate:items.some(e=>noticeLevel(e,now)==='digest')?date:null}:null,error:result.error||null});
 }catch(error){post('failure',{message:error?.message||'后台课表解析失败，保留原课表'});}
};
post('ready',{});
