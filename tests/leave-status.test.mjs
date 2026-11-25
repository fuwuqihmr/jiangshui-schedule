import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,addDays,timetableDay} from '../web/core.mjs';
import {saveCustomCourse} from '../web/custom-courses.mjs';
import {
 statusFromRaw,leaveStatusLabel,leaveTypeLabel,normalizeLeaveRecord,normalizeLeaveRecords,
 emptyLeaveStatus,normalizeLeaveStatusCache,leaveStatusSummary,leaveInterval,courseInterval,
 overlapsCourse,leaveMarkForCourse,matchLeaveMarks,leaveRecordsForDate,sortLeaveRecords,
 sampleLeaveRecords,sampleLeaveRecordsProvider,getLeaveRecordsProvider
} from '../web/leave-status.mjs';

const START='2026-08-31';
const base=(rules=[],extra={})=>({schemaVersion:1,semester:{id:'test-term',name:'测试学期',startDate:START,weeks:8},rules,exceptions:[],remaps:[],closedDates:[],unscheduled:[],...extra});
const rule=(id,extra={})=>({id,name:'课程'+id,teacher:'老师',room:'A101',weekday:2,weeks:[8],periods:[1,2],startTime:'08:30',endTime:'09:55',...extra});
const record=(extra={})=>({id:'leave-1',type:'leave',status:'approved',startDate:'2026-10-20',startTime:'08:00',endDate:'2026-10-20',endTime:'10:30',...extra});
const course=(extra={})=>({key:'c1',name:'课程',date:'2026-10-20',startTime:'08:30',endTime:'09:55',...extra});

test('时间交集：完全覆盖、部分重叠、首尾相接不算、跨天按真实区间',()=>{
 assert.equal(overlapsCourse(record(),course()),true,'完全覆盖');
 assert.equal(overlapsCourse(record({startTime:'09:30'}),course()),true,'部分重叠');
 assert.equal(overlapsCourse(record({startTime:'09:55'}),course()),false,'首尾相接（后）不算');
 assert.equal(overlapsCourse(record({startTime:'07:00',endTime:'08:30'}),course()),false,'首尾相接（前）不算');
 assert.equal(overlapsCourse(record({startTime:'09:54'}),course()),true,'结束前 1 分钟仍重叠');
 const cross=record({startDate:'2026-10-20',startTime:'22:00',endDate:'2026-10-21',endTime:'08:00'});
 assert.equal(overlapsCourse(cross,course({date:'2026-10-20',startTime:'21:00',endTime:'23:00'})),true,'跨天覆盖首日');
 assert.equal(overlapsCourse(cross,course({date:'2026-10-21',startTime:'07:00',endTime:'08:00'})),true,'跨天覆盖次日凌晨');
 assert.equal(overlapsCourse(cross,course({date:'2026-10-21',startTime:'08:30',endTime:'09:55'})),false,'跨天区间结束后不重叠');
 assert.equal(overlapsCourse(record({startDate:'2026-10-20',endDate:'2026-10-20'}),course({date:'2026-10-21'})),false,'不同日期');
 assert.equal(overlapsCourse(record({startTime:'10:00',endTime:'08:00'}),course()),false,'结束早于开始为非法');
});

test('按天筛选：跨天假条落在两天，首尾相接边界不算',()=>{
 const records=[record(),record({id:'late',startTime:'22:00',endDate:'2026-10-21',endTime:'08:00'})];
 assert.deepEqual(leaveRecordsForDate(records,'2026-10-19'),[]);
 assert.deepEqual(leaveRecordsForDate(records,'2026-10-20').map(r=>r.id),['leave-1','late']);
 assert.deepEqual(leaveRecordsForDate(records,'2026-10-21').map(r=>r.id),['late']);
 assert.deepEqual(leaveRecordsForDate(records,'2026-10-22'),[]);
 assert.deepEqual(leaveRecordsForDate(records,'not-a-date'),[]);
});

test('状态映射：已批准/待审批/驳回/未知与标签',()=>{
 const approved=['approved','已通过','审批通过','已批准','已批','通过','同意','已完成'];
 const pending=['pending','待审批','审批中','待审核','审核中','处理中','已提交'];
 const rejected=['rejected','未通过','驳回','不通过','拒绝','不同意'];
 for(const raw of approved)assert.equal(statusFromRaw(raw),'approved',String(raw));
 for(const raw of pending)assert.equal(statusFromRaw(raw),'pending',String(raw));
 for(const raw of rejected)assert.equal(statusFromRaw(raw),'rejected',String(raw));
 for(const raw of ['unknown','',null,undefined,'其他状态'])assert.equal(statusFromRaw(raw),'unknown',String(raw));
 assert.equal(statusFromRaw('未通过'),'rejected','“未通过”不得误判为通过');
 assert.equal(leaveStatusLabel('approved'),'已批准');assert.equal(leaveStatusLabel('pending'),'待审批');
 assert.equal(leaveStatusLabel('rejected'),'已驳回');assert.equal(leaveStatusLabel('unknown'),'状态未知');
 assert.equal(leaveTypeLabel('leave'),'请假');assert.equal(leaveTypeLabel('cancel'),'销假');assert.equal(leaveTypeLabel('renew'),'续假');
});

test('课程标记：已批灰划线语义、待审批不划线、驳回/未知/销假/停课/晚自习不标记',()=>{
 const approved=normalizeLeaveRecord(record({id:'a'}));
 const pending=normalizeLeaveRecord(record({id:'p',status:'待审批'}));
 const rejected=normalizeLeaveRecord(record({id:'r',status:'未通过'}));
 const unknown=normalizeLeaveRecord(record({id:'u',status:'未知状态'}));
 const cancel=normalizeLeaveRecord(record({id:'c',type:'cancel'}));
 assert.equal(leaveMarkForCourse(course(),[approved]).status,'approved');
 assert.equal(leaveMarkForCourse(course(),[pending]).status,'pending');
 assert.equal(leaveMarkForCourse(course(),[rejected]),null);
 assert.equal(leaveMarkForCourse(course(),[unknown]),null);
 assert.equal(leaveMarkForCourse(course(),[cancel]),null);
 assert.equal(leaveMarkForCourse(course({cancelled:true}),[approved]),null);
 assert.equal(leaveMarkForCourse(course({vacant:true}),[approved]),null);
 assert.equal(leaveMarkForCourse(course({localActivity:true}),[approved]),null);
 const renew=normalizeLeaveRecord(record({id:'n',type:'renew',status:'待审批'}));
 assert.equal(leaveMarkForCourse(course(),[renew]).status,'pending','续假也应参与联动');
});

test('多张假条：approved 优先 pending；同课记录合并计数',()=>{
 const approved=normalizeLeaveRecord(record({id:'a'}));
 const pending=normalizeLeaveRecord(record({id:'p',status:'待审批',startTime:'09:00'}));
 const mark=leaveMarkForCourse(course(),[pending,approved]);
 assert.equal(mark.status,'approved');assert.equal(mark.approvedCount,1);assert.equal(mark.pendingCount,1);
 assert.equal(mark.records.length,2);
 const marks=matchLeaveMarks([course(),course({key:'c2',startTime:'10:45',endTime:'11:40'})],[pending,approved]);
 assert.equal(marks.size,1);assert(marks.has('c1'),'只标记有交集的课程');
 assert.equal(matchLeaveMarks([],[approved]).size,0);
});

test('调休与自定义课程：按最终生效课表的时间/日期联动',()=>{
 let state=createState(base([rule('a')]));
 state.localMaps=[{id:'move',date:'2026-10-21',fromDate:'2026-10-20',mode:'replace'}];
 const moved=timetableDay(state.snapshot,'2026-10-21',state.overrides,state.localMaps,state.courseSettings,state.customCourses,state.holidaySettings);
 assert.equal(moved.length,1);
 const movedLeave=normalizeLeaveRecord(record({startDate:'2026-10-21',endDate:'2026-10-21'}));
 assert.equal(leaveMarkForCourse(moved[0],[movedLeave]).status,'approved','调休到 10-21 的课要能被 10-21 的假条命中');
 const originalDay=timetableDay(state.snapshot,'2026-10-20',state.overrides,state.localMaps,state.courseSettings,state.customCourses,state.holidaySettings);
 assert(originalDay.every(row=>row.vacant),'被调走的原日期只剩灰色空位');
 assert.equal(leaveMarkForCourse(originalDay[0],normalizeLeaveRecord(record())),null,'灰色空位不标记');
 let custom=createState(base([]));
 custom=saveCustomCourse(custom,{mode:'once',date:'2026-10-20',name:'自定义加课',startTime:'12:20',endTime:'13:00',room:'B1',teacher:'王'});
 const customRows=timetableDay(custom.snapshot,'2026-10-20',custom.overrides,custom.localMaps,custom.courseSettings,custom.customCourses,custom.holidaySettings);
 assert.equal(customRows.length,1);
 const selfRecord=normalizeLeaveRecord(record({startTime:'12:00',endTime:'13:30'}));
 assert.equal(leaveMarkForCourse(customRows[0],[selfRecord]).status,'approved','自定义课程参与联动');
});

test('示例数据：基于指定日期最终课表生成、至少命中一节课、全部带 demo 标记',()=>{
 const state=createState(base([
  rule('mon',{name:'早课',weekday:2,startTime:'08:30',endTime:'09:55',periods:[1,2]}),
  rule('next',{name:'第二门',weekday:2,startTime:'10:15',endTime:'11:40',periods:[3,4]}),
  rule('third',{name:'第三门',weekday:2,startTime:'14:00',endTime:'15:25',periods:[5,6]})
 ]));
 const records=sampleLeaveRecords(state,'2026-10-20');
 assert(records.length>=3,'应生成已批/待审批/驳回示例');
 assert(records.every(item=>item.demo===true),'示例记录必须带 demo 标记');
 assert(records.every(item=>item.semesterId==='test-term'));
 const approved=records.find(item=>item.status==='approved'&&item.type==='leave');
 const pending=records.find(item=>item.status==='pending');
 assert(approved&&pending,'必须有已批准与待审批示例');
 const courses=timetableDay(state.snapshot,'2026-10-20',state.overrides,state.localMaps,state.courseSettings,state.customCourses,state.holidaySettings);
 assert(overlapsCourse(approved,courses[0]),'已批准示例必须命中第一门课');
 const marks=matchLeaveMarks(courses,records);
 assert(marks.size>=2,'至少两门课被示例假条标记');
 assert.equal(marks.get(courses[0].key).status,'approved');
 assert.equal(marks.get(courses[1].key).status,'pending','第二门课为待审批（不划线）');
 assert.deepEqual(sampleLeaveRecords(createState(base([])),'2026-10-20'),[],'无课程时返回空');
 assert.deepEqual(sampleLeaveRecords(state,'2026-10-20'),sampleLeaveRecords(state,'2026-10-20'),'示例数据需稳定');
});

test('示例 provider：source=sample、fetchedAt 有效、可取消、school provider 明确不可用',async()=>{
 const state=createState(base([1,2,3,4,5,6,7].map(weekday=>rule('w'+weekday,{weekday,weeks:[1,2,3,4,5,6,7,8]}))));
 const provider=getLeaveRecordsProvider();
 assert.equal(provider.id,'sample');
 const result=await provider.list({state,now:Date.parse('2026-10-20T10:00:00+08:00')});
 assert.equal(result.source,'sample');assert(result.records.length>0);assert(result.records.every(item=>item.demo));
 assert.equal(result.fetchedAt,new Date(Date.parse('2026-10-20T10:00:00+08:00')).toISOString());
 assert.equal(sampleLeaveRecordsProvider.id,'sample');
 const controller=new AbortController();controller.abort();
 await assert.rejects(provider.list({state,signal:controller.signal}),/读取已取消/);
 await assert.rejects(getLeaveRecordsProvider('school').list(),/学校假条数据尚未接入/);
});

test('缓存迁移：旧裸数组/旧 state 无 leaveStatus/坏数据/旧学期都不崩',()=>{
 assert.deepEqual(normalizeLeaveStatusCache(undefined,'term'),emptyLeaveStatus('term'));
 assert.deepEqual(normalizeLeaveStatusCache(null,'term').records,[]);
 const bare=normalizeLeaveStatusCache([record()],'term');
 assert.equal(bare.records.length,1);assert.equal(bare.records[0].id,'leave-1');
 const withDemo=normalizeLeaveStatusCache({schemaVersion:1,provider:'sample',semesterId:'term',records:[record(),record({id:'demo',demo:true})]},'term');
 assert.deepEqual(withDemo.records.map(item=>item.id),['leave-1'],'示例记录不得写入缓存');
 assert.equal(withDemo.provider,null,'示例 provider 不得存回学校缓存');
 assert.deepEqual(normalizeLeaveStatusCache({semesterId:'other',records:[record()]},'term').records,[],'旧学期缓存清空');
 const dirty=normalizeLeaveStatusCache({records:[record(),record({id:'leave-1'}),null,{id:''},record({id:'bad',type:'x'}),record({id:'bad2',startDate:'2026-02-30'})]},'term');
 assert.deepEqual(dirty.records.map(item=>item.id),['leave-1'],'重复与非法记录被跳过');
 assert(dirty.skipped>=4);
 const state=createState(base([]));
 state.leaveStatus=undefined;
 assert.deepEqual(normalizeLeaveStatusCache(state.leaveStatus,state.snapshot.semester.id).records,[],'旧 state 直接迁移不崩');
});

test('排序与汇总：approved→pending→rejected→unknown，再按开始时间',()=>{
 const list=[record({id:'u',status:'unknown'}),record({id:'r',status:'rejected'}),record({id:'p',status:'pending',startTime:'09:00'}),record({id:'a',status:'approved'})];
 assert.deepEqual(sortLeaveRecords(list).map(item=>item.id),['a','p','r','u']);
 const summary=leaveStatusSummary(list);
 assert.deepEqual(summary,{approved:1,pending:1,rejected:1,unknown:1,total:4});
 assert.deepEqual(leaveStatusSummary([]),{approved:0,pending:0,rejected:0,unknown:0,total:0});
});
