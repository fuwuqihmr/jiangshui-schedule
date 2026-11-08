import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,addDays} from '../web/core.mjs';
import {buildCalendarEvents,normalizeCalendarOptions,CALENDAR_EVENT_LIMIT,DEFAULT_CALENDAR_OPTIONS} from '../web/calendar-events.mjs';

const START='2026-08-31',WEEKS=2;
const rule=(id,extra={})=>({id,name:'课程'+id,teacher:'老师'+id,room:'A101',weekday:1,weeks:[1,2],periods:[1,2],startTime:'08:30',endTime:'09:55',...extra});
const snapshot=(rules=[],extra={})=>({schemaVersion:1,semester:{id:'term-a',name:'测试学期',startDate:START,weeks:WEEKS},rules,exceptions:[],remaps:[],closedDates:[],unscheduled:[],...extra});
const state=(rules=[],extra={})=>{const s=createState(snapshot(rules));return {...s,...extra};};
const day=addDays(START,0);

test('学校课程逐日展开：字段、时区与描述正确',()=>{
 const s=state([rule('math',{name:'高等数学',teacher:'李老师',room:'B204',weeks:[1,2]})]);
 const out=buildCalendarEvents(s);
 assert.equal(out.error,null);
 assert.equal(out.events.length,2,'两周的周一各一条');
 const first=out.events[0];
 assert.equal(first.key,`${day}/math`);
 assert.equal(first.title,'高等数学');
 assert.equal(first.location,'B204');
 assert.equal(first.startDate,day);
 assert.equal(first.startTime,'08:30');
 assert.equal(first.endTime,'09:55');
 assert.equal(first.source,'school');
 assert.equal(first.startMillis,Date.parse(`${day}T08:30:00+08:00`));
 assert.equal(first.endMillis,Date.parse(`${day}T09:55:00+08:00`));
 assert(new Date(first.startMillis).toISOString().endsWith('00:30:00.000Z'),'北京时间 08:30 = UTC 00:30');
 assert.equal(first.description,'教师：李老师 · 第1周（周一） · 来源：学校课程 · 由江水课表写入');
 assert.equal(out.events[1].startDate,addDays(day,7));
 assert.equal(out.events[1].description.includes('第2周（周一）'),true);
});

test('单双周、停课与学期范围：只产生实际发生的事件',()=>{
 const s=createState({...snapshot([
  rule('odd',{weekday:3,weeks:[1,3],name:'单周课'}),
  rule('even',{weekday:3,weeks:[2,4],name:'双周课'}),
 ],{semester:{id:'term-b',name:'四周',startDate:START,weeks:4},closedDates:['2026-09-09']})});
 const out=buildCalendarEvents(s);
 assert.equal(out.error,null);
 assert.deepEqual(out.events.map(e=>e.key).sort(),[
  '2026-09-02/odd','2026-09-16/odd','2026-09-23/even',
 ],'闭日期跳过、奇偶周各自展开、不越出学期');
 assert.equal(out.events.some(e=>e.startDate==='2026-09-09'),false);
});

test('调休映射与单日调整：按实际日期时间展开，自定义选项包含调休课程',()=>{
 const school=state([rule('math',{weeks:[1]})],{
  overrides:[],
  snapshot:{...snapshot([rule('math',{weeks:[1]})]),remaps:[{id:'rm1',date:'2026-09-01',fromDate:'2026-08-31',mode:'append'}]},
 });
 const all=buildCalendarEvents(school);
 assert.deepEqual(all.events.map(e=>e.key).sort(),['2026-08-31/math','2026-09-01/math/map-rm1'].sort(),'周二出现调休后的实际课程');
 const remapped=all.events.find(e=>e.key.includes('map-rm1'));
 assert.equal(remapped.source,'school','调休后的学校课程事件来源仍是学校课程');
 assert.equal(remapped.startDate,'2026-09-01');
 const noCustom=buildCalendarEvents(school,{school:true,custom:false,study:false});
 assert.deepEqual(noCustom.events.map(e=>e.key),['2026-08-31/math'],'取消自定义/调休选项后不写调休事件');

 const adjusted=state([rule('math',{weeks:[2]})],{
  localMaps:[{id:'lm1',fromDate:'2026-09-07',date:'2026-09-08'}],
  customCourses:[],
 });
 const moved=buildCalendarEvents(adjusted);
 assert.deepEqual(moved.events.map(e=>e.startDate),['2026-09-08'],'调走日原课不写，只在目标日写一次');
 assert(moved.skipped>=1,'被调走的原时段计入 skipped');
 assert.equal(buildCalendarEvents(adjusted,{school:true,custom:false,study:false}).events.length,0,'调休课程受自定义选项控制');
});

test('自定义课程与晚自习按选项过滤，事件来源标记正确',()=>{
 const s=state([],{
  snapshot:{...snapshot([]),studentProfile:{enrollmentYear:2026},studyPolicy:{enabled:true,userEnabled:true,profile:{enrollmentYear:2026},holidayDates:[],verifiedYears:[2026],sourceLabel:'本人设置 · 大一晚自习规则'}},
  customCourses:[
   {id:'custom-week',mode:'weekly',name:'社团活动',room:'活动室',teacher:'王老师',startTime:'12:20',endTime:'13:00',weekdays:[1],semesterId:'term-a',semesterStartDate:START,startWeek:1,endWeek:2,weekPattern:'every'},
   {id:'custom-once',mode:'once',name:'独立加课',date:'2026-09-01',startTime:'14:00',endTime:'15:00',room:'B402',teacher:'王老师'},
  ],
 });
 const all=buildCalendarEvents(s);
 const custom=all.events.filter(e=>e.source==='custom'),study=all.events.filter(e=>e.source==='study');
 assert.equal(custom.length,3,'两次规律自定义课 + 一次独立加课');
 assert.equal(study.length,9,'周一至周四加周日晚自习，两个教学周共 9 条（8/31 尚未满大一）');
 assert.equal(custom[0].description.includes('来源：自定义课程'),true);
 assert.equal(study[0].description.includes('来源：晚自习'),true);
 assert.equal(study[0].location,'—','晚自习教室占位符原样保留');
 assert.equal(study.some(e=>e.description.includes('第1周')),true);
 const noCustom=buildCalendarEvents(s,{school:true,custom:false,study:true});
 assert.equal(noCustom.events.length,9);assert.equal(noCustom.events.every(e=>e.source==='study'),true);
 const noStudy=buildCalendarEvents(s,{school:true,custom:true,study:false});
 assert.equal(noStudy.events.length,3);
 assert(noStudy.skipped>=1,'被选项过滤的晚自习计入 skipped');
});

test('停课、空位与无时间行跳过；空课表合法返回空数组',()=>{
 const s=createState({...snapshot([rule('math',{weeks:[1]})],{exceptions:[{date:'2026-08-31',ruleId:'math',cancel:true}]})});
 const out=buildCalendarEvents(s);
 assert.deepEqual(out.events,[]);assert.equal(out.error,null);
 const empty=state([]);
 const blank=buildCalendarEvents(empty);
 assert.deepEqual(blank,{events:[],total:0,skipped:0,error:null});
});

test('选项：缺省/非法值归一为 true，全关返回 CALENDAR_NO_OPTIONS',()=>{
 assert.deepEqual(normalizeCalendarOptions(undefined),{school:true,custom:true,study:true});
 assert.deepEqual(normalizeCalendarOptions({school:false,custom:'no',study:1}),{school:false,custom:true,study:true});
 const input={school:true,custom:true,study:true};const normalized=normalizeCalendarOptions(input);
 assert.notEqual(normalized,input,'必须返回新对象');
 assert.equal(DEFAULT_CALENDAR_OPTIONS.school,true);
 const s=state([rule('math',{weeks:[1]})]);
 const out=buildCalendarEvents(s,{school:false,custom:false,study:false});
 assert.equal(out.error.code,'CALENDAR_NO_OPTIONS');
 assert.deepEqual(out.events,[]);assert.equal(out.total,0);
});

test('超过 5000 条：返回 CALENDAR_TOO_MANY_EVENTS 且不返回部分事件',()=>{
 const rules=Array.from({length:100},(_,i)=>rule(`bulk-${i}`,{name:'大课'+i,weeks:Array.from({length:60},(_,w)=>w+1)}));
 const s=createState({...snapshot(rules,{semester:{id:'term-big',name:'大课表',startDate:START,weeks:60}})});
 const out=buildCalendarEvents(s);
 assert.equal(out.error.code,'CALENDAR_TOO_MANY_EVENTS');
 assert.deepEqual(out.events,[],'全有或全无：不返回部分事件');
 assert.equal(out.total,6000,'100 门 × 60 周 = 6000 条');
 assert(CALENDAR_EVENT_LIMIT===5000);
});

test('跨月跨年日期与 +08:00 绝对时间',()=>{
 const s=createState({...snapshot([rule('math',{weekday:1,weeks:[1,2]})],{semester:{id:'term-newyear',name:'跨年',startDate:'2026-12-28',weeks:2}})});
 const out=buildCalendarEvents(s);
 assert.deepEqual(out.events.map(e=>e.startDate),['2026-12-28','2027-01-04']);
 assert.equal(out.events[0].startMillis,Date.parse('2026-12-28T08:30:00+08:00'));
 assert.equal(new Date(out.events[0].startMillis).toISOString(),'2026-12-28T00:30:00.000Z');
 assert.equal(new Date(out.events[1].startMillis).toISOString(),'2027-01-04T00:30:00.000Z');
});

test('标题/地点/描述长度上限与缺省占位',()=>{
 const s=state([rule('long',{name:'课'.repeat(300),room:'室'.repeat(300),teacher:'师'.repeat(300),weeks:[1]})]);
 const event=buildCalendarEvents(s).events[0];
 assert.equal(event.title.length,200);
 assert.equal(event.location.length,200);
 assert(event.description.length<=1000);
 assert(event.description.startsWith('教师：师'));
 const empty=state([rule('empty',{name:'只有名字',room:'',teacher:'',weeks:[1]})]);
 const e2=buildCalendarEvents(empty).events[0];
 assert.equal(e2.location,'未填写教室');
 assert(e2.description.includes('教师：未填写'));
});

test('同名同时段多门保留独立 key；学期 1 周与 60 周边界',()=>{
 const twice=state([rule('a',{name:'同名课',weeks:[1]}),rule('b',{name:'同名课',weeks:[1]})]);
 const out=buildCalendarEvents(twice);
 assert.equal(out.events.length,2);assert.notEqual(out.events[0].key,out.events[1].key);
 const one=createState({...snapshot([rule('math',{weeks:[1]})],{semester:{id:'term-1',name:'一周',startDate:START,weeks:1}})});
 assert.equal(buildCalendarEvents(one).events.length,1);
 const sixty=createState({...snapshot([rule('math',{weeks:[1,60]})],{semester:{id:'term-60',name:'六十周',startDate:START,weeks:60}})});
 const sixtyOut=buildCalendarEvents(sixty);
 assert.deepEqual(sixtyOut.events.map(e=>e.startDate),[START,addDays(START,59*7)]);
});
