const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const [{createState},{withStudyPolicy}]=await Promise.all([import('../web/core.mjs'),import('../web/study.mjs')]);
 const base=JSON.parse(await fs.readFile(path.join(__dirname,'../web/data/baseline.json'),'utf8'));
 const calendar=JSON.parse(await fs.readFile(path.join(__dirname,'../web/data/holidays.json'),'utf8'));
 base.rules=[
  {id:'monday',name:'周一原课',teacher:'甲',room:'A101',weekday:1,weeks:[7],periods:[5,6],startTime:'14:00',endTime:'15:25'},
  {id:'friday',name:'周五原课',teacher:'乙',room:'B102',weekday:5,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'}
 ];base.remaps=[];base.closedDates=[];
 const fixture=createState(withStudyPolicy(base,{enrollmentYear:2026},calendar,{studyPolicy:{userEnabled:true}}));
 const output=path.resolve(__dirname,'../../../../../2026-10-10/files-pasted-by-the-user-d/outputs/build-1.1.9-rc1');
 await fs.mkdir(output,{recursive:true});
 const app=await electron.launch({args:[path.resolve('.')],env:{...process.env,TOMORROW_TEST:'1'}});
 try{
  const page=await app.firstWindow();await page.locator('#consent-check').check();await page.getByRole('button',{name:'同意并使用',exact:true}).click();await page.locator('.day-swipe').waitFor();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await app.evaluate(({ipcMain},data)=>{ipcMain.removeHandler('app:request');global.checkState=JSON.parse(JSON.stringify(data));ipcMain.handle('app:request',async(_event,action,p)=>{if(action==='consentStatus')return {version:'2026-10-17.1',acceptedAt:'2026-10-10T00:00:00Z'};if(action==='loadState')return global.checkState;if(action==='saveState'){global.checkState=JSON.parse(JSON.stringify(p.state));global.checkState._revision=(global.checkState._revision||0)+1;return {revision:global.checkState._revision};}return {ok:true};});},fixture);
  for(const [label,width,height] of [['desktop',1280,950],['phone',412,900]]){
   await app.evaluate((_params,data)=>{global.checkState=JSON.parse(JSON.stringify(data));},fixture);
   await page.setViewportSize({width,height});await page.reload();await page.locator('.day-swipe').waitFor();
   assert.equal(await page.locator('.primary-tools button').count(),2,'Top actions stay compact');
   await page.locator('[data-action=holiday-settings]').first().click();
   if(label==='phone')await page.screenshot({path:path.join(output,'休假设置-入口-phone.png'),fullPage:true});
   await page.locator('#winter-holiday-form input[name=startDate]').fill('2026-10-12');await page.locator('#winter-holiday-form input[name=endDate]').fill('2026-10-13');
   await page.locator('#winter-holiday-form button[type=submit]').click();
   await page.locator('#holiday-day-form input[name=date]').fill('2026-10-12');await page.locator('#holiday-day-form input[name=skipStudy]').check();
   await page.locator('#holiday-day-form button[type=submit]').click();
   await page.locator('.modal [data-action=close]').first().click();await page.locator('#day-date').fill('2026-10-12');
   assert.equal(await page.locator('.course-list .course-card').count(),0,'One-day leave removes study too');
   await page.locator('[data-action=holiday-settings]').first().click();await page.locator('[data-action=delete-holiday-day]').click();await page.locator('.modal [data-action=close]').first().click();
   assert.deepEqual(await page.locator('.course-list .course-card h3').allInnerTexts(),['晚自习'],'Winter holiday retains study by default');
   await page.locator('[data-action=holiday-settings]').first().click();await page.locator('[data-action=delete-holiday-range]').first().click();
   await page.locator('[data-action=remap]').first().click();await page.locator('#remap-form input[name=date]').fill('2026-10-16');await page.locator('#remap-form input[name=fromDate]').fill('2026-10-12');
   await page.locator('#remap-form button[type=submit]').click();await page.locator('#day-date').fill('2026-10-16');
   assert.deepEqual(await page.locator('.course-list .course-card h3').allInnerTexts(),['周一原课','晚自习'],'Mapped day replaces old Friday even without conflict');
   await page.screenshot({path:path.join(output,`休假设置-${label}.png`),fullPage:true});
  }
  assert.deepEqual(errors,[]);console.log('HOLIDAY UI PASS: desktop/phone compact toolbar, range, per-day study opt-out, undo, full-day remap.');
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
