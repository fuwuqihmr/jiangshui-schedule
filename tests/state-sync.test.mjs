import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {saveStateWithRecovery} from '../web/state-sync.mjs';
import {createState,validateSnapshot,applySnapshot,adoptSchoolSnapshot} from '../web/core.mjs';

// 旧仓 v1.3.1-rc1 的 tests/state-sync.test.mjs 行为清单（7 条）在本仓的移植：
// 1-6 条为 state-sync.mjs 模块行为（与旧测试逐条等价）；
// 第 7 条在旧测试里是 4 条 app.mjs 源码正则，本仓改为对真实 app.mjs 片段做 vm 行为回放
// （boot 保留磁盘 revision / save 走自愈重试 / readSchool 失败分支 save 不覆盖原始错误），
// 另加 createState 的 _revision 语义断言。
const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const conflictError=()=>Error('课表已在后台更新，请稍后重试');

const sampleSnapshot={schemaVersion:1,semester:{id:'sample',name:'示例学期',startDate:'2026-09-07',weeks:18},rules:[]};
const savedSnapshot={schemaVersion:1,semester:{id:'saved',name:'磁盘学期',startDate:'2026-09-07',weeks:18},rules:[]};

// ---------- 1-6：旧 tests/state-sync.test.mjs 的模块行为 ----------

test('保存冲突后按磁盘 revision 自愈重试一次并返回新 revision',async()=>{
 const calls=[];const data={snapshot:{semester:{}},events:[]};let saves=0;
 const call=async(action,payload)=>{
  calls.push({action,payload});
  if(action==='saveState'){
   saves++;
   if(saves===1)throw conflictError();
   return {revision:payload.expectedRevision+1};
  }
  if(action==='loadState')return {_revision:7,snapshot:{}};
  throw Error('不应调用 '+action);
 };
 const result=await saveStateWithRecovery(call,data,0);
 assert.equal(result.revision,8);
 assert.equal(result.retried,true);
 assert.equal(result.forced,false);
 assert.deepEqual(calls.map(entry=>entry.action),['saveState','loadState','saveState']);
 assert.equal(calls[0].payload.expectedRevision,0);
 assert.equal(calls[2].payload.expectedRevision,7);
 assert.equal(calls[0].payload.state,data,'重试必须保存同一份本地数据');
 assert.equal(calls[2].payload.state,data);
});

test('首次保存成功时不读磁盘、不重复写，也不出现 forced',async()=>{
 const calls=[];
 const call=async(action,payload)=>{
  calls.push({action,payload});
  if(action==='saveState')return {revision:payload.expectedRevision+1};
  throw Error('不应调用 '+action);
 };
 const result=await saveStateWithRecovery(call,{events:[]},2);
 assert.equal(result.revision,3);
 assert.equal(result.retried,false);
 assert.equal(result.forced,false);
 assert.deepEqual(calls.map(entry=>entry.action),['saveState']);
 assert.equal(calls[0].payload.expectedRevision,2);
});

test('第二次仍失败时用 expectedRevision -1 强制保存并返回 forced',async()=>{
 const calls=[];const data={events:[]};
 const call=async(action,payload)=>{
  calls.push({action,payload});
  if(action==='loadState')return {_revision:7};
  if(action==='saveState'){
   const saves=calls.filter(entry=>entry.action==='saveState');
   if(saves.length===1)throw conflictError();
   if(saves.length===2)throw conflictError();
   return {revision:9};
  }
  throw Error('不应调用 '+action);
 };
 const result=await saveStateWithRecovery(call,data,0);
 assert.equal(result.revision,9);
 assert.equal(result.retried,true);
 assert.equal(result.forced,true);
 assert.deepEqual(calls.map(entry=>entry.action),['saveState','loadState','saveState','saveState']);
 const saves=calls.filter(entry=>entry.action==='saveState');
 assert.deepEqual(saves.map(entry=>entry.payload.expectedRevision),[0,7,-1]);
 for(const entry of saves)assert.equal(entry.payload.state,data,'三次保存都必须使用同一份本地数据');
});

test('三次保存都失败时抛出第三次错误',async()=>{
 let saves=0;const calls=[];
 const call=async(action)=>{
  calls.push(action);
  if(action==='saveState'){
   saves++;
   if(saves===1)throw conflictError();
   if(saves===2)throw Error('课表保存失败');
   throw Error('强制保存失败');
  }
  if(action==='loadState')return {_revision:7};
  throw Error('不应调用 '+action);
 };
 await assert.rejects(()=>saveStateWithRecovery(call,{},0),/强制保存失败/);
 assert.equal(saves,3);
 assert.deepEqual(calls,['saveState','loadState','saveState','saveState']);
});

test('读取磁盘失败时退回 revision 0 重试，仍不放弃第一次保存的数据',async()=>{
 const revisions=[];const data={events:[]};
 const call=async(action,payload)=>{
  if(action==='saveState'){
   revisions.push(payload.expectedRevision);
   assert.equal(payload.state,data);
   if(revisions.length===1)throw conflictError();
   return {revision:1};
  }
  if(action==='loadState')throw Error('state.json 不存在');
  throw Error('不应调用 '+action);
 };
 const result=await saveStateWithRecovery(call,data,5);
 assert.deepEqual(revisions,[5,0]);
 assert.equal(result.revision,1);
 assert.equal(result.retried,true);
 assert.equal(result.forced,false);
});

test('兼容桥接返回数字或缺少 revision 字段',async()=>{
 const numeric=await saveStateWithRecovery(async()=>7,{},6);
 assert.deepEqual(numeric,{revision:7,retried:false,forced:false});
 const missing=await saveStateWithRecovery(async()=>({}),{},6);
 assert.deepEqual(missing,{revision:7,retried:false,forced:false});
});

// ---------- 第 7 条（改造）：对真实 app.mjs 片段做 vm 行为回放 ----------

function appSlice(startMarker,endMarker,includeEnd=true){
 const start=app.indexOf(startMarker);
 if(start<0)throw Error('app.mjs 未找到起点：'+startMarker);
 const end=app.indexOf(endMarker,start+startMarker.length);
 if(end<0)throw Error('app.mjs 未找到终点：'+endMarker);
 return app.slice(start,includeEnd?end+endMarker.length:end);
}

async function runBoot({saved,loadError}={}){
 const ctx=vm.createContext({
  state:undefined,native:true,localStorage:{getItem:()=>null},
  samples:{baseline:sampleSnapshot,adjusted:sampleSnapshot},
  call:async action=>{if(action==='loadState'){if(loadError)throw loadError;return saved;}throw Error('不应调用 '+action);},
  console:{warn(){}},
  validateSnapshot,createState,
 });
 await vm.runInContext('(async()=>{'+appSlice('function savedStateRevision(value){','state ||= createState(samples.adjusted);')+'})()',ctx);
 return ctx;
}

function makeSaveHarness(memRevision,diskRevision,{failSaves=0}={}){
 const calls=[];let disk=diskRevision;let saveCount=0;
 const call=async(action,payload)=>{
  calls.push({action,expectedRevision:payload&&payload.expectedRevision});
  if(action==='saveState'){
   saveCount++;
   if(saveCount<=failSaves)throw conflictError();
   if(payload.expectedRevision>=0&&payload.expectedRevision!==disk)throw conflictError();
   disk+=1;
   return {revision:disk};
  }
  if(action==='loadState')return {_revision:disk,snapshot:{}};
  throw Error('不应调用 '+action);
 };
 const ctx=vm.createContext({state:{_revision:memRevision,events:[{id:'e1'}]},saveQueue:Promise.resolve(),native:true,sampleState:null,clone,saveStateWithRecovery,call,localStorage:{setItem(){}}});
 vm.runInContext(appSlice('function save(){','return saveQueue;}')+'\n;globalThis.__save=save;',ctx);
 return {ctx,calls,disk:()=>disk,save:()=>ctx.__save()};
}

function runReadSchoolCatch(error){
 let saveCalls=0;
 const ctx=vm.createContext({
  state:{snapshot:{},error:null},
  call:async()=>null,
  failureCategory:()=>'测试失败',
  appendScheduleTrace:(state,next)=>next,
  recordFailure:(state,message)=>({...state,error:String(message)}),
  save:async()=>{saveCalls++;throw conflictError();},
 });
 const source=appSlice("if(!e.message.startsWith('已取消')){",'readFeedback={kind:e.message.startsWith',false);
 vm.runInContext('globalThis.__run=async(e)=>{'+source+'};',ctx);
 return {run:()=>ctx.__run(error),ctx,saveCalls:()=>saveCalls};
}

test('app.mjs boot：旧快照校验失败时保留磁盘 revision（层 1）',async()=>{
 const invalid={schemaVersion:999,snapshot:{schemaVersion:999},events:[],overrides:[],localMaps:[],_revision:7};
 const failed=await runBoot({saved:invalid});
 assert.equal(failed.state._revision,7,'校验失败必须把磁盘 revision 留在内存，避免内存 0 / 磁盘 N 的必然冲突');
 assert.equal(failed.state._revision??0,7,'save 使用该 revision 作为 expectedRevision');
 assert.equal(failed.state.snapshot.semester.id,'sample','无效快照仍回退到示例课表');
 const valid=await runBoot({saved:{snapshot:savedSnapshot,events:[],overrides:[],localMaps:[],_revision:7}});
 assert.equal(valid.state._revision,7,'合法快照直接采用磁盘 revision');
 const unavailable=await runBoot({loadError:Error('state.json 不存在')});
 assert.equal(unavailable.state._revision,0,'读不到磁盘状态时按 createState 的 0 处理');
});

test('app.mjs save：冲突后自愈收敛（保存接线走 saveStateWithRecovery）',async()=>{
 const h=makeSaveHarness(0,7);
 await h.save();
 assert.deepEqual(h.calls.map(c=>c.action),['saveState','loadState','saveState']);
 assert.equal(h.calls[0].expectedRevision,0,'首次保存使用内存 revision');
 assert.equal(h.calls[2].expectedRevision,7,'重试使用磁盘 revision');
 assert.equal(h.ctx.state._revision,8,'保存成功后内存 revision 前进到磁盘返回值');
 assert.equal(h.disk(),8);
 await h.save();
 assert.equal(h.calls[3].expectedRevision,8,'后续保存使用新 revision，不再冲突');
 assert.equal(h.ctx.state._revision,9);
 assert.equal(h.disk(),9);
});

test('app.mjs save：二次失败时 -1 强制保存，不再永久失败（层 3）',async()=>{
 const h=makeSaveHarness(0,7,{failSaves:2});
 await h.save();
 assert.deepEqual(h.calls.map(c=>c.action),['saveState','loadState','saveState','saveState']);
 assert.deepEqual(h.calls.filter(c=>c.action==='saveState').map(c=>c.expectedRevision),[0,7,-1]);
 assert.equal(h.ctx.state._revision,8,'强制保存成功后的 revision 必须回写内存');
 assert.equal(h.disk(),8);
});

test('app.mjs readSchool 失败分支：保存失败不得覆盖原始读取错误',async()=>{
 const h=runReadSchoolCatch(Error('读取学校课表失败'));
 await h.run();
 assert.equal(h.saveCalls(),1,'失败分支仍尝试保存诊断状态');
 assert.equal(h.ctx.state.error,'读取学校课表失败','原始读取错误必须保留，不能被保存冲突错误顶替');
});

test('core createState 显式 _revision:0，同步/恢复路径保留既有 revision',()=>{
 const state=createState(sampleSnapshot);
 assert.equal(state._revision,0,'新建状态必须显式带 revision 0');
 state._revision=7;
 assert.equal(applySnapshot(state,sampleSnapshot,'2026-11-18T00:00:00.000Z')._revision,7,'学校同步不得清掉 revision');
 assert.equal(adoptSchoolSnapshot(state,sampleSnapshot)._revision,7,'采用学校课表不得清掉 revision');
});
