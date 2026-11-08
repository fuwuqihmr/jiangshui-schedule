import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createState,applySnapshot,adoptSchoolSnapshot,latestIso} from '../web/core.mjs';

const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const java=readFileSync(new URL('../android/app/src/main/java/cn/local/tomorrow/MainActivity.java',import.meta.url),'utf8');
const snapshot={schemaVersion:1,semester:{name:'2026 秋',startDate:'2026-09-07',weeks:20},rules:[]};

test('时间语义：课表刷新不改假条时间，假条刷新同时推进全局与假条时间',()=>{
  const state=createState(snapshot);
  state.lastSuccess='2026-11-03T15:50:00.000Z';
  state.leaveLastSuccess='2026-11-03T15:50:00.000Z';
  const course=applySnapshot(state,snapshot,'2026-11-04T00:10:00.000Z');
  assert.equal(course.lastSuccess,'2026-11-04T00:10:00.000Z','页脚全局时间应被课表刷新推进');
  assert.equal(course.courseLastSuccess,'2026-11-04T00:10:00.000Z');
  assert.equal(course.leaveLastSuccess,'2026-11-03T15:50:00.000Z','课表刷新不得改写假条卡头时间');
  const fetched='2026-11-04T00:20:00.000Z';
  const leave={...course,lastSuccess:latestIso(course.lastSuccess,fetched),leaveLastSuccess:latestIso(course.leaveLastSuccess,fetched)};
  assert.equal(leave.lastSuccess,fetched,'假条刷新必须推进页脚全局时间');
  assert.equal(leave.leaveLastSuccess,fetched,'假条刷新必须推进假条卡头时间');
  assert.equal(leave.courseLastSuccess,'2026-11-04T00:10:00.000Z','假条刷新不得改写课表核对时间');
  assert.equal(leave.lastSuccess,leave.leaveLastSuccess,'刷新后卡头与页脚必须同源同时推进');
  assert.notEqual(leave.lastSuccess,course.lastSuccess,'刷新后的时间不得仍是刷新前的旧值');
});

test('采用学校课表快照保留 leaveLastSuccess，不重置为课表时间',()=>{
  const state=createState(snapshot);
  state.leaveLastSuccess='2026-11-03T15:50:00.000Z';
  const adopted=adoptSchoolSnapshot(state,snapshot,'2026-11-04T00:30:00.000Z');
  assert.equal(adopted.leaveLastSuccess,'2026-11-03T15:50:00.000Z');
  assert.equal(adopted.lastSuccess,'2026-11-04T00:30:00.000Z');
  assert.equal(createState(snapshot).leaveLastSuccess,null,'新建状态不得凭空给出假条时间');
});

test('卡头用假条源、页脚用全局源，且刷新回调立即重画两处（不需要切 tab）',()=>{
  const start=app.indexOf('function leaveUpdatedLabel()');
  const fn=app.slice(start,app.indexOf('\n',start));
  assert.ok(fn.includes('displayState().leaveLastSuccess'),'卡头应优先使用假条自己的最近成功时间');
  assert.ok(fn.includes('displayState().lastSuccess'),'旧存档兼容：没有 leaveLastSuccess 时回退 lastSuccess');
  assert.ok(!fn.includes('leaveView.fetchedAt'),'卡头不得直接读 leaveView.fetchedAt');
  assert.ok(app.includes('id="footer-stamp"')&&app.includes('footerContent()'),'页脚必须有可原位更新的节点并复用同一段文本');
  const update=app.slice(app.indexOf('function updateFooterStamp()'),app.indexOf('function updateFooterStamp()')+220);
  assert.ok(update.includes("#footer-stamp"),'updateFooterStamp 必须直接定位页脚节点');
  assert.ok(!update.includes('render()'),'页脚更新不得依赖整页 render，否则需要切 tab');
  const leaveBlock=app.slice(app.indexOf('async function refreshLeaveStatus'),app.indexOf('async function refreshCancelStatus'));
  assert.ok(leaveBlock.includes('state.leaveLastSuccess=latestIso(state.leaveLastSuccess,leaveView.fetchedAt)'),'请假刷新回调要写 leaveLastSuccess');
  assert.ok(leaveBlock.includes('state.lastSuccess=latestIso(state.lastSuccess,leaveView.fetchedAt)'),'请假刷新回调要写全局 lastSuccess');
  assert.ok(leaveBlock.includes('updateLeaveStatusPanel();updateFooterStamp();'),'请假刷新回调要同时重画卡头与页脚');
  const cancelBlock=app.slice(app.indexOf('async function refreshCancelStatus'),app.indexOf('async function refreshReminders'));
  assert.ok(cancelBlock.includes('state.leaveLastSuccess=latestIso(state.leaveLastSuccess,fetchedAt)'));
  assert.ok(cancelBlock.includes('updateLeaveStatusPanel();updateFooterStamp();'));
  assert.equal((app.match(/state\.lastSuccess=latestIso\(state\.lastSuccess,/g)||[]).length,2,'两条假条刷新路径都要推进全局时间');
});

test('销假标记溯源日志：mark/undo/restore/state-load 带来源与摘要，不打印明文编号',()=>{
  assert.match(app,/console\.debug\('\[trace\] state-load source='\+\(native\?'native-snapshot':'localStorage'\)\+' rev='/);
  assert.match(app,/console\.debug\('\[trace\] event='\+\(mark\?'mark':'undo'\)\+' source=ui number='\+traceNumberHash\(record\.number\)\.slice\(0,8\)/);
  assert.match(app,/console\.debug\('\[trace\] event=restore source=native/);
  assert.doesNotMatch(app,/console\.debug\([^\n]*number='\+record\.number/,'日志不得打印明文编号');
  assert.match(java,/onConsoleMessage\(ConsoleMessage message\)/);
  assert.match(java,/msg\.startsWith\("\[trace\]"\)/);
  assert.match(java,/StateStore\.log\(MainActivity\.this,msg/);
});
