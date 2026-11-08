import {daysBetween,validDate} from './core.mjs';

export const emptyHolidaySettings=()=>({winter:null,summer:null,days:[]});
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
