const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const output=path.resolve(process.env.NOTICE_OUTPUT||'D:/ChatGPT/2026-10-10/files-pasted-by-the-user-d/outputs/悬浮提示-1.2.0-beta3');
(async()=>{
 const {createState}=await import('../web/core.mjs');
 const snapshot=JSON.parse(await fs.readFile('web/data/baseline.json','utf8'));
 snapshot.source={kind:'school',label:'学校教务系统 · 本机读取'};snapshot.remaps=[];snapshot.exceptions=[];snapshot.closedDates=[];
 snapshot.rules=[{id:'notice-test',name:'课程提示测试',room:'南C102',teacher:'测试老师',weekday:4,weeks:[7],periods:[5,6],startTime:'14:00',endTime:'15:25'}];
 const state={...createState(snapshot),theme:'light',lastSuccess:'2026-10-15T00:00:00Z',classReminders:{enabled:false},classReminderPreferenceSet:true,reminderIntroAcknowledged:true};
 const app=await electron.launch({args:[path.resolve('.'),'--force-device-scale-factor=2'],env:{...process.env,TOMORROW_TEST:'1'}});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await fs.mkdir(output,{recursive:true});
  await app.evaluate(({BrowserWindow,ipcMain},state)=>{
   BrowserWindow.getAllWindows().forEach(w=>{w.setPosition(-5000,0);w.showInactive();});
   global.noticeTest={state,calls:[],pending:null};ipcMain.removeHandler('app:request');
   ipcMain.handle('app:request',async(_e,a,p={})=>{
    const t=global.noticeTest;t.calls.push(a);
    if(a==='consentStatus')return {version:'2026-10-17.1',acceptedAt:'2026-10-10T00:00:00Z'};
    if(a==='loadState')return t.state;
    if(a==='saveState'){t.state=p.state;return {revision:(p.state._revision||0)+1};}
    if(a==='classReminderStatus')return {enabled:false,active:[],notificationsAllowed:true};
    if(a==='runtimeStatus')return {enabled:false,time:'22:00'};
    if(['sync','capture','openSchool'].includes(a))return new Promise((resolve,reject)=>{t.pending={resolve,reject};});
    if(a==='cancelRead'){t.pending?.resolve({message:'已取消读取，原课表保留'});t.pending=null;return {ok:true};}
    return {ok:true};
   });
  },state);
  await page.setViewportSize({width:430,height:932});
  await page.addInitScript(()=>{globalThis.Android={systemDarkMode:()=>false};});
  await page.reload();await page.locator('.day-swipe').waitFor();
  const pill=page.locator('#sync-status .sync-status');
  const waitState=async value=>page.waitForFunction(v=>document.querySelector('#sync-status .sync-status')?.dataset.state===v,value);
  const resolveRead=async changed=>app.evaluate((_electron,changed)=>{const t=global.noticeTest,s=JSON.parse(JSON.stringify(t.state.snapshot));if(changed)s.rules[0].room='南C103';t.pending.resolve({snapshot:s});t.pending=null;},changed);
  await waitState('checking');assert.equal(await pill.innerText(),'检查登录状态…');
  assert.equal(await page.locator('.read-banner,#read-status').count(),0);
  const geometry=()=>page.evaluate(()=>({tools:document.querySelector('.quick-tools').getBoundingClientRect().top,courses:document.querySelector('.day-swipe').getBoundingClientRect().top,height:document.body.scrollHeight}));
  const initial=await geometry();
  for(const width of [360,430]){
   await page.setViewportSize({width,height:932});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   const rect=await pill.boundingBox(),button=await page.locator('.topbar button').boundingBox();assert.ok(rect.x+rect.width<=button.x,'status stays left of refresh');
  }
  await page.evaluate(async()=>{const {androidCallbacks}=await import('./bridge.mjs');androidCallbacks.set('notice-progress',{});onNativeProgress('notice-progress','正在读取教学周和课程…');});
  assert.equal(await pill.innerText(),'读取学校课表…');
  await page.screenshot({path:path.join(output,'01-刷新中-黄色状态.png')});
  await resolveRead(false);await waitState('success');
  await page.locator('.notice-card[data-tone=success]').waitFor();
  assert.equal(await pill.innerText(),'已确认无变化');assert.deepEqual(await geometry(),initial,'notices and read progress take no layout space');
  await page.waitForTimeout(330);await page.screenshot({path:path.join(output,'02-核对完成-悬浮提示.png')});
  const schoolBefore=await app.evaluate(()=>JSON.stringify(global.noticeTest.state.snapshot));
  await page.getByRole('button',{name:'检查更新',exact:true}).click();await waitState('checking');
  await app.evaluate(()=>{global.noticeTest.pending.resolve({message:'测试：学校响应超时，已保留原课表'});global.noticeTest.pending=null;});
  await waitState('error');await page.locator('.notice-card[data-tone=error]').waitFor();
  assert.equal(await pill.innerText(),'核对失败');assert.equal(await app.evaluate(()=>JSON.stringify(global.noticeTest.state.snapshot)),schoolBefore);
  await page.waitForTimeout(320);await page.screenshot({path:path.join(output,'03-刷新失败-红色状态.png')});
  await page.getByRole('button',{name:'检查更新',exact:true}).click();await waitState('checking');
  await page.getByRole('button',{name:'取消读取',exact:true}).click();await waitState('error');
  assert.ok((await page.locator('.notice-card').allTextContents()).some(s=>s.includes('已取消读取')));assert.equal(await app.evaluate(()=>global.noticeTest.state.error), '测试：学校响应超时，已保留原课表');
  await page.getByRole('button',{name:'检查更新',exact:true}).click();await waitState('checking');await resolveRead(false);await waitState('success');
  // Clear previous outcomes before isolated stack/timer assertions.
  await page.evaluate(async()=>{const {dismissNotice}=await import('./notifications.mjs');document.querySelectorAll('.notice-slot').forEach(s=>dismissNotice(Number(s.dataset.noticeId)));});
  await page.waitForFunction(()=>!document.querySelector('.notice-slot'));
  const ids=await page.evaluate(async()=>{const {showNotice}=await import('./notifications.mjs');return [showNotice('第一条提示',{duration:20000}),showNotice('第二条提示',{tone:'warning',duration:20000}),showNotice('第三条提示',{tone:'success',duration:20000})];});
  await page.waitForTimeout(330);
  assert.deepEqual(await page.locator('.notice-content strong').allTextContents(),['第三条提示','第二条提示','第一条提示']);
  await page.waitForFunction(()=>{const r=[...document.querySelectorAll('.notice-card')].map(n=>n.getBoundingClientRect());return r.length===3&&r[0].bottom<r[1].top&&r[1].bottom<r[2].top;});
  const subtitle=await page.locator('.title-sub').boundingBox(),firstNotice=await page.locator('.notice-card').first().boundingBox();assert.ok(firstNotice.y>=subtitle.y+subtitle.height+7,'first notice begins below the subtitle, preserving the logo');
  const bounds=await page.locator('.notice-card').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom};}));assert.ok(bounds[0].bottom<bounds[1].top&&bounds[1].bottom<bounds[2].top,JSON.stringify(bounds));
  await page.evaluate(async()=>{const {showNotice}=await import('./notifications.mjs');showNotice('第四条替换最旧提示',{detail:'同一图层最多保留三条，新消息在上方。',tone:'info',duration:20000});});
  assert.equal(await page.locator('.notice-slot').count(),3);assert.deepEqual(await page.locator('.notice-content strong').allTextContents(),['第四条替换最旧提示','第三条提示','第二条提示']);
  await page.waitForTimeout(330);await page.screenshot({path:path.join(output,'04-最多三条-向下叠放.png')});
  const bar=page.locator('.notice-countdown').first();const scaleBefore=await bar.evaluate(e=>getComputedStyle(e).transform);
  await page.getByRole('button',{name:'完整课表',exact:true}).click();assert.equal(await page.locator('.notice-slot').count(),3);assert.equal(await page.locator('.notice-slot').first().getAttribute('data-notice-id'),String(ids[2]+1));
  await page.waitForTimeout(400);assert.notEqual(await bar.evaluate(e=>getComputedStyle(e).transform),scaleBefore,'countdown continues across page rendering');
  await page.locator('.notice-close').first().click();
  const exit=await page.locator('.notice-card.is-leaving').evaluate(e=>({name:getComputedStyle(e).animationName,frames:e.getAnimations()[0].effect.getKeyframes()}));
  assert.equal(exit.name,'notice-leave');assert.ok(exit.frames[1].transform.includes('-100%'),'exit retracts to the left');
  await page.waitForFunction(()=>document.querySelectorAll('.notice-slot').length===2);
  await page.evaluate(async()=>{const {dismissNotice}=await import('./notifications.mjs');document.querySelectorAll('.notice-slot').forEach(s=>dismissNotice(Number(s.dataset.noticeId)));});await page.waitForFunction(()=>!document.querySelector('.notice-slot'));
  await page.evaluate(async()=>{const {showNotice}=await import('./notifications.mjs');showNotice('<b>纯文本安全提示</b>',{duration:1200,background:'#123456',textColor:'#ffffff',barColor:'#ffdd00'});});
  const custom=await page.locator('.notice-card').evaluate(e=>({bg:getComputedStyle(e).backgroundColor,bar:getComputedStyle(e.querySelector('.notice-countdown')).backgroundColor,html:e.querySelector('b'),entry:getComputedStyle(e).animationName}));
  assert.equal(custom.bg,'rgb(18, 52, 86)');assert.equal(custom.bar,'rgb(255, 221, 0)');assert.equal(custom.html,null);assert.equal(custom.entry,'notice-enter');
  await page.waitForFunction(()=>!!document.querySelector('.notice-card.is-leaving'));await page.waitForFunction(()=>!document.querySelector('.notice-slot'));
  await page.evaluate(async()=>{const {showNotice}=await import('./notifications.mjs');showNotice('刷新后状态保留',{tone:'success',duration:700});});
  await page.getByRole('button',{name:'今日课表',exact:true}).click();await waitState('success');await page.waitForFunction(()=>!document.querySelector('.notice-slot'));assert.equal(await pill.innerText(),'已确认无变化');
  assert.deepEqual(errors,[]);console.log('PASS: yellow progress, red failure with preserved schedule, cancellation, green recovery, no banner/layout shifts, newest-first three-item stack, oldest eviction, solid countdown, left entry/exit below subtitle without covering the logo, configurable colors, no HTML injection, timers survive navigation.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
