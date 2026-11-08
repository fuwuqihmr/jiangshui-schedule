// 学校教务系统（强智 jsxsd）课表数据解析 → normalizeSchool 兼容 bundle
// 数据来源为实测接口 /jsxsd/xskb/xskb_list.do?viweType=1&needData=1 的 JSON rows。
// 字段：kc_mc 课程名 / jg0101mc 教师 / sktime 上课时间 / skddmc 上课地点（分号对应段）
// sktime 段可用单节、枚举节次或范围，如第11节、第9、10、11节、第1-4节；段间以 ; 分隔。
import {validateSnapshot, addDays, weekday} from './core.mjs';

// 实测校历：2026-2027-1 学期第一周周一（与样例课表、手机端第 6 周显示一致）。
// 其他学期未实测，不臆造：解析时按周次×7 天从该起点展开。
export const SEMESTER_MONDAYS = {'2026-2027-1':'2026-08-31'};

const DAY = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':7};
// 教务处 2026-01-29 公布的上课时间表（第 1–11 节）。
// https://jw.juwp.edu.cn/info/1040/8456.htm
// 本地晚自习 19:00–20:30 不属于这份学校课表，不能拿它的时间代替晚间正式课程。
export const PERIOD_TIMES = Object.freeze({
  1:['08:30','09:10'],2:['09:15','09:55'],3:['10:15','10:55'],4:['11:00','11:40'],
  5:['14:00','14:40'],6:['14:45','15:25'],7:['15:45','16:25'],8:['16:30','17:10'],
  9:['19:00','19:40'],10:['19:45','20:25'],11:['20:30','21:10']
});

const WEEK_PATTERN = Object.freeze({every:'every',odd:'odd',even:'even'});

function normalizeWeekText(value){
  return String(value||'').trim().replace(/\s+/g,'').replace(/[（]/g,'(').replace(/[）]/g,')').replace(/[－–—~～至]/g,'-');
}

function patternFromLabel(label){
  if(label==null||label===''||label==='全部')return WEEK_PATTERN.every;
  if(label==='单周')return WEEK_PATTERN.odd;
  if(label==='双周')return WEEK_PATTERN.even;
  throw Error('周次单双周标记无法识别：'+label);
}

function weekLabelFromExpression(expression){
  return String(expression||'').trim().replace(/^第/,'').replace(/周$/,'');
}

/** Parse a school week expression, including the optional (单周)/(双周) suffix. */
export function parseWeekSpec(s){
  const text=normalizeWeekText(s);
  const m=/^第(.+?)周(?:\s*\((全部|单周|双周)\))?$/.exec(text);
  if(!m)throw Error('上课时间周次格式无法识别');
  const pattern=patternFromLabel(m[2]);
  const out=[];
  for(const part of m[1].replace(/[、，]/g,',').split(',')){
    const clean=part.trim();
    if(!clean)throw Error('周次值无效');
    const r=/^(\d+)-(\d+)$/.exec(clean);
    if(r){const a=Number(r[1]),b=Number(r[2]);if(a<1||b<a||b>60)throw Error('周次范围无效');for(let w=a;w<=b;w++)out.push(w);}
    else{const w=Number(clean);if(!Number.isInteger(w)||w<1||w>60)throw Error('周次值无效');out.push(w);}
  }
  const filtered=[...new Set(out)].sort((a,b)=>a-b).filter(w=>pattern===WEEK_PATTERN.odd?w%2===1:pattern===WEEK_PATTERN.even?w%2===0:true);
  if(!filtered.length)throw Error('单双周筛选后没有有效周次');
  return {weeks:filtered,pattern,classWeek:weekLabelFromExpression(m[1])};
}

export function parseWeekList(s){ // '第7-15周' / '第6,8,10,12,14周' / '第5-10周(单周)'
  return parseWeekSpec(s).weeks;
}

export function parseSegments(sktime, rooms){
  // → [{day,first,last,weeks,room,classWeek}]
  const segs=String(sktime||'').split(';').map(s=>s.trim()).filter(Boolean);
  if(!segs.length)throw Error('上课时间为空');
  const locs=String(rooms||'').split(';').map(s=>s.trim());
  return segs.map((seg,i)=>{
    // The system puts (全部), (单周), or (双周) after the closing brace.
    // Some deployments put the qualifier inside the braces, so accept both.
    const m=/^周([一二三四五六日])第([\d、,，\s\-－–—~～至]+)节\{([^{}]+)\}(.*)$/.exec(seg);
    if(!m)throw Error('上课时间格式无法识别：'+seg.slice(0,30));
    const periods=m[2].replace(/\s/g,'').replace(/[－–—~～至]/g,'-').split(/[、,，]/).flatMap(part=>{
      const range=/^(\d+)-(\d+)$/.exec(part);
      if(range){const first=Number(range[1]),last=Number(range[2]);if(first<1||last>16||last<first)throw Error('节次结构无法识别');return Array.from({length:last-first+1},(_,n)=>first+n);}
      if(!/^\d+$/.test(part))throw Error('节次结构无法识别');
      return [Number(part)];
    });
    const day=DAY[m[1]], first=periods[0], last=periods.at(-1);
    if(!day||first<1||last<first||last>16)throw Error('节次结构无法识别');
    if(periods.some((p,j)=>p!==first+j))throw Error('课程节次不连续：'+seg.slice(0,30));
    const inside=m[3].trim(), tail=m[4].trim();
    const weekSpec=parseWeekSpec(inside+tail);
    return {day,first,last,weeks:weekSpec.weeks,...(weekSpec.pattern===WEEK_PATTERN.every?{}:{weekPattern:weekSpec.pattern}),room:(locs[i]&&locs[i].trim())||'—',classWeek:weekSpec.classWeek};
  });
}

export function unscheduledTime(value,totalWeeks){
 if(value!=null&&typeof value!=='string')throw Error('上课时间字段无效');
 const text=String(value||'').trim();
 if(!text||/^(?:未安排|未排课|未排时间|待定|无)$/.test(text))return {weeks:[],note:'学校未安排具体上课时间'};
 const match=/^\{?第([\d、,，\s\-－–—~～至]+)周\}?(?:\(全部\))?$/.exec(text);
 if(!match)return null;
 const weeks=parseWeekList('第'+match[1].replace(/[、，]/g,',').replace(/[－–—~～至]/g,'-')+'周').filter(w=>w<=totalWeeks);
 return {weeks,note:'学校仅提供周次，具体上课时间待通知'};
}

export function buildBundle(rows, {semesterId, monday, totalWeeks, slotTimes}={}){
  // rows: 接口 data 数组；返回 normalizeSchool 兼容 bundle
  if(!Array.isArray(rows)||!rows.length)throw Error('学校课表为空，保留旧课表');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(monday||'')||weekday(monday)!==1)throw Error('学期开始日期未知');
  const weeks=[];
  const n=Number(totalWeeks);
  if(!Number.isInteger(n)||n<1||n>60)throw Error('教学周结构不完整');
  for(let w=1;w<=n;w++){
    const base=addDays(monday,(w-1)*7);
    weeks.push({week:w,date:Array.from({length:7},(_,i)=>({mxrq:addDays(base,i)})),item:[]});
  }
  const byWeek=(w)=>weeks[w-1];
  const timeOf=(p)=>slotTimes?.[p]||PERIOD_TIMES[p];
  const seen=new Set(),unscheduled=[];
  for(const r of rows){
    if(typeof r.kc_mc!=='string'||!r.kc_mc.trim())throw Error('课程字段不完整，保留旧课表');
    const name=r.kc_mc.trim();
    const teacher=(r.jg0101mc||'').trim()||'—';
    const planId=String(r.jx0404id||r.kch||name);
    if(r.sktime!=null&&typeof r.sktime!=='string')throw Error('上课时间字段无效');
    const parts=String(r.sktime||'').split(';').map(s=>s.trim()).filter(Boolean);
    if(!parts.length)parts.push('');
    const rooms=String(r.skddmc||'').split(';');
    for(const [si,part] of parts.entries()){
      const pending=unscheduledTime(part,n);
      if(pending){unscheduled.push({id:`jsxsd-pending-${planId}-${si}`,name,teacher,room:rooms[si]?.trim()||'—',...pending});continue;}
      const seg=parseSegments(part,rooms[si])[0];
      const start=timeOf(seg.first)?.[0],end=timeOf(seg.last)?.[1];
      if(!start||!end||!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||end<=start)
        throw Error(`第${seg.first}–${seg.last}节缺少有效上课时间；教务处当前公布第1–11节，原课表已保留`);
      for(const w of seg.weeks){
        if(w<1||w>n)continue;
        const weekRow=byWeek(w);
        const classTime=`${seg.day}${String(seg.first).padStart(2,'0')}${String(seg.last).padStart(2,'0')}`;
        const id=`jsxsd-${planId}-${seg.day}-${seg.first}-${seg.last}-${si}`;
        if(seen.has(`${w}|${classTime}|${id}`))continue;
        seen.add(`${w}|${classTime}|${id}`);
        weekRow.item.push({
          classTime, courseName:name, teacherName:teacher, location:seg.room,
          startTime:start, endTIme:end,
          classWeek:`第${seg.classWeek}周${seg.weekPattern==='odd'?'(单周)':seg.weekPattern==='even'?'(双周)':''}`, jx0408id:id
        });
      }
    }
  }
  if(!weeks.some(w=>w.item.length))throw Error('全学期无课程：需要人工确认，未覆盖已有课表');
  return {semesterId, weeks, unscheduled, sourceLabel:'学校教务系统 · 本机读取'};
}

export function normalizeJsxsd(rows, opts={}){
  const bundle=buildBundle(rows, opts);
  const monday=opts.monday;
  const semester={id:opts.semesterId||('jsxsd-'+monday),name:opts.semesterName||(`${monday.slice(0,4)} · 学期课表`),startDate:monday,weeks:bundle.weeks.length};
  const rules=[],exceptions=[],seen=new Map();
  for(const row of bundle.weeks){
    const week=Number(row.week);
    const keys=new Set();
    for(const item of row.item){
      if(typeof item.classTime!=='string'||!/^\d{5}$/.test(item.classTime)||!item.jx0408id||!item.courseName||!item.teacherName||typeof item.location!=='string'||!item.startTime||!item.endTIme)throw Error('课程字段不完整，需核验真实结构');
      const day=Number(item.classTime.slice(0,1)),first=Number(item.classTime.slice(1,3)),last=Number(item.classTime.slice(3,5));
      const id=`${item.jx0408id}`;
      if(keys.has(id))throw Error('同一周存在重复课程标识，不能静默合并');keys.add(id);
      const attrs={name:item.courseName,teacher:item.teacherName,room:item.location||'—',startTime:item.startTime,endTime:item.endTIme,periods:Array.from({length:last-first+1},(_,i)=>first+i)};
      if(seen.has(id)){const rule=seen.get(id);rule.weeks.push(week);const patch={};for(const k of ['name','teacher','room','startTime','endTime'])if(attrs[k]!==rule[k])patch[k]=attrs[k];if(Object.keys(patch).length)exceptions.push({date:addDays(monday,(week-1)*7+day-1),ruleId:id,patch});}
      else{const rule={id,...attrs,weekday:day,weeks:[week]};rules.push(rule);seen.set(id,rule);}
    }
  }
  if(!rules.length)throw Error('全学期无课程：需要人工确认，未覆盖已有课表');
  return validateSnapshot({schemaVersion:1,semester,source:{kind:'school',label:opts.sourceLabel||'学校教务系统 · 本机读取',exportedAt:new Date().toISOString().slice(0,10)},rules,exceptions,remaps:[],closedDates:[],unscheduled:bundle.unscheduled});
}
