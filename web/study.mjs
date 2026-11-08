import {holidayForDate} from './holiday-settings.mjs';
const clone = value => JSON.parse(JSON.stringify(value));
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const daysBetween = (a,b) => Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
const weekday = value => new Date(value+'T00:00:00Z').getUTCDay() || 7;
const weekOf = (snapshot,date) => Math.floor(daysBetween(snapshot.semester.startDate,date)/7)+1;
export function academicYear(date){const [year,month]=date.split('-').map(Number);return month>=9?year:year-1;}
export function resolveGrade(profile,date){if(!profile)return null;const cohort=Number(profile.enrollmentYear);if(Number.isInteger(cohort)&&cohort>=2000&&cohort<=academicYear(date)){const grade=academicYear(date)-cohort+1;return grade>=1&&grade<=8?grade:null;}return profile.academicYear===academicYear(date)&&Number.isInteger(profile.grade)&&profile.grade>=1&&profile.grade<=8?profile.grade:null;}
export function buildStudyPolicy(profile,calendar,previous={}){const resolved=profile||previous.profile||null;const enabled=previous.userEnabled===true||(previous.userEnabled==null&&previous.enabled===true&&previous.userDisabled!==true);return {enabled,userEnabled:enabled,userDisabled:!enabled,profile:resolved,holidayDates:calendar.holidayDates,verifiedYears:calendar.verifiedYears,sourceLabel:'本人设置 · 大一晚自习规则',startTime:'19:00',endTime:'20:30'};}
// Study is a local activity; the original school's course rules remain untouched.
export function studyDay(snapshot,date,localMaps=[],holidaySettings=null){
 const p=snapshot.studyPolicy;
 if(!validDate(date)||!p||!p.enabled||p.userEnabled!==true||resolveGrade(p.profile,date)!==1)return [];
 const w=weekOf(snapshot,date);if(w<1||w>snapshot.semester.weeks)return [];
 if(holidayForDate(holidaySettings,date)?.skipStudy)return [];
 // 晚自习独立于休假和调休：法定假日与调走日默认仍显示，可按天取消。
 const maps=[...(snapshot.remaps||[]),...localMaps].filter(m=>m.date===date);
 const origin=[date,...maps.map(m=>m.fromDate)].find(d=>[7,1,2,3,4].includes(weekday(d))&&weekOf(snapshot,d)>=1&&weekOf(snapshot,d)<=snapshot.semester.weeks);
 if(!origin)return [];
 const mapped=origin!==date;
 return [{id:'local-evening-study',ruleId:'local-evening-study',key:date+'/local-evening-study',date,originDate:origin,name:'晚自习',teacher:'—',room:'—',weekday:weekday(date),periods:[9,10],startTime:'19:00',endTime:'20:30',weeks:[w],source:'local',localActivity:true,sourceLabel:p.sourceLabel,studyCalendarUnknown:!(p.verifiedYears||[]).includes(Number(date.slice(0,4))),...(mapped?{remapId:maps.find(m=>m.fromDate===origin)?.id}:{})}];
}
export function withStudyPolicy(snapshot,profile,calendar,previousSnapshot){const next=clone(snapshot);next.studentProfile=profile||previousSnapshot?.studentProfile||null;next.studyPolicy=buildStudyPolicy(next.studentProfile,calendar,previousSnapshot?.studyPolicy);return next;}
