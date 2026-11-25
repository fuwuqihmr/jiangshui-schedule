const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const output=path.resolve('D:/ChatGPT/2026-10-10/files-pasted-by-the-user-d/outputs/自定义课程-功能预览');
(async()=>{
 const {createState}=await import('../web/core.mjs');const snapshot=JSON.parse(await fs.readFile('web/data/baseline.json','utf8'));
 snapshot.source={kind:'school',label:'学校课表 · 测试数据'};snapshot.rules=[{id:'school',name:'学校课程',room:'学校 A101',teacher:'甲',weekday:1,weeks:[7,8],periods:[3,4],startTime:'10:15',endTime:'11:40'}];snapshot.remaps=[];snapshot.closedDates=[];snapshot.exceptions=[];
 await fs.mkdir(output,{recursive:true});
 for(const [label,width,height] of [['电脑',1280,950],['手机',430,932]]){
  const app=await electron.launch({args:[path.resolve('.')],env:{...process.env,TOMORROW_TEST:'1'}});
  try{
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.setPosition(-5000,0);w.showInactive();}));
   const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height});
   await page.locator('#consent-check').check();await page.locator('#consent-accept').click();await page.locator('.day-swipe').waitFor();
   await app.evaluate(({ipcMain},fixture)=>{global.customTestState=fixture;global.customTestExport=null;ipcMain.removeHandler('app:request');ipcMain.handle('app:request',async(_e,a,p={})=>{
    if(a==='consentStatus')return {version:'2026-10-17.1',acceptedAt:'2026-10-10T00:00:00Z'};
    if(a==='loadState')return global.customTestState;
    if(a==='saveState'){global.customTestState=p.state;return {ok:true};}
    if(a==='sync')return {snapshot:global.customTestState.snapshot};
    if(a==='export'){global.customTestExport=p.text;return {ok:true};}
    if(a==='import')return {text:global.customTestExport};return {ok:true};
   });},createState(snapshot));
   await page.reload();await page.locator('#sync-status [data-state=success]').waitFor();await page.locator('#day-date').fill('2026-10-12');await page.locator('#day-date').dispatchEvent('change');
   await page.getByRole('button',{name:'添加自定义课程',exact:true}).click();
   assert.equal(await page.locator('[name=custom-mode]').count(),2);assert.equal(await page.locator('[data-custom-fields=once]').isVisible(),false);
   await page.locator('#custom-course-form [name=name]').fill('个人规律课程');await page.locator('[name=weekdays][value="3"]').check();await page.locator('[name=startWeek]').fill('7');await page.locator('[name=endWeek]').fill('10');await page.selectOption('[name=weekPattern]','odd');await page.locator('[name=startTime]').fill('11:00');await page.locator('[name=endTime]').fill('12:20');await page.locator('[name=room]').fill('南 C204');await page.locator('[name=teacher]').fill('自定义老师');
   await page.evaluate(()=>document.querySelectorAll('#notification-root .notice-close').forEach(button=>button.click()));await page.waitForFunction(()=>!document.querySelector('#notification-root')?.children.length);await page.screenshot({path:path.join(output,'规律上课表单-'+label+'.png')});await page.locator('#custom-course-form [type=submit]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'规律上课时间与保存-'+label+'.png')});
   await page.getByRole('button',{name:'添加课程',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});
   assert.equal(await page.locator('.course-list .course-card').filter({hasText:'个人规律课程'}).count(),1);assert.equal(await page.getByText('时段重叠',{exact:true}).count(),2);
   await page.locator('.course-card').filter({hasText:'个人规律课程'}).click();assert.ok(await page.getByText('自定义课程',{exact:true}).count());assert.equal(await page.getByRole('button',{name:'统一设置这类课程',exact:true}).count(),0);await page.getByRole('button',{name:'关闭',exact:true}).click();
   await page.getByRole('button',{name:'完整课表',exact:true}).click();await page.selectOption('#week-select','7');assert.equal(await page.locator('.week-cell .course-card').filter({hasText:'个人规律课程'}).count(),2);await page.locator('#search').fill('个规课');assert.equal(await page.locator('.week-cell .course-card').count(),2);await page.locator('#search').fill('');
   await page.selectOption('#week-select','8');assert.equal(await page.locator('.course-card').filter({hasText:'个人规律课程'}).count(),0);
   await page.getByRole('button',{name:'今日课表',exact:true}).click();await page.getByRole('button',{name:'添加自定义课程',exact:true}).click();await page.locator('[name=custom-mode][value=once]').check();assert.equal(await page.locator('[data-custom-fields=weekly]').isVisible(),false);assert.equal(await page.locator('[name=startWeek]').isDisabled(),true);
   await page.locator('#custom-course-form [name=name]').fill('独立加课');await page.locator('[name=date]').fill('2026-10-12');await page.locator('[name=startTime]').fill('22:00');await page.locator('[name=endTime]').fill('22:45');await page.locator('[name=room]').fill('活动室');
   await page.evaluate(()=>document.querySelectorAll('#notification-root .notice-close').forEach(button=>button.click()));await page.waitForFunction(()=>!document.querySelector('#notification-root')?.children.length);await page.screenshot({path:path.join(output,'独立加课表单-'+label+'.png')});await page.getByRole('button',{name:'添加课程',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});
   assert.equal(await page.locator('.course-list .course-card').filter({hasText:'独立加课'}).count(),1);await page.locator('.course-card').filter({hasText:'独立加课'}).click();await page.getByRole('button',{name:'修改今天',exact:true}).click();await page.locator('#edit-form [name=room]').fill('仅当天教室');await page.locator('#edit-form [type=submit]').click();await page.locator('.modal').waitFor({state:'detached'});assert.ok(await page.getByText('仅当天教室',{exact:true}).count());
   await page.getByRole('button',{name:'完整课表',exact:true}).click();await page.selectOption('#week-select','7');assert.equal(await page.locator('.week-cell .course-card').filter({hasText:'独立加课'}).count(),1);
   await page.evaluate(()=>document.querySelectorAll('#notification-root .notice-close').forEach(button=>button.click()));await page.waitForFunction(()=>!document.querySelector('#notification-root')?.children.length);await page.screenshot({path:path.join(output,'周课表显示-'+label+'.png'),fullPage:true});
   await page.getByRole('button',{name:'设置与数据',exact:true}).click();assert.equal(await page.getByRole('button',{name:'添加自定义课程',exact:true}).count(),2);assert.ok(await page.locator('.custom-course-record').filter({hasText:'个人规律课程'}).count());
   await page.locator('.custom-course-record').filter({hasText:'个人规律课程'}).getByRole('button',{name:'编辑',exact:true}).click();await page.locator('[name=room]').fill('规律新教室');await page.getByRole('button',{name:'保存自定义课程',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});
   await page.getByRole('button',{name:'导出课表 JSON',exact:true}).click();assert.equal(await app.evaluate(()=>JSON.parse(global.customTestExport).customCourses.length),2);await page.getByRole('button',{name:'导入课表 JSON',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#notification-root').textContent.includes('已读取课表'));
   await page.getByRole('button',{name:'进入示例模式',exact:true}).click();await page.getByRole('button',{name:'确认进入示例模式',exact:true}).click();assert.equal(await page.locator('[data-action=custom-course]').count(),0);await page.getByRole('button',{name:'退出示例模式',exact:true}).click();assert.equal(await app.evaluate(()=>global.customTestState.customCourses.length),2);
   await page.reload();await page.locator('#sync-status [data-state=success]').waitFor();await page.getByRole('button',{name:'设置与数据',exact:true}).click();assert.equal(await page.locator('.custom-course-record').count(),2);
   await page.locator('.custom-course-record').filter({hasText:'独立加课'}).getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.locator('.custom-course-record').count(),2);await page.locator('.custom-course-record').filter({hasText:'独立加课'}).getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});assert.equal(await page.locator('.custom-course-record').count(),1);assert.equal(await app.evaluate(()=>global.customTestState.overrides.length),0);
   assert.deepEqual(errors,[]);console.log(label+' CUSTOM COURSE UI PASS: weekly/once, details, overlap, week/search, edits, backup/sync/restart, preview, deletion.');
  }finally{await app.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});