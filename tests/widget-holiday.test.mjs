import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveDay} from '../web/core.mjs';
import {normalizeHolidaySettings} from '../web/holiday-settings.mjs';
import {runNativeWidgetResolver} from './native-widget-resolver-harness.mjs';

// 验收对象：Android 桌面小组件 resolver ScheduleWidgetData.effectiveDay/read 与 web/core.mjs
// effectiveDay 在 A2 假日口径上的双 resolver 一致性（真实编译执行 Java，见 harness 注释）。
// 事实基准：work/docs/specification-2026-11-18/10-web-core-state.md CORE-021/025/026/043/044、
// STD-004/008、HOL-001/002/008..010，以及 13-android-platform.md 的 WIDGET/RESOLVER 规则。

const DAY='2026-10-13'; // 周二，学期第 7 周
const DAY14='2026-10-14'; // 周三，同一寒假区间内
const EPOCH=Date.parse(DAY+'T10:30:00+08:00');
const EPOCH14=Date.parse(DAY14+'T10:30:00+08:00');

const BASE_RULES=[
  {id:'tue-morning',name:'周二早课',teacher:'张老师',room:'A101',weekday:2,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'},
  {id:'tue-noon',name:'周二午课',teacher:'李老师',room:'B202',weekday:2,weeks:[7],periods:[3,4],startTime:'10:05',endTime:'11:30'}
];
const MORNING_RULE=BASE_RULES[0];
const EXAM={id:'exam-1',name:'高数考试',teacher:'王老师',room:'C301',date:DAY,startTime:'08:30',endTime:'10:00',week:7,weekday:2,periods:[1,2,3]};
const PRE_SEMESTER_DAY='2026-08-26'; // 学期开始（2026-08-31）前 5 天的周三：第 1 周课程不得出现
const WED_WEEK1_RULE={id:'wed-week1',name:'第1周周三课',teacher:'周老师',room:'F606',weekday:3,weeks:[1],periods:[1,2],startTime:'08:30',endTime:'09:55'};
const ONCE_CUSTOM={id:'custom-once-20261013',mode:'once',name:'独立加课',teacher:'赵老师',room:'D404',startTime:'16:00',endTime:'17:30',date:DAY};
const WEEKLY_CUSTOM={id:'custom-weekly-1',mode:'weekly',name:'规律补习',teacher:'孙老师',room:'E505',startTime:'16:00',endTime:'17:30',semesterId:'term-widget',semesterStartDate:'2026-08-31',startWeek:1,endWeek:25,weekPattern:'every',weekdays:[2]};
const OVERRIDE_MORNING={id:'ov-1',key:DAY+'/tue-morning',date:DAY,base:{...MORNING_RULE,ruleId:MORNING_RULE.id,key:DAY+'/tue-morning',date:DAY},patch:{room:'E505'},createdAt:'2026-10-01T00:00:00+08:00'};

const holiday=(extra={})=>({winter:null,summer:null,days:[],restoreDates:[],...extra});
const WINTER={startDate:'2026-10-12',endDate:'2026-10-16'};
function settings({holidaySettings,closedDates=[],exams=[EXAM],overrides=[],localMaps=[],courseSettings={},customCourses=[],extraRules=[]}={}){
  const snapshot={
    semester:{id:'term-widget',startDate:'2026-08-31',weeks:25},
    source:{kind:'school'},
    rules:[...BASE_RULES.map(rule=>({...rule})),...extraRules.map(rule=>({...rule}))],
    closedDates:[...closedDates],remaps:[],exceptions:[],
    studentProfile:{enrollmentYear:2026},
    studyPolicy:{enabled:true,userEnabled:true,profile:{enrollmentYear:2026}}
  };
  if(exams.length)snapshot.exams={semesterId:'term-widget',semesterStartDate:'2026-08-31',items:exams.map(item=>({...item}))};
  const state={snapshot,overrides,localMaps,courseSettings,customCourses};
  if(holidaySettings!==undefined)state.holidaySettings=holidaySettings;
  return state;
}

const SCENARIOS=[
  {id:'baseline',date:DAY,epoch:EPOCH,state:settings({holidaySettings:holiday()})},
  {id:'winter-cancelled',date:DAY,epoch:EPOCH,state:settings({holidaySettings:holiday({winter:WINTER})})},
  {id:'summer-cancelled',date:DAY,epoch:EPOCH,state:settings({holidaySettings:holiday({summer:{startDate:'2026-10-01',endDate:'2026-10-31'}})})},
  {id:'day-cancelled',date:DAY,epoch:EPOCH,state:settings({holidaySettings:holiday({days:[{date:DAY,skipStudy:false}]})})},
  {id:'closed-cancelled',date:DAY,epoch:EPOCH,state:settings({closedDates:[DAY],holidaySettings:holiday()})},
  {id:'winter-restored',date:DAY,epoch:EPOCH,state:settings({holidaySettings:holiday({winter:WINTER,restoreDates:[DAY]})})},
  {id:'closed-restored',date:DAY,epoch:EPOCH,state:settings({closedDates:[DAY],holidaySettings:holiday({restoreDates:[DAY]})})},
  {id:'day-restored-skip-study',date:DAY,epoch:EPOCH,state:settings({holidaySettings:holiday({days:[{date:DAY,skipStudy:true}],restoreDates:[DAY]})})},
  {id:'restore-neighbour-only',date:DAY,epoch:EPOCH,state:settings({holidaySettings:holiday({winter:WINTER,restoreDates:[DAY14]})})},
  {id:'restore-neighbour-restored',date:DAY14,epoch:EPOCH14,state:settings({holidaySettings:holiday({winter:WINTER,restoreDates:[DAY14]})})},
  {id:'winter-cancelled-once-custom',date:DAY,epoch:EPOCH,state:settings({holidaySettings:holiday({winter:WINTER}),customCourses:[ONCE_CUSTOM]})},
  {id:'closed-cancelled-once-custom',date:DAY,epoch:EPOCH,state:settings({closedDates:[DAY],holidaySettings:holiday(),customCourses:[ONCE_CUSTOM]})},
  {id:'closed-restored-weekly-custom',date:DAY,epoch:EPOCH,state:settings({closedDates:[DAY],holidaySettings:holiday({restoreDates:[DAY]}),customCourses:[WEEKLY_CUSTOM]})},
  {id:'closed-cancelled-weekly-custom',date:DAY,epoch:EPOCH,state:settings({closedDates:[DAY],holidaySettings:holiday(),customCourses:[WEEKLY_CUSTOM]})},
  {id:'legacy-no-holiday-field',date:DAY,epoch:EPOCH,state:settings()},
  {id:'restore-dates-not-array',date:DAY,epoch:EPOCH,state:settings({holidaySettings:holiday({winter:WINTER,restoreDates:'2026-10-13'})})},
  {id:'restore-dates-invalid-entries',date:DAY,epoch:EPOCH,state:settings({holidaySettings:holiday({winter:WINTER,restoreDates:['2026-02-30','bad',42,null,DAY,DAY]})})},
  {id:'override-on-restored-holiday',date:DAY,epoch:EPOCH,state:settings({holidaySettings:holiday({winter:WINTER,restoreDates:[DAY]}),overrides:[OVERRIDE_MORNING]})},
  {id:'override-on-cancelled-holiday',date:DAY,epoch:EPOCH,state:settings({holidaySettings:holiday({winter:WINTER}),overrides:[OVERRIDE_MORNING]})},
  {id:'baseline-exam-yield',date:DAY,epoch:EPOCH,state:settings({holidaySettings:holiday(),exams:[{...EXAM,startTime:'19:00',endTime:'20:40'}]})},
  {id:'restored-before-semester',date:PRE_SEMESTER_DAY,epoch:Date.parse(PRE_SEMESTER_DAY+'T10:30:00+08:00'),state:settings({holidaySettings:holiday({summer:{startDate:'2026-08-20',endDate:'2026-08-28'},restoreDates:[PRE_SEMESTER_DAY]}),exams:[],extraRules:[WED_WEEK1_RULE]})}
];

const native=runNativeWidgetResolver(SCENARIOS.map(({id,state,date,epoch})=>({id,state,date,epoch})));
const nativeById=new Map(native.map(item=>[item.id,item]));

function keysOf(items){return items.map(item=>item.key).sort();}
function sorted(items){return [...items].sort((a,b)=>a.key.localeCompare(b.key));}
function webProjection(scenario){
  const state=scenario.state;
  return effectiveDay(state.snapshot,scenario.date,state.overrides,state.localMaps,state.courseSettings,state.customCourses,normalizeHolidaySettings(state.holidaySettings))
    .map(item=>({key:item.key,name:item.name,teacher:item.teacher,room:item.room,start:item.startTime,end:item.endTime,cancelled:item.cancelled===true,localActivity:item.localActivity===true,customCourse:item.customCourse===true,exam:item.exam===true}));
}
function javaItems(scenario){
  const entry=nativeById.get(scenario.id);
  assert.ok(entry,'harness 缺少场景 '+scenario.id);
  return entry.items;
}
function readOf(scenario){
  const entry=nativeById.get(scenario.id);
  assert.ok(entry,'harness 缺少场景 '+scenario.id);
  return entry.read;
}

test('双 resolver 一致性：同一 state/日期下原生 ScheduleWidgetData 与 web/core.mjs effectiveDay 结果一致',()=>{
  assert.equal(native.length,SCENARIOS.length,'场景数量必须与 harness 输出一致');
  for(const scenario of SCENARIOS){
    assert.deepEqual(sorted(javaItems(scenario)),sorted(webProjection(scenario)),'场景 '+scenario.id+'：Java 与 web 生效课表不一致');
  }
});

test('WIDGET 假日口径：法定假日/寒暑假/停课日默认取消全部课程（含晚自习），restoreDates 只恢复指定单日',()=>{
  // 三类假日默认取消：学校课、自定义课、晚自习全部消失；考试按固定日期保留（CORE-021/026/043）。
  for(const id of ['winter-cancelled','summer-cancelled','day-cancelled','closed-cancelled']){
    const scenario=SCENARIOS.find(item=>item.id===id);
    assert.deepEqual(keysOf(javaItems(scenario)),[DAY+'/exam-exam-1'],id+'：取消日只应剩考试');
  }
  // 单日恢复：休假与学校停课日都按正常规则重算（学校课 + 考试 + 晚自习回来）。
  const normalKeys=[DAY+'/exam-exam-1',DAY+'/local-evening-study',DAY+'/tue-morning',DAY+'/tue-noon'];
  for(const id of ['winter-restored','closed-restored']){
    const scenario=SCENARIOS.find(item=>item.id===id);
    assert.deepEqual(keysOf(javaItems(scenario)),normalKeys,id+'：恢复日应按正常规则排课');
  }
  // 恢复日的旧字段 skipStudy 仍压制晚自习（STD-008），但学校课与考试不受影响。
  assert.deepEqual(keysOf(javaItems(SCENARIOS.find(item=>item.id==='day-restored-skip-study'))),
    [DAY+'/exam-exam-1',DAY+'/tue-morning',DAY+'/tue-noon'],'恢复日 skipStudy=true 不应生成晚自习');
  // 恢复只影响标记的那一天：区间内未标记的相邻日期仍取消（CORE-043/STD-004）。
  assert.deepEqual(keysOf(javaItems(SCENARIOS.find(item=>item.id==='restore-neighbour-only'))),
    [DAY+'/exam-exam-1'],'未恢复的休假日期仍应取消');
  assert.deepEqual(keysOf(javaItems(SCENARIOS.find(item=>item.id==='restore-neighbour-restored'))),
    [DAY14+'/local-evening-study'],'恢复日之外的日期（同日无学校课）仍按正常规则只显示晚自习');
  // 停课日旧语义保留（UNRESOLVED-04，与 web 一致）：未恢复的停课日仍接受 once 自定义课与调休注入；
  // 规律自定义课被停课清空，恢复后回来。
  assert.deepEqual(keysOf(javaItems(SCENARIOS.find(item=>item.id==='closed-cancelled-once-custom'))),
    [DAY+'/custom-once-20261013',DAY+'/exam-exam-1'],'停课日的独立加课按 web 旧语义仍显示');
  assert.deepEqual(keysOf(javaItems(SCENARIOS.find(item=>item.id==='closed-cancelled-weekly-custom'))),
    [DAY+'/exam-exam-1'],'停课日规律自定义课应被清空');
  assert.deepEqual(keysOf(javaItems(SCENARIOS.find(item=>item.id==='closed-restored-weekly-custom'))),
    [DAY+'/custom-weekly-1',DAY+'/exam-exam-1',DAY+'/local-evening-study',DAY+'/tue-morning',DAY+'/tue-noon'],'恢复停课日后规律自定义课与晚自习应回来');
  // 取消的休假日连 once 自定义课也不显示（与 web holidayCancelled 分支一致）。
  assert.deepEqual(keysOf(javaItems(SCENARIOS.find(item=>item.id==='winter-cancelled-once-custom'))),
    [DAY+'/exam-exam-1'],'休假取消日不应显示 once 自定义课');
  // 考试与晚自习重叠时晚自习让位（AND-169），考试保持固定日期（CORE-026）。
  const yieldScenario=SCENARIOS.find(item=>item.id==='baseline-exam-yield');
  assert.deepEqual(keysOf(javaItems(yieldScenario)),
    [DAY+'/exam-exam-1',DAY+'/tue-morning',DAY+'/tue-noon'],'考试与晚自习重叠时晚自习应让位');
  assert.deepEqual(javaItems(yieldScenario).filter(item=>item.exam).map(item=>[item.start,item.end]),[['19:00','20:40']],'考试起止不得被休假/调休移动');
});

test('WIDGET restoreDates 兼容：旧 state、非数组、非法/重复项与惰性标记按 web 语义忽略或无副作用',()=>{
  // 旧 state 没有 holidaySettings：等同未配置休假，正常排课。
  assert.deepEqual(keysOf(javaItems(SCENARIOS.find(item=>item.id==='legacy-no-holiday-field'))),
    [DAY+'/exam-exam-1',DAY+'/local-evening-study',DAY+'/tue-morning',DAY+'/tue-noon'],'旧 state 无 holidaySettings 不应误取消');
  // restoreDates 不是数组：按无恢复处理，当天仍取消。
  assert.deepEqual(keysOf(javaItems(SCENARIOS.find(item=>item.id==='restore-dates-not-array'))),
    [DAY+'/exam-exam-1'],'restoreDates 非数组必须按无恢复处理');
  // 非法日期/非字符串/重复项被忽略，合法项照常恢复（HOL-008）。
  assert.deepEqual(keysOf(javaItems(SCENARIOS.find(item=>item.id==='restore-dates-invalid-entries'))),
    [DAY+'/exam-exam-1',DAY+'/local-evening-study',DAY+'/tue-morning',DAY+'/tue-noon'],'合法恢复项应生效且损坏项不导致崩溃');
  // 学期开始前被恢复的日期仍按正常周次判定：不得凭空出现第 1 周课程（与 web weekOf/floorDiv 一致）。
  assert.deepEqual(keysOf(javaItems(SCENARIOS.find(item=>item.id==='restored-before-semester'))),[],
    '学期开始前的恢复日不得显示第 1 周课程');
  // 恢复标记对未取消日期无副作用（HOL-010 惰性语义）。
  assert.deepEqual(keysOf(javaItems(SCENARIOS.find(item=>item.id==='baseline'))),
    [DAY+'/exam-exam-1',DAY+'/local-evening-study',DAY+'/tue-morning',DAY+'/tue-noon'],'无休假时课表应与恢复标记无关');
  // 单日修改：恢复日按正常日应用旧修改；取消日抑制旧修改（CORE-025）。
  const restored=javaItems(SCENARIOS.find(item=>item.id==='override-on-restored-holiday')).find(item=>item.key===DAY+'/tue-morning');
  assert.ok(restored,'恢复日应保留被单日修改的学校课');
  assert.equal(restored.room,'E505','恢复日必须应用旧单日修改');
  assert.deepEqual(keysOf(javaItems(SCENARIOS.find(item=>item.id==='override-on-cancelled-holiday'))),
    [DAY+'/exam-exam-1'],'取消日旧单日修改不得复活课程');
});

test('WIDGET read()：小组件课程数/状态跟随假日取消与单日恢复',()=>{
  const cancelled=readOf(SCENARIOS.find(item=>item.id==='winter-cancelled'));
  assert.equal(cancelled.hasState,true,'有 state 时小组件不得显示无状态');
  assert.equal(cancelled.courseCount,1,'取消日只保留考试行（read 过滤 cancelled 行）');
  assert.equal(cancelled.status,'今日已无课','取消日 10:30 的状态应为今日已无课');
  for(const id of ['winter-restored','closed-restored']){
    const read=readOf(SCENARIOS.find(item=>item.id===id));
    assert.equal(read.courseCount,4,id+'：恢复日应显示 4 行（两门学校课+考试+晚自习）');
    assert.equal(read.status,'课程进行中',id+'：10:30 应处于周二午课进行中');
  }
  const skipStudy=readOf(SCENARIOS.find(item=>item.id==='day-restored-skip-study'));
  assert.equal(skipStudy.courseCount,3,'恢复日 skipStudy=true 时晚自习不显示');
  const legacy=readOf(SCENARIOS.find(item=>item.id==='legacy-no-holiday-field'));
  assert.equal(legacy.courseCount,4,'旧 state 未配置休假时显示正常课表');
  assert.equal(legacy.status,'课程进行中','旧 state 正常日状态不因恢复逻辑改变');
});