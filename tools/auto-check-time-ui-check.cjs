const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
(async()=>{
 const fixture=JSON.parse(await fs.readFile('web/data/baseline.json','utf8'));
 const state={version:1,snapshot:fixture,events:[],overrides:[],localMaps:[],holidaySettings:{},courseSettings:{},customCourses:[],theme:'system',lastSuccess:null,lastAttempt:null,error:null,notificationEnabled:false,classReminders:{enabled:false,leadMinutes:30,afterStartMinutes:5},autoCheckEnabled:false};
 const app=await electron.launch({args:[path.resolve('.'),'--force-device-scale-factor=1'],env:{...process.env,TOMORROW_TEST:'1'}});
 try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.setPosition(-5000,0);w.showInactive();}));
  const page=await app.firstWindow();await page.setViewportSize({width:430,height:932});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({ipcMain},{state})=>{
   global.autoCheckTest={state,calls:[],time:'22:00',enabled:false};ipcMain.removeHandler('app:request');
   ipcMain.handle('app:request',async(_event,action,p={})=>{const t=global.autoCheckTest;
    if(action==='consentStatus')return {version:'2026-10-17.1',acceptedAt:'2026-10-10T00:00:00Z'};
    if(action==='loadState')return t.state;if(action==='saveState'){t.state=p.state;return {revision:(t.state._revision||0)+1};}
    if(action==='runtimeStatus')return {enabled:t.enabled,time:t.time,exact:true,next:1792094400000};
    if(action==='configureAutoCheck'){t.calls.push({...p});t.enabled=p.enabled;t.time=p.time;return {enabled:t.enabled,time:t.time,exact:true,next:1792094400000};}
    return {ok:true};});
  },{state});
  await page.addInitScript(()=>{globalThis.Android={};});await page.reload();await page.locator('.day-swipe').waitFor();await page.getByRole('button',{name:'设置与数据',exact:true}).click();
  const panel=page.locator('.panel').filter({has:page.getByRole('heading',{name:'提醒与运行方式',exact:true})});await panel.waitFor();const time=panel.locator('#auto-check-time'),toggle=panel.locator('#auto-check');await time.waitFor();assert.equal(await time.inputValue(),'22:00');assert.equal(await time.isDisabled(),false);assert.equal(await toggle.isChecked(),false);assert.ok((await panel.innerText()).includes('已关闭'));assert.equal((await panel.innerText()).includes('每天 22:00 自动核对'),false);assert.equal(await page.getByRole('heading',{name:'晚自习与自动检查',exact:true}).count(),0);assert.equal(await page.locator('.panel').filter({has:page.getByRole('heading',{name:'晚自习与课程设置',exact:true})}).locator('#auto-check-time').count(),0);
  await time.fill('07:15');await page.waitForFunction(()=>document.querySelector('#auto-check-time')?.value==='07:15'&&document.querySelector('#notification-root')?.textContent.includes('07:15'));
  assert.deepEqual(await app.evaluate(()=>global.autoCheckTest.calls.at(-1)),{enabled:false,time:'07:15'});
  assert.equal(await panel.locator('#auto-check-time').inputValue(),'07:15');
  await toggle.check();await page.waitForFunction(()=>document.querySelector('#auto-check')?.checked===true);
  assert.deepEqual(await app.evaluate(()=>global.autoCheckTest.calls.at(-1)),{enabled:true,time:'07:15'});
  await toggle.uncheck();await page.waitForFunction(()=>document.querySelector('#auto-check')?.checked===false);
  assert.deepEqual(await app.evaluate(()=>global.autoCheckTest.calls.at(-1)),{enabled:false,time:'07:15'});
  await toggle.check();await page.waitForFunction(()=>document.querySelector('#auto-check')?.checked===true);
  assert.deepEqual(await app.evaluate(()=>global.autoCheckTest.calls.at(-1)),{enabled:true,time:'07:15'});
  assert.deepEqual(errors,[]);console.log('Auto-check time mobile settings PASS: reminder panel placement, closed-state label, default 22:00, custom persistence, toggle preservation');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

