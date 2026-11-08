import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CANCEL_COPY,markManualCancel,normalizeManualCancelMarks,unmarkManualCancel} from '../web/leave-status.mjs';
import vm from 'node:vm';

const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const java=readFileSync(new URL('../android/app/src/main/java/cn/local/tomorrow/StateStore.java',import.meta.url),'utf8');

function store(initial){
  let disk=JSON.parse(JSON.stringify(initial));
  return {
    load:()=>JSON.parse(JSON.stringify(disk)),
    save:(state,expected)=>{
      const revision=disk._revision||0;
      if(expected>=0&&expected!==revision)throw Error('课表已在后台更新，请稍后重试');
      const next=JSON.parse(JSON.stringify(state));
      next._revision=revision+1;
      disk=next;
      return next._revision;
    }
  };
}

test('撤销后另一个旧快照整包回写必须被 revision 拒绝，盘上保持空标记',()=>{
  const db=store({_revision:2,manualLeaveCancels:{schemaVersion:1,marks:[{number:'A',markedAt:'2026-11-04T00:27:00.000Z'}]}});
  const stale=db.load();
  const undo={...JSON.parse(JSON.stringify(stale)),manualLeaveCancels:{schemaVersion:1,marks:[]}};
  assert.equal(db.save(undo,stale._revision),3);
  assert.deepEqual(db.load().manualLeaveCancels.marks,[]);
  assert.throws(()=>db.save(stale,stale._revision),/课表已在后台更新/,'旧快照必须被拒绝');
  assert.deepEqual(db.load().manualLeaveCancels.marks,[],'被拒绝的旧快照不得复活标记');
});

test('app 保存队列在执行时克隆最新 state，避免把调用时的旧整包写到新 revision',()=>{
  const fn=app.slice(app.indexOf('function save()'),app.indexOf('return saveQueue;}')+18);
  const then=fn.indexOf('.then(async()=>{');
  assert.ok(then>0,'save 应串行进队列');
  assert.ok(fn.indexOf('const data=clone(state)')>then,'data 必须在队列回调内克隆，不能在调用时克隆旧快照');
  assert.ok(fn.includes('expectedRevision:state._revision??0'),'写入时使用当前 state 的 revision');
  assert.ok(fn.includes('if(saved?.revision)state._revision=saved.revision'),'成功后更新内存 revision');
});

test('StateStore 的 revision 检查必须发生在写文件之前',()=>{
  const save=java.slice(java.indexOf('public static synchronized long save'),java.indexOf('ClassReminders'));
  const check=save.indexOf('expected>=0&&expected!=revision');
  const write=save.indexOf('FileOutputStream');
  assert.ok(check>=0,'必须有 revision 校验');
  assert.ok(write>check,'必须校验通过后才写 state.tmp');
});

function runtime(store,{cloneAtCall}){
  const disk=store.load();
  let state={...disk,manualLeaveCancels:normalizeManualCancelMarks(disk.manualLeaveCancels)};
  let queue=Promise.resolve();
  const save=()=>{
    const captured=cloneAtCall?clone(state):null;
    queue=queue.catch(()=>{}).then(async()=>{
      const data=cloneAtCall?captured:clone(state);
      const revision=await store.save(data,state._revision??0);
      state._revision=revision;
    });
    return queue;
  };
  return {get state(){return state;},set state(value){state=value;},save,reload(){const next=store.load();state={...next,manualLeaveCancels:normalizeManualCancelMarks(next.manualLeaveCancels)};return state;}};
}

function gatedStore(initial,{failOn=0}={}){
  let disk=clone(initial);
  let release;
  let saves=0;
  const gate=new Promise(resolve=>{release=resolve;});
  return {
    load:()=>clone(disk),
    save:(state,expected)=>{
      const call=++saves;
      const run=()=>{
        if(failOn===call)throw Error('磁盘写入失败');
        const revision=disk._revision||0;
        if(expected>=0&&expected!==revision)throw Error('课表已在后台更新，请稍后重试');
        const next=clone(state);
        next._revision=revision+1;
        disk=next;
        return next._revision;
      };
      return call===1?gate.then(run):Promise.resolve().then(run);
    },
    release:()=>release()
  };
}

const marked={_revision:1,manualLeaveCancels:normalizeManualCancelMarks({marks:[{number:'L1',markedAt:'2026-11-04T00:27:00.000Z'}]})};

test('undo → 立即 save → reload 恒为空（旧/新保存队列都不复活标记）',async()=>{
  for(const cloneAtCall of [true,false]){
    const store={
      disk:clone(marked),
      load(){return clone(this.disk);},
      save(state,expected){
        const revision=this.disk._revision||0;
        if(expected>=0&&expected!==revision)throw Error('课表已在后台更新，请稍后重试');
        const next=clone(state);
        next._revision=revision+1;
        this.disk=next;
        return next._revision;
      }
    };
    const rt=runtime(store,{cloneAtCall});
    rt.state={...rt.state,manualLeaveCancels:unmarkManualCancel(rt.state.manualLeaveCancels,'L1')};
    await rt.save();
    await rt.save();
    const reloaded=rt.reload();
    assert.deepEqual(reloaded.manualLeaveCancels.marks,[],'undo 后紧接 save 并 reload 必须始终为空（cloneAtCall='+cloneAtCall+'）');
  }
});

test('undo 期间排队中的旧快照在 undo 保存失败时不得把标记写回（clone-in-queue 覆盖）',async()=>{
  for(const cloneAtCall of [true,false]){
    const store=gatedStore(marked,{failOn:2});
    const rt=runtime(store,{cloneAtCall});
    const beforeUndo=rt.save();
    rt.state={...rt.state,manualLeaveCancels:unmarkManualCancel(rt.state.manualLeaveCancels,'L1')};
    const undo=rt.save().catch(()=>{});
    store.release();
    await beforeUndo;
    await undo;
    const reloaded=rt.reload();
    if(cloneAtCall){
      assert.equal(reloaded.manualLeaveCancels.marks.length,1,'旧实现下 undo 保存失败时，排队中的旧快照会把标记写回（可复现窗口）');
    }else{
      assert.deepEqual(reloaded.manualLeaveCancels.marks,[],'新实现 clone-in-queue 必须让旧快照在 undo 后按最新 state 写入，不得复活标记');
    }
  }
});

function inFlightHarness(initial,{failOn=2}={}){
  let disk=clone(initial);
  let context;
  let queue=Promise.resolve();
  let saves=0;
  let releaseFirst;
  let markStarted;
  const firstStarted=new Promise(resolve=>{markStarted=resolve;});
  const gate=new Promise(resolve=>{releaseFirst=resolve;});
  const save=()=>{
    queue=queue.catch(()=>{}).then(async()=>{
      const data=clone(context.state);
      const call=++saves;
      if(call===1){markStarted();await gate;}
      if(call===failOn)throw Error('磁盘写入失败');
      const revision=disk._revision||0;
      if((context.state._revision??0)!==revision)throw Error('课表已在后台更新，请稍后重试');
      data._revision=revision+1;
      disk=clone(data);
      context.state._revision=revision+1;
    });
    return queue;
  };
  const toasts=[];
  context={
    state:clone(initial),save,CANCEL_COPY,markManualCancel,unmarkManualCancel,
    traceNumberHash:()=>'deadbeef',
    close(){},updateLeaveStatusPanel(){},openLeaveStatusDetail(){},
    toast(message){toasts.push(message);},
    console:{debug(){},warn(){},info(){},error(){}}
  };
  vm.createContext(context);
  const source=app.slice(app.indexOf('async function setManualCancelMark'),app.indexOf('function openLeaveStatusDetail'));
  vm.runInContext(source+'\n;globalThis.__runManualCancel=async(record,mark)=>{try{await setManualCancelMark(record,mark);return {ok:true,state,error:null};}catch(error){return {ok:false,state,error};}};',context);
  return {firstStarted,save,release:()=>releaseFirst(),run:context.__runManualCancel,toasts,disk:()=>clone(disk)};
}

test('真 in-flight：mark 写入已开始、undo 保存失败时 marks 仍为 1 且 UI 返回失败、不提示撤销成功',async()=>{
  const h=inFlightHarness(marked,{failOn:2});
  const first=h.save();
  await h.firstStarted;
  const pending=h.run({id:'leave-L1',number:'L1'},false);
  h.release();
  await first;
  const result=await pending;
  assert.equal(result.ok,false,'undo 的 save 失败必须把失败返回给 UI');
  assert.equal(result.error?.message,CANCEL_COPY.manualSaveFailed,'失败信息必须是 manualSaveFailed');
  assert.equal(result.state.manualLeaveCancels.marks.length,1,'内存必须先回滚到撤销前，不能谎称已撤销');
  assert.equal(h.disk().manualLeaveCancels.marks.length,1,'undo 失败时此前已提交的 mark 仍保留');
  assert.deepEqual(h.toasts,[],'不得出现“已取消手动销假标记”的成功提示');
});
