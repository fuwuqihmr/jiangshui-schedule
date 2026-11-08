import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  normalizeLeaveRecord,normalizeLeaveRecords,normalizeLeaveStatusCache,
  createSchoolRecordsProvider,leaveCancelState,leaveMarkForCourse,schoolLeaveErrorMessage
} from '../web/leave-status.mjs';

const state={snapshot:{semester:{id:'term'}}};
const leaveRecord=(extra={})=>normalizeLeaveRecord({
  id:'leave-1',type:'leave',status:'approved',number:'L1',
  startDate:'2026-10-01',startTime:'08:00',endDate:'2026-10-01',endTime:'09:00',...extra
});
const cancelRecord=(id,status,number='L1',extra={})=>normalizeLeaveRecord({
  id,type:'cancel',status,number,...extra
});

test('销假记录缺区间仍保留；请假记录缺区间仍跳过',()=>{
  const cancel=normalizeLeaveRecord({id:'cancel-1',type:'cancel',status:'approved',number:'L1',reason:'已批准'});
  assert(cancel,'缺区间的销假记录不得被丢弃');
  assert.equal(cancel.type,'cancel');
  assert.equal(cancel.number,'L1');
  assert.equal(cancel.startDate,'');
  assert.equal(cancel.startTime,'');
  assert.equal(cancel.endDate,'');
  assert.equal(cancel.endTime,'');
  assert.equal(normalizeLeaveRecord({id:'leave-1',type:'leave',status:'approved'}),null,'请假记录仍需完整区间');
  const batch=normalizeLeaveRecords([cancel,{id:'leave-2',type:'leave',status:'approved'}],{semesterId:'term'});
  assert.deepEqual(batch.records.map(item=>item.id),['cancel-1']);
  assert.equal(batch.skipped,1);
});

test('学校 provider：type=cancel 与 number 透传，缺区间不丢',async()=>{
  const provider=createSchoolRecordsProvider({request:async()=>({ok:true,fetchedAt:1729400000000,records:[
    {id:'cancel-1',type:'cancel',number:'L1',statusText:'已通过',statusId:'2',submittedAt:'2026-10-02T10:00:00Z'}
  ]})});
  const out=await provider.list({state});
  assert.equal(out.records.length,1);
  assert.equal(out.records[0].type,'cancel');
  assert.equal(out.records[0].number,'L1');
  assert.equal(out.records[0].status,'approved');
  assert.equal(out.records[0].startDate,'');
  assert.equal(schoolLeaveErrorMessage('NEED_CANCEL_SESSION'),'请先在销假服务里打开一次销假页面');
});

test('销假缺 pageEnc：provider 返回 NEED_CANCEL_SESSION，文案明确',async()=>{
  const provider=createSchoolRecordsProvider({request:async()=>({ok:false,code:'NEED_CANCEL_SESSION'})});
  await assert.rejects(()=>provider.list({state}),error=>error.code==='NEED_CANCEL_SESSION'&&error.message==='请先在销假服务里打开一次销假页面');
});

test('销假关联矩阵：编号、已通过优先、待审批不亮红、过期未销假、旧缓存不推断',()=>{
  const leave=leaveRecord();
  const now=Date.parse('2026-10-02T00:00:00+08:00');
  const approved=cancelRecord('cancel-approved','approved');
  const pending=cancelRecord('cancel-pending','pending');
  assert.equal(leaveCancelState(leave,[approved],{now,fresh:true}).state,'cancelled');
  assert.equal(leaveCancelState(leave,[approved],{now,fresh:false}).state,'cancelled','已有已通过销假可继续展示');
  assert.equal(leaveCancelState(leave,[pending],{now,fresh:true}).state,'canceling');
  assert.equal(leaveCancelState(leave,[],{now,fresh:true}).state,'needs-cancel');
  assert.equal(leaveCancelState(leave,[],{now,fresh:false}).state,'unknown','没有销假数据时不得推断未销假');
  assert.equal(leaveCancelState(leave,[cancelRecord('other','approved','L2')],{now,fresh:true}).state,'needs-cancel','只按请假编号关联');
  assert.equal(leaveCancelState(leave,[cancelRecord('rejected','rejected')],{now,fresh:true}).state,'needs-cancel','驳回不算已销假');
  assert.equal(leaveCancelState(leave,[],{now:Date.parse('2026-09-30T00:00:00+08:00'),fresh:true}),null,'未过期且无销假记录不提示');
  assert.equal(leaveCancelState(leaveRecord({number:''}),[],{now,fresh:true}).state,'unknown','缺编号不能猜测关联');
});

test('销假记录不参与请假标记',()=>{
  const course={key:'c1',date:'2026-10-01',startTime:'08:30',endTime:'08:50'};
  assert.equal(leaveMarkForCourse(course,[cancelRecord('cancel-1','approved')]),null);
});

test('200 条缓存上限覆盖销假记录',()=>{
  const records=[];
  for(let i=0;i<220;i++)records.push({id:'leave-'+String(i).padStart(3,'0'),type:'leave',status:'approved',number:'L'+i,startDate:'2026-10-01',startTime:'08:00',endDate:'2026-10-01',endTime:'09:00'});
  for(let i=0;i<30;i++)records.push({id:'cancel-'+String(i).padStart(3,'0'),type:'cancel',status:'approved',number:'L'+i,startDate:'2026-11-01',startTime:'08:00',endDate:'2026-11-01',endTime:'09:00'});
  const cached=normalizeLeaveStatusCache({schemaVersion:1,provider:'school',semesterId:'term',records},'term');
  assert.equal(cached.records.length,200);
  assert.equal(cached.records.filter(record=>record.type==='cancel').length,30);
});

test('接线与缺 pageEnc 错误码：每次启动同步、取消入口、共用管线、销假按钮',()=>{
  const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
  const java=readFileSync(new URL('../android/app/src/main/java/cn/local/tomorrow/MainActivity.java',import.meta.url),'utf8');
  assert.match(app,/if\(!sampleState\)void refreshLeaveStatus\(\{reason:'startup'\}\);/);
  assert.doesNotMatch(app,/if\(!sampleState&&!leaveView\.records\.length\)/);
  assert.match(app,/const cancelRecordsProvider=createSchoolRecordsProvider\(\{request:payload=>call\('cancelRecordSync',payload\)\}\);/);
  assert.match(app,/async function refreshCancelStatus\(/);
  assert.match(app,/leaveCancelState\(record,leaveView\.records,\{fresh:leaveView\.cancelFresh===true\}\)/);
  assert.match(app,/data-action="leave-open" data-leave-key="cancel"/);
  assert.match(java,/static final String CANCEL_FORM_ID="278615";/);
  assert.match(java,/JSONObject fetchFormRecords\(String formId,String prefsFormId,String type\)/);
  assert.match(java,/JSONObject fetchCancelRecords\(\)/);
  assert.match(java,/case "cancelRecordSync":beginCancelRecordSync\(id\);break;/);
  assert.match(java,/NEED_CANCEL_SESSION/);
});
