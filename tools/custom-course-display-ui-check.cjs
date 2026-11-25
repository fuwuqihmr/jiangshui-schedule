const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const {createState}=await import('../web/core.mjs');
 const base=JSON.parse(await fs.readFile('web/data/baseline.json','utf8'));base.rules=[];base.remaps=[];base.closedDates=[];base.exceptions=[];
 const state=createState({...base,semester:{...base.semester,id:'school-2026-08-31'}});
 state.customCourses=[{id:'custom-import-mismatch',mode:'weekly',name:'导入课程10:10',room:'C204',teacher:'老师',startTime:'10:10',endTime:'11:40',semesterId:'sample-term-id',semesterStartDate:base.semester.startDate,weekdays:[4],startWeek:7,endWeek:7,weekPattern:'every'}];
 const app=await electron.launch({args:[path.resolve('.')],env:{...process.env,TOMORROW_TEST:'1'}});
 try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.setPosition(-5000,0)));
  await app.evaluate(({ipcMain},fixture)=>{global.customDisplayState=fixture;ipcMain.removeHandler('app:request');ipcMain.handle('app:request',async(_e,a,p={})=>{if(a==='consentStatus')return {version:'2026-10-17.1',acceptedAt:'2026-10-15T00:00:00Z'};if(a==='loadState')return global.customDisplayState;if(a==='saveState'){global.customDisplayState=p.state;return {revision:1};}if(a==='runtimeStatus')return {enabled:false,time:'22:00',exact:true};if(a==='classReminderStatus')return {enabled:false,active:[],notificationsAllowed:true,exact:true};return {ok:true};});},state);
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const D=Date,t=D.parse('2026-10-15T09:00:00+08:00');globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:[t]));}static now(){return t;}};});
  await page.setViewportSize({width:430,height:932});await page.reload();await page.locator('.day-swipe').waitFor();
  await page.getByRole('button',{name:'完整课表',exact:true}).click();await page.selectOption('#week-select','7');
  const card=page.locator('.week-cell .course-card').filter({hasText:'导入课程10:10'});assert.equal(await card.count(),1);assert.equal(await card.locator('.custom-time').textContent(),'10:10–11:40');
  const cell=card.locator('..');assert.equal(await cell.getAttribute('data-date'),'2026-10-15');assert.equal(await cell.getAttribute('data-slot'),'3');assert.equal(await cell.getAttribute('data-slot-end'),'4');
  assert.equal(await app.evaluate(()=>global.customDisplayState.customCourses[0].semesterId),'school-2026-08-31');assert.deepEqual(errors,[]);
  console.log('PASS: mismatched semester-id custom import is migrated at startup and visible in week 7, 3–4 row.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
