import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  createSchoolRecordsProvider,normalizeLeaveStatusCache,visibleLeaveRecords,leaveMarkForCourse,
  leaveCancelState
} from '../web/leave-status.mjs';
import {runNativeLeaveRenew} from './native-leave-renew-harness.mjs';

const root=new URL('../',import.meta.url);
const java=readFileSync(new URL('android/app/src/main/java/cn/local/tomorrow/MainActivity.java',root),'utf8');
const app=readFileSync(new URL('web/app.mjs',root),'utf8');
const state={snapshot:{semester:{id:'test-term'}}};

test('原生续假合并/降级：真实编译执行 MainActivity 的 mergeRenewRecords / renewFailureDiagnostic',()=>{
  const lines=runNativeLeaveRenew();
  assert.deepEqual(lines,['PASS merge-ok','PASS merge-dedupe','PASS merge-degrade','PASS merge-malformed','PASS diagnostic']);
});

test('三表单并列：278616/278615/278618 都走同一 fetchFormRecords 管线，pageEnc 按 formId 分键',()=>{
  assert.ok(java.includes('static final String LEAVE_FORM_ID="278616";\n    static final String CANCEL_FORM_ID="278615";\n    static final String RENEW_FORM_ID="278618";'),
    '278618 必须与请假/销假 formId 并列定义');
  assert.ok(java.includes('JSONObject fetchRenewRecords(){return fetchFormRecords(RENEW_FORM_ID,RENEW_FORM_ID,"renew");}'),
    '续假必须换 formId=278618 复用同一抓取管线');
  assert.match(java,/JSONObject fetchFormRecords\(String formId,String prefsFormId,String type\)/);
  assert.ok(java.includes('leave.pageEnc."+prefsFormId'),'pageEnc 缓存键按 formId 分键（leave.pageEnc.<formId>）');
  // 三个表单共用同一列表地址与同一组 body 参数，续假不得自造参数。
  const fetchBlock=/JSONObject fetchLeaveRecords\(\)\{([\s\S]*?)\n    \}/.exec(java)?.[1]||'';
  assert.ok(fetchBlock.length>0,'找不到 fetchLeaveRecords');
  for(const fragment of ['body.append("formId=").append(formId)','&formUserId=0&aprvAppId=','&pageEnc=','&cpage=1&pageSize=50&desensitization=&startTime=&endTime='])
    assert.ok(fetchBlock.includes(fragment),'表单参数缺失：'+fragment);
  assert.ok(fetchBlock.includes('new java.net.URL(LEAVE_LIST_URL)'),'必须复用同一 LIST_URL');
});

test('续假类型映射 renew + 缺会话错误码，与 web LEAVE_TYPES 对齐',()=>{
  assert.ok(java.includes('String sessionCode="cancel".equals(recordType)?"NEED_CANCEL_SESSION":("renew".equals(recordType)?"NEED_RENEW_SESSION":"NEED_SESSION");'),
    '续假缺 pageEnc 时必须返回独立错误码，不得复用 NEED_SESSION/NEED_CANCEL_SESSION');
  assert.ok(java.includes('record.put("type",recordType)'),'记录 type 由抓取上下文决定，续假记录必须为 renew');
  assert.ok(java.includes('fetchFormRecords(RENEW_FORM_ID,RENEW_FORM_ID,"renew")'));
  // 与 web 侧类型集合一致（web 未改动，不产生新类型）。
  assert.match(app,/createSchoolRecordsProvider\(\{request:payload=>call\('leaveRecordSync',payload\)\}\)/,'续假记录随 leaveRecordSync 回包，不新增 web 调用点');
});

test('降级：续假失败只记固定错误码诊断，请假/销假结果与取消路径保持不变',()=>{
  assert.ok(java.includes('try{response=cancel?fetchCancelRecords():fetchLeaveRecordsWithRenew();}'),
    '请假同步接续假合并，销假同步路径必须原样保留');
  assert.ok(java.includes('void beginCancelRecordSync(String id){beginLeaveRecordSync(id,true);}'),
    '销假入口不得改动');
  assert.ok(java.includes('JSONObject fetchCancelRecords(){return fetchFormRecords(CANCEL_FORM_ID,CANCEL_FORM_ID,"cancel");}'),
    '销假抓取不得改动');
  assert.ok(java.includes('renew=leaveSyncError("SKIPPED");'),'12 秒预算耗尽时不得拖垮请假主路径');
  assert.match(java,/String diagnostic=renewFailureDiagnostic\(renew\);\n        if\(diagnostic!=null\)log\(diagnostic\);\n        return mergeRenewRecords\(leave,renew\);/,
    '续假失败必须只落诊断并返回请假原结果');
  assert.ok(java.includes('return "leave-renew-sync failed code="+code;'));
  const block=/JSONObject fetchLeaveRecordsWithRenew\(\)\{([\s\S]*?)\n    \}/.exec(java)?.[1]||'';
  assert.ok(block.length>0,'找不到 fetchLeaveRecordsWithRenew');
  // 诊断日志只能出现固定错误码，不得打印 cookie/pageEnc/uid 等会话值。
  assert.doesNotMatch(block,/log\([^)]*(?:cookie|pageEnc|uid|Cookie|pageenc)/i,'诊断日志不得带会话凭据');
  assert.ok(block.includes('if(renewStarted)renewTask.cancel(true);'),'请假失败时必须取消续假等待');
  // 看门狗/单飞语义不变（既有 15 秒契约）。
  assert.match(java,/postDelayed\(leaveSyncWatchdog,15000\)/);
  assert.ok(java.includes('if(leaveSyncActive){failure(id,"正在同步假条，请稍候");return;}'));
  assert.ok(java.includes('leaveExecutor.shutdownNow();renewExecutor.shutdownNow();'),'新增的续假执行器必须随 Activity 销毁回收');
  // 不新增桥 action：续假记录随 leaveRecordSync 回包，web/app.mjs 不需要改。
  assert.equal((java.match(/case "leaveRecordSync":beginLeaveRecordSync\(id\);break;/g)||[]).length,1);
  assert.equal((java.match(/case "cancelRecordSync":beginCancelRecordSync\(id\);break;/g)||[]).length,1);
  assert.doesNotMatch(java,/case "renewRecordSync"/,'不得新增 web 侧未接线的桥 action');
});

test('续假表单字段标签兜底：请假/销假取值顺序不变，只追加续假别名',()=>{
  const expected=[
    'out.put("typeText",leaveFormValue(fields,"请假类型","销假类型","续假类型"));',
    'out.put("reason",leaveFormValue(fields,"请假原因","销假原因","续假原因","离校原因"));',
    'out.put("startAt",leaveIsoTime(leaveFormValue(fields,"请假开始时间","销假开始时间","续假开始时间","离校时间")));',
    'out.put("endAt",leaveIsoTime(leaveFormValue(fields,"请假结束时间","销假结束时间","续假结束时间","返校时间")));',
    'out.put("number",leaveFormValue(fields,"请假编号","销假编号","续假编号"));',
    'out.put("durationDays",leaveFormValue(fields,"请假时长","销假时长","续假时长"));',
    'String formValue=leaveFormValue(fields,"请假申请时间","销假申请时间","续假申请时间","申请时间");'
  ];
  for(const fragment of expected)assert.ok(java.includes(fragment),'字段兜底缺失：'+fragment);
  // 请假/销假既有标签必须排在最前，取值优先级不变。
  assert.ok(java.indexOf('"请假开始时间"')<java.indexOf('"续假开始时间"'));
  assert.ok(java.indexOf('"销假开始时间"')<java.indexOf('"续假开始时间"'));
});

// ---- web 侧数据契约：原生回包（请假+续假）进入现有渲染管线，不需要改 web ----
const nativeRecord=(extra={})=>({
  id:'record-1',type:'leave',status:'approved',statusText:'已通过',statusId:'2',typeText:'病假',reason:'感冒',
  startAt:'2026-10-20 08:00:00',endAt:'2026-10-20 12:00:00',submittedAt:'2026-10-19T10:00:00+08:00',
  approver:'辅导员',number:'L1',durationDays:'0.5',...extra
});

test('web 数据契约：请假+续假回包经 provider/normalize 后续假可见、type=renew 并参与课程联动',async()=>{
  const fetchedAt=Date.parse('2026-10-21T20:00:00+08:00');
  const provider=createSchoolRecordsProvider({request:async()=>({ok:true,fetchedAt,records:[
    nativeRecord({id:'leave-1',type:'leave',number:'L1'}),
    nativeRecord({id:'renew-1',type:'renew',number:'L2',startAt:'2026-10-21 08:00:00',endAt:'2026-10-21 12:00:00'})
  ]})});
  const out=await provider.list({state});
  assert.deepEqual(out.records.map(record=>[record.id,record.type]),[['leave-1','leave'],['renew-1','renew']]);
  assert.equal(out.skipped,0);
  assert.deepEqual(visibleLeaveRecords(out.records).map(record=>record.type),['leave','renew'],'续假记录必须可见（销假才隐藏）');
  const mark=leaveMarkForCourse({key:'c1',date:'2026-10-21',startTime:'09:00',endTime:'10:00'},out.records);
  assert.equal(mark?.status,'approved');
  assert.deepEqual(mark.records.map(record=>record.id),['renew-1'],'续假按请假参与课程标记');
  assert.equal(leaveCancelState(out.records.find(record=>record.type==='renew'),out.records,{now:Date.parse('2026-10-22T00:00:00+08:00'),fresh:true}),null,
    '续假记录不参与销假关联（与既有 web 语义一致）');
  const cache=normalizeLeaveStatusCache({schemaVersion:1,provider:'school',semesterId:'test-term',fetchedAt:new Date(fetchedAt).toISOString(),records:out.records},'test-term');
  assert.deepEqual(cache.records.map(record=>record.id),['leave-1','renew-1'],'续假记录必须写入本机缓存');
});

test('web 数据契约：续假缺起止时间会被 provider 跳过（原生必须补续假字段别名）',async()=>{
  const provider=createSchoolRecordsProvider({request:async()=>({ok:true,records:[
    nativeRecord({id:'renew-x',type:'renew',startAt:'',endAt:''})
  ]})});
  const out=await provider.list({state});
  assert.deepEqual(out.records,[]);
  assert.equal(out.skipped,1);
});
