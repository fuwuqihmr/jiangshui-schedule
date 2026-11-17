// 示例模式底部示例菜单：纯数据 + 纯渲染。
// 约束（A4 / task-50）：
// 1. 只读：本模块不写持久化存储 / 不调原生桥 / 不发网络请求，不读取个人课表或缓存；
// 2. 隔离：所有内容都由传入的示例状态（sampleState）或固定占位文本合成，入口动作全部是
//    跳转/弹窗/列表类，调用方 app.mjs 仍由 sampleReadActions 白名单门控；
// 3. 脱敏：示例课程名/教师/教室沿用内置合成样例（课程A、教师A、A101），变更/通知/日志
//    样例不包含姓名、学号、账号、Cookie、URL 或真实课表。
import {addDays,timetableDay,validDate} from './core.mjs';
import {buildCalendarEvents} from './calendar-events.mjs';
import {formatDiagnostics} from './diagnostics.mjs';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>`${Number(String(d).slice(5,7))}月${Number(String(d).slice(8))}日`;
const DOW='一二三四五六日';
const dow=d=>'星期'+DOW[(new Date(`${d}T00:00:00Z`).getUTCDay()||7)-1];

/** 菜单分组：折叠态只占一行，展开后按组列出入口。 */
export const SAMPLE_MENU_GROUPS=Object.freeze([
  {id:'timetable',title:'课表',entries:Object.freeze([
    {id:'today',action:'sample-menu-today',label:'今日课表示例',hint:'跳到今日页查看内置示例课表'},
    {id:'week',action:'sample-menu-week',label:'完整课表示例',hint:'跳到完整课表页，可切换周次查看'},
  ])},
  {id:'changes',title:'变化与通知',entries:Object.freeze([
    {id:'changes',action:'sample-menu-changes',label:'变更记录示例',hint:'在变更记录页查看合成的课表变化（只读）'},
    {id:'notifications',action:'sample-menu-notifications',label:'通知内容示例',hint:'预览变化通知的标题与正文，不会真的发送'},
  ])},
  {id:'leave',title:'请假与日历',entries:Object.freeze([
    {id:'leave',action:'sample-menu-leave',label:'假条状态示例',hint:'打开假条页查看示例请假与销假记录（只读）'},
    {id:'calendar',action:'sample-menu-calendar',label:'日历写入预览',hint:'预览将写入系统日历的课程条数，不会写入'},
  ])},
  {id:'export',title:'导出与排查',entries:Object.freeze([
    {id:'export',action:'sample-menu-export',label:'课表导出示例',hint:'用示例数据导出课表，文件名带「示例-」前缀'},
    {id:'diagnostics',action:'sample-menu-diagnostics',label:'排查日志示例',hint:'查看排查日志的固定字段样式，不含个人数据'},
  ])},
]);

/** 展开后的全部入口（扁平）。 */
export function sampleMenuEntries(){
  return SAMPLE_MENU_GROUPS.flatMap(group=>group.entries);
}

/** 示例菜单需要的 data-action 全集；app.mjs 把它并入 sampleReadActions 白名单。 */
export function sampleMenuActionIds(){
  return ['sample-menu-toggle',...sampleMenuEntries().map(entry=>entry.action)];
}

/** 底部菜单：expanded=false 时只有一行折叠态；展开后按组列出入口按钮。 */
export function renderSampleMenu({expanded=false}={}){
  const open=expanded===true;
  const entries=sampleMenuEntries();
  const groups=SAMPLE_MENU_GROUPS.map(group=>`<div class="sample-example-group" role="group" aria-label="${esc(group.title)}"><h3>${esc(group.title)}</h3><div class="sample-example-links">${group.entries.map(entry=>`<button type="button" class="button sample-example-link" data-action="${esc(entry.action)}" data-sample-entry="${esc(entry.id)}"><strong>${esc(entry.label)}</strong><small>${esc(entry.hint)}</small></button>`).join('')}</div></div>`).join('');
  return `<section class="sample-example-menu" id="sample-example-menu" aria-labelledby="sample-example-menu-title"><button type="button" class="sample-example-menu-toggle" id="sample-example-menu-toggle" data-action="sample-menu-toggle" aria-expanded="${open}" aria-controls="sample-example-menu-body"><span class="sample-example-menu-text"><strong id="sample-example-menu-title">示例功能菜单</strong><span>${entries.length} 个示例入口 · 只读，不影响个人课表与登录状态</span></span><span class="badge purple">示例</span><svg class="sample-example-menu-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>${open?`<div class="sample-example-menu-body" id="sample-example-menu-body">${groups}</div>`:''}</section>`;
}

const CHANGE_TYPES=['换教室','改时间','停课'];

/**
 * 基于示例课表生成 3 条合成变更记录（只读展示用）。
 * 从 date 起向后最多找 21 天，取实际有课的日期/课程名，变化值固定为合成值；
 * 不修改传入 state。没有可用课程时返回空数组。
 */
export function sampleChangeExamples(state,date,limit=3){
  const snapshot=state?.snapshot;
  if(!snapshot||!validDate(date))return [];
  const max=Math.max(1,Math.min(6,Number(limit)||3));
  const weeks=Math.max(1,Number(snapshot.semester.weeks)||1);
  const end=addDays(snapshot.semester.startDate,weeks*7-1);
  const out=[];
  for(let offset=0;offset<21&&out.length<max;offset++){
    const day=addDays(date,offset);
    if(day>end)break;
    let rows;
    try{
      rows=timetableDay(snapshot,day,state.overrides||[],state.localMaps||[],state.courseSettings||{},state.customCourses||[],state.holidaySettings||null);
    }catch{
      continue;
    }
    for(const row of Array.isArray(rows)?rows:[]){
      if(out.length>=max)break;
      if(!row||row.cancelled||row.vacant||row.localActivity||!row.name)continue;
      if(!(String(row.startTime)<String(row.endTime)))continue;
      const type=CHANGE_TYPES[out.length%CHANGE_TYPES.length];
      const before={},after={};
      if(type==='换教室'){
        before.room=row.room&&row.room!=='—'?row.room:'待学校确认';
        after.room='B201';
      }else if(type==='改时间'){
        before.startTime=row.startTime;before.endTime=row.endTime;
        after.startTime='10:15';after.endTime='11:40';
      }else{
        before.startTime=row.startTime;before.endTime=row.endTime;before.room=row.room||'待学校确认';
      }
      out.push({id:`sample-change-${out.length+1}`,key:`sample-change-${day}-${out.length+1}`,date:day,name:row.name,type,before,after:type==='停课'?null:after,source:'sample',demo:true});
    }
  }
  return out;
}

function changeSummary(record){
  const before=record.before||{},after=record.after||{};
  if(record.type==='停课')return `原安排 ${[before.startTime,before.endTime].filter(Boolean).join('–')}${before.room?' · '+before.room:''} 已停课`;
  if(record.type==='换教室')return `教室：${before.room??'—'} → ${after.room??'—'}`;
  return `时间：${before.startTime??'—'}–${before.endTime??'—'} → ${after.startTime??'—'}–${after.endTime??'—'}`;
}

/** 变更记录列表（示例数据只读展示）。 */
export function renderSampleChangeList(records){
  if(!Array.isArray(records)||!records.length)return '<p class="subtle">当前示例课表暂无可展示的变化。</p>';
  return `<div class="sample-example-list">${records.map(record=>`<article class="sample-example-item"><div class="sample-example-item-head"><span class="badge purple">${esc(record.type)}</span><strong>${esc(record.name)}</strong><span class="subtle">${esc(fmt(record.date))} ${esc(dow(record.date))}</span><span class="badge amber">示例数据</span></div><p>${esc(changeSummary(record))}</p></article>`).join('')}</div>`;
}

/** 通知预览：与真实 notifyPending 相同的标题/正文结构，但示例模式不发送。 */
export function sampleNotificationPreview(records){
  const list=(Array.isArray(records)?records:[]).slice(0,3);
  return {
    title:`课表有 ${list.length} 处变化（示例）`,
    body:list.map(record=>`${fmt(record.date)} ${record.name}：${record.type}`).join('；'),
    count:list.length,
    sent:false,
  };
}

export function renderSampleNotificationPreview(records){
  const preview=sampleNotificationPreview(records);
  if(!preview.count)return '<p class="subtle">当前示例课表暂无可展示的变化通知。</p>';
  return `<div class="sample-notification-card" role="status"><strong>${esc(preview.title)}</strong><p>${esc(preview.body)}</p></div><p class="subtle">正式版在课表出现变化时用系统通知发送这两行内容；示例模式只预览，不会发送通知，也不会写入个人记录。</p>`;
}

/** 系统日历写入预览：只统计示例课表会产生的日历事件，不调用 calendarSync。 */
export function sampleCalendarPreview(state){
  const result=buildCalendarEvents(state);
  if(result.error)return {error:result.error,total:0,skipped:Number(result.skipped)||0,events:[],bySource:{}};
  const bySource={school:0,custom:0,study:0,exam:0};
  for(const event of result.events||[])bySource[event.source]=(bySource[event.source]||0)+1;
  return {
    error:null,
    total:Number(result.total)||0,
    skipped:Number(result.skipped)||0,
    bySource,
    events:(result.events||[]).slice(0,3).map(event=>({title:event.title,startDate:event.startDate,startTime:event.startTime,location:event.location})),
  };
}

export function renderSampleCalendarPreview(state){
  const preview=sampleCalendarPreview(state);
  if(preview.error)return `<p class="subtle">${esc(preview.error.message||'无法生成日历预览')}</p>`;
  const items=preview.events.map(event=>`<li>${esc(fmt(event.startDate))} ${esc(event.startTime)} · ${esc(event.title)}${event.location?' · '+esc(event.location):''}</li>`).join('');
  const groups=['school','custom','study','exam'].filter(key=>preview.bySource[key]).map(key=>({school:'学校课程',custom:'自定义/本地修改',study:'晚自习',exam:'考试'}[key]||key)+' '+preview.bySource[key]+' 条').join(' · ');
  return `<p>按当前示例课表，将可写入系统日历 <strong>${preview.total}</strong> 条课程事件${groups?'（'+esc(groups)+'）':''}${preview.skipped?`，另有 ${preview.skipped} 行因停课、空位或缺时间被跳过`:''}。</p>${items?`<ul class="sample-example-ul">${items}</ul>`:''}<p class="subtle">这里只做预览：示例模式不会调用系统日历写入，不会清空或修改本机已有的日历事件，也不会把示例写进个人日历。</p>`;
}

/** 导出面板：复用既有导出动作，作用对象是 displayState()（示例模式即 sampleState）。 */
export function renderSampleExportPanel({week=1}={}){
  const n=Math.max(1,Number(week)||1);
  return `<p>示例模式可以用内置示例课表完整演示导出流程，导出的文件名会自动加「示例-」前缀；<strong>不会导出个人课表</strong>，也不会修改任何个人设置。</p><div class="settings-list" role="group" aria-label="示例导出方式"><button type="button" class="button primary" data-action="export-week">导出这一周（第 ${n} 周）</button><button type="button" class="button primary" data-action="export-semester">导出整个学期</button></div><p class="subtle">浏览器预览会直接下载文件；安装版会弹出系统保存位置选择，取消保存不会报错。</p>`;
}

/**
 * 排查日志样例：复用真实 formatDiagnostics 生成固定文本，
 * 输入全部是占位值（版本 0.0.0、示例系统、两条白名单事件），不读取个人诊断数据。
 */
export function sampleDiagnosticsText(){
  const data={
    platform:'android',
    appVersion:'0.0.0',
    systemVersion:'16',
    androidApi:35,
    engineVersion:'0.0.0',
    events:[
      '11-18 09:00:00 read-start background=false profile-known=true',
      '11-18 09:00:03 web-read ok weeks=18 rows=0 elapsed-ms=3000 sso=false background=false',
    ],
  };
  return formatDiagnostics(data,'',null);
}

export function renderSampleDiagnosticsPreview(){
  return `<p class="scope">下面是排查日志的固定字段样式（版本号 0.0.0 为占位值）。示例模式不读取个人诊断数据，也不会上传。</p><pre class="sample-diagnostics">${esc(sampleDiagnosticsText())}</pre>`;
}
