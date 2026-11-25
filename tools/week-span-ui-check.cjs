const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const {createState}=await import('../web/core.mjs');
 const rule=(id,name,weekday,periods,startTime,endTime)=>({id,name,weekday,periods,startTime,endTime,room:'南C102',teacher:'测试教师',weeks:[1]});
 const snapshot={schemaVersion:1,semester:{id:'span-test',name:'跨节课程测试',startDate:'2026-10-12',weeks:2},source:{kind:'sample',label:'虚构测试课程'},exceptions:[],remaps:[],closedDates:[],unscheduled:[],rules:[
  rule('long','跨节课程1–4节',1,[1,2,3,4],'08:30','11:40'),rule('later','下午普通课程',1,[5,6],'14:00','15:25'),
  rule('overlap-long','跨节重叠课程',2,[1,2,3,4],'08:30','11:40'),rule('overlap-short','另一门3–4节课程',2,[3,4],'10:15','11:40'),
  rule('cross-noon','跨午间3–6节',3,[3,4,5,6],'10:15','15:25'),rule('normal','普通1–2节课程',4,[1,2],'08:30','09:55'),
  rule('night','晚间9–11节',5,[9,10,11],'19:00','21:10'),
  rule('afternoon-long','跨节课程5–8节',4,[5,6,7,8],'14:00','17:10'),rule('odd-start','非整组2–5节',6,[2,3,4,5],'09:15','14:40')
 ]};
 const state={...createState(snapshot),showDayOverview:false,theme:'white',autoCheckEnabled:false,classReminders:{enabled:false},classReminderPreferenceSet:true,reminderIntroAcknowledged:true};
 const output=path.resolve(process.env.SPAN_OUTPUT||'D:/ChatGPT/2026-10-10/files-pasted-by-the-user-d/outputs/跨节课程-1.2.0-beta5');
 const app=await electron.launch({args:[path.resolve('.'),'--force-device-scale-factor=2'],env:{...process.env,TOMORROW_TEST:'1'}});
 try{
  await fs.mkdir(output,{recursive:true});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.setPosition(-5000,0)));
  await app.evaluate(({ipcMain},state)=>{
   global.spanState=state;ipcMain.removeHandler('app:request');ipcMain.handle('app:request',async(_event,action,p={})=>{
    if(action==='consentStatus')return {version:'2026-10-17.1',acceptedAt:'2026-10-12T00:00:00Z'};
    if(action==='loadState')return global.spanState;
    if(action==='saveState'){global.spanState=p.state;return {revision:(p.state._revision||0)+1};}
    if(action==='runtimeStatus')return {enabled:false,time:'22:00',exact:true};
    if(action==='classReminderStatus')return {enabled:false,active:[],notificationsAllowed:true,exact:true};
    return {ok:true};
   });
  },state);
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const RealDate=Date,epoch=RealDate.parse('2026-10-12T11:30:00+08:00');globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[epoch]));}static now(){return epoch;}};});
  await page.setViewportSize({width:430,height:932});await page.reload();await page.locator('.day-swipe').waitFor();
  const longDay=page.locator('.course-row').filter({hasText:'跨节课程1–4节'});
  assert.match(await longDay.innerText(),/11:40/);assert.equal(await longDay.locator('.course-ongoing').isVisible(),true);
  await page.getByRole('button',{name:'完整课表',exact:true}).click();
  const card=page.locator('.week-cell .course-card').filter({hasText:'跨节课程1–4节'});
  assert.equal(await card.count(),1);assert.equal(await card.locator('.custom-time').textContent(),'08:30–11:40');assert.equal(await card.locator('.course-ongoing').isVisible(),true);
  const afternoon=page.locator('.week-cell .course-card').filter({hasText:'跨节课程5–8节'});assert.equal(await afternoon.count(),1);assert.equal(await afternoon.locator('.custom-time').textContent(),'14:00–17:10');assert.equal(await afternoon.locator('..').getAttribute('data-slot'),'5');assert.equal(await afternoon.locator('..').getAttribute('data-slot-end'),'8');
  const cell=card.locator('..');assert.equal(await cell.getAttribute('data-slot'),'1');assert.equal(await cell.getAttribute('data-slot-end'),'4');
  for(const width of [430,360]){
   await page.setViewportSize({width,height:932});
   const metrics=await page.evaluate(()=>{
    const cell=document.querySelector('.week-cell[data-date="2026-10-12"][data-slot="1"]'),r=cell.getBoundingClientRect();
    const time=[...document.querySelectorAll('.week-time')].slice(0,2).map(x=>x.getBoundingClientRect());
    const next=document.querySelector('.week-cell[data-date="2026-10-12"][data-slot="5"]').getBoundingClientRect();
    const cards=[...document.querySelectorAll('.week-cell[data-date="2026-10-13"][data-slot="1"] .course-card')].map(x=>x.getBoundingClientRect());
    const timeOverflow=[...document.querySelectorAll('.week-cell .custom-time span')].some(x=>{const text=x.getBoundingClientRect(),parent=x.closest('.course-card').getBoundingClientRect();return text.left<parent.left||text.right>parent.right;});
    return {timeOverflow,span:getComputedStyle(cell).gridRowEnd,top:r.top,bottom:r.bottom,first:time[0].top,last:time[1].bottom,next:next.top,overlap:cards[0].bottom>cards[1].top,overflow:document.documentElement.scrollWidth>innerWidth};
   });
   assert.equal(metrics.span,'span 2');assert.ok(Math.abs(metrics.top-metrics.first)<1);assert.ok(Math.abs(metrics.bottom-metrics.last)<1);assert.ok(metrics.next>=metrics.bottom);assert.equal(metrics.overlap,false);assert.equal(metrics.overflow,false);assert.equal(metrics.timeOverflow,false);
   await page.screenshot({path:path.join(output,`完整课表-跨节课程-${width}px.png`),fullPage:true});
  }
  assert.equal(await page.locator('.week-cell .course-card').count(),snapshot.rules.length);
  await card.click();assert.match(await page.locator('.modal').innerText(),/11:40/);await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.locator('#search').fill('另一门');assert.equal(await page.locator('.week-cell .course-card').count(),1);
  const short=page.locator('.week-cell .course-card').filter({hasText:'另一门'}).locator('..');assert.equal(await short.getAttribute('data-slot'),'3');assert.equal(await short.getAttribute('data-slot-end'),'4');
  // Exercise every supported continuous school-period range in the actual mobile renderer.
  const {PERIOD_TIMES}=await import('../web/jsxsd.mjs'),band=[null,0,0,1,1,2,2,3,3,4,4,4];
  const ranges=[];
  for(let first=1;first<=11;first++)for(let last=first;last<=11;last++)ranges.push([first,last]);
  const matrixRules=ranges.map(([first,last],i)=>({...rule(`matrix-${first}-${last}`,`验证第${first}–${last}节`,i%7+1,Array.from({length:last-first+1},(_,n)=>first+n),PERIOD_TIMES[first][0],PERIOD_TIMES[last][1]),weeks:[Math.floor(i/7)+1]}));
  const matrix={...state,snapshot:{...snapshot,semester:{...snapshot.semester,weeks:10},rules:matrixRules}};
  await app.evaluate((_electron,state)=>{global.spanState=state;},matrix);
  await page.reload();await page.locator('.day-swipe').waitFor();await page.getByRole('button',{name:'完整课表',exact:true}).click();
  for(const width of [360,430]){
   await page.setViewportSize({width,height:932});
   for(let week=1;week<=10;week++){
    await page.selectOption('#week-select',String(week));
    const actual=await page.evaluate(()=>[...document.querySelectorAll('.week-cell .course-card')].map(card=>{
     const cell=card.closest('.week-cell'),rect=cell.getBoundingClientRect(),times=[...document.querySelectorAll('.week-time')].map(x=>x.getBoundingClientRect());
     return {name:card.querySelector('h3').textContent,slot:Number(cell.dataset.slot),end:Number(cell.dataset.slotEnd),rowStart:Number(getComputedStyle(cell).gridRowStart),rowSpan:Number(getComputedStyle(cell).gridRowEnd.replace('span ','')),start:card.dataset.courseStart,finish:card.dataset.courseEnd,top:rect.top,bottom:rect.bottom,times:times.map(t=>({top:t.top,bottom:t.bottom}))};
    }));
    const expected=matrixRules.filter(r=>r.weeks[0]===week);assert.equal(actual.length,expected.length);
    for(const r of expected){
     const a=actual.find(x=>x.name===r.name),first=r.periods[0],last=r.periods.at(-1),from=band[first],to=band[last];
     assert.ok(a,`${width}px ${r.name}`);assert.equal(a.slot,[1,3,5,7,9][from]);assert.equal(a.end,[2,4,6,8,11][to]);
     assert.equal(a.rowStart,from+2);assert.equal(a.rowSpan,to-from+1);assert.equal(a.start,r.startTime);assert.equal(a.finish,r.endTime);
     assert.ok(Math.abs(a.top-a.times[from].top)<1);assert.ok(Math.abs(a.bottom-a.times[to].bottom)<1);
    }
   }
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: all 66 continuous ranges from periods 1 through 11, including 5–8, at both 360px/430px (132 rendered cases); mixed 1–4, 3–6, 5–8 and 2–5 fixtures; overlapping courses retained; each course once; next band aligned; day/details/ongoing keep full time; search and empty rows work; no page errors.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
