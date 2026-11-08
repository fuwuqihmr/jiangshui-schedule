import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  statusFromRaw,statusFromSchool,normalizeLeaveRecord,leaveCancelState,shouldRefreshCancelAfterLeave
} from '../web/leave-status.mjs';

const leave=(extra={})=>({id:'leave-1',type:'leave',status:'approved',statusText:'已通过',number:'L1',
  startDate:'2026-10-01',startTime:'08:00',endDate:'2026-10-01',endTime:'09:00',semesterId:'term',...extra});
const cancel=(extra={})=>({id:'cancel-1',type:'cancel',status:'approved',statusText:'已通过',number:'L1',...extra});

test('状态归一表驱动：未通过/不通过/未批准/未同意/未审核通过都不得命中通过',()=>{
  const cases=[
    ['未通过','rejected'],['不通过','rejected'],['未批准','rejected'],['未同意','rejected'],
    ['未审核通过','rejected'],['已通过','approved'],['审批通过','approved'],['待审批','pending'],
    ['审批中','pending'],['驳回','rejected'],['退回修改','rejected'],['未知状态','unknown'],[null,'unknown']
  ];
  for(const [text,expected] of cases)assert.equal(statusFromRaw(text),expected,String(text));
});

test('学校状态只信文本：空文本 + statusId=2 不再推断已通过',()=>{
  assert.equal(statusFromSchool('','2'),'unknown');
  assert.equal(statusFromSchool(null,'2'),'unknown');
  assert.equal(statusFromSchool('未通过','2'),'rejected');
  assert.equal(statusFromSchool('已通过','2'),'approved');
  assert.equal(statusFromSchool('待审批','2'),'pending');
});

test('normalizeLeaveRecord：原生 approved 与文本冲突时取保守值',()=>{
  const rejected=normalizeLeaveRecord(leave({statusText:'未通过'}));
  assert.equal(rejected.status,'rejected','文本未通过必须覆盖原生 approved');
  const approved=normalizeLeaveRecord(leave({statusText:'已通过'}));
  assert.equal(approved.status,'approved');
  const missing=normalizeLeaveRecord(leave({statusText:''}));
  assert.equal(missing.status,'unknown','原生文本缺失时不得单独信 status');
});

test('销假关联矩阵：已通过/待审批/无记录/过期/数据不新鲜/字段缺失',()=>{
  const now=Date.parse('2026-10-02T12:00:00+08:00');
  const approved=normalizeLeaveRecord(leave());
  assert.equal(leaveCancelState(approved,[normalizeLeaveRecord(cancel())],{now,fresh:true}).state,'cancelled');
  assert.equal(leaveCancelState(approved,[normalizeLeaveRecord(cancel({status:'pending',statusText:'待审批'}))],{now,fresh:true}).state,'canceling');
  assert.equal(leaveCancelState(approved,[],{now,fresh:true}).state,'needs-cancel');
  assert.equal(leaveCancelState(approved,[],{now,fresh:false}).state,'unknown','不新鲜时不得推断未销假');
  assert.equal(leaveCancelState(approved,[normalizeLeaveRecord(cancel({number:'L2'}))],{now,fresh:true}).state,'needs-cancel','只按编号关联');
  assert.equal(leaveCancelState(approved,[normalizeLeaveRecord(cancel({status:'rejected',statusText:'已驳回'}))],{now,fresh:true}).state,'needs-cancel','驳回不算已销假');
  const missingNumber=normalizeLeaveRecord(leave({number:''}));
  assert.equal(leaveCancelState(missingNumber,[],{now,fresh:true}).state,'unknown','缺编号不得猜测关联');
  const notExpired=normalizeLeaveRecord(leave({startDate:'2026-10-20',endDate:'2026-10-20',startTime:'08:00',endTime:'09:00'}));
  assert.equal(leaveCancelState(notExpired,[],{now,fresh:true}),null,'未过期且无销假记录不提示');
});

test('after-leave 刷新闸门与销假接线静态断言',()=>{
  const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
  const java=readFileSync(new URL('../android/app/src/main/java/cn/local/tomorrow/MainActivity.java',import.meta.url),'utf8');
  assert.equal(shouldRefreshCancelAfterLeave(3,3,false),true);
  assert.equal(shouldRefreshCancelAfterLeave(2,3,false),false,'请假同步换代后不得用旧响应刷新销假');
  assert.equal(shouldRefreshCancelAfterLeave(3,3,true),false,'示例模式不请求学校销假');
  assert.match(app,/if\(shouldRefreshCancelAfterLeave\(epoch,leaveEpoch,sampleState\)\)void refreshCancelStatus\(\{reason:'after-leave'\}\);/);
  assert.match(app,/const cancelRecordsProvider=createSchoolRecordsProvider\(\{request:payload=>call\('cancelRecordSync',payload\)\}\);/);
  assert.match(java,/static final String CANCEL_FORM_ID="278615";/);
  assert.match(java,/fetchFormRecords\(CANCEL_FORM_ID,CANCEL_FORM_ID,"cancel"\)/,'销假必须换 formId=278615 复用同一抓取管线');
  assert.match(java,/case "cancelRecordSync":beginCancelRecordSync\(id\);break;/);
});
