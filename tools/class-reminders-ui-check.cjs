const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const output=path.resolve('D:/ChatGPT/2026-10-10/files-pasted-by-the-user-d/outputs/通知与锁屏-1.2.0-beta8');
const epoch=Date.parse('2026-10-12T08:10:00+08:00');
(async()=>{
 const {reminderWindows}=await import('../web/reminders.mjs');
 const {createState}=await import('../web/core.mjs');
 const {saveCustomCourse}=await import('../web/custom-courses.mjs');
 const snapshot=JSON.parse(await fs.readFile('web/data/baseline.json','utf8'));
 snapshot.source={kind:'school',label:'UI测试学校课表'};snapshot.rules=[{id:'math',name:'高等数学',room:'南C204',teacher:'李老师',weekday:1,weeks:[7,8],periods:[1,2],startTime:'08:30',endTime:'09:55'}];
 snapshot.remaps=[];snapshot.exceptions=[];snapshot.closedDates=[];
 let fixture=createState(snapshot);
 fixture=saveCustomCourse(fixture,{mode:'once',date:'2026-10-12',name:'大学英语',room:'南A301',teacher:'陈老师',startTime:'08:30',endTime:'09:55'});
 fixture.reminderIntroAcknowledged=false;fixture.classReminderPreferenceSet=false;fixture.reminderPermissionAsked=false;fixture.classReminders={enabled:true,leadMinutes:30,afterStartMinutes:5};
 await fs.mkdir(output,{recursive:true});
 const app=await electron.launch({args:[path.resolve('.'),'--force-device-scale-factor=3'],env:{...process.env,TOMORROW_TEST:'1'}});
 try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.setPosition(-5000,0);w.showInactive();}));
  const page=await app.firstWindow(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:430,height:932});
  await page.addInitScript(({epoch})=>{const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[epoch]));}static now(){return epoch;}};globalThis.Android={preview:true};},{epoch});
  await app.evaluate(async({ipcMain},{fixture,epoch,windows})=>{
   global.reminderTest={state:JSON.parse(JSON.stringify(fixture)),epoch,closed:[],closeCalls:0,requests:0,permission:true};
   global.testReminderStatus=()=>({enabled:global.reminderTest.state.classReminders?.enabled===true,notificationsAllowed:global.reminderTest.permission,exact:true,notificationStatus:{enabled:true,importance:4,lockVisibility:1,activeCount:2,groupedCount:0,focus:{xiaomi:true,checked:true,protocol:3,allowed:false}},active:global.reminderTest.state.classReminders?.enabled?windows.filter(r=>!global.reminderTest.closed.includes(r.id)&&r.startAt-global.reminderTest.state.classReminders.leadMinutes*60000<=epoch&&epoch<r.startAt+global.reminderTest.state.classReminders.afterStartMinutes*60000).map(r=>({...r,expiresAt:r.startAt+global.reminderTest.state.classReminders.afterStartMinutes*60000})):[]});
   ipcMain.removeHandler('app:request');
   ipcMain.handle('app:request',async(_e,a,p={})=>{
    const test=global.reminderTest;
    if(a==='consentStatus')return {version:'2026-10-17.1',acceptedAt:'2026-10-10T00:00:00Z'};
    if(a==='loadState')return test.state;
    if(a==='sync')return {snapshot:test.state.snapshot};
    if(a==='saveState'){test.state=JSON.parse(JSON.stringify(p.state));test.state._revision=(test.state._revision||0)+1;return {revision:test.state._revision};}
    if(a==='requestNotifications'){test.requests++;return {ok:test.permission};}
    if(a==='runtimeStatus')return {enabled:true,exact:true};
    if(a==='previewClassReminder'){test.previews=(test.previews||0)+1;test.lockPreview=p.lockedTest===true;return {ok:true,delayed:test.lockPreview};}
    if(a==='classReminderSystemSettings'){test.channelSettings=(test.channelSettings||0)+1;return {ok:true};}
    if(a==='classReminderStatus')return global.testReminderStatus();
    if(a==='closeClassReminder'){test.closeCalls++;test.closed.push(p.id);return global.testReminderStatus();}
    return {ok:true};
   });
  },{fixture,epoch,windows:reminderWindows({...fixture,classReminders:{enabled:true,leadMinutes:30,afterStartMinutes:5}},epoch)});
  await page.reload();
  await page.locator('.day-swipe').waitFor();
  await page.waitForFunction(()=>document.querySelector('#day-date')?.value==='2026-10-12');
  assert.equal(await app.evaluate(()=>global.reminderTest.state.classReminders.enabled),true);
  assert.equal(await page.locator('.reminder-intro').count(),1);
  assert.match(await page.locator('.reminder-intro').innerText(),/设置与数据/);
  await page.screenshot({path:path.join(output,'04-默认开启上课提醒横条.png'),fullPage:true});
  await page.getByRole('button',{name:'了解了',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.reminder-intro')===null);
  assert.equal(await app.evaluate(()=>global.reminderTest.state.reminderIntroAcknowledged),true);
  await page.reload();await page.locator('.day-swipe').waitFor();
  assert.equal(await page.locator('.reminder-intro').count(),0);
  await page.getByRole('button',{name:'设置与数据',exact:true}).click();
  await page.getByRole('button',{name:'预览通知卡片',exact:true}).click();assert.equal(await app.evaluate(()=>global.reminderTest.previews),1);
  await page.getByRole('button',{name:'锁屏测试（5秒后）',exact:true}).click();assert.equal(await app.evaluate(()=>global.reminderTest.lockPreview),true);
  await page.getByRole('button',{name:'设置上课提醒分类',exact:true}).click();assert.equal(await app.evaluate(()=>global.reminderTest.channelSettings),1);
  assert.match(await page.locator('.settings-grid').innerText(),/本机暂未允许/);await page.screenshot({path:path.join(output,'05-通知分类与锁屏检查.png'),fullPage:true});
  await page.getByRole('button',{name:'设置上课提醒',exact:true}).click();
  assert.equal(await page.locator('[name=enabled]').isChecked(),true);
  assert.equal(await page.locator('[name=leadMinutes]').inputValue(),'30');
  assert.equal(await page.locator('[name=afterStartMinutes]').inputValue(),'5');
  await page.locator('[name=enabled]').uncheck();
  await page.getByRole('button',{name:'保存上课提醒',exact:true}).click();
  assert.equal(await app.evaluate(()=>global.reminderTest.state.classReminders.enabled),false);
  assert.equal(await app.evaluate(()=>global.reminderTest.state.classReminderPreferenceSet),true);
  await page.getByRole('button',{name:'今日课表',exact:true}).click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.class-reminder-card').count(),0);
  await page.reload();await page.locator('.day-swipe').waitFor();assert.equal(await page.locator('.reminder-intro').count(),0);
  await page.getByRole('button',{name:'设置与数据',exact:true}).click();await page.getByRole('button',{name:'设置上课提醒',exact:true}).click();
  await page.locator('[name=enabled]').check();await page.getByRole('button',{name:'保存上课提醒',exact:true}).click();
  await page.getByRole('button',{name:'今日课表',exact:true}).click();
  await page.locator('.class-reminder-card').first().waitFor();
  assert.equal(await page.locator('.class-reminder-card').count(),2);
  const math=page.locator('.class-reminder-card').filter({hasText:'高等数学'});
  assert.ok((await math.innerText()).includes('南C204'));assert.ok((await math.innerText()).includes('李老师'));
  await page.evaluate(()=>document.querySelectorAll('#notification-root .notice-close').forEach(button=>button.click()));await page.waitForFunction(()=>!document.querySelector('#notification-root')?.children.length);
  await page.screenshot({path:path.join(output,'01-首页上课提醒.png'),fullPage:true});
  for(const width of [360,430])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:932});await page.evaluate(async theme=>{const m=await import('./theme.mjs');m.applyTheme(theme);},theme);
   const reminder=page.locator('.class-reminder-card').filter({hasText:'高等数学'});
   assert.match(await reminder.locator('.class-reminder-countdown').innerText(),/20分钟后上课/);
   const box=await reminder.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,'Reminder card fits the viewport');
   assert.equal(await reminder.getByRole('button',{name:'关闭本次提醒',exact:true}).isVisible(),true);
   await page.screenshot({path:path.join(output,`通知卡片-首页-${width}px-${theme}.png`),fullPage:true});
  }
  await page.setViewportSize({width:430,height:932});await page.evaluate(async()=>{const m=await import('./theme.mjs');m.applyTheme('light');});

  await math.getByRole('button',{name:'关闭本次提醒',exact:true}).click();
  assert.equal(await app.evaluate(()=>global.reminderTest.closeCalls),0);
  await page.screenshot({path:path.join(output,'02-关闭提醒二次确认.png'),fullPage:true});
  await page.getByRole('button',{name:'保留提醒',exact:true}).click();
  assert.equal(await page.locator('.class-reminder-card').count(),2);
  await math.getByRole('button',{name:'关闭本次提醒',exact:true}).click();
  await page.getByRole('button',{name:'确认关闭本次提醒',exact:true}).click();
  await page.locator('.modal').waitFor({state:'detached'});
  assert.equal(await app.evaluate(()=>global.reminderTest.closeCalls),1);
  assert.equal(await page.locator('.class-reminder-card').count(),1);
  await page.reload();await page.locator('.day-swipe').waitFor();await page.locator('.class-reminder-card').waitFor();
  assert.equal(await page.locator('.class-reminder-card').count(),1);
  await page.getByRole('button',{name:'设置与数据',exact:true}).click();await page.getByRole('button',{name:'设置上课提醒',exact:true}).click();
  await page.locator('[name=leadMinutes]').fill('45');await page.locator('[name=afterStartMinutes]').fill('10');
  await page.screenshot({path:path.join(output,'03-上课提醒时间设置.png'),fullPage:true});
  await page.getByRole('button',{name:'保存上课提醒',exact:true}).click();
  assert.equal(await app.evaluate(()=>global.reminderTest.state.classReminders.leadMinutes),45);
  assert.equal(await app.evaluate(()=>global.reminderTest.state.classReminders.afterStartMinutes),10);
  await page.evaluate(()=>window.openChanges());assert.equal(await page.locator('.app-title h1').innerText(),'变更记录');
  await page.evaluate(()=>window.openToday('2026-10-12'));assert.equal(await page.locator('#day-date').inputValue(),'2026-10-12');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'截图说明.txt'),'这组截图为 1.2.0-beta8 手机版页面演示数据预览，不含个人课表或凭据。\n01：首页显示上课内容、时间、地点、老师和距开课分钟数。通知卡片-首页-*展示360px和430px下的黑白两种外观。\n02：关闭单次提醒必须二次确认，取消确认后提醒仍保留。\n03：提前提醒时间和开课后保留时间可调整。\n04：首次打开显示默认开启说明横条，点击“了解了”后保存且不再重复显示。\n锁屏通知仍由 Android 原生通知负责；本组为界面自动化预览。\n','utf8');
  console.log('CLASS REMINDER BETA8 UI PASS: card layouts at 360/430px light/dark, countdown, preview button, default-on banner, one-time acknowledgement, explicit disable/enable, notification fields, reminder content, double-confirm close, persistence, no errors.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
