const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const output=path.resolve(process.env.TOMORROW_OUTPUT||path.resolve(root,'../../outputs'));
const directory=path.join(output,'手机端兜底场景截图-2026-10-12');
(async()=>{
 await fs.mkdir(directory,{recursive:true});
 const {createState,clone,effectiveDay,saveOverride,applySnapshot,today,weekday,weekOf,addDays}=await import('../web/core.mjs');
 const base=JSON.parse(await fs.readFile(path.join(root,'web/data/baseline.json'),'utf8'));
 const date=today(),week=weekOf(base,date),day=weekday(date);
 const moment=`${date}T07:00:00+08:00`;
 base.source={kind:'school',label:'学校教务系统 · 演示数据'};base.remaps=[];base.closedDates=[];base.exceptions=[];base.unscheduled=[];
 const row=(id,name,room,startTime,endTime,periods,extra={})=>({id,name,room,teacher:'演示教师',weekday:day,weeks:[week],periods,startTime,endTime,...extra});
 base.rules=[row('math','高等数学 B（上）','南 C303','10:15','11:40',[3,4]),row('english','大学英语','北 B201','14:00','15:25',[5,6])];
 const fixture=()=>{const state=createState(base);state.theme='light';state.lastSuccess=moment;state._revision=1;return state;};
 const app=await electron.launch({args:['--force-device-scale-factor=3',root],env:{...process.env,TOMORROW_TEST:'1'}});
 const files=[];
 try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.setPosition(-5000,0);w.showInactive();}));
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:430,height:932});const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:3,mobile:true,screenWidth:430,screenHeight:932});
  await page.locator('#consent-check').check();await page.locator('#consent-accept').click();await page.locator('.day-swipe').waitFor();
  const agreement=JSON.parse(await fs.readFile(path.join(root,'web/agreement.json'),'utf8'));
  await app.evaluate(({ipcMain},version)=>{
   ipcMain.removeHandler('app:request');global.fallbackMode='success';global.fallbackState=null;global.fallbackRows=[];
   ipcMain.handle('app:request',async(_event,action,p={})=>{
    if(action==='consentStatus')return {version,acceptedAt:'2026-10-10T00:00:00Z'};
    if(action==='loadState')return global.fallbackState;
    if(action==='setTheme')return {ok:true};
    if(action==='runtimeStatus')return {enabled:true,exact:true};
    if(action==='saveState'){global.fallbackState=p.state;global.fallbackState._revision++;return {revision:global.fallbackState._revision};}
    if(['sync','capture','openSchool'].includes(action)){
     if(global.fallbackMode==='slow-fail'){await new Promise(resolve=>setTimeout(resolve,1800));throw Error('学校服务暂时无法连接，已保留上次成功读取的课表');}
     return {snapshot:JSON.parse(JSON.stringify(global.fallbackState.snapshot))};
    }
    return {ok:true};
   });
  },agreement.version);
  const load=async(state)=>{
   await app.evaluate((_electron,value)=>{global.fallbackState=value;global.fallbackMode='success';},clone(state));
   await page.reload();await page.locator('.day-swipe').waitFor();await page.locator('#sync-status [data-state=success]').waitFor();await page.evaluate(()=>document.querySelectorAll('#notification-root .notice-close').forEach(button=>button.click()));await page.waitForFunction(()=>!document.querySelector('#notification-root')?.children.length);
   await page.evaluate(()=>{globalThis.Android={};});
   await page.locator('#day-date').fill(date);await page.locator('#day-date').dispatchEvent('change');await page.evaluate(()=>scrollTo(0,0));
  };
  const shot=async(name)=>{await page.evaluate(()=>document.querySelectorAll('#notification-root .notice-close').forEach(button=>button.click()));await page.waitForFunction(()=>!document.querySelector('#notification-root')?.children.length);const offset=await page.evaluate(()=>{return {x:scrollX,y:scrollY};});const image=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,clip:{x:offset.x,y:offset.y,width:430,height:932,scale:1}});await fs.writeFile(path.join(directory,name),Buffer.from(image.data,'base64'));files.push(name);};
  // Show two overlapping real source classes, both retained.
  const overlap=fixture();overlap.snapshot.rules=[row('math','高等数学 B（上）','南 C303','10:15','11:40',[3,4]),row('theory','军事理论','北 A101','10:15','11:40',[3,4])];
  await load(overlap);assert.equal(await page.getByText('时段重叠',{exact:true}).count(),2);await shot('01-课程重叠-同时保留并提示.png');
  await page.locator('.course-card').first().click();await page.getByText('此课程与当天另一节课时间重叠，实际安排请向学校确认。',{exact:true}).waitFor();await shot('02-课程重叠-详情提醒.png');
  // Generate actual change records through applySnapshot.
  const updated=clone(base);updated.rules[0].room='南 C305';updated.rules[1].startTime='15:45';updated.rules[1].endTime='17:10';updated.rules[1].periods=[7,8];
  const changes=applySnapshot(fixture(),updated,moment);assert.equal(changes.events.length,2);
  await load(changes);await page.getByText('发现变化',{exact:true}).waitFor();await shot('03-课程更新-今日课表标红.png');
  await page.locator('.nav [data-tab=changes]').click();assert.equal(await page.locator('.event').count(),2);await shot('04-课程更新-原值与新值对照.png');
  // School changed exactly the field previously edited locally: keep both versions.
  let conflict=fixture();conflict=saveOverride(conflict,effectiveDay(base,date)[0],{room:'南 C204'},moment);conflict=applySnapshot(conflict,updated,moment);
  await load(conflict);await page.locator('.course-card.conflicted').first().click();await page.getByText('! 来源冲突，等待处理',{exact:true}).waitFor();await shot('05-学校更新与手动修改冲突.png');
  // Failure uses the production reader error branch, preserving previous timetable.
  await load(fixture());await app.evaluate(()=>{global.fallbackMode='slow-fail';});await page.locator('[data-action=sync]').click();await page.locator('.read-spinner').waitFor();await shot('06-读取中-进度提示与旧课表.png');
  await page.getByText('未能确认最新课表',{exact:true}).waitFor();assert.equal(await page.locator('.course-list .course-card').count(),2);await shot('07-读取失败-保留上次课表.png');
  // A moved day is not scheduled twice; display only a grey vacancy in the old location.
  const moved=fixture();moved.localMaps=[{id:'demo-move',date:addDays(date,2),fromDate:date,mode:'replace'}];await load(moved);assert.ok(await page.locator('.course-card.vacant').count());await shot('08-调休后-原课程灰色空位.png');
  const empty=fixture();empty.snapshot.rules=empty.snapshot.rules.map(r=>({...r,weekday:day===7?1:day+1}));await load(empty);await page.getByText('今天没有已排课程',{exact:true}).waitFor();await shot('09-当天无课-明确空状态.png');
  // Document the new isolated preview entry and confirmation, without changing saved state.
  await load(fixture());await page.getByRole('button',{name:'设置与数据',exact:true}).click();await page.locator('#sample-mode-entry').scrollIntoViewIfNeeded();await shot('10-设置底部-唯一示例模式入口.png');
  await page.getByRole('button',{name:'进入示例模式',exact:true}).click();await shot('11-示例模式-进入二次确认.png');
  await page.getByRole('button',{name:'确认进入示例模式',exact:true}).click();await page.locator('.sample-mode-banner').waitFor();const sample=JSON.parse(await fs.readFile(path.join(root,'web/data/adjusted.json'),'utf8'));const sampleDate=Array.from({length:7},(_,i)=>addDays(date,i)).find(d=>effectiveDay(sample,d).length)||date;await page.locator('#day-date').fill(sampleDate);await page.locator('#day-date').dispatchEvent('change');await page.evaluate(()=>scrollTo(0,0));await shot('12-示例模式-保留个人数据的预览.png');
  assert.deepEqual(errors,[]);
  const descriptions=[
   '01：两门课时间重叠，双方保留，并显示“时段重叠”标记。',
   '02：课程详情提醒重叠，提示向学校核实。',
   '03：教室或时间发生更新，当日课程标记未读变化。',
   '04：变更记录对照更新前后的教室与时间。',
   '05：学校数据和单日人工修改同字段冲突，保留两份内容并提供选择。',
   '06：正在读取时显示进度，已有课程仍可查看。',
   '07：模拟学校连接失败，保留最后成功读取的课程。',
   '08：调休移走课程后，原时段显示灰色空位。',
   '09：明确显示当天无课状态。',
   '10：设置页最下方的唯一示例模式入口。',
   '11：进入示例模式前的二次确认。',
   '12：只读示例预览，个人课表与修改保留，并能随时退出。'
  ];
  await fs.writeFile(path.join(directory,'截图说明.txt'),['江水课表 · 手机端兜底场景','',`截图日期：${date}`,'使用独立的合成课程数据，不包含用户真实学校数据。','这些是应用实际页面在手机尺寸下的高清截图，不包含 Android 状态栏。','布局 430×932，PNG 实际像素 1290×2796。','',...files.map((file,index)=>`${file}\n${descriptions[index]}`)].join('\n'),'utf8');
  console.log(`MOBILE FALLBACK SHOWCASE PASS: ${files.length} screenshots at ${directory}`);
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
