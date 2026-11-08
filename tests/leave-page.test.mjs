import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createState,timetableDay} from '../web/core.mjs';
import {sampleLeaveRecords,leaveStatusSummary,leaveRecordsForDate,sortLeaveRecords} from '../web/leave-status.mjs';

const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/style.css',import.meta.url),'utf8');
const START='2026-08-31';
const rules=[
 {id:'a',name:'早课',teacher:'甲',room:'A101',weekday:2,weeks:[8],periods:[1,2],startTime:'08:30',endTime:'09:55'},
 {id:'b',name:'第二门',teacher:'乙',room:'A102',weekday:2,weeks:[8],periods:[3,4],startTime:'10:15',endTime:'11:40'},
 {id:'c',name:'第三门',teacher:'丙',room:'A103',weekday:2,weeks:[8],periods:[5,6],startTime:'14:00',endTime:'15:25'}
];
const state=createState({schemaVersion:1,semester:{id:'test-term',name:'测试学期',startDate:START,weeks:8},rules,exceptions:[],remaps:[],closedDates:[],unscheduled:[]});

test('全屏页结构：独立 main、返回/刷新、标题与不可滚动遮罩',()=>{
 assert.match(app,/function renderLeavePage\(\)/);
 const page=/function renderLeavePage\(\)\{[\s\S]*?\n\}/.exec(app)?.[0]||'';
 assert.match(page,/id="leave-page"/);
 assert.match(page,/role="main"/);
 assert.match(page,/aria-labelledby="leave-page-title"/);
 assert.match(page,/id="leave-page-title">假条状态/);
 assert.match(page,/data-action="leave-page-back" aria-label="返回"/);
 assert.match(page,/data-action="leave-status-refresh"/);
 assert.match(page,/class="leave-page-body"/);
 assert.match(app,/document\.body\.classList\.add\('leave-page-open'\)/);
 assert.match(app,/setAttribute\('inert',''\)/);
 assert.match(css,/body\.leave-page-open\{overflow:hidden\}/);
 assert.match(css,/\.leave-page\{position:fixed;inset:0;/);
});

test('两条入口：今日面板「查看全部」与设置页「查看假条状态」都打开全屏页',()=>{
 const entrances=app.match(/<button[^>]*data-action="leave-status-all"[^>]*>/g)||[];
 assert.equal(entrances.length,2,'应有今日面板与设置页两个入口');
 assert.match(app,/查看全部<\/button>/);
 assert.match(app,/查看假条状态/);
 assert.match(app,/if\(a==='leave-status-all'\)\{openLeavePage\(\);return;\}/);
 // 示例模式允许页面动作
 for(const action of ['leave-status-all','leave-page-back','leave-filter','leave-page-detail'])assert(app.includes(`'${action}'`),'示例模式需放行 '+action);
});

test('筛选：四档标签/计数、aria-pressed、过滤与筛选空态',()=>{
 const filters=/const LEAVE_PAGE_FILTERS=\[([\s\S]*?)\];/.exec(app)?.[1]||'';
 for(const value of ['all','pending','approved','rejected'])assert.match(filters,new RegExp(`'${value}'`));
 for(const label of ['全部','待审批','已通过','已驳回'])assert.match(filters,new RegExp(`'${label}'`));
 assert.match(app,/const filtered=leavePageFilter==='all'\?records:records\.filter\(record=>record\.status===leavePageFilter\)/);
 assert.match(app,/class="button leave-filter-button" data-action="leave-filter" data-filter="\$\{value\}" aria-pressed="\$\{leavePageFilter===value\}">\$\{label\}<span>\$\{count\}<\/span>/);
 assert.match(app,/if\(a==='leave-filter'\)\{leavePageFilter=el\.dataset\.filter\|\|'all';updateLeavePage\(\);return;\}/);
 assert.match(app,/这个筛选下没有记录/);
 assert.match(app,/data-action="leave-filter" data-filter="all">查看全部/);
 assert.match(app,/if\(!filtered\.length\)list=`<div class="empty leave-status-empty">/);
});

test('空态：无记录、读取失败、加载中都有明确文案',()=>{
 assert.match(app,/还没有假条记录/);
 assert.match(app,/审批通过后会在课表里标注；这里只显示本机保存的假条。/);
 assert.match(app,/读取假条失败/);
 assert.match(app,/正在更新假条状态…/);
 assert.match(app,/data-action="leave-status-refresh">重新读取/);
});

test('详情展开：aria-expanded、详情/收起、字段完整',()=>{
 assert.match(app,/const expanded=leavePageExpanded\.has\(record\.id\)/);
 assert.match(app,/data-action="leave-page-detail" data-leave-id="\$\{esc\(record\.id\)\}" aria-expanded="\$\{expanded\}"/);
 assert.match(app,/\$\{expanded\?'收起':'详情'\}/);
 for(const field of ['状态','起止','原因','提交时间','审批人','审批意见','来源'])assert(app.includes(`<span>${field}</span>`),'详情缺字段 '+field);
 assert.match(app,/if\(a==='leave-page-detail'\)\{toggleLeavePageDetail\(el\.dataset\.leaveId\);return;\}/);
 assert.match(app,/if\(leavePageExpanded\.has\(id\)\)leavePageExpanded\.delete\(id\);else leavePageExpanded\.add\(id\)/);
});

test('返回：按钮、Esc、浏览器历史与焦点恢复',()=>{
 assert.match(app,/if\(a==='leave-page-back'\)\{closeLeavePage\(\);return;\}/);
 assert.match(app,/if\(e\.key==='Escape'\)\{if\(leavePageOpen\)\{closeLeavePage\(\);return;\}/);
 assert.match(app,/history\.pushState\(\{leavePage:true\},'','#leave-status'\)/);
 assert.match(app,/history\.replaceState\(Object\.assign\(\{\},history\.state,\{leavePage:true\}\),'','#leave-status'\)/);
 assert.match(app,/globalThis\.addEventListener\('popstate',syncLeavePageFromLocation\)/);
 assert.match(app,/globalThis\.addEventListener\('hashchange',syncLeavePageFromLocation\)/);
 assert.match(app,/if\(location\.hash==='#leave-status'\)openLeavePage\(\{fromHistory:true\}\)/);
 assert.match(app,/function closeLeavePage[\s\S]*?removeAttribute\('inert'\)[\s\S]*?removeAttribute\('aria-hidden'\)/);
 assert.match(app,/if\(target&&target\.isConnected\)\{try\{target\.focus\(\{preventScroll:true\}\)/);
});

test('示例提示与清除：页面示例条、清除示例后刷新可恢复',()=>{
 assert.match(app,/当前为示例假条，仅用于预览，不会写入本机缓存。/);
 assert.match(app,/class="badge amber">示例数据/);
 assert.match(app,/if\(a==='leave-status-clear-demo'\)\{leaveEpoch\+\+;leaveView=\{\.\.\.leaveView,provider:null,records:leaveView\.records\.filter\(record=>!record\.demo\)\}/);
 assert.match(app,/已清除示例假条/);
 assert.match(app,/async function refreshLeaveStatus[\s\S]*?activeLeaveProvider\(\)/);
 assert.match(app,/function activeLeaveProvider\(\)\{return sampleState\?getLeaveRecordsProvider\('sample'\):getLeaveRecordsProvider\(\);/);
});

test('纯函数：示例数据计数与筛选档位一致、返回后今日面板数据不变',()=>{
 const records=sampleLeaveRecords(state,'2026-10-20');
 const summary=leaveStatusSummary(records);
 assert.equal(summary.total,4);
 assert.equal(summary.approved,2,'已通过=2（请假 + 销假）');
 assert.equal(summary.pending,1);assert.equal(summary.rejected,1);assert.equal(summary.unknown,0);
 const counts={all:summary.total,pending:summary.pending,approved:summary.approved,rejected:summary.rejected};
 assert.deepEqual(counts,{all:4,pending:1,approved:2,rejected:1});
 for(const [filter,count] of Object.entries(counts)){
  const filtered=filter==='all'?records:records.filter(record=>record.status===filter);
  assert.equal(filtered.length,count,'筛选项计数必须与列表一致：'+filter);
 }
 const today=leaveRecordsForDate(records,'2026-10-20');
 assert.equal(sortLeaveRecords(today).length,4);
 const tomorrow=leaveRecordsForDate(records,'2026-10-21');
 assert.equal(tomorrow.length,0,'示例假条只覆盖今天，切换日期不串数据');
});
