const {_electron:electron}=require('playwright'),path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{
 const output=path.resolve('D:/ChatGPT/2026-10-10/files-pasted-by-the-user-d/outputs/排查日志-1.1.6-验证');await fs.mkdir(output,{recursive:true});
 const app=await electron.launch({args:[path.resolve('.')],env:{...process.env,TOMORROW_TEST:'1'}});
 try{
  await app.evaluate(({BrowserWindow,dialog,app},{output})=>{
   BrowserWindow.getAllWindows().forEach(w=>{w.setPosition(-5000,0);w.showInactive();});global.diagFolder=app.getPath('userData');global.diagSaves=[];
   dialog.showSaveDialog=async(_window,options)=>{global.diagSaves.push(options);if(global.diagSaves.length===1)return {canceled:true};return {canceled:false,filePath:output+'/排查日志-脱敏验证.txt'};};
  },{output});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.locator('#consent-check').check();await page.locator('#consent-accept').click();await page.locator('.day-swipe').waitFor();
  await app.evaluate(({ipcMain})=>{
   const original=ipcMain._invokeHandlers.get('app:request');ipcMain.removeHandler('app:request');
   ipcMain.handle('app:request',(event,action,p={})=>['sync','capture'].includes(action)?{semesterId:'2026-2027-1',totalWeeks:25,rows:[
    {kc_mc:'测试晚间课程',jg0101mc:'测试教师',sktime:'周一第9、10节{第4-16周}(全部)',skddmc:'测试楼A101',jx0404id:'night'},
    {kc_mc:'测试认识实习',jg0101mc:'测试教师',sktime:'第4周',skddmc:'',jx0404id:'internship'}]}:original(event,action,p));
  });
  await page.getByRole('button',{name:'设置与数据',exact:true}).click();await page.getByRole('button',{name:'读取学校课表',exact:true}).click();await page.getByRole('button',{name:'采用完整学校课表',exact:true}).click();
  const saved=await page.evaluate(()=>native.request('loadState'));assert.equal(saved.snapshot.rules.length,1);assert.deepEqual([saved.snapshot.rules[0].startTime,saved.snapshot.rules[0].endTime],['19:00','20:25']);assert.equal(saved.snapshot.unscheduled[0].name,'测试认识实习');
  await page.getByRole('button',{name:'完整课表',exact:true}).click();await page.selectOption('#week-select','7');await page.getByText('测试认识实习',{exact:false}).waitFor();await page.getByText('测试晚间课程',{exact:true}).click();await page.getByText('19:00–20:25 · 9、10 节',{exact:true}).waitFor();await page.locator('.modal [data-action=close]').first().click();
  await page.setViewportSize({width:430,height:932});await page.screenshot({path:path.join(output,'晚课与未排时间课程.png'),fullPage:true});
  const folder=await app.evaluate(()=>global.diagFolder),secret='private-account-cookie-ticket-course';
  await fs.writeFile(path.join(folder,'school-session.enc'),secret);
  await fs.writeFile(path.join(folder,'diagnostics.log'),[
    '10-12 11:00:00 school-page http-error=503 page=school-login method=POST',
    '10-12 11:00:01 profile-read recognized=true links=2 path='+secret,
    '10-12 11:00:02 cookies='+secret,
    '10-12 11:00:03 url=https://example.invalid/?ticket='+secret,
  ].join('\n')+'\n');
  await page.evaluate(()=>native.request('recordDiagnostic',{kind:'http',httpStatus:503}));
  const baseline=await fs.readFile(path.join(folder,'state.json'),'utf8');
  for(const [label,width,height] of [['手机',430,932],['电脑',1280,900]]){
   await page.setViewportSize({width,height});await page.getByRole('button',{name:'设置与数据',exact:true}).click();
   assert.equal(await page.locator('[data-action=export-diagnostics]').count(),1);assert.equal(await page.locator('#sample-mode-entry [data-action=export-diagnostics]').count(),1);assert.equal(await page.locator('#sample-mode-entry').evaluate(node=>node.nextElementSibling.tagName),'FOOTER');
   await page.locator('#sample-mode-entry').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,label+'-底部排查入口.png'),fullPage:false});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page.getByRole('button',{name:'导出排查日志',exact:true}).click();await page.getByText('已取消保存',{exact:true}).waitFor();
  await page.getByRole('button',{name:'导出排查日志',exact:true}).click();await page.getByText('排查日志已保存',{exact:true}).waitFor();
  const text=await fs.readFile(path.join(output,'排查日志-脱敏验证.txt'),'utf8');assert.match(text,/1\.1\.6/);assert.match(text,/http-error=503/);assert.match(text,/import-error kind=http http-status=503/);assert.doesNotMatch(text,/private-account|example\.invalid|ticket=|cookies=/);
  const dialogs=await app.evaluate(()=>global.diagSaves);assert.equal(dialogs.length,2);assert.deepEqual(dialogs[1].filters[0].extensions,['txt']);assert.match(dialogs[1].defaultPath,/^江水课表-排查日志-.*\.txt$/);
  assert.equal(await fs.readFile(path.join(folder,'state.json'),'utf8'),baseline);assert.equal(await fs.readFile(path.join(folder,'school-session.enc'),'utf8'),secret);
  await page.getByRole('button',{name:'进入示例模式',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.locator('.sample-mode-banner').count(),0);
  await page.getByRole('button',{name:'进入示例模式',exact:true}).click();await page.getByRole('button',{name:'确认进入示例模式',exact:true}).click();await page.locator('.sample-mode-banner').waitFor();
  await page.getByRole('button',{name:'设置与数据',exact:true}).click();await page.getByRole('button',{name:'导出排查日志',exact:true}).click();await page.getByText('排查日志已保存',{exact:true}).waitFor();
  assert.equal(await fs.readFile(path.join(folder,'state.json'),'utf8'),baseline);assert.equal(await fs.readFile(path.join(folder,'school-session.enc'),'utf8'),secret);assert.deepEqual(errors,[]);
  console.log('DIAGNOSTICS UI PASS: native TXT save/cancel/retry; phone/desktop final panel; no overflow; credentials and state preserved; sample confirm/export isolation; actual read normalization of night and unscheduled course; fixed-field privacy.');
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
