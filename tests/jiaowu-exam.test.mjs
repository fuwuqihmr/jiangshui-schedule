import test from 'node:test';
import assert from 'node:assert/strict';
import {EXAM_CACHE_TTL_MS,parseExamTime,timeToPeriods,normalizeExamList,examDay,withExamFallback,examSummary,diffExamSnapshots,weekOf,weekday} from '../web/jiaowu-exam.mjs';
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
 assert.equal(weekOf(SEMESTER.startDate,'2027-06-01'),40);
 assert.equal(weekday('2026-08-29'),6);
});

test('semesterStartDate 缺失时无法计算周次：按 week 原因跳过而不是造假',()=>{
 const exams=normalizeExamList(payload(RAW),{semesterId:SEMESTER.id,semesterStartDate:undefined,totalWeeks:25,periodTimes:PERIOD_TIMES,fetchedAt:FETCHED});
 assert.equal(exams.items.length,0);
 assert.deepEqual(exams.skipped.map(item=>item.reason),Array(8).fill('week'));
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
 const added=diffExamSnapshots({...before,items:[]},before,now);
 assert.equal(added.length,8);
 assert(added.every(event=>event.type==='新增'&&event.source==='school'&&event.exam===true&&event.read===false&&event.notifiedAt===null));
 assert.equal(added[0].name,'课程A');
 assert.equal(added[0].date,'2026-12-21');
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
