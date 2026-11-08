import {addDays,timetableDay,validateSnapshot,weekday} from './core.mjs';
import {PERIOD_TIMES} from './jsxsd.mjs';

// Export from the same final schedule used by the daily and weekly screens.
// No credentials or application settings are included in these visual files.
export function exportWeekModel(state,week){
  validateSnapshot(state.snapshot);
  if(!Number.isInteger(week)||week<1||week>state.snapshot.semester.weeks)throw Error('导出周次无效');
  const start=addDays(state.snapshot.semester.startDate,(week-1)*7);
  return {week,semester:state.snapshot.semester,days:Array.from({length:7},(_,i)=>{
    const date=addDays(start,i);
    return {date,courses:timetableDay(state.snapshot,date,state.overrides,state.localMaps,state.courseSettings,state.customCourses,state.holidaySettings)};
  }),unscheduled:state.snapshot.unscheduled||[]};
}

// The overview and the plain-text rules share the same source: every final
// occurrence of the semester, including remaps, local edits, custom courses
// and evening study. Vacant display rows and cancelled classes are not courses.
export function semesterOccurrences(state){
  validateSnapshot(state.snapshot);
  const semester=state.snapshot.semester,result=[];
  for(let week=1;week<=semester.weeks;week++){
    for(let dayOffset=0;dayOffset<7;dayOffset++){
      const date=addDays(semester.startDate,(week-1)*7+dayOffset);
      const rows=timetableDay(state.snapshot,date,state.overrides,state.localMaps,state.courseSettings,state.customCourses,state.holidaySettings);
      for(const row of rows){
        if(row.vacant===true||row.cancelled===true)continue;
        result.push({
          date,week,weekday:weekday(date),ruleWeekday:row.weekday,ruleId:row.ruleId,
          name:row.name,teacher:row.teacher,room:row.room,startTime:row.startTime,endTime:row.endTime,
          periods:Array.isArray(row.periods)?[...row.periods]:[],
          localActivity:!!row.localActivity,customCourse:!!row.customCourse,
          remap:!!(row.remapId||(row.originDate&&row.originDate!==row.date)),
          override:!!row.overrideId,overlap:row.overlap===true,conflict:!!row.conflict,source:row.source
        });
      }
    }
  }
  return result;
}
const WEEKDAY_NAMES='一二三四五六日';
function cleanField(value,fallback='—'){
  const text=String(value??'').replace(/[\t\r\n]+/g,' ').trim();
  return (text||fallback).slice(0,200);
}
// Compress actual teaching weeks: consecutive runs first, then full odd/even
// runs, then enumeration. Never turn a gap into an unbroken "(全部)" range.
export function formatWeekParts(weeks,totalWeeks){
  const limit=Number.isInteger(totalWeeks)&&totalWeeks>0?totalWeeks:Infinity;
  const list=[...new Set(Array.isArray(weeks)?weeks:[])].filter(w=>Number.isInteger(w)&&w>=1&&w<=limit).sort((a,b)=>a-b);
  if(!list.length)return {text:'',pattern:'全部'};
  const min=list[0],max=list.at(-1),count=list.length;
  if(max-min+1===count)return {text:min===max?`第${min}周`:`第${min}-${max}周`,pattern:'全部'};
  if(count>=3&&max-min===2*(count-1)&&list.every((w,i)=>w===min+i*2))
    return {text:`第${min}-${max}周`,pattern:min%2===1?'单周':'双周'};
  const runs=[];let start=list[0],previous=list[0];
  for(const w of list.slice(1)){
    if(w===previous+1){previous=w;continue;}
    runs.push(start===previous?`${start}`:`${start}-${previous}`);start=w;previous=w;
  }
  runs.push(start===previous?`${start}`:`${start}-${previous}`);
  return {text:`第${runs.join('、')}周`,pattern:'全部'};
}
export function formatWeekSpec(weeks,totalWeeks){
  const part=formatWeekParts(weeks,totalWeeks);
  return part.text?`${part.text}(${part.pattern})`:'';
}
// Infer period numbers from the final start/end time. Custom courses carry no
// periods and locally edited times may be stale, so the time is authoritative.
export function occurrencePeriods(row){
  const start=String(row?.startTime||''),end=String(row?.endTime||'');
  let first=null,last=null;
  for(const [key,[periodStart,periodEnd]] of Object.entries(PERIOD_TIMES)){
    const period=Number(key);
    if(first===null&&periodEnd>start)first=period;
    if(periodStart<end)last=period;
  }
  if(Number.isInteger(first)&&Number.isInteger(last)&&first<=last)
    return Array.from({length:last-first+1},(_,index)=>first+index);
  const fallback=(Array.isArray(row?.periods)?row.periods:[]).filter(p=>Number.isInteger(p)&&p>=1&&p<=16);
  return [...new Set(fallback)].sort((a,b)=>a-b);
}
export function exportStamp(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now);
  const value=type=>parts.find(part=>part.type===type)?.value||'';
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')==='24'?'00':value('hour')}:${value('minute')}`;
}
export function unscheduledWeeksText(weeks,totalWeeks){
  if(Array.isArray(weeks)){
    const list=[...new Set(weeks)].filter(w=>Number.isInteger(w)&&w>=1&&w<=totalWeeks).sort((a,b)=>a-b);
    return list.length?formatWeekSpec(list,totalWeeks):'待确认';
  }
  const raw=String(weeks??'').replace(/\s+/g,' ').trim();
  if(!raw)return '待确认';
  const normalized=raw.replace(/[（]/g,'(').replace(/[）]/g,')').replace(/[－–—~～至]/g,'-').replace(/\s+/g,'').replace(/^第/,'').replace(/周$/,'').replace(/，/g,',');
  const pieces=normalized.split(/[,、]/).filter(Boolean),collected=[];
  let valid=pieces.length>0;
  for(const piece of pieces){
    const range=/^(\d+)-(\d+)$/.exec(piece);
    if(range){const a=Number(range[1]),b=Number(range[2]);if(a<1||b<a)valid=false;else for(let w=a;w<=b;w++)collected.push(w);}
    else if(/^\d+$/.test(piece))collected.push(Number(piece));
    else valid=false;
  }
  if(!valid||!collected.length)return raw;
  const list=[...new Set(collected)].filter(w=>w>=1&&w<=totalWeeks).sort((a,b)=>a-b);
  return list.length?formatWeekSpec(list,totalWeeks):'待确认';
}
export function buildRulesModel(state){
  const occurrences=semesterOccurrences(state),semester=state.snapshot.semester,totalWeeks=semester.weeks;
  const courses=new Map();let conflictCount=0;
  for(const row of occurrences){
    if(row.conflict)conflictCount++;
    const courseKey=`${row.name??''}\u0000${row.teacher??''}`;
    let course=courses.get(courseKey);
    if(!course){course={name:row.name,teacher:row.teacher,segments:new Map()};courses.set(courseKey,course);}
    const periods=occurrencePeriods(row),periodKey=periods.length?`p:${periods.join(',')}`:`t:${row.startTime}-${row.endTime}`;
    const segmentKey=[row.weekday,periodKey,row.startTime,row.endTime,row.room].join('\u0000');
    let segment=course.segments.get(segmentKey);
    if(!segment){segment={weekday:row.weekday,periods,startTime:row.startTime,endTime:row.endTime,room:row.room,weeks:new Set()};course.segments.set(segmentKey,segment);}
    segment.weeks.add(row.week);
  }
  const sorted=courses=>[...courses.values()].map(course=>{
    const segments=[...course.segments.values()].map(segment=>({
      weekday:segment.weekday,periods:[...segment.periods],startTime:segment.startTime,endTime:segment.endTime,room:segment.room,
      weeks:[...segment.weeks].sort((a,b)=>a-b)
    })).sort((a,b)=>a.weekday-b.weekday||a.startTime.localeCompare(b.startTime)||(a.periods[0]??99)-(b.periods[0]??99)||String(a.room??'').localeCompare(String(b.room??'')));
    return {name:course.name,teacher:course.teacher,rooms:segments.map(segment=>segment.room),segments};
  }).sort((a,b)=>{
    const minDay=course=>Math.min(...course.segments.map(segment=>segment.weekday));
    const minTime=course=>course.segments.reduce((value,segment)=>segment.startTime<value?segment.startTime:value,'99:99');
    return minDay(a)-minDay(b)||minTime(a).localeCompare(minTime(b))||String(a.name??'').localeCompare(String(b.name??''))||String(a.teacher??'').localeCompare(String(b.teacher??''));
  });
  const sourceKind=state.snapshot.source?.kind||'sample';
  return {
    kind:'rules-text',
    semester:{name:semester.name,startDate:semester.startDate,weeks:totalWeeks},
    totalWeeks,
    generatedAt:exportStamp(),
    sourceLabel:state.snapshot.source?.label||(sourceKind==='school'?'学校教务系统':'交接样例'),
    sourceKind,
    courses:sorted(courses),
    unscheduled:(state.snapshot.unscheduled||[]).map(item=>({
      name:cleanField(item.name,'未命名课程'),
      teacher:cleanField(item.teacher,'—'),
      room:cleanField(item.room,'—'),
      weeksText:unscheduledWeeksText(item.weeks,totalWeeks),
      note:cleanField(item.note,'学校仅提供周次，具体上课时间待通知')
    })),
    conflictCount,
    empty:courses.size===0
  };
}
export function buildRulesText(state){
  const model=buildRulesModel(state),totalWeeks=model.totalWeeks;
  const endDate=addDays(model.semester.startDate,totalWeeks*7-1);
  const lines=[
    '# 江水课表 · 纯文本课表规则',
    `# 学期：${cleanField(model.semester.name,'当前学期')}`,
    `# 教学周：${totalWeeks===1?'第1周':`第1-${totalWeeks}周`}（${model.semester.startDate} 至 ${endDate}）`,
    `# 导出时间：${model.generatedAt}（Asia/Shanghai）`,
    `# 来源：${cleanField(model.sourceLabel,model.sourceKind==='school'?'学校教务系统':'交接样例')}${model.sourceKind==='school'?'':'（非学校教务来源）'}`,
    '# 说明：按当前最终生效课表导出，包含调休、自定义课程和晚自习；不包含账号、密码或登录凭据。',
    '# 格式：课程名<Tab>教师<Tab>教室<Tab>上课时间；多段以 ; 分隔；周次写作 {第7-15周}(全部|单周|双周)',
    '课程名\t教师\t教室\t上课时间'
  ];
  if(model.empty)lines.push('# 本学期没有可导出的课程');
  for(const course of model.courses){
    const segments=course.segments.map(segment=>{
      const week=formatWeekParts(segment.weeks,totalWeeks);
      const periods=segment.periods.length?`第${segment.periods.join('、')}节`:`${segment.startTime}–${segment.endTime}`;
      return `周${WEEKDAY_NAMES[segment.weekday-1]}${periods}{${week.text}}(${week.pattern})`;
    }).join(';');
    lines.push([cleanField(course.name,'未命名课程'),cleanField(course.teacher),cleanField(course.rooms.join(';')),segments].join('\t'));
  }
  if(model.unscheduled.length){
    lines.push('');
    lines.push('# 未排时间的课程');
    lines.push('课程名\t教师\t教室\t周次\t说明');
    for(const item of model.unscheduled)lines.push([item.name,item.teacher,item.room,item.weeksText,item.note].join('\t'));
  }
  if(model.conflictCount>0)lines.push(`# 注意：有 ${model.conflictCount} 处来源冲突，按当前显示版本导出，请向学校确认。`);
  return lines.join('\n')+'\n';
}
export function buildSemesterOverviewModel(state){
  const occurrences=semesterOccurrences(state),semester=state.snapshot.semester,totalWeeks=semester.weeks;
  const cards=new Map();
  for(const row of occurrences){
    const key=[row.weekday,row.startTime,row.endTime,row.name,row.teacher,row.room,row.localActivity?'study':'',row.customCourse?'custom':''].join('\u0000');
    let card=cards.get(key);
    if(!card){card={key,name:row.name,teacher:row.teacher,room:row.room,weekday:row.weekday,startTime:row.startTime,endTime:row.endTime,periods:[...row.periods],weeks:new Set(),localActivity:false,customCourse:false,remap:false,override:false,overlap:false,conflict:false,sources:new Set()};cards.set(key,card);}
    card.weeks.add(row.week);
    if(!card.periods.length&&row.periods.length)card.periods=[...row.periods];
    card.localActivity=card.localActivity||row.localActivity;
    card.customCourse=card.customCourse||row.customCourse;
    card.remap=card.remap||row.remap;
    card.override=card.override||row.override;
    card.overlap=card.overlap||row.overlap;
    card.conflict=card.conflict||row.conflict;
    if(typeof row.source==='string')card.sources.add(row.source);
  }
  const days=Array.from({length:7},(_,index)=>({weekday:index+1,courses:[]}));
  let conflictCount=0;
  for(const card of cards.values()){
    if(card.conflict)conflictCount++;
    days[card.weekday-1].courses.push({
      key:card.key,name:card.name,teacher:card.teacher,room:card.room,weekday:card.weekday,
      startTime:card.startTime,endTime:card.endTime,periods:card.periods,
      weeks:[...card.weeks].sort((a,b)=>a-b),
      localActivity:card.localActivity,customCourse:card.customCourse,remap:card.remap,override:card.override,
      overlap:card.overlap,conflict:card.conflict,sources:[...card.sources]
    });
  }
  for(const day of days)day.courses.sort((a,b)=>a.startTime.localeCompare(b.startTime)||a.endTime.localeCompare(b.endTime)||String(a.name??'').localeCompare(String(b.name??''))||String(a.teacher??'').localeCompare(String(b.teacher??'')));
  return {
    kind:'semester-overview',
    semester:{name:semester.name,startDate:semester.startDate,weeks:totalWeeks},
    totalWeeks,
    days,
    unscheduled:[...(state.snapshot.unscheduled||[])],
    conflictCount
  };
}

export const PAGE_WIDTH=2520,PAGE_HEIGHT=1782;
const MARGIN=68,TIME_WIDTH=126,HEADER_BOTTOM=316,GRID_BOTTOM=1610;
const COL_WIDTH=(PAGE_WIDTH-MARGIN*2-TIME_WIDTH)/7;
const FONT='"Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",sans-serif';
const PALETTE=[['#edf3ff','#305b9d'],['#eff7f1','#356f4b'],['#f4f0fc','#6e5796'],['#fff5eb','#946129'],['#edf7fa','#2d6f83']];
const BAND_DEFS=[
  {start:'00:00',end:'08:30',title:'早间',time:'08:30 前',optional:true},
  {start:'08:30',end:'10:15',title:'上午',time:'08:30 起'},
  {start:'10:15',end:'12:00',title:'上午',time:'10:15 起'},
  {start:'12:00',end:'14:00',title:'午间',time:'12:00 起',optional:true},
  {start:'14:00',end:'15:45',title:'下午',time:'14:00 起'},
  {start:'15:45',end:'18:00',title:'下午',time:'15:45 起'},
  {start:'18:00',end:'24:00',title:'晚上',time:'18:00 起'}
];
function font(ctx,size,weight=400){ctx.font=`${weight} ${size}px ${FONT}`;}
function wrap(ctx,value,width){
  const paragraphs=String(value??'').split(/\r?\n/),result=[];
  for(const paragraph of paragraphs){let line='';for(const char of paragraph){if(line&&ctx.measureText(line+char).width>width){result.push(line);line=char;}else line+=char;}result.push(line);}
  return result.length?result:[''];
}
function missing(value,fallback){return value&&value!=='—'?String(value):fallback;}
function courseLines(ctx,course,density=1){
  const width=COL_WIDTH-42,lines=[];
  const add=(value,size=26,weight=400,color='#384b61')=>{
    size=Math.round(size*density);font(ctx,size,weight);for(const text of wrap(ctx,value,width))lines.push({text,size,weight,color,height:size+Math.round(10*density)});
  };
  add(course.name,30,700,course.cancelled?'#737d89':'#22364d');
  add(`${course.startTime}–${course.endTime}`,26,600);
  if(course.vacant){add(course.movedTo?`已调至 ${course.movedTo}`:'原课程已被替换',24);add('此时段不上课',24);}
  else if(course.cancelled)add('停课 · 此时段不上课',24);
  else{
    add(`地点：${missing(course.room,'待确认')}`);
    add(`老师：${course.localActivity?'无任课老师':missing(course.teacher,'未填写')}`);
    const labels=[];
    if(course.remapId)labels.push(`调休自 ${course.originDate}`);
    if(course.overrideId)labels.push('本人修改');
    if(course.customCourse)labels.push('自定义');
    if(course.overlap)labels.push('时间重叠');
    if(course.conflict)labels.push('来源冲突，请确认');
    if(labels.length)add(labels.join(' · '),22,400,course.overlap||course.conflict?'#a23b3b':'#607088');
  }
  return {course,lines,height:lines.reduce((n,l)=>n+l.height,0)+22};
}
function bandLayouts(ctx,model,density=1){
  return BAND_DEFS.map(band=>({...band,cells:model.days.map(day=>day.courses.filter(r=>r.startTime>=band.start&&r.startTime<band.end).map(r=>courseLines(ctx,r,density)))}))
    .filter(band=>!band.optional||band.cells.some(cell=>cell.length));
}
function cellHeight(cell){return cell.reduce((sum,card)=>sum+card.height+10,0)+20;}
// Split exceptionally crowded time slots into continuation pages, never omit a course.
function takeBandSegment(band,queues,maxHeight,continuation){
  const cells=queues.map(queue=>{
    let remaining=maxHeight-20;const result=[];
    while(queue.length){
      const card=queue[0];
      if(card.height+10<=remaining){result.push(card);remaining-=card.height+10;queue.shift();continue;}
      if(result.length)break;
      const lines=[];let used=22;
      while(card.lines.length&&used+card.lines[0].height+10<=remaining){const line=card.lines.shift();lines.push(line);used+=line.height;}
      if(!lines.length)throw Error('课程内容过长，无法排版');
      result.push({...card,lines,height:used,continued:true});
      card.height=card.lines.reduce((sum,line)=>sum+line.height,0)+22;
      if(!card.lines.length)queue.shift();
      break;
    }
    return result;
  });
  return {...band,cells,continuation,height:Math.max(188,...cells.map(cellHeight))};
}
function paginate(bands){
  const available=GRID_BOTTOM-HEADER_BOTTOM,pages=[];let current=[],used=0;
  const nextPage=()=>{if(current.length)pages.push(current);current=[];used=0;};
  for(const band of bands){
    const queues=band.cells.map(cell=>cell.map(card=>({...card,lines:[...card.lines]})));
    let continuation=false;
    do{
      const needed=Math.max(188,...queues.map(cellHeight));
      // Avoid splitting an ordinary card just because the previous row filled the page.
      if(current.length&&(available-used<188||(needed<=available&&needed>available-used)))nextPage();
      const row=takeBandSegment(band,queues,available-used,continuation);
      current.push(row);used+=row.height;continuation=true;
      if(queues.some(queue=>queue.length))nextPage();
    }while(queues.some(queue=>queue.length));
  }
  nextPage();return pages;
}
function text(ctx,value,x,y,size=28,weight=400,color='#24394f',maxWidth){
  font(ctx,size,weight);ctx.fillStyle=color;
  if(maxWidth)ctx.fillText(value,x,y,maxWidth);else ctx.fillText(value,x,y);
}
function rectangle(ctx,x,y,w,h,fill,stroke){ctx.fillStyle=fill;ctx.fillRect(x,y,w,h);if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);}}
function baseCanvas(model,pageNumber,pageCount,createCanvas){
  const canvas=createCanvas();canvas.width=PAGE_WIDTH;canvas.height=PAGE_HEIGHT;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('设备不支持课表图片导出');
  ctx.textBaseline='top';rectangle(ctx,0,0,PAGE_WIDTH,PAGE_HEIGHT,'#ffffff');
  rectangle(ctx,MARGIN,54,8,146,'#478abd');
  text(ctx,'江水课表',MARGIN+28,52,58,700);
  text(ctx,`第 ${model.week} 周课表${pageCount>1?` · ${pageNumber}/${pageCount}`:''}`,MARGIN+28,126,34,600,'#4b769a');
  const name=model.semester.name||'当前学期';font(ctx,26);const nameWidth=ctx.measureText(name).width;
  text(ctx,name.slice(0,100),Math.max(PAGE_WIDTH/2,PAGE_WIDTH-MARGIN-Math.min(nameWidth,PAGE_WIDTH/2-MARGIN)),70,26,400,'#516476');
  text(ctx,`${model.days[0].date} — ${model.days[6].date}`,PAGE_WIDTH-MARGIN-530,128,28,500);
  text(ctx,'按当前生效安排导出 · 调课 / 调休 / 自定义课程 / 晚自习',MARGIN,218,26,400,'#607088');
  text(ctx,'灰色：此时段不上课    红色标注：重叠或待确认',MARGIN,1652,24,400,'#66788b');
  const pending=model.unscheduled.length;
  text(ctx,pending?`另有 ${pending} 门未排时间课程，见学期 PDF 附页`:'空课时保留白底，课程时间以卡片标注为准',MARGIN,1694,24,400,'#66788b');
  text(ctx,`第 ${model.week} 周${pageCount>1?` · 续页 ${pageNumber}/${pageCount}`:''}`,PAGE_WIDTH-MARGIN-295,1694,24,400,'#66788b');
  return {canvas,ctx};
}
function weekCanvasPages(model,createCanvas=()=>document.createElement('canvas')){
  const measuring=createCanvas();const ctx=measuring.getContext('2d');if(!ctx)throw Error('设备不支持课表图片导出');
  let bands=bandLayouts(ctx,model);
  const totalHeight=items=>items.reduce((sum,band)=>sum+Math.max(188,...band.cells.map(cellHeight)),0),available=GRID_BOTTOM-HEADER_BOTTOM;
  // A slightly smaller card font keeps an ordinary busy week on one landscape page.
  if(totalHeight(bands)>available&&totalHeight(bands)<=available*1.35){
    for(const density of [.92,.84]){bands=bandLayouts(ctx,model,density);if(totalHeight(bands)<=available)break;}
  }
  const pages=paginate(bands);measuring.width=1;measuring.height=1;
  return {length:pages.length,*[Symbol.iterator](){for(let p=0;p<pages.length;p++){const rows=pages[p];
    const {canvas,ctx}=baseCanvas(model,p+1,pages.length,createCanvas);
    rectangle(ctx,MARGIN,264,TIME_WIDTH,52,'#eef4fa','#cfdae5');
    text(ctx,'时段',MARGIN+28,277,26,600);
    for(let d=0;d<7;d++){
      const x=MARGIN+TIME_WIDTH+d*COL_WIDTH;
      rectangle(ctx,x,264,COL_WIDTH,52,'#eef4fa','#cfdae5');
      text(ctx,`周${'一二三四五六日'[d]}  ${Number(model.days[d].date.slice(5,7))}/${Number(model.days[d].date.slice(8))}`,x+24,277,26,600);
    }
    const spare=GRID_BOTTOM-HEADER_BOTTOM-rows.reduce((n,r)=>n+r.height,0);
    let y=HEADER_BOTTOM;
    for(const row of rows){
      const height=row.height+spare/rows.length;
      rectangle(ctx,MARGIN,y,TIME_WIDTH,height,'#f8fafc','#cfdae5');
      text(ctx,row.title,MARGIN+28,y+32,28,600);text(ctx,row.time,MARGIN+12,y+76,22,400,'#61748b');
      if(row.continuation)text(ctx,'续',MARGIN+46,y+112,22,400,'#61748b');
      for(let d=0;d<7;d++){
        const x=MARGIN+TIME_WIDTH+d*COL_WIDTH;
        rectangle(ctx,x,y,COL_WIDTH,height,'#ffffff','#cfdae5');
        let cardY=y+12;
        for(const card of row.cells[d]){
          const course=card.course;let hash=0;for(const c of course.name)hash+=c.charCodeAt(0);
          const [fill]=course.cancelled?['#edf0f3','#8c96a2']:PALETTE[hash%PALETTE.length];
          rectangle(ctx,x+9,cardY,COL_WIDTH-18,card.height,fill);
          let lineY=cardY+10;
          for(const line of card.lines){text(ctx,line.text,x+21,lineY,line.size,line.weight,line.color);lineY+=line.height;}
          cardY+=card.height+10;
        }
      }
      y+=height;
    }
    yield canvas;
  }}};
}
export function renderWeekPages(model,createCanvas){return Array.from(weekCanvasPages(model,createCanvas));}
export function renderUnscheduledPages(state,createCanvas=()=>document.createElement('canvas')){
  const list=state.snapshot.unscheduled||[];if(!list.length)return [];
  const canvasForMeasure=createCanvas(),measure=canvasForMeasure.getContext('2d');font(measure,28);
  const entries=list.map(r=>{
    const label=`${missing(r.name,'未命名课程')}  ·  周次：${missing(Array.isArray(r.weeks)?r.weeks.join('、'):r.weeks,'待确认')}\n地点：${missing(r.room,'待确认')}  ·  老师：${missing(r.teacher,'待确认')}`;
    return wrap(measure,label,PAGE_WIDTH-2*MARGIN-48);
  });
  const pages=[];let canvas,ctx,y;
  const newPage=()=>{
    canvas=createCanvas();canvas.width=PAGE_WIDTH;canvas.height=PAGE_HEIGHT;ctx=canvas.getContext('2d');ctx.textBaseline='top';rectangle(ctx,0,0,PAGE_WIDTH,PAGE_HEIGHT,'#ffffff');
    text(ctx,'江水课表 · 未排时间的课程',MARGIN,60,52,700);
    text(ctx,'这些课程尚未安排具体日期或时段，请以学校后续通知为准。',MARGIN,140,28,400,'#61748b');y=234;pages.push(canvas);
  };
  newPage();
  for(const lines of entries){
    const height=lines.length*42+32;
    if(y+height>GRID_BOTTOM&&y>234)newPage();
    for(const line of lines){if(y+50>GRID_BOTTOM)newPage();text(ctx,line,MARGIN+20,y,28);y+=42;}
    y+=32;ctx.strokeStyle='#d7e1ec';ctx.beginPath();ctx.moveTo(MARGIN,y-16);ctx.lineTo(PAGE_WIDTH-MARGIN,y-16);ctx.stroke();
  }
  return pages;
}
// B is one image by contract: the canvas may grow to 3600px (4096 in the
// extreme fallback), but it never splits into pages and never becomes a PDF.
const OVERVIEW_BASE_HEIGHT=1782,OVERVIEW_SOFT_MAX=3600,OVERVIEW_HARD_MAX=4096,OVERVIEW_ROW_MIN=120,OVERVIEW_FOOTER_RESERVE=172,OVERVIEW_COMPACT_THRESHOLD=5,OVERVIEW_COMPACT_MAX_COLUMNS=4;
function overviewLineGap(density){return Math.max(4,Math.round(10*density));}
function overviewPad(density){return Math.max(8,Math.round(22*density));}
function overviewGap(density){return Math.max(4,Math.round(10*density));}
function overviewFont(size,density){return Math.max(8,Math.round(size*density));}
function overviewTags(card,compact=false){
  const tags=[];
  if(card.customCourse)tags.push('自定义');
  if(card.localActivity)tags.push('晚自习');
  if(card.override)tags.push('本人修改');
  if(card.remap)tags.push('调休');
  if(card.overlap)tags.push('时间重叠');
  if(card.conflict)tags.push(compact?'来源冲突':'来源冲突，请确认');
  return tags;
}
function overviewAddLine(lines,ctx,value,size,weight,color,textWidth,density){
  const px=overviewFont(size,density);
  font(ctx,px,weight);
  for(const textValue of wrap(ctx,value,textWidth))lines.push({text:textValue,size:px,weight,color,height:px+overviewLineGap(density)});
}
function overviewEntryLine(lines,value,size,weight,color,textWidth,density){
  const px=overviewFont(size,density);
  lines.push({text:String(value),size:px,weight,color,height:px+overviewLineGap(density),maxWidth:Math.max(1,textWidth)});
}
function overviewCourseLines(ctx,card,totalWeeks,density=1,level='full'){
  const lines=[],pad=overviewPad(density),textWidth=COL_WIDTH-42;
  const add=(value,size,weight,color)=>overviewAddLine(lines,ctx,value,size,weight,color,textWidth,density);
  add(card.name,30,700,'#22364d');
  const weekSpec=formatWeekSpec(card.weeks,totalWeeks);
  if(level==='minimal'){
    const tags=overviewTags(card,true);
    add(`周次：${weekSpec}${tags.length?` · ${tags.join(' · ')}`:''}`,24,600,card.overlap||card.conflict?'#a23b3b':'#305b9d');
  }else add(`周次：${weekSpec}`,24,600,'#305b9d');
  add(`${card.startTime}–${card.endTime}`,24,600,'#384b61');
  if(level==='full'){
    add(`地点：${missing(card.room,'待确认')}`,24,400,'#384b61');
    add(`教师：${card.localActivity?'无任课老师':missing(card.teacher,'未填写')}`,24,400,'#384b61');
  }else if(level==='merge'){
    add(`地点：${missing(card.room,'待确认')} · 教师：${card.localActivity?'无任课老师':missing(card.teacher,'未填写')}`,24,400,'#384b61');
  }
  const tags=level==='minimal'?[]:overviewTags(card);
  if(tags.length)add(tags.join(' · '),22,400,card.overlap||card.conflict?'#a23b3b':'#607088');
  return {kind:'card',course:card,lines,topPad:Math.round(overviewPad(density)/2),height:lines.reduce((sum,line)=>sum+line.height,0)+overviewPad(density)};
}
// One crowded cell: share the time header once, then one compact entry per
// course (name + actual weeks). Use the widest columns that stay under the
// hard height budget; narrow columns are only needed for extreme overlap.
function overviewCompactGroup(ctx,cards,totalWeeks,density=1){
  const startTime=cards[0].startTime,endTime=cards[0].endTime,pad=Math.max(8,Math.round(14*density)),gap=Math.max(3,Math.round(6*density));
  const headerSize=overviewFont(22,density),headerGap=Math.max(4,Math.round(8*density)),blockWidth=COL_WIDTH-18;
  const blockBudget=OVERVIEW_HARD_MAX-HEADER_BOTTOM-OVERVIEW_FOOTER_RESERVE;
  let best=null;
  for(let columns=1;columns<=OVERVIEW_COMPACT_MAX_COLUMNS;columns++){
    const columnWidth=(blockWidth-2*pad-(columns-1)*gap)/columns,entries=[];
    for(const card of cards){
      const lines=[],tags=overviewTags(card,true);
      overviewEntryLine(lines,card.name,24,700,'#22364d',columnWidth,density);
      overviewEntryLine(lines,`周次：${formatWeekSpec(card.weeks,totalWeeks)}`,20,600,'#305b9d',columnWidth,density);
      if(tags.length)overviewEntryLine(lines,tags.join(' · '),18,400,card.overlap||card.conflict?'#a23b3b':'#607088',columnWidth,density);
      entries.push({lines,height:lines.reduce((sum,line)=>sum+line.height,0)+gap});
    }
    const total=entries.reduce((sum,entry)=>sum+entry.height,0),columnLists=Array.from({length:columns},()=>[]);
    let index=0,accumulated=0;
    for(const entry of entries){
      if(index<columns-1&&accumulated>0&&accumulated+entry.height/2>total*(index+1)/columns){index++;accumulated=0;}
      columnLists[index].push(entry);accumulated+=entry.height;
    }
    const columnHeight=Math.max(0,...columnLists.map(list=>list.reduce((sum,entry)=>sum+entry.height,0)));
    const height=headerSize+headerGap+columnHeight+2*pad;
    if(!best||height<best.height)best={kind:'compact',course:cards[0],cards,header:{text:`${startTime}–${endTime}`,size:headerSize,weight:600,color:'#2d6f83',height:headerSize+headerGap},columns:columnLists,columnWidth,columnGap:gap,pad,height};
    if(height<=blockBudget)break;
  }
  return best;
}
function overviewBandLayouts(ctx,model,density=1,level='full'){
  let compactUsed=false;
  const bands=BAND_DEFS.map(band=>{
    const cells=model.days.map(day=>{
      const cards=day.courses.filter(card=>card.startTime>=band.start&&card.startTime<band.end);
      if(cards.length>=OVERVIEW_COMPACT_THRESHOLD){
        compactUsed=true;
        const groups=new Map();
        for(const card of cards){
          const key=`${card.startTime}\u0000${card.endTime}`;
          if(!groups.has(key))groups.set(key,[]);
          groups.get(key).push(card);
        }
        return [...groups.values()].map(group=>overviewCompactGroup(ctx,group,model.totalWeeks,density));
      }
      return cards.map(card=>overviewCourseLines(ctx,card,model.totalWeeks,density,level));
    });
    return {...band,cells};
  }).filter(band=>band.cells.some(cell=>cell.length));
  return {bands,compactUsed,gap:overviewGap(density)};
}
function overviewCellHeight(cell,gap){return cell.reduce((sum,block)=>sum+block.height+gap,0)+20;}
function overviewMeasure(ctx,model,density,level){
  const {bands,compactUsed,gap}=overviewBandLayouts(ctx,model,density,level);
  const rows=bands.map(band=>({...band,height:Math.max(OVERVIEW_ROW_MIN,...band.cells.map(cell=>overviewCellHeight(cell,gap)))}));
  const contentH=rows.reduce((sum,row)=>sum+row.height,0);
  return {bands:rows,contentH,compactUsed,gap,density,level,natural:HEADER_BOTTOM+contentH+OVERVIEW_FOOTER_RESERVE};
}
function overviewNotice(layout,{hard=false,squeeze=false}={}){
  if(squeeze)return '课程极多，已自动压缩显示，请放大查看；完整信息请用『纯文本规则』导出';
  const parts=[];
  if(layout.density<1)parts.push('已自动缩小字号');
  if(layout.level==='merge')parts.push('已合并教师与教室');
  if(layout.level==='minimal')parts.push('已精简教师与教室');
  if(layout.compactUsed)parts.push('同格课程已改用紧凑列表（精简教师/教室）');
  if(layout.density<=.68)parts.push('字号已接近下限，请放大查看');
  if(hard)parts.push('图片已接近高度上限，请放大查看');
  return parts.length?`课程较多，${parts.join('，')}`:'';
}
function selectOverviewLayout(ctx,model){
  const levels=['full','merge','minimal'],softDensities=[1,.92,.84,.72],extremeDensities=[.68,.64],candidates=[];
  for(const level of levels)for(const density of softDensities){
    const layout=overviewMeasure(ctx,model,density,level);candidates.push(layout);
    if(layout.natural<=OVERVIEW_SOFT_MAX)return {...layout,height:Math.max(OVERVIEW_BASE_HEIGHT,layout.natural),notice:overviewNotice(layout),tone:'#607088'};
  }
  // .68/.64 are only a fallback; still try to keep the image at 3600px or less
  // before allowing the hard 4096px limit.
  for(const level of levels)for(const density of extremeDensities){
    const layout=overviewMeasure(ctx,model,density,level);candidates.push(layout);
    if(layout.natural<=OVERVIEW_SOFT_MAX)return {...layout,height:Math.max(OVERVIEW_BASE_HEIGHT,layout.natural),notice:overviewNotice(layout),tone:'#946129'};
  }
  for(const layout of candidates)if(layout.natural<=OVERVIEW_HARD_MAX)
    return {...layout,height:Math.max(OVERVIEW_BASE_HEIGHT,layout.natural),notice:overviewNotice(layout,{hard:true}),tone:'#946129'};
  const smallest=candidates.reduce((best,layout)=>layout.natural<best.natural?layout:best);
  const available=OVERVIEW_HARD_MAX-HEADER_BOTTOM-OVERVIEW_FOOTER_RESERVE,scaleY=Math.min(1,available/Math.max(1,smallest.contentH));
  return {...smallest,height:OVERVIEW_HARD_MAX,scaleY,notice:overviewNotice(smallest,{squeeze:true}),tone:'#a23b3b'};
}
function overviewFooterBase(model){
  const pending=model.unscheduled.length,hasCourses=model.days.some(day=>day.courses.length);
  if(!hasCourses&&!pending)return '本学期暂无已排课程';
  if(!hasCourses)return `本学期暂无已排课程 · 另有 ${pending} 门未排时间课程，请用『纯文本规则』导出查看`;
  if(pending)return `另有 ${pending} 门未排时间课程，请用『纯文本规则』导出查看`;
  const example=model.totalWeeks>=8?'周次标签：第7-15周(单周) 表示只在第7、9、11、13、15周上课；':'';
 return `${model.totalWeeks===1?'第1周':`第1-${model.totalWeeks}周`}(全部) 表示每周上课`;
}
function overviewBaseCanvas(model,height,createCanvas){
  const canvas=createCanvas();canvas.width=PAGE_WIDTH;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('设备不支持课表图片导出');
  ctx.textBaseline='top';rectangle(ctx,0,0,PAGE_WIDTH,height,'#ffffff');
  rectangle(ctx,MARGIN,54,8,146,'#478abd');
  text(ctx,'江水课表',MARGIN+28,52,58,700);
  const weekText=model.totalWeeks===1?'第 1 周':`第 1-${model.totalWeeks} 周`;
  text(ctx,`整学期总览 · ${weekText}`,MARGIN+28,126,34,600,'#4b769a');
  const name=model.semester.name||'当前学期';font(ctx,26);const nameWidth=ctx.measureText(name).width;
  text(ctx,name.slice(0,100),Math.max(PAGE_WIDTH/2,PAGE_WIDTH-MARGIN-Math.min(nameWidth,PAGE_WIDTH/2-MARGIN)),70,26,400,'#516476');
  const endDate=addDays(model.semester.startDate,model.totalWeeks*7-1);
  text(ctx,`${model.semester.startDate} — ${endDate}`,PAGE_WIDTH-MARGIN-530,128,28,500);
  text(ctx,'按当前生效安排合并 · 调休 / 自定义课程 / 晚自习',MARGIN,218,26,400,'#607088');
  return {canvas,ctx};
}
function drawOverviewLines(draw,lines,x,y,scaleY){
  let lineY=y;
  for(const line of lines){text(draw,line.text,x,lineY,Math.max(1,Math.round(line.size*scaleY)),line.weight,line.color,line.maxWidth?line.maxWidth*scaleY:undefined);lineY+=line.height*scaleY;}
}
function drawOverviewBlock(draw,block,x,y,width,scaleY){
  if(block.kind==='compact'){
    rectangle(draw,x,y,width,block.height*scaleY,'#f3f8fc','#d7e3ee');
    const pad=block.pad*scaleY,headerTop=y+pad;
    text(draw,block.header.text,x+pad,headerTop,Math.max(1,Math.round(block.header.size*scaleY)),block.header.weight,block.header.color);
    const entryTop=headerTop+block.header.height*scaleY;
    for(let index=0;index<block.columns.length;index++){
      let lineY=entryTop;
      const columnX=x+pad+index*(block.columnWidth+block.columnGap);
      for(const entry of block.columns[index]){
        drawOverviewLines(draw,entry.lines,columnX,lineY,scaleY);
        lineY+=entry.height*scaleY;
      }
    }
    return;
  }
  let hash=0;for(const character of block.course.name)hash+=character.charCodeAt(0);
  const [fill]=PALETTE[hash%PALETTE.length];
  rectangle(draw,x,y,width,block.height*scaleY,fill);
  drawOverviewLines(draw,block.lines,x+12,y+(block.topPad||10)*scaleY,scaleY);
}
export function renderSemesterOverviewPage(model,createCanvas=()=>document.createElement('canvas')){
  const measuring=createCanvas();const ctx=measuring.getContext('2d');if(!ctx)throw Error('设备不支持课表图片导出');
  const layout=selectOverviewLayout(ctx,model);
  measuring.width=1;measuring.height=1;
  const height=Math.round(layout.height),scaleY=layout.scaleY||1;
  const {canvas,ctx:draw}=overviewBaseCanvas(model,height,createCanvas);
  rectangle(draw,MARGIN,264,TIME_WIDTH,52,'#eef4fa','#cfdae5');
  text(draw,'时段',MARGIN+28,277,26,600);
  for(let d=0;d<7;d++){
    const x=MARGIN+TIME_WIDTH+d*COL_WIDTH;
    rectangle(draw,x,264,COL_WIDTH,52,'#eef4fa','#cfdae5');
    text(draw,`周${WEEKDAY_NAMES[d]}`,x+24,277,26,600);
  }
  const gridBottom=height-OVERVIEW_FOOTER_RESERVE;
  const spare=scaleY===1?Math.max(0,gridBottom-HEADER_BOTTOM-layout.contentH):0;
  let y=HEADER_BOTTOM;
  for(const row of layout.bands){
    const heightOfRow=row.height*scaleY+(layout.bands.length?spare/layout.bands.length:0);
    rectangle(draw,MARGIN,y,TIME_WIDTH,heightOfRow,'#f8fafc','#cfdae5');
    text(draw,row.title,MARGIN+28,y+32*scaleY,Math.max(10,Math.round(28*scaleY)),600);
    text(draw,row.time,MARGIN+12,y+76*scaleY,Math.max(8,Math.round(22*scaleY)),400,'#61748b');
    for(let d=0;d<7;d++){
      const x=MARGIN+TIME_WIDTH+d*COL_WIDTH;
      rectangle(draw,x,y,COL_WIDTH,heightOfRow,'#ffffff','#cfdae5');
      let blockY=y+10*scaleY;
      for(const block of row.cells[d]){
        drawOverviewBlock(draw,block,x+9,blockY,COL_WIDTH-18,scaleY);
        blockY+=block.height*scaleY+layout.gap*scaleY;
      }
    }
    y+=heightOfRow;
  }
  const base=overviewFooterBase(model),notice=layout.notice;
  const footer=[notice,notice&&model.days.some(day=>day.courses.length)&&!model.unscheduled.length?null:base].filter(Boolean).join(' · ');
  text(draw,footer,MARGIN,height-130,24,notice?600:400,notice?layout.tone:'#66788b');
  text(draw,'整学期 · 一张总览',PAGE_WIDTH-MARGIN-295,height-88,24,400,'#66788b');
  return canvas;
}
export function renderSemesterOverviewPages(model,createCanvas=()=>document.createElement('canvas')){
  return [renderSemesterOverviewPage(model,createCanvas)];
}
export function canvasBlob(canvas,type='image/png',quality=.94){
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('图片编码失败，请稍后重试')),type,quality));
}
export function bytesToBase64(bytes){
  let binary='';for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
  return btoa(binary);
}
// Binary PDF writer: embed each high-resolution raster page on landscape A4.
// Stream lengths and cross-reference offsets are counted in bytes, not characters.
export function imagePagesPdf(pages){
  if(!pages.length)throw Error('没有可导出的课表');
  const enc=new TextEncoder(),chunks=[],offsets=[0];let position=0;
  const append=value=>{const bytes=typeof value==='string'?enc.encode(value):value;chunks.push(bytes);position+=bytes.length;};
  const object=(id,body)=>{offsets[id]=position;append(`${id} 0 obj\n`);append(body);append('\nendobj\n');};
  append('%PDF-1.4\n');append(new Uint8Array([37,226,227,207,211,10]));
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');
  object(2,`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`);
  pages.forEach((page,i)=>{
    const id=3+i*3;
    object(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] /Resources << /XObject << /Im0 ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);
    offsets[id+1]=position;append(`${id+1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`);append(page.bytes);append('\nendstream\nendobj\n');
    const content='q\n841.89 0 0 595.28 0 0 cm\n/Im0 Do\nQ\n';
    object(id+2,`<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`);
  });
  const xref=position,count=3+pages.length*3;
  append(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for(let id=1;id<count;id++)append(`${String(offsets[id]).padStart(10,'0')} 00000 n \n`);
  append(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const result=new Uint8Array(position);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
export async function createTimetableExport(state,{kind='week',week=1,onProgress=()=>{},yieldPage=()=>new Promise(resolve=>setTimeout(resolve,0)),shouldCancel=()=>false}={}){
  if(!['week','semester','semester-overview','rules-text'].includes(kind))throw Error('导出类型无效');
  const check=()=>{if(typeof shouldCancel==='function'&&shouldCancel())throw Error('已取消导出');};
  const semester=state.snapshot.semester;
  check();
  if(kind==='rules-text'){
    onProgress('正在汇总整个学期');await yieldPage();check();
    onProgress('正在生成纯文本规则');await yieldPage();check();
    const text=buildRulesText(state);check();
    return {filename:`江水课表-整学期规则-${semester.startDate}.txt`,mime:'text/plain',bytes:new TextEncoder().encode(text),pages:1};
  }
  if(kind==='semester-overview'){
    onProgress('正在汇总整个学期');await yieldPage();check();
    const model=buildSemesterOverviewModel(state);
    onProgress('正在排版整学期总览');await yieldPage();check();
    const page=renderSemesterOverviewPage(model);check();
    const blob=await canvasBlob(page);check();page.width=1;page.height=1;
    return {filename:`江水课表-整学期总览-${semester.startDate}.png`,mime:'image/png',bytes:new Uint8Array(await blob.arrayBuffer()),pages:1};
  }
  const start=kind==='week'?week:1,end=kind==='week'?week:semester.weeks;
  const images=[];let weeklyPng=null,weekPageCount=0;
  for(let current=start;current<=end;current++){
    check();
    onProgress(`正在排版第 ${current} 周（${current-start+1}/${end-start+1}）`);await yieldPage();check();
    const canvases=weekCanvasPages(exportWeekModel(state,current));check();weekPageCount=canvases.length;
    for(const canvas of canvases){
      check();
      if(kind==='week'&&canvases.length===1){weeklyPng=await canvasBlob(canvas);}
      else{const blob=await canvasBlob(canvas,'image/jpeg');images.push({width:canvas.width,height:canvas.height,bytes:new Uint8Array(await blob.arrayBuffer())});}
      canvas.width=1;canvas.height=1;await yieldPage();check();
    }
  }
  check();
  if(weeklyPng)return {filename:`江水课表-第${week}周-${addDays(semester.startDate,(week-1)*7)}.png`,mime:'image/png',bytes:new Uint8Array(await weeklyPng.arrayBuffer()),pages:1};
  if(kind==='semester')for(const canvas of renderUnscheduledPages(state)){
    check();
    const blob=await canvasBlob(canvas,'image/jpeg');images.push({width:canvas.width,height:canvas.height,bytes:new Uint8Array(await blob.arrayBuffer())});canvas.width=1;canvas.height=1;await yieldPage();
  }
  check();
  onProgress('正在合成横向 PDF');await yieldPage();check();
  return {filename:kind==='semester'?`江水课表-整个学期-${semester.startDate}.pdf`:`江水课表-第${week}周-完整课表.pdf`,mime:'application/pdf',bytes:imagePagesPdf(images),pages:kind==='week'?weekPageCount:images.length};
}
