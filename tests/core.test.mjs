import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {addDays,weekOf,sourceDay,effectiveDay,createState,clone,saveOverride,applySnapshot,adoptSchoolSnapshot,recordFailure,diffSnapshots,noticeLevel,validateSnapshot} from '../web/core.mjs';
import {normalizeExamList} from '../web/jiaowu-exam.mjs';
import {PERIOD_TIMES} from '../web/jsxsd.mjs';
const base=JSON.parse(fs.readFileSync(new URL('../web/data/baseline.json',import.meta.url)));const adjusted=JSON.parse(fs.readFileSync(new URL('../web/data/adjusted.json',import.meta.url)));
test('真实样例17条排课，源周次正确；放假不阻止补课',()=>{assert.equal(base.rules.length,17);assert.equal(sourceDay(adjusted,'2026-09-29').length,0);const next=sourceDay(adjusted,'2026-10-10');assert.equal(next.length,3);assert(next.every(r=>r.originDate==='2026-09-29'));assert.deepEqual(next.map(r=>r.ruleId),sourceDay(base,'2026-09-29').map(r=>r.ruleId));});
test('补课与军事理论重叠，双方均保留并提示',()=>{const a=effectiveDay(adjusted,'2026-10-17');assert.equal(a.length,2);assert(a.every(x=>x.overlap));});
test('日期运算跨年与18周末端',()=>{assert.equal(addDays('2026-12-31',1),'2027-01-01');assert.equal(weekOf(base,'2027-01-03'),18);assert.equal(weekOf(base,'2027-01-04'),19);assert.equal(sourceDay(base,'2027-01-04').length,0);});
test('单点修改只影响一天，原快照不变；移除可撤销',()=>{const r=sourceDay(base,'2026-10-13')[0],s=createState(base),updated=saveOverride(s,r,{room:'B203'});assert.equal(effectiveDay(updated.snapshot,r.date,updated.overrides)[0].room,'B203');assert.equal(effectiveDay(base,'2026-10-20',updated.overrides)[0].room,r.room);assert.equal(sourceDay(base,r.date)[0].room,r.room);assert.equal(effectiveDay(base,r.date,[])[0].room,r.room);assert.equal(s.overrides.length,0);});
test('学校改无关字段不冲突，同字段冲突突出学校并保留本地',()=>{const r=sourceDay(base,'2026-10-13')[0];const state=saveOverride(createState(base),r,{room:'B203'});const next=clone(base);next.rules.find(x=>x.id===r.ruleId).teacher='新教师';let day=effectiveDay(next,r.date,state.overrides);assert.equal(day[0].room,'B203');assert.equal(day[0].teacher,'新教师');assert.equal(day[0].conflict,undefined);next.rules.find(x=>x.id===r.ruleId).room='C301';day=effectiveDay(next,r.date,state.overrides);assert.equal(day[0].room,'C301');assert.equal(day[0].conflict.local.room,'B203');});
test('来源取消已手改课程仍显示冲突，不能静默删除',()=>{const r=sourceDay(base,'2026-10-13')[0],s=saveOverride(createState(base),r,{room:'B203'}),next=clone(base);next.exceptions=[{date:r.date,ruleId:r.ruleId,cancel:true}];const row=effectiveDay(next,r.date,s.overrides).find(x=>x.key===r.key);assert.equal(row.conflict.school,null);assert.equal(row.cancelled,true);});
test('全量对比保留远期，过滤过去，重复读取无重复事件',()=>{const next=clone(base);next.rules[3].room='B303';const events=diffSnapshots(base,next,'2026-10-09T12:00:00Z');assert(events.length>4);assert(events.every(e=>e.date>='2026-10-09'));assert(events.some(e=>e.date>'2026-12-01'));assert.equal(diffSnapshots(next,next).length,0);});
test('远期变化临近转为提醒，知道了不再提醒',()=>{const a=clone(base);a.rules[3].room='B303';const event=diffSnapshots(base,a,'2026-10-09T12:00:00Z').find(e=>e.date==='2026-12-01');assert.equal(noticeLevel(event,new Date('2026-10-09T12:00:00Z')),'later');assert.equal(noticeLevel(event,new Date('2026-11-30T12:00:00Z')),'urgent');event.read=true;assert.equal(noticeLevel(event,new Date('2026-11-30T12:00:00Z')),'none');});
test('失败保留原快照、原成功时间和变化记录',()=>{const s=applySnapshot(createState(base),adjusted,'2026-10-09T12:00:00Z'),failed=recordFailure(s,'网络错误','2026-10-09T13:00:00Z');assert.equal(failed.snapshot,s.snapshot);assert.equal(failed.lastSuccess,s.lastSuccess);assert.equal(failed.events,s.events);assert.equal(failed.error,'网络错误');});
test('replace与append不同，映射源周次不能用目的周次',()=>{const b=clone(base);b.rules.push({id:'test',name:'第六周独有',weekday:6,weeks:[6],periods:[1,2],startTime:'08:30',endTime:'09:55',room:'A1',teacher:'老师'});b.remaps=[{id:'m',date:'2026-10-10',fromDate:'2026-09-29',mode:'append'}];assert.equal(sourceDay(b,'2026-10-10').length,4);b.remaps[0].mode='replace';assert.equal(sourceDay(b,'2026-10-10').length,3);});
test('同步学校课表不会清除本机调休与单日修改',()=>{const map={id:'local-map',date:'2026-10-17',fromDate:'2026-09-29',mode:'replace'};const first=createState(base);first.localMaps=[map];const edited=saveOverride(first,sourceDay(base,'2026-10-13')[0],{room:'B203'});const next=applySnapshot(edited,clone(adjusted));assert.deepEqual(next.localMaps,[map]);assert.equal(next.overrides.length,1);assert.equal(effectiveDay(next.snapshot,'2026-10-17',next.overrides,next.localMaps).some(r=>r.remapId==='local-map'),true);});
test('格式错误和不同学期拒绝，避免误报整学期取消',()=>{const b=clone(base);b.rules[0].weeks=[0];assert.throws(()=>validateSnapshot(b));const c=clone(base);c.semester.id='other';assert.throws(()=>diffSnapshots(base,c));});

// 考试集成：全部为脱敏合成样本（课程A/B、考场A/B、教师甲/乙、假座位号）。
const EXAM_ROWS=[
 {kssj:'2026-12-21 19:00~20:25',kskcmc:'课程A',kch:'K001',jsxm:'教师甲',js_mc:'考场A',zwh:'1',ksccmc:'场次A'},
 {kssj:'2026-12-22 14:00~15:25',kskcmc:'课程B',kch:'K002',jsxm:'教师乙',js_mc:'考场B',zwh:'2',ksccmc:'场次A'},
];
function withExams(snapshot,rows=EXAM_ROWS){
 const exams=normalizeExamList({code:0,count:rows.length,data:rows},{semesterId:snapshot.semester.id,semesterStartDate:snapshot.semester.startDate,totalWeeks:snapshot.semester.weeks,periodTimes:PERIOD_TIMES,fetchedAt:'2026-11-17T00:00:00.000Z'});
 return {...clone(snapshot),exams};
}
function studySnapshot(){
 const snapshot=withExams(clone(base));
 snapshot.studentProfile={enrollmentYear:2026};
 snapshot.studyPolicy={enabled:true,userEnabled:true,profile:{enrollmentYear:2026},holidayDates:[],verifiedYears:[2026],sourceLabel:'本人设置 · 大一晚自习规则'};
 return snapshot;
}

test('考试注入：真实 effectiveDay 合并考试条目，考试不进 rules 也不改源课表',()=>{
 const snapshot=withExams(base);
 const day=effectiveDay(snapshot,'2026-12-21');
 assert.equal(day.length,1);
 assert.equal(day[0].exam,true);
 assert.equal(day[0].name,'课程A');
 assert.equal(day[0].startTime,'19:00');
 assert.equal(day[0].endTime,'20:25');
 assert.deepEqual(day[0].periods,[9,10]);
 assert.equal(day[0].room,'考场A');
 assert.equal(day[0].source,'school');
 assert.equal(snapshot.rules.length,17,'rules 不变');
 assert.equal(sourceDay(snapshot,'2026-12-21').length,0,'考试不进入 rules 源');
});

test('考试免疫休假：寒假区间与单日休假都不隐藏考试',()=>{
 const snapshot=withExams(clone(base));
 const winter={winter:{startDate:'2026-12-17',endDate:'2027-01-10'},summer:null,days:[]};
 const holidayDay=effectiveDay(snapshot,'2026-12-21',[],[],{},[],winter);
 assert.equal(holidayDay.filter(r=>r.exam===true).length,1,'寒假不隐藏考试');
 assert.equal(holidayDay.filter(r=>r.exam!==true).length,0);
 const dayOff={winter:null,summer:null,days:[{date:'2026-12-21',skipStudy:false}]};
 const offDay=effectiveDay(snapshot,'2026-12-21',[],[],{},[],dayOff);
 assert.equal(offDay.filter(r=>r.exam===true).length,1,'单日休假不隐藏考试');
});

test('考试免疫调休：replace 调休不搬走考试，考试日原课被替换后考试仍在',()=>{
 const snapshot=withExams(clone(base));
 snapshot.remaps=[{id:'rm-exam',date:'2026-12-21',fromDate:'2026-12-01',mode:'replace'}];
 const sourceMapped=effectiveDay(snapshot,'2026-12-21');
 assert.equal(sourceMapped.filter(r=>r.exam===true).length,1,'学校调休不影响考试');
 const localMaps=[{id:'lm-exam',date:'2026-12-21',fromDate:'2026-12-01'}];
 const localMapped=effectiveDay(snapshot,'2026-12-21',[],localMaps);
 assert.equal(localMapped.filter(r=>r.exam===true).length,1,'本机调休不影响考试');
 assert(sourceMapped.filter(r=>r.exam!==true).every(r=>r.remapId),'调休日原有课程被 replace，只剩调休课与考试');
});

test('同节冲突并存：考试与同时间课程都保留，双方 overlap=true',()=>{
 const snapshot=withExams(clone(base));
 const day=effectiveDay(snapshot,'2026-12-22');
 const exam=day.find(r=>r.exam===true),course=day.find(r=>r.ruleId==='course-5');
 assert(exam&&course,'考试与课程同时显示');
 assert.equal(exam.overlap,true);
 assert.equal(course.overlap,true);
 assert.equal(day.find(r=>r.ruleId==='course-7').overlap,false,'不同时段课程不误标重叠');
});

test('晚自习给考试让位：同时段考试出现时本机晚自习不显示',()=>{
 const snapshot=studySnapshot();
 const examDay=effectiveDay(snapshot,'2026-12-21');
 assert(examDay.some(r=>r.exam===true),'考试显示');
 assert(!examDay.some(r=>r.localActivity),'晚自习让位');
 const normalDay=effectiveDay(snapshot,'2026-12-23');
 assert(normalDay.some(r=>r.localActivity),'没有考试的晚上晚自习照常显示');
});

test('学校刷新保留考试：新快照未携带 exams 时保留同学期旧数据，采用新课时同步保留',()=>{
 const seeded=withExams(clone(base));
 const state=createState(seeded);
 const next=applySnapshot(state,clone(base),'2026-11-17T01:00:00.000Z');
 assert.equal(next.snapshot.exams.items.length,2,'新快照缺 exams 时保留同学期旧数据');
 const adopted=adoptSchoolSnapshot(state,clone(base),'2026-11-17T01:00:00.000Z');
 assert.equal(adopted.snapshot.exams.items.length,2,'采用学校课表同样保留同学期考试');
});

test('学期切换丢弃旧考试：adopt 新学期快照不携带旧 exams',()=>{
 const seeded=withExams(clone(base));
 const state=createState(seeded);
 const other=clone(base);
 other.semester={id:'school-2027-02-22',name:'新学期',startDate:'2027-02-22',weeks:18};
 const adopted=adoptSchoolSnapshot(state,other,'2027-02-22T01:00:00.000Z');
 assert.equal(adopted.snapshot.exams,undefined,'异学期一律丢弃，避免旧考试显示到新学期');
 assert.equal(effectiveDay(adopted.snapshot,'2026-12-21').length,0);
});

test('考试变更记录：经 applySnapshot 进入现有变更事件链路',()=>{
 const initial=withExams(clone(base));
 const state=createState(initial);
 const changedRows=EXAM_ROWS.map((row,index)=>index===0?{...row,js_mc:'考场B'}:row);
 const changed=withExams(clone(base),changedRows);
 const next=applySnapshot(state,changed,'2026-11-17T02:00:00.000Z');
 const events=next.events.filter(event=>event.exam);
 assert.equal(events.length,1);
 assert.equal(events[0].type,'换考场');
 assert.equal(events[0].name,'课程A');
 assert.equal(events[0].source,'school');
 const unchanged=applySnapshot(createState(initial),withExams(clone(base)),'2026-11-17T03:00:00.000Z');
 assert.equal(unchanged.events.filter(event=>event.exam).length,0,'同一份考试数据不产生新事件');
});

test('schemaVersion 兼容：validateSnapshot 不校验可选 exams 字段',()=>{
 const snapshot=clone(base);
 snapshot.exams={items:[],skipped:[],unknownFutureField:true};
 assert.doesNotThrow(()=>validateSnapshot(snapshot));
 assert.equal(clone(snapshot).exams.unknownFutureField,true,'未知字段随快照克隆保留');
});

test('首批考试数据静默入库：首次成功与失败标记后的首次成功都不产生变更事件（P2-R2-4）',()=>{
 const now='2026-11-17T04:00:00.000Z';
 const fresh=withExams(clone(base));
 const noBaseline=applySnapshot(createState(clone(base)),fresh,now);
 assert.equal(noBaseline.snapshot.exams.items.length,2);
 assert.equal(noBaseline.events.filter(event=>event.exam).length,0,'首次成功不生成新增事件');
 const marker={...clone(base),exams:{semesterId:base.semester.id,semesterStartDate:base.semester.startDate,fetchedAt:null,lastAttempt:'2026-11-16T00:00:00.000Z',error:'timeout',source:'school',items:[],skipped:[]}};
 const afterFailure=applySnapshot(createState(marker),fresh,'2026-11-17T05:00:00.000Z');
 assert.equal(afterFailure.events.filter(event=>event.exam).length,0,'失败标记后的首次成功同样静默');
 const changed=withExams(clone(base),EXAM_ROWS.map((row,index)=>index===0?{...row,js_mc:'考场B'}:row));
 const next=applySnapshot(afterFailure,changed,'2026-11-17T06:00:00.000Z');
 assert.deepEqual(next.events.filter(event=>event.exam).map(event=>event.type),['换考场'],'第二次成功起才 diff');
});

test('单日恢复：休假与学校停课日恢复后按正常规则排课，考试仍按固定日期显示',()=>{
 const snapshot=studySnapshot();
 const winter={winter:{startDate:'2026-12-20',endDate:'2026-12-24'},summer:null,days:[],restoreDates:[]};
 assert.deepEqual(effectiveDay(snapshot,'2026-12-23',[],[],{},[],winter),[],'寒假日默认取消全部课程');
 const restored=effectiveDay(snapshot,'2026-12-23',[],[],{},[],{...winter,restoreDates:['2026-12-23']});
 assert(restored.some(r=>r.exam!==true&&!r.localActivity),'恢复后学校课回来');
 assert(restored.some(r=>r.localActivity),'恢复后晚自习回来');
 const examHoliday=effectiveDay(snapshot,'2026-12-21',[],[],{},[],winter);
 assert.equal(examHoliday.filter(r=>r.exam!==true).length,0,'未恢复时当天只剩固定日期考试');
 assert.equal(examHoliday.filter(r=>r.exam===true).length,1);
 const closed=clone(snapshot);closed.closedDates=['2026-12-23'];
 assert.deepEqual(effectiveDay(closed,'2026-12-23'),[],'学校停课日默认取消全部课程');
 const closedRestored=effectiveDay(closed,'2026-12-23',[],[],{},[],{winter:null,summer:null,days:[],restoreDates:['2026-12-23']});
 assert(closedRestored.some(r=>r.exam!==true&&!r.localActivity),'停课日恢复后学校课回来');
 assert(closedRestored.some(r=>r.localActivity),'停课日恢复后晚自习回来');
});

// D1 口径 A：学校调课（snapshot.remaps）与本机调休统一按「搬走」语义——调出日不显示源课。
// 事实基准：work/docs/specification-2026-11-18/10-web-core-state.md CORE-022、13-android-platform.md AND-163。
// 与真实 Java ScheduleWidgetData.java 的双 resolver 对照见 tests/widget-remap.test.mjs。
function d1Snapshot(){
 const snapshot=clone(base);
 snapshot.semester={id:'term-d1',name:'D1 调课学期',startDate:'2026-08-31',weeks:18};
 snapshot.source={kind:'school',label:'测试学校课表'};
 snapshot.rules=[
  {id:'mon-course',name:'周一源课',teacher:'甲',room:'A101',weekday:1,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'},
  {id:'tue-course',name:'周二源课',teacher:'乙',room:'B202',weekday:2,weeks:[7],periods:[3,4],startTime:'10:05',endTime:'11:30'},
  {id:'wed-course',name:'周三源课',teacher:'丙',room:'C303',weekday:3,weeks:[7],periods:[5,6],startTime:'14:00',endTime:'15:25'},
  {id:'fri-course',name:'周五本课',teacher:'丁',room:'D404',weekday:5,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'},
  {id:'sat-course',name:'周六本课',teacher:'戊',room:'E505',weekday:6,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'}
 ];
 snapshot.remaps=[];snapshot.closedDates=[];snapshot.exceptions=[];
 return snapshot;
}
const D1_MON='2026-10-12',D1_TUE='2026-10-13',D1_WED='2026-10-14',D1_THU='2026-10-15',D1_FRI='2026-10-16',D1_SAT='2026-10-17';
const D1_REPLACE={id:'school-replace',date:D1_FRI,fromDate:D1_MON,mode:'replace'};
const D1_APPEND={id:'school-append',date:D1_SAT,fromDate:D1_TUE,mode:'append'};

test('D1 口径 A：学校调课 replace 调出日不显示源课，目标日按源日排课',()=>{
 const snapshot=d1Snapshot();snapshot.remaps=[D1_REPLACE];
 assert.deepEqual(effectiveDay(snapshot,D1_MON).map(r=>r.ruleId),[],'调出日不再显示学校源课（口径 A）');
 assert.equal(sourceDay(snapshot,D1_MON).some(r=>r.ruleId==='mon-course'),true,'sourceDay 仍是学校源课表视图，生效口径只改 effectiveDay');
 const friday=effectiveDay(snapshot,D1_FRI);
 assert.deepEqual(friday.map(r=>r.ruleId),['mon-course'],'replace 清空目标日本课后只留调入课');
 assert.equal(friday[0].originDate,D1_MON,'调入行保留源日期');
 assert.equal(friday[0].remapId,'school-replace','调入行带学校映射 id');
 assert.equal(friday[0].source,'school','学校调课调入行 source 仍是学校');
 assert.equal(friday[0].overlap,false);
});

test('D1 口径 A：学校调课 append 调出日不显示源课，目标日保留本课并追加源日课程',()=>{
 const snapshot=d1Snapshot();snapshot.remaps=[D1_APPEND];
 assert.deepEqual(effectiveDay(snapshot,D1_TUE).map(r=>r.ruleId),[],'append 调出日同样不显示源课');
 const saturday=effectiveDay(snapshot,D1_SAT).map(r=>({rule:r.ruleId,remap:r.remapId||null,origin:r.originDate}));
 assert.deepEqual(saturday,[
  {rule:'sat-course',remap:null,origin:D1_SAT},
  {rule:'tue-course',remap:'school-append',origin:D1_TUE}
 ],'append 目标日保留本课并追加源日课程');
});

test('D1 口径 A：本机调休行为不回归，学校调课与本机调休并存时都按调出过滤',()=>{
 const snapshot=d1Snapshot();snapshot.remaps=[D1_REPLACE];
 const localMaps=[{id:'local-1700000000000',date:D1_THU,fromDate:D1_WED}];
 assert.deepEqual(effectiveDay(snapshot,D1_WED,[],localMaps).map(r=>r.ruleId),[],'本机调休调出日仍不显示源课（CORE-022 原口径保留）');
 const thursday=effectiveDay(snapshot,D1_THU,[],localMaps);
 assert.deepEqual(thursday.map(r=>r.ruleId),['wed-course'],'本机调休目标日仍按源日排课');
 assert.equal(thursday[0].source,'local','本机调休调入行 source=local，不与学校行混淆');
 assert.equal(thursday[0].remapId,'local-1700000000000');
 assert.deepEqual(effectiveDay(snapshot,D1_MON,[],localMaps).map(r=>r.ruleId),[],'两条映射并存时学校调课调出日仍过滤');
 assert.deepEqual(effectiveDay(snapshot,D1_THU).map(r=>r.ruleId),[],'没有本机调休时周四本来就无课，行为不变');
});

test('D1 口径 A：调出日不搬走本机自定义课，旧单日修改不复活源课',()=>{
 const snapshot=d1Snapshot();snapshot.remaps=[D1_REPLACE];
 const weekly={id:'custom-weekly-mon',mode:'weekly',name:'规律补习',teacher:'孙',room:'E505',startTime:'16:00',endTime:'17:30',semesterId:snapshot.semester.id,semesterStartDate:snapshot.semester.startDate,startWeek:1,endWeek:18,weekPattern:'every',weekdays:[1]};
 const once={id:'custom-once-mon',mode:'once',name:'独立加课',teacher:'赵',room:'G707',startTime:'18:00',endTime:'19:00',date:D1_MON};
 assert.deepEqual(effectiveDay(snapshot,D1_MON,[],[],{},[weekly,once]).map(r=>r.ruleId),['custom-weekly-mon','custom-once-mon'],'学校调课只搬学校源课，本机自定义课留在原日期');
 const sourceRow=sourceDay(snapshot,D1_MON).find(r=>r.ruleId==='mon-course');
 const edited=saveOverride(createState(snapshot),sourceRow,{room:'X909'});
 assert.deepEqual(effectiveDay(snapshot,D1_MON,edited.overrides).map(r=>r.ruleId),[],'旧单日修改不能把已搬走的源课复活');
});

test('D1 口径 A：无效/自映射映射按与 Java 相同的字符串口径处理',()=>{
 const self=d1Snapshot();self.remaps=[{id:'self-map',date:D1_FRI,fromDate:D1_FRI,mode:'append'}];
 assert.equal(effectiveDay(self,D1_MON).length,1,'自映射不影响其他日期');
 const friday=effectiveDay(self,D1_FRI);
 assert.equal(friday.length,2,'自映射不判为调出：目标日保留本课并追加源日相同行（Java 同口径）');
 assert.equal(friday.filter(r=>r.remapId==='self-map').length,1);
 const broken=d1Snapshot();broken.remaps=[{id:'broken-map',fromDate:D1_MON,mode:'append'}];
 assert.deepEqual(effectiveDay(broken,D1_MON).map(r=>r.ruleId),[],'缺 target 的损坏映射在两侧都按「目标日≠当日」判为调出');
 assert.equal(effectiveDay(broken,D1_FRI).length,1,'缺 target 的映射不会把课程搬到其他日期');
 assert.throws(()=>validateSnapshot({...d1Snapshot(),remaps:[{id:'bad-mode',date:D1_FRI,fromDate:D1_MON,mode:'merge'}]}),/调休映射无效/,'非法 mode 在导入边界被拒绝');
 assert.throws(()=>validateSnapshot({...d1Snapshot(),remaps:[{id:'bad-date',date:'2026-02-30',fromDate:D1_MON,mode:'append'}]}),/调休映射无效/,'非法 target 日期在导入边界被拒绝');
 assert.throws(()=>validateSnapshot({...d1Snapshot(),remaps:[D1_REPLACE,{...D1_REPLACE}]}),/调休映射无效/,'重复 id 在导入边界被拒绝');
});
