import {WEEK_SLOTS,weekDayBlocks} from './week-layout.mjs';
import {showNotice,positionNotices} from './notifications.mjs';
import {courseOngoing} from './course-time.mjs';
import {formatDiagnostics,failureCategory} from './diagnostics.mjs';
import {appendScheduleTrace} from './schedule-diagnostics.mjs';
import {createTimetableExport,bytesToBase64} from './timetable-export.mjs';
import {reminderSettings,validateReminderSettings,reminderStatus} from './reminders.mjs';
import {normalizeSchool} from './school.mjs';
import {saveCustomCourse,deleteCustomCourse,customCourseSummary,customCourseBackup,importCustomCourses,alignCustomCoursesToSemester} from './custom-courses.mjs';
import {buildBundle,SEMESTER_MONDAYS} from './jsxsd.mjs';
import {addDays,weekday,weekOf,today,createState,validateSnapshot,timetableDay,applySnapshot,adoptSchoolSnapshot,recordFailure,saveOverride,noticeLevel,clone,saveCourseSettings,latestIso} from './core.mjs';
import {withStudyPolicy,resolveGrade} from './study.mjs';
import {emptyHolidaySettings,holidayForDate,setHolidayRange,setHolidayDay,removeHolidayDay} from './holiday-settings.mjs';
import {courseSettingKey,matchesCourse,swipeDirection} from './interactions.mjs';
import {THEMES,applyTheme,themePreference,resolvedTheme,onThemeChanged} from './theme.mjs';
import {LEAVE_SERVICES,openLeaveService,XGXT_ORIGIN} from './leave.mjs';
import {normalizeLeaveStatusCache,sampleLeaveRecords,getLeaveRecordsProvider as moduleLeaveRecordsProvider,createSchoolRecordsProvider,leaveMarkForCourse,matchLeaveMarks,leaveRecordsForDate,sortLeaveRecords,leaveStatusLabel,leaveTypeLabel,leaveStatusSummary,leaveCancelState,cancelStatusLabel,visibleLeaveRecords,CANCEL_COPY,shouldRefreshCancelAfterLeave,normalizeManualCancelMarks,applyManualCancel,markManualCancel,unmarkManualCancel,manualCancelDateLabel} from './leave-status.mjs';
import {buildCalendarEvents,normalizeCalendarOptions} from './calendar-events.mjs';
import {loadFeedbackInfo,openFeedback,feedbackPanel} from './feedback.mjs';
import {normalizeUpdateInfo,normalizeRelease,releaseTitle,releaseTag,updateErrorText} from './update.mjs';
const icons={tomorrow:'M8 2v4m8-4v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2zM8 13h3v3H8',week:'M3 3h18v18H3zM3 9h18M9 3v18M15 3v18M3 15h18',changes:'M18 8a7 7 0 1 0 1 8M18 3v5h-5M12 8v5l3 2',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 9l-2 1v4l2 1 2 3v2h4l2-2 2 2h4v-3l2-2 2-1v-4l-2-1-2-3V3h-4l-2 2-2-2H6v3z',refresh:'M20 6v5h-5M4 18v-5h5M19 10a7 7 0 0 0-12-5L4 8m1 6a7 7 0 0 0 12 5l3-3',left:'M15 5l-7 7 7 7',right:'M9 5l7 7-7 7',pin:'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6',person:'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21v-3a8 8 0 0 1 16 0v3',check:'M5 12l4 4L19 6',close:'M5 5l14 14M19 5L5 19',bell:'M18 8a6 6 0 0 0-12 0v6l-2 3h16l-2-3zM9 21h6',arrow:'M4 12h16M14 6l6 6-6 6',moon:'M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12',file:'M5 2h9l5 5v15H5zM14 2v6h5M8 13h8M8 17h6'};
const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[n]||icons.file}"/></svg>`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function traceNumberHash(value){let h=2166136261;for(const ch of String(value)){h=Math.imul(h^ch.codePointAt(0),16777619);}return (h>>>0).toString(16);}
const fmt=d=>`${Number(d.slice(5,7))}月${Number(d.slice(8))}日`;
const dow=d=>'星期'+'一二三四五六日'[weekday(d)-1];
const stamp=s=>s?new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'尚未读取教务系统';
function footerStampText(){const state=displayState();return state.snapshot.source.kind==='sample'?'样例来源：交接文件 · '+esc(state.snapshot.source.exportedAt)+' · 非实时教务数据':'数据截至 '+stamp(state.lastSuccess);}
function footerContent(){const current=displayState();return footerStampText()+(current.error?' · 自上次成功读取后未能确认':'');}
function updateFooterStamp(){const host=document.querySelector('#footer-stamp');if(!host)return;host.innerHTML=footerContent();}
const colors=[['#efedfb','#877ec3','#665d92','#302a43','#e3d9ff'],['#eaf3fc','#71a2c7','#547c9d','#203449','#cee6ff'],['#eaf5ef','#7bad93','#5e8a73','#233b30','#d0efdb'],['#fff2e8','#d6a279','#a47a55','#432f23','#ffdfc4'],['#fbeef2','#c389a3','#9b6a82','#422b37','#f6d5e5']];
const courseColor=r=>{let n=0;for(const c of r.name)n+=c.charCodeAt(0);const p=colors[n%colors.length];return `--card-bg:${p[0]};--card-accent:${p[1]};--card-ink:${p[2]};--card-dark-bg:${p[3]};--card-dark-ink:${p[4]}`;};
import {native,call,androidCallbacks} from './bridge.mjs';
import {agreement,agreementContent,consentKey} from './consent.mjs';
let pendingSchool=null,sampleState=null,sampleReturnView=null;
const sampleReadActions=new Set(['export-diagnostics','export-week','export-semester','export-semester-pages','export-semester-overview','export-semester-rules','cancel-export','nav','close','detail','show-day','day-prev','day-next','show-week','week-prev','week-next','this-week','select-week-date','agreement','sample-exit','leave-status-all','leave-status-detail','leave-status-refresh','leave-status-clear-demo','leave-page-back','leave-filter','leave-page-detail']);
const schoolRecordsProvider=createSchoolRecordsProvider({request:payload=>call('leaveRecordSync',payload)});
const cancelRecordsProvider=createSchoolRecordsProvider({request:payload=>call('cancelRecordSync',payload)});
function displayState(){return sampleState||state;}
let exportingTimetable=false,exportCancelRequested=false,leaveOpening=false;
let leaveView=null,leaveRefreshPromise=null,cancelRefreshPromise=null,lastLeaveAttemptAt=0,lastLeaveSuccessDate=null,leaveAutoTimer=null,leaveModalOpen=false,leaveEpoch=0,leaveFocusPending=null,leaveScrollPending=0,leavePageOpen=false,leavePageFilter='all',leavePageExpanded=new Set(),leavePageReturnFocus=null,leavePagePushed=false;
let state,tab='tomorrow',selectedDate=today(),selectedWeek=1,weekSelectedDate=today(),filter='',busy=false,progressLabel='',progressStarted=0,progressTimer=null,readFeedback=null,readEpoch=0;
let feedbackInfo=null;
let appUpdateInfo=null,appUpdateBusy=false,appUpdateLatest=null,appUpdatePrompted="",appUpdateRun=0;
let autoUpdateLastAt=0,leaveNoticeOpen=false,leaveNoticeTimer=null,leaveNoticeSeconds=0,leaveNoticeKey='leave',leaveNoticeReturnFocus=null;
let calendarInfo=globalThis.Android?null:{available:false,writable:false,permission:'prompt',calendarId:null,lastSyncAt:null,lastEventCount:0,lastSemesterId:null},calendarBusy=false,calendarError=null;
function visibleWeek(snapshot,date=today()){return Math.max(1,Math.min(snapshot.semester.weeks,weekOf(snapshot,date)));}
function selectVisibleWeek(snapshot,date=today()){selectedWeek=visibleWeek(snapshot,date);weekSelectedDate=date;}
const samples={baseline:await (await fetch('./data/baseline.json')).json(),adjusted:await (await fetch('./data/adjusted.json')).json()};
const holidayCalendar=await (await fetch('./data/holidays.json')).json();
try{const saved=native?await call('loadState'):JSON.parse(localStorage.getItem('tomorrow-state'));if(saved){validateSnapshot(saved.snapshot);if(!Array.isArray(saved.events)||!Array.isArray(saved.overrides)||!Array.isArray(saved.localMaps))throw Error('数据格式不正确');state=saved;}}catch(e){console.warn('Local state unavailable');}
state ||= createState(samples.adjusted);
state.autoUpdate=state.autoUpdate!==false;
state.leaveNoticeEnabled=state.leaveNoticeEnabled!==false;
const SETTINGS_GROUP_KEYS={自动更新:'auto','课表与显示':'display','请假与调休':'leave','课程与提醒':'course','数据与同步':'data','关于与隐私':'about'};
const SETTINGS_GROUP_SUMMARIES={
 '自动更新':'打开应用自动核对学校课表',
 '课表与显示':'外观主题 · 首页显示 · 完整课表',
 '请假与调休':'请假服务 · 调休安排 · 休假设置',
 '课程与提醒':'上课提醒 · 晚自习 · 自定义课程',
 '数据与同步':'<b>写入系统日历</b> · 教务系统 · 导出与排查日志',
 '关于与隐私':'版本信息 · 用户协议 · 开源与致谢'
};
const SETTINGS_GROUP_DEFAULT={auto:true,display:false,leave:false,course:false,data:false,about:false};
state.settingsExpanded=normalizeSettingsExpanded(state.settingsExpanded);
state.calendarOptions=normalizeCalendarOptions(state.calendarOptions);
state.showDayOverview=state.showDayOverview===true;
state.courseSettings ??= {};
state.customCourses ??= [];
const alignedCourses=alignCustomCoursesToSemester(state.customCourses,state.snapshot.semester);
const customCourseMigrationNeeded=alignedCourses.some((course,index)=>course!==state.customCourses[index]);
state.customCourses=alignedCourses;
state.holidaySettings ??= emptyHolidaySettings();
state.leaveUnreadBaseline ??= null;
state.leaveUnread=state.leaveUnread===true;
state.classReminders=reminderSettings(state.classReminders);
if(native&&state.classReminderPreferenceSet!==true)state.classReminders.enabled=true;
state.leaveStatus=normalizeLeaveStatusCache(state.leaveStatus,state.snapshot.semester.id);
const rawMarkCount=Array.isArray(state.manualLeaveCancels)?state.manualLeaveCancels.length:Array.isArray(state.manualLeaveCancels?.marks)?state.manualLeaveCancels.marks.length:0;
state.manualLeaveCancels=normalizeManualCancelMarks(state.manualLeaveCancels);
if((state.manualLeaveCancels.marks||[]).length!==rawMarkCount)console.debug('[trace] event=normalize source=normalize rev='+(state._revision??0)+' marks='+(state.manualLeaveCancels.marks||[]).length);
console.debug('[trace] state-load source='+(native?'native-snapshot':'localStorage')+' rev='+(state._revision??0)+' marks='+(state.manualLeaveCancels.marks||[]).length);
state.courseLastSuccess ??= state.lastSuccess ?? null;
state.leaveLastSuccess ??= state.leaveStatus?.fetchedAt ?? null;
leaveView=storedLeaveView();
applyTheme(state.theme||themePreference());
function nativeTheme(){const style=getComputedStyle(document.documentElement);if(native)call('setTheme',{preference:themePreference(),dark:resolvedTheme()==='dark',background:style.getPropertyValue('--bg').trim(),surface:style.getPropertyValue('--surface').trim()}).catch(()=>{});}
onThemeChanged(()=>{nativeTheme();if(state)render();});nativeTheme();
let reminderInfo=null,refreshingReminders=false;
let permissionInfo=null,permissionError=false,permissionRefreshing=false,permissionFixing=false,permissionOnboardingTried=false;
const PERMISSION_ONBOARDING_KEY='jiangshui-permission-onboarding-v1';
function reminderDescription(){const s=reminderSettings(state.classReminders);return s.enabled?`提前 ${s.leadMinutes} 分钟出现 · 开课后 ${s.afterStartMinutes} 分钟结束`:'尚未开启 · 默认提前 30 分钟，开课后保留 5 分钟';}
function activeClassReminders(){return sampleState?[]:(reminderInfo?.active||[]).filter(r=>Number(r.expiresAt)>Date.now());}
function renderClassReminderCards(){return activeClassReminders().map(r=>`<article class="class-reminder-card" data-reminder-id="${esc(r.id)}"><div class="class-reminder-main"><h2><span>${esc(r.startTime)}–${esc(r.endTime)}</span> ${esc(r.room&&r.room!=='—'?r.room:'地点待确认')}</h2><img src="./assets/app-icon.png" alt="江水课表" width="38" height="38"></div><p class="class-reminder-course">${esc(r.name)}</p><p class="class-reminder-teacher">老师：${esc(r.teacher&&r.teacher!=='—'?r.teacher:r.name==='晚自习'?'无任课老师':'老师待确认')}</p><div class="class-reminder-footer"><strong class="class-reminder-countdown">${reminderStatus(r)}</strong><button class="button" data-action="class-reminder-close" data-id="${esc(r.id)}">关闭本次提醒</button></div><p class="class-reminder-expiry">${fmt(r.date)} · 将于 ${new Date(r.expiresAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'})} 自动结束</p></article>`).join('');}
function renderReminderIntro(){return native&&!sampleState&&!state.reminderIntroAcknowledged?`<section class="reminder-intro" role="status" aria-label="上课提醒说明"><div class="reminder-intro-content">${icon('bell')}<div><strong>${state.classReminders.enabled?'上课提醒已默认开启':'上课提醒目前已关闭'}</strong><p>上课提醒功能可在「设置与数据」中${state.classReminders.enabled?'关闭':'重新开启'}；如系统请求通知权限，请允许后接收锁屏提醒。</p></div></div><button class="button reminder-intro-button" data-action="ack-reminder-intro">了解了</button></section>`:'';}
function renderLocalUndo(dates){if(!native||sampleState)return '';const selectedDates=Array.isArray(dates)?dates:[dates],maps=state.localMaps.filter(m=>selectedDates.includes(m.date)||selectedDates.includes(m.fromDate)),edits=state.overrides.filter(o=>selectedDates.includes(o.date));if(!maps.length&&!edits.length)return '';const heading=Array.isArray(dates)?`第 ${selectedWeek} 周的本机调整`:`${fmt(selectedDates[0])} 的本机调整`;return `<section class="local-undo-banner" aria-label="本机调课撤销"><div><strong>${heading}</strong><p>调错后可在这里一键撤销，仅撤销本机修改，学校课程不会被删除。</p></div><div class="local-undo-actions">${maps.map(m=>`<button class="button" data-action="undo-local-remap" data-id="${esc(m.id)}">撤销调课：${fmt(m.fromDate)} → ${fmt(m.date)}</button>`).join('')}${edits.map(o=>`<button class="button" data-action="undo-local-edit" data-key="${esc(o.key)}" data-date="${esc(o.date)}">撤销${fmt(o.date)}修改：${esc(o.base?.name||'课程')}</button>`).join('')}</div></section>`;}
function renderClassReminders(){return globalThis.Android&&!sampleState?`<section id="class-reminder-cards" aria-label="正在显示的上课提醒" aria-live="polite">${renderClassReminderCards()}</section>`:'';}
function storedLeaveView(){const cached=normalizeLeaveStatusCache(state.leaveStatus,state.snapshot.semester.id);return {records:cached.records,provider:cached.provider||null,fetchedAt:cached.fetchedAt,loading:false,error:null,skipped:cached.skipped||0,cancelFresh:false,cancelError:null};}
function leaveCancelFor(record){const base=leaveCancelState(record,leaveView.records,{fresh:leaveView.cancelFresh===true});return applyManualCancel(base,record,state.manualLeaveCancels);}
function sampleLeaveView(){return {records:sampleLeaveRecords(sampleState,today()),provider:'sample',fetchedAt:null,loading:false,error:null,skipped:0,cancelFresh:true,cancelError:null};}
let lastHiddenCancelCount=-1;
function visibleLeaveRecordsForUi(records){const all=Array.isArray(records)?records:[];const visible=visibleLeaveRecords(all);const hidden=all.length-visible.length;if(hidden!==lastHiddenCancelCount){lastHiddenCancelCount=hidden;if(hidden>0)console.warn(`leave cancel records hidden: ${hidden}`);}return visible;}
function leaveUpdatedLabel(){const at=displayState().leaveLastSuccess||displayState().lastSuccess;if(!at)return '';const date=new Date(at);return Number.isNaN(date.getTime())?'':date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'});}
function leaveStatusBadge(status){const label=leaveStatusLabel(status);const kind={approved:'green',pending:'amber',rejected:'red'}[status]||'';return `<span class="badge leave-badge ${esc(status||'unknown')} ${kind}">${esc(label)}</span>`;}
function cancelStatusBadge(status){const label=cancelStatusLabel(status);const kind={approved:'green',pending:'amber',rejected:'red'}[status]||'';return `<span class="badge leave-badge cancel-badge ${esc(status||'unknown')} ${kind}">${esc(label)}</span>`;}
function recordStatusBadge(record){return record.type==='cancel'?cancelStatusBadge(record.status):leaveStatusBadge(record.status);}
function leaveRecordTime(record){if(!record.startDate)return CANCEL_COPY.timeUnknown;const same=record.startDate===record.endDate;return `${same?fmt(record.startDate):fmt(record.startDate)+'–'+fmt(record.endDate)} ${record.startTime}–${record.endTime}`;}
function leaveRecordRow(record){const note=record.reason||(record.status==='unknown'&&record.rawStatus)||'未填写原因';const cancel=record.type==='cancel'?null:leaveCancelFor(record);const cancelKind=cancel?({cancelled:'green',confirmed:'green',manual:'green',canceling:'amber','needs-cancel':'red',unknown:'amber'}[cancel.state]||''):'';const cancelBadge=cancel?`<span class="badge ${cancelKind}">${esc(cancel.label)}</span>`:'';const cancelButton=cancel?.canCancel?`<button class="button danger leave-cancel-button" data-action="leave-open" data-leave-key="cancel" aria-label="${esc(CANCEL_COPY.button)}">${esc(CANCEL_COPY.button)}</button>`:'';return `<article class="leave-status-row" data-status="${esc(record.status)}"><div class="leave-status-main"><div class="leave-status-top">${recordStatusBadge(record)}${cancelBadge}<strong>${esc(leaveTypeLabel(record.type))} · ${esc(leaveRecordTime(record))}</strong></div><p>${esc(note)}${record.approver?` · 审批人 ${esc(record.approver)}`:''}</p></div><button class="button" data-action="leave-status-detail" data-leave-id="${esc(record.id)}">详情</button>${cancelButton}</article>`;}
function leaveMarkDetailRow(course){const mark=leaveMarkForCourse(course,leaveView.records);if(!mark)return '';const times=[...new Set(mark.records.map(record=>`${record.startTime}–${record.endTime}`))].slice(0,3).join('、');return `<div class="detail-row"><span>请假</span><strong>${esc(leaveStatusLabel(mark.status))} ${esc(times)}</strong></div>`;}

const LEAVE_PAGE_FILTERS=[['all','全部'],['pending','待审批'],['approved','已通过'],['rejected','已驳回']];
function leaveFilterLabel(value){return LEAVE_PAGE_FILTERS.find(([key])=>key===value)?.[1]||'全部';}
function leaveRecordDetailRows(record){const submitted=record.submittedAt?new Date(record.submittedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'—';const mapped=record.type==='cancel'?cancelStatusLabel(record.status):leaveStatusLabel(record.status);const raw=String(record.rawStatus||'').trim();const status=raw&&raw!==mapped?`${mapped}（学校：${raw}）`:mapped;return `<div class="detail-row"><span>状态</span><strong>${esc(status)}</strong></div><div class="detail-row"><span>起止</span><strong>${esc(record.startDate?record.startDate+' '+record.startTime+' – '+record.endDate+' '+record.endTime:CANCEL_COPY.timeUnknown)}</strong></div><div class="detail-row"><span>原因</span><strong>${esc(record.reason||'未填写')}</strong></div><div class="detail-row"><span>提交时间</span><strong>${esc(submitted)}</strong></div><div class="detail-row"><span>审批人</span><strong>${esc(record.approver||'—')}</strong></div><div class="detail-row"><span>审批意见</span><strong>${esc(record.comment||'—')}</strong></div><div class="detail-row"><span>来源</span><strong>${record.demo?'示例数据':'本机缓存'}</strong></div>`;}
function leavePageRecordRow(record){const expanded=leavePageExpanded.has(record.id);const note=record.reason||(record.status==='unknown'&&record.rawStatus)||'未填写原因';const detailId=`leave-detail-${record.id}`;const cancel=record.type==='cancel'?null:leaveCancelFor(record);const cancelKind=cancel?({cancelled:'green',confirmed:'green',manual:'green',canceling:'amber','needs-cancel':'red',unknown:'amber'}[cancel.state]||''):'';const cancelBadge=cancel?`<span class="badge ${cancelKind}">${esc(cancel.label)}</span>`:'';const cancelButton=cancel?.canCancel?`<button class="button danger leave-cancel-button" data-action="leave-open" data-leave-key="cancel" aria-label="${esc(CANCEL_COPY.button)}">${esc(CANCEL_COPY.button)}</button>`:'';return `<article class="leave-status-row leave-page-row" data-status="${esc(record.status)}"><div class="leave-status-main"><div class="leave-status-top">${recordStatusBadge(record)}${cancelBadge}<strong>${esc(leaveTypeLabel(record.type))} · ${esc(leaveRecordTime(record))}</strong></div><p>${esc(note)}${record.approver?` · 审批人 ${esc(record.approver)}`:''}</p>${expanded?`<div class="leave-page-record-detail" id="${esc(detailId)}">${leaveRecordDetailRows(record)}</div>`:''}</div><button class="button" data-action="leave-page-detail" data-leave-id="${esc(record.id)}" aria-expanded="${expanded}" aria-controls="${esc(detailId)}">${expanded?'收起':'详情'}</button>${cancelButton}</article>`;}
function renderLeavePageContent(){const records=sortLeaveRecords(visibleLeaveRecordsForUi(leaveView.records));const summary=leaveStatusSummary(records);const sample=leaveView.provider==='sample';const loading=leaveView.loading&&!records.length;const failed=leaveView.error&&!records.length;const updated=leaveUpdatedLabel();const filtered=leavePageFilter==='all'?records:records.filter(record=>record.status===leavePageFilter);let meta=`本地假条 · 共 ${records.length} 条`;if(loading)meta+=' · 正在更新…';else if(updated)meta+=` · 数据截至 ${updated}`;if(leaveView.error&&records.length)meta+=' · 更新失败，显示上次同步';if(leaveView.cancelError&&records.length)meta+=' · '+leaveView.cancelError.message;if(sample)meta+=' · 示例数据';let list='';if(failed)list=`<div class="leave-status-error" role="alert"><p>${esc(leaveView.error.message||'读取假条失败')}</p><button class="button" data-action="leave-status-refresh">重新读取</button></div>`;else if(loading)list='<div class="leave-status-loading" role="status">正在更新假条状态…</div>';else if(!records.length)list=`<div class="empty leave-status-empty">${icon('check')}<strong>还没有假条记录</strong><span>审批通过后会在课表里标注；这里只显示本机保存的假条。</span></div>`;else if(!filtered.length)list=`<div class="empty leave-status-empty">${icon('check')}<strong>这个筛选下没有记录</strong><span>切换「全部」查看其他假条。</span><button class="button" data-action="leave-filter" data-filter="all">查看全部</button></div>`;else list=filtered.map(record=>leavePageRecordRow(record)).join('');const filters=LEAVE_PAGE_FILTERS.map(([value,label])=>{const count=value==='all'?summary.total:summary[value]||0;return `<button type="button" class="button leave-filter-button" data-action="leave-filter" data-filter="${value}" aria-pressed="${leavePageFilter===value}">${label}<span>${count}</span></button>`;}).join('');return `<div id="leave-page-content"><p class="leave-status-meta" role="status" aria-live="polite">${esc(meta)}</p><div class="leave-summary" role="list" aria-label="假条汇总"><span role="listitem"><strong>${summary.approved}</strong>已批准</span><span role="listitem"><strong>${summary.pending}</strong>待审批</span><span role="listitem"><strong>${summary.rejected}</strong>已驳回</span><span role="listitem"><strong>${summary.unknown}</strong>未知</span></div><div class="leave-filter" role="group" aria-label="筛选假条状态">${filters}</div>${leaveView.error&&records.length?`<div class="leave-status-error" role="alert"><p>${esc(leaveView.error.message||'读取假条失败')}</p><button class="button" data-action="leave-status-refresh">重新读取</button></div>`:''}<div class="leave-page-list" id="leave-page-list">${list}</div><p class="leave-page-note">假条信息只保存在本机；${esc(CANCEL_COPY.exportNotice)}当前筛选：${esc(leaveFilterLabel(leavePageFilter))}。</p></div>`;}
function renderLeavePage(){const sample=leaveView.provider==='sample';const loading=leaveView.loading&&!leaveView.records.length;return `<main class="leave-page" id="leave-page" role="main" aria-label="假条状态" aria-labelledby="leave-page-title" tabindex="-1"><div class="leave-page-topbar"><button class="icon-button leave-page-back" data-action="leave-page-back" aria-label="返回">${icon('left')}</button><div class="leave-page-title-wrap"><p class="eyebrow">${esc(displayState().snapshot.semester.name)}</p><h1 id="leave-page-title">假条状态</h1></div><button class="button leave-page-refresh" data-action="leave-status-refresh" ${leaveView.loading?'disabled':''}>${leaveView.loading?'更新中…':'刷新'}</button></div><div class="leave-page-body">${sample?`<section class="leave-page-sample" role="status" aria-label="示例数据提示"><span class="badge amber">示例数据</span><p>当前为示例假条，仅用于预览，不会写入本机缓存。</p>${sampleState?badge('示例课表','purple'):''}</section>`:''}${renderLeavePageContent()}</div></main>`;}
function updateLeavePage(){if(!leavePageOpen)return;const page=document.querySelector('#leave-page');if(!page)return;const active=document.activeElement;const focus=page.contains(active)?{action:active.dataset.action||'',filter:active.dataset.filter||'',leaveId:active.dataset.leaveId||''}:null;const scroll=page.scrollTop;page.outerHTML=renderLeavePage();const next=document.querySelector('#leave-page');if(!next)return;if(focus){const target=[...next.querySelectorAll('[data-action]')].find(el=>el.dataset.action===focus.action&&(!focus.filter||el.dataset.filter===focus.filter)&&(!focus.leaveId||el.dataset.leaveId===focus.leaveId));if(target)target.focus({preventScroll:true});else next.focus({preventScroll:true});}else next.focus({preventScroll:true});next.scrollTop=scroll;}
function toggleLeavePageDetail(id){if(!id)return;if(leavePageExpanded.has(id))leavePageExpanded.delete(id);else leavePageExpanded.add(id);updateLeavePage();}
function openLeavePage({fromHistory=false}={}){if(leavePageOpen)return;if(document.querySelector('.modal'))close();leavePageReturnFocus=globalThis.HTMLElement&&document.activeElement instanceof HTMLElement?document.activeElement:null;leavePageOpen=true;leavePageFilter='all';leavePageExpanded.clear();if(!fromHistory){try{history.pushState({leavePage:true},'','#leave-status');leavePagePushed=true;}catch{}}else{try{history.replaceState(Object.assign({},history.state,{leavePage:true}),'','#leave-status');}catch{}}const app=document.querySelector('#app');if(app){app.setAttribute('aria-hidden','true');app.setAttribute('inert','');}document.body.classList.add('leave-page-open');document.body.insertAdjacentHTML('beforeend',renderLeavePage());document.querySelector('#leave-page')?.focus({preventScroll:true});if(!leaveView.records.length&&!leaveView.loading&&!leaveView.error&&leaveView.provider!=='sample'&&leaveView.provider!==null)void refreshLeaveStatus({reason:'manual',force:true});}
function closeLeavePage({fromHistory=false}={}){if(!leavePageOpen)return;leavePageOpen=false;leavePageExpanded.clear();document.querySelector('#leave-page')?.remove();document.body.classList.remove('leave-page-open');const app=document.querySelector('#app');if(app){app.removeAttribute('inert');app.removeAttribute('aria-hidden');}const target=leavePageReturnFocus;leavePageReturnFocus=null;if(target&&target.isConnected){try{target.focus({preventScroll:true});}catch{target.focus();}}else document.querySelector('[data-action="leave-status-all"]')?.focus();if(!fromHistory){if(leavePagePushed){leavePagePushed=false;try{history.back();}catch{}}else if(location.hash==='#leave-status'){try{history.replaceState(null,'',location.pathname+location.search);}catch{}}}}
function syncLeavePageFromLocation(){const wanted=location.hash==='#leave-status';if(wanted&&!leavePageOpen)openLeavePage({fromHistory:true});else if(!wanted&&leavePageOpen)closeLeavePage({fromHistory:true});}
function renderLeaveStatusPanel(date=null){const sample=leaveView.provider==='sample';const all=leaveView.records;const visible=visibleLeaveRecordsForUi(all);const dayRecords=date==null?sortLeaveRecords(visible):sortLeaveRecords(leaveRecordsForDate(visible,date));const loading=leaveView.loading&&!all.length;const failed=leaveView.error&&!all.length;const pending=leaveView.loading?'正在更新假条状态…':'';const updated=leaveUpdatedLabel();let meta=date==null?'全部假条':`${fmt(date)} ${dow(date)}`;if(!loading)meta+=` · 共 ${dayRecords.length} 条`;if(pending)meta+=` · ${pending}`;else if(updated)meta+=` · 数据截至 ${updated}`;if(leaveView.error&&all.length)meta+=' · 更新失败，显示上次同步';if(leaveView.cancelError&&all.length)meta+=' · '+leaveView.cancelError.message;if(sample)meta+=' · 当前为示例假条';let body='';if(failed)body=`<div class="leave-status-error" role="alert"><p>${esc(leaveView.error.message||'读取假条失败')}</p><button class="button" data-action="leave-status-refresh">重新读取</button></div>`;else if(loading)body=`<div class="leave-status-loading" role="status">正在更新假条状态…</div>`;else if(!dayRecords.length)body=`<div class="empty leave-status-empty">${icon('check')}<strong>${date==null?'还没有请假记录':`${date===today()?'今天':'这一天'}没有请假记录`}</strong><span>审批通过后会在课表里标注。${sample?'当前为示例假条。':''}</span></div>`;else body=dayRecords.map(record=>leaveRecordRow(record)).join('');return `<section class="panel panel-pad leave-status-panel" id="leave-status-panel" aria-labelledby="leave-status-title"><div class="section-head"><div class="leave-status-heading"><h2 id="leave-status-title">假条状态</h2>${sample?badge('示例数据','amber'):''}${sampleState?badge('示例课表','purple'):''}</div><div class="section-actions"><button class="button" data-action="leave-status-refresh" ${leaveView.loading?'disabled':''}>${leaveView.loading?'更新中…':'刷新'}</button><button class="button" data-action="leave-status-all">查看全部</button>${sample&&leaveView.records.some(record=>record.demo)?'<button class="button" data-action="leave-status-clear-demo">清除示例</button>':''}</div></div><p class="leave-status-meta" role="status" aria-live="polite">${esc(meta)}</p><div class="leave-status-list">${body}</div></section>`;}
function leaveAllBody(){const loading=leaveView.loading&&!leaveView.records.length;const failed=leaveView.error&&!leaveView.records.length;const records=sortLeaveRecords(visibleLeaveRecordsForUi(leaveView.records));if(loading)return `<div class="leave-status-loading" role="status">正在更新假条状态…</div>`;if(failed)return `<div class="leave-status-error" role="alert"><p>${esc(leaveView.error.message||'读取假条失败')}</p><button class="button" data-action="leave-status-refresh">重新读取</button></div>`;if(!records.length)return `<div class="empty leave-status-empty">${icon('check')}<strong>还没有假条记录</strong><span>审批通过后会在课表里标注；查看全部仅显示本地数据。</span></div>`;return `<p class="leave-status-meta">${esc(leaveStatusSummaryLine(records))}</p><div class="leave-status-list">${records.map(record=>leaveRecordRow(record)).join('')}</div>`;}
function openLeaveStatusAll(){openLeavePage();}
function leaveCancelDetailRow(cancel){if(!cancel)return '';const at=cancel.manual&&cancel.markedAt?` · ${CANCEL_COPY.markedAt} ${manualCancelDateLabel(cancel.markedAt)}`:'';return `<div class="detail-row"><span>销假</span><strong>${esc(cancel.label)}${esc(at)}</strong></div>`;}
function leaveCancelDetailActions(record,cancel){if(!cancel)return '';if(cancel.manual)return `<button class="button danger" data-action="manual-cancel-undo" data-leave-id="${esc(record.id)}">${esc(CANCEL_COPY.manualUndo)}</button>`;if(cancel.canCancel)return `<button class="button danger" data-action="manual-cancel" data-leave-id="${esc(record.id)}">${esc(CANCEL_COPY.manualAction)}</button>`;return '';}
async function setManualCancelMark(record,mark){if(!record||!record.number)throw Error(CANCEL_COPY.manualMissingNumber);const previous=state.manualLeaveCancels;const next=mark?markManualCancel(previous,record.number,new Date().toISOString()):unmarkManualCancel(previous,record.number);state={...state,manualLeaveCancels:next};const traceMark=mark?next.marks.find(item=>item.number===record.number):null;console.debug('[trace] event='+(mark?'mark':'undo')+' source=ui number='+traceNumberHash(record.number).slice(0,8)+' markedAt='+(traceMark?traceMark.markedAt:'-')+' rev='+(state._revision??0));try{await save();}catch(error){state={...state,manualLeaveCancels:previous};throw Error(CANCEL_COPY.manualSaveFailed);}close();updateLeaveStatusPanel();openLeaveStatusDetail(record.id);toast(mark?CANCEL_COPY.manualSaved:CANCEL_COPY.manualRemoved);}
function openLeaveStatusDetail(id){const record=leaveView.records.find(item=>item.id===id);if(!record)return;leaveModalOpen=true;const cancel=record.type==='cancel'?null:leaveCancelFor(record);const note=cancel&&cancel.manual?`<p class="scope">${esc(CANCEL_COPY.manualNotice)}</p>`:'';modal(`<h3>假条详情</h3><div class="detail-hero"><h3>${esc(leaveTypeLabel(record.type))}</h3><div>${esc(leaveRecordTime(record))}</div></div>${leaveRecordDetailRows(record)}${leaveCancelDetailRow(cancel)}${note}<p class="scope">假条信息只保存在本机；${esc(CANCEL_COPY.exportNotice)}</p><div class="actions leave-detail-actions">${leaveCancelDetailActions(record,cancel)}<button class="button primary" data-action="close">关闭</button></div>`);}
function leaveStatusLiveRegion(){let el=document.querySelector('#leave-status-live');if(!el){el=document.createElement('div');el.id='leave-status-live';el.setAttribute('role','status');el.setAttribute('aria-live','polite');el.setAttribute('aria-atomic','true');el.style.cssText='position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';document.body.appendChild(el);}return el;}
function announceLeaveStatus(message){const el=leaveStatusLiveRegion();el.textContent='';setTimeout(()=>{el.textContent=message;},20);}
function updateLeaveStatusPanel(){const host=document.querySelector('#leave-status-panel');if(host){const active=document.activeElement;if(active&&host.contains(active)){leaveFocusPending={action:active.dataset.action||'',leaveId:active.dataset.leaveId||''};leaveScrollPending=window.scrollY;}else if(active&&active!==document.body&&!host.contains(active))leaveFocusPending=null;host.outerHTML=renderLeaveStatusPanel(tab==='changes'?null:selectedDate);if(leaveFocusPending){const panel=document.querySelector('#leave-status-panel');const target=panel?[...panel.querySelectorAll('[data-action]')].find(el=>el.dataset.action===leaveFocusPending.action&&(!leaveFocusPending.leaveId||el.dataset.leaveId===leaveFocusPending.leaveId)):null;if(target&&!target.disabled){target.focus({preventScroll:true});window.scrollTo(0,leaveScrollPending);leaveFocusPending=null;}else if(!target)leaveFocusPending=null;}}syncLeaveMarksToCards();if(leavePageOpen)updateLeavePage();}
function syncLeaveMarksToCards(){if(tab!=='tomorrow')return;const marks=matchLeaveMarks(dayList(selectedDate),leaveView.records);for(const card of document.querySelectorAll('.course-card[data-action="detail"]')){const mark=card.dataset.date===selectedDate?marks.get(card.dataset.key):null;card.classList.toggle('leave-approved',mark?.status==='approved');card.classList.toggle('leave-pending',mark?.status==='pending');const aria=(card.getAttribute('aria-label')||'').replace(/，已批准请假|，请假待审批/g,'');card.setAttribute('aria-label',aria+(mark?(mark.status==='approved'?'，已批准请假':'，请假待审批'):''));const tags=card.querySelector('.course-tags');if(!tags)continue;let badge=tags.querySelector('.leave-badge');if(mark){if(!badge){badge=document.createElement('span');tags.appendChild(badge);}badge.className=`badge leave-badge ${mark.status}`;badge.textContent=mark.status==='approved'?'请假':'待审批';}else badge?.remove();}}
function scheduleLeaveDailyCheck(){clearTimeout(leaveAutoTimer);const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const get=type=>Number(parts.find(part=>part.type===type)?.value||0);const date=`${get('year')}-${String(get('month')).padStart(2,'0')}-${String(get('day')).padStart(2,'0')}`;const minutes=get('hour')*60+get('minute');const targetDate=minutes>=10?addDays(date,1):date;const target=Date.parse(`${targetDate}T00:10:00+08:00`);leaveAutoTimer=setTimeout(()=>{void refreshLeaveStatus({reason:'daily',force:true});scheduleLeaveDailyCheck();},Math.max(1000,target-Date.now()+50));}
function invalidateLeaveStatus(){leaveEpoch++;leaveView={records:[],provider:null,fetchedAt:null,loading:false,error:null,skipped:0,cancelFresh:false,cancelError:null};lastLeaveAttemptAt=0;lastLeaveSuccessDate=null;if(leaveAutoTimer){clearTimeout(leaveAutoTimer);leaveAutoTimer=null;}}
function getLeaveRecordsProvider(mode){return mode==='sample'?moduleLeaveRecordsProvider('sample'):schoolRecordsProvider;}
function activeLeaveProvider(){return sampleState?getLeaveRecordsProvider('sample'):getLeaveRecordsProvider();}
function activeCancelProvider(){return sampleState?null:cancelRecordsProvider;}
function leaveRecordStateKey(records){return JSON.stringify(sortLeaveRecords(records).map(record=>[record.id,record.status,record.startDate,record.startTime,record.endDate,record.endTime]));}
function updateLeaveUnreadFrom(records){if(sampleState)return;const key=leaveRecordStateKey(records);if(state.leaveUnreadBaseline==null){state.leaveUnreadBaseline=key;state.leaveUnread=false;return;}let baseline;try{baseline=JSON.parse(state.leaveUnreadBaseline);}catch{state.leaveUnreadBaseline=key;state.leaveUnread=false;return;}if(!Array.isArray(baseline)||baseline.some(row=>!Array.isArray(row)||row.length!==6)){state.leaveUnreadBaseline=key;state.leaveUnread=false;return;}if(key!==state.leaveUnreadBaseline)state.leaveUnread=true;}
function markLeaveRead(){if(sampleState)return false;const changed=state.leaveUnread===true;state.leaveUnread=false;if(state.leaveUnreadBaseline!=null&&(leaveView.records.length||leaveView.fetchedAt))state.leaveUnreadBaseline=leaveRecordStateKey(leaveView.records);if(changed)void save().catch(()=>{});return changed;}
function updateLeaveUnreadBadge(){const button=document.querySelector('.nav [data-tab="changes"]');if(!button)return;const dot=button.querySelector('.leave-unread-dot');if(state.leaveUnread){if(!dot){const marker=document.createElement('span');marker.className='count leave-unread-dot';marker.setAttribute('role','img');marker.setAttribute('aria-label','有未读假条状态');button.appendChild(marker);}button.setAttribute('aria-label','变更记录，有未读假条状态');}else{dot?.remove();button.removeAttribute('aria-label');}}
async function refreshLeaveStatus({reason='manual',force=false}={}){if(leaveRefreshPromise)return leaveRefreshPromise;if(!force&&Date.now()-lastLeaveAttemptAt<30000)return;if(reason==='daily'&&lastLeaveSuccessDate===today())return;lastLeaveAttemptAt=Date.now();const epoch=++leaveEpoch;const provider=activeLeaveProvider();leaveView={...leaveView,loading:true,error:null};updateLeaveStatusPanel();const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);leaveRefreshPromise=(async()=>{try{const result=await provider.list({state:displayState(),signal:controller.signal,now:Date.now()});if(epoch!==leaveEpoch)return;const records=Array.isArray(result?.records)?result.records:[];const mergedRecords=[...records,...(leaveView.records||[]).filter(item=>item.type==='cancel'&&!records.some(record=>record.id===item.id))];leaveView={records:mergedRecords,provider:result?.source||provider.id,fetchedAt:result?.fetchedAt||new Date().toISOString(),loading:false,error:null,skipped:Number(result?.skipped)||0,cancelFresh:false,cancelError:null};lastLeaveSuccessDate=today();console.debug('[trace] event=read source=read fetchedAt='+leaveView.fetchedAt+' rev='+(state._revision??0)+' marks='+((state.manualLeaveCancels?.marks||[]).length));if(provider.id==='school'&&!sampleState){updateLeaveUnreadFrom(mergedRecords);state.leaveStatus=normalizeLeaveStatusCache({schemaVersion:1,provider:'school',semesterId:state.snapshot.semester.id,fetchedAt:leaveView.fetchedAt,records:mergedRecords},state.snapshot.semester.id);state.lastSuccess=latestIso(state.lastSuccess,leaveView.fetchedAt)||state.lastSuccess;
     state.leaveLastSuccess=latestIso(state.leaveLastSuccess,leaveView.fetchedAt)||state.leaveLastSuccess;
     await save().catch(()=>{});updateLeaveUnreadBadge();}}catch(error){if(epoch!==leaveEpoch)return;const timedOut=error?.name==='AbortError';leaveView={...leaveView,loading:false,cancelFresh:false,error:{code:timedOut?'LEAVE_TIMEOUT':error?.code||'LEAVE_UNKNOWN',message:timedOut?'读取超时，请稍后重试':error?.code==='LEAVE_PROVIDER_UNAVAILABLE'?'学校假条数据尚未接入':error?.message||'读取假条失败'}};}finally{clearTimeout(timeout);if(epoch===leaveEpoch){leaveView.loading=false;updateLeaveStatusPanel();updateFooterStamp();announceLeaveStatus(leaveView.error?'假条状态更新失败':'假条状态已更新');scheduleLeaveDailyCheck();}leaveRefreshPromise=null;if(shouldRefreshCancelAfterLeave(epoch,leaveEpoch,sampleState))void refreshCancelStatus({reason:'after-leave'});}})();return leaveRefreshPromise;}
async function refreshCancelStatus(){
 if(sampleState)return;
 if(cancelRefreshPromise)return cancelRefreshPromise;
 const epoch=leaveEpoch;
 const provider=activeCancelProvider();
 if(!provider)return;
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),15000);
 cancelRefreshPromise=(async()=>{
  try{
   const result=await provider.list({state:displayState(),signal:controller.signal,now:Date.now()});
   if(epoch!==leaveEpoch)return;
   const fresh=Array.isArray(result?.records)?result.records:[];
   if(!fresh.length&&Number(result?.skipped)>0){
    leaveView={...leaveView,cancelFresh:false,cancelError:{code:'PARSE',message:CANCEL_COPY.pendingSync}};
    return;
   }
   const fetchedAt=result?.fetchedAt||new Date().toISOString();
   const leaveRecords=(leaveView.records||[]).filter(record=>record.type!=='cancel');
   const merged=[...leaveRecords,...fresh];
   leaveView={...leaveView,records:merged,fetchedAt,cancelFresh:true,cancelError:null};
   if(!sampleState){
    updateLeaveUnreadFrom(merged);
    state.leaveStatus=normalizeLeaveStatusCache({schemaVersion:1,provider:'school',semesterId:state.snapshot.semester.id,fetchedAt,records:merged},state.snapshot.semester.id);
    state.lastSuccess=latestIso(state.lastSuccess,fetchedAt)||state.lastSuccess;
    state.leaveLastSuccess=latestIso(state.leaveLastSuccess,fetchedAt)||state.leaveLastSuccess;
    try{await save();}catch(saveError){leaveView={...leaveView,cancelError:{code:'LEAVE_SAVE_FAILED',message:CANCEL_COPY.saveFailed}};}
    updateLeaveUnreadBadge();
   }
  }catch(error){
   if(epoch!==leaveEpoch)return;
   const timedOut=error?.name==='AbortError';
   leaveView={...leaveView,cancelFresh:false,cancelError:{code:timedOut?'LEAVE_TIMEOUT':error?.code||'LEAVE_UNKNOWN',message:timedOut?'读取超时，请稍后重试':error?.message||'读取假条失败'}};
  }finally{
   clearTimeout(timeout);
   if(epoch===leaveEpoch){updateLeaveStatusPanel();updateFooterStamp();if(leavePageOpen)updateLeavePage();}
   cancelRefreshPromise=null;
   if(epoch!==leaveEpoch&&!sampleState)void refreshCancelStatus();
  }
 })();
 return cancelRefreshPromise;
}
async function refreshReminders(){if(!globalThis.Android||refreshingReminders)return;refreshingReminders=true;try{const previous=JSON.stringify(reminderInfo?.notificationStatus);reminderInfo=await call('classReminderStatus');const host=document.querySelector('#class-reminder-cards');if(host)host.innerHTML=renderClassReminderCards();else if(tab==='settings'&&previous!==JSON.stringify(reminderInfo?.notificationStatus)&&!document.querySelector('.modal')&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))render();}catch{}finally{refreshingReminders=false;}}
function classReminderSettings(){if(!globalThis.Android)throw Error('上课常驻通知目前仅手机端支持');const s=reminderSettings(state.classReminders);modal(`<h3>上课提醒设置</h3><p class="scope">显示课程、上课时间、地点和老师。到设定时间自动结束；提前关闭请在首页操作并再次确认。</p><form id="class-reminder-form"><label class="switch"><input type="checkbox" name="enabled" ${s.enabled?'checked':''}>启用上课提醒</label><label>提前多久提醒（分钟）<input type="number" name="leadMinutes" min="0" max="180" step="1" required value="${s.leadMinutes}"></label><label>开课后保留多久（分钟）<input type="number" name="afterStartMinutes" min="0" max="120" step="1" required value="${s.afterStartMinutes}"></label><p class="subtle">例如 08:30 上课：默认 08:00 提醒，08:35 自动结束。系统通知设为常驻，系统划动不记为已关闭；首页关闭只影响当前这次课程。</p><div class="actions"><button class="button primary" type="submit">保存上课提醒</button><button class="button" type="button" data-action="close">取消</button></div></form>`);}
function reminderSystemInfo(){
 const n=reminderInfo?.notificationStatus;if(!n)return '<p class="disabled-note">正在读取系统通知设置…</p>';
 const importance=n.importance>=4?'重要':n.importance>=3?'普通（建议改为重要）':n.importance>0?'静默（可能被收进更多通知）':n.importance===0?'已关闭':'由系统决定';
 const lock=n.lockVisibility===1?'已请求公开显示':n.lockVisibility===0?'系统隐藏部分内容':n.lockVisibility===-1?'系统禁止锁屏显示':'由系统设置决定';
 const focus=n.focus||{};
 return `<div class="stat-line"><span>上课提醒分类</span><strong>${importance}</strong></div><div class="stat-line"><span>锁屏内容</span><strong>${lock}</strong></div>${focus.xiaomi?`<div class="stat-line"><span>小米焦点卡片</span><strong>${!focus.checked?'检测中':focus.allowed?'系统已允许':'本机暂未允许'}</strong></div><p class="disabled-note">${!focus.checked?'正在检测本机是否允许焦点卡片。':focus.allowed?'本机已允许焦点通知，可通过下方锁屏测试查看效果。':'当前使用普通通知。小米焦点大卡片需要系统开放权限，未开放时不能强制变成焦点卡片。'}</p>`:''}`;
}
function classReminderPanel(){if(!globalThis.Android)return '';return `<section class="panel"><h2>上课提醒</h2><p>上课提醒显示时间、地点、课程和老师，开课前显示倒计时，开课后显示课程状态。首页关闭前需要二次确认。</p><div class="actions"><button class="button primary" data-action="class-reminder-settings">设置上课提醒</button><button class="button" data-action="class-reminder-preview">预览通知卡片</button><button class="button" data-action="class-reminder-lock-preview">锁屏测试（5秒后）</button></div><div class="stat-line"><span>提醒时间</span><strong>${reminderDescription()}</strong></div>${reminderSystemInfo()}${reminderInfo&&!reminderInfo.notificationsAllowed?'<p class="disabled-note">系统通知或“上课提醒”通知分类未开启，请在系统设置中允许。</p>':''}<div class="actions"><button class="button primary" data-action="class-reminder-system-settings">设置上课提醒分类</button><button class="button" data-action="reminder-system-settings">通知与锁屏显示设置</button></div><p class="disabled-note">被收进“更多通知”时，请把“上课提醒”分类设为重要或提醒，并在系统设置中允许锁屏、显示内容和横幅。普通通知可下拉展开详情，默认是否展开由系统决定。锁屏测试约5秒后发出示例通知，请点击后锁屏；示例1分钟后自动结束，不改变个人课程。</p></section>`;}


function decorateSnapshot(snapshot,profile=null){const p=profile||snapshot.studentProfile||state?.snapshot?.studentProfile||null;snapshot.studentProfile=p;Object.assign(snapshot,withStudyPolicy(snapshot,p,holidayCalendar,state?.snapshot));return snapshot;}
function currentGrade(){return resolveGrade(state.snapshot.studentProfile,today());}
function notificationPanel(){return `<section class="panel"><h2>通知与后台</h2><p>课表变更通知与后台运行设置；上课前提醒请在上方“上课提醒”中设置。</p><label class="switch"><input type="checkbox" id="notifications" ${state.notificationEnabled?'checked':''}>启用课表变更系统通知</label><div class="actions"><button class="button" data-action="battery-settings">后台运行设置</button><button class="button" data-action="request-exact-alarm">允许准时提醒</button></div><p class="disabled-note">自动更新只在你打开或回到应用时核对；不再注册每日定时核对。后台权限入口保留在“权限检查”中。</p></section>`;}
selectedWeek=Math.min(state.snapshot.semester.weeks,Math.max(1,weekOf(state.snapshot,today())));
let saveQueue=Promise.resolve();
if(customCourseMigrationNeeded){try{await save();}catch{console.warn('Unable to save restored custom courses');}}
function save(){if(sampleState)throw Error('请先退出示例模式再修改个人数据');saveQueue=saveQueue.catch(()=>{}).then(async()=>{const data=clone(state);if(native){const saved=await call('saveState',{state:data,expectedRevision:state._revision??0});if(saved?.revision)state._revision=saved.revision;}else localStorage.setItem('tomorrow-state',JSON.stringify(data));});return saveQueue;}
if(state.snapshot.studyPolicy?.enabled===true && state.snapshot.studyPolicy.userEnabled==null && state.snapshot.studyPolicy.userDisabled!==true){state.snapshot.studyPolicy=withStudyPolicy(state.snapshot,state.snapshot.studentProfile,holidayCalendar,state.snapshot).studyPolicy;try{await save();}catch{console.warn('Unable to migrate saved evening study setting');}}
function toast(message,options){return showNotice(message,options);}
globalThis.onNativeProgress=(id,label)=>{if(!busy||!androidCallbacks.has(id))return;progressLabel=String(label);renderReadStatus();};
function beginRead(){busy=true;readFeedback=null;progressLabel='正在检查学校会话…';progressStarted=Date.now();clearInterval(progressTimer);progressTimer=setInterval(renderReadStatus,1000);render();}
function endRead(){busy=false;clearInterval(progressTimer);progressTimer=null;}
function shortReadLabel(){
 if(/检查.*会话/.test(progressLabel))return '检查登录状态…';
 if(/恢复.*登录/.test(progressLabel))return '恢复学校登录…';
 if(/完成登录/.test(progressLabel))return '等待学校登录…';
 if(/连接教务/.test(progressLabel))return '连接教务系统…';
 if(/年级/.test(progressLabel))return '读取年级信息…';
 if(/教学周|课程/.test(progressLabel))return '读取学校课表…';
 return progressLabel.replace(/^正在/,'').slice(0,14);
}
function renderReadStatus(){const el=document.querySelector('#sync-status');if(el)el.innerHTML=status();}
function feedbackNotice(){if(readFeedback)toast(readFeedback.text,{detail:readFeedback.detail,tone:readFeedback.kind==='pending'?'warning':readFeedback.error?'error':readFeedback.kind==='cancelled'?'neutral':'success',duration:readFeedback.error?6500:4200});}

function studyStatus(){return state.snapshot.studyPolicy?.userEnabled===true?(currentGrade()===1?'已开启':'需确认大一年级'):'未开启';}
function quickTools(){if(sampleState)return '';return `<div class="quick-tools primary-tools" aria-label="常用操作"><button class="button primary" data-action="custom-course">添加课程</button><button class="button primary" data-action="holiday-settings">请假与调休</button></div>`;}
function autoUpdateEnabled(){return state.autoUpdate!==false;}
function autoUpdatePanel(){return `<section class="panel" id="auto-update-panel"><h2>自动更新</h2><p>打开应用时自动核对学校课表，保持课表最新。</p><label class="switch"><input type="checkbox" id="auto-update" ${autoUpdateEnabled()?'checked':''}>自动更新</label><div class="stat-line"><span>最近核对</span><strong>${stamp(state.courseLastSuccess)}</strong></div><div class="actions"><button class="button" data-action="sync">${icon('refresh')}立即核对</button></div><p class="disabled-note">关闭后，打开应用或回到前台不会自动核对，仍可随时手动点「读取学校课表」或「立即核对」。</p></section>`;}
async function autoUpdateNow(){if(!autoUpdateEnabled()||sampleState||!native||busy||state.snapshot.source.kind!=='school')return;if(Date.now()-autoUpdateLastAt<30000)return;autoUpdateLastAt=Date.now();await sync();}
function leaveNoticeHtml(){return `<div class="leave-notice-backdrop" id="leave-notice-root"><section class="leave-notice" role="dialog" aria-modal="true" aria-labelledby="leave-notice-title" tabindex="-1"><h3 id="leave-notice-title">请假须知</h3><p>学校不会把假条发给任课老师或考勤同学。</p><p>班主任批准后，请导出假条，发给班纪律委员 / 学习委员 / 负责考勤的同学。</p><button type="button" class="button" id="leave-notice-button" data-action="leave-notice-confirm" disabled aria-live="polite">5 秒后可关闭 (5)</button></section></div>`;}
function stopLeaveNoticeTimer(){if(leaveNoticeTimer){clearInterval(leaveNoticeTimer);leaveNoticeTimer=null;}}
function closeLeaveNotice(){stopLeaveNoticeTimer();leaveNoticeOpen=false;document.querySelector('#leave-notice-root')?.remove();if(!leavePageOpen)document.querySelector('#app')?.removeAttribute('inert');}
function cancelLeaveNotice(){const target=leaveNoticeReturnFocus;closeLeaveNotice();leaveNoticeReturnFocus=null;if(target&&target.isConnected)try{target.focus({preventScroll:true});}catch{}}
function showLeaveNotice(key){if(leaveNoticeOpen)return;leaveNoticeOpen=true;leaveNoticeKey=key;leaveNoticeReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;leaveNoticeSeconds=5;document.querySelector('#app')?.setAttribute('inert','');document.body.insertAdjacentHTML('beforeend',leaveNoticeHtml());document.querySelector('#leave-notice-root')?.focus({preventScroll:true});const button=()=>document.querySelector('#leave-notice-button');const tick=()=>{if(!leaveNoticeOpen)return;if(leaveNoticeSeconds>0){const el=button();if(el){el.textContent=`${leaveNoticeSeconds} 秒后可关闭 (${leaveNoticeSeconds})`;el.disabled=true;}leaveNoticeSeconds-=1;return;}stopLeaveNoticeTimer();const el=button();if(el){el.disabled=false;el.classList.add('primary');el.textContent='知道了，去请假';el.focus({preventScroll:true});}};tick();leaveNoticeTimer=setInterval(tick,1000);}
function confirmLeaveNotice(){if(!leaveNoticeOpen||leaveNoticeSeconds>0)return;const key=leaveNoticeKey;const target=leaveNoticeReturnFocus;closeLeaveNotice();leaveNoticeReturnFocus=null;void openLeaveFromCard(key,{skipNotice:true});if(target&&target.isConnected)try{target.focus({preventScroll:true});}catch{}}
function __dsjOnBack(){if(leaveNoticeOpen){cancelLeaveNotice();return true;}if(leavePageOpen){closeLeavePage();return true;}if(document.querySelector('#modal-root')?.children.length){close();return true;}if(tab!=='tomorrow'){tab='tomorrow';selectedDate=today();render();return true;}return false;}
function holidaySummary(kind){const range=state.holidaySettings?.[kind];return range?`${fmt(range.startDate)}—${fmt(range.endDate)}`:'未设置';}
function holidaySettingsForm(){
 const settings=state.holidaySettings||emptyHolidaySettings();
 const services=LEAVE_SERVICES.map(service=>`<button type="button" class="button primary" data-action="leave-open" data-leave-key="${esc(service.key)}" aria-label="打开${esc(service.label)}服务（实验功能）">${esc(service.label)}</button>`).join('');
 modal(`<h3>请假与调休</h3><p class="scope">请假服务提供学校入口；调休与休假设置只影响本机课表。设置只保存在本机，学校同步后仍然有效。</p>
 <section class="holiday-form" aria-labelledby="holiday-service-title"><h3 id="holiday-service-title">请假服务 ${badge('实验','amber')}</h3><p class="holiday-service-warning">实验功能：只提供学校学工系统的跳转入口；登录、填写和提交都在学校页面完成，本应用不保存账号密码，也不代填或提交。</p><div class="leave-service-actions" role="group" aria-label="请假服务入口">${services}</div></section>
 <section class="holiday-form" aria-labelledby="holiday-remap-title"><h3 id="holiday-remap-title">调休安排</h3><p>原日期的普通课程搬至上课日；上课日原有课程全部替换。晚自习独立显示，可在单日课程详情中取消。</p><button class="button primary" data-action="remap">添加调休</button>${state.localMaps.map(m=>`<div class="holiday-record"><span>${fmt(m.date)} 按 ${fmt(m.fromDate)}上课</span><button class="button" data-action="delete-remap" data-id="${esc(m.id)}">撤销</button></div>`).join('')}</section>
 <section class="holiday-form" aria-labelledby="holiday-vacation-title"><h3 id="holiday-vacation-title">休假设置</h3><p>寒暑假和单日休假会暂停当天的普通课程；晚自习默认仍显示，可单日取消。</p><div class="holiday-sections">${[['winter','寒假'],['summer','暑假']].map(([kind,name])=>`<form class="holiday-form" data-kind="${kind}" id="${kind}-holiday-form"><h3>${name} · ${holidaySummary(kind)}</h3><div class="form-row"><label>开始日期<input type="date" name="startDate" value="${settings[kind]?.startDate||''}" required></label><label>结束日期<input type="date" name="endDate" value="${settings[kind]?.endDate||''}" required></label></div><div class="actions"><button class="button primary" type="submit">保存${name}</button>${settings[kind]?`<button class="button" type="button" data-action="delete-holiday-range" data-kind="${kind}">清除${name}</button>`:''}</div></form>`).join('')}
 <form id="holiday-day-form" class="holiday-form"><h3>普通休假 · 指定某一天</h3><label>休假日期<input type="date" name="date" value="${tab==='week'?weekSelectedDate:selectedDate}" required></label><label class="switch"><input type="checkbox" name="skipStudy">当日晚自习不上</label><div class="actions"><button type="submit" class="button primary">保存单日休假</button></div></form>
 ${(settings.days||[]).map(day=>`<div class="holiday-record"><span>${fmt(day.date)} · ${day.skipStudy?'普通课程与晚自习均不上':'普通课程休假，晚自习保留'}</span><button class="button" data-action="delete-holiday-day" data-date="${day.date}">撤销</button></div>`).join('')}</div></section>`);
}
function holidayPanel(){return `<section class="panel holiday-panel"><h2>请假与调休</h2><p>请假服务、寒暑假、单日休假（可选晚自习不上）与整日调休。设置只保存在本机，学校同步后仍然有效。</p><button class="button" data-action="holiday-settings">打开请假与调休</button><div class="stat-line"><span>寒假</span><strong>${holidaySummary('winter')}</strong></div><div class="stat-line"><span>暑假</span><strong>${holidaySummary('summer')}</strong></div><div class="stat-line"><span>单日休假 / 调休</span><strong>${state.holidaySettings?.days?.length||0} / ${state.localMaps.length}</strong></div></section>`;}
function themeOptions(){const swatches={system:'linear-gradient(90deg,#fff 50%,#000 50%)',blue:'#83d1f4',dark:'#000',light:'#fff',purple:'#8878dc'};return '<div class="theme-options">'+THEMES.map(([value,label])=>'<button class="theme-choice" data-action="set-theme" data-theme="'+value+'" aria-pressed="'+(themePreference()===value)+'"><span class="theme-swatch" style="background:'+swatches[value]+'"></span>'+label+'</button>').join('')+'</div>';}
function applySelection(){const state=displayState();selectedWeek=Math.min(state.snapshot.semester.weeks,Math.max(1,selectedWeek));if(weekOf(state.snapshot,weekSelectedDate)!==selectedWeek)weekSelectedDate=addDays(state.snapshot.semester.startDate,(selectedWeek-1)*7+weekday(weekSelectedDate)-1);}
function changeWeek(value){const state=displayState();selectedWeek=Math.min(state.snapshot.semester.weeks,Math.max(1,value));applySelection();render();}
function studySettings(){const key='local-evening-study',setting=state.courseSettings[key],grade=currentGrade();modal(`<h3>晚自习设置</h3><p class="scope">这是独立的本机可选安排，默认关闭。开启后仅在大一周日至周四 19:00–20:30 生成；遇到学校晚课自动让位，调休或假日默认仍显示，可在课程详情里单日取消，也可在“休假设置”中为指定日期关闭晚自习。</p><form id="study-settings-form"><label>当前年级<select name="grade"><option value="">未确认</option>${[1,2,3,4,5,6,7,8].map(g=>`<option value="${g}" ${grade===g?'selected':''}>大${'一二三四五六七八'[g-1]}</option>`).join('')}</select></label><label class="switch"><input type="checkbox" name="enabled" ${state.snapshot.studyPolicy?.userEnabled===true?'checked':''}>启用本机晚自习（默认关闭，与学校课程分开）</label><label>固定教室<input name="room" value="${esc(setting?.patch.room==='—'?'':setting?.patch.room||'')}" placeholder="收到首次通知后填写，如B204" maxlength="80"></label><p class="subtle">晚自习不设置任课老师。单独某一天仍可在课程详情中修改地点。</p><div class="actions"><button type="submit" class="button primary">保存晚自习设置</button><button type="button" class="button" data-action="close">取消</button></div></form>`);}
function courseManager(){const rows=[...new Map(state.snapshot.rules.map(r=>[courseSettingKey(r),r])).values()];modal(`<h3>课程统一设置</h3><p class="scope">同名课程的教室或教师可统一设置，覆盖本学期所有日期。单日修改优先。</p><div class="settings-list"><button class="button primary" data-action="study-settings">晚自习固定教室</button>${rows.map(r=>`<button class="button" data-action="course-settings" data-name="${esc(r.name)}">${esc(r.name)}${state.courseSettings[courseSettingKey(r)]?' · 已设置':''}</button>`).join('')}</div>`);}
function courseSettingsForm(name){const r=state.snapshot.rules.find(r=>r.name===name);if(!r)return;const setting=state.courseSettings[courseSettingKey(r)];modal(`<h3>统一设置：${esc(name)}</h3><p class="scope">应用于本学期所有同名课程（包括调休）。勾选要统一的属性，未勾选的属性采用学校数据。同步后设置仍保留，学校更改相同属性时提示冲突。</p><form id="course-settings-form" data-name="${esc(name)}"><label class="switch"><input type="checkbox" name="set-room" ${!setting||Object.hasOwn(setting.patch,'room')?'checked':''}>统一教室</label><label>教室<input name="room" value="${esc(setting?.patch.room??r.room)}" maxlength="80"></label><label class="switch"><input type="checkbox" name="set-teacher" ${setting&&Object.hasOwn(setting.patch,'teacher')?'checked':''}>统一教师</label><label>教师<input name="teacher" value="${esc(setting?.patch.teacher??r.teacher)}" maxlength="80" placeholder="无任课老师可留空"></label><div class="actions"><button type="submit" class="button primary">保存统一设置</button>${setting?`<button type="button" class="button" data-action="clear-course-settings" data-name="${esc(name)}">恢复学校属性</button>`:''}<button type="button" class="button" data-action="close">取消</button></div></form>`);}
function badge(s,kind=''){return `<span class="badge ${kind}">${esc(s)}</span>`;}
function sourceLabel(kind){return kind==='school'?'教务系统':kind==='local'?'本人修改':'交接样例';}
function unreadFor(key){return displayState().events.find(e=>e.key===key&&!e.read);}
function dayList(d){const state=displayState();return timetableDay(state.snapshot,d,state.overrides,state.localMaps,state.courseSettings,state.customCourses,state.holidaySettings);}
function valueText(r){return r?`${r.startTime}–${r.endTime} · ${r.room==='—'?'地点待确认':r.room}${r.cancelled?' · 停课':''}`:'无此课程';}
function eventDiff(e){if(!e.before)return `新增：${esc(valueText(e.after))}`;if(!e.after)return `<del>${esc(valueText(e.before))}</del> <span class="${e.read?'':'unread'}">停课</span>`;const f=e.fields.includes('room')?'room':e.fields.includes('teacher')?'teacher':e.fields.includes('name')?'name':null;return `<del>${esc(f?e.before[f]:valueText(e.before))}</del><span class="${e.read?'':'unread'}">${esc(f?e.after[f]:valueText(e.after))}</span>`;}
function ongoingTag(r){return `<span class="badge purple course-ongoing" ${courseOngoing(r)?'':'hidden'}>课程进行中</span>`;}
function refreshCourseStatus(){for(const card of document.querySelectorAll('.course-card[data-course-start]')){const tag=card.querySelector('.course-ongoing');if(tag)tag.hidden=!courseOngoing({date:card.dataset.date,startTime:card.dataset.courseStart,endTime:card.dataset.courseEnd,cancelled:card.dataset.courseCancelled==='true'});}}
function courseCard(r,compact=false,showTime=false){if(r.vacant){const label=r.vacancyReason==='moved'?'已调至 '+fmt(r.movedTo):'原课程已替换';return `<button class="course-card vacant ${compact?'compact':''}" data-action="detail" data-key="${esc(r.key)}" data-date="${r.date}" aria-label="${esc(r.name)}，${esc(label)}，此时段不上课"><h3>${esc(r.name)}</h3><div class="vacancy-note">${esc(label)}</div><div class="course-tags">${compact?'':badge('此时段不上课')}</div></button>`;}const e=unreadFor(r.key);return `<button class="course-card ${compact?'compact':''} ${r.cancelled?'cancelled':''} ${r.conflict?'conflicted':''}${r.leaveMark?' leave-'+r.leaveMark.status:''}" style="${courseColor(r)}" data-course-start="${esc(r.startTime)}" data-course-end="${esc(r.endTime)}" data-course-cancelled="${!!r.cancelled}" data-action="detail" data-key="${esc(r.key)}" data-date="${r.date}" aria-label="${esc(r.name)}，${esc(valueText(r))}${r.leaveMark?`，${r.leaveMark.status==='approved'?'已批准请假':'请假待审批'}`:''}"><h3>${esc(r.name)}</h3>${r.customCourse||showTime?`<div class="custom-time"><span>${esc(r.startTime)}</span><span>–${esc(r.endTime)}</span></div>`:''}<div class="course-meta"><span class="meta-item">${icon('pin')}${esc(r.room==='—'?(r.customCourse?'地点未填写':'地点待确认'):r.room)}</span>${compact||r.localActivity?'':`<span class="meta-item">${icon('person')}${esc(r.teacher)}</span>`}</div>${e&&!compact?`<div class="change-inline">${eventDiff(e)}</div>`:''}<div class="course-tags">${ongoingTag(r)}${r.customCourse?badge('自定义','purple'):r.localActivity?badge('晚自习','purple'):r.remapId?badge('补课','purple'):''}${r.courseSettingKey?badge('统一设置','purple'):r.source==='local'&&!r.localActivity&&!r.customCourse?badge('本人修改','purple'):''}${r.cancelled?badge('停课'):''}${r.conflict?badge('! 来源冲突','amber'):''}${r.overlap?badge('时段重叠','amber'):''}${r.leaveMark?`<span class="badge leave-badge ${r.leaveMark.status}">${r.leaveMark.status==='approved'?'请假':'待审批'}</span>`:''}${e?badge('未读','red'):''}</div></button>`;}
function status(){
 const pill=(kind,text,detail=text)=>`<span class="sync-status" data-state="${kind}" role="status" aria-live="polite" title="${esc(detail)}" aria-label="${esc(detail)}">${esc(text)}</span>`;
 if(sampleState)return pill('sample','示例模式');
 if(busy){const elapsed=Math.floor((Date.now()-progressStarted)/1000);return pill('checking',shortReadLabel(),`${progressLabel} · 已用 ${elapsed} 秒${elapsed>=8?' · 学校响应较慢，可继续查看已有课表':''}`);}
 if(readFeedback?.error)return pill('error','核对失败',readFeedback.detail||'未能确认最新课表，已保留原课表');
 if(readFeedback?.kind==='pending')return pill('pending',readFeedback.label,readFeedback.detail);
 if(state.error)return pill('error','核对失败',state.error);
 if(readFeedback?.kind==='cancelled')return pill('idle','已取消读取');
 if(state.snapshot.source.kind==='sample')return pill('sample','样例课表');
 if(!state.courseLastSuccess)return pill('idle','尚未核对');
 return pill('success',state.events.some(e=>!e.read)?'发现变化':'已确认无变化');
}
function render(){const state=displayState();applySelection();const count=state.events.filter(e=>!e.read).length;const names={tomorrow:'今日课表',week:'完整课表',changes:'变更记录',settings:'设置与数据'};document.querySelector('#app').innerHTML=`<div class="layout"><aside class="sidebar"><div class="brand"><div class="brand-icon"><img src="./assets/app-icon.png" alt="" width="44" height="44"></div><div>江水课表<small>JIANGSHUI</small></div></div><nav class="nav" aria-label="主导航">${Object.keys(names).map(n=>`<button data-action="nav" data-tab="${n}" class="${tab===n?'active':''}" aria-label="${esc(names[n])}${n==='changes'&&state.leaveUnread&&!sampleState?'，有未读假条状态':''}" ${tab===n?'aria-current="page"':''}>${icon(n)}<span>${names[n]}</span>${n==='changes'&&count?`<span class="count">${count}</span>`:''}${n==='changes'&&state.leaveUnread&&!sampleState?'<span class="count leave-unread-dot" role="img" aria-label="有未读假条状态"></span>':''}</button>`).join('')}</nav><div class="side-note"><strong>把课表的变化，提前看到。</strong>完整课表 · 本地修改 · 变化提醒<br>数据保留在这台设备。</div></aside><main class="main"><header class="topbar"><div><p class="eyebrow">${esc(state.snapshot.semester.name)}</p><div class="app-title"><img class="mobile-app-icon" src="./assets/app-icon.png" alt="江水课表水宝宝图标" width="36" height="36"><h1>${tab==='tomorrow'?'江水课表':names[tab]}</h1></div><p class="title-sub">${tab==='tomorrow'?'今天的课程与变化，清楚掌握。':tab==='week'?'一周的安排，清清楚楚。':tab==='changes'?'发生过的变化，都留在这里。':'你的课表，由你掌握。'}</p></div><div class="actions"><div id="sync-status">${status()}</div>${sampleState?'':`<button class="button" data-action="${busy&&globalThis.Android?'cancel-read':'sync'}" ${busy&&!globalThis.Android?'disabled':''} aria-label="${busy&&globalThis.Android?'取消读取':'检查更新'}">${icon(busy&&globalThis.Android?'close':'refresh')}<span>${busy?'取消读取':'检查更新'}</span></button>`}</div></header>${renderReminderIntro()}${sampleState?`<section class="sample-mode-banner" role="status"><div><strong>示例模式</strong><p>正在查看内置示例课表，个人课表与修改已保留。</p></div><button class="button primary" data-action="sample-exit">退出示例模式</button></section>`:''}${['tomorrow','week'].includes(tab)?quickTools():''}${tab==='tomorrow'?renderDay():tab==='week'?renderWeek():tab==='changes'?renderChanges():renderSettings()}<footer class="footer"><span id="footer-stamp">${footerContent()}</span><span>安排不一致时，以教务系统和班级通知为准。</span></footer></main></div>`;for(const b of document.querySelectorAll('[data-action=school],[data-action=school-mobile],[data-action=capture],[data-action=sample-mode],[data-action=logout],[data-action=import]'))b.disabled=busy;renderReadStatus();positionNotices();}
function renderDay(){const state=displayState();const title=selectedDate===today()?'今日课程':selectedDate===addDays(today(),1)?'明日课程':selectedDate===addDays(today(),-1)?'昨日课程':'当日课程';const list=dayList(selectedDate),leaveMarks=matchLeaveMarks(list,leaveView.records),active=list.filter(r=>!r.cancelled),n=state.events.filter(e=>e.date===selectedDate&&!e.read).length,conflicts=list.filter(r=>r.conflict||r.overlap).length;for(const r of list)r.leaveMark=leaveMarks.get(r.key)||null;return `${renderClassReminders()}<div class="day-swipe" data-swipe="day">${state.showDayOverview?`<section class="hero" aria-label="今日概览"><div>${badge(`${fmt(selectedDate)} · ${dow(selectedDate)} · 第${weekOf(state.snapshot,selectedDate)}周`,'purple')}${holidayForDate(state.holidaySettings,selectedDate)?badge('休假'):''}<h2>${conflicts?'有安排需要你确认':n?`有 ${n} 处新变化`:(selectedDate===today()?'今天':selectedDate===addDays(today(),1)?'明天':'这一天')+(active.length?'，按这份课表出发':'，没有已排课程')}</h2><p>${state.error?'暂时无法核对最新安排，以下保留上次课表。':state.snapshot.source.kind==='sample'?'正在查看交接样例；实际安排请核对学校最新通知。':state.courseLastSuccess?'已读取课表，留意下方来源和变更标记。':'尚未验证最新课表，请先连接教务系统。'}</p></div><div class="hero-count"><strong>${active.length}</strong><span>节课程安排</span></div></section>`:''}<div class="content-columns"><section class="panel panel-pad"><div class="section-head day-course-head"><div class="day-course-heading"><h2>${state.showDayOverview?'当天课程':title}</h2>${state.showDayOverview?'':`<small class="day-weekday">${dow(selectedDate)}</small>`}</div><div class="day-selector"><button class="icon-button" data-action="day-prev" aria-label="前一天">${icon('left')}</button><input type="date" id="day-date" aria-label="选择日期" value="${selectedDate}"><button class="icon-button" data-action="day-next" aria-label="后一天">${icon('right')}</button></div></div><div class="course-list">${list.length?list.map(r=>`<div class="course-row"><div class="time-label">${esc(r.startTime)}<small>${esc(r.endTime)}</small><small>${r.customCourse?'自定义时段':r.periods.join('、')+' 节'}</small></div>${courseCard(r)}</div>`).join(''):`<div class="empty">${icon('moon')}<strong>${selectedDate===today()?"今天":selectedDate===addDays(today(),1)?"明天":"这一天"}没有已排课程</strong>未排时间的课程与临时安排，仍请留意学校通知。</div>`}</div></section><aside class="aside-stack"><section class="panel panel-pad"><div class="section-head"><h2>课表小结</h2></div><div class="stat-line"><span>开始上课</span><strong>${active[0]?.startTime||'—'}</strong></div><div class="stat-line"><span>当天结束</span><strong>${active.length?active.reduce((v,r)=>r.endTime>v?r.endTime:v,''): '—'}</strong></div><div class="stat-line"><span>手动修改</span><strong>${state.overrides.filter(o=>o.date===selectedDate).length} 处</strong></div><div class="stat-line"><span>待确认安排</span><strong>${conflicts} 处</strong></div><div class="tiny-rule"></div><button class="button" data-action="show-week">查看这一周 ${icon('arrow')}</button></section><section class="panel panel-pad"><h2>最近一次核对</h2><div class="notice-box"><strong>${state.snapshot.source.kind==='sample'?'当前为样例模式':stamp(state.courseLastSuccess)}</strong><br>${sampleState?'示例课表仅供查看。退出后回到个人课表。':state.error?esc(state.error):'每条手动修改都会标记来源。发生冲突时，学校版本优先展示，本人修改仍保留。'}</div><button class="text-link subtle" data-action="nav" data-tab="settings">管理数据与连接 →</button></section></aside></div></div>${renderLocalUndo(selectedDate)}`;}
function renderWeek(){
 const state=displayState();
 const start=addDays(state.snapshot.semester.startDate,(selectedWeek-1)*7),dates=Array.from({length:7},(_,i)=>addDays(start,i));
 const slots=WEEK_SLOTS;
 return `<section class="panel"><div class="week-toolbar"><div class="week-controls"><button class="icon-button" data-action="week-prev" aria-label="上一周" ${selectedWeek===1?'disabled':''}>${icon('left')}</button><select id="week-select" aria-label="选择周次">${Array.from({length:state.snapshot.semester.weeks},(_,i)=>`<option value="${i+1}" ${selectedWeek===i+1?'selected':''}>第 ${i+1} 周</option>`).join('')}</select><button class="icon-button" data-action="week-next" aria-label="下一周" ${selectedWeek===state.snapshot.semester.weeks?'disabled':''}>${icon('right')}</button><button class="button" data-action="this-week">本周</button></div><div class="actions export-actions"><button class="button primary" data-action="export-week">导出这一周</button><button class="button" data-action="export-semester">导出整个学期</button></div><input class="search" id="search" placeholder="模糊搜索课程 / 教室 / 教师" aria-label="搜索课程或教室" value="${esc(filter)}"></div><p class="swipe-hint">左右滑动日期栏切换整周 · 点击日期高亮整列</p><div class="week-scroll"><div class="week-grid"><div class="week-date-strip" data-swipe="week"><div class="week-heading">${Number(start.slice(5,7))} 月</div>${dates.map(d=>`<button class="week-heading ${d===today()?'is-today':''} ${d===weekSelectedDate?'is-selected':''}" data-action="select-week-date" data-date="${d}" aria-pressed="${d===weekSelectedDate}" aria-label="${fmt(d)} ${dow(d)}">周${'一二三四五六日'[weekday(d)-1]}<strong>${Number(d.slice(8))}</strong><span class="date-month">${Number(d.slice(5,7))}月</span></button>`).join('')}</div>${slots.map(([a,b,s,e],index)=>`<div class="week-time" style="grid-column:1;grid-row:${index+2}">${a}–${b} 节<small>${s}</small><small>${e}</small></div>`).join('')}${dates.map((d,day)=>weekDayBlocks(dayList(d).filter(r=>matchesCourse(r,filter))).map(block=>`<div class="week-cell ${block.courses.some(r=>!r.cancelled)?'':'is-empty'} ${d===weekSelectedDate?'is-selected':''} ${block.end===slots.length-1?'last-slot':''}" style="grid-column:${day+2};grid-row:${block.start+2} / span ${block.end-block.start+1}" data-date="${d}" data-slot="${slots[block.start][0]}" data-slot-end="${slots[block.end][1]}">${block.courses.map(r=>courseCard(r,true,block.end>block.start)).join('')}</div>`).join('')).join('')}</div></div><div class="legend"><span><i></i>课程颜色仅用于区分</span><span>灰色课程表示调休后的空位，此时段不上课</span><span>${badge('本人修改','purple')}仅对指定日期生效</span><span>${badge('未读','red')}看过后恢复普通样式</span></div></section><section class="panel panel-pad" style="margin-top:20px"><div class="section-head"><h2>未排时间的课程</h2><span class="subtle">安排以学校通知为准</span></div><div class="unscheduled">${(state.snapshot.unscheduled||[]).map(r=>badge(r.name+' · '+r.weeks)).join('')}</div></section>${renderLocalUndo(dates)}`;
}
function renderChanges(){if(sampleState)return `${renderLeaveStatusPanel()}<section class="panel panel-pad"><h2>示例课表预览</h2><p class="subtle">可通过今日课表和完整课表查看内置安排。个人变化记录会在退出示例模式后显示。</p></section>`;return `${renderLeaveStatusPanel()}<div class="section-head"><span class="subtle">${state.events.length} 条记录 · ${state.events.filter(e=>!e.read).length} 条未读</span><button class="button" data-action="read-all">全部知道了</button></div><div class="event-list">${state.events.length?state.events.map(e=>`<article class="event"><div class="event-top">${badge(e.type,e.read?'':'red')}<strong>${esc(e.name)}</strong><span class="subtle">${fmt(e.date)} ${dow(e.date)}</span>${!e.read?badge('未读','red'):''}</div><div class="change-inline">${eventDiff(e)}</div><div class="event-bottom"><span class="subtle">${sourceLabel(e.source)} · ${stamp(e.detectedAt)}<br>${noticeLevel(e)==='later'?'远期变化已记录，临近时按提醒设置处理。':''}</span><div class="actions"><button class="button" data-action="show-day" data-date="${e.date}">看当天</button>${!e.read?`<button class="button primary" data-action="read" data-id="${esc(e.id)}">知道了</button>`:''}</div></div></article>`).join(''):`<section class="panel empty">${icon('check')}<strong>这里会留下课表变化</strong>首次载入建立基线；下次读取有差异时，显示原值与新值。<br>尚无记录不代表已核对实时教务数据。</section>`}</div>`;}
function leaveServicePanel(){
 const browserPreview=!globalThis.Android;
 return `<section class="panel leave-service-panel" id="leave-service-panel" aria-labelledby="leave-service-title" aria-describedby="leave-service-warning leave-service-status">
  <div class="leave-service-heading"><h2 id="leave-service-title" aria-label="请假服务（实验功能）">请假服务 ${badge('实验','amber')}</h2></div>
  <p id="leave-service-warning" class="leave-service-warning">实验功能：只提供学校学工系统的跳转入口；登录、填写和提交都在学校页面完成，本应用不保存账号密码，也不代填或提交。该入口可能随学校页面改版而失效。</p>
  <div class="leave-service-actions" role="group" aria-label="请假服务入口">${LEAVE_SERVICES.map(service=>`<button type="button" class="button primary" data-action="leave-open" data-leave-key="${esc(service.key)}" aria-label="打开${esc(service.label)}服务（实验功能）">${esc(service.label)}</button>`).join('')}</div>
  <div class="leave-service-status-row"><div><strong>假条状态</strong><span class="subtle">本地查看已提交的请假与审批记录</span></div><button type="button" class="button" data-action="leave-status-all">查看假条状态</button></div>
  <label class="switch leave-notice-setting"><input type="checkbox" id="leave-notice-enabled" ${state.leaveNoticeEnabled!==false?'checked':''}>显示请假须知</label>
  <p class="disabled-note leave-notice-setting-note">开启后，每次请假前显示 5 秒请假须知；关闭后点「请假」直接进入学工系统。</p>
  <p class="leave-service-status" id="leave-service-status" role="status" aria-live="polite"></p>
  <p class="leave-service-error" id="leave-service-error" role="alert" hidden></p>
  <p class="leave-service-fallback" id="leave-service-fallback" hidden>${globalThis.Android?'如无法打开，请稍后重试或直接在系统浏览器访问 xgxt.juwp.edu.cn。':'如无法打开，可在浏览器访问 <a href="'+XGXT_ORIGIN+'/" target="_blank" rel="noopener noreferrer">xgxt.juwp.edu.cn</a>。'}</p>
  ${browserPreview?'<p class="disabled-note">浏览器/桌面预览会在新窗口打开学校页面，需要在学校页面重新登录；安装版会复用本机学校登录状态。</p>':''}
 </section>`;
}
function permissionRowsHtml(){
 const loading=!permissionInfo&&!permissionError;
 const disabled=loading||permissionError||permissionFixing?' disabled':'';
 const state=(ok,on,off)=>({ok:!!ok,text:permissionError?'暂时无法读取权限状态':loading?'读取中…':(ok?on:off)});
 const notifications=state(permissionInfo?.notifications?.allowed,'已开启','未开启');
 const exactInfo=permissionInfo?.exactAlarm;
 const exact=exactInfo?.required===false?{ok:true,text:'系统版本无需设置'}:state(exactInfo?.allowed,'已允许','未允许');
 const battery=state(permissionInfo?.battery?.exempt,'已忽略优化','未忽略');
 const opened=Number(permissionInfo?.autostart?.openedAt||0)>0;
 const autostart={ok:false,text:permissionError?'暂时无法读取权限状态':loading?'读取中…':(opened?'已前往设置，请确认已允许':'需在系统设置确认')};
 const row=(name,value,kind,label,doneLabel='',extra='')=>{
  const done=!!doneLabel;
  return `<div class="permission-row"><div class="permission-meta"><strong>${name}</strong><span class="permission-state ${value.ok?'is-ok':'is-warn'}">${esc(value.text)}</span></div><button type="button" class="button" data-action="permission-fix" data-kind="${kind}"${disabled}${done?' disabled':''}${extra}>${done?doneLabel:label}</button></div>`;
 };
 const notificationsDone=permissionInfo?.notifications?.allowed?'已开启':'';
 const exactDone=exactInfo?.required===false?'':(exactInfo?.allowed?'已允许':'');
 const batteryDone=permissionInfo?.battery?.exempt?'已忽略':'';
 return [row('通知',notifications,'notifications','去开启通知',notificationsDone),row('精确闹钟',exact,'exact-alarm','去允许精确闹钟',exactDone,exactInfo?.required===false?' hidden':''),row('电池优化',battery,'battery','去关闭电池优化',batteryDone),row('自启动',autostart,'autostart','去设置自启动')].join('');
}
function permissionPanel(){
 if(!globalThis.Android)return '';
 return `<section class="panel permission-panel" id="permission-panel" aria-labelledby="permission-title"><h2 id="permission-title">权限检查</h2><p>这些权限用于准时提醒和后台核对；自启动只能在系统设置中手动允许。可随时跳过，不影响看课表。</p><div class="permission-rows" id="permission-rows" aria-live="polite">${permissionRowsHtml()}</div><div class="actions"><button class="button" data-action="permission-refresh"${permissionRefreshing?' disabled':''}>重新检查</button></div>${permissionError?'<p class="disabled-note">暂时无法读取权限状态，请点「重新检查」。</p>':''}<p class="disabled-note">自启动无法由应用直接开启；小米/Redmi 可在安全中心 → 应用管理 → 自启动中允许。</p></section>`;
}
async function refreshPermissionStatus(){
 if(!globalThis.Android||permissionRefreshing)return;
 permissionRefreshing=true;
 try{
  const info=await call('permissionStatus');
  permissionInfo=info&&info.notifications&&info.exactAlarm&&info.battery?info:null;
  permissionError=!permissionInfo;
 }catch(e){permissionInfo=null;permissionError=true;}
 finally{permissionRefreshing=false;}
 if(tab==='settings'&&!document.querySelector('.modal'))render();
}
async function fixPermission(kind){
 if(permissionFixing)return;
 permissionFixing=true;
 const buttons=[...document.querySelectorAll('[data-action="permission-fix"]')];
 buttons.forEach(button=>{button.disabled=true;});
 try{
  if(kind==='notifications'){
   if(permissionInfo?.notifications?.runtime){
    const result=await call('requestNotifications');
    if(!result?.ok){toast('通知权限未开启，请在系统设置中允许',{tone:'error'});await call('notificationSettings');}
   }else await call('notificationSettings');
  }else if(kind==='exact-alarm')await call('requestExactAlarm');
  else if(kind==='battery')await call('batterySettings');
  else if(kind==='autostart')await call('autostartSettings');
  else return;
 }catch(e){toast(e?.message?String(e.message):'无法打开系统设置',{tone:'error'});return;}
 finally{permissionFixing=false;buttons.forEach(button=>{if(button.isConnected)button.disabled=false;});}
 await refreshPermissionStatus();
}
async function maybeShowPermissionOnboarding(){
 if(permissionOnboardingTried||!globalThis.Android||sampleState||document.querySelector('.modal'))return;
 let seen=false;try{seen=localStorage.getItem(PERMISSION_ONBOARDING_KEY)==='1';}catch{}
 if(seen){permissionOnboardingTried=true;return;}
 permissionOnboardingTried=true;
 if(!permissionInfo)await refreshPermissionStatus();
 if(!permissionInfo){permissionOnboardingTried=false;return;}
 if(!permissionInfo.notifications||!permissionInfo.exactAlarm||!permissionInfo.battery){permissionOnboardingTried=false;return;}
 const notifications=permissionInfo.notifications||{},exact=permissionInfo.exactAlarm||{},battery=permissionInfo.battery||{};
 const needs=!notifications.allowed||(exact.required&&!exact.allowed)||!battery.exempt;
 if(!needs){try{localStorage.setItem(PERMISSION_ONBOARDING_KEY,'1');}catch{}return;}
 if(document.querySelector('.modal')){permissionOnboardingTried=false;return;}
 try{localStorage.setItem(PERMISSION_ONBOARDING_KEY,'1');}catch{}
 modal(`<h3>权限检查（可跳过）</h3><p>为了准时提醒和后台核对课表，建议开启以下权限。自启动只能在系统设置中手动允许。</p><div class="permission-rows" aria-live="polite">${permissionRowsHtml()}</div><div class="actions"><button class="button primary" data-action="close">稍后再说</button></div>`);
}
function normalizeSettingsExpanded(value){const source=value&&typeof value==='object'?value:{};return Object.fromEntries(Object.keys(SETTINGS_GROUP_DEFAULT).map(key=>[key,typeof source[key]==='boolean'?source[key]:SETTINGS_GROUP_DEFAULT[key]]));}
function settingsGroupKey(title,className){return SETTINGS_GROUP_KEYS[title]||className||'about';}
function settingsGroup(title, content, className = ''){const key=settingsGroupKey(title,className);const expanded=state.settingsExpanded?.[key]===true;return `<section class="settings-group ${className}" data-settings-group="${key}"><h3 class="settings-group-title"><button type="button" class="settings-group-toggle" data-action="settings-toggle" data-group="${key}" aria-expanded="${expanded}" aria-controls="settings-group-${key}"><span class="settings-group-toggle-text"><span class="settings-group-label">${title}</span>${expanded?'':`<span class="settings-group-summary">${SETTINGS_GROUP_SUMMARIES[title]||''}</span>`}</span><span class="settings-group-arrow" aria-hidden="true"></span></button></h3><div class="settings-group-body" id="settings-group-${key}" ${expanded?'':'hidden'}>${content}</div></section>`;}
function settingsGroupControls(){return `<div class="settings-groups-controls"><button type="button" class="button" data-action="settings-expand-all">全部展开</button><button type="button" class="button" data-action="settings-collapse-all">全部收起</button></div>`;}
function calendarPermissionText(permission){return permission==='granted'?'日历权限：已授权':permission==='denied'?'日历权限：已拒绝':'日历权限：未授权';}
function calendarStatusText(){if(!globalThis.Android)return '仅 Android 支持写入系统日历';const info=calendarInfo;if(!info)return '正在读取日历状态…';const last=info.lastSyncAt?`上次写入：${stamp(info.lastSyncAt)} · ${Number(info.lastEventCount)||0} 条`:'上次写入：尚未写入 · 0 条';const deleted=Number(info.lastDeleted)||0;const failed=Number(info.lastFailed)||0;const counts=info.lastSyncAt?` · 清理旧事件 ${deleted} 条${failed?` · 失败 ${failed} 条`:''}`:'';return last+counts;}
function calendarPanel(){
  const android=!!globalThis.Android;
  const sample=sampleState;
  const info=calendarInfo;
  const permission=info?.permission||'prompt';
  const options=normalizeCalendarOptions(state.calendarOptions);
  const unavailable=android&&info&&info.available===false;
  const permissionDenied=android&&permission==='denied';
  const disabled=calendarBusy||!android||unavailable||sample||permissionDenied;
  const option=(key,label)=>`<label class="switch"><input type="checkbox" data-calendar-option="${key}" ${options[key]?'checked':''} ${disabled?'disabled':''}>${label}</label>`;
  const error=calendarError?`<p class="calendar-error" role="alert">${esc(calendarError.message||'写入系统日历失败')}</p>`:'<p class="calendar-error" role="alert" hidden></p>';
  const status=sample?'示例模式下不可用':android?(unavailable?'本机没有可用的系统日历应用':calendarStatusText()):calendarStatusText();
  return `<section class="panel calendar-panel" id="calendar-panel"><h2>写入系统日历</h2><p>把最终生效课表写入本机系统日历，方便在系统日历中查看。只使用「江水课表」专用本地日历，不写入其他日历；不添加提醒。</p><div class="stat-line"><span>日历权限</span><strong>${esc(android?calendarPermissionText(permission):'仅 Android 可用')}</strong></div><p class="calendar-status" role="status">${esc(status)}</p><div class="calendar-options" role="group" aria-label="写入内容">${option('school','学校课程')}${option('custom','自定义课程与调休')}${option('study','晚自习')}</div><div class="actions calendar-actions"><button class="button primary" data-action="calendar-sync" ${disabled?'disabled':''}>${calendarBusy?'正在写入…':'写入系统日历'}</button><button class="button" data-action="calendar-remove" ${disabled?'disabled':''}>从系统日历移除课表</button>${android&&permission==='denied'?`<button class="button" data-action="calendar-settings" ${calendarBusy||unavailable?'disabled':''}>去系统设置</button>`:''}</div>${error}<p class="disabled-note">重装或清除应用数据后，系统日历里可能留下旧事件；本应用不会自动清理这些孤儿事件，可在系统日历中手动删除。当前仅支持 Android，桌面端不写入。</p></section>`;
}
function updateCalendarPanel(){const host=document.querySelector('#calendar-panel');if(host)host.outerHTML=calendarPanel();}
function calendarErrorFrom(error,fallback){return {code:error?.code||'CALENDAR_WRITE_FAILED',message:error?.message||fallback||'写入系统日历失败，请稍后重试'};}
async function refreshCalendarStatus(){
  if(!globalThis.Android){calendarInfo={available:false,writable:false,permission:'prompt',calendarId:null,lastSyncAt:null,lastEventCount:0,lastSemesterId:null};calendarError=null;updateCalendarPanel();return;}
  try{
    const result=await call('calendarStatus');
    if(!result||typeof result!=='object'||result.ok===false)throw Object.assign(Error(result?.message||'读取日历状态失败'),{code:result?.code});
    calendarInfo=result;
    calendarError=null;
  }catch(error){calendarError=calendarErrorFrom(error,'读取日历状态失败');}
  updateCalendarPanel();
}
async function syncCalendar(){
  if(!globalThis.Android){toast('仅 Android 支持写入系统日历');return;}
  if(sampleState){toast('示例模式下不可用');return;}
  if(calendarBusy)return;
  const built=buildCalendarEvents(state,state.calendarOptions);
  if(built.error){calendarError={...built.error};updateCalendarPanel();return;}
  calendarBusy=true;calendarError=null;updateCalendarPanel();
  try{
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('写入超时，请稍后重试'),{code:'CALENDAR_TIMEOUT'})),30000);});
    const request=call('calendarSync',{semesterId:state.snapshot.semester.id,events:built.events});
    let result;
    try{result=await Promise.race([request,timeout]);}finally{clearTimeout(timer);}
    if(result?.ok===false)throw Object.assign(Error(result.message||'写入系统日历失败'),{code:result.code,deleted:result.deleted,failed:result.failed});
    calendarInfo={...calendarInfo,available:true,writable:true,permission:'granted',calendarId:result.calendarId,lastSyncAt:result.lastSyncAt,lastEventCount:result.lastEventCount,lastDeleted:Number(result.deleted)||0,lastFailed:Number(result.failed)||0};
    toast(result.written?`已写入 ${result.written} 条课程到系统日历`:'已更新系统日历，旧事件已清理');
  }catch(error){calendarError=calendarErrorFrom(error,'写入系统日历失败，请稍后重试');if(error?.code==='CALENDAR_PERMISSION_DENIED')calendarInfo={...(calendarInfo||{}),permission:'denied'};if(Number(error?.failed)>0)calendarInfo={...(calendarInfo||{}),lastFailed:Number(error.failed)};}
  finally{calendarBusy=false;updateCalendarPanel();}
}
async function removeCalendar(){
  if(!globalThis.Android){toast('仅 Android 支持系统日历');return;}
  if(sampleState){toast('示例模式下不可用');return;}
  if(calendarBusy)return;
  calendarBusy=true;calendarError=null;updateCalendarPanel();
  try{
    const result=await call('calendarRemove');
    if(result?.ok===false)throw Object.assign(Error(result.message||'移除失败'),{code:result.code,removed:result.removed,failed:result.failed});
    calendarInfo={...calendarInfo,calendarId:result.calendarId??calendarInfo?.calendarId??null,lastSyncAt:null,lastEventCount:0,lastSemesterId:null,lastDeleted:Number(result.removed)||0,lastFailed:Number(result.failed)||0};
    toast(result.removed?`已从系统日历移除 ${result.removed} 条课程`:'系统日历中没有本机写入的课程');
  }catch(error){calendarError=calendarErrorFrom(error,'从系统日历移除失败，请稍后重试');if(error?.code==='CALENDAR_PERMISSION_DENIED')calendarInfo={...(calendarInfo||{}),permission:'denied'};if(Number(error?.failed)>0)calendarInfo={...(calendarInfo||{}),lastFailed:Number(error.failed)};}
  finally{calendarBusy=false;updateCalendarPanel();}
}
async function toggleSettingsGroup(key,expanded){
  const next=normalizeSettingsExpanded({...state.settingsExpanded,[key]:expanded});
  const previous=state.settingsExpanded;state.settingsExpanded=next;
  try{await save();}catch(error){state.settingsExpanded=previous;toast(error.message||'未能保存设置展开状态');render();return;}
  render();
  document.querySelector(`[data-action="settings-toggle"][data-group="${key}"]`)?.focus();
}
async function setAllSettingsGroups(expanded){
  const previous=state.settingsExpanded;
  state.settingsExpanded=normalizeSettingsExpanded(Object.fromEntries(Object.keys(SETTINGS_GROUP_DEFAULT).map(key=>[key,expanded])));
  try{await save();}catch(error){state.settingsExpanded=previous;toast(error.message||'未能保存设置展开状态');return;}
  render();
  document.querySelector(`[data-action="${expanded?'settings-expand-all':'settings-collapse-all'}"]`)?.focus();
}
function themePanel(){return `<section class="panel"><h2>外观主题</h2><p>江水蓝取自水宝宝的蓝色与图标的浅蓝背景。跟随系统会自动切换黑白。</p>${themeOptions()}</section>`;}
function homeDisplayPanel(){return `<section class="panel"><h2>首页显示</h2><label class="switch"><input type="checkbox" id="show-day-overview" ${state.showDayOverview?'checked':''} aria-describedby="day-overview-help">显示今日概览卡片</label><p id="day-overview-help">在今日课表顶部显示日期、教学周和课程数量，默认关闭。开启后显示“今天，按这份课表出发”这张卡片。</p></section>`;}
function schoolPanel(){return `<section class="panel"><h2>教务系统</h2><p>在学校自己的登录页面输入凭据。登录与课表读取都在本机完成；学校页面不会获得本应用的数据接口。</p><div class="stat-line"><span>当前来源</span><strong>${esc(state.snapshot.source.label||sourceLabel(state.snapshot.source.kind))}</strong></div><div class="stat-line"><span>最近成功读取</span><strong>${stamp(state.courseLastSuccess)}</strong></div><div class="actions"><button class="button primary" data-action="school">${icon('person')}登录学校门户</button><button class="button" data-action="school-mobile">移动教务入口</button><button class="button" data-action="capture">读取学校课表</button></div><p class="disabled-note">${native?'优先复用本机登录状态并静默读取；需要你登录时才显示学校页面。读取失败会保留上次课表。':'当前是浏览器预览。系统登录、凭据保护和系统通知需使用安装版。'}</p></section>`;}
function studyPanel(){return `<section class="panel"><h2>晚自习与课程设置</h2><div class="actions"><button class="button primary" data-action="study-settings">设置晚自习</button><button class="button" data-action="course-manager">课程统一设置</button></div><p>晚自习是独立的可选本机安排，默认关闭。开启后仅对大一生效；若与学校晚课冲突，只显示学校课程。</p><div class="stat-line"><span>晚自习状态</span><strong>${studyStatus()}</strong></div><div class="stat-line"><span>当前年级</span><strong>${currentGrade()?`大${'一二三四五六七八'[currentGrade()-1]}`:'未确认'}</strong></div><label>年级<select id="study-grade"><option value="" ${!state.snapshot.studentProfile?'selected':''}>未确认</option>${[1,2,3,4,5,6,7,8].map(g=>`<option value="${g}" ${currentGrade()===g?'selected':''}>大${'一二三四五六七八'[g-1]}</option>`).join('')}</select></label><p class="disabled-note">晚自习安排和课程统一属性保存在本机。</p></section>`;}
function timetableLocalPanel(){return `<section class="panel"><h2>课表与本地修改</h2><p>导入或导出本机课表快照。导出文件不含学校凭据；分享前请确认其中的课程信息。</p><div class="actions"><button class="button" data-action="import">${icon('file')}导入课表 JSON</button><button class="button" data-action="export">导出课表 JSON</button></div><div class="tiny-rule"></div><div class="stat-line"><span>已保存修改 / 调休</span><strong>${state.overrides.length} / ${state.localMaps.length}</strong></div><div class="actions"><button class="button danger" data-action="restore">还原来源课表</button></div></section>`;}
function privacyPanel(){return `<section class="panel"><h2>用户协议与隐私</h2><p>学校 TGC 与教务 Cookie 仅保存在本机；Android 版使用 Keystore 加密保存恢复副本，不上传至开发者或第三方云端。</p><button class="button" data-action="agreement">查看用户协议与 Cookie 授权</button><div class="tiny-rule"></div><button class="button danger" data-action="logout">注销并删除本机数据</button><p class="disabled-note">可通过“注销并删除本机数据”撤回授权。</p></section>`;}
function sourcePanel(){return `<section class="panel"><h2>来源与冲突</h2><p>学校更新与本地修改冲突时，突出学校版本，保留本地版本与待处理标记。单点修改只影响指定日期。</p></section>`;}
function updateCheckedAt(value){
 const time=Number(value);if(!Number.isFinite(time)||time<=0)return '尚未检查';
 try{return new Date(time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}catch{return '尚未检查';}
}
function appUpdatePanel(){
 if(!globalThis.Android)return '';
 const info=appUpdateInfo||{enabled:true,currentVersion:'',lastAutoCheckAt:0};
 const current=info.currentVersion?releaseTag(info.currentVersion):'未知';
 return `<section class="panel" id="app-update-panel"><h2>应用版本</h2><p>检查 GitHub Release 中的新版本；下载后在本机校验文件摘要与签名证书，再交给系统安装器。不上传设备信息。</p><div class="stat-line"><span>当前版本</span><strong>${esc(current)}</strong></div><div class="stat-line"><span>最近自动检查</span><strong>${esc(updateCheckedAt(info.lastAutoCheckAt))}</strong></div><label class="switch"><input type="checkbox" id="update-enabled" ${info.enabled?'checked':''}>自动检查更新</label><p class="disabled-note">每天最多检查一次；自动检查只提示，不会擅自安装。测试版会明确标注预发布。</p><div class="actions"><button class="button primary" data-action="update-check" ${appUpdateBusy?'disabled':''}>${appUpdateBusy?'正在检查…':'检查更新'}</button></div></section>`;
}
function showUpdateDialog(result){
 appUpdateLatest=result;
 const version=releaseTag(result.latestVersion);
 modal(`<h3>${esc(releaseTitle(result.latestVersion))}</h3>${result.prerelease?'<p class="update-prerelease" role="status">这是预发布版本，可能不稳定。</p>':''}<p class="scope">当前版本 ${esc(releaseTag(result.currentVersion)||'未知')} · 最新版本 ${esc(version)}</p><div class="update-notes-box"><strong>更新说明</strong><pre id="update-notes"></pre></div><div class="actions"><button class="button primary" data-action="update-download">下载并安装</button><button class="button" data-action="update-skip" data-version="${esc(result.latestVersion)}">跳过此版本</button><button class="button" data-action="close">稍后提醒</button></div>`);
 const notes=document.querySelector('#update-notes');if(notes)notes.textContent=result.notes||'该版本没有提供更新说明。';
}
function showUpdateDownloadDialog(){
 const version=appUpdateLatest?.latestVersion||'';
 modal(`<h3>正在下载 ${esc(releaseTag(version)||'更新')}</h3><p class="scope">下载完成后会在本机校验 SHA-256 与签名证书；校验不通过不会安装，也不会保留文件。</p><div class="update-progress"><progress id="update-progress" max="100" value="0"></progress><p id="update-progress-text" role="status" aria-live="polite">准备下载…</p></div><div class="actions"><button class="button" data-action="update-cancel">取消下载</button></div>`);
}
globalThis.onNativeUpdateProgress=payload=>{
 if(!payload||typeof payload!=='object')return;
 const bar=document.querySelector('#update-progress'),text=document.querySelector('#update-progress-text');
 const percent=Math.max(0,Math.min(100,Number(payload.percent)||0));
 if(bar)bar.value=percent;
 if(text){text.classList.remove('update-error');text.textContent=payload.phase==='verify'?'正在校验安装包…':payload.phase==='download'?`正在下载 · ${percent}%`:'准备下载…';}
};
async function checkAppUpdate(manual=false){
 if(!globalThis.Android||appUpdateBusy)return;
 appUpdateBusy=true;if(manual)render();
 try{
  const result=normalizeRelease(await call('updateCheck',{manual}));
  if(!result.ok){if(manual)toast(updateErrorText(result.errorCode,result.message),{tone:'error'});return;}
  if(result.updateAvailable){
   if(!manual&&(result.skipped||appUpdatePrompted===result.latestVersion))return;
   appUpdatePrompted=result.latestVersion;showUpdateDialog(result);
  }else if(manual){toast('当前已是最新版本',{detail:result.currentVersion?'v'+result.currentVersion:'',tone:'neutral'});}
 }catch(error){if(manual)toast(updateErrorText('network',error?.message),{tone:'error'});}
 finally{appUpdateBusy=false;if(manual)render();}
}
async function downloadAppUpdate(){
 if(appUpdateBusy)return;
 appUpdateBusy=true;const run=++appUpdateRun;showUpdateDownloadDialog();
 try{
  const result=await call('updateDownload')||{};
  if(run!==appUpdateRun)return;
  if(result.ok===false)throw Object.assign(Error(result.message||''),{code:result.errorCode});
  close();toast(result.message||'安装包已校验，正在打开系统安装器');
 }catch(error){
  if(run!==appUpdateRun)return;
  close();toast(updateErrorText(error?.code,error?.message),{tone:'error'});
 }finally{if(run===appUpdateRun){appUpdateBusy=false;render();}}
}
async function skipAppUpdate(version){
 try{await call('updateSkip',{version});close();toast('已跳过 '+(releaseTag(version)||version)+'，有新版本时会再提示');}
 catch(error){toast(updateErrorText('version',error?.message),{tone:'error'});}
}
async function cancelAppUpdate(){
 appUpdateRun++;appUpdateBusy=false;
 const text=document.querySelector('#update-progress-text');if(text)text.textContent='正在取消…';
 try{await call('updateCancel');}catch{}
 close();render();toast('已取消下载',{tone:'neutral'});
}
async function loadAppUpdateInfo(){
 if(!globalThis.Android){appUpdateInfo=null;return;}
 try{appUpdateInfo=normalizeUpdateInfo(await call('updateInfo'));}catch{appUpdateInfo=normalizeUpdateInfo({enabled:false});}
 if(tab==='settings')render();
}
function renderSettings(){
 if(sampleState)return `<section class="panel panel-pad"><h2>正在查看示例课表</h2><p class="subtle">示例仅供浏览。个人课程、调休、晚自习设置和登录状态继续保存在本机。</p></section>${sampleModeEntry()}`;
 return `${quickTools()}<div class="settings-groups">${settingsGroupControls()}
 ${settingsGroup('自动更新',autoUpdatePanel(),'auto')}
 ${settingsGroup('课表与显示',themePanel()+homeDisplayPanel()+timetableExportPanel())}
 ${settingsGroup('请假与调休',leaveServicePanel()+holidayPanel())}
 ${settingsGroup('课程与提醒',studyPanel()+customCoursesPanel()+classReminderPanel()+notificationPanel()+permissionPanel())}
 ${settingsGroup('数据与同步',schoolPanel()+calendarPanel()+timetableLocalPanel()+sourcePanel())}
 ${settingsGroup('关于与隐私',appUpdatePanel()+feedbackPanel(feedbackInfo)+privacyPanel(),'about')}
 </div>${sampleModeEntry()}`;
}
function customCourseForm(id=null){
 const course=id?(state.customCourses||[]).find(c=>c.id===id):null;if(id&&!course)throw Error('该自定义课程已删除');
 const semester=state.snapshot.semester,startWeek=Math.min(semester.weeks,Math.max(1,weekOf(state.snapshot,selectedDate)));
 const draft=course||{mode:'weekly',name:'',room:'',teacher:'',startTime:'08:30',endTime:'09:55',weekdays:[weekday(selectedDate)],startWeek,endWeek:semester.weeks,weekPattern:'every',date:selectedDate};
 modal(`<h3>${course?'编辑自定义课程':'添加自定义课程'}</h3><form id="custom-course-form" data-id="${esc(id||'')}"><fieldset class="custom-mode-choice"><legend>排课方式</legend><label><input type="radio" name="custom-mode" value="weekly" ${draft.mode==='weekly'?'checked':''}>规律上课</label><label><input type="radio" name="custom-mode" value="once" ${draft.mode==='once'?'checked':''}>独立加课</label></fieldset><label>课程名称<input name="name" value="${esc(draft.name)}" maxlength="80" required placeholder="例如：社团课程"></label><fieldset data-custom-fields="weekly"><legend>每周上课安排</legend><div class="custom-weekdays">${[1,2,3,4,5,6,7].map(d=>`<label><input type="checkbox" name="weekdays" value="${d}" ${draft.weekdays?.includes(d)?'checked':''}>周${'一二三四五六日'[d-1]}</label>`).join('')}</div><div class="form-row"><label>开始周<input type="number" name="startWeek" min="1" max="${semester.weeks}" value="${draft.startWeek||startWeek}" required></label><label>结束周<input type="number" name="endWeek" min="1" max="${semester.weeks}" value="${draft.endWeek||semester.weeks}" required></label></div><label>重复规律<select name="weekPattern"><option value="every" ${draft.weekPattern==='every'?'selected':''}>每周</option><option value="odd" ${draft.weekPattern==='odd'?'selected':''}>单周</option><option value="even" ${draft.weekPattern==='even'?'selected':''}>双周</option></select></label><p class="subtle">按所选学期周次重复，跟随课表中的调休与停课安排。</p></fieldset><fieldset data-custom-fields="once"><legend>本次上课安排</legend><label>上课日期<input type="date" name="date" value="${esc(draft.date||selectedDate)}" required></label><p class="subtle">只在指定日期增加一节课，不随整日调休移动。</p></fieldset><div class="form-row"><label>开始时间<input type="time" name="startTime" value="${draft.startTime}" required></label><label>结束时间<input type="time" name="endTime" value="${draft.endTime}" required></label></div><div class="form-row"><label>教室（可选）<input name="room" value="${esc(draft.room==='—'?'':draft.room)}" maxlength="80" placeholder="例如：B204"></label><label>教师（可选）<input name="teacher" value="${esc(draft.teacher==='—'?'':draft.teacher)}" maxlength="80"></label></div><p class="subtle">保存在本机，学校同步不会覆盖。与其他课程时间重叠时会保留双方并提示。</p><div class="actions"><button class="button primary" type="submit">${course?'保存自定义课程':'添加课程'}</button><button type="button" class="button" data-action="close">取消</button></div></form>`);
 updateCustomCourseMode();
}
function updateCustomCourseMode(){const form=document.querySelector('#custom-course-form');if(!form)return;const mode=form.querySelector('[name=custom-mode]:checked').value;for(const fieldset of form.querySelectorAll('[data-custom-fields]')){const active=fieldset.dataset.customFields===mode;fieldset.hidden=!active;fieldset.disabled=!active;}}
function timetableExportPanel(){return `<section class="panel timetable-export-panel"><h2>导出课表</h2><p>单周导出高清横向图片；整学期可导出三种视图：每周一页 PDF、整学期一张总览图、纯文本规则 TXT。都包含当前调休、自定义课程和晚自习。</p><p class="subtle">当前图片周次：第 ${selectedWeek} 周。在完整课表页面切换周次后，可导出对应一周。导出包含整周课程，不受搜索筛选影响。</p><div class="actions"><button class="button primary" data-action="export-week">导出这一周</button><button class="button primary" data-action="export-semester">导出整个学期</button></div></section>`;}
function semesterExportChoice(){modal(`<h3>导出整个学期</h3><p class="scope">三种方式都按当前最终生效课表导出。每周一页 PDF 课程多时会自动续页；整学期总览始终保持一张图片。</p><div class="settings-list" role="group" aria-label="选择整学期导出方式"><button class="button primary" data-action="export-semester-pages" data-autofocus>每周一页（PDF）</button><button class="button primary" data-action="export-semester-overview">整学期总览（单张图片）</button><button class="button primary" data-action="export-semester-rules">纯文本规则（TXT）</button></div><p class="subtle">A 每周一页：和现在一样，每个教学周一张横向页面，未排时间课程附页。<br>B 整学期总览：把整个学期合并成一张周课表，每门课标注上课周次。<br>C 纯文本规则：教务系统风格的时间规则，UTF-8 文本，不含账号或登录凭据。</p><button class="button" data-action="close">取消</button>`);}
function exportKindTitle(kind){return kind==='week'||kind==='semester'?'导出横向课表':kind==='semester-overview'?'导出整学期总览':'导出纯文本规则';}
async function exportTimetable(kind){
 if(exportingTimetable){toast('课表正在导出，请稍等');return;}
 if(busy){toast('正在读取课表，请读取完成后再导出');return;}
 exportingTimetable=true;exportCancelRequested=false;
 const current=clone(displayState()),week=Math.max(1,Math.min(current.snapshot.semester.weeks,selectedWeek)),sample=!!sampleState;
 modal(`<h3>${exportKindTitle(kind)}</h3><p id="timetable-export-progress" role="status" aria-live="polite">正在准备课表…</p><p class="scope">课程较多时需要几秒钟，完成后请选择保存位置。</p><button class="button" data-action="cancel-export">取消导出</button>`);
 const progress=label=>{const element=document.querySelector('#timetable-export-progress');if(element)element.textContent=label;};
 try{
  const output=await createTimetableExport(current,{kind,week,onProgress:progress,shouldCancel:()=>exportCancelRequested});
  if(sample)output.filename='示例-'+output.filename;
  if(output.bytes.length>32*1024*1024)throw Error('课表文件超过 32MB，请分周导出');
  progress('已生成课表，请选择保存位置');
  let saved=true;
  if(native){const result=await call('exportFile',{filename:output.filename,mime:output.mime,base64:bytesToBase64(output.bytes)});saved=result?.ok===true;}
  else{
   const url=URL.createObjectURL(new Blob([output.bytes],{type:output.mime==='text/plain'?'text/plain;charset=utf-8':output.mime})),link=document.createElement('a');link.href=url;link.download=output.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  if(document.querySelector('#timetable-export-progress'))close();
  const pages=output.pages;
  const success=kind==='week'?(pages>1?`本周课程较多，已导出完整横向 PDF（${pages} 页）`:'已导出本周高清图片'):kind==='semester'?`已导出学期课表 PDF（${pages} 页）`:kind==='semester-overview'?'已导出整学期总览图片':'已导出纯文本规则';
  toast(saved?success:'已取消保存，课表仍保留');
 }catch(e){
  if(document.querySelector('#timetable-export-progress'))close();
  if(e.message==='已取消导出'){toast('已取消导出，课表仍保留',{tone:'neutral'});return;}
  throw e;
 }
 finally{exportingTimetable=false;exportCancelRequested=false;}
}
function safeLeaveError(error){
 const raw=String(error?.message||'').trim();
 const known=['未知的请假服务','当前版本暂不支持应用内打开','当前环境无法打开外部页面','浏览器拦截了新窗口，请允许弹窗后重试','正在读取课表，请稍后再打开请假服务'];
 const hit=known.find(item=>raw.includes(item));
 return hit||'暂时无法打开学工系统，请检查网络后重试。';
}
async function openLeaveFromCard(key,options={}){
 if(leaveOpening)return;
 if(busy){toast('正在读取课表，请稍后再打开请假服务');return;}
 const service=LEAVE_SERVICES.find(item=>item.key===key);
 if(!service){toast('请假入口配置异常');return;}
 if(key==='leave'&&!options.skipNotice&&state.leaveNoticeEnabled!==false){showLeaveNotice(key);return;}
 const card=document.querySelector('#leave-service-panel');
 const status=document.querySelector('#leave-service-status');
 const error=document.querySelector('#leave-service-error');
 const fallback=document.querySelector('#leave-service-fallback');
 const buttons=[...document.querySelectorAll('#leave-service-panel [data-action="leave-open"]')];
 leaveOpening=true;
 card?.setAttribute('aria-busy','true');
 buttons.forEach(button=>{button.disabled=true;});
 if(error){error.hidden=true;error.textContent='';}
 if(fallback)fallback.hidden=true;
 if(status)status.textContent='正在打开学工系统…';
 try{
  const result=await openLeaveService({native,call},service.key,{warmup:true,android:!!globalThis.Android});
  if(status)status.textContent=result.via==='native'?'已打开学校学工系统。登录、填写和提交请在学校页面完成；本应用不保存你的密码。':'已在新窗口打开学工系统。若没有出现，请允许本站弹出窗口。';
 }catch(e){
  const message=safeLeaveError(e);
  if(status)status.textContent='';
  if(error){error.textContent=message;error.hidden=false;}
  if(fallback)fallback.hidden=false;
  toast('请假服务暂时无法打开',{detail:message,tone:'error'});
 }finally{
  leaveOpening=false;
  card?.removeAttribute('aria-busy');
  buttons.forEach(button=>{button.disabled=false;});
 }
}
function customCoursesPanel(){return `<section class="panel"><h2>自定义课程</h2><p>规律课程和独立加课都从同一个入口添加。已添加的课程可在此编辑或删除，学校同步后仍保留。</p><button class="button primary" data-action="custom-course">添加自定义课程</button><div class="custom-course-list">${(state.customCourses||[]).map(c=>`<article class="custom-course-record"><strong>${esc(c.name)}</strong><p>${esc(customCourseSummary(c))}${c.mode==='weekly'&&(c.semesterId!==state.snapshot.semester.id||c.semesterStartDate!==state.snapshot.semester.startDate)?' · 来自其他学期，当前不排课':''}<br>${esc(c.room)} · ${esc(c.teacher)}</p><div class="actions"><button class="button" data-action="custom-edit" data-id="${esc(c.id)}">编辑</button><button class="button danger" data-action="custom-delete" data-id="${esc(c.id)}">删除</button></div></article>`).join('')}</div></section>`;}
function sampleModeEntry(){return `<section class="panel panel-pad sample-mode-entry" id="sample-mode-entry"><h2>示例模式</h2><p class="subtle">查看软件内置的示例课表。个人课表、修改和登录状态会保留。</p><div class="actions"><button class="button primary" data-action="${sampleState?'sample-exit':'sample-mode'}">${sampleState?'退出示例模式':'进入示例模式'}</button><button class="button" data-action="export-diagnostics">导出排查日志</button></div><p class="subtle">遇到登录或读取问题时，可导出版本、学校读取步骤、同步前后本周时段变化，以及当前课程来源（只含日期和节次）。不包含账号、密码、Cookie 或课程内容，不会自动上传。</p></section>`;}
async function enterSampleMode(){
 if(busy||sampleState)return;
 await saveQueue;
 sampleReturnView={tab,selectedDate,selectedWeek,weekSelectedDate,filter,readFeedback};
 sampleState=createState(samples.adjusted);
 sampleState.showDayOverview=state.showDayOverview;
 tab='tomorrow';filter='';readFeedback=null;
 const start=sampleState.snapshot.semester.startDate,end=addDays(start,sampleState.snapshot.semester.weeks*7-1);
 selectedDate=today()>=start&&today()<=end?today():start;
 selectedWeek=weekOf(sampleState.snapshot,selectedDate);weekSelectedDate=selectedDate;
 leaveEpoch++;leaveView=sampleLeaveView();
 close();render();toast('已进入示例模式');
}
async function exitSampleMode(){
 if(!sampleState)return;
 const latest=native?await call('loadState'):JSON.parse(localStorage.getItem('tomorrow-state')||'null');
 if(latest){validateSnapshot(latest.snapshot);if(!Array.isArray(latest.events)||!Array.isArray(latest.overrides)||!Array.isArray(latest.localMaps))throw Error('个人课表读取失败，请重试');state=latest;}
 sampleState=null;
 ({tab,selectedDate,selectedWeek,weekSelectedDate,filter,readFeedback}=sampleReturnView);
 sampleReturnView=null;leaveEpoch++;leaveView=storedLeaveView();close();render();toast('已返回个人课表');
}
function modal(html){document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><header><h2>课程安排</h2><button class="icon-button" data-action="close" aria-label="关闭">${icon('close')}</button></header>${html}</section></div>`;(document.querySelector('.modal [data-autofocus]')||document.querySelector('.modal button'))?.focus();}
function close(){document.querySelector('#modal-root').innerHTML='';}
function detail(key,date){const state=displayState();const r=dayList(date).find(x=>x.key===key);if(!r)return;if(r.vacant){modal(`<h3>${esc(r.name)}</h3><p class="scope">${fmt(date)} ${r.startTime}–${r.endTime} 的原课程${r.movedTo?'已调至 '+fmt(r.movedTo):'已被调休安排替换'}，此时段不上课。撤销对应调休后可恢复原安排。</p><div class="actions">${r.movedTo?`<button class="button primary" data-action="show-day" data-date="${r.movedTo}">查看上课日</button>`:''}<button class="button" data-action="close">关闭</button></div>`);return;}modal(`<div class="detail-hero" style="${courseColor(r)}"><h3>${esc(r.name)}</h3><div>${fmt(date)} · ${dow(date)} · 第 ${weekOf(state.snapshot,date)} 周</div></div><div class="detail-row"><span>时间</span><strong>${r.startTime}–${r.endTime} · ${r.customCourse?'自定义时段':r.periods.join('、')+' 节'}</strong></div><div class="detail-row"><span>地点</span><strong>${esc(r.room==='—'?(r.customCourse?'地点未填写':'待学校确认'):r.room)}</strong></div><div class="detail-row"><span>教师</span><strong>${r.localActivity?'无任课老师':esc(r.teacher)}</strong></div>${leaveMarkDetailRow(r)}<div class="detail-row"><span>${r.customCourse?'上课安排':'排课周次'}</span><strong>${r.customCourse?esc(customCourseSummary(r)):r.weeks.join('、')+' 周'}</strong></div><div class="detail-row"><span>当前来源</span><strong>${r.customCourse?'自定义课程':sourceLabel(r.source)}${r.remapId?' · 按 '+fmt(r.originDate)+'的课表上课':''}</strong></div>${r.overlap?'<div class="scope">此课程与当天另一节课时间重叠，实际安排请向学校确认。</div>':''}${r.conflict?`<div class="conflict-panel"><strong>! 来源冲突，等待处理</strong><div>学校版本：${esc(valueText(r.conflict.school))}</div><div class="local-version">本人 ${stamp(r.conflict.at)} 保存：${esc(valueText(r.conflict.local))}</div><div class="actions"><button class="button primary" data-action="resolve-school" data-key="${esc(key)}">采用学校版</button><button class="button" data-action="resolve-local" data-key="${esc(key)}" data-date="${date}">保留本人修改</button></div></div>`:''}${sampleState?'<p class="scope">示例课表仅供查看。</p><button class="button" data-action="close">关闭</button>':`<div class="actions"><button class="button primary" data-action="edit" data-key="${esc(key)}" data-date="${date}">${date===today()?"修改今天":"修改这一天"}</button>${r.customCourse?'':`<button class="button" data-action="${r.localActivity?'study-settings':'course-settings'}" data-name="${esc(r.name)}">${r.localActivity?'晚自习固定设置':'统一设置这类课程'}</button>`}${r.localActivity?`<button class="button ${r.cancelled?'':'danger'}" data-action="${r.cancelled?'study-restore':'study-skip'}" data-key="${esc(key)}" data-date="${date}">${r.cancelled?'恢复这天晚自习':'这天晚自习不上'}</button>`:''}${r.customCourse?`<button class="button" data-action="custom-edit" data-id="${esc(r.customCourseId)}">编辑自定义课程</button><button class="button danger" data-action="custom-delete" data-id="${esc(r.customCourseId)}">删除自定义课程</button>`:''}${r.courseSettingKey?`<button class="button" data-action="clear-course-settings" data-name="${esc(r.name)}">撤销统一设置</button>`:''}${r.overrideId?`<button class="button" data-action="undo" data-key="${esc(key)}">撤销本次修改</button>`:''}${unreadFor(key)?`<button class="button" data-action="read-key" data-key="${esc(key)}">知道了</button>`:''}</div>`}`);}
function edit(key,date){const r=dayList(date).find(x=>x.key===key);if(!r)return;modal(`<h3>${esc(r.name)}</h3><div class="scope">本次修改只影响 ${fmt(date)}（${dow(date)}）${r.customCourse?'自定义时段':r.periods.join('、')+' 节'}。点击「保存」后生效，可随时撤销。</div><form id="edit-form" data-key="${esc(key)}" data-date="${date}"><label>教室<input name="room" value="${esc(r.room)}" maxlength="80" required></label><label>教师<input name="teacher" value="${esc(r.teacher)}" maxlength="80"></label><div class="form-row"><label>开始时间<input type="time" name="startTime" value="${r.startTime}" required></label><label>结束时间<input type="time" name="endTime" value="${r.endTime}" required></label></div><label class="switch"><input type="checkbox" name="cancelled" ${r.cancelled?'checked':''}>${r.localActivity?"这天晚自习不上":date===today()?"今天停课":"这一天停课"}</label><div class="actions"><button type="submit" class="button primary">保存</button><button type="button" class="button" data-action="close">取消</button></div></form>`);}
function remap(){modal(`<h3>添加调休安排</h3><p class="scope">选择上课时间和原课日期。课程按原日期的周次展开，单双周不会串位。</p><form id="remap-form"><label>上课时间<input type="date" name="date" value="${tab==='week'?weekSelectedDate:selectedDate}" required></label><label>按哪一天的课表<input type="date" name="fromDate" required min="${state.snapshot.semester.startDate}" max="${addDays(state.snapshot.semester.startDate,state.snapshot.semester.weeks*7-1)}"></label><p class="scope">上课日原有课程将被替换。被调走日的普通课程会移走；上课日原有课程全部清除，连不冲突的课程也不保留灰色旧卡片。晚自习独立默认显示，可按天关闭。</p><div class="actions"><button type="submit" class="button primary">保存调休</button><button type="button" class="button" data-action="close">取消</button></div></form>`);}
async function notifyPending(){if(sampleState||!native||!state.notificationEnabled)return;const now=new Date(),date=today(),urgent=state.events.filter(e=>!e.notifiedAt&&noticeLevel(e,now)==='urgent'),digest=state.digestDate!==date?state.events.filter(e=>!e.notifiedAt&&noticeLevel(e,now)==='digest'):[];const items=[...urgent,...digest];if(!items.length)return;try{const result=await call('notify',{title:`课表有 ${items.length} 处变化`,body:items.slice(0,3).map(e=>`${fmt(e.date)} ${e.name}：${e.type}`).join('；')});if(result?.ok){for(const e of items)e.notifiedAt=now.toISOString();if(digest.length)state.digestDate=date;await save();}}catch(e){toast('系统通知未送出，变更记录已保留');}}
async function readSchool(action='sync'){
  if(sampleState||busy)return;
  if(!native){toast('请使用安装版读取学校课表');return;}
  const epoch=++readEpoch;beginRead();
  let leaveRefreshWanted=false;
  try{
    const result=await call(action);
    if(epoch!==readEpoch)return;
    if(result?.skipped)return;
    if(result?.bundle)result.snapshot=normalizeSchool(result.bundle);
    else if(result?.rows)result.snapshot=normalizeSchool(buildBundle(result.rows,{monday:SEMESTER_MONDAYS[result.semesterId],totalWeeks:result.totalWeeks,semesterId:result.semesterId}));
    if(!result?.snapshot){if(action==='openSchool'&&result?.ok){readFeedback={kind:'pending',label:'等待学校登录',text:'学校登录窗口已打开',detail:'完成登录后，点击「读取学校课表」。'};return;}throw Error(result?.message||'没有读取到完整课表，已保留上次数据');}
    result.snapshot=decorateSnapshot(result.snapshot,result.studentProfile);
    const elapsed=((Date.now()-progressStarted)/1000).toFixed(1);
    if(state.snapshot.source.kind==='sample'){pendingSchool=result.snapshot;renderAdopt();readFeedback={kind:'pending',label:'等待采用课表',text:`课表读取完成 · ${elapsed} 秒`,detail:'请确认是否采用学校课表。'};}
    else{state=appendScheduleTrace(state,applySnapshot(state,result.snapshot),'foreground');await save();await notifyPending();readFeedback={text:`课表核对完成 · ${elapsed} 秒`,detail:`${result.snapshot.rules.length} 条排课规则 · ${result.snapshot.semester.weeks} 个教学周 · 数据已更新`};leaveRefreshWanted=true;}
  }catch(e){
    if(epoch!==readEpoch)return;
    if(!e.message.startsWith('已取消')){await call('recordDiagnostic',failureCategory(e.message)).catch(()=>{});state=appendScheduleTrace(state,recordFailure(state,e.message),'foreground-error');await save();}
    readFeedback={kind:e.message.startsWith('已取消')?'cancelled':'error',error:!e.message.startsWith('已取消'),text:e.message.startsWith('已取消')?'已取消读取':'未能确认最新课表',detail:e.message};
  }finally{if(epoch===readEpoch){endRead();render();feedbackNotice();if(leaveRefreshWanted)void refreshLeaveStatus({reason:'school-sync'});if(globalThis.Android)setTimeout(()=>maybeShowPermissionOnboarding(),300);}}
}
let exportingDiagnostics=false;
async function exportDiagnostics(){
 if(exportingDiagnostics)return;
 exportingDiagnostics=true;
 try{
  const data=await call('getDiagnostics')||{platform:'browser'};
  const text=formatDiagnostics(data,state.error,state),filename='江水课表-排查日志-'+today()+'-'+Date.now()+'.txt';
  if(native){const result=await call('exportDiagnostics',{filename,text});toast(result?.ok?'排查日志已保存':'已取消保存');}
  else{const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('排查日志已导出');}
 }finally{exportingDiagnostics=false;}
}
async function sync(){return readSchool('sync');}
function renderAdopt(){if(!pendingSchool)return;const s=pendingSchool;modal(`<h3>已读取完整学校课表</h3><div class="scope">来源：${esc(s.source?.label||'学校移动教务')} · 第 1–${s.semester.weeks} 周 · ${s.rules.length} 条排课规则。首次采用会以学校数据建立新基线并替换当前样例；样例课表的手动修改与变化记录清空，自定义课程及其单日修改、学校凭据保留。</div><div class="actions"><button class="button primary" data-action="adopt-school">采用完整学校课表</button><button class="button" data-action="close">暂不采用</button></div>`);}
async function importSnapshot(snapshot){if(sampleState)throw Error('请先退出示例模式再导入个人课表');const customCourses=snapshot.customCourses,manual=snapshot.manualLeaveCancels;const source=clone(snapshot);delete source.customCourses;delete source.manualLeaveCancels;validateSnapshot(source);let next=customCourses===undefined?state:importCustomCourses(state,customCourses);if(manual!==undefined)next={...next,manualLeaveCancels:normalizeManualCancelMarks(manual)};state=applySnapshot(next,source);selectVisibleWeek(state.snapshot);selectedDate=today();await save();await notifyPending();render();toast('已读取课表，已定位到当前教学周；差异已记入变更记录');}
document.addEventListener('click',async event=>{const el=event.target.closest('[data-action]');if(!el)return;const a=el.dataset.action,key=el.dataset.key,date=el.dataset.date;try{
if(sampleState&&!sampleReadActions.has(a)){toast('请先退出示例模式再修改个人数据');return;}
if(a==='leave-notice-confirm'){confirmLeaveNotice();return;}
 if(a==='settings-toggle'){await toggleSettingsGroup(el.dataset.group,el.getAttribute('aria-expanded')!=='true');return;}
 if(a==='settings-expand-all'){await setAllSettingsGroups(true);return;}
 if(a==='settings-collapse-all'){await setAllSettingsGroups(false);return;}
 if(a==='calendar-sync'){await syncCalendar();return;}
 if(a==='calendar-remove'){await removeCalendar();return;}
 if(a==='calendar-settings'){await call('calendarOpenSettings');return;} if(a==='auto-update-off'){const previous=state.autoUpdate;state.autoUpdate=false;try{await save();}catch(error){state.autoUpdate=previous;throw error;}close();render();toast('已关闭自动更新，打开应用时不再自动核对');return;}
 if(a==='auto-update-cancel'){close();return;}
 if(a==='ack-reminder-intro'){const previous=state.reminderIntroAcknowledged;state.reminderIntroAcknowledged=true;try{await save();}catch(error){state.reminderIntroAcknowledged=previous;throw error;}render();return;}
 if(a==='undo-local-remap'){if(busy)throw Error('请等待当前读取完成');const found=state.localMaps.find(m=>m.id===el.dataset.id);if(!found)throw Error('调课安排已撤销');const previous=state;state={...state,localMaps:state.localMaps.filter(m=>m.id!==found.id)};try{await save();}catch(error){state=previous;throw error;}render();toast('已撤销这次调课，原课程已恢复');return;}
 if(a==='undo-local-edit'){if(busy)throw Error('请等待当前读取完成');const found=state.overrides.find(o=>o.key===key&&o.date===date);if(!found)throw Error('本次修改已撤销');const previous=state;state={...state,overrides:state.overrides.filter(o=>o!==found)};try{await save();}catch(error){state=previous;throw error;}render();toast('已撤销这次课程修改');return;}
 if(a==='leave-open'){await openLeaveFromCard(el.dataset.leaveKey);return;}
 if(a==='leave-status-clear-demo'){leaveEpoch++;leaveView={...leaveView,provider:null,records:leaveView.records.filter(record=>!record.demo)};updateLeaveStatusPanel();toast('已清除示例假条');return;}
if(a==='leave-status-all'){openLeavePage();return;}
if(a==='leave-page-back'){closeLeavePage();return;}
if(a==='leave-page-detail'){toggleLeavePageDetail(el.dataset.leaveId);return;}
if(a==='leave-filter'){leavePageFilter=el.dataset.filter||'all';updateLeavePage();return;}
 if(a==='leave-status-detail'){openLeaveStatusDetail(el.dataset.leaveId);return;}
 if(a==='manual-cancel'||a==='manual-cancel-undo'){const record=leaveView.records.find(item=>item.id===el.dataset.leaveId);if(!record)throw Error(CANCEL_COPY.manualRecordMissing);const cancel=leaveCancelFor(record);if(a==='manual-cancel'){if(!cancel?.canCancel)throw Error(CANCEL_COPY.manualNotAvailable);modal(`<h3>${esc(CANCEL_COPY.manualConfirmTitle)}</h3><p class="scope">${esc(CANCEL_COPY.manualConfirmBody)}</p><div class="actions"><button class="button" data-action="close">取消</button><button class="button danger" data-action="manual-cancel-confirm" data-leave-id="${esc(record.id)}">${esc(CANCEL_COPY.manualConfirmAction)}</button></div>`);}else{if(!cancel?.manual)throw Error(CANCEL_COPY.manualNotAvailable);modal(`<h3>${esc(CANCEL_COPY.manualUndoTitle)}</h3><p class="scope">${esc(CANCEL_COPY.manualUndoBody)}</p><div class="actions"><button class="button" data-action="close">取消</button><button class="button danger" data-action="manual-cancel-undo-confirm" data-leave-id="${esc(record.id)}">${esc(CANCEL_COPY.manualUndoAction)}</button></div>`);}return;}
 if(a==='manual-cancel-confirm'||a==='manual-cancel-undo-confirm'){const record=leaveView.records.find(item=>item.id===el.dataset.leaveId);if(!record)throw Error(CANCEL_COPY.manualRecordMissing);const cancel=leaveCancelFor(record);const mark=a==='manual-cancel-confirm';if(mark&&!cancel?.canCancel)throw Error(CANCEL_COPY.manualNotAvailable);if(!mark&&!cancel?.manual)throw Error(CANCEL_COPY.manualNotAvailable);await setManualCancelMark(record,mark);return;}
 if(a==='leave-status-refresh'){el.disabled=true;await refreshLeaveStatus({reason:'manual',force:true});return;}
 if(a==='permission-fix'){const kind=el.dataset.kind;if(document.querySelector('.modal'))close();await fixPermission(kind);return;}
 if(a==='permission-refresh'){el.disabled=true;await refreshPermissionStatus();return;}
 if(a==='export-diagnostics'){await exportDiagnostics();return;}
if(a==='export-week'){await exportTimetable('week');return;}
if(a==='export-semester'){semesterExportChoice();return;}
if(a==='export-semester-pages'||a==='export-semester-overview'||a==='export-semester-rules'){const kind=a==='export-semester-pages'?'semester':a==='export-semester-overview'?'semester-overview':'rules-text';await exportTimetable(kind);return;}
if(a==='cancel-export'){exportCancelRequested=true;el.disabled=true;el.textContent='正在取消…';const progress=document.querySelector('#timetable-export-progress');if(progress)progress.textContent='正在取消导出…';return;}
if(a==='class-reminder-settings'){classReminderSettings();return;}
if(a==='class-reminder-system-settings'){await call('classReminderSystemSettings');return;}
if(a==='class-reminder-preview'||a==='class-reminder-lock-preview'){const permission=await call('requestNotifications');if(!permission?.ok)throw Error('请先允许系统通知，再预览通知卡片');const lockedTest=a==='class-reminder-lock-preview',result=await call('previewClassReminder',{lockedTest});if(!result?.ok)throw Error('请在通知与锁屏显示设置中开启“上课提醒”分类');toast(lockedTest?'锁屏测试已安排，请现在锁屏':'已发送示例通知卡片',{detail:lockedTest?'约5秒后出现，示例通知1分钟后自动结束':'可下拉通知栏展开查看，1分钟后自动结束'});return;}
if(a==='reminder-system-settings'){await call('notificationSettings');return;}
if(a==='class-reminder-close'){const r=activeClassReminders().find(x=>x.id===el.dataset.id);if(!r){await refreshReminders();return;}modal(`<h3>关闭这次上课提醒？</h3><p class="scope">${esc(r.name)} · ${esc(r.startTime)}–${esc(r.endTime)}<br>确认后，这次课程的锁屏通知和首页提醒会关闭，下次上课仍正常提醒。</p><div class="actions"><button class="button danger" data-action="class-reminder-close-confirm" data-id="${esc(r.id)}">确认关闭本次提醒</button><button class="button primary" data-action="close">保留提醒</button></div>`);document.querySelector('[data-action="close"].button')?.focus();return;}
if(a==='class-reminder-close-confirm'){reminderInfo=await call('closeClassReminder',{id:el.dataset.id});close();render();toast('已关闭本次提醒，下次课程仍会提醒');return;}
if(a==='custom-course'||a==='custom-edit'){customCourseForm(a==='custom-edit'?el.dataset.id:null);return;}
if(a==='custom-delete'){const course=(state.customCourses||[]).find(c=>c.id===el.dataset.id);if(!course)throw Error('该课程已删除');modal(`<h3>删除自定义课程？</h3><p class="scope">${esc(course.name)}：${course.mode==='weekly'?'将删除这门自定义课程的全部重复安排及对应单日修改。':'将删除这次独立加课及对应修改。'}</p><div class="actions"><button class="button danger" data-action="custom-delete-confirm" data-id="${esc(course.id)}">确认删除</button><button class="button" data-action="close">取消</button></div>`);return;}
if(a==='custom-delete-confirm'){state=deleteCustomCourse(state,el.dataset.id);await save();close();render();toast('已删除自定义课程');return;}
if(a==='sample-mode'){if(busy)return;modal('<h3>进入示例模式？</h3><p class="scope">将临时显示内置示例课表。你的个人课表、手动修改、调休安排和登录状态都会保留。</p><div class="actions"><button class="button primary" data-action="sample-confirm">确认进入示例模式</button><button class="button" data-action="close">取消</button></div>');return;}
if(a==='sample-confirm'){await enterSampleMode();return;}
if(a==='sample-exit'){await exitSampleMode();return;}
if(a==='study-settings'){studySettings();return;}else if(a==='course-manager'){courseManager();return;}else if(a==='course-settings'){courseSettingsForm(el.dataset.name);return;}else if(a==='theme-settings'){modal('<h3>外观主题</h3>'+themeOptions());return;}else if(a==='set-theme'){state.theme=el.dataset.theme;applyTheme(state.theme);await save();if(document.querySelector('.modal .theme-options'))modal('<h3>外观主题</h3>'+themeOptions());return;}else if(a==='clear-course-settings'){const row=el.dataset.name==='晚自习'?{name:'晚自习',localActivity:true}:state.snapshot.rules.find(r=>r.name===el.dataset.name);if(row)delete state.courseSettings[courseSettingKey(row)];await save();close();render();return;}else if(a==='select-week-date'){weekSelectedDate=date;render();return;}
if(a==='update-check'){await checkAppUpdate(true);return;}
if(a==='update-download'){await downloadAppUpdate();return;}
if(a==='update-skip'){await skipAppUpdate(el.dataset.version||appUpdateLatest?.latestVersion||'');return;}
if(a==='update-cancel'){await cancelAppUpdate();return;}
if(a==='feedback'){await openFeedback(feedbackInfo);return;}
if(a==='agreement'){modal(`<h3>${esc(agreement.title)}</h3><div class="agreement-body agreement-review">${agreementContent()}</div><button class="button primary" data-action="close">关闭</button>`);return;}else if(a==='battery-settings'){await call('batterySettings');return;}else if(a==='request-exact-alarm'){await call('requestExactAlarm');return;}else if(a==='cancel-read'){if(busy){readEpoch++;endRead();render();}try{await call('cancelRead');}catch{}return;}else if(a==='nav'){tab=el.dataset.tab;if(tab==='changes')markLeaveRead();if(tab==='tomorrow')selectedDate=today();render();if(tab==='settings'&&globalThis.Android){refreshPermissionStatus();void refreshCalendarStatus();}}else if(a==='close'){if(exportingTimetable)exportCancelRequested=true;close();}else if(a==='detail')detail(key,date);else if(a==='edit')edit(key,date);else if(a==='remap')remap();else if(a==='holiday-settings')holidaySettingsForm();
else if(a==='study-skip'){const row=dayList(date).find(r=>r.key===key&&r.localActivity);if(!row)throw Error('这天没有晚自习');state=saveOverride(state,row,{cancelled:true});await save();close();render();toast('已取消这天晚自习');}
else if(a==='study-restore'){state.overrides=state.overrides.filter(o=>o.key!==key);await save();close();render();toast('已恢复这天晚自习');}
else if(a==='show-day'){close();selectedDate=date;tab='tomorrow';render();}else if(a==='day-prev'||a==='day-next'){selectedDate=addDays(selectedDate,a==='day-prev'?-1:1);render();}else if(a==='show-week'){selectedWeek=Math.min(displayState().snapshot.semester.weeks,Math.max(1,weekOf(displayState().snapshot,selectedDate)));tab='week';render();}else if(a==='week-prev'||a==='week-next'){changeWeek(selectedWeek+(a==='week-prev'?-1:1));}else if(a==='this-week'){weekSelectedDate=today();changeWeek(weekOf(displayState().snapshot,today()));}
else if(['read','read-key','read-all'].includes(a)){if(a==='read-all')markLeaveRead();for(const e of state.events)if(a==='read-all'||a==='read'&&e.id===el.dataset.id||a==='read-key'&&e.key===key)e.read=true;await save();close();render();}
else if(a==='undo'||a==='resolve-school'){const r=dayList(key.slice(0,10)).find(x=>x.key===key);if(a==='resolve-school'&&r?.conflict?.kind==='course')delete state.courseSettings[r.courseSettingKey];else state.overrides=state.overrides.filter(o=>o.key!==key);await save();close();render();toast(a==='undo'?'已撤销本次修改':'已采用学校版本');}
else if(a==='resolve-local'){const r=dayList(date).find(x=>x.key===key);if(r?.conflict?.kind==='course'){state=saveCourseSettings(state,r,state.courseSettings[r.courseSettingKey].patch);await save();close();render();toast('已保留课程统一设置');return;}const o=state.overrides.find(x=>x.key===key);if(!r?.conflict?.school)throw Error('来源已取消该课程。请先核对学校通知，不能把已取消课程直接恢复为学校课程。');o.base=clone(r.conflict.school);o.createdAt=new Date().toISOString();await save();close();render();toast('已保留本人修改');}
else if(a==='delete-remap'){state.localMaps=state.localMaps.filter(m=>m.id!==el.dataset.id);await save();render();if(document.querySelector('.modal'))holidaySettingsForm();}
 else if(a==='delete-holiday-range'){state.holidaySettings=setHolidayRange(state.holidaySettings,el.dataset.kind,'','');await save();render();holidaySettingsForm();}
 else if(a==='delete-holiday-day'){state.holidaySettings=removeHolidayDay(state.holidaySettings,date);await save();render();holidaySettingsForm();}
else if(a==='restore'){modal('<h3>还原来源课表？</h3><p class="scope">这会清除本机全部手动课程修改和调休声明，保留来源课表与变化记录。</p><div class="actions"><button class="button danger" data-action="restore-confirm">清除全部手动修改</button><button class="button" data-action="close">取消</button></div>');}
else if(a==='restore-confirm'){state.overrides=[];state.localMaps=[];state.courseSettings={};await save();close();render();}
else if(a==='sync')await sync();
else if(a==='school'){await readSchool('openSchool');}
else if(a==='school-mobile'){if(!native)throw Error('请使用安装版登录移动教务');if(busy)return;await call('openSchool',{mobile:true});toast('请在学校窗口完成登录');}
else if(a==='capture'){await readSchool('capture');}
else if(a==='adopt-school'){if(!pendingSchool)throw Error('请重新读取课表');state=appendScheduleTrace(state,adoptSchoolSnapshot(state,pendingSchool),'adopt');state.theme=themePreference();pendingSchool=null;readFeedback=null;selectVisibleWeek(state.snapshot);await save();close();render();toast('已采用完整学校课表');}
else if(a==='export'){const text=JSON.stringify(customCourseBackup(state),null,2);if(native){await call('export',{text});}else{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));link.download='课表快照.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),5000);}}
else if(a==='import'){if(native){const r=await call('import');if(r?.text)await importSnapshot(JSON.parse(r.text));}else{const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{if(input.files[0].size>2000000)throw Error('文件超过2MB');await importSnapshot(JSON.parse(await input.files[0].text()));}catch(e){toast(e.message);}};input.click();}}
else if(a==='logout'){modal('<h3>注销并清除本机数据？</h3><p class="scope">删除本机学校会话、课表快照、手动修改与变化记录。同时撤回 Cookie 授权；再次使用需重新确认协议。</p><div class="actions"><button class="button danger" data-action="logout-confirm">注销并清除</button><button class="button" data-action="close">取消</button></div>');}
else if(a==='logout-confirm'){invalidateLeaveStatus();state.leaveStatus=normalizeLeaveStatusCache(null,state.snapshot.semester.id);if(native)await call('logout');else{localStorage.removeItem('tomorrow-state');localStorage.removeItem(consentKey);}location.reload();}
}catch(e){toast(e.message);}});
document.addEventListener('change',async e=>{
  if(e.target.matches('[data-calendar-option]')){
  if(sampleState||!globalThis.Android)return;
  const key=e.target.dataset.calendarOption;
  const previous=state.calendarOptions;
  state.calendarOptions=normalizeCalendarOptions({...state.calendarOptions,[key]:e.target.checked});
  try{await save();}catch(error){state.calendarOptions=previous;e.target.checked=!e.target.checked;toast(error.message||'未能保存日历选项');return;}
  calendarError=null;updateCalendarPanel();return;
 }const id=e.target.id;
 if(id==='update-enabled'){if(!globalThis.Android)return;const enabled=e.target.checked;try{const result=await call('updateSettings',{enabled});appUpdateInfo=normalizeUpdateInfo({...(appUpdateInfo||{}),enabled:result?.enabled!==false});}catch(error){e.target.checked=!enabled;toast(error.message||'未能保存更新设置',{tone:'error'});return;}render();return;}
 if(sampleState&&['study-grade','auto-update','leave-notice-enabled','notifications','show-day-overview'].includes(id)){render();toast('请先退出示例模式再修改个人数据');return;}
 if(id==='auto-update'){
  if(!e.target.checked){
   e.target.checked=true;
   modal(`<h3>关闭自动更新？</h3><p class="scope">关闭后打开应用不会自动核对学校课表，可能看到过期的课表；需要时请手动点「读取学校课表」。学校临时调课可能无法及时提醒。</p><div class="actions"><button class="button danger" data-action="auto-update-off">仍然关闭</button><button class="button primary" data-action="auto-update-cancel">保持开启</button></div>`);
   setTimeout(()=>document.querySelector('[data-action="auto-update-cancel"]')?.focus(),0);
   return;
  }
  const previous=state.autoUpdate;state.autoUpdate=true;
  try{await save();}catch(err){state.autoUpdate=previous;e.target.checked=false;toast('未能保存自动更新设置');return;}
  render();return;
 }
 if(id==='leave-notice-enabled'){
  const previous=state.leaveNoticeEnabled;state.leaveNoticeEnabled=e.target.checked;
  try{await save();toast(e.target.checked?'已开启请假须知':'已关闭请假须知，点「请假」直接进入');}catch(err){state.leaveNoticeEnabled=previous;e.target.checked=!e.target.checked;toast('未能保存请假须知设置');}
  return;
 }
 if(id==='show-day-overview'){const previous=state.showDayOverview;state.showDayOverview=e.target.checked;try{await save();}catch(err){state.showDayOverview=previous;toast('未能保存首页显示设置',{detail:err.message,tone:'error'});}render();return;}
 if(e.target.name==='custom-mode'){updateCustomCourseMode();return;}
 if(id==='study-grade'){const value=Number(e.target.value);state.snapshot.studentProfile=value?{grade:value,academicYear:Number(today().slice(0,4))-(Number(today().slice(5,7))<9?1:0),sourceLabel:'本人设置 · 年级'}:null;state.snapshot.studyPolicy=withStudyPolicy(state.snapshot,state.snapshot.studentProfile,holidayCalendar,{studyPolicy:{...state.snapshot.studyPolicy,profile:state.snapshot.studentProfile}}).studyPolicy;await save();render();return;}
 if(id==='day-date'&&e.target.value){selectedDate=e.target.value;render();}
 if(id==='week-select'){changeWeek(Number(e.target.value));}
 if(id==='search')return;
 if(id==='notifications'){try{if(!native)throw Error('浏览器预览不提供系统通知，请使用安装版');if(e.target.checked){const r=await call('requestNotifications');if(!r?.ok)throw Error(r?.message||'系统通知权限未开启');}state.notificationEnabled=e.target.checked;await save();await notifyPending();}catch(err){e.target.checked=false;toast(err.message);}}
});
document.addEventListener('submit',async e=>{e.preventDefault();const f=e.target;try{if(sampleState)throw Error('请先退出示例模式再修改个人数据');if(f.id==='class-reminder-form'){const d=new FormData(f),next=validateReminderSettings({enabled:d.has('enabled'),leadMinutes:Number(d.get('leadMinutes')),afterStartMinutes:Number(d.get('afterStartMinutes'))});if(next.enabled){const result=await call('requestNotifications');if(!result?.ok)throw Error('系统通知权限未开启，请允许通知后再保存');}const previous=state.classReminders,previousPreference=state.classReminderPreferenceSet;state.classReminders=next;state.classReminderPreferenceSet=true;try{await save();}catch(error){state.classReminders=previous;state.classReminderPreferenceSet=previousPreference;throw error;}await refreshReminders();close();render();toast(next.enabled?'上课提醒已开启':'上课提醒已关闭');return;}
if(f.classList.contains('holiday-form')&&f.dataset.kind){const d=new FormData(f);state.holidaySettings=setHolidayRange(state.holidaySettings,f.dataset.kind,String(d.get('startDate')),String(d.get('endDate')));await save();render();holidaySettingsForm();toast('假期时间已保存');return;}
 if(f.id==='holiday-day-form'){const d=new FormData(f);state.holidaySettings=setHolidayDay(state.holidaySettings,String(d.get('date')),d.has('skipStudy'));await save();render();holidaySettingsForm();toast('单日休假已保存');return;}
 if(f.id==='custom-course-form'){const d=new FormData(f),semester=state.snapshot.semester;state=saveCustomCourse(state,{id:f.dataset.id||undefined,mode:d.get('custom-mode'),name:d.get('name'),room:d.get('room'),teacher:d.get('teacher'),startTime:d.get('startTime'),endTime:d.get('endTime'),date:d.get('date'),weekdays:d.getAll('weekdays').map(Number),startWeek:Number(d.get('startWeek')),endWeek:Number(d.get('endWeek')),weekPattern:d.get('weekPattern'),semesterId:semester.id,semesterStartDate:semester.startDate});}else if(f.id==='study-settings-form'){const d=new FormData(f),grade=Number(d.get('grade'));state.snapshot.studentProfile=grade?{grade,academicYear:Number(today().slice(0,4))-(Number(today().slice(5,7))<9?1:0),sourceLabel:'本人设置 · 年级'}:null;const previous={studyPolicy:{userEnabled:d.has('enabled')}};state.snapshot.studyPolicy=withStudyPolicy(state.snapshot,state.snapshot.studentProfile,holidayCalendar,previous).studyPolicy;state=saveCourseSettings(state,{name:'晚自习',localActivity:true,ruleId:'local-evening-study'},{room:String(d.get('room')||'')});}else if(f.id==='course-settings-form'){const d=new FormData(f),r=state.snapshot.rules.find(x=>x.name===f.dataset.name),patch={};if(d.has('set-room'))patch.room=String(d.get('room')||'');if(d.has('set-teacher'))patch.teacher=String(d.get('teacher')||'');state=saveCourseSettings(state,r,patch);}else if(f.id==='edit-form'){const r=dayList(f.dataset.date).find(x=>x.key===f.dataset.key),d=new FormData(f),patch={};for(const name of ['room','teacher','startTime','endTime'])if(d.get(name)!==r[name])patch[name]=d.get(name);if(d.has('cancelled')!==!!r.cancelled)patch.cancelled=d.has('cancelled');if(Object.keys(patch).length)state=saveOverride(state,r,patch);}else if(f.id==='remap-form'){const d=new FormData(f);if(d.get('date')===d.get('fromDate'))throw Error('上课时间应与原日期不同');if(state.localMaps.some(m=>m.date===d.get('date')||m.fromDate===d.get('date')||m.fromDate===d.get('fromDate')))throw Error('所选日期已有调休，先撤销旧安排再重新设置');if(holidayForDate(state.holidaySettings,String(d.get('date'))))throw Error('上课日已设置休假，请先撤销当天休假');state.localMaps.push({id:'local-'+Date.now(),date:d.get('date'),fromDate:d.get('fromDate'),mode:'replace'});}else return;await save();close();render();toast(f.id==='custom-course-form'?'自定义课程已保存':f.id==='study-settings-form'?'晚自习设置已保存':f.id==='course-settings-form'?'已统一设置本学期同名课程':'已保存，仅对指定日期生效');}catch(err){toast(err.message);}});
let drag=null,suppressClickUntil=0,wheelDistance=0,lastWheelAt=0;
function navigateSwipe(kind,direction){if(kind==='week')changeWeek(selectedWeek+direction);else if(kind==='day'){selectedDate=addDays(selectedDate,direction);render();}}
document.addEventListener('pointerdown',event=>{if(!event.isPrimary||event.button!==0||document.querySelector('.modal'))return;const host=event.target.closest('[data-swipe]');if(!host||event.target.closest('input,select,textarea'))return;drag={id:event.pointerId,host,kind:host.dataset.swipe,x:event.clientX,y:event.clientY,at:performance.now()};});
document.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)>18&&Math.abs(dx)>Math.abs(dy)*1.5){try{drag.host.setPointerCapture(event.pointerId);}catch{}}});
document.addEventListener('pointercancel',()=>{drag=null;});
document.addEventListener('pointerup',event=>{if(!drag||event.pointerId!==drag.id)return;const start=drag;drag=null;const direction=swipeDirection(start,{x:event.clientX,y:event.clientY,at:performance.now()});try{if(start.host.hasPointerCapture(event.pointerId))start.host.releasePointerCapture(event.pointerId);}catch{}if(direction){event.preventDefault();suppressClickUntil=performance.now()+400;navigateSwipe(start.kind,direction);}});
document.addEventListener('click',event=>{if(performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
document.addEventListener('wheel',event=>{const host=event.target.closest('[data-swipe]');if(!host||document.querySelector('.modal')||Math.abs(event.deltaX)<=Math.abs(event.deltaY)*1.5)return;event.preventDefault();const at=performance.now();if(at-lastWheelAt>220)wheelDistance=0;lastWheelAt=at;wheelDistance+=event.deltaX;if(Math.abs(wheelDistance)>95){const direction=Math.sign(wheelDistance);wheelDistance=0;navigateSwipe(host.dataset.swipe,direction);}},{passive:false});
document.addEventListener('input',event=>{if(event.target.id!=='search')return;filter=event.target.value;const position=event.target.selectionStart;render();const input=document.querySelector('#search');input.focus({preventScroll:true});input.setSelectionRange(position,position);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&leaveNoticeOpen)cancelLeaveNotice();});
globalThis.addEventListener('pagehide',()=>{if(leaveNoticeOpen)cancelLeaveNotice();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(leavePageOpen){closeLeavePage();return;}if(leaveNoticeOpen){e.preventDefault();return;}if(exportingTimetable&&document.querySelector('#timetable-export-progress'))exportCancelRequested=true;close();}if(e.key==='Tab'){const trap=document.querySelector('#leave-notice-root')||document.querySelector('.modal')||(leavePageOpen?document.querySelector('#leave-page'):null);if(!trap)return;const nodes=[...trap.querySelectorAll('button,input,select,a')].filter(n=>!n.disabled);if(!nodes.length){e.preventDefault();trap.focus({preventScroll:true});return;}if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}}});
globalThis.addEventListener('popstate',syncLeavePageFromLocation);
globalThis.addEventListener('hashchange',syncLeavePageFromLocation);
// 反馈通道配置取自 web/feedback.json；未配置时入口不出现。
loadFeedbackInfo().then(info=>{feedbackInfo=info;if(tab==='settings')render();}).catch(()=>{});
void (async()=>{await loadAppUpdateInfo();if(appUpdateInfo?.enabled)setTimeout(()=>{void checkAppUpdate(false);},2500);})();
render();
if(location.hash==='#leave-status')openLeavePage({fromHistory:true});
refreshReminders();
if(!sampleState)void refreshLeaveStatus({reason:'startup'});
scheduleLeaveDailyCheck();
if(globalThis.Android)setTimeout(async()=>{await refreshPermissionStatus();maybeShowPermissionOnboarding();},800);
// 系统权限框只在用户点击「权限检查」或通知开关后拉起，启动时不再自动申请。

setInterval(()=>{if(globalThis.Android)refreshReminders();},15000);
if(state.snapshot.source.kind==='school')void autoUpdateNow();else notifyPending();
setInterval(()=>{notifyPending();},60000);
globalThis.addEventListener('focus',()=>{notifyPending();refreshCourseStatus();});
setInterval(refreshCourseStatus,15000);
globalThis.__dsjOnBack=__dsjOnBack;
globalThis.openToday=async(date='')=>{delete globalThis.__openChangesRequest;delete globalThis.__openScheduleRequest;if(sampleState)await exitSampleMode();tab='tomorrow';selectedDate=/^\d{4}-\d{2}-\d{2}$/.test(date)?date:today();await refreshReminders();render();};
globalThis.openChanges=async()=>{delete globalThis.__openScheduleRequest;delete globalThis.__openChangesRequest;if(sampleState)await exitSampleMode();markLeaveRead();tab='changes';render();};
globalThis.onLeaveServiceReturn=()=>{if(!sampleState)void refreshLeaveStatus({reason:'leave-return',force:true});scheduleLeaveDailyCheck();};
globalThis.onNativeResume=async()=>{refreshCourseStatus();if(!globalThis.Android)return;await refreshPermissionStatus();void refreshCalendarStatus();if(busy)return;await saveQueue.catch(()=>{});try{const latest=await call('loadState');if(latest&&Number(latest._revision||0)>Number(state._revision||0)&&!document.querySelector('.modal')){const beforeMarks=(state.manualLeaveCancels?.marks||[]).length;state=latest;state.manualLeaveCancels=normalizeManualCancelMarks(state.manualLeaveCancels);state.courseLastSuccess??=state.lastSuccess??null;state.leaveLastSuccess??=state.leaveStatus?.fetchedAt??null;render();const afterMarks=(state.manualLeaveCancels?.marks||[]).length;if(afterMarks!==beforeMarks)console.debug('[trace] event=restore source=native rev='+(state._revision??0)+' marks='+afterMarks);}}catch{}await autoUpdateNow();void checkAppUpdate(false);await refreshReminders();scheduleLeaveDailyCheck();};

if(globalThis.__openChangesRequest)globalThis.openChanges();else if(globalThis.__openScheduleRequest)globalThis.openToday(globalThis.__openScheduleRequest.date);



