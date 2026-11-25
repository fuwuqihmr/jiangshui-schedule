const {_electron:electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const output=path.resolve('D:/ChatGPT/2026-10-10/files-pasted-by-the-user-d/outputs/课表导出-1.1.5-示例');
(async()=>{
 const {createState}=await import('../web/core.mjs'),{saveCustomCourse}=await import('../web/custom-courses.mjs'),{withStudyPolicy}=await import('../web/study.mjs');
 const calendar=JSON.parse(await fs.readFile('web/data/holidays.json','utf8')),base=JSON.parse(await fs.readFile('web/data/baseline.json','utf8'));
 base.rules=[
  {id:'math',name:'高等数学',room:'南C204',teacher:'李老师',weekday:1,weeks:[7,8],periods:[1,2],startTime:'08:30',endTime:'09:55'},
  {id:'english',name:'大学英语',room:'南A301',teacher:'陈老师',weekday:2,weeks:[7,8],periods:[3,4],startTime:'10:15',endTime:'11:40'},
  {id:'computer',name:'程序设计',room:'计算机实验室',teacher:'张老师',weekday:4,weeks:[7,8],periods:[9,10,11],startTime:'19:10',endTime:'21:10'}
 ];base.remaps=[];base.exceptions=[];base.closedDates=[];base.source={kind:'school',label:'演示课表'};
 base.unscheduled=[{name:'劳动教育',weeks:'1—18周',teacher:'待学校确认',room:'—'},{name:'大学生心理健康',weeks:'8、12周',teacher:'赵老师',room:'南A201'}];
 let fixture=createState(withStudyPolicy(base,{enrollmentYear:2026},calendar,{studyPolicy:{userEnabled:true,room:'南C303'}}));
 fixture.localMaps=[{id:'demo-move',fromDate:'2026-10-13',date:'2026-10-17',mode:'replace'}];
 fixture=saveCustomCourse(fixture,{mode:'once',date:'2026-10-12',name:'课程冲突示例',room:'活动室',teacher:'王老师',startTime:'08:40',endTime:'09:30'});
 const crowded=JSON.parse(JSON.stringify(fixture));crowded.customCourses=[];
 let crowdedState=crowded;
 for(let i=0;i<28;i++)crowdedState=saveCustomCourse(crowdedState,{mode:'once',date:'2026-10-12',name:'拥挤课程'+String(i+1).padStart(2,'0'),startTime:'08:30',endTime:'09:10',room:'A101',teacher:'测试教师'});
 for(const [name,startTime,endTime] of [['早间课程','07:10','08:00'],['午间课程','12:10','13:00'],['深夜课程','23:00','23:50']])crowdedState=saveCustomCourse(crowdedState,{mode:'once',date:'2026-10-12',name,startTime,endTime});
 await fs.mkdir(output,{recursive:true});const app=await electron.launch({args:[path.resolve('.')],env:{...process.env,TOMORROW_TEST:'1'}});
 try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.setPosition(-5000,0);w.showInactive();}));
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:430,height:932});
  await page.addInitScript(()=>{globalThis.Android={preview:true};});
  await app.evaluate(async({ipcMain},{fixture,output})=>{
   const fs=process.mainModule.require('node:fs/promises'),path=process.mainModule.require('node:path'),{decodeExport}=process.mainModule.require(path.join(process.cwd(),'desktop/export-file.cjs'));
   global.exportTest={state:fixture,exports:[],cancel:false,saveCount:0};
   ipcMain.removeHandler('app:request');ipcMain.handle('app:request',async(_e,a,p={})=>{
    const t=global.exportTest;
    if(a==='consentStatus')return {version:'2026-10-17.1',acceptedAt:'2026-10-10T00:00:00Z'};
    if(a==='loadState')return t.state;
    if(a==='saveState'){t.state=p.state;t.saveCount++;return {ok:true};}
    if(a==='runtimeStatus')return {enabled:true,exact:true};
    if(a==='classReminderStatus')return {active:[],enabled:false,notificationsAllowed:true,exact:true};
    if(a==='exportFile'){const file=decodeExport(p);if(t.cancel){t.cancel=false;return {};}await fs.writeFile(path.join(output,file.filename),file.bytes);t.exports.push({filename:file.filename,mime:file.mime,size:file.bytes.length});return {ok:true};}
    return {ok:true};
   });
  },{fixture,output});
  await page.reload();await page.locator('.day-swipe').waitFor();await page.getByRole('button',{name:'完整课表',exact:true}).click();await page.locator('#week-select').selectOption('7');
  const initialState=await app.evaluate(()=>JSON.stringify(global.exportTest.state));
  await page.locator('#search').fill('完全不存在的课程');await page.getByRole('button',{name:'导出这一周',exact:true}).click();await page.locator('#timetable-export-progress').waitFor({state:'detached',timeout:30000});
  let exports=await app.evaluate(()=>global.exportTest.exports);assert.equal(exports.length,1);assert.equal(exports[0].mime,'image/png');const png=await fs.readFile(path.join(output,exports[0].filename));assert.equal(png.readUInt32BE(16),2520);assert.equal(png.readUInt32BE(20),1782);
  await page.getByRole('button',{name:'导出整个学期',exact:true}).click();assert.deepEqual(await page.locator('.modal .settings-list button').allInnerTexts(),['每周一页（PDF）','整学期总览（图片 / PDF）','纯文本规则（TXT）']);assert.equal(await page.evaluate(()=>document.activeElement?.dataset.action),'export-semester-pages','焦点应落在首个导出选项');await page.getByRole('button',{name:'每周一页（PDF）',exact:true}).click();await page.locator('#timetable-export-progress').waitFor({state:'detached',timeout:90000});
  exports=await app.evaluate(()=>global.exportTest.exports);assert.equal(exports[1].mime,'application/pdf');assert.equal(await app.evaluate(()=>JSON.stringify(global.exportTest.state)),initialState);
  await app.evaluate(()=>global.exportTest.cancel=true);await page.getByRole('button',{name:'导出这一周',exact:true}).click();await page.locator('#timetable-export-progress').waitFor({state:'detached'});assert.equal((await app.evaluate(()=>global.exportTest.exports)).length,2);
  await page.locator('#week-select').selectOption('6');await page.getByRole('button',{name:'导出这一周',exact:true}).click();await page.locator('#timetable-export-progress').waitFor({state:'detached'});exports=await app.evaluate(()=>global.exportTest.exports);assert.match(exports[2].filename,/第6周/);
  await page.getByRole('button',{name:'设置与数据',exact:true}).click();assert.equal(await page.locator('.timetable-export-panel').count(),1);
  await page.setViewportSize({width:1240,height:950});await page.getByRole('button',{name:'完整课表',exact:true}).click();assert.equal(await page.getByRole('button',{name:'导出整个学期',exact:true}).count(),1);
  const dense=await page.evaluate(async state=>{
   const m=await import('./timetable-export.mjs'),seen=[];
   const create=()=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),fill=ctx.fillText.bind(ctx);ctx.fillText=(text,...args)=>{seen.push(text);fill(text,...args);};return canvas;};
   const canvases=m.renderWeekPages(m.exportWeekModel(state,7),create);const pageCount=canvases.length;for(const canvas of canvases){canvas.width=1;canvas.height=1;}
   const result=await m.createTimetableExport(state,{kind:'week',week:7});await native.request('exportFile',{filename:'拥挤课程与非标准时间.pdf',mime:result.mime,base64:m.bytesToBase64(result.bytes)});
   return {pageCount,pages:result.pages,mime:result.mime,seen};
  },crowdedState);
  assert.ok(dense.pageCount>1);assert.equal(dense.mime,'application/pdf');assert.equal(dense.pages,dense.pageCount);
  for(let i=1;i<=28;i++)assert.ok(dense.seen.includes('拥挤课程'+String(i).padStart(2,'0')));
  for(const name of ['早间课程','午间课程','深夜课程'])assert.ok(dense.seen.includes(name));
  assert.ok(dense.seen.includes('时间重叠'));assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'验证结果.json'),JSON.stringify({exports:await app.evaluate(()=>global.exportTest.exports),crowdedPages:dense.pageCount,versions:'1.1.5',checks:'mobile/desktop entry, selected week, unfiltered export, empty week, no state changes, cancel then retry, full semester, overlaps, 28 crowded courses, early/noon/late slots'},null,2));
  console.log('TIMETABLE EXPORT UI PASS: PNG 2520x1782, semester PDF, selected week, empty cells, all final courses, cancel/retry, unchanged state, desktop/mobile entries, crowded/early/noon/late courses.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
