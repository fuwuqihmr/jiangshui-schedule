const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const output=path.resolve(process.env.THEME_OUTPUT||'D:/ChatGPT/2026-10-10/files-pasted-by-the-user-d/outputs/课表布局-1.2.0-beta2');
(async()=>{
 const snapshot=JSON.parse(await fs.readFile('web/data/baseline.json','utf8'));
 snapshot.rules=[{id:'english',name:'大学英语读写译（一）',room:'南C102',teacher:'李老师',weekday:4,weeks:[7],periods:[5,6],startTime:'14:00',endTime:'15:25'},{id:'math',name:'高等数学B（上）',room:'南C101',teacher:'王老师',weekday:4,weeks:[7],periods:[7,8],startTime:'15:45',endTime:'17:10'}];
 const slots=[[1,2,'08:30','09:55'],[3,4,'10:15','11:40'],[5,6,'14:00','15:25'],[7,8,'15:45','17:10'],[9,11,'19:00','21:10']];
 for(let weekday=1;weekday<=7;weekday++)for(const [a,b,startTime,endTime] of slots){
  if(weekday===4&&(a===5||a===7))continue;
  snapshot.rules.push({id:`dense-${weekday}-${a}`,name:['习近平新时代中国特色社会主义思想概论','概率论与数理统计','毛泽东思想和中国特色社会主义理论体系概论','化工企业管理','党的基本理论知识'][slots.findIndex(s=>s[0]===a)],room:'逸夫实验楼C302东侧教室',teacher:'测试教师',weekday,weeks:[7],periods:Array.from({length:b-a+1},(_,i)=>a+i),startTime,endTime});
 }
 snapshot.remaps=[];snapshot.exceptions=[];snapshot.closedDates=[];
 const {createState}=await import('../web/core.mjs');
 const state={...createState(snapshot),showDayOverview:true,theme:'system',classReminders:{enabled:false,leadMinutes:30,afterStartMinutes:5},classReminderPreferenceSet:true,reminderIntroAcknowledged:true,settingsExpanded:{auto:true,display:true,leave:false,course:false,data:false,about:false}};
 const app=await electron.launch({args:[path.resolve('.'),'--force-device-scale-factor=2'],env:{...process.env,TOMORROW_TEST:'1'}});
 try{
  await fs.mkdir(output,{recursive:true});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.setPosition(-5000,0);w.showInactive();}));
  await app.evaluate(async ({ipcMain})=>{
   // The app registers its own app:request handler after Playwright attaches; wait for it
   // before replacing it, otherwise the main process registers a duplicate and never opens.
   for(let i=0;i<120;i++){
    if(ipcMain._invokeHandlers&&ipcMain._invokeHandlers.has('app:request'))return;
    await new Promise(resolve=>setTimeout(resolve,25));
   }
   throw new Error('app:request handler was not registered');
  });
  await app.evaluate(({ipcMain},state)=>{
   global.themeTest={state,calls:[]};ipcMain.removeHandler('app:request');
   ipcMain.handle('app:request',async(_e,a,p={})=>{
    if(a==='consentStatus')return {version:'2026-10-17.1',acceptedAt:'2026-10-10T00:00:00Z'};
    if(a==='loadState')return global.themeTest.state;
    if(a==='saveState'){global.themeTest.state=p.state;return {revision:(p.state._revision||0)+1};}
    if(a==='setTheme'){global.themeTest.calls.push(p);return {ok:true};}
    if(a==='runtimeStatus')return {enabled:false,time:'22:00',exact:true};
    if(a==='classReminderStatus')return {enabled:false,active:[],notificationsAllowed:true,exact:true};
    return {ok:true};
   });
  },state);
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:430,height:932});await page.emulateMedia({colorScheme:'light'});
  await page.addInitScript(()=>{
   const RealDate=Date,epoch=RealDate.parse('2026-10-15T15:50:00+08:00');
   globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[epoch]));}static now(){return epoch;}};
   globalThis.nativeTestDark=true;globalThis.Android={systemDarkMode:()=>globalThis.nativeTestDark};
  });
  await page.reload();await page.locator('.day-swipe').waitFor();
  const theme=async()=>page.locator('html').getAttribute('data-theme');
  const palette=()=>page.evaluate(()=>{
   const css=el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,color:s.color,accent:s.getPropertyValue('--card-accent').trim()};};
   return {body:css(document.body),hero:css(document.querySelector('.hero')),primary:css(document.querySelector('.button.primary')),card:css(document.querySelector('.course-card')),nav:css(document.querySelector('.nav .active'))};
  });
  const notify=dark=>page.evaluate(dark=>{globalThis.nativeTestDark=dark;globalThis.onNativeSystemThemeChanged(dark);},dark);
  const choose=async value=>{
   await page.getByRole('button',{name:'设置与数据',exact:true}).click();await page.locator('.theme-choice[data-theme="'+value+'"]').click();
   await page.getByRole('button',{name:'今日课表',exact:true}).click();
  };
  assert.equal(await theme(),'dark','Android dark configuration must override WebView light media query at startup');
  let colors=await palette();assert.equal(colors.body.bg,'rgb(0, 0, 0)');assert.equal(colors.primary.bg,'rgb(255, 255, 255)');assert.notEqual(colors.card.bg,'rgb(32, 32, 32)');assert.ok(new Set(colors.card.bg.match(/\d+/g)).size>1,'dark courses retain identifying color');assert.equal(colors.nav.bg,'rgb(255, 255, 255)');
  await page.screenshot({path:path.join(output,'01-黑白主题-首页.png')});
  await notify(false);assert.equal(await theme(),'light');colors=await palette();assert.equal(colors.body.bg,'rgb(255, 255, 255)');assert.equal(colors.hero.bg,'rgb(255, 255, 255)');assert.notEqual(colors.card.bg,'rgb(255, 255, 255)');assert.ok(new Set(colors.card.bg.match(/\d+/g)).size>1,'light courses retain identifying color');assert.equal(colors.primary.bg,'rgb(23, 23, 23)');
  await page.screenshot({path:path.join(output,'02-白黑主题-首页.png')});
  await page.emulateMedia({colorScheme:'dark'});assert.equal(await theme(),'light','Android light configuration is authoritative over stale WebView media query');
  await notify(true);assert.equal(await theme(),'dark');
  await choose('light');await notify(false);await notify(true);assert.equal(await theme(),'light','explicit light is preserved when Android changes');
  await page.reload();await page.locator('.day-swipe').waitFor();assert.equal(await theme(),'light','explicit preference survives restart');
  await choose('dark');await notify(false);assert.equal(await theme(),'dark','explicit dark is preserved when Android changes');
  await choose('blue');assert.equal(await theme(),'blue');assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()),'#287fb0');
  await choose('purple');assert.equal(await theme(),'purple');assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()),'#6960ca');
  await choose('system');assert.equal(await theme(),'light');await notify(true);assert.equal(await theme(),'dark');
  await page.getByRole('button',{name:'完整课表',exact:true}).click();
  await page.locator('.week-grid').waitFor();
  let metrics;
  for(const width of [360,430]){
   await page.setViewportSize({width,height:932});
   metrics=await page.evaluate(()=>{
    const grid=document.querySelector('.week-grid'),today=document.querySelector('.week-heading.is-today strong');
    return {height:grid.getBoundingClientRect().height,width:grid.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth,cardHeights:[...grid.querySelectorAll('.course-card')].map(c=>c.getBoundingClientRect().height),decoration:getComputedStyle(today).textDecorationLine,decorationStyle:getComputedStyle(today).textDecorationStyle,outline:getComputedStyle(today).outlineStyle,radius:getComputedStyle(today).borderRadius,stripes:[...document.querySelectorAll('.course-card')].some(c=>getComputedStyle(c,'::before').display!=='none')};
   });
   assert.equal(metrics.overflow,false);assert.ok(metrics.height<590,`weekly grid is too tall at ${width}: ${metrics.height}`);assert.equal(metrics.stripes,false);assert.equal(metrics.decoration,'underline');assert.equal(metrics.decorationStyle,'double');assert.equal(metrics.outline,'none');assert.equal(metrics.radius,'0px');
  }
  await page.locator('.week-heading[data-date="2026-10-13"]').click();
  assert.equal(await page.locator('.week-cell.is-selected').count(),5);
  assert.equal(await page.locator('.week-heading.is-today strong').evaluate(e=>getComputedStyle(e).textDecorationStyle),'double');
  await page.locator('.week-heading[data-date="2026-10-15"]').click();
  await page.locator('.week-grid').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'03-完整课表-紧凑黑色.png')});
  const card=page.locator('.week-cell .course-card').first(),name=await card.locator('h3').innerText();
  await card.click();await page.locator('.modal').waitFor();assert.ok((await page.locator('.modal').innerText()).includes(name),'full course name remains in details');await page.locator('.modal [data-action=close]').first().click();
  await choose('light');await page.getByRole('button',{name:'完整课表',exact:true}).click();await page.locator('.week-grid').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'04-完整课表-紧凑白色.png')});
  await app.evaluate(()=>{
   const s=global.themeTest.state;s.snapshot.rules.push({id:'overlap',name:'重叠课程仍完整保留',room:'重叠地点',teacher:'测试教师',weekday:2,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'});
  });
  await page.reload();await page.locator('.day-swipe').waitFor();await page.getByRole('button',{name:'完整课表',exact:true}).click();
  const stacked=page.locator('.week-cell[data-date="2026-10-13"][data-slot="1"]');assert.equal(await stacked.locator('.course-card').count(),2);
  const boxes=await stacked.locator('.course-card').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom};}));assert.ok(boxes[0].bottom<=boxes[1].top,'overlapping courses stack without covering each other');
  assert.ok((await stacked.innerText()).includes('时段重叠'));
  await page.locator('.week-grid').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'05-重叠课程-展开保留.png')});
  await choose('system');await notify(true);
  console.log('Compact week PASS: 360/430px fit, grid height '+metrics.height+'px, no course stripes, today double underline, full details and stacked overlaps.');
  const calls=await app.evaluate(()=>global.themeTest.calls);assert.ok(calls.some(c=>c.dark&&c.background==='#000000'&&c.surface==='#121212'));assert.ok(calls.some(c=>!c.dark&&c.background==='#ffffff'&&c.surface==='#ffffff'));assert.equal((await app.evaluate(()=>global.themeTest.state)).theme,'system');assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'验证说明.txt'),'1.2.0-beta2 手机版主题与紧凑课表界面预览。使用模拟课程，未连接实体手机。\n已验证：Android 明暗状态优先于 WebView 媒体查询、运行中系统明暗切换、手动主题不被系统覆盖、重启保存选择、江水蓝与紫色保留、原生主题接口收到对应背景色。\n截图只展示应用页面，不包含实体设备状态栏；状态栏需真机验收。\n','utf8');
  console.log('PASS: native system mode startup/change, manual selection + restart, colored courses with neutral page themes, native colors, blue/purple preservation.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
