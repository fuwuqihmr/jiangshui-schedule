const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
(async()=>{
 const root=process.argv[2],out=process.argv[3];
 const fixture=JSON.parse(await fs.readFile(path.join(root,'web/data/baseline.json'),'utf8'));
 const state={version:1,snapshot:fixture,events:[],overrides:[],localMaps:[],holidaySettings:{},courseSettings:{},customCourses:[],theme:'light',lastSuccess:null,lastAttempt:null,error:null,notificationEnabled:false,classReminders:{enabled:false,leadMinutes:30,afterStartMinutes:5},autoCheckEnabled:false};
 const app=await electron.launch({args:[root,'--force-device-scale-factor=3'],env:{...process.env,TOMORROW_TEST:'1'}});
 try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.setPosition(-5000,0);w.showInactive();}));
  await app.evaluate(({ipcMain},{state})=>{
   global.shotState=state; ipcMain.removeHandler('app:request');
   const nextFor=hm=>{const [h,m]=hm.split(':').map(Number),day=new Date(Date.now()+28800000);const t=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),h-8,m);return t>Date.now()?t:t+86400000;};
   ipcMain.handle('app:request',async(_e,action,p={})=>{
    if(action==='consentStatus')return {version:'2026-10-17.1',acceptedAt:'2026-10-10T00:00:00Z'};
    if(action==='loadState')return global.shotState;
    if(action==='saveState'){global.shotState=p.state;global.shotState._revision=(global.shotState._revision||0)+1;return {revision:global.shotState._revision};}
    if(action==='runtimeStatus')return {enabled:false,time:'22:00',exact:true,next:0};
    if(action==='configureAutoCheck')return {enabled:p.enabled,time:p.time,exact:true,next:nextFor(p.time)};
    return {ok:true};
   });
  },{state});
  const page=await app.firstWindow();
  await page.setViewportSize({width:430,height:932});
  await page.addInitScript(()=>{globalThis.Android={};});
  await page.reload();
  await page.locator('.day-swipe').waitFor();
  await page.evaluate(async()=>{await globalThis.onNativeResume();});
  await page.getByRole('button',{name:'设置与数据',exact:true}).click();
  await page.locator('#auto-check-time').waitFor();
  const time=page.locator('#auto-check-time');
  await time.fill('21:30');
  await time.dispatchEvent('change');
  await page.waitForFunction(()=>document.querySelector('#auto-check-time')?.value==='21:30');
  await page.evaluate(()=>document.querySelectorAll('#notification-root .notice-close').forEach(button=>button.click()));await page.waitForFunction(()=>!document.querySelector('#notification-root')?.children.length);await page.evaluate(()=>{const p=document.querySelector('#auto-check-time')?.closest('.panel');if(p)window.scrollTo(0,p.getBoundingClientRect().top+scrollY-12);});
  await page.waitForTimeout(250);
  await page.screenshot({path:path.join(out,'江水课表-1.2.0-beta4-每日检查时间设置-界面预览.png'),fullPage:false});
  await fs.writeFile(path.join(out,'江水课表-1.2.0-beta4-截图说明.txt'),'每日检查时间设置 · 手机版界面预览\n展示路径：设置与数据 → 提醒与运行方式。每日自动检查开关、北京时间和下次检查状态集中显示在此处；演示中检查当前关闭，时间为 21:30。\n晚自习设置单独留在“晚自习与课程设置”。此图由项目手机版界面按安卓手机屏幕尺寸生成，未连接实体手机。','utf8');
  console.log('Screenshot captured.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
