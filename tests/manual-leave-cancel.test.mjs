import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  normalizeLeaveRecord,leaveCancelState,leaveStatusSummary,normalizeManualCancelMarks,
  manualCancelMark,markManualCancel,unmarkManualCancel,manualCancelDateLabel,applyManualCancel,CANCEL_COPY
} from '../web/leave-status.mjs';
import {customCourseBackup} from '../web/custom-courses.mjs';

const now=Date.parse('2026-10-02T00:00:00+08:00');
const leaveRecord=(extra={})=>normalizeLeaveRecord({
  id:'leave-1',type:'leave',status:'approved',number:'L1',
  startDate:'2026-10-01',startTime:'08:00',endDate:'2026-10-01',endTime:'09:00',...extra
});
const cancelRecord=(id,status,number='L1')=>normalizeLeaveRecord({id,type:'cancel',status,number});

test('手动销假标记：规范化、按编号幂等、可撤销、坏时间不写入',()=>{
  const empty=normalizeManualCancelMarks(null);
  assert.deepEqual(empty,{schemaVersion:1,marks:[]});
  assert.deepEqual(normalizeManualCancelMarks([{number:'  L1  ',markedAt:'2026-11-02T16:30:00+08:00'},{number:'L1',markedAt:'2026-11-03T00:00:00+08:00'},{number:'',markedAt:'2026-11-03T00:00:00+08:00'},{number:'L2',markedAt:'bad'}]).marks,[{number:'L1',markedAt:'2026-11-02T08:30:00.000Z'}]);
  const first=markManualCancel(empty,' L1 ','2026-11-02T16:30:00+08:00');
  assert.deepEqual(first.marks,[{number:'L1',markedAt:'2026-11-02T08:30:00.000Z'}]);
  const again=markManualCancel(first,'L1','2026-11-09T00:00:00+08:00');
  assert.equal(again.marks[0].markedAt,'2026-11-02T08:30:00.000Z','同编号重复标记必须幂等');
  assert.deepEqual(markManualCancel(first,'L9','bad').marks,first.marks,'坏时间不得写入');
  assert.equal(manualCancelMark(first,' L1 ').number,'L1');
  assert.equal(manualCancelMark(first,'L9'),null);
  assert.deepEqual(unmarkManualCancel(first,'L1').marks,[]);
  assert.deepEqual(unmarkManualCancel(first,'L9').marks,first.marks,'撤销不存在的标记不抛错');
});

test('手动销假与学校状态合并：已通过→系统已确认、待审批优先、手动不亮红',()=>{
  const leave=leaveRecord();
  const base=leaveCancelState(leave,[],{now,fresh:true});
  const marks=markManualCancel(null,'L1','2026-11-02T16:30:00+08:00');
  const manual=applyManualCancel(base,leave,marks);
  assert.equal(manual.state,'manual');
  assert.equal(manual.label,CANCEL_COPY.manual);
  assert.equal(manual.canCancel,false,'手动标记后不能再亮红“销假”');
  assert.equal(manual.manual,true);
  assert.equal(manual.markedAt,'2026-11-02T08:30:00.000Z');
  assert.equal(applyManualCancel(base,leave,null).state,'needs-cancel','没有本机标记时保持待销假');
  const approved=leaveCancelState(leave,[cancelRecord('cancel-approved','approved')],{now,fresh:true});
  assert.equal(applyManualCancel(approved,leave,marks).state,'confirmed');
  assert.equal(applyManualCancel(approved,leave,marks).label,CANCEL_COPY.confirmed);
  assert.equal(applyManualCancel(approved,leave,marks).manual,true,'学校确认后仍保留本机标记，便于撤销');
  assert.equal(applyManualCancel(approved,leave,null).state,'cancelled');
  const pending=leaveCancelState(leave,[cancelRecord('cancel-pending','pending')],{now,fresh:true});
  assert.equal(applyManualCancel(pending,leave,marks).state,'canceling','学校待审批优先于本机手动');
  assert.equal(applyManualCancel(null,leave,marks),null,'未到销假时间的假条不因本机标记而出现状态');
  assert.equal(applyManualCancel(base,leaveRecord({status:'pending'}),marks),base,'非已通过请假不套用手动销假');
});

test('孤儿标记保留但不影响列表统计；按编号关联不串号',()=>{
  const leave=leaveRecord();
  const marks=markManualCancel(null,'GONE','2026-11-02T16:30:00+08:00');
  const base=leaveCancelState(leave,[],{now,fresh:true});
  assert.doesNotThrow(()=>applyManualCancel(base,leave,marks));
  assert.equal(applyManualCancel(base,leave,marks).state,'needs-cancel');
  assert.equal(marks.marks.length,1,'孤儿标记必须保留，不能静默删除');
  assert.equal(leaveStatusSummary([leave]).total,1);
  assert.equal(applyManualCancel(base,leaveRecord({number:'L2'}),marks).state,'needs-cancel','只按请假编号关联');
});

test('手动标记日期用本地 markedAt，不冒充学校时间',()=>{
  assert.equal(manualCancelDateLabel('2026-11-02T16:30:00.000Z'),'2026-11-03');
  assert.equal(manualCancelDateLabel('2026-11-02T15:59:59.000Z'),'2026-11-02');
  assert.equal(manualCancelDateLabel('bad'),'');
});

test('导出快照字段白名单包含手动销假标记；导入会剥离并合并',()=>{
  const marks=markManualCancel(null,'L1','2026-11-02T16:30:00+08:00');
  const backup=customCourseBackup({snapshot:{semester:{id:'term'}},customCourses:[],manualLeaveCancels:marks});
  assert.deepEqual(backup.manualLeaveCancels,marks);
  assert.deepEqual(customCourseBackup({snapshot:{semester:{id:'term'}}}).manualLeaveCancels,{schemaVersion:1,marks:[]});
  const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
  const core=readFileSync(new URL('../web/core.mjs',import.meta.url),'utf8');
  assert.match(app,/delete source\.manualLeaveCancels/);
  assert.match(app,/normalizeManualCancelMarks\(manual\)/);
  assert.match(app,/manualCancelDateLabel\(cancel\.markedAt\)/);
  assert.match(app,/data-action="manual-cancel-confirm"/);
  assert.match(app,/data-action="manual-cancel-undo-confirm"/);
  assert.match(app,/leaveCancelFor\(record\)/);
  assert.match(core,/manualLeaveCancels:clone\(state\.manualLeaveCancels\|\|\{schemaVersion:1,marks:\[\]\}\)/);
});
