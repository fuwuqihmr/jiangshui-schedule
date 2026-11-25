import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeManualCancelMarks,markManualCancel,unmarkManualCancel,manualCancelDateLabel} from '../web/leave-status.mjs';

const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));

// 与 android/.../StateStore.java save() 同语义：revision 不匹配即拒绝，无 merge。
class RevisionStore{
  constructor(){this.data=null;this.failNext=false;}
  load(){return this.data===null?null:clone(this.data);}
  save(state,expected=-1){
    if(this.failNext){this.failNext=false;throw Error('磁盘写入失败');}
    const old=this.load(),revision=old===null?0:Number(old._revision||0);
    if(expected>=0&&expected!==revision)throw Error('课表已在后台更新，请稍后重试');
    const next=clone(state);next._revision=revision+1;this.data=next;return revision+1;
  }
}

// 与 web/app.mjs 的 state/saveQueue/setManualCancelMark 相同写法的最小运行时。
function runtime(store,marks=null){
  let state={version:1,manualLeaveCancels:normalizeManualCancelMarks(marks),_revision:store.load()?Number(store.load()._revision||0):0};
  let saveQueue=Promise.resolve();
  const save=()=>{const data=clone(state);saveQueue=saveQueue.catch(()=>{}).then(async()=>{const revision=store.save(data,state._revision??0);state._revision=revision;});return saveQueue;};
  const setMark=async(number,mark,markedAt)=>{const previous=state.manualLeaveCancels;const next=mark?markManualCancel(previous,number,markedAt):unmarkManualCancel(previous,number);state={...state,manualLeaveCancels:next};try{await save();}catch(error){state={...state,manualLeaveCancels:previous};throw Error('标记未保存');}return state;};
  return {get state(){return state;},save,setMark,reload(){state={...clone(store.load()),manualLeaveCancels:normalizeManualCancelMarks(store.load().manualLeaveCancels)};return state;}};
}

test('手动销假持久化：标记→保存→撤销→保存→重新加载后 marks 为空',async()=>{
  const store=new RevisionStore();
  const rt=runtime(store);
  await rt.setMark('L1',true,'2026-11-03T15:50:00.000Z');
  assert.equal(store.load().manualLeaveCancels.marks.length,1);
  assert.equal(store.load()._revision,1);
  await rt.setMark('L1',false,'2026-11-03T15:52:00.000Z');
  assert.equal(store.load().manualLeaveCancels.marks.length,0,'撤销必须落盘而不是只改内存');
  assert.equal(store.load()._revision,2);
  const reloaded=rt.reload();
  assert.deepEqual(reloaded.manualLeaveCancels,{schemaVersion:1,marks:[]},'重新加载后不得复活任何标记');
});

test('撤销后旧快照被 revision 拒绝，不能把标记写回来',async()=>{
  const store=new RevisionStore();
  const rt=runtime(store);
  await rt.setMark('L1',true,'2026-11-03T15:50:00.000Z');
  const stale=clone(store.load());
  await rt.setMark('L1',false,'2026-11-03T15:52:00.000Z');
  assert.throws(()=>store.save(stale,stale._revision),/课表已在后台更新/);
  assert.equal(store.load().manualLeaveCancels.marks.length,0,'旧快照写入被拒绝后盘上必须仍为空');
});

test('撤销时 save 抛错：必须抛给调用方并回滚内存，不能静默成功',async()=>{
  const store=new RevisionStore();
  const rt=runtime(store);
  await rt.setMark('L1',true,'2026-11-03T15:50:00.000Z');
  store.failNext=true;
  await assert.rejects(()=>rt.setMark('L1',false,'2026-11-03T15:52:00.000Z'),/标记未保存/);
  assert.equal(rt.state.manualLeaveCancels.marks.length,1,'撤销失败后内存必须回滚为仍标记');
  assert.equal(store.load().manualLeaveCancels.marks.length,1,'撤销失败后盘上必须仍是已标记，界面不得宣称已撤销');
});

test('标记日期只取写入时的本地日期：跨午夜才从 11-03 变 11-04',()=>{
  assert.equal(manualCancelDateLabel('2026-11-03T15:59:00.000Z'),'2026-11-03');
  assert.equal(manualCancelDateLabel('2026-11-03T16:01:00.000Z'),'2026-11-04');
  const marks=markManualCancel(null,'L1','2026-11-03T15:50:00.000Z');
  const normalized=normalizeManualCancelMarks(marks);
  assert.equal(normalized.marks[0].markedAt,'2026-11-03T15:50:00.000Z','启动规范化不得改写标记日期');
  assert.deepEqual(normalizeManualCancelMarks(null),{schemaVersion:1,marks:[]},'启动规范化不得凭空创建标记');
});

test('app.mjs 只有确认动作会写标记，且撤销等待保存、失败回滚并抛出',()=>{
  const start=app.indexOf('async function setManualCancelMark(');
  const end=app.indexOf('\n',start);
  const fn=app.slice(start,end);
  assert.ok(start>=0&&end>start,'应能定位 setManualCancelMark');
  assert.match(fn,/await save\(\)/);
  assert.match(fn,/manualLeaveCancels:previous/);
  assert.match(fn,/manualSaveFailed/);
  assert.equal((app.match(/\?markManualCancel\(previous/g)||[]).length,1,'全文件只允许 setManualCancelMark 一处创建标记');
  assert.doesNotMatch(app,/manualLeaveCancels=markManualCancel\(/,'不得存在绕过确认弹窗的自动标记写入');
  assert.match(app,/const mark=a==='manual-cancel-confirm';/);
  assert.match(app,/await setManualCancelMark\(record,mark\)/);
  assert.doesNotMatch(app,/state\.manualLeaveCancels=normalizeManualCancelMarks\(state\.manualLeaveCancels\);\s*state\.manualLeaveCancels=markManualCancel/,'启动流程不得自动写标记');
});
