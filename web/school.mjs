import {validateSnapshot,weekday,addDays,clone} from './core.mjs';
// Endpoint and field names are taken from the school's public mobile timetable module.
// A live response still must pass every structural check before it can replace a snapshot.
export function normalizeSchool(bundle){
  if(!bundle||!Array.isArray(bundle.weeks)||bundle.weeks.length<1||bundle.weeks.length>60)throw Error('教学周数据不完整，保留旧课表');
  const rows=bundle.weeks.slice().sort((a,b)=>Number(a.week)-Number(b.week));
  if(rows.some((r,i)=>Number(r.week)!==i+1||!Array.isArray(r.date)||r.date.length!==7||!Array.isArray(r.item)))throw Error('未完整读取连续教学周，不能确认全学期变化');
  const monday=rows[0].date.find(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.mxrq)&&weekday(x.mxrq)===1)?.mxrq;
  if(!monday)throw Error('学期开始日期未知');
  const semester={id:'school-'+monday,name:`${monday.slice(0,4)} · 学期课表`,startDate:monday,weeks:rows.length};
  const unscheduled=bundle.unscheduled||[];
  if(!Array.isArray(unscheduled)||unscheduled.some(r=>!r||typeof r.id!=='string'||typeof r.name!=='string'||!r.name.trim()||typeof r.teacher!=='string'||typeof r.room!=='string'||!Array.isArray(r.weeks)||r.weeks.some(w=>!Number.isInteger(w)||w<1||w>rows.length)))throw Error('未排时间课程结构不完整，保留旧课表');
  const rules=[],exceptions=[],seen=new Map();
  for(const row of rows){const week=Number(row.week);const expected=addDays(monday,(week-1)*7);if(!row.date.some(x=>x.mxrq===expected))throw Error('教学周与实际日期不一致');
    const keys=new Set();
    for(const item of row.item){
      if(typeof item.classTime!=='string'||!/^\d{5}$/.test(item.classTime)||!item.jx0408id||!item.courseName||!item.teacherName||typeof item.location!=='string'||!item.startTime||!item.endTIme)throw Error('课程字段不完整，需核验真实结构');
      const day=Number(item.classTime.slice(0,1)),first=Number(item.classTime.slice(1,3)),last=Number(item.classTime.slice(3,5));
      if(day<1||day>7||first<1||last<first||last>16)throw Error('课程节次结构未知');
      const id=`school-${item.jx0408id}-${item.classTime}`;
      if(keys.has(id))throw Error('同一周存在重复课程标识，不能静默合并');keys.add(id);
      const attrs={name:item.courseName,teacher:item.teacherName,room:item.location||'—',startTime:item.startTime,endTime:item.endTIme,periods:Array.from({length:last-first+1},(_,i)=>first+i)};
      if(seen.has(id)){const rule=seen.get(id);rule.weeks.push(week);const patch={};for(const k of ['name','teacher','room','startTime','endTime'])if(attrs[k]!==rule[k])patch[k]=attrs[k];if(Object.keys(patch).length)exceptions.push({date:addDays(expected,day-1),ruleId:id,patch});}
      else{const rule={id,...attrs,weekday:day,weeks:[week]};rules.push(rule);seen.set(id,rule);}
    }
  }
  if(!rules.length)throw Error('全学期无课程：需要人工确认，未覆盖已有课表');
  return validateSnapshot({schemaVersion:1,semester,source:{kind:'school',label:bundle.sourceLabel||'学校移动教务 · 本机读取',exportedAt:new Date().toISOString().slice(0,10)},rules,exceptions,remaps:[],closedDates:[],unscheduled:clone(unscheduled)});
}
