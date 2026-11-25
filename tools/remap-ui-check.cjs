const {_electron:electron}=require('playwright');
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{
 const {createState}=await import('../web/core.mjs');
 const base=JSON.parse(await fs.readFile(path.join(__dirname,'../web/data/baseline.json'),'utf8'));
 base.rules=[{id:'monday',name:'周一原课',teacher:'甲',room:'A101',weekday:1,weeks:[7],periods:[5,6],startTime:'14:00',endTime:'15:25'},{id:'friday',name:'周五原课',teacher:'乙',room:'B102',weekday:5,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'}];base.remaps=[];base.closedDates=[];
 const fixture={...createState(base),showDayOverview:true},output=process.env.TOMORROW_OUTPUT||path.resolve('../../outputs');await fs.mkdir(output,{recursive:true});
 const app=await electron.launch({args:[path.resolve('.')],env:{...process.env,TOMORROW_TEST:'1'}});
 try{
  const page=await app.firstWindow();await page.locator('#consent-check').check();await page.getByRole('button',{name:'同意并使用',exact:true}).click();await page.waitForSelector('.day-swipe');const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({ipcMain},state)=>{ipcMain.removeHandler('app:request');global.remapFixture=state;global.remapState=JSON.parse(JSON.stringify(state));ipcMain.handle('app:request',async(_event,action,p)=>{if(action==='consentStatus')return {version:'2026-10-17.1',acceptedAt:'2026-10-10T00:00:00Z'};if(action==='loadState')return global.remapState;if(action==='saveState'){global.remapState=JSON.parse(JSON.stringify(p.state));global.remapState._revision=(global.remapState._revision||0)+1;return {revision:global.remapState._revision};}return {ok:true};});},fixture);
  for(const [label,width,height] of [['电脑',1280,950],['手机',412,900]]){
   await app.evaluate(()=>{global.remapState=JSON.parse(JSON.stringify(global.remapFixture));});await page.setViewportSize({width,height});await page.reload();await page.waitForSelector('.day-swipe');
   await page.getByRole('button',{name:'完整课表',exact:true}).click();await page.selectOption('#week-select','7');await page.getByRole('button',{name:'休假与调休',exact:true}).click();await page.getByRole('button',{name:'添加调休',exact:true}).click();
   assert.equal(await page.locator('#remap-form select[name=mode]').count(),0);
   await page.locator('#remap-form input[name=date]').fill('2026-10-16');await page.locator('#remap-form input[name=fromDate]').fill('2026-10-12');await page.getByRole('button',{name:'保存调休',exact:true}).click();await page.waitForSelector('.modal',{state:'detached'});
   const moved=page.locator('.week-cell[data-date="2026-10-12"][data-slot="5"] .vacant');await moved.waitFor();assert.equal(await moved.count(),1);
   const target=page.locator('.week-cell[data-date="2026-10-16"][data-slot="5"] .course-card:not(.vacant)');assert.equal(await target.locator('h3').innerText(),'周一原课');
   assert.equal(await page.locator('.week-cell[data-date="2026-10-16"][data-slot="1"] .course-card').count(),0);assert.equal(await page.locator('.week-cell[data-date="2026-10-16"][data-slot="1"].is-empty').count(),1);
   assert.equal(await page.locator('.week-cell[data-date="2026-10-16"][data-slot="3"].is-empty').count(),1);
   const style=await moved.evaluate(e=>getComputedStyle(e).backgroundColor);assert.equal(style,'rgb(232, 232, 232)');
   assert.equal(await page.locator('.local-undo-banner').evaluate(e=>e.nextElementSibling?.classList.contains('footer')),true,'周课表撤销框应位于内容末尾、页脚前');
   await page.screenshot({path:path.join(output,'调休灰色空位-'+label+'.png'),fullPage:true});
   await moved.click();await page.getByRole('button',{name:'查看上课日',exact:true}).click();assert.equal(await page.locator('.modal').count(),0);assert.equal(await page.locator('#day-date').inputValue(),'2026-10-16');assert.equal(await page.locator('.hero-count strong').innerText(),'1');
   assert.equal(await page.locator('.local-undo-banner').evaluate(e=>e.nextElementSibling?.classList.contains('footer')),true,'当日课表撤销框应位于内容末尾、页脚前');
   await page.reload();await page.waitForSelector('.day-swipe');await page.getByRole('button',{name:'完整课表',exact:true}).click();await page.selectOption('#week-select','7');await moved.waitFor();
   const undo=page.getByRole('button',{name:'撤销调课：10月12日 → 10月16日',exact:true});await undo.waitFor();await undo.click();await page.waitForFunction(()=>document.querySelectorAll('.course-card.vacant').length===0);assert.equal(await page.locator('.week-cell[data-date="2026-10-16"] .course-card h3').innerText(),'周五原课');assert.equal(await page.locator('.local-undo-banner').count(),0);
  }
  assert.deepEqual(errors,[]);console.log('REMAP UI PASS: desktop/mobile replacement, grey vacancies, navigation, count, persisted reload, bottom-positioned day/week undo, undo; no errors.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
