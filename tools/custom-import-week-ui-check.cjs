const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const { createState } = await import('../web/core.mjs');
  const { customCourseBackup, saveCustomCourse } = await import('../web/custom-courses.mjs');
  const snapshot = JSON.parse(await fs.readFile('web/data/baseline.json', 'utf8'));
  snapshot.rules=[]; snapshot.remaps=[]; snapshot.closedDates=[]; snapshot.exceptions=[];
  let exported = createState(snapshot);
  const input={name:'导入的10:10课程',mode:'weekly',room:'测试教室',teacher:'测试教师',startTime:'10:10',endTime:'11:40',weekdays:[4],startWeek:7,endWeek:7,weekPattern:'every',semesterId:snapshot.semester.id,semesterStartDate:snapshot.semester.startDate};
  exported=saveCustomCourse(exported,input);
  exported.customCourses[0].semesterId='sample-term-id'; // Emulate an exported course retaining a different source ID for the same term.
  exported=saveCustomCourse(exported,{name:'导入的独立加课',mode:'once',date:'2026-10-15',room:'测试地点',teacher:'测试教师',startTime:'10:10',endTime:'11:40'});
  const backup=JSON.stringify(customCourseBackup(exported));
  const previousState=createState(snapshot);
  const app=await electron.launch({args:[path.resolve('.')],env:{...process.env,TOMORROW_TEST:'1'}});
  try {
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.setPosition(-5000,0)));
    await app.evaluate(({ipcMain},{json,previousState})=>{
      global.customImportState=previousState; global.customImportText=json;
      ipcMain.removeHandler('app:request');
      ipcMain.handle('app:request',async(_event,action,payload={})=>{
        if(action==='consentStatus')return {version:'2026-10-17.1',acceptedAt:'2026-10-15T00:00:00Z'};
        if(action==='loadState')return global.customImportState;
        if(action==='saveState'){global.customImportState=payload.state;return {revision:1};}
        if(action==='import')return {text:global.customImportText};
        if(action==='runtimeStatus')return {enabled:false,time:'22:00',exact:true};
        if(action==='classReminderStatus')return {enabled:false,active:[],notificationsAllowed:true,exact:true};
        return {ok:true};
      });
    },{json:backup,previousState});
    const page=await app.firstWindow(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      const Original=Date;const instant=Original.parse('2026-10-15T09:00:00+08:00');
      globalThis.Date=class extends Original{constructor(...args){super(...(args.length?args:[instant]));} static now(){return instant;}};
    });
    await page.setViewportSize({width:360,height:932});
    await page.reload(); await page.locator('.day-swipe').waitFor();
    await page.getByRole('button',{name:'完整课表',exact:true}).click();
    await page.selectOption('#week-select','6');
    assert.equal(await page.locator('#week-select').inputValue(),'6','Previously browsing another week');
    await page.getByRole('button',{name:'设置与数据',exact:true}).click();
    await page.getByRole('button',{name:'导入课表 JSON',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#notification-root')?.textContent.includes('已读取课表'));
    const imported=await app.evaluate(()=>global.customImportState?.customCourses);
    assert.equal(imported?.length,2,'Both custom courses must be imported');
    await page.getByRole('button',{name:'完整课表',exact:true}).click();
    assert.equal(await page.locator('#week-select').inputValue(),'7','Complete timetable must default to the current week');
    for(const name of ['导入的10:10课程','导入的独立加课']){
      const card=page.locator('.week-cell .course-card').filter({hasText:name});
      assert.equal(await card.count(),1,name+' must appear in the correct week once');
      assert.equal(await card.locator('.custom-time').textContent(),'10:10–11:40');
      const cell=card.locator('..');assert.equal(await cell.getAttribute('data-date'),'2026-10-15');
      assert.equal(await cell.getAttribute('data-slot'),'3');assert.equal(await cell.getAttribute('data-slot-end'),'4');
      assert.equal(await card.isVisible(),true);
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: imported weekly and one-off 10:10–11:40 are visible in week 7, slot 3–4; imports persist');
  } finally { await app.close(); }
})().catch(err=>{console.error(err);process.exitCode=1});
