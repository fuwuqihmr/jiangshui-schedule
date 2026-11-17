// 课表快照保存：revision 冲突时按磁盘最新版本自愈重试，最后再用 -1 强制保存兜底。
// 只有本 App 会写 state.json；磁盘 revision 领先通常意味着“上次保存已落盘但回包丢了”，
// 用本地 state 覆盖是正确的语义。即使第二次仍冲突（或 loadState 拿不到真实 revision），
// -1 会让 StateStore 跳过 expectedRevision 检查，确保保存不会永久失败（真机曾因此循环提示
// 「课表已经在后台更新，请稍后重试」）。
export async function saveStateWithRecovery(call,data,expectedRevision){
  const first=toRevision(expectedRevision);
  try{
    return {revision:readRevision(await call('saveState',{state:data,expectedRevision:first}),first+1),retried:false,forced:false};
  }catch{
    let diskRevision=0;
    try{
      const latest=await call('loadState');
      const value=Number(latest?._revision);
      if(Number.isFinite(value)&&value>=0)diskRevision=Math.floor(value);
    }catch{
      diskRevision=0;
    }
    try{
      return {revision:readRevision(await call('saveState',{state:data,expectedRevision:diskRevision}),diskRevision+1),retried:true,forced:false};
    }catch{
      // 第二次仍失败：单写者前提下磁盘上的只是本 App 的旧快照，本地 state 才是用户当前编辑。
      // 最后一次用 -1 跳过冲突检查强制落盘；第三次仍失败才向上抛，避免把真实 I/O 错误吞掉。
      return {revision:readRevision(await call('saveState',{state:data,expectedRevision:-1}),diskRevision+1),retried:true,forced:true};
    }
  }
}
function toRevision(value){
  const revision=Number(value);
  return Number.isFinite(revision)&&revision>=0?Math.floor(revision):0;
}
function readRevision(saved,fallback){
  if(typeof saved==='number'&&Number.isFinite(saved))return Math.floor(saved);
  const revision=Number(saved?.revision);
  return Number.isFinite(revision)&&revision>=0?Math.floor(revision):fallback;
}
