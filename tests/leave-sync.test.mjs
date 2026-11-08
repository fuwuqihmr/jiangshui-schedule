import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createState} from '../web/core.mjs';
import {
 statusFromRaw,statusFromSchool,schoolLeaveErrorMessage,createSchoolRecordsProvider,normalizeLeaveRecord
} from '../web/leave-status.mjs';
import {runNativeLeaveStatus} from './native-leave-status-harness.mjs';

const snapshot={schemaVersion:1,semester:{id:'test-term',name:'测试学期',startDate:'2026-08-31',weeks:8},rules:[],exceptions:[],remaps:[],closedDates:[],unscheduled:[]};
const state=createState(snapshot);
const providerWith=request=>createSchoolRecordsProvider({request});
const catchError=async fn=>{try{await fn();assert.fail('应抛错');}catch(error){return error;}};
const validRecord=(extra={})=>({id:'leave-1',statusText:'已通过',statusId:'2',reason:'身体不适',startAt:'2026-10-20 08:30:00',endAt:'2026-10-20 10:00:00',submittedAt:'2026-10-19T10:00:00Z',approver:'辅导员',...extra});

test('学校状态映射：文本优先，空文本一律 unknown（不靠 statusId 猜已通过）',()=>{
 assert.equal(statusFromSchool('已通过','1'),'approved');
 assert.equal(statusFromSchool('审批通过','9'),'approved');
 assert.equal(statusFromSchool('待审批','2'),'pending');
 assert.equal(statusFromSchool('审批中','2'),'pending');
 assert.equal(statusFromSchool('未通过','2'),'rejected','未通过必须映射为驳回');
 assert.equal(statusFromSchool('已驳回','2'),'rejected');
 assert.equal(statusFromSchool('退回修改','2'),'rejected','退回必须映射为驳回');
 assert.equal(statusFromSchool('不通过','2'),'rejected');
 assert.equal(statusFromSchool('','2'),'unknown','仅 statusId=2 不再回退已通过');
 assert.equal(statusFromSchool(null,'2'),'unknown');
 assert.equal(statusFromSchool('','1'),'unknown');
 assert.equal(statusFromSchool('','approved'),'unknown');
 assert.equal(statusFromSchool('未知状态','2'),'unknown');
 assert.equal(statusFromRaw('退回修改'),'rejected','通用状态映射也要识别退回');
});

test('精简记录映射：字段/时间/状态/审批人完整，fetchedAt 转为 ISO',async()=>{
 const requests=[];
 const provider=providerWith(async payload=>{requests.push(payload);return {ok:true,fetchedAt:1729400000000,records:[
  validRecord(),
  validRecord({id:'leave-2',statusText:'待审批',statusId:'1',startAt:'2026-10-22T09:00:00',endAt:'2026-10-22T10:30:00',reason:'',approver:''}),
  validRecord({id:'leave-3',statusText:'',statusId:'2',startAt:'2026-10-23',endAt:'2026-10-23T12:00:00'})
 ]};});
 const out=await provider.list({state});
 assert.equal(requests.length,1);assert.deepEqual(requests[0],{});
 assert.equal(out.source,'school');assert.equal(out.fetchedAt,new Date(1729400000000).toISOString());
 assert.equal(out.records.length,3);
 const first=out.records.find(record=>record.id==='leave-1');
 assert.equal(first.type,'leave');assert.equal(first.status,'approved');assert.equal(first.rawStatus,'已通过');
 assert.equal(first.startDate,'2026-10-20');assert.equal(first.startTime,'08:30');assert.equal(first.endDate,'2026-10-20');assert.equal(first.endTime,'10:00');
 assert.equal(first.reason,'身体不适');assert.equal(first.approver,'辅导员');assert.equal(first.semesterId,'test-term');
 assert.equal(out.records.find(record=>record.id==='leave-2').status,'pending');
 assert.equal(out.records.find(record=>record.id==='leave-3').status,'unknown','缺状态文本时不得按 statusId 猜已通过');
 for(const record of out.records)for(const value of [record.startTime,record.endTime])assert.match(value,/^([01]\d|2[0-3]):[0-5]\d$/,'不得出现 NaN/非法时间');
});

test('精简记录异常：缺 id/缺时间/非法时间/结束早于开始被跳过，不崩也不产生 NaN',async()=>{
 const provider=providerWith(async()=>({ok:true,records:[
  validRecord({id:''}),validRecord({id:'ok'}),
  {id:'no-start',statusText:'已通过',endAt:'2026-10-20 10:00:00'},
  {id:'no-end',statusText:'已通过',startAt:'2026-10-20 10:00:00'},
  {id:'bad-time',statusText:'已通过',startAt:'not-a-time',endAt:'2026-10-20 10:00:00'},
  {id:'reverse',statusText:'已通过',startAt:'2026-10-20 11:00:00',endAt:'2026-10-20 10:00:00'},
  null,'x'
 ]}));
 const out=await provider.list({state});
 assert.deepEqual(out.records.map(record=>record.id),['ok']);
 assert.equal(out.skipped,7);
 assert(Number.isFinite(out.records[0].startDate.length));
 assert(!JSON.stringify(out.records).includes('NaN'));
});

test('错误码 → 中文提示：NEED_LOGIN/NEED_SESSION/TIMEOUT/其他',()=>{
 assert.equal(schoolLeaveErrorMessage('NEED_LOGIN'),'请先打开一次请假服务完成登录');
 assert.equal(schoolLeaveErrorMessage('NEED_SESSION'),'请先在请假服务里打开一次请假页面');
 assert.equal(schoolLeaveErrorMessage('TIMEOUT'),'读取超时，请稍后重试');
 assert.equal(schoolLeaveErrorMessage('HTTP_500'),'学校服务暂时不可用，稍后再试');
 assert.equal(schoolLeaveErrorMessage('PARSE'),'学校服务暂时不可用，稍后再试');
 assert.equal(schoolLeaveErrorMessage('NETWORK'),'学校服务暂时不可用，稍后再试');
});

test('provider 错误路径：不支持操作→NEED_LOGIN、原生 code、null、ok:false、坏 records、AbortError',async()=>{
 let error=await catchError(()=>providerWith(async()=>{throw Error('不支持的操作')}).list({state}));
 assert.equal(error.code,'NEED_LOGIN');assert.equal(error.message,'请先打开一次请假服务完成登录');
 error=await catchError(()=>providerWith(async()=>{const e=Error('会话过期');e.code='NEED_SESSION';throw e;}).list({state}));
 assert.equal(error.code,'NEED_SESSION');assert.equal(error.message,'请先在请假服务里打开一次请假页面');
 error=await catchError(()=>providerWith(async()=>null).list({state}));
 assert.equal(error.code,'NEED_LOGIN');
 error=await catchError(()=>providerWith(async()=>({ok:false,code:'TIMEOUT'})).list({state}));
 assert.equal(error.code,'TIMEOUT');assert.equal(error.message,'读取超时，请稍后重试');
 error=await catchError(()=>providerWith(async()=>({ok:false,code:'HTTP_403'})).list({state}));
 assert.equal(error.code,'HTTP_403');assert.equal(error.message,'学校服务暂时不可用，稍后再试');
 error=await catchError(()=>providerWith(async()=>({ok:true,records:'nope'})).list({state}));
 assert.equal(error.code,'PARSE');
 error=await catchError(()=>providerWith(async()=>{const e=Error('取消');e.name='AbortError';throw e;}).list({state}));
 assert.equal(error.name,'AbortError');
 assert.throws(()=>createSchoolRecordsProvider({}),/request 必须是函数/);
});

test('AbortSignal：请求期间取消会在返回后抛「读取已取消」',async()=>{
 let resolveRequest;
 const provider=providerWith(()=>new Promise(resolve=>{resolveRequest=resolve;}));
 const controller=new AbortController();
 const pending=provider.list({state,signal:controller.signal});
 controller.abort();
 resolveRequest({ok:true,records:[]});
 const error=await catchError(()=>pending);
 assert.equal(error.name,'AbortError');assert.match(error.message,/读取已取消/);
});

test('单飞与超时契约：app refresh 单飞 + 8s AbortController；原生 15s watchdog 与单飞',()=>{
 const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
 assert.match(app,/if\(leaveRefreshPromise\)return leaveRefreshPromise;/);
 assert.match(app,/const controller=new AbortController\(\);const timeout=setTimeout\(\(\)=>controller\.abort\(\),15000\);/);
 assert.match(app,/leaveRefreshPromise=null;/);
 const java=readFileSync(new URL('../android/app/src/main/java/cn/local/tomorrow/MainActivity.java',import.meta.url),'utf8');
 assert.match(java,/if\(leaveSyncActive\)\{failure\(id,"正在同步假条，请稍候"\);return;\}/,'原生同步必须单飞');
 assert.match(java,/leaveSyncWatchdog=\(\)->finishLeaveSync\(id,leaveSyncError\("TIMEOUT"\)\);/);
 assert.match(java,/postDelayed\(leaveSyncWatchdog,15000\)/,'15 秒看门狗超时');
 assert.match(java,/setConnectTimeout\(8000\);conn\.setReadTimeout\(12000\)/);
 assert.match(java,/catch\(java\.net\.SocketTimeoutException e\)\{return leaveSyncError\("TIMEOUT"\);\}/);
});

test('真实 provider 接线：默认 school、request 调 leaveRecordSync、示例仅示例模式',()=>{
 const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
 assert.match(app,/const schoolRecordsProvider=createSchoolRecordsProvider\(\{request:payload=>call\('leaveRecordSync',payload\)\}\);/);
 assert.match(app,/function getLeaveRecordsProvider\(mode\)\{return mode==='sample'\?moduleLeaveRecordsProvider\('sample'\):schoolRecordsProvider;\}/);
 assert.match(app,/function activeLeaveProvider\(\)\{return sampleState\?getLeaveRecordsProvider\('sample'\):getLeaveRecordsProvider\(\);\}/);
 assert.match(app,/const sample=leaveView\.provider==='sample';/);
 assert.match(app,/\$\{esc\(leaveView\.error\.message\|\|'读取假条失败'\)\}/,'provider 中文错误需展示到面板');
});

test('隐私与权限静态检查：不打印 cookie/响应原文，权限为 12 项含日历',()=>{
 const java=readFileSync(new URL('../android/app/src/main/java/cn/local/tomorrow/MainActivity.java',import.meta.url),'utf8');
 const fetchBlock=/JSONObject fetchLeaveRecords\(\)\{[\s\S]*?\n    \}/.exec(java)?.[0]||'';
 assert(fetchBlock.length>0,'找不到 fetchLeaveRecords');
 assert.doesNotMatch(fetchBlock,/log\(|Log\.|System\.out|printStackTrace/,'原生同步不得打印 cookie/响应原文');
 assert.match(fetchBlock,/setRequestProperty\("Cookie",cookie\)/,'cookie 只能用于请求头');
 assert.doesNotMatch(java,/putString\("leave\.cookie"/,'不得持久化 cookie');
 assert.match(java,/case "leaveRecordSync":beginLeaveRecordSync\(id\);break;/);
 const manifest=readFileSync(new URL('../android/app/src/main/AndroidManifest.xml',import.meta.url),'utf8');
 const permissions=[...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(permissions.length,12,'权限必须为 12 项');
 const expected=['INTERNET','ACCESS_NETWORK_STATE','ACCESS_COARSE_LOCATION','ACCESS_FINE_LOCATION','POST_NOTIFICATIONS','RECEIVE_BOOT_COMPLETED','SCHEDULE_EXACT_ALARM','FOREGROUND_SERVICE','FOREGROUND_SERVICE_DATA_SYNC','REQUEST_IGNORE_BATTERY_OPTIMIZATIONS','READ_CALENDAR','WRITE_CALENDAR'].map(name=>'android.permission.'+name);
 assert(permissions.includes('android.permission.READ_CALENDAR')&&permissions.includes('android.permission.WRITE_CALENDAR'),'清单必须含 READ/WRITE_CALENDAR');
 assert.deepEqual([...permissions].sort(),[...expected].sort());
 assert.doesNotMatch(manifest,/BACKGROUND_LOCATION|READ_EXTERNAL|WRITE_EXTERNAL|QUERY_ALL_PACKAGES/);
});

test('原生状态映射：真实编译 leaveStatus，文本优先且未通过判驳回',()=>{
 const cases=[['未通过',''],['不通过','2'],['驳回','2'],['已通过','1'],['待审批','2'],['','2']];
 assert.deepEqual(runNativeLeaveStatus(cases),['rejected','rejected','rejected','approved','pending','unknown']);
});
