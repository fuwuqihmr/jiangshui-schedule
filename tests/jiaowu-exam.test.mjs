import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EXAM_CACHE_TTL_MS,parseExamTime,timeToPeriods,normalizeExamList,examDay,withExamFallback,examSummary,diffExamSnapshots,attachExamPayload,examSkipCounts,examSkipsAreHard,weekOf,weekday} from '../web/jiaowu-exam.mjs';
import {PERIOD_TIMES} from '../web/jsxsd.mjs';

// 全部样本为脱敏合成数据：课程A–H / 考场A–H / 教师甲–辛 / 假座位号；日期与时刻保留（落格规则需要）。
const RAW=[
 {kssj:'2026-12-21 19:00~20:25',kskcmc:'课程A',kch:'K001',jsxm:'教师甲',js_mc:'考场A',zwh:'11',ksxq:'校区A',xqmc:'校区A1',ksccmc:'场次A'},
 {kssj:'2026-12-24 15:45~17:10',kskcmc:'课程B',kch:'K002',jsxm:'教师乙',js_mc:'考场B',zwh:'12',ksccmc:'场次A'},
 {kssj:'2027-01-04 08:30~09:55',kskcmc:'课程C',kch:'K003',jsxm:'教师丙',js_mc:'考场C',zwh:'13',ksccmc:'场次A'},
 {kssj:'2027-01-04 10:15~11:40',kskcmc:'课程D',kch:'K004',jsxm:'教师丁',js_mc:'考场D',zwh:'14',ksccmc:'场次A'},
 {kssj:'2027-01-06 08:30~09:55',kskcmc:'课程E',kch:'K005',jsxm:'教师戊',js_mc:'考场E',zwh:'15',ksccmc:'场次A'},
 {kssj:'2027-01-06 14:00~15:25',kskcmc:'课程F',kch:'K006',jsxm:'教师己',js_mc:'考场F',zwh:'16',ksccmc:'场次A'},
 {kssj:'2027-01-07 14:00~15:25',kskcmc:'课程G',kch:'K007',jsxm:'教师庚',js_mc:'考场G',zwh:'17',ksccmc:'场次A'},
 {kssj:'2027-01-08 10:15~11:40',kskcmc:'课程H',kch:'K008',jsxm:'教师辛',js_mc:'考场H',zwh:'18',ksccmc:'场次A'},
];
const SEMESTER={id:'school-2026-08-31',startDate:'2026-08-31',weeks:25};
const FETCHED='2026-11-17T00:00:00.000Z';
const payload=(data,extra={})=>({code:0,count:data.length,data,...extra});
function normalized(rows=RAW,{semester=SEMESTER,fetchedAt=FETCHED}={}){
 return normalizeExamList(payload(rows),{semesterId:semester.id,semesterStartDate:semester.startDate,totalWeeks:semester.weeks,periodTimes:PERIOD_TIMES,fetchedAt});
}
const snapshotWith=(exams,extra={})=>({schemaVersion:1,semester:{...SEMESTER},source:{kind:'school'},rules:[],exceptions:[],remaps:[],closedDates:[],...(exams?{exams}:{}),...extra});

test('考试时间解析：实测格式与容错分隔符，非法时间/日期拒绝',()=>{
 assert.deepEqual(parseExamTime('2026-12-21 19:00~20:25'),{date:'2026-12-21',startTime:'19:00',endTime:'20:25'});
 assert.deepEqual(parseExamTime('2026-12-21 19:00～20:25'),{date:'2026-12-21',startTime:'19:00',endTime:'20:25'});
 assert.deepEqual(parseExamTime(' 2026-12-21　19:00-20:25 '),{date:'2026-12-21',startTime:'19:00',endTime:'20:25'});
 assert.deepEqual(parseExamTime('2026-12-21 19:00—20:25'),{date:'2026-12-21',startTime:'19:00',endTime:'20:25'});
 for(const bad of ['2026-12-21 20:25~19:00','2027-02-30 08:30~09:55','2026-12-21','19:00~20:25','2026-12-21 19:00~20:25:00',null,undefined,42])assert.equal(parseExamTime(bad),null);
});

test('时间→节次：实测 8 条全部精确落界，非整点保留实际起止并给交集节次',()=>{
 assert.deepEqual(timeToPeriods('19:00','20:25',PERIOD_TIMES),{first:9,last:10,periods:[9,10],exact:true});
 assert.deepEqual(timeToPeriods('10:15','11:40',PERIOD_TIMES),{first:3,last:4,periods:[3,4],exact:true});
 assert.deepEqual(timeToPeriods('15:45','17:10',PERIOD_TIMES),{first:7,last:8,periods:[7,8],exact:true});
 assert.deepEqual(timeToPeriods('09:00','10:30',PERIOD_TIMES),{first:1,last:3,periods:[1,2,3],exact:false});
 assert.deepEqual(timeToPeriods('14:00','15:25',PERIOD_TIMES),{first:5,last:6,periods:[5,6],exact:true});
 assert.equal(timeToPeriods('21:20','22:00',PERIOD_TIMES),null,'晚于第11节，无法映射');
 assert.equal(timeToPeriods('07:00','08:00',PERIOD_TIMES),null,'早于第1节，无法映射');
 assert.equal(timeToPeriods('19:00','19:00',PERIOD_TIMES),null);
 assert.equal(timeToPeriods('19:00','20:25',null),null);
});

test('实测8条脱敏样本规范化：字段映射、节次、周次、排序',()=>{
 const exams=normalized();
 assert.equal(exams.error,null);
 assert.equal(exams.items.length,8);
 assert.deepEqual(exams.items.map(item=>item.date),['2026-12-21','2026-12-24','2027-01-04','2027-01-04','2027-01-06','2027-01-06','2027-01-07','2027-01-08']);
 assert.deepEqual(exams.items.map(item=>item.week),[17,17,19,19,19,19,19,19]);
 assert.deepEqual(exams.items.map(item=>item.weekday),[1,4,1,1,3,3,4,5]);
 assert.deepEqual(exams.items.map(item=>item.periods),[[9,10],[7,8],[1,2],[3,4],[1,2],[5,6],[5,6],[3,4]]);
 assert(exams.items.every(item=>item.exact===true));
 const first=exams.items[0];
 assert.equal(first.id,'K001|场次A|2026-12-21|19:00');
 assert.equal(first.name,'课程A');assert.equal(first.teacher,'教师甲');assert.equal(first.room,'考场A');
 assert.equal(first.seat,'11');assert.equal(first.campus,'校区A');assert.equal(first.session,'场次A');
 assert.equal(first.startTime,'19:00');assert.equal(first.endTime,'20:25');
 assert.equal(first.week,17);assert.equal(first.weekday,1);
 assert.deepEqual(exams.items[3].periods,[3,4]);
 const fallback=normalized([{kssj:'2027-01-04 08:30~09:55',kskcmc:'课程C',kch:'K003'}]);
 assert.equal(fallback.items[0].teacher,'—','缺教师用占位符');
 assert.equal(fallback.items[0].room,'—','缺考场用占位符');
 assert.equal(fallback.items[0].seat,null,'缺座位为 null');
 assert.equal(fallback.items[0].campus,null);
 assert.deepEqual(exams.skipped,[]);
});

test('接口失败/HTML/非数组空响应只返回 error=format，不抛异常',()=>{
 for(const bad of [{code:1,count:0,data:[]},{code:0,data:{}},{code:0},{data:[]},{code:0,count:1,data:null},'<html>login</html>',null]){
  const exams=normalizedFromRaw(bad);
  assert.equal(exams.error,'format');
  assert.deepEqual(exams.items,[]);
 }
 function normalizedFromRaw(value){return normalizeExamList(value,{semesterId:SEMESTER.id,semesterStartDate:SEMESTER.startDate,totalWeeks:SEMESTER.weeks,periodTimes:PERIOD_TIMES,fetchedAt:FETCHED});}
});

test('异常行按原因跳过：时间/节次/名称/重复，越界周仍保留',()=>{
 const rows=[
  {...RAW[2],kssj:'2027-01-04 25:00~26:00'},
  {...RAW[2],kssj:'2027-01-04 21:20~22:00',kch:'K900'},
  {...RAW[2],kskcmc:'   ',kch:'K901'},
  {...RAW[2]},
  {...RAW[2]},
  {...RAW[2],kssj:'2027-06-01 08:30~09:55',kch:'K902'},
  {...RAW[2],kssj:'2026-08-29 08:30~09:55',kch:'K903'},
 ];
 const exams=normalized(rows);
 assert.deepEqual(exams.skipped.map(item=>item.reason),['time','period','name','duplicate']);
 assert.equal(exams.items.length,3,'重复行去重后保留本周与两个越界周条目');
 assert.deepEqual(exams.items.map(item=>item.week),[0,19,40],'周次越界仍保留，不静默隐藏考试（按日期排序）');
 assert.equal(exams.error,'format','存在硬失败（time/name）即视为本次结果不完整（P2-R2-3）');
 assert.equal(weekOf(SEMESTER.startDate,'2027-06-01'),40);
 assert.equal(weekday('2026-08-29'),6);
});

test('semesterStartDate 缺失时无法计算周次：按 week 原因跳过而不是造假',()=>{
 const exams=normalizeExamList(payload(RAW),{semesterId:SEMESTER.id,semesterStartDate:undefined,totalWeeks:25,periodTimes:PERIOD_TIMES,fetchedAt:FETCHED});
 assert.equal(exams.items.length,0);
 assert.deepEqual(exams.skipped.map(item=>item.reason),Array(8).fill('week'));
 assert.equal(exams.error,'format','week 为防御性硬失败，不能拿空列表覆盖旧数据');
});

test('稳定 id 与幂等：同一份响应两次规范化得到完全相同数据',()=>{
 const again=normalized();
 assert.equal(JSON.stringify(again),JSON.stringify(normalized()));
 assert.equal(new Set(again.items.map(item=>item.id)).size,8);
});

test('examDay：只映射指定日期，学期不一致/非法日期返回空',()=>{
 const snapshot=snapshotWith(normalized());
 assert.equal(examDay(snapshot,'2026-12-20').length,0);
 const day=examDay(snapshot,'2027-01-04');
 assert.equal(day.length,2);
 assert.deepEqual(day.map(item=>item.startTime),['08:30','10:15']);
 const first=day[0];
 assert.equal(first.exam,true);
 assert.equal(first.key,'2027-01-04/exam-K003|场次A|2027-01-04|08:30');
 assert.equal(first.ruleId,'exam-K003|场次A|2027-01-04|08:30');
 assert.deepEqual(first.weeks,[19]);
 assert.equal(first.source,'school');
 assert.equal(first.sourceLabel,'考试安排');
 assert.equal(first.cancelled,false);
 assert.equal(examDay({...snapshot,semester:{...SEMESTER,id:'other'}},'2027-01-04').length,0,'学期 id 不一致不显示');
 assert.equal(examDay({...snapshot,semester:{...SEMESTER,startDate:'2026-09-07'}},'2027-01-04').length,0,'学期开始日不一致不显示');
 assert.equal(examDay(snapshot,'2027-02-30').length,0);
 assert.equal(examDay(snapshotWith(null),'2027-01-04').length,0);
});

test('withExamFallback：成功挂载；失败同学期保留旧数据并记录原因；跨学期丢弃',()=>{
 const fresh=normalized();
 const success=withExamFallback(snapshotWith(null),fresh,null,{now:'2026-11-17T01:00:00.000Z'});
 assert.equal(success.exams.items.length,8);
 assert.equal(success.exams.lastAttempt,'2026-11-17T01:00:00.000Z');
 const kept=withExamFallback(snapshotWith(null),null,success.exams,{now:'2026-11-17T02:00:00.000Z',error:'http'});
 assert.equal(kept.exams.items.length,8);
 assert.equal(kept.exams.error,'http');
 assert.equal(kept.exams.lastAttempt,'2026-11-17T02:00:00.000Z');
 const dropped=withExamFallback({...snapshotWith(null),semester:{id:'next',startDate:'2027-02-22',weeks:20}},null,success.exams,{now:'2027-02-22T00:00:00.000Z',error:'timeout'});
 assert.equal(dropped.exams,undefined,'跨学期一律丢弃，避免旧考试显示到新学期');
 assert.equal(withExamFallback(snapshotWith(null),null,null,{now:FETCHED,error:'format'}).exams,undefined);
});

test('examSummary：计数/时间/6小时新鲜度判定',()=>{
 const exams=normalized();
 const stamp=Date.now();
 const freshSummary=examSummary({...exams,fetchedAt:new Date(stamp).toISOString()});
 assert.equal(freshSummary.count,8);
 assert.equal(freshSummary.stale,false);
 const oldSummary=examSummary({...exams,fetchedAt:new Date(stamp-7*60*60*1000).toISOString()});
 assert.equal(oldSummary.stale,true);
 assert.equal(examSummary(null).count,0);
 assert.equal(examSummary(null).stale,true);
 assert.equal(examSummary({items:[],fetchedAt:'not-a-date'}).stale,true);
 assert.equal(EXAM_CACHE_TTL_MS,6*60*60*1000);
});

test('diffExamSnapshots：新增/改时间/换考场/取消生成与课表变更同形状事件',()=>{
 const before=normalized();
 const now='2026-12-01T00:00:00.000Z';
 const firstBatch=diffExamSnapshots({...before,items:[]},before,now);
 assert.equal(firstBatch.length,0,'首批数据不生成「新增」事件（P2-R2-4）');
 const addedSnapshot=JSON.parse(JSON.stringify(before));
 addedSnapshot.items.push({...before.items[7],id:'K009|场次A|2027-01-09|08:30',date:'2027-01-09',week:19,weekday:6});
 const added=diffExamSnapshots(before,addedSnapshot,now);
 assert.equal(added.length,1);
 assert.equal(added[0].type,'新增');
 assert(added.every(event=>event.source==='school'&&event.exam===true&&event.read===false&&event.notifiedAt===null));
 assert.equal(added[0].name,'课程H','新增场次沿用被复制行的课程名');
 assert.equal(added[0].date,'2027-01-09');
 const changed=JSON.parse(JSON.stringify(before));
 changed.items[0].room='考场B';
 changed.items[1].startTime='16:00';changed.items[1].endTime='17:25';
 const events=diffExamSnapshots(before,changed,now);
 assert.equal(events.length,2);
 assert.equal(events.find(event=>event.name==='课程A').type,'换考场');
 assert.equal(events.find(event=>event.name==='课程B').type,'改时间');
 assert.deepEqual(events.find(event=>event.name==='课程A').fields,['room']);
 const cancelled=JSON.parse(JSON.stringify(before));
 cancelled.items=cancelled.items.filter(item=>item.name!=='课程C');
 const cancelEvents=diffExamSnapshots(before,cancelled,now);
 assert.equal(cancelEvents.length,1);
 assert.equal(cancelEvents[0].type,'考试取消');
 assert.equal(cancelEvents[0].after,null);
 assert.equal(diffExamSnapshots(before,before,now).length,0);
 const lateSnapshot=JSON.parse(JSON.stringify(before));
 lateSnapshot.items[0].startTime='19:30';
 assert.equal(diffExamSnapshots(before,lateSnapshot,'2027-03-01T00:00:00.000Z').length,0,'过去场次不生成变更事件');
 assert.equal(diffExamSnapshots(null,before,now).length,0);
 assert.equal(diffExamSnapshots(before,{...before,semesterId:'other'},now).length,0);
});

test('JSON 合法但全部行被 skip：返回 error=format，避免空列表静默覆盖旧考试（P2-3）',()=>{
 const renamed=RAW.map(({kssj,...rest})=>({kssj2:kssj,...rest}));
 const exams=normalized(renamed);
 assert.equal(exams.error,'format');
 assert.deepEqual(exams.items,[]);
 assert.deepEqual(exams.skipped.map(item=>item.reason),Array(8).fill('time'));
 const empty=normalized([]);
 assert.equal(empty.error,null,'data 为空仍是合法的“暂无考试”');
 assert.deepEqual(empty.items,[]);
});

test('attachExamPayload：成功替换，失败保留旧数据并写 error/lastAttempt；无旧数据时仍挂可见失败（P2-1/P2-3）',()=>{
 const snapshot=snapshotWith(null);
 const previous=normalized();
 const stamp='2026-11-17T02:00:00.000Z';
 const success=attachExamPayload(snapshot,{exams:RAW,examFetchedAt:FETCHED},previous,{periodTimes:PERIOD_TIMES,now:stamp});
 assert.equal(success.exams.items.length,8);
 assert.equal(success.exams.error,null);
 assert.equal(success.exams.lastAttempt,stamp);
 const failed=attachExamPayload(snapshot,{examError:'http'},previous,{periodTimes:PERIOD_TIMES,now:stamp});
 assert.equal(failed.exams.items.length,8,'考试段失败保留旧数据');
 assert.equal(failed.exams.error,'http');
 assert.equal(failed.exams.lastAttempt,stamp);
 const skipped=attachExamPayload(snapshot,{exams:RAW.map(({kssj,...rest})=>({kssj2:kssj,...rest}))},previous,{periodTimes:PERIOD_TIMES,now:stamp});
 assert.equal(skipped.exams.items.length,8,'全部行无法解析时保留旧数据');
 assert.equal(skipped.exams.error,'format');
 const firstFailure=attachExamPayload(snapshot,{examError:'timeout'},undefined,{periodTimes:PERIOD_TIMES,now:stamp});
 assert.equal(firstFailure.exams.items.length,0,'首次读取即失败：只挂错误标记');
 assert.equal(firstFailure.exams.error,'timeout');
 const legacy=attachExamPayload(snapshot,{rows:[]},previous,{periodTimes:PERIOD_TIMES,now:stamp});
 assert.equal(legacy,snapshot,'旧原生版本不带 exams/examError 时保持快照引用不变');
 assert.equal(legacy.exams,undefined);
});

test('接线：app 使用 attachExamPayload，旧考试值传 state.snapshot.exams（P2-1）',()=>{
 const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
 assert.match(app,/attachExamPayload\([^;]*state\.snapshot\?\.exams/,'前台必须传旧 exams 对象');
 assert.doesNotMatch(app,/attachExams\(/,'旧的本地 attachExams 实现应已移除');
});

test('座位号单独变化：生成“换座位”事件且字段为 seat（P2-5）',()=>{
 const before=normalized();
 const now='2026-12-01T00:00:00.000Z';
 const seatChanged=JSON.parse(JSON.stringify(before));
 seatChanged.items[0].seat='99';
 const events=diffExamSnapshots(before,seatChanged,now);
 assert.equal(events.length,1);
 assert.equal(events[0].type,'换座位');
 assert.deepEqual(events[0].fields,['seat']);
 assert.equal(events[0].before.seat,'11');
 assert.equal(events[0].after.seat,'99');
});

test('接线：变更记录 eventDiff 展示座位号前后值（P2-5）',()=>{
 const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
 const start=app.indexOf('function eventDiff('),end=app.indexOf('function ongoingTag(');
 assert(start>=0&&end>start);
 const fn=app.slice(start,end);
 assert.match(fn,/fields\.includes\('seat'\)\?'seat'/,'座位字段必须参与差异展示');
 assert.match(fn,/value\.seat/,'展示 seat 前后值');
 assert.match(fn,/'未安排座位'/,'空座位文案');
});

test('部分行解析失败：本次结果不完整，保留旧数据并写可见 error（P2-R2-3）',()=>{
 const previous=normalized();
 const snapshot=snapshotWith(previous);
 const partial=RAW.map((row,index)=>index===2?{...row,kssj:'bad-time'}:row);
 const fresh=normalized(partial);
 assert.equal(fresh.items.length,7);
 assert.equal(fresh.skipped.length,1);
 assert.equal(fresh.error,'format','任意行失败即视为不完整，不能静默用部分列表覆盖');
 const attached=attachExamPayload(snapshot,{exams:partial},previous,{periodTimes:PERIOD_TIMES,now:'2026-11-17T03:00:00.000Z'});
 assert.equal(attached.exams.items.length,8,'旧数据不能被部分列表覆盖');
 assert.equal(attached.exams.error,'format','失败必须在 snapshot.exams 可见');
 assert.equal(attached.exams.lastAttempt,'2026-11-17T03:00:00.000Z');
});

test('首次获得考试数据不生成「新增」变更事件，第二次变更才记录（P2-R2-4）',()=>{
 const first=normalized();
 const now='2026-12-01T00:00:00.000Z';
 assert.equal(diffExamSnapshots({semesterId:first.semesterId,semesterStartDate:first.semesterStartDate,items:[]},first,now).length,0,'首批数据不生成新增事件');
 assert.equal(diffExamSnapshots(undefined,first,now).length,0,'无基线不生成事件');
 const second=JSON.parse(JSON.stringify(first));
 second.items[0].room='考场B';
 const events=diffExamSnapshots(first,second,now);
 assert.equal(events.length,1);
 assert.equal(events[0].type,'换考场');
 const removed={...first,items:first.items.slice(1)};
 assert.equal(diffExamSnapshots(first,removed,now).length,1,'首次静默不能吞掉后续取消事件');
});

test('跳过分类：time/name/week 硬失败，period/duplicate 容忍（P2-R3-1）',()=>{
 assert.deepEqual(examSkipCounts([{reason:'time'},{reason:'period'},{reason:'period'},{reason:'name'},{reason:'duplicate'},{reason:'mystery'}]),{time:1,name:1,week:0,period:2,duplicate:1,other:1});
 assert.equal(examSkipsAreHard([]),false);
 assert.equal(examSkipsAreHard([{reason:'period'},{reason:'duplicate'}]),false,'容忍型跳过不算硬失败');
 assert.equal(examSkipsAreHard([{reason:'period'},{reason:'time'}]),true);
 assert.equal(examSkipsAreHard([{reason:'name'}]),true);
 assert.equal(examSkipsAreHard([{reason:'mystery'}]),true,'未知原因保守按硬失败');
});

test('容忍型跳过不阻塞更新：大量 period/duplicate 仍正常应用新数据（P2-R3-1）',()=>{
 const toleratedRows=[...RAW,{...RAW[2],kssj:'2027-01-04 21:20~22:00',kch:'K900'},{...RAW[2]}];
 const fresh=normalized(toleratedRows);
 assert.equal(fresh.error,null,'容忍型跳过不判失败');
 assert.equal(fresh.items.length,8);
 assert.deepEqual(fresh.skipped.map(item=>item.reason),['period','duplicate']);
 assert.deepEqual(fresh.skipCounts,{time:0,name:0,week:0,period:1,duplicate:1,other:0});
 const previous=normalized();
 const attached=attachExamPayload(snapshotWith(previous),{exams:toleratedRows,examFetchedAt:'2026-11-18T00:00:00.000Z'},previous,{periodTimes:PERIOD_TIMES,now:'2026-11-18T00:00:00.000Z'});
 assert.equal(attached.exams.error,null);
 assert.equal(attached.exams.fetchedAt,'2026-11-18T00:00:00.000Z','新数据已应用（不再永久 stale）');
 assert.equal(attached.exams.lastSkipped,null,'成功应用时不保留旧轮次 lastSkipped');
 assert.equal(attached.exams.skipped.length,2,'诊断保留本轮分类计数');
});

test('硬失败保留旧数据，并把本轮 skipped 写入 lastSkipped（P2-R3-2）',()=>{
 const previous=normalized();
 const hardRows=RAW.map((row,index)=>index===0?{...row,kssj:'bad-time'}:index===1?{...row,kskcmc:'   '}:row);
 const fresh=normalized(hardRows);
 assert.equal(fresh.items.length,6);
 assert.equal(fresh.error,'format');
 assert.deepEqual(fresh.skipped.map(item=>item.reason),['time','name']);
 const attached=attachExamPayload(snapshotWith(previous),{exams:hardRows},previous,{periodTimes:PERIOD_TIMES,now:'2026-11-18T01:00:00.000Z'});
 assert.equal(attached.exams.items.length,8,'硬失败保留旧数据');
 assert.equal(attached.exams.error,'format');
 assert.equal(attached.exams.lastAttempt,'2026-11-18T01:00:00.000Z');
 assert.deepEqual(attached.exams.lastSkipped.map(item=>item.reason),['time','name'],'本轮跳过写入 lastSkipped');
});

test('文案统一：schoolPanel 与 readFeedback 都使用「读取不完整或失败」（P2-R3-3）',()=>{
 const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
 assert(app.includes('考试安排读取不完整或失败'),'schoolPanel 无数据失败文案');
 assert(app.includes(' · 读取不完整或失败'),'schoolPanel 有数据失败文案');
 assert(!app.includes('上次读取失败'),'不再使用旧的“上次读取失败”措辞');
 assert(!app.includes('考试安排读取失败'),'不再使用旧的“考试安排读取失败”措辞');
});
