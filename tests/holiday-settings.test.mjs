import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createState,effectiveDay,timetableDay,applySnapshot,adoptSchoolSnapshot,saveOverride,weekday} from '../web/core.mjs';
import {setHolidayRange,setHolidayDay,removeHolidayDay,holidayForDate,emptyHolidaySettings,normalizeHolidaySettings,setRestoreDate,isRestoredDate} from '../web/holiday-settings.mjs';
import {withStudyPolicy} from '../web/study.mjs';
import {exportWeekModel} from '../web/timetable-export.mjs';
import {reminderWindows} from '../web/reminders.mjs';
const source=JSON.parse(await readFile(new URL('../web/data/baseline.json',import.meta.url),'utf8'));
const calendar=JSON.parse(await readFile(new URL('../web/data/holidays.json',import.meta.url),'utf8'));
const fixture=()=>{
 const base=structuredClone(source);
 base.rules=[
  {id:'monday',name:'搬走的课',teacher:'甲',room:'A101',weekday:1,weeks:[7],periods:[5,6],startTime:'14:00',endTime:'15:25'},
  {id:'friday',name:'被覆盖的课',teacher:'乙',room:'B202',weekday:5,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'},
  {id:'night',name:'被覆盖的晚课',teacher:'丙',room:'C303',weekday:5,weeks:[7],periods:[9,10],startTime:'19:00',endTime:'20:30'}
 ];base.remaps=[];base.closedDates=[];base.source={kind:'school',label:'测试学校课表'};
 return createState(withStudyPolicy(base,{enrollmentYear:2026},calendar,{studyPolicy:{userEnabled:true}}));
};
const rows=(state,date)=>effectiveDay(state.snapshot,date,state.overrides,state.localMaps,state.courseSettings,state.customCourses,state.holidaySettings);
test('寒暑假与单日休假默认取消当天全部课程（含晚自习），单日恢复后按正常规则排课',()=>{
 let s=fixture();s.holidaySettings=setHolidayRange(s.holidaySettings,'winter','2026-10-12','2026-10-16');
 assert.deepEqual(rows(s,'2026-10-12'),[]);
 assert.deepEqual(rows(s,'2026-10-16'),[]);
 s.holidaySettings=setRestoreDate(s.holidaySettings,'2026-10-12',true);
 assert.deepEqual(rows(s,'2026-10-12').map(r=>r.ruleId),['monday','local-evening-study']);
 assert.deepEqual(timetableDay(s.snapshot,'2026-10-12',s.overrides,s.localMaps,s.courseSettings,s.customCourses,s.holidaySettings).map(r=>r.ruleId),['monday','local-evening-study'],'恢复日不再按休假提前返回');
 assert.equal(timetableDay(s.snapshot,'2026-10-12',s.overrides,s.localMaps,s.courseSettings,s.customCourses,s.holidaySettings).some(r=>r.vacant),false);
 s.holidaySettings=setRestoreDate(s.holidaySettings,'2026-10-12',false);
 assert.deepEqual(rows(s,'2026-10-12'),[]);
 s.holidaySettings=setHolidayDay(s.holidaySettings,'2026-10-12',true);
 assert.deepEqual(rows(s,'2026-10-12'),[]);
 s.holidaySettings=setRestoreDate(s.holidaySettings,'2026-10-12',true);
 assert.deepEqual(rows(s,'2026-10-12').map(r=>r.ruleId),['monday']);
 assert.equal(holidayForDate(s.holidaySettings,'2026-10-12').skipStudy,true);
 s.holidaySettings=removeHolidayDay(s.holidaySettings,'2026-10-12');
 s.holidaySettings=setHolidayRange(s.holidaySettings,'winter','','');
 assert.deepEqual(rows(s,'2026-10-12').map(r=>r.ruleId),['monday','local-evening-study'],'日期不再取消时恢复标记保留但无效果');
 assert.throws(()=>setHolidayRange(s.holidaySettings,'summer','2026-10-17','2026-10-16'));
});
test('学校停课日默认取消当天全部课程（含晚自习），单日恢复后按正常规则显示',()=>{
 const s=fixture();s.snapshot.closedDates=['2026-10-12'];
 assert.deepEqual(rows(s,'2026-10-12'),[]);
 s.holidaySettings=setRestoreDate(s.holidaySettings,'2026-10-12',true);
 assert.deepEqual(rows(s,'2026-10-12').map(r=>r.ruleId),['monday','local-evening-study']);
 s.holidaySettings=setRestoreDate(s.holidaySettings,'2026-10-12',false);
 assert.deepEqual(rows(s,'2026-10-12'),[]);
});
test('调休整日覆盖早课晚课和旧修改；原日期普通课消失、晚自习可单独取消',()=>{
 const s=fixture();s.localMaps=[{id:'move',date:'2026-10-16',fromDate:'2026-10-12',mode:'replace'}];
 const friday=rows(s,'2026-10-16');assert.deepEqual(friday.map(r=>r.ruleId),['monday','local-evening-study']);
 assert.equal(timetableDay(s.snapshot,'2026-10-16',s.overrides,s.localMaps,s.courseSettings,s.customCourses,s.holidaySettings).some(r=>r.vacant),false);
 const monday=rows(s,'2026-10-12');assert.deepEqual(monday.map(r=>r.ruleId),['local-evening-study']);
 const skipped=saveOverride(s,monday[0],{cancelled:true});assert.equal(rows(skipped,'2026-10-12').filter(r=>!r.cancelled).length,0);
});
test('学校刷新、学期替换保留个人休假与恢复标记，周导出与通知跟随生效课表',()=>{
 let s=fixture();s.holidaySettings=setHolidayDay(s.holidaySettings,'2026-10-12',false);
 s=applySnapshot(s,structuredClone(s.snapshot));assert.deepEqual(rows(s,'2026-10-12'),[]);
 const week=exportWeekModel(s,7);assert.deepEqual(week.days[0].courses,[]);
 s.classReminders={enabled:true,leadMinutes:30,afterStartMinutes:5};
 assert.equal(reminderWindows(s,Date.parse('2026-10-12T06:00:00+08:00')).some(r=>r.date==='2026-10-12'),false);
 s.holidaySettings=setRestoreDate(s.holidaySettings,'2026-10-12',true);
 s=applySnapshot(s,structuredClone(s.snapshot));
 assert.deepEqual(rows(s,'2026-10-12').map(r=>r.ruleId),['monday','local-evening-study']);
 assert.deepEqual(exportWeekModel(s,7).days[0].courses.map(c=>c.name),['搬走的课','晚自习']);
 assert.equal(reminderWindows(s,Date.parse('2026-10-12T06:00:00+08:00')).some(r=>r.date==='2026-10-12'),true);
 const replaced=adoptSchoolSnapshot(s,structuredClone(s.snapshot));assert.deepEqual(replaced.holidaySettings,s.holidaySettings);
 assert.equal(isRestoredDate(replaced.holidaySettings,'2026-10-12'),true);
 assert.deepEqual(rows(replaced,'2026-10-12').map(r=>r.ruleId),['monday','local-evening-study']);
});
test('恢复标记数据模型：旧 state 缺字段补空数组、非法项丢弃、未知键保留、非法日期拒绝',()=>{
 const legacy=normalizeHolidaySettings({winter:{startDate:'2026-10-12',endDate:'2026-10-16'},summer:null,days:[]});
 assert.deepEqual(legacy.restoreDates,[]);
 assert.deepEqual(legacy.winter,{startDate:'2026-10-12',endDate:'2026-10-16'});
 const dirty=normalizeHolidaySettings({days:[],restoreDates:['2026-10-12','2026-10-12','2026-02-30','2026-13-01','bad',null,42],extra:'keep'});
 assert.deepEqual(dirty.restoreDates,['2026-10-12']);
 assert.equal(dirty.extra,'keep');
 assert.deepEqual(normalizeHolidaySettings({restoreDates:'2026-10-12'}).restoreDates,[]);
 assert.deepEqual(normalizeHolidaySettings(null),emptyHolidaySettings());
 const added=setRestoreDate(null,'2026-10-13',true);
 assert.deepEqual(added.restoreDates,['2026-10-13']);
 const toggled=setRestoreDate(setRestoreDate(added,'2026-10-12',true),'2026-10-13',false);
 assert.deepEqual(toggled.restoreDates,['2026-10-12']);
 assert.throws(()=>setRestoreDate(null,'2026-02-30',true),/恢复日期无效/);
 assert.throws(()=>setRestoreDate(null,'2026-13-01',true),/恢复日期无效/);
});
test('完整课表与当日页提供单日恢复入口（app.mjs 源码契约，静态）',async()=>{
 const app=await readFile(new URL('../web/app.mjs',import.meta.url),'utf8');
 assert.ok(app.includes('renderWeekOffDays(dates)'),'整周课表渲染恢复条');
 assert.ok(app.includes('renderOffDayBanner(selectedDate)'),'当日课表渲染恢复横幅');
 assert.ok(app.includes('restore-holiday-day'),'恢复动作接线');
 assert.ok(app.includes('unrestore-holiday-day'),'取消恢复动作接线');
 assert.ok(app.includes('恢复此日上课'),'恢复按钮文案');
 assert.ok(app.includes('holidayRestoreSection(settings'),'休假弹窗恢复区');
 assert.ok(app.includes('setHolidayRestore(date'),'恢复处理函数');
 assert.ok(app.includes('normalizeHolidaySettings(state.holidaySettings)'),'启动时归一旧 state');
 const css=await readFile(new URL('../web/style.css',import.meta.url),'utf8');
 assert.ok(css.includes('.week-off-bar'));
 assert.ok(css.includes('.off-day-banner'));
});
test('完整课表/当日恢复横幅渲染逻辑（vm 回放 app.mjs 帮助函数，逻辑层）',async()=>{
 const app=await readFile(new URL('../web/app.mjs',import.meta.url),'utf8');
 const slice=app.slice(app.indexOf('function holidayLabel(kind){'),app.indexOf('async function setHolidayRestore'));
 assert.ok(slice.includes('renderWeekOffDays'),'找到恢复渲染帮助函数');
 const make=(holidaySettings,closedDates=[])=>{const ctx={displayState:()=>({snapshot:{closedDates},holidaySettings}),holidayForDate,isRestoredDate,weekday,fmt:d=>d,console};vm.runInNewContext(slice+';globalThis.__week=renderWeekOffDays;globalThis.__banner=renderOffDayBanner;globalThis.__info=offDayInfo;',ctx);return ctx;};
 const winter={winter:{startDate:'2026-10-12',endDate:'2026-10-16'},summer:null,days:[],restoreDates:[]};
 let ctx=make(winter);
 const offBar=ctx.__week(['2026-10-12','2026-10-13']);
 assert.ok(offBar.includes('该日因寒假无课'),offBar);
 assert.ok(offBar.includes('恢复此日上课'));
 assert.equal(ctx.__info('2026-10-12').cancelled,true);
 assert.equal(ctx.__info('2026-10-20').cancelled,false);
 ctx=make({...winter,restoreDates:['2026-10-12']});
 const restoredBar=ctx.__week(['2026-10-12','2026-10-13']);
 assert.ok(restoredBar.includes('已恢复此日上课'),restoredBar);
 assert.ok(restoredBar.includes('取消恢复'));
 assert.ok(restoredBar.includes('is-restored'));
 assert.ok(ctx.__banner('2026-10-13').includes('当天课程与晚自习默认取消'));
 assert.equal(ctx.__banner('2026-10-20'),'','非取消日不渲染当日横幅');
 ctx=make({winter:null,summer:null,days:[],restoreDates:[]},['2026-10-12']);
 assert.ok(ctx.__week(['2026-10-12']).includes('学校停课'));
 assert.equal(ctx.__week(['2026-10-13']).includes('本周休假 / 停课'),false,'本周无取消日时不渲染恢复条');
});
