import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createState,effectiveDay,timetableDay,applySnapshot,adoptSchoolSnapshot,saveOverride} from '../web/core.mjs';
import {setHolidayRange,setHolidayDay,removeHolidayDay,holidayForDate} from '../web/holiday-settings.mjs';
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
 ];base.remaps=[];base.closedDates=[];
 return createState(withStudyPolicy(base,{enrollmentYear:2026},calendar,{studyPolicy:{userEnabled:true}}));
};
const rows=(state,date)=>effectiveDay(state.snapshot,date,state.overrides,state.localMaps,state.courseSettings,state.customCourses,state.holidaySettings);
test('寒暑假范围和单日休假压住当日普通课，晚自习默认保留，单日可关闭',()=>{
 let s=fixture();s.holidaySettings=setHolidayRange(s.holidaySettings,'winter','2026-10-12','2026-10-16');
 assert.deepEqual(rows(s,'2026-10-12').filter(r=>!r.localActivity),[]);
 assert.equal(rows(s,'2026-10-12').filter(r=>r.localActivity).length,1);
 assert.equal(rows(s,'2026-10-16').length,0);
 s.holidaySettings=setHolidayDay(s.holidaySettings,'2026-10-12',true);
 assert.deepEqual(rows(s,'2026-10-12'),[]);
 assert.equal(holidayForDate(s.holidaySettings,'2026-10-12').skipStudy,true);
 s.holidaySettings=removeHolidayDay(s.holidaySettings,'2026-10-12');
 assert.equal(rows(s,'2026-10-12').filter(r=>r.localActivity).length,1);
 s.holidaySettings=setHolidayRange(s.holidaySettings,'winter','','');
 assert.ok(rows(s,'2026-10-12').some(r=>r.ruleId==='monday'));
 assert.throws(()=>setHolidayRange(s.holidaySettings,'summer','2026-10-17','2026-10-16'));
});
test('调休整日覆盖早课晚课和旧修改；原日期普通课消失、晚自习可单独取消',()=>{
 const s=fixture();s.localMaps=[{id:'move',date:'2026-10-16',fromDate:'2026-10-12',mode:'replace'}];
 const friday=rows(s,'2026-10-16');assert.deepEqual(friday.map(r=>r.ruleId),['monday','local-evening-study']);
 assert.equal(timetableDay(s.snapshot,'2026-10-16',s.overrides,s.localMaps,s.courseSettings,s.customCourses,s.holidaySettings).some(r=>r.vacant),false);
 const monday=rows(s,'2026-10-12');assert.deepEqual(monday.map(r=>r.ruleId),['local-evening-study']);
 const skipped=saveOverride(s,monday[0],{cancelled:true});assert.equal(rows(skipped,'2026-10-12').filter(r=>!r.cancelled).length,0);
});
test('学校刷新、学期替换保留个人休假，周导出与通知与生效课表一致',()=>{
 let s=fixture();s.holidaySettings=setHolidayDay(s.holidaySettings,'2026-10-12',true);
 s=applySnapshot(s,structuredClone(s.snapshot));assert.deepEqual(rows(s,'2026-10-12'),[]);
 const week=exportWeekModel(s,7);assert.deepEqual(week.days[0].courses,[]);
 s.classReminders={enabled:true,leadMinutes:30,afterStartMinutes:5};
 assert.equal(reminderWindows(s,Date.parse('2026-10-12T06:00:00+08:00')).some(r=>r.date==='2026-10-12'),false);
 const replaced=adoptSchoolSnapshot(s,structuredClone(s.snapshot));assert.deepEqual(replaced.holidaySettings,s.holidaySettings);
});
