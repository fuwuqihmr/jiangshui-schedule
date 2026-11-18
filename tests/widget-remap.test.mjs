import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveDay} from '../web/core.mjs';
import {normalizeHolidaySettings} from '../web/holiday-settings.mjs';
import {runNativeWidgetResolver} from './native-widget-resolver-harness.mjs';

// 验收对象：D1 口径 A —— 学校调课（snapshot.remaps）与本机调休（localMaps）统一按「搬走」语义：
// 调出日（fromDate===当日且目标日不同）不显示源课；目标日 replace 只留调入课，append 保留本课并追加源日课程。
// 方法：真实编译执行仓库里的 android/app/src/main/java/cn/local/tomorrow/ScheduleWidgetData.java
// （Android/org.json 用 tests/fixtures/widget-resolver 最小 JVM 桩，与被测源码一起 javac/java），
// 同一 fixture 同时喂给 Java 与 web/core.mjs effectiveDay，按 key 排序后逐项对照 10 个字段；
// Java 侧不改，本文件只证明两端一致 + 固定口径 A 的期望课表。
// 事实基准：work/docs/specification-2026-11-18/10-web-core-state.md CORE-022、13-android-platform.md AND-163。
// 未覆盖（见 work/docs/phase-1.5.0/实现报告-D1.md）：StateStore 真实读盘、RemoteViews 渲染、真机小组件刷新。

const TERM={id:'term-remap',startDate:'2026-08-31',weeks:18};
const RULES=[
  {id:'mon-1',name:'周一早课',teacher:'甲',room:'A101',weekday:1,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'},
  {id:'tue-1',name:'周二午课',teacher:'乙',room:'B202',weekday:2,weeks:[7],periods:[3,4],startTime:'10:05',endTime:'11:30'},
  {id:'wed-1',name:'周三下午课',teacher:'丙',room:'C303',weekday:3,weeks:[7],periods:[5,6],startTime:'14:00',endTime:'15:25'},
  {id:'thu-1',name:'周四晚课',teacher:'丁',room:'D404',weekday:4,weeks:[7],periods:[9,10],startTime:'19:00',endTime:'20:25'},
  {id:'fri-1',name:'周五早课',teacher:'戊',room:'E505',weekday:5,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'},
  {id:'sat-1',name:'周六上午课',teacher:'己',room:'F606',weekday:6,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'}
];
const MON='2026-10-12',TUE='2026-10-13',WED='2026-10-14',THU='2026-10-15',FRI='2026-10-16',SAT='2026-10-17',TUE2='2026-10-20';
const SCHOOL_REPLACE={id:'holiday-replace',date:FRI,fromDate:MON,mode:'replace'};
const SCHOOL_APPEND={id:'holiday-append',date:SAT,fromDate:TUE,mode:'append'};
const LOCAL_MAP={id:'local-1700000000000',date:THU,fromDate:WED,mode:'replace'};
const WEEKLY_CUSTOM={id:'custom-weekly-1',mode:'weekly',name:'规律补习',teacher:'孙',room:'E505',startTime:'16:00',endTime:'17:30',semesterId:TERM.id,semesterStartDate:TERM.startDate,startWeek:1,endWeek:18,weekPattern:'every',weekdays:[2]};
const ONCE_MON={id:'custom-once-mon',mode:'once',name:'独立加课',teacher:'赵',room:'G707',startTime:'16:00',endTime:'17:30',date:MON};
const OVERRIDE_MON={id:'ov-mon',key:MON+'/mon-1',date:MON,base:{...RULES[0],ruleId:'mon-1',key:MON+'/mon-1',date:MON},patch:{room:'X909'},createdAt:'2026-10-01T00:00:00+08:00'};

function holiday(){return {winter:null,summer:null,days:[],restoreDates:[]};}
function makeState({remaps=[],closedDates=[],exceptions=[],localMaps=[],overrides=[],customCourses=[],holidaySettings=holiday()}={}){
  const snapshot={
    semester:{...TERM},
    source:{kind:'school'},
    rules:RULES.map(rule=>({...rule})),
    closedDates:[...closedDates],
    remaps:remaps.map(remap=>({...remap})),
    exceptions:exceptions.map(exception=>({...exception})),
    studentProfile:{enrollmentYear:2026},
    studyPolicy:{enabled:true,userEnabled:true,profile:{enrollmentYear:2026}}
  };
  return {snapshot,overrides:overrides.map(item=>({...item})),localMaps:localMaps.map(item=>({...item})),courseSettings:{},customCourses:customCourses.map(item=>({...item})),holidaySettings};
}

const SCENARIOS=[
  {id:'school-replace-source',date:MON,state:makeState({remaps:[SCHOOL_REPLACE]})},
  {id:'school-replace-target',date:FRI,state:makeState({remaps:[SCHOOL_REPLACE]})},
  {id:'school-append-source',date:TUE,state:makeState({remaps:[SCHOOL_APPEND]})},
  {id:'school-append-target',date:SAT,state:makeState({remaps:[SCHOOL_APPEND]})},
  {id:'local-replace-source',date:WED,state:makeState({localMaps:[LOCAL_MAP]})},
  {id:'local-replace-target',date:THU,state:makeState({localMaps:[LOCAL_MAP]})},
  {id:'school-replace-source-override',date:MON,state:makeState({remaps:[SCHOOL_REPLACE],overrides:[OVERRIDE_MON]})},
  {id:'school-replace-target-exception',date:FRI,state:makeState({remaps:[SCHOOL_REPLACE],exceptions:[{date:FRI,ruleId:'mon-1',patch:{room:'P101'}}]})},
  {id:'school-movedout-weekly-custom',date:TUE,state:makeState({remaps:[SCHOOL_APPEND],customCourses:[WEEKLY_CUSTOM]})},
  {id:'school-movedout-once-custom',date:MON,state:makeState({remaps:[SCHOOL_REPLACE],customCourses:[ONCE_MON]})},
  {id:'school-replace-fromdate-closed',date:MON,state:makeState({remaps:[SCHOOL_REPLACE],closedDates:[MON]})},
  {id:'self-map-not-movedout',date:FRI,state:makeState({remaps:[{id:'self',date:FRI,fromDate:FRI,mode:'append'}]})},
  {id:'missing-date-map-fromdate',date:MON,state:makeState({remaps:[{id:'broken',fromDate:MON,mode:'append'}]})},
  {id:'two-remaps-share-fromdate',date:MON,state:makeState({remaps:[SCHOOL_REPLACE,SCHOOL_APPEND]})},
  {id:'chain-append-then-replace',date:FRI,state:makeState({remaps:[{id:'chain-a',date:FRI,fromDate:MON,mode:'append'},{id:'chain-b',date:TUE2,fromDate:FRI,mode:'replace'}]})},
  {id:'school-and-local-map-mix',date:WED,state:makeState({remaps:[SCHOOL_REPLACE],localMaps:[LOCAL_MAP]})},
  {id:'school-replace-and-restored-closed',date:MON,state:makeState({remaps:[SCHOOL_REPLACE],closedDates:[MON],holidaySettings:{...holiday(),restoreDates:[MON]}})}
];

const native=runNativeWidgetResolver(SCENARIOS.map(({id,state,date})=>({id,state,date,epoch:Date.parse(date+'T10:30:00+08:00')})));
const nativeById=new Map(native.map(item=>[item.id,item]));
const sorted=items=>[...items].sort((a,b)=>a.key.localeCompare(b.key));
const keysOf=items=>sorted(items).map(item=>item.key);
const projection=item=>({key:item.key,name:item.name,teacher:item.teacher,room:item.room,start:item.startTime,end:item.endTime,cancelled:item.cancelled===true,localActivity:item.localActivity===true,customCourse:item.customCourse===true,exam:item.exam===true});
function webRows(scenario){const state=scenario.state;return effectiveDay(state.snapshot,scenario.date,state.overrides,state.localMaps,state.courseSettings,state.customCourses,normalizeHolidaySettings(state.holidaySettings));}
function javaItems(scenario){const entry=nativeById.get(scenario.id);assert.ok(entry,'harness 缺少场景 '+scenario.id);return entry.items;}
function scenario(id){const found=SCENARIOS.find(item=>item.id===id);assert.ok(found,'缺少场景 '+id);return found;}

test('双 resolver 一致性（D1 调课）：同一 state/日期下原生 ScheduleWidgetData 与 web/core.mjs effectiveDay 一致',()=>{
  assert.equal(native.length,SCENARIOS.length,'场景数量必须与 harness 输出一致');
  for(const item of SCENARIOS){
    assert.deepEqual(sorted(javaItems(item)),sorted(webRows(item).map(projection)),'场景 '+item.id+'：Java 与 web 生效课表不一致');
  }
});

test('WIDGET 口径 A：学校调课调出日不显示源课（replace/append/链路/停课/损坏映射同语义）',()=>{
  const expected={
    'school-replace-source':[MON+'/local-evening-study'],
    'school-append-source':[TUE+'/local-evening-study'],
    'school-replace-source-override':[MON+'/local-evening-study'],
    'school-replace-fromdate-closed':[],
    'missing-date-map-fromdate':[MON+'/local-evening-study'],
    'two-remaps-share-fromdate':[MON+'/local-evening-study'],
    'chain-append-then-replace':[FRI+'/local-evening-study',FRI+'/mon-1/map-chain-a'],
    'school-replace-and-restored-closed':[MON+'/local-evening-study'],
    'school-movedout-weekly-custom':[TUE+'/custom-weekly-1',TUE+'/local-evening-study'],
    'school-movedout-once-custom':[MON+'/custom-once-mon',MON+'/local-evening-study'],
    'school-and-local-map-mix':[WED+'/local-evening-study']
  };
  for(const [id,keys] of Object.entries(expected)){
    assert.deepEqual(keysOf(javaItems(scenario(id))),keys,id+'：Java 调出日课表');
    assert.deepEqual(keysOf(webRows(scenario(id))),keys,id+'：web 调出日课表');
  }
  // 调出日源课在两端都消失，但晚自习/本机自定义课/已恢复停课日的语义保持不变。
  assert.equal(keysOf(javaItems(scenario('school-replace-source'))).includes(MON+'/mon-1'),false,'Java 调出日不得出现源课');
  assert.equal(keysOf(webRows(scenario('school-replace-source'))).includes(MON+'/mon-1'),false,'web 调出日不得出现源课');
  assert.deepEqual(keysOf(webRows(scenario('school-movedout-weekly-custom'))),[TUE+'/custom-weekly-1',TUE+'/local-evening-study'],'学校调课不搬走本机规律自定义课');
});

test('WIDGET 口径 A：学校调课目标日——replace 只留调入课，append 保留本课并追加',()=>{
  const expected={
    'school-replace-target':[FRI+'/local-evening-study',FRI+'/mon-1/map-holiday-replace'],
    'school-append-target':[SAT+'/local-evening-study',SAT+'/sat-1',SAT+'/tue-1/map-holiday-append'],
    'school-replace-target-exception':[FRI+'/local-evening-study',FRI+'/mon-1/map-holiday-replace']
  };
  for(const [id,keys] of Object.entries(expected)){
    assert.deepEqual(keysOf(javaItems(scenario(id))),keys,id+'：Java 目标日课表');
    assert.deepEqual(keysOf(webRows(scenario(id))),keys,id+'：web 目标日课表');
  }
  assert.equal(javaItems(scenario('school-replace-target')).some(item=>item.key===FRI+'/fri-1'),false,'replace 目标日清空本课');
  assert.equal(javaItems(scenario('school-append-target')).some(item=>item.key===SAT+'/sat-1'),true,'append 目标日保留本课');
  const javaException=javaItems(scenario('school-replace-target-exception')).find(item=>item.key===FRI+'/mon-1/map-holiday-replace');
  const webException=webRows(scenario('school-replace-target-exception')).find(item=>item.key===FRI+'/mon-1/map-holiday-replace');
  assert.equal(javaException.room,'P101','学校例外 patch 作用于调入行（Java）');
  assert.equal(webException.room,'P101','学校例外 patch 作用于调入行（web）');
});

test('WIDGET 本机调休不回归：调出日过滤、source 标记、自映射口径与 Java 一致',()=>{
  assert.deepEqual(keysOf(javaItems(scenario('local-replace-source'))),[WED+'/local-evening-study'],'Java 本机调休调出日');
  assert.deepEqual(keysOf(webRows(scenario('local-replace-source'))),[WED+'/local-evening-study'],'web 本机调休调出日');
  const localTargetKeys=[THU+'/local-evening-study',THU+'/wed-1/map-local-1700000000000'];
  assert.deepEqual(keysOf(javaItems(scenario('local-replace-target'))),localTargetKeys,'Java 本机调休目标日');
  assert.deepEqual(keysOf(webRows(scenario('local-replace-target'))),localTargetKeys,'web 本机调休目标日');
  // source 标记是 web 行独有字段（Java Item 无 source）：本机调入行=local，学校调入行=学校来源，不得混淆。
  const localMapped=webRows(scenario('local-replace-target')).find(row=>row.remapId);
  assert.equal(localMapped.source,'local','本机调休调入行 source=local');
  const schoolMapped=webRows(scenario('school-replace-target')).find(row=>row.remapId);
  assert.equal(schoolMapped.source,'school','学校调课调入行 source 保持学校');
  // 自映射（date===fromDate）不判为调出：两端都在目标日保留本课 + 追加一条同源映射行（Java 既有口径）。
  const selfKeys=[FRI+'/fri-1',FRI+'/fri-1/map-self'];
  assert.deepEqual(keysOf(javaItems(scenario('self-map-not-movedout'))),selfKeys,'Java 自映射不判调出');
  assert.deepEqual(keysOf(webRows(scenario('self-map-not-movedout'))),selfKeys,'web 自映射不判调出');
});
