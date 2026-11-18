import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {mergeLeaveRecords,normalizeLeaveRecord,normalizeLeaveStatusCache,leaveMarkForCourse,leaveCancelState} from '../web/leave-status.mjs';

const app=await readFile(new URL('../web/app.mjs',import.meta.url),'utf8');

const leave=(id,extra={})=>normalizeLeaveRecord({id,type:'leave',status:'approved',statusText:'已通过',number:'L'+(extra.numberSuffix||'1'),
  startDate:'2026-10-21',startTime:'08:00',endDate:'2026-10-21',endTime:'09:55',...extra});
const renew=(id,extra={})=>normalizeLeaveRecord({id,type:'renew',status:'pending',statusText:'待审批',number:'L2',
  startDate:'2026-10-21',startTime:'10:15',endDate:'2026-10-21',endTime:'11:40',...extra});
const cancel=(id,extra={})=>normalizeLeaveRecord({id,type:'cancel',status:'approved',statusText:'已通过',number:'L1',...extra});

test('续假抓取失败（回包只有请假记录）时保留上次续假记录，请假按本次结果替换',()=>{
  const previous=[leave('leave-1'),renew('renew-1'),cancel('cancel-1')];
  const fresh=[leave('leave-1',{status:'rejected',statusText:'未通过'})];
  const merged=mergeLeaveRecords(previous,fresh);
  assert.deepEqual(merged.records.map(record=>record.id),['leave-1','renew-1','cancel-1'],'续假/销假旧记录保留，请假被本次结果替换');
  assert.equal(merged.retainedRenew,1,'续假保留必须可计数（供调用方写诊断）');
  assert.equal(merged.records[0],fresh[0],'请假取本次回包的对象（状态已更新为未通过）');
  assert.equal(merged.records[0].status,'rejected');
  assert.equal(merged.records[1],previous[1],'续假保留的是旧缓存对象，不复制不改编');
});

test('续假抓取成功时按本次结果整体替换旧续假记录',()=>{
  const previous=[renew('renew-1'),renew('renew-2')];
  const fresh=[leave('leave-9'),renew('renew-3')];
  const merged=mergeLeaveRecords(previous,fresh);
  assert.deepEqual(merged.records.map(record=>record.id),['leave-9','renew-3'],'本次带续假记录时旧续假一律不保留');
  assert.equal(merged.retainedRenew,0);
});

test('旧续假与请假/销假记录互不影响，重复 id 以本次结果为准',()=>{
  const previous=[leave('leave-1'),renew('renew-1'),cancel('cancel-1')];
  const fresh=[leave('leave-1',{reason:'事假'}),leave('leave-2')];
  const merged=mergeLeaveRecords(previous,fresh);
  assert.deepEqual(merged.records.map(record=>record.id),['leave-1','leave-2','renew-1','cancel-1']);
  assert.equal(merged.records[0].reason,'事假','重复 id 保留本次回包的请假记录');
  assert.equal(merged.records[2],previous[1],'续假与请假记录互不影响');
  assert.equal(merged.records[3],previous[2],'销假记录照旧保留（销假由独立刷新维护）');
  assert.equal(merged.retainedRenew,1);
});

test('续假保留后仍进入缓存归一与课程联动（旧记录与请假记录互不影响）',()=>{
  const previous=[leave('leave-1'),renew('renew-1')];
  const merged=mergeLeaveRecords(previous,[leave('leave-1')]).records;
  const cache=normalizeLeaveStatusCache({schemaVersion:1,provider:'school',semesterId:'2026-2027-1',fetchedAt:'2026-10-21T02:00:00.000Z',records:merged},'2026-2027-1');
  assert.deepEqual(cache.records.map(record=>record.id),['leave-1','renew-1'],'保留的续假记录要写入本机缓存');
  const overlapping={key:'2026-10-21/course',name:'课程',date:'2026-10-21',startTime:'10:30',endTime:'11:30'};
  const mark=leaveMarkForCourse(overlapping,cache.records);
  assert.equal(mark.status,'pending','保留的续假记录仍参与课程标记');
  assert.deepEqual(mark.records.map(record=>record.type),['renew']);
  assert.equal(leaveCancelState(cache.records.find(record=>record.type==='renew'),cache.records,{now:Date.parse('2026-10-22T00:00:00+08:00'),fresh:true}),null,'续假不参与销假关联');
});

test('边界：空/非数组合并不抛错、不修改入参；成功但 0 条续假记录时保守保留',()=>{
  assert.deepEqual(mergeLeaveRecords(null,undefined),{records:[],retainedRenew:0});
  assert.deepEqual(mergeLeaveRecords([],null),{records:[],retainedRenew:0});
  assert.deepEqual(mergeLeaveRecords(undefined,[null,42,leave('leave-1')]).records.map(record=>record.id),['leave-1'],'非对象项丢弃');
  const previous=[renew('renew-1')];
  const fresh=[];
  const merged=mergeLeaveRecords(previous,fresh);
  assert.deepEqual(merged.records.map(record=>record.id),['renew-1'],'回包 0 条续假记录与“续假抓取失败”在回包上不可区分，按保守口径保留（已知边界，见实现报告-A4-P2 §4）');
  assert.equal(merged.retainedRenew,1);
  assert.deepEqual(previous.map(record=>record.id),['renew-1'],'不修改旧缓存数组');
  assert.deepEqual(fresh,[]);
});

test('app.mjs 接线：refreshLeaveStatus 走 mergeLeaveRecords 并只写固定格式诊断（源码契约）',()=>{
  assert.ok(app.includes("import {normalizeLeaveStatusCache,mergeLeaveRecords,sampleLeaveRecords"),'leave-status 的 mergeLeaveRecords 必须被 app 引入');
  assert.ok(app.includes('const merged=mergeLeaveRecords(leaveView.records,records),mergedRecords=merged.records;'),'刷新合并必须走纯函数，不得保留内联的旧逻辑');
  assert.ok(!app.includes("(leaveView.records||[]).filter(item=>item.type==='cancel'"),'内联的只保留 cancel 旧记录逻辑必须移除');
  assert.ok(app.includes("if(merged.retainedRenew>0)console.debug('[trace] event=leave-renew-retained count='+merged.retainedRenew);"),'续假保留要写 [trace] 诊断（经 Android onConsoleMessage 落 applog）');
  const traceLine=app.split('\n').find(line=>line.includes('leave-renew-retained'));
  assert.ok(traceLine&&/count='\+merged\.retainedRenew/.test(traceLine),'诊断只带保留条数');
  const traceSegment=traceLine.slice(traceLine.indexOf('leave-renew-retained'),traceLine.indexOf(';',traceLine.indexOf('leave-renew-retained')));
  assert.ok(!/\.(id|number|reason|approver)\b/.test(traceSegment),'诊断不得带记录字段（无编号/原因等敏感信息）');
});

test('休假弹窗恢复区说明恢复标记保留语义（vm 回放 app.mjs 真实函数）',()=>{
  const slice=app.slice(app.indexOf('function holidayLabel(kind){'),app.indexOf('async function setHolidayRestore'));
  const holidayForDate=()=>null;
  const isRestoredDate=(settings,date)=>(settings.restoreDates||[]).includes(date);
  const ctx={displayState:()=>({snapshot:{closedDates:[]},holidaySettings:{days:[],restoreDates:[]}}),holidayForDate,isRestoredDate,weekday:()=>1,fmt:value=>String(value),console};
  vm.runInNewContext(slice+';globalThis.__restoreSection=holidayRestoreSection;',ctx);
  const html=ctx.__restoreSection({winter:null,summer:null,days:[],restoreDates:['2026-10-12']},'2026-10-12');
  assert.ok(html.includes('恢复标记会保留：取消休假后该日不再恢复上课（标记仍保留待用），再次休假或学校停课时自动重新生效。'),'休假弹窗必须说明恢复标记不会因取消休假被清理');
  assert.ok(html.includes('当前未被取消，恢复标记保留待用'),'既有列表状态文案保留');
  assert.ok(html.includes('取消恢复'),'既有取消恢复入口保留');
});
