import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const app=read('web/app.mjs');
const activity=read('android/app/src/main/java/cn/local/tomorrow/MainActivity.java');
const calendarSync=read('android/app/src/main/java/cn/local/tomorrow/CalendarSync.java');
const manifest=read('android/app/src/main/AndroidManifest.xml');

test('设置分组：默认只展开自动更新，其余收起；六个分组键齐全',()=>{
 assert.match(app,/SETTINGS_GROUP_DEFAULT=\{auto:true,display:false,leave:false,course:false,data:false,about:false\}/);
 assert.match(app,/SETTINGS_GROUP_KEYS=\{自动更新:'auto','课表与显示':'display','请假与调休':'leave','课程与提醒':'course','数据与同步':'data','关于与隐私':'about'\}/);
 const groups=['auto','display','leave','course','data','about'];
 for(const key of groups) assert(app.includes(`data-settings-group="${key}"`)||app.includes(`settingsGroupKey`),`缺少分组 ${key}`);
 assert.match(app,/settingsGroupKey\(title,className\)/);
 assert.match(app,/typeof source\[key\]==='boolean'\?source\[key\]:SETTINGS_GROUP_DEFAULT\[key\]/,'缺省值必须回落到默认展开表');
});

test('分组折叠：aria-expanded/aria-controls/hidden 同步，切换后保存并恢复焦点',()=>{
 assert.match(app,/aria-expanded="\$\{expanded\}"/);
 assert.match(app,/aria-controls="settings-group-\$\{key\}"/);
 assert.match(app,/id="settings-group-\$\{key\}" \$\{expanded\?'':'hidden'\}/);
 assert.match(app,/if\(a==='settings-toggle'\)\{await toggleSettingsGroup\(el\.dataset\.group,el\.getAttribute\('aria-expanded'\)!=='true'\);return;\}/);
 assert.match(app,/const next=normalizeSettingsExpanded\(\{\.\.\.state\.settingsExpanded,\[key\]:expanded\}\)/);
 assert.match(app,/await save\(\).*?settingsExpanded/,'切换必须持久化');
 assert.match(app,/querySelector\(`\[data-action="settings-toggle"\]\[data-group="\$\{key\}"\]`\)\?\.focus\(\)/,'重渲染后焦点回到按钮');
});

test('全部展开/全部收起：覆盖所有分组键并保存',()=>{
 assert.match(app,/data-action="settings-expand-all">全部展开</);
 assert.match(app,/data-action="settings-collapse-all">全部收起</);
 assert.match(app,/Object\.keys\(SETTINGS_GROUP_DEFAULT\)\.map\(key=>\[key,expanded\]\)/);
 assert.match(app,/state\.settingsExpanded=normalizeSettingsExpanded\(Object\.fromEntries\(Object\.keys\(SETTINGS_GROUP_DEFAULT\)\.map/);
 assert.match(app,/expanded\?'settings-expand-all':'settings-collapse-all'/);
});

test('设置页进入时刷新日历状态；数据与同步组包含日历面板',()=>{
 assert.match(app,/if\(tab==='settings'&&globalThis\.Android\)\{refreshPermissionStatus\(\);void refreshCalendarStatus\(\);\}/);
 assert.match(app,/settingsGroup\('数据与同步',schoolPanel\(\)\+calendarPanel\(\)\+timetableLocalPanel\(\)\+sourcePanel\(\)\)/);
 assert.match(app,/return '仅 Android 支持写入系统日历'/);
 assert.match(app,/calendarPermissionText\(permission\)/);
 assert.match(app,/permission==='granted'\?'日历权限：已授权':permission==='denied'\?'日历权限：已拒绝':'日历权限：未授权'/);
});

test('日历面板：三项勾选默认全开、按钮与失败/拒绝/桌面文案',()=>{
 assert.match(app,/option\('school','学校课程'\)/);
 assert.match(app,/option\('custom','自定义课程与调休'\)/);
 assert.match(app,/option\('study','晚自习'\)/);
 assert.match(app,/const disabled=calendarBusy\|\|!android\|\|unavailable\|\|sample/);
 assert.match(app,/data-action="calendar-sync" \$\{disabled\?'disabled':''\}>/);
 assert.match(app,/data-action="calendar-remove" \$\{disabled\?'disabled':''\}>/);
 assert.match(app,/data-action="calendar-settings"/,'权限被拒时提供去系统设置');
 assert.match(app,/class="calendar-error" role="alert"/,'失败必须有 role=alert');
 assert.match(app,/calendarError\.message\|\|'写入系统日历失败'/);
 assert.match(app,/calendarErrorFrom\(error,'读取日历状态失败'\)/);
 assert.match(app,/日历权限：已拒绝/);
 assert.match(app,/仅 Android 支持写入系统日历/);
 assert.match(app,/本机没有可用的系统日历应用/);
 assert.match(app,/重装或清除应用数据后，系统日历里可能留下旧事件/, '必须提示孤儿事件风险');
 assert.match(app,/当前仅支持 Android，桌面端不写入/);
});

test('Android：日历权限请求与三动作接入 Bridge，拒绝返回带码错误',()=>{
 assert.match(manifest,/android\.permission\.READ_CALENDAR/);
 assert.match(manifest,/android\.permission\.WRITE_CALENDAR/);
 assert.match(activity,/REQ_CALENDAR=13/);
 assert.match(activity,/requestPermissions\(new String\[\]\{Manifest\.permission\.READ_CALENDAR,Manifest\.permission\.WRITE_CALENDAR\},REQ_CALENDAR\)/);
 assert.match(activity,/CalendarSync\.markPermissionAsked\(this\)/);
 assert.match(activity,/CALENDAR_PERMISSION_DENIED","需要日历权限才能写入，请在系统设置中允许/);
 for(const action of ['calendarStatus','calendarSync','calendarRemove']) assert(activity.includes(`case "${action}":beginCalendarAction`),`缺少 bridge 动作 ${action}`);
 assert.match(activity,/calendarOpenSettings":openAppDetails\(\);result/);
 assert.match(activity,/calendarWatchdog=\(\)->finishCalendarAction\(id,CalendarSync\.error\("CALENDAR_TIMEOUT"/);
 assert.match(activity,/calendarHandler\.postDelayed\(calendarWatchdog,30000L\)/,'30 秒 watchdog');
 assert.match(activity,/cancelCalendarAction\(\);calendarExecutor\.shutdownNow\(\)/);
});

test('Android CalendarSync：专用本地日历、覆盖式写入、5000 条上限与移除清理',()=>{
 assert.match(calendarSync,/CALENDAR_NAME = "江水课表"/);
 assert.match(calendarSync,/CALENDAR_ACCOUNT = "jiangshui-schedule"/);
 assert.match(calendarSync,/CalendarContract\.AUTHORITY/);
 assert.match(calendarSync,/EVENT_LIMIT = 5000/);
 assert.match(calendarSync,/rawEvents\.length\(\) > EVENT_LIMIT/);
 assert.match(calendarSync,/CALENDAR_INVALID_EVENT", "写入数据无效或课程数量过多/);
 assert.match(calendarSync,/Events\.CONTENT_URI, "_id=\? AND calendar_id=\?"/,'删除必须限定在本应用日历内');
 assert.match(calendarSync,/readIds\(p\.getString\("eventIds", "\[\]"\)\)/);
 assert.match(calendarSync,/deleteIds\(context, calendar\.id, newIds\)/,'写入中途失败要回滚已插入事件');
 assert.match(calendarSync,/putString\("eventIds", idsJson\(newIds\)\)/);
 assert.match(calendarSync,/p\.edit\(\)\.putString\("eventIds", "\[\]"\)\.remove\("lastSyncAt"\)\.putInt\("lastEventCount", 0\)/,'移除后清空状态');
});

test('Android：SharedPreferences 键按规格为 calendar-sync，事件字段与版本号正确',()=>{
 assert.match(calendarSync,/static final String CALENDAR_PREFS = "calendar-sync"/);
 assert.match(calendarSync,/p\.getString\("eventIds", "\[\]"\)/);
 assert.match(calendarSync,/putInt\("lastEventCount", newIds\.size\(\)\)/);
 assert.match(calendarSync,/Events\.HAS_ALARM, 0/);
 assert.equal(/RRULE/.test(calendarSync),false,'一次性事件不得写 RRULE');
 assert.match(app,/call\('calendarSync',\{semesterId:state\.snapshot\.semester\.id,events:built\.events\}\)/);
 assert.match(app,/call\('calendarRemove'\)/);
 const gradle=read('android/app/build.gradle');
 assert.match(gradle,/versionCode 54/);
 assert.match(gradle,/versionName '1\.3\.4'/);
});
test('设置分组收起态摘要：六组常量齐全',()=>{
 const summaries={'自动更新':'打开应用自动核对学校课表','课表与显示':'外观主题 · 首页显示 · 完整课表','请假与调休':'请假服务 · 调休安排 · 休假设置','课程与提醒':'上课提醒 · 晚自习 · 自定义课程','数据与同步':'<b>写入系统日历</b> · 教务系统 · 导出与排查日志','关于与隐私':'版本信息 · 用户协议 · 开源与致谢'};
 for(const [title,text] of Object.entries(summaries)) assert.ok(app.includes(`'${title}':'${text}'`),`缺少摘要 ${title}`);
});

test('设置分组摘要只在收起态渲染',()=>{
 assert.match(app,/expanded\?'':`<span class="settings-group-summary">\$\{SETTINGS_GROUP_SUMMARIES\[title\]\|\|''\}<\/span>`/,'展开后不得残留摘要 DOM');
});

test('设置分组摘要样式：11px ellipsis 且加粗可继承',()=>{
 const css=read('web/style.css');
 assert.match(css,/\.settings-group-summary\{[^}]*text-overflow:ellipsis[^}]*font-size:11px/);
 assert.match(css,/\.settings-group-summary b\{color:inherit;font-weight:700\}/);
});
