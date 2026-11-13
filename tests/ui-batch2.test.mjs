import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createState} from '../web/core.mjs';

const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/style.css',import.meta.url),'utf8');
const java=readFileSync(new URL('../android/app/src/main/java/cn/local/tomorrow/MainActivity.java',import.meta.url),'utf8');
const base={schemaVersion:1,semester:{id:'t',name:'测试',startDate:'2026-08-31',weeks:8},rules:[],exceptions:[],remaps:[],closedDates:[],unscheduled:[]};

test('自动更新：默认开、设置第一项、关闭二次确认/取消保持开/确认后保存',()=>{
 assert.match(app,/state\.autoUpdate=state\.autoUpdate!==false;/,'旧状态迁移默认开');
 assert.match(app,/function autoUpdateEnabled\(\)\{return state\.autoUpdate!==false;\}/);
 assert.match(app,/id="auto-update-panel"/);
 assert.match(app,/settingsGroup\('自动更新',autoUpdatePanel\(\),'auto'\)/);
 const settings=/function renderSettings\(\)\{[\s\S]*?\n\}/.exec(app)?.[0]||'';
 assert(settings.length>0,'找不到 renderSettings');
 assert(settings.indexOf("settingsGroup('自动更新'")<settings.indexOf('themePanel()'),'自动更新必须在课表与显示（含主题）之前');
 const confirm=/<h3>关闭自动更新？<\/h3>[\s\S]*?仍然关闭[\s\S]*?保持开启/.exec(app)?.[0]||'';
 assert.match(confirm,/关闭后打开应用不会自动核对学校课表/);
 assert.match(confirm,/data-action="auto-update-off"/);assert.match(confirm,/data-action="auto-update-cancel"/);
 assert.match(app,/document\.querySelector\('\[data-action="auto-update-cancel"\]'\)\?\.focus\(\)/,'默认焦点在保持开启');
 assert.match(app,/if\(a==='auto-update-off'\)\{const previous=state\.autoUpdate;state\.autoUpdate=false;/);
 assert.match(app,/async function autoUpdateNow\(\)\{if\(!autoUpdateEnabled\(\)/,'关闭后不得自动读取');
 assert.match(app,/if\(state\.snapshot\.source\.kind==='school'\)void autoUpdateNow\(\);/,'冷启动自动核对候选');
 assert.match(app,/await autoUpdateNow\(\);void checkAppUpdate\(false\);await refreshReminders\(\);scheduleLeaveDailyCheck\(\);\};/,'回前台自动核对候选');
});

test('每日核对 UI/调度移除，但上课提醒与通知/权限入口保留',()=>{
 for(const removed of ['auto-check-time','configureAutoCheck','backgroundCheck','每日自动核对','立即后台检查','检查状态'])assert.equal(app.includes(removed),false,'应移除每日核对 UI/调用：'+removed);
 assert.match(app,/function classReminderPanel\(\)/);
 assert.match(app,/function notificationPanel\(\)/);
 assert.match(app,/function permissionPanel\(\)/);
 assert.match(app,/settingsGroup\('课程与提醒',studyPanel\(\)\+customCoursesPanel\(\)\+classReminderPanel\(\)\+notificationPanel\(\)\+permissionPanel\(\)\)/);
 assert.match(java,/CheckScheduler\.cancel\(this\);ClassReminders\.reconcile\(this\);/,'启动时必须取消旧每日核对闹钟并保留上课提醒');
 assert.doesNotMatch(java,/CheckScheduler\.schedule\(/,'不再注册每日核对调度');
 assert.match(java,/case "classReminderStatus":ClassReminders\.reconcile/);
});

test('请假须知：弹窗结构、初始禁用、逐秒递减、0 秒启用并变按钮文案',()=>{
 const notice=/function leaveNoticeHtml\(\)\{[\s\S]*?\n\}/.exec(app)?.[0]||'';
 assert.match(notice,/role="dialog" aria-modal="true"/);
 assert.match(notice,/aria-labelledby="leave-notice-title"/);
 assert.match(notice,/id="leave-notice-title">请假须知/);
 assert.match(notice,/学校不会把假条发给任课老师或考勤同学/);
 assert.match(notice,/班主任批准后，请导出假条，发给班纪律委员 \/ 学习委员 \/ 负责考勤的同学/);
 assert.match(notice,/id="leave-notice-button" data-action="leave-notice-confirm" disabled aria-live="polite">5 秒后可关闭 \(5\)/);
 assert.doesNotMatch(notice,/data-action="close"|icon-button/,'须知不提供关闭图标');
 assert.match(app,/leaveNoticeSeconds=5;/);
 assert.match(app,/el\.textContent=`\$\{leaveNoticeSeconds\} 秒后可关闭 \(\$\{leaveNoticeSeconds\}\)`;el\.disabled=true;\}leaveNoticeSeconds-=1;/);
 assert.match(app,/leaveNoticeSeconds-=1;return;\}stopLeaveNoticeTimer\(\);const el=button\(\);if\(el\)\{el\.disabled=false;el\.classList\.add\('primary'\);el\.textContent='知道了，去请假';el\.focus\(\{preventScroll:true\}\);\}/);
});

test('请假须知：定时器不叠加、关闭清理、遮罩/Esc 不可关闭、销假续假不弹',()=>{
 assert.match(app,/function stopLeaveNoticeTimer\(\)\{if\(leaveNoticeTimer\)\{clearInterval\(leaveNoticeTimer\);leaveNoticeTimer=null;\}\}/);
 assert.match(app,/function showLeaveNotice\(key\)\{if\(leaveNoticeOpen\)return;/,'重复打开直接忽略，避免多计时器');
 assert.match(app,/document\.querySelector\('#leave-notice-root'\)\?\.remove\(\)/);
 assert.match(app,/document\.addEventListener\('visibilitychange',\(\)=>\{if\(document\.hidden&&leaveNoticeOpen\)cancelLeaveNotice\(\);\}\)/);
 assert.match(app,/globalThis\.addEventListener\('pagehide',\(\)=>\{if\(leaveNoticeOpen\)cancelLeaveNotice\(\);\}\)/);
 assert.match(app,/if\(e\.key==='Escape'\)\{if\(leavePageOpen\)\{closeLeavePage\(\);return;\}if\(leaveNoticeOpen\)\{e\.preventDefault\(\);return;\}/,'须知打开时 Esc 不可关闭');
 assert.match(app,/if\(key==='leave'&&!options\.skipNotice&&state\.leaveNoticeEnabled!==false\)\{showLeaveNotice\(key\);return;\}/,'只有请假键触发须知');
 assert.match(app,/void openLeaveFromCard\(key,\{skipNotice:true\}\)/,'5 秒确认后才跳转');
});

test('请假须知设置：默认开、可持久化关闭，关闭后直接进学工页',()=>{
 assert.match(app,/state\.leaveNoticeEnabled=state\.leaveNoticeEnabled!==false;/);
 assert.match(app,/id="leave-notice-enabled" \$\{state\.leaveNoticeEnabled!==false\?'checked':''\}>显示请假须知/);
 assert.match(app,/if\(id==='leave-notice-enabled'\)\{[\s\S]{0,300}state\.leaveNoticeEnabled=e\.target\.checked;/);
 assert.match(app,/已关闭请假须知，点「请假」直接进入/);
});

test('返回契约：__dsjOnBack 优先级与今日页 false、Esc/原生 onBackPressed 接线',()=>{
 const back=app.split('\n').find(line=>line.startsWith('function __dsjOnBack()'))||'';
 assert.match(back,/leaveNoticeOpen\)\{cancelLeaveNotice\(\);return true;/);
 assert.match(back,/leavePageOpen\)\{closeLeavePage\(\);return true;/);
 assert.match(back,/#modal-root'\)\?\.children\.length\)\{close\(\);return true;/);
 assert.match(back,/tab!=='tomorrow'\)\{tab='tomorrow';selectedDate=today\(\);render\(\);return true;/);
 assert.match(back,/return false;\}\r?$/);
 assert.match(app,/globalThis\.__dsjOnBack=__dsjOnBack;/);
 assert.match(java,/window\.__dsjOnBack\?window\.__dsjOnBack\(\)===true:false/);
 assert.match(java,/if\("true"\.equals\(raw\)\)return;/);
 assert.match(java,/if\(target!=web\|\|isFinishing\(\)\|\|isDestroyed\(\)\)return;/);
 assert.match(java,/void handleNativeBack\(\)\{[\s\S]*?else moveTaskToBack\(true\);/,'只有原生一级页面才退出后台');
});

test('设置六组顺序与折叠 DOM：默认仅 auto 展开、aria 与全部展开/收起',()=>{
 const start=app.indexOf('function renderSettings(){'),end=app.indexOf('\n}',start);
 const settings=app.slice(start,end);
 assert(start>=0&&end>start,'找不到 renderSettings 函数边界');
 const order=['自动更新','课表与显示','请假与调休','课程与提醒','数据与同步','关于与隐私'];
 let last=-1;
 for(const title of order){const at=settings.indexOf(`settingsGroup('${title}'`);assert(at>last,'分组顺序错误：'+title);last=at;}
 assert.match(settings,/settings-groups/);
 assert.match(app,/const SETTINGS_GROUP_DEFAULT=\{auto:true,display:false,leave:false,course:false,data:false,about:false\}/,'默认仅 auto 展开');
 assert.match(app,/const SETTINGS_GROUP_KEYS=\{自动更新:'auto','课表与显示':'display','请假与调休':'leave','课程与提醒':'course','数据与同步':'data','关于与隐私':'about'\}/,'六组标题到 key 映射');
 const template=app.slice(app.indexOf('function settingsGroup('),app.indexOf('function settingsGroupControls('));
 assert.match(template,/class="settings-group \$\{className\}" data-settings-group="\$\{key\}"/,'section 带 data-settings-group');
 assert.match(template,/class="settings-group-toggle" data-action="settings-toggle" data-group="\$\{key\}" aria-expanded="\$\{expanded\}" aria-controls="settings-group-\$\{key\}"/,'标题行按钮 aria');
 assert.match(template,/class="settings-group-arrow" aria-hidden="true"/,'箭头 aria-hidden');
 assert.match(template,/class="settings-group-body" id="settings-group-\$\{key\}" \$\{expanded\?'':'hidden'\}/,'body hidden 由展开状态决定');
 assert.match(template,/const expanded=state\.settingsExpanded\?\.\[key\]===true/,'展开状态来自持久化 state');
 assert.match(app,/data-action="settings-expand-all">全部展开/);
 assert.match(app,/data-action="settings-collapse-all">全部收起/);
 assert.match(css,/\.settings-group-body\{display:contents\}/);
 assert.match(css,/\.settings-group-body\[hidden\]\{display:none\}/);
 assert.match(css,/\.settings-group-body > \.panel/,'折叠后 2 列布局仍覆盖 body 内 panel');
 assert.doesNotMatch(settings,/autoCheckPanel/,'设置页不得再渲染每日核对面板');
});

test('批次一：快捷按钮两枚 primary，请假与调休弹窗三节顺序',()=>{
 const quick=app.split('\n').find(line=>line.startsWith('function quickTools()'))||'';
 assert.equal((quick.match(/button primary/g)||[]).length,2,'两枚都是 primary');
 assert.match(quick,/data-action="custom-course">添加课程/);
 assert.match(quick,/data-action="holiday-settings">请假与调休/);
 const modal=app.slice(app.indexOf("modal(`<h3>请假与调休</h3>"));
 const a=modal.indexOf('id="holiday-service-title">请假服务');
 const b=modal.indexOf('id="holiday-remap-title">调休安排');
 const c=modal.indexOf('id="holiday-vacation-title">休假设置');
 assert(a>0&&b>a&&c>b,'三节顺序必须是 请假服务→调休安排→休假设置');
});

test('批次一：今日页无假条面板，变更记录页有假条面板+刷新+查看全部，红点基线/已读逻辑',()=>{
 const day=/function renderDay\(\)\{[\s\S]*?\n\}/.exec(app)?.[0]||'';
 assert.doesNotMatch(day,/renderLeaveStatusPanel/,'今日页不再显示假条面板');
 const changes=/function renderChanges\(\)\{[\s\S]*?\n\}/.exec(app)?.[0]||'';
 assert.match(changes,/renderLeaveStatusPanel\(\)/);
 assert.match(app,/data-action="leave-status-refresh"/);assert.match(app,/data-action="leave-status-all">查看全部/);
 assert.match(app,/function updateLeaveUnreadFrom\(records\)\{if\(sampleState\)return;[\s\S]{0,200}if\(state\.leaveUnreadBaseline==null\)\{state\.leaveUnreadBaseline=key;state\.leaveUnread=false;return;\}/,'首次同步建基线不红');
 assert.match(app,/if\(key!==state\.leaveUnreadBaseline\)state\.leaveUnread=true;/);
 assert.match(app,/function markLeaveRead\(\)\{if\(sampleState\)return false;[\s\S]{0,200}state\.leaveUnread=false;/);
 assert.match(app,/if\(a==='nav'\)[\s\S]{0,300}tab==='changes'\)markLeaveRead\(\)/);
 assert.match(app,/class="count leave-unread-dot"/);
});

test('state 迁移：旧状态无 autoUpdate/leaveNotice/leaveUnread 时安全默认',()=>{
 const state=createState(base);
 state.autoUpdate=undefined;state.leaveNoticeEnabled=undefined;state.leaveUnread=undefined;state.leaveUnreadBaseline=undefined;
 assert.equal(state.autoUpdate!==false,true,'默认自动更新开');
 assert.equal(state.leaveNoticeEnabled!==false,true,'默认显示须知');
 assert.equal(state.leaveUnread===true,false);
 assert.equal(state.leaveUnreadBaseline??null,null);
});
