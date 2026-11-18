import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveDay} from '../web/core.mjs';
import {normalizeHolidaySettings} from '../web/holiday-settings.mjs';
import {runNativeWidgetResolver} from './native-widget-resolver-harness.mjs';

// 验收对象（task-64 / 1.5.0 决策 D-3）：
// D3 排序 tie-break——App（web/core.mjs effectiveDay）与桌面小组件（ScheduleWidgetData.effectiveDay）
//    对「同起始时间」课程统一按 (startTime, key) 的 UTF-16 码元序排列；key 相同口径（date/ruleId[/map-id]），
//    因此两端顺序逐项一致且与设备 locale 无关（Java String.compareTo 与 JS 字符串 < 同为 UTF-16 码元序）。
// D4 晚自习 origin 周次——web/study.mjs STD-005 要求调休候选源日「星期∈周日/一~四 且 周次∈1..weeks」；
//    Java addEveningStudy 原缺周次校验，学期外 fromDate 会多生成一条 App 不显示的晚自习。本文件锁住两端一致。
// 方法：真实编译执行仓库里的 android/app/src/main/java/cn/local/tomorrow/ScheduleWidgetData.java
//    （Android/org.json 用 tests/fixtures/widget-resolver 最小 JVM 桩），同一 fixture 同时喂给 web，
//    **不排序、按原始顺序**逐项对照（D1 的 widget-remap.test.mjs 是排序后对照，不锁顺序）。
// 事实基准：work/docs/specification-2026-11-18/10-web-core-state.md CORE-019/CORE-029/STD-005、
//    13-android-platform.md AND-171/AND-168。
// 未覆盖（见 work/docs/phase-1.5.0/实现报告-A2-D3D4.md）：StateStore 读盘、RemoteViews 渲染、真机小
//    组件刷新；locale 相关的其余排序（课程名等）由 A3/task-65 统一。

const TERM={id:'term-order',startDate:'2026-08-31',weeks:18};
const MON='2026-10-12',FRI='2026-10-16',SUN='2026-10-18';
// rules 数组顺序故意与 key 字典序相反（z-1 在 a-1 前），以区分「注入顺序」与「(startTime,key) 排序」。
const RULES=[
  {id:'z-1',name:'课程Z',teacher:'甲',room:'A101',weekday:1,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'},
  {id:'a-1',name:'课程A',teacher:'乙',room:'A102',weekday:1,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'},
  {id:'early-1',name:'晨读',teacher:'丙',room:'A103',weekday:1,weeks:[7],periods:[1],startTime:'07:50',endTime:'08:20'}
];
const CUSTOM={id:'custom-1700000000000',mode:'once',name:'临时加课',teacher:'丁',room:'D404',startTime:'08:30',endTime:'09:55',date:MON};
const EXAM={id:'B001|期中|x|y|'+MON+'|08:30',name:'期中考试',teacher:'戊',room:'E101',date:MON,startTime:'08:30',endTime:'09:55',periods:[1,2],week:7,weekday:1};
const STUDY_POLICY={enabled:true,userEnabled:true,profile:{enrollmentYear:2026}};
const BEFORE='2026-08-23'; // 学期开始前一周的周日（weekOf = -1）
const AFTER='2027-01-10';  // 学期结束后一周的周日（weekOf = 20）
const INSIDE='2026-10-06'; // 学期第 6 周周二（晚自习允许的源日）
function holiday(){return {winter:null,summer:null,days:[],restoreDates:[]};}
function makeState({rules=RULES,remaps=[],localMaps=[],customCourses=[],exams=null,studyPolicy=null}={}){
  const snapshot={
    semester:{...TERM},
    source:{kind:'school'},
    rules:rules.map(rule=>({...rule})),
    closedDates:[],
    remaps:remaps.map(remap=>({...remap})),
    exceptions:[],
    studentProfile:{enrollmentYear:2026}
  };
  if(studyPolicy)snapshot.studyPolicy=studyPolicy;
  if(exams)snapshot.exams={semesterId:TERM.id,semesterStartDate:TERM.startDate,items:[{...exams}]};
  return {snapshot,overrides:[],localMaps:localMaps.map(item=>({...item})),courseSettings:{},customCourses:customCourses.map(item=>({...item})),holidaySettings:holiday()};
}
const withExams=exams=>makeState({exams});
const ORDER_SCENARIOS=[
  {id:'d3-two-rules-same-start',date:MON,state:makeState({rules:[RULES[0],RULES[1]]})},
  {id:'d3-start-primary',date:MON,state:makeState({rules:[RULES[0],RULES[2]]})},
  {id:'d3-school-vs-custom-same-start',date:MON,state:makeState({rules:[RULES[0]],customCourses:[CUSTOM]})},
  {id:'d3-school-vs-exam-same-start',date:MON,state:withExams(EXAM)},
  {id:'d3-multi-way-tie',date:MON,state:(()=>{const state=makeState({rules:[RULES[0],RULES[1]],customCourses:[CUSTOM]});state.snapshot.exams={semesterId:TERM.id,semesterStartDate:TERM.startDate,items:[{...EXAM}]};return state;})()}
];
const D4_SCENARIOS=[
  {id:'d4-origin-before-semester',date:FRI,state:makeState({studyPolicy:STUDY_POLICY,localMaps:[{id:'local-before',date:FRI,fromDate:BEFORE,mode:'replace'}]})},
  {id:'d4-origin-after-semester',date:FRI,state:makeState({studyPolicy:STUDY_POLICY,localMaps:[{id:'local-after',date:FRI,fromDate:AFTER,mode:'replace'}]})},
  {id:'d4-school-origin-out-of-semester',date:FRI,state:makeState({studyPolicy:STUDY_POLICY,remaps:[{id:'holiday-after',date:FRI,fromDate:AFTER,mode:'replace'}]})},
  {id:'d4-origin-inside-semester',date:FRI,state:makeState({studyPolicy:STUDY_POLICY,localMaps:[{id:'local-inside',date:FRI,fromDate:INSIDE,mode:'replace'}]})},
  {id:'d4-sunday-baseline',date:SUN,state:makeState({studyPolicy:STUDY_POLICY})}
];
const ALL=[...ORDER_SCENARIOS,...D4_SCENARIOS];
const native=runNativeWidgetResolver(ALL.map(({id,state,date})=>({id,state,date,epoch:Date.parse(date+'T10:30:00+08:00')})));
const nativeById=new Map(native.map(entry=>[entry.id,entry]));
function webRows(scenario){const state=scenario.state;return effectiveDay(state.snapshot,scenario.date,state.overrides,state.localMaps,state.courseSettings,state.customCourses,normalizeHolidaySettings(state.holidaySettings));}
function javaItems(scenario){const entry=nativeById.get(scenario.id);assert.ok(entry,'harness 缺少场景 '+scenario.id);return entry.items;}
function scenario(list,id){const found=list.find(item=>item.id===id);assert.ok(found,'缺少场景 '+id);return found;}
const projection=item=>({key:item.key,name:item.name,teacher:item.teacher,room:item.room,start:item.startTime??item.start,end:item.endTime??item.end,cancelled:item.cancelled===true,localActivity:item.localActivity===true,customCourse:item.customCourse===true,exam:item.exam===true});
const keysOf=items=>items.map(item=>item.key);
const webKeys=scenario=>webRows(scenario).map(row=>row.key);
const javaKeys=scenario=>javaItems(scenario).map(item=>item.key);

test('双 resolver 一致性（D3 排序）：同起始时间课程原始顺序 Java 与 web 逐项一致',()=>{
  assert.equal(native.length,ALL.length,'harness 场景数量必须与 fixture 一致');
  for(const item of ORDER_SCENARIOS){
    assert.deepEqual(javaItems(item).map(projection),webRows(item).map(projection),'场景 '+item.id+'：Java 与 web 顺序/内容不一致');
  }
});

test('D3 排序口径固定：startTime 优先，同起始时间按 key 的 UTF-16 码元序（App 与小组件同序）',()=>{
  const expected={
    // 两条同 08:30 学校课：key 码元序 a-1 < z-1（与注入顺序相反）
    'd3-two-rules-same-start':[MON+'/a-1',MON+'/z-1'],
    // startTime 仍是第一排序键：07:50 的早课排在同日 08:30 课程之前
    'd3-start-primary':[MON+'/early-1',MON+'/z-1'],
    // 同 08:30：custom-... < z-1（c<z），自定义课排在学校课前（修复前 Java 是学校课在前）
    'd3-school-vs-custom-same-start':[MON+'/custom-1700000000000',MON+'/z-1'],
    // 同 08:30：a-1 < exam-... < z-1（码元序），考试插在学校课之间（修复前 Java 是注入顺序：课全在考试前）
    'd3-school-vs-exam-same-start':[MON+'/early-1',MON+'/a-1',MON+'/exam-'+EXAM.id,MON+'/z-1'],
    // 四行同 08:30：a-1 < custom-... < exam-... < z-1
    'd3-multi-way-tie':[MON+'/a-1',MON+'/custom-1700000000000',MON+'/exam-'+EXAM.id,MON+'/z-1']
  };
  for(const [id,keys] of Object.entries(expected)){
    const item=scenario(ORDER_SCENARIOS,id);
    assert.deepEqual(javaKeys(item),keys,id+'：Java 顺序');
    assert.deepEqual(webKeys(item),keys,id+'：web 顺序');
  }
});

test('双 resolver 一致性（D4 晚自习 origin 周次）：学期外调休源日两端都不生成晚自习',()=>{
  for(const item of D4_SCENARIOS){
    assert.deepEqual(javaItems(item).map(projection),webRows(item).map(projection),'场景 '+item.id+'：Java 与 web 不一致');
  }
  for(const id of ['d4-origin-before-semester','d4-origin-after-semester','d4-school-origin-out-of-semester']){
    const item=scenario(D4_SCENARIOS,id);
    assert.deepEqual(javaKeys(item),[],id+'：Java 不应生成晚自习（修复前会多出一条）');
    assert.deepEqual(webKeys(item),[],id+'：web 不应生成晚自习');
  }
});

test('D4 晚自习 origin 周次：学期内源日照常生成、直接命中的周日不回归',()=>{
  const inside=scenario(D4_SCENARIOS,'d4-origin-inside-semester');
  assert.deepEqual(javaKeys(inside),[FRI+'/local-evening-study'],'Java 学期内源日应生成晚自习');
  assert.deepEqual(webKeys(inside),[FRI+'/local-evening-study'],'web 学期内源日应生成晚自习');
  const sunday=scenario(D4_SCENARIOS,'d4-sunday-baseline');
  assert.deepEqual(javaKeys(sunday),[SUN+'/local-evening-study'],'Java 周日直接命中应生成晚自习');
  assert.deepEqual(webKeys(sunday),[SUN+'/local-evening-study'],'web 周日直接命中应生成晚自习');
});
