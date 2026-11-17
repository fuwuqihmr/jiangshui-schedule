import {daysBetween,validDate} from './core.mjs';

// restoreDates：本机“单日恢复上课”标记。只对当天确实被取消（休假/寒暑假/学校停课日）
// 的日期生效；日期不再被取消时标记保留但无效果，再次被取消时重新生效（界面会显示
// 已恢复并允许取消恢复）。值为 YYYY-MM-DD 字符串，升序去重，随 state.holidaySettings
// 一起持久化；applySnapshot/adoptSchoolSnapshot 只克隆本机层，因此刷新学校快照不丢。
export const emptyHolidaySettings=()=>({winter:null,summer:null,days:[],restoreDates:[]});
// 校验失败必须返回 false 而不是抛错：损坏的历史 state 不能让启动/保存崩溃
// （core.validDate 对 2026-13-01 这类月份越界会抛 RangeError，因此这里自己判断）。
const safeDate=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const parsed=new Date(value+'T00:00:00Z');
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
};
function normalizeRestoreDates(list){
 if(!Array.isArray(list))return [];
 return [...new Set(list.filter(item=>safeDate(item)))].sort();
}
// 旧 state 没有 restoreDates 时补空数组；非法/重复/非字符串项丢弃，未知键保留。
export function normalizeHolidaySettings(settings){
 const merged={...emptyHolidaySettings(),...(settings&&typeof settings==='object'?settings:{})};
 return {...merged,restoreDates:normalizeRestoreDates(merged.restoreDates)};
}
export function isRestoredDate(settings,date){
 return validDate(date)&&Array.isArray(settings?.restoreDates)&&settings.restoreDates.includes(date);
}
export function setRestoreDate(settings,date,restored=true){
 if(!safeDate(date))throw Error('恢复日期无效');
 const dates=normalizeRestoreDates(settings?.restoreDates).filter(item=>item!==date);
 if(restored===true)dates.push(date);
 return {...emptyHolidaySettings(),...settings,restoreDates:dates.sort()};
}
export function holidayForDate(settings,date){
 if(!validDate(date))return null;
 const day=(settings?.days||[]).find(item=>item.date===date);
 for(const kind of ['winter','summer']){
  const range=settings?.[kind];
  if(range?.startDate<=date&&date<=range?.endDate)return {kind,skipStudy:day?.skipStudy===true};
 }
 return day?{kind:'day',skipStudy:day.skipStudy===true}:null;
}
export function setHolidayRange(settings,kind,startDate,endDate){
 if(!['winter','summer'].includes(kind))throw Error('假期类型无效');
 if(!startDate&&!endDate)return {...emptyHolidaySettings(),...settings,[kind]:null};
 if(!validDate(startDate)||!validDate(endDate)||daysBetween(startDate,endDate)<0||daysBetween(startDate,endDate)>180)throw Error('请设置起止日期正确、最长 181 天的假期');
 return {...emptyHolidaySettings(),...settings,[kind]:{startDate,endDate}};
}
export function setHolidayDay(settings,date,skipStudy=false){
 if(!validDate(date))throw Error('休假日期无效');
 const days=(settings?.days||[]).filter(item=>item.date!==date);
 return {...emptyHolidaySettings(),...settings,days:[...days,{date,skipStudy:skipStudy===true}].sort((a,b)=>a.date.localeCompare(b.date))};
}
export function removeHolidayDay(settings,date){
 return {...emptyHolidaySettings(),...settings,days:(settings?.days||[]).filter(item=>item.date!==date)};
}
