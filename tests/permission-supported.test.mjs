import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// 权限面板按平台能力 supported 渲染（2026-11-18 / V-D1web / task-68，补丁来源 ios-porter）。
// 锁定 web/app.mjs 的 3 处接线（旧 iOS 时代行为，1.4.x 丢失后恢复）：
//   1) permissionRowsHtml()：permissionInfo.<组>.supported===false 的权限行整行不渲染（.filter(Boolean)）；
//   2) permissionPanel()：autostart.supported===false 时隐藏「自启动只能在系统设置中手动允许」与「小米/Redmi」提示；
//   3) maybeShowPermissionOnboarding()：一次性权限提示弹窗文案同样按 autostart.supported 分支。
// 测试方式：从真实 web/app.mjs 截取 4 个函数（rows/panel/refreshPermissionStatus/onboarding），
// 放进 vm 沙箱，用 iOS 与 Android 两种 permissionStatus 回包真实执行渲染。
// Android 侧 golden 取自基线 commit 01eb8d6（打补丁前）的渲染结果，断言逐字不变；iOS 侧 golden 与
// 旧 iOS 时代 web（Juwp-YWRK 快照）逐字一致（比对过程见 work/docs/phase-1.5.0/实现报告-webS3.md 证据）。
// iOS 回包形状见 ios/Jiangshui/Services/PermissionReporter.swift：exactAlarm/battery/autostart 都带 supported:false。
const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');

function appSlice(startMarker,endMarker){
  const start=app.indexOf(startMarker);
  if(start<0)throw new Error('app.mjs 缺少函数起始标记：'+startMarker);
  const end=app.indexOf(endMarker,start+startMarker.length);
  if(end<0)throw new Error('app.mjs 缺少函数结束标记：'+endMarker);
  return app.slice(start,end);
}
const PERMISSION_FUNCTIONS=[
  appSlice('function permissionRowsHtml(){','\nfunction permissionPanel(){'),
  appSlice('function permissionPanel(){','\nasync function refreshPermissionStatus(){'),
  appSlice('async function refreshPermissionStatus(){','\nasync function fixPermission(kind){'),
  appSlice('async function maybeShowPermissionOnboarding(){','\nfunction normalizeSettingsExpanded(')
].join('\n');

// iOS PermissionReporter.snapshot() 的完整回包形状（通知已允许，三组 Android 专属能力 supported:false）。
const IOS={
  notifications:{runtime:false,granted:true,systemEnabled:true,allowed:true},
  exactAlarm:{required:false,allowed:true,supported:false},
  battery:{exempt:true,supported:false},
  autostart:{supported:false,known:false,oem:'',openedAt:0}
};
// iOS 但通知未允许：用来触发一次性权限提示弹窗（needs=true），验证弹窗文案分支。
const IOS_NEEDS={
  notifications:{runtime:false,granted:false,systemEnabled:false,allowed:false},
  exactAlarm:{required:false,allowed:true,supported:false},
  battery:{exempt:true,supported:false},
  autostart:{supported:false,known:false,oem:'',openedAt:0}
};
// Android 当前回包（规格 13 AND-045）：exactAlarm/battery 无 supported 字段，autostart 显式 supported:true。
const ANDROID_REAL={
  sdk:33,
  notifications:{runtime:true,granted:true,systemEnabled:true,allowed:true},
  exactAlarm:{required:true,allowed:false},
  battery:{exempt:false},
  autostart:{supported:true,known:false,oem:'Xiaomi',openedAt:0}
};
// Android 旧回包形状（基线 01eb8d6 时期，无任何 supported 字段）：四行行为必须逐字不变。
const ANDROID_LEGACY={
  sdk:33,
  notifications:{runtime:true,granted:true,systemEnabled:true,allowed:true},
  exactAlarm:{required:true,allowed:false},
  battery:{exempt:false},
  autostart:{known:false,oem:'Xiaomi',openedAt:0}
};
const ANDROID_NEEDS={
  sdk:33,
  notifications:{runtime:true,granted:false,systemEnabled:false,allowed:false},
  exactAlarm:{required:true,allowed:false},
  battery:{exempt:false},
  autostart:{supported:true,known:false,oem:'Xiaomi',openedAt:0}
};

// 打补丁前（01eb8d6）Android legacy 回包的逐字渲染结果。
const ANDROID_ROWS_GOLDEN=`<div class="permission-row"><div class="permission-meta"><strong>通知</strong><span class="permission-state is-ok">已开启</span></div><button type="button" class="button" data-action="permission-fix" data-kind="notifications" disabled>已开启</button></div><div class="permission-row"><div class="permission-meta"><strong>精确闹钟</strong><span class="permission-state is-warn">未允许</span></div><button type="button" class="button" data-action="permission-fix" data-kind="exact-alarm">去允许精确闹钟</button></div><div class="permission-row"><div class="permission-meta"><strong>电池优化</strong><span class="permission-state is-warn">未忽略</span></div><button type="button" class="button" data-action="permission-fix" data-kind="battery">去关闭电池优化</button></div><div class="permission-row"><div class="permission-meta"><strong>自启动</strong><span class="permission-state is-warn">需在系统设置确认</span></div><button type="button" class="button" data-action="permission-fix" data-kind="autostart">去设置自启动</button></div>`;
const ANDROID_PANEL_GOLDEN=`<section class="panel permission-panel" id="permission-panel" aria-labelledby="permission-title"><h2 id="permission-title">权限检查</h2><p>这些权限用于准时提醒和后台核对；自启动只能在系统设置中手动允许。可随时跳过，不影响看课表。</p><div class="permission-rows" id="permission-rows" aria-live="polite"><div class="permission-row"><div class="permission-meta"><strong>通知</strong><span class="permission-state is-ok">已开启</span></div><button type="button" class="button" data-action="permission-fix" data-kind="notifications" disabled>已开启</button></div><div class="permission-row"><div class="permission-meta"><strong>精确闹钟</strong><span class="permission-state is-warn">未允许</span></div><button type="button" class="button" data-action="permission-fix" data-kind="exact-alarm">去允许精确闹钟</button></div><div class="permission-row"><div class="permission-meta"><strong>电池优化</strong><span class="permission-state is-warn">未忽略</span></div><button type="button" class="button" data-action="permission-fix" data-kind="battery">去关闭电池优化</button></div><div class="permission-row"><div class="permission-meta"><strong>自启动</strong><span class="permission-state is-warn">需在系统设置确认</span></div><button type="button" class="button" data-action="permission-fix" data-kind="autostart">去设置自启动</button></div></div><div class="actions"><button class="button" data-action="permission-refresh">重新检查</button></div><p class="disabled-note">自启动无法由应用直接开启；小米/Redmi 可在安全中心 → 应用管理 → 自启动中允许。</p></section>`;
const ANDROID_ONBOARDING_GOLDEN=`<h3>权限检查（可跳过）</h3><p>为了准时提醒和后台核对课表，建议开启以下权限。自启动只能在系统设置中手动允许。</p><div class="permission-rows" aria-live="polite"><div class="permission-row"><div class="permission-meta"><strong>通知</strong><span class="permission-state is-warn">未开启</span></div><button type="button" class="button" data-action="permission-fix" data-kind="notifications">去开启通知</button></div><div class="permission-row"><div class="permission-meta"><strong>精确闹钟</strong><span class="permission-state is-warn">未允许</span></div><button type="button" class="button" data-action="permission-fix" data-kind="exact-alarm">去允许精确闹钟</button></div><div class="permission-row"><div class="permission-meta"><strong>电池优化</strong><span class="permission-state is-warn">未忽略</span></div><button type="button" class="button" data-action="permission-fix" data-kind="battery">去关闭电池优化</button></div><div class="permission-row"><div class="permission-meta"><strong>自启动</strong><span class="permission-state is-warn">需在系统设置确认</span></div><button type="button" class="button" data-action="permission-fix" data-kind="autostart">去设置自启动</button></div></div><div class="actions"><button class="button primary" data-action="close">稍后再说</button></div>`;
// 补丁后 iOS 回包的逐字渲染结果（与旧 iOS 时代 web 相同）。
const IOS_ROWS_GOLDEN=`<div class="permission-row"><div class="permission-meta"><strong>通知</strong><span class="permission-state is-ok">已开启</span></div><button type="button" class="button" data-action="permission-fix" data-kind="notifications" disabled>已开启</button></div>`;
const IOS_PANEL_GOLDEN=`<section class="panel permission-panel" id="permission-panel" aria-labelledby="permission-title"><h2 id="permission-title">权限检查</h2><p>这些权限用于准时提醒和后台核对。可随时跳过，不影响看课表。</p><div class="permission-rows" id="permission-rows" aria-live="polite"><div class="permission-row"><div class="permission-meta"><strong>通知</strong><span class="permission-state is-ok">已开启</span></div><button type="button" class="button" data-action="permission-fix" data-kind="notifications" disabled>已开启</button></div></div><div class="actions"><button class="button" data-action="permission-refresh">重新检查</button></div></section>`;
const IOS_ONBOARDING_GOLDEN=`<h3>权限检查（可跳过）</h3><p>为了准时提醒和后台核对课表，建议开启以下权限。</p><div class="permission-rows" aria-live="polite"><div class="permission-row"><div class="permission-meta"><strong>通知</strong><span class="permission-state is-warn">未开启</span></div><button type="button" class="button" data-action="permission-fix" data-kind="notifications">去开启通知</button></div></div><div class="actions"><button class="button primary" data-action="close">稍后再说</button></div>`;

function sandbox(){
  const prefix=[
    'var permissionInfo=null,permissionError=null,permissionRefreshing=false,permissionFixing=false,permissionOnboardingTried=false,sampleState=null,tab="settings";',
    'var PERMISSION_ONBOARDING_KEY="jiangshui-permission-onboarding-v1";',
    'var modalHtml=[];var modal=function(html){modalHtml.push(html);};',
    'var esc=function(value){var s=String(value===undefined||value===null?"":value);return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#39;");};',
    'var document={querySelector:function(){return null;}};',
    'var localStorage={getItem:function(){return null;},setItem:function(){}};',
    'var sandboxPermissionStatus=null;',
    'var call=async function(action){if(action==="permissionStatus")return JSON.parse(JSON.stringify(sandboxPermissionStatus));throw Error("unexpected bridge call: "+action);};',
    'var render=function(){};',
    'globalThis.Android={};',
    PERMISSION_FUNCTIONS
  ].join('\n');
  const context=vm.createContext({});
  vm.runInContext(prefix,context,{filename:'web/app.mjs#permission-functions'});
  return context;
}

async function render(snapshot){
  const ctx=sandbox();
  ctx.permissionInfo=JSON.parse(JSON.stringify(snapshot));
  const rows=ctx.permissionRowsHtml();
  const panel=ctx.permissionPanel();
  ctx.permissionOnboardingTried=false;
  await ctx.maybeShowPermissionOnboarding();
  return {rows,panel,onboarding:ctx.modalHtml.join('\n')};
}
async function readStatus(snapshot){
  const ctx=sandbox();
  ctx.sandboxPermissionStatus=JSON.parse(JSON.stringify(snapshot));
  await ctx.refreshPermissionStatus();
  return {permissionInfo:ctx.permissionInfo,permissionError:ctx.permissionError};
}
function countRows(html){return (html.match(/class="permission-row"/g)||[]).length;}

test('源码接线：permissionRowsHtml/permissionPanel/maybeShowPermissionOnboarding 三处 supported 分支存在',()=>{
  const rows=appSlice('function permissionRowsHtml(){','\nfunction permissionPanel(){');
  for(const line of [
    'const showExact=permissionInfo?.exactAlarm?.supported!==false;',
    'const showBattery=permissionInfo?.battery?.supported!==false;',
    'const showAutostart=permissionInfo?.autostart?.supported!==false;'
  ])assert.ok(rows.includes(line),'permissionRowsHtml 缺少能力标记：'+line);
  assert.ok(rows.includes("].filter(Boolean).join('')"),'permissionRowsHtml 必须过滤掉不支持的行');
  assert.ok(rows.includes("showExact?row('精确闹钟'"),'精确闹钟行必须受 showExact 控制');
  assert.ok(rows.includes("showBattery?row('电池优化'"),'电池优化行必须受 showBattery 控制');
  assert.ok(rows.includes("showAutostart?row('自启动'"),'自启动行必须受 showAutostart 控制');

  const panel=appSlice('function permissionPanel(){','\nasync function refreshPermissionStatus(){');
  assert.equal((panel.match(/permissionInfo\?\.autostart\?\.supported===false/g)||[]).length,2,'权限面板两处文案都必须按 autostart.supported 分支');
  assert.ok(panel.includes('自启动只能在系统设置中手动允许'));
  assert.ok(panel.includes('小米/Redmi'));

  const onboarding=appSlice('async function maybeShowPermissionOnboarding(){','\nfunction normalizeSettingsExpanded(');
  assert.equal((onboarding.match(/permissionInfo\?\.autostart\?\.supported===false/g)||[]).length,1,'权限提示弹窗文案必须按 autostart.supported 分支');
  assert.ok(onboarding.includes('自启动只能在系统设置中手动允许。'));
});

test('iOS 快照（supported:false）：权限行只渲染通知，三行 Android 专属项全部隐藏',async()=>{
  const out=await render(IOS);
  assert.equal(out.rows,IOS_ROWS_GOLDEN,'iOS 权限行必须与旧 iOS 时代 web 逐字一致');
  for(const name of ['精确闹钟','电池优化','自启动'])assert.ok(!out.rows.includes(name),'iOS 不得渲染权限行：'+name);
  for(const kind of ['exact-alarm','battery','autostart'])assert.ok(!out.rows.includes('data-kind="'+kind+'"'),'iOS 不得渲染按钮 data-kind：'+kind);
  assert.ok(out.rows.includes('通知'),'iOS 仍必须有通知行');
  assert.equal(countRows(out.rows),1,'iOS 只应剩通知一行');
  assert.equal((out.rows.match(/data-action="permission-fix"/g)||[]).length,1,'iOS 只应剩一个权限按钮');
});

test('iOS 快照（supported:false）：权限面板不出现「自启动只能手动允许」与「小米/Redmi」文案',async()=>{
  const out=await render(IOS);
  assert.equal(out.panel,IOS_PANEL_GOLDEN,'iOS 权限面板必须与旧 iOS 时代 web 逐字一致');
  assert.ok(!out.panel.includes('自启动'),'iOS 权限面板不得出现自启动文案');
  assert.ok(!out.panel.includes('小米')&&!out.panel.includes('Redmi'),'iOS 权限面板不得出现小米/Redmi 文案');
  assert.ok(out.panel.includes('这些权限用于准时提醒和后台核对。可随时跳过，不影响看课表。'),'iOS 面板说明应去掉自启动分句');
  assert.ok(out.panel.includes('id="permission-panel"'),'面板本体仍要渲染');
  assert.ok(out.panel.includes('data-action="permission-refresh"'),'重新检查按钮仍要渲染');
});

test('iOS 一次性权限提示：弹窗只含通知行，不出现自启动/小米文案',async()=>{
  const out=await render(IOS_NEEDS);
  assert.equal(out.onboarding,IOS_ONBOARDING_GOLDEN,'iOS 权限提示弹窗必须与旧 iOS 时代 web 逐字一致');
  assert.ok(out.onboarding.includes('权限检查（可跳过）'),'通知未允许时必须弹出提示');
  assert.ok(!out.onboarding.includes('自启动'),'iOS 提示弹窗不得出现自启动文案');
  assert.ok(!out.onboarding.includes('小米')&&!out.onboarding.includes('Redmi'),'iOS 提示弹窗不得出现小米/Redmi 文案');
  assert.equal(countRows(out.onboarding),1,'iOS 提示弹窗只应剩通知一行');
});

test('Android 回包无 supported 字段（基线形状）：权限四行渲染逐字不变',async()=>{
  const out=await render(ANDROID_LEGACY);
  assert.equal(out.rows,ANDROID_ROWS_GOLDEN,'Android 权限行必须与基线 01eb8d6 逐字一致');
  assert.equal(countRows(out.rows),4,'Android 必须是四行权限');
  const order=['通知','精确闹钟','电池优化','自启动'].map(name=>out.rows.indexOf('<strong>'+name+'</strong>'));
  assert.deepEqual([...order].sort((a,b)=>a-b),order,'Android 行顺序保持 通知/精确闹钟/电池优化/自启动');
  for(const kind of ['notifications','exact-alarm','battery','autostart'])assert.ok(out.rows.includes('data-kind="'+kind+'"'),'Android 缺少按钮 data-kind：'+kind);
});

test('Android 回包无 supported 字段（基线形状）：权限面板与提示文案逐字不变',async()=>{
  const out=await render(ANDROID_LEGACY);
  assert.equal(out.panel,ANDROID_PANEL_GOLDEN,'Android 权限面板必须与基线 01eb8d6 逐字一致');
  assert.ok(out.panel.includes('；自启动只能在系统设置中手动允许。'),'Android 必须保留自启动手动允许文案');
  assert.ok(out.panel.includes('小米/Redmi 可在安全中心 → 应用管理 → 自启动中允许。'),'Android 必须保留小米/Redmi 文案');
  const needs=await render(ANDROID_NEEDS);
  assert.equal(needs.onboarding,ANDROID_ONBOARDING_GOLDEN,'Android 权限提示弹窗必须与基线 01eb8d6 逐字一致');
  assert.ok(needs.onboarding.includes('自启动只能在系统设置中手动允许。'),'Android 提示弹窗必须保留自启动文案');
  assert.equal(countRows(needs.onboarding),4,'Android 提示弹窗仍是四行');
});

test('supported 只对 false 生效：Android 显式 supported:true 与无字段渲染一致，iOS 显式 true 时四行恢复',async()=>{
  const legacy=await render(ANDROID_LEGACY);
  const real=await render(ANDROID_REAL);
  assert.equal(real.rows,legacy.rows,'autostart.supported:true 不得改变 Android 渲染');
  assert.equal(real.panel,legacy.panel,'Android 面板渲染不得受 supported:true 影响');
  assert.equal(real.onboarding,legacy.onboarding);
  const iosAllSupported=JSON.parse(JSON.stringify(IOS));
  iosAllSupported.exactAlarm.supported=true;
  iosAllSupported.battery.supported=true;
  iosAllSupported.autostart.supported=true;
  const out=await render(iosAllSupported);
  for(const name of ['通知','精确闹钟','电池优化','自启动'])assert.ok(out.rows.includes('<strong>'+name+'</strong>'),'显式 supported:true 时必须渲染行：'+name);
  assert.ok(out.panel.includes('小米/Redmi'),'显式 supported:true 时面板保留 Android 专属文案');
});

test('refreshPermissionStatus 接受带 supported 字段的回包，不误判为读取失败',async()=>{
  // vm 沙箱内 JSON.parse 出来的对象与外层 realm 原型不同，比较前统一走 JSON 往返。
  const plain=value=>value===undefined||value===null?value:JSON.parse(JSON.stringify(value));
  const ios=await readStatus(IOS);
  assert.deepEqual(plain(ios.permissionInfo),IOS,'iOS 回包必须被完整接受（不能因 supported:false 丢弃）');
  assert.equal(ios.permissionError,false,'iOS 回包不得被判为读取失败');
  const android=await readStatus(ANDROID_REAL);
  assert.deepEqual(plain(android.permissionInfo),ANDROID_REAL,'Android 回包必须被完整接受');
  assert.equal(android.permissionError,false);
});
