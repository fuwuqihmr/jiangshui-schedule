import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clone,createState,applySnapshot,adoptSchoolSnapshot,effectiveDay,timetableDay,compareCourses} from '../web/core.mjs';
import {attachLabPayload,labSummary} from '../web/jiaowu-lab.mjs';
import {safeDiagnosticLines} from '../web/diagnostics.mjs';
import {scheduleDiagnosticLines} from '../web/schedule-diagnostics.mjs';
import {PERIOD_TIMES} from '../web/jsxsd.mjs';

const SEMESTER={id:'school-2026-08-31',name:'合成学期',startDate:'2026-08-31',weeks:25};
const DATE='2026-09-14';
const RAW_LAB={week:3,weekday:1,name:'课程A',courseCode:'K1',className:'合成01班',room:'X101',sectionCode:'10102'};

function base(extra={}){
  return {schemaVersion:1,semester:{...SEMESTER},source:{kind:'school',label:'合成学校'},rules:[],closedDates:[],remaps:[],exceptions:[],...extra};
}
function withLabs(raws=[RAW_LAB]){
  return attachLabPayload(base(),{labs:raws},undefined,{periodTimes:PERIOD_TIMES,now:'2026-11-17T00:00:00.000Z'});
}

test('实验课挂载：labs 全量替换、失败保留同学期旧数据、无字段不触碰快照',()=>{
  const attached=withLabs();
  assert.equal(attached.labs.items.length,1,'合成实验课入库');
  assert.equal(attached.labs.items[0].lab,true,'条目带 lab 标记');
  assert.equal(attached.labs.items[0].id,'K1|3|1|10102','按契约生成稳定 id');
  assert.equal(attached.labs.items[0].week,3);
  assert.equal(attached.labs.items[0].weekday,1);
  assert.equal(attached.labs.items[0].className,'合成01班');
  assert.equal(labSummary(attached.labs).count,1,'设置页统计读取条数');
  assert.equal(base().labs,undefined,'不修改入参快照');
  const kept=attachLabPayload(base({labs:attached.labs}),{labError:'http'},attached.labs,{now:'2026-11-18T00:00:00.000Z'});
  assert.equal(kept.labs.items.length,1,'失败保留旧实验课');
  assert.equal(kept.labs.error,'http');
  const untouched=attachLabPayload(base(),{},undefined,{});
  assert.equal(untouched.labs,undefined,'旧版回传无 labs/labHtml/labError 时不动快照');
});

test('快照应用/采用：同学期缺 labs 保留旧值，换学期丢弃，不覆盖考试字段',()=>{
  const seeded=withLabs();
  seeded.exams={semesterId:SEMESTER.id,semesterStartDate:SEMESTER.startDate,fetchedAt:'2026-11-17T00:00:00.000Z',error:null,items:[],skipped:[]};
  const state=createState(seeded);
  const applied=applySnapshot(state,base(),'2026-11-17T01:00:00.000Z');
  assert.equal(applied.snapshot.labs.items.length,1,'刷新快照未带 labs 时保留同学期实验课');
  assert.equal(applied.snapshot.exams.items.length,0,'考试字段不受影响');
  const adopted=adoptSchoolSnapshot(state,base(),'2026-11-17T01:00:00.000Z');
  assert.equal(adopted.snapshot.labs.items.length,1,'采用学校课表同样保留实验课');
  const other=base({semester:{id:'school-2027-02-22',name:'新学期',startDate:'2027-02-22',weeks:18}});
  const switched=adoptSchoolSnapshot(state,other,'2026-11-17T01:00:00.000Z');
  assert.equal(switched.snapshot.labs,undefined,'跨学期不携带旧实验课');
});

test('变更事件：实验课改地点经 applySnapshot 进入现有事件链路',()=>{
  const before=withLabs();
  const after=withLabs([{...RAW_LAB,room:'X202'}]);
  const next=applySnapshot(createState(before),after,'2026-09-01T00:00:00.000Z');
  const event=next.events.find(item=>item.lab===true);
  assert(event,'生成实验课变更事件');
  assert.equal(event.type,'改地点');
  assert.equal(event.key,DATE+'/lab-K1|3|1|10102');
  assert.equal(event.date,DATE);
});

test('日视图：实验课注入、同时间考试优先、晚自习让位、停课取消、调休不移动',()=>{
  const labs=withLabs();
  const day=effectiveDay(labs,DATE);
  assert.equal(day.length,1,'实验课进入 effectiveDay');
  assert.equal(day[0].lab,true);
  assert.equal(day[0].key,DATE+'/lab-K1|3|1|10102');
  assert.equal(day[0].periods.join(','),'1,2');

  const start=PERIOD_TIMES[1][0],end=PERIOD_TIMES[2][1];
  const withExam={...labs,exams:{semesterId:SEMESTER.id,semesterStartDate:SEMESTER.startDate,fetchedAt:'2026-11-17T00:00:00.000Z',error:null,skipped:[],items:[{id:'E1',date:DATE,week:3,weekday:1,name:'课程B',teacher:'教师甲',room:'考场A',seat:'1',periods:[1,2],startTime:start,endTime:end}]}};
  const ordered=effectiveDay(withExam,DATE);
  assert.equal(ordered[0].exam,true,'同一开始时间考试优先');
  assert.equal(ordered[1].lab,true,'实验课排在普通课之前');
  assert.equal(ordered.find(item=>item.exam===true).overlap,true,'冲突双卡都显示');
  assert.equal(ordered.find(item=>item.lab===true).overlap,true);

  const evening=withLabs([{...RAW_LAB,sectionCode:'10910'}]);
  evening.studentProfile={enrollmentYear:2026};
  evening.studyPolicy={enabled:true,userEnabled:true,profile:{enrollmentYear:2026},holidayDates:[],verifiedYears:[2026],sourceLabel:'本人设置 · 大一晚自习规则'};
  const eveningDay=effectiveDay(evening,DATE);
  assert(eveningDay.some(item=>item.lab===true),'晚间实验课显示');
  assert(!eveningDay.some(item=>item.localActivity),'实验课让晚自习让位');

  const holiday={winter:null,summer:null,days:[{date:DATE,skipStudy:false}]};
  const cancelled=effectiveDay(labs,DATE,[],[],{},[],holiday).find(item=>item.lab===true);
  assert(cancelled&&cancelled.cancelled===true,'节假日取消实验课');
  const closed=effectiveDay({...labs,closedDates:[DATE]},DATE).find(item=>item.lab===true);
  assert(closed&&closed.cancelled===true,'学校停课日取消实验课');
  const restored=effectiveDay({...labs,closedDates:[DATE]},DATE,[],[],{},[],{winter:null,summer:null,days:[],restoreDates:[DATE]}).find(item=>item.lab===true);
  assert(restored&&restored.cancelled===false,'单日恢复后实验课恢复');

  const remapped={...labs,remaps:[{id:'rm-lab',date:'2026-09-15',fromDate:DATE,mode:'replace'}]};
  assert(effectiveDay(remapped,DATE).some(item=>item.lab===true),'学校调休不搬走实验课');
  const localMapped={...labs};
  assert(effectiveDay(localMapped,DATE,[],[{id:'lm-lab',date:'2026-09-15',fromDate:DATE}]).some(item=>item.lab===true),'本机调休不搬走实验课');

  const custom={id:'custom-lab-order',mode:'weekly',name:'课程C',room:'Y201',teacher:'教师甲',startTime:start,endTime:end,semesterId:SEMESTER.id,semesterStartDate:SEMESTER.startDate,startWeek:1,endWeek:25,weekPattern:'every',weekdays:[1]};
  const movedLabs=withLabs([{...RAW_LAB,sectionCode:'10102'}]);
  const localMaps=[{id:'lm-in',date:DATE,fromDate:'2026-09-07'},{id:'lm-out',date:'2026-09-16',fromDate:DATE}];
  const movedEffective=effectiveDay(movedLabs,DATE,[],localMaps,{},[custom]);
  const effectiveLabIndex=movedEffective.findIndex(item=>item.lab===true);
  const effectiveCustomIndex=movedEffective.findIndex(item=>item.customCourseId==='custom-lab-order');
  assert(effectiveLabIndex>=0&&effectiveCustomIndex>=0,'调休日实验课与迁入自定义课并存');
  assert(effectiveLabIndex<effectiveCustomIndex,'effectiveDay 调休日实验课优先');
  const movedTimetable=timetableDay(movedLabs,DATE,[],localMaps,{},[custom]);
  const timetableLabIndex=movedTimetable.findIndex(item=>item.lab===true);
  const timetableCustomIndex=movedTimetable.findIndex(item=>item.customCourseId==='custom-lab-order');
  assert(timetableLabIndex>=0&&timetableCustomIndex>=0,'timetableDay 保留实验课与迁入自定义课');
  assert(timetableLabIndex<timetableCustomIndex,'timetableDay 调休日与 effectiveDay 同序');
});

test('排序契约：实验课参与时间起始冲突时考试 0 / 实验 1 / 普通 2 / 本机 3，其余保持 D3 key 序',()=>{
  const at=(extra)=>({startTime:'08:00',endTime:'09:00',key:'k',...extra});
  const exam=at({exam:true,key:'e'}),lab=at({lab:true,key:'l'}),normal=at({key:'z'}),local=at({localActivity:true,key:'a'});
  assert(compareCourses(exam,lab)<0,'实验课参与时考试先于实验');
  assert(compareCourses(lab,normal)<0,'实验先于普通课');
  assert(compareCourses(lab,local)<0,'实验先于本机活动');
  assert(compareCourses(at({startTime:'07:00',localActivity:true,key:'early'}),exam)<0,'开始时间仍是第一排序键');
  assert(compareCourses(normal,local)>0,'无实验课时仍按既有 D3 key 序（Java 小组件同序）');
});

test('诊断：web-read-lab 只保留字节数与错误类别，快照行含实验课计数且来源为 lab',()=>{
  const kept=safeDiagnosticLines(['11-26 00:00:00 web-read-lab bytes=1234 error=none','11-26 00:00:01 web-read-lab bytes=12 error=http','11-26 00:00:02 web-read-lab bytes=12 error=bogus']);
  assert.equal(kept.length,2,'合法 web-read-lab 行保留，非法错误类别丢弃');
  assert(kept[0].includes('bytes=1234 error=none'));
  const state=createState(withLabs());
  const lines=scheduleDiagnosticLines(state,DATE);
  assert(lines.some(line=>line.includes('实验数=1')),'快照行含实验课计数');
  assert(lines.some(line=>line.includes('来源=lab')),'课程位置行来源标为 lab');
  assert(lines.some(line=>line.includes('学校快照内=yes')),'实验课按 labs 快照判定来源');

  const skippedState=createState(withLabs());
  skippedState.snapshot.labs={...skippedState.snapshot.labs,lastSkipped:[{reason:'section'},{reason:'week'},{reason:'name'}]};
  const skipLines=scheduleDiagnosticLines(skippedState,DATE);
  assert(skipLines.some(line=>line.includes('实验跳过分类=week=1/name=1/section=1')),'实验跳过分类保留 section');
  assert(!skipLines.some(line=>line.includes('实验跳过分类=other')),'section 不归入 other');

  assert(!lines.some(line=>line.includes('课程A')||line.includes('X101')),'诊断不导出课程名/地点');
});

test('渲染与诊断接线：lab 分支不注入内联配色，面板/详情/诊断含实验课信息',()=>{
  const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
  const cardStart=app.indexOf('function courseCard(');
  const cardEnd=app.indexOf('\nfunction ',cardStart+1);
  assert(cardStart>=0&&cardEnd>cardStart,'可截取 courseCard');
  const card=app.slice(cardStart,cardEnd);
  const labBranch=card.slice(card.indexOf('if(r.lab===true)'),card.indexOf('const e=unreadFor'));
  assert(labBranch.includes('lab-card'),'实验卡使用 lab-card');
  assert(labBranch.includes("badge('实验','lab')"),'实验角标');
  assert(!labBranch.includes('courseColor'),'实验卡不注入课程自动配色');
  assert(labBranch.includes('r.startTime')&&labBranch.includes('r.endTime'),'显示实际起止时间');

  const detailStart=app.indexOf('function detail(');
  const detailEnd=app.indexOf('\nfunction ',detailStart+1);
  const detailBlock=app.slice(detailStart,detailEnd);
  assert(detailBlock.includes('lab-hero'),'实验详情使用 lab-hero');
  assert(detailBlock.includes('课程编号'),'详情含课程编号');
  assert(detailBlock.includes('实验课'),'详情标明来源实验课');
  assert(detailBlock.includes('班级信息默认不展示'),'班级敏感字段默认不展示');
  assert(app.includes('attachLabPayload'),'读取链路挂载 labs');
  assert(app.includes('labSummary'),'读取反馈/设置页使用实验课摘要');
  assert(app.includes('实验课安排'),'设置页有实验课统计行');

  const diagnostics=readFileSync(new URL('../web/diagnostics.mjs',import.meta.url),'utf8');
  assert(diagnostics.includes('/^web-read-lab bytes='),'诊断白名单接收 web-read-lab');
  const schedule=readFileSync(new URL('../web/schedule-diagnostics.mjs',import.meta.url),'utf8');
  assert(schedule.includes('实验数='),'课表诊断含实验课计数');
  assert(schedule.includes("r.lab===true?'lab'"),'课表诊断来源类别含 lab');
  assert(schedule.includes('labIds.has(r.labId)'),'实验课按 labs 快照判断是否在学校数据内');
});
