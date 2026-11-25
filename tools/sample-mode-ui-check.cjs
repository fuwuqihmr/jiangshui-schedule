const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const {createState,clone,sourceDay,saveOverride,saveCourseSettings}=await import('../web/core.mjs');
 const {withStudyPolicy}=await import('../web/study.mjs');
 const base=JSON.parse(await fs.readFile(path.join(__dirname,'../web/data/baseline.json'),'utf8'));
 const calendar=JSON.parse(await fs.readFile(path.join(__dirname,'../web/data/holidays.json'),'utf8'));
 base.source={kind:'school',label:'学校教务系统 · 测试数据'};base.remaps=[];base.closedDates=[];base.rules=[{id:'personal',name:'个人课表保留测试',teacher:'教师',room:'A101',weekday:1,weeks:[7,8],periods:[1,2],startTime:'08:30',endTime:'09:55'}];
 let fixture=createState(withStudyPolicy(base,{enrollmentYear:2026},calendar,{studyPolicy:{userEnabled:true}}));
 fixture=saveOverride(fixture,sourceDay(fixture.snapshot,'2026-10-12')[0],{room:'仅当天的教室'});
 fixture=saveCourseSettings(fixture,fixture.snapshot.rules[0],{teacher:'个人指定教师'});
 fixture.localMaps=[{id:'personal-map',date:'2026-10-17',fromDate:'2026-10-19',mode:'replace'}];
 fixture.events=[{id:'personal-event',key:'2026-10-12/personal',date:'2026-10-12',name:'个人课表保留测试',before:null,after:sourceDay(fixture.snapshot,'2026-10-12')[0],fields:['name'],type:'新增',source:'school',read:true,detectedAt:'2026-10-12T00:00:00Z'}];
 fixture.theme='light';fixture.lastSuccess='2026-10-12T00:00:00Z';fixture._revision=3;
 for(const [label,width,height] of [['电脑',1280,950],['手机',412,920]]){
  const app=await electron.launch({args:[path.resolve('.')],env:{...process.env,TOMORROW_TEST:'1'}});
  try{
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.setPosition(-5000,0);w.showInactive();}));
   const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height});
   await page.locator('#consent-check').check();await page.locator('#consent-accept').click();await page.locator('.day-swipe').waitFor();
   await app.evaluate(({ipcMain,app},seed)=>{
    global.sampleModeState=seed;global.sampleModeCalls=[];global.sampleModeFolder=app.getPath('userData');
    ipcMain.removeHandler('app:request');ipcMain.handle('app:request',async(_event,action,p={})=>{
     global.sampleModeCalls.push(action);
     if(action==='consentStatus')return {version:'2026-10-17.1',acceptedAt:'2026-10-10T00:00:00Z'};
     if(action==='loadState')return JSON.parse(JSON.stringify(global.sampleModeState));
     if(action==='saveState'){global.sampleModeState=p.state;global.sampleModeState._revision++;return {revision:global.sampleModeState._revision};}
     if(action==='sync')return {snapshot:JSON.parse(JSON.stringify(global.sampleModeState.snapshot))};
     if(action==='runtimeStatus')return {enabled:true,exact:true};
     return {ok:true};
    });
   },clone(fixture));
   const folder=await app.evaluate(()=>global.sampleModeFolder),sentinelFile=path.join(folder,'school-session.enc');await fs.writeFile(sentinelFile,'cookie-preservation-sentinel');
   await page.reload();await page.locator('.read-success').waitFor();
   const original=await app.evaluate(()=>{global.sampleModeCalls=[];return JSON.stringify(global.sampleModeState);});
   const storage=async()=>({...await app.evaluate(()=>({state:JSON.stringify(global.sampleModeState),calls:global.sampleModeCalls})),cookie:await fs.readFile(sentinelFile,'utf8')});
   await page.getByRole('button',{name:'设置与数据',exact:true}).click();
   assert.equal(await page.locator('[data-action=sample-mode]').count(),1);
   assert.equal(await page.locator('[data-action=baseline],[data-action=adjusted],[data-action=inject],[data-action=fail]').count(),0);
   assert.equal(await page.locator('#sample-mode-entry').evaluate(node=>node.nextElementSibling?.tagName),'FOOTER');
   await page.getByRole('button',{name:'进入示例模式',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.locator('.sample-mode-banner').count(),0);
   await page.getByRole('button',{name:'进入示例模式',exact:true}).click();await page.getByRole('button',{name:'确认进入示例模式',exact:true}).click();await page.locator('.sample-mode-banner').waitFor();
   assert.equal((await storage()).state,original);assert.equal(await page.locator('[data-action=sync]').count(),0);
   assert.equal(await page.locator('.quick-tools').count(),0);
   await page.getByRole('button',{name:'完整课表',exact:true}).click();await page.selectOption('#week-select','7');assert.ok(await page.locator('.course-card').count());
   await page.locator('.course-card').first().click();assert.equal(await page.locator('.modal [data-action=edit],.modal [data-action=course-settings]').count(),0);await page.locator('.modal [data-action=close]').first().click();
   await page.evaluate(()=>{for(const action of ['restore-confirm','logout-confirm','sync','baseline-confirm']){const button=document.createElement('button');button.dataset.action=action;document.body.appendChild(button);button.click();button.remove();}});
   assert.equal((await storage()).state,original);assert.equal((await storage()).cookie,'cookie-preservation-sentinel');assert.deepEqual((await storage()).calls,[]);
   await app.evaluate(()=>{global.sampleModeState.snapshot.rules[0].room='后台更新后的教室';global.sampleModeState._revision++;});
   await page.evaluate(async()=>{globalThis.Android={};await globalThis.onNativeResume();delete globalThis.Android;});assert.equal(await page.locator('.sample-mode-banner').count(),1);
   await page.getByRole('button',{name:'退出示例模式',exact:true}).click();assert.equal(await page.locator('.sample-mode-banner').count(),0);assert.equal(await page.locator('.stat-line').filter({hasText:'已保存修改 / 调休'}).locator('strong').innerText(),'1 / 1');
   const preserved=JSON.parse((await storage()).state);assert.equal(preserved.snapshot.rules[0].room,'后台更新后的教室');assert.deepEqual(preserved.overrides,fixture.overrides);assert.deepEqual(preserved.localMaps,fixture.localMaps);assert.deepEqual(preserved.courseSettings,fixture.courseSettings);assert.deepEqual(preserved.events,fixture.events);
   await page.getByRole('button',{name:'进入示例模式',exact:true}).click();await page.getByRole('button',{name:'确认进入示例模式',exact:true}).click();await page.locator('.sample-mode-banner').waitFor();await page.reload();await page.locator('.read-success').waitFor();assert.equal(await page.locator('.sample-mode-banner').count(),0);
   assert.equal((await storage()).cookie,'cookie-preservation-sentinel');assert.deepEqual(errors,[]);console.log(label+' sample preview PASS: confirmation, no writes, preserves edits/cookies, background update, restart restoration');
  }finally{await app.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
