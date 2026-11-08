import {addDays,timetableDay,weekday,weekOf} from './core.mjs';

export const CALENDAR_EVENT_LIMIT = 5000;
export const DEFAULT_CALENDAR_OPTIONS = Object.freeze({school:true,custom:true,study:true});

const SOURCE_LABEL={school:'学校课程',custom:'自定义课程',study:'晚自习'};
const WEEKDAY_LABEL=['一','二','三','四','五','六','日'];

export function normalizeCalendarOptions(value){
  const source=value&&typeof value==='object'?value:{};
  return {
    school:typeof source.school==='boolean'?source.school:true,
    custom:typeof source.custom==='boolean'?source.custom:true,
    study:typeof source.study==='boolean'?source.study:true,
  };
}

function clipped(value,limit){
  return String(value??'').trim().slice(0,limit);
}

export function buildCalendarEvents(state, options = DEFAULT_CALENDAR_OPTIONS){
  const opts=normalizeCalendarOptions(options);
  if(!opts.school&&!opts.custom&&!opts.study){
    return {events:[],total:0,skipped:0,error:{code:'CALENDAR_NO_OPTIONS',message:'请至少选择一类课程后再写入。'}};
  }
  const semester=state?.snapshot?.semester;
  if(!semester?.startDate||!Number.isFinite(Number(semester.weeks))){
    return {events:[],total:0,skipped:0,error:{code:'CALENDAR_INVALID_EVENT',message:'课表学期信息不完整，暂时无法写入日历。'}};
  }
  const weeks=Math.max(1,Math.min(60,Math.floor(Number(semester.weeks))));
  const totalDays=weeks*7;
  const events=[];
  const seenKeys=new Set();
  let skipped=0;
  for(let i=0;i<totalDays;i++){
    const date=addDays(semester.startDate,i);
    let rows;
    try{
      rows=timetableDay(state.snapshot,date,state.overrides||[],state.localMaps||[],state.courseSettings||{},state.customCourses||[],state.holidaySettings||null);
    }catch{
      skipped++;
      continue;
    }
    for(const row of Array.isArray(rows)?rows:[]){
      if(!row||row.cancelled||row.vacant||!row.name||!row.startTime||!row.endTime){skipped++;continue;}
      const startMillis=Date.parse(`${date}T${row.startTime}:00+08:00`);
      const endMillis=Date.parse(`${date}T${row.endTime}:00+08:00`);
      if(!Number.isFinite(startMillis)||!Number.isFinite(endMillis)||endMillis<=startMillis){skipped++;continue;}
      const source=row.localActivity?'study':row.customCourse?'custom':'school';
      const category=row.localActivity?'study':(row.customCourse||row.remapId||row.overrideId||row.source==='local')?'custom':'school';
      if(!opts[category]){skipped++;continue;}
      const week=weekOf(state.snapshot,date);
      const day=WEEKDAY_LABEL[weekday(date)-1]||'一';
      const baseKey=row.key||`${date}/${row.ruleId||row.name||events.length}`;
      let eventKey=String(baseKey);
      let suffix=1;
      while(seenKeys.has(eventKey)){
        suffix++;
        eventKey=`${baseKey}#${suffix}`;
      }
      seenKeys.add(eventKey);
      events.push({
        key:eventKey,
        title:clipped(row.name,200),
        location:clipped(row.room||'未填写教室',200),
        description:clipped(`教师：${row.teacher||'未填写'} · 第${week}周（周${day}） · 来源：${SOURCE_LABEL[source]} · 由江水课表写入`,1000),
        startMillis,
        endMillis,
        startDate:date,
        startTime:row.startTime,
        endTime:row.endTime,
        source,
      });
    }
  }
  if(events.length>CALENDAR_EVENT_LIMIT){
    return {events:[],total:events.length,skipped,error:{code:'CALENDAR_TOO_MANY_EVENTS',message:`课程超过 ${CALENDAR_EVENT_LIMIT} 条，请减少课程或取消部分选项后再试。`}};
  }
  return {events,total:events.length,skipped,error:null};
}
