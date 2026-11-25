import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createState} from '../web/core.mjs';
import {buildRulesModel,buildRulesText,buildSemesterOverviewModel} from '../web/timetable-export.mjs';
import {sortLeaveRecords} from '../web/leave-status.mjs';
import {examDay} from '../web/jiaowu-exam.mjs';
import {normalized,courseSettingKey} from '../web/interactions.mjs';

// 导出/列表顺序固定用例（1.5.0 D-2 / task-65）。口径：
// - 课程名/教师/教室等自由文本 → 显式 Intl.Collator('zh-Hans-CN') 拼音序，不随设备 locale 变；
// - 日期/时间/技术键/id/编号 → UTF-16 码元序（与 Java String.compareTo 同口径）；
// - 回归保护：把运行环境默认 localeCompare 钉为 en-US / 码元序后，导出顺序必须逐项不变。
const START='2026-08-31',WEEKS=16;
const base=(rules=[],extra={})=>({schemaVersion:1,semester:{id:'locale-order',name:'测试学期',startDate:START,weeks:WEEKS},rules,exceptions:[],remaps:[],closedDates:[],unscheduled:[],...extra});
const rule=(id,extra={})=>({id,name:'课程'+id,teacher:'老师'+id,room:'A101',weekday:1,weeks:[1,2,3],periods:[1,2],startTime:'08:30',endTime:'09:55',...extra});
// 只在用例内模拟「设备默认 locale」；生产代码已不再调用无参 localeCompare，patch 不应改变任何顺序。
function withDefaultCollation(collator,run){
 const original=String.prototype.localeCompare;
 String.prototype.localeCompare=function(other,locales,options){
  if(locales===undefined&&options===undefined)return collator.compare(String(this),String(other));
  return original.call(this,other,locales,options);
 };
 try{return run();}finally{String.prototype.localeCompare=original;}
}
const rulesFixture=()=>createState(base([
 rule('ai',{name:'人工智能导论',teacher:'王老师'}),
 rule('math',{name:'高等数学',teacher:'李老师'}),
 rule('odd',{name:'单周课程',teacher:'甲'}),
]));
const overviewFixture=()=>createState(base([
 rule('english',{name:'大学英语',teacher:'陈老师',weekday:2}),
 rule('lab',{name:'单周实验',teacher:'乙',weekday:2}),
 rule('math',{name:'高等数学',teacher:'李老师',weekday:2}),
]));
const roomsFixture=()=>createState(base(['—','A101','东A101','南A201','实验楼'].map((room,index)=>rule('room-'+index,{name:'物理实验',teacher:'张老师',room,weeks:[1]}))));

test('导出顺序固定：同最小星期/开始时间按课程名拼音序（zh-Hans-CN）', () => {
 const state=rulesFixture(),model=buildRulesModel(state);
 assert.deepEqual(model.courses.map(course=>course.name),['单周课程','高等数学','人工智能导论'],'拼音序 dan < gao < ren；码元序为 人工/单周/高等');
 const text=buildRulesText(state),rows=text.split('\n').filter(line=>line&&!line.startsWith('#')).slice(1);
 assert.deepEqual(rows.map(line=>line.split('\t')[0]),['单周课程','高等数学','人工智能导论'],'TXT 课程行序与模型一致');
});

test('导出顺序固定：同名课程按教师拼音序（码元序与此相反）', () => {
 const state=createState(base([
  rule('t1',{name:'大学英语',teacher:'李老师'}),
  rule('t2',{name:'大学英语',teacher:'杜老师'}),
 ]));
 assert.deepEqual(buildRulesModel(state).courses.map(course=>[course.name,course.teacher]),[['大学英语','杜老师'],['大学英语','李老师']],'拼音 du < li；码元序为 李(U+674E) < 杜(U+675C)');
});

test('导出顺序固定：总览同天同起止卡片按课程名拼音序', () => {
 const state=overviewFixture(),day=buildSemesterOverviewModel(state).days[1];
 assert.deepEqual(day.courses.map(card=>card.name),['大学英语','单周实验','高等数学'],'拼音序 daxue < danzhou < gaodeng');
});

test('导出顺序固定：同一课程多教室按拼音序（含占位符—与拉丁混排）', () => {
 const rooms=buildRulesModel(roomsFixture()).courses[0].rooms;
 assert.deepEqual(rooms,['—','东A101','南A201','实验楼','A101'],'zh collator：— 与汉字在前、拉丁在后；码元序会把 A101 排最前、— 排第二');
});

test('技术键码元序：假条 id 与考试 id 同时间按 UTF-16 码元序（含中文/ASCII 混排）', () => {
 const record=id=>({id,type:'leave',status:'approved',startDate:'2026-09-01',startTime:'08:30',endDate:'2026-09-01',endTime:'09:00'});
 assert.deepEqual(sortLeaveRecords([record('b'),record('a'),record('中')]).map(item=>item.id),['a','b','中'],'码元序 ASCII 在汉字前；拼音序会得到 中/a/b');
 const examSnap={semesterId:'locale-order',semesterStartDate:START,items:[
  {id:'中文考试',date:'2026-09-01',startTime:'19:00',endTime:'20:30',name:'中文考试',week:1},
  {id:'B考试',date:'2026-09-01',startTime:'19:00',endTime:'20:30',name:'B考试',week:1},
 ]};
 const snapshot={...base([]),exams:examSnap};
 assert.deepEqual(examDay(snapshot,'2026-09-01').map(row=>row.name),['B考试','中文考试'],'考试 key=date/exam-id，按 key 码元序：B < 中');
});

test('封闭性：默认 locale 钉为 en-US / 码元序后，导出顺序与 zh-CN 逐项一致', () => {
 const zhEn=new Intl.Collator('en-US'),codeUnit={compare:(a,b)=>a<b?-1:a>b?1:0};
 const capture=()=>({
  rules:buildRulesModel(rulesFixture()).courses.map(course=>[course.name,course.teacher]),
  overview:buildSemesterOverviewModel(overviewFixture()).days.map(day=>day.courses.map(card=>card.name)),
  rooms:buildRulesModel(roomsFixture()).courses[0].rooms,
 });
 const baseline=capture();
 assert.deepEqual(baseline.rules,[['单周课程','甲'],['高等数学','李老师'],['人工智能导论','王老师']]);
 for(const collator of [zhEn,codeUnit]){
  const patched=withDefaultCollation(collator,capture);
  assert.deepEqual(patched,baseline,'生产排序不得再依赖运行环境默认 locale');
 }
});

test('courseSettings 持久化键与默认 locale 无关：normalized 使用 toLowerCase（toLocaleLowerCase 已退役）', () => {
 assert.equal(normalized('I'),'i');
 assert.equal(courseSettingKey({name:'I'}),'i');
 const original=String.prototype.toLocaleLowerCase;
 // 模拟 tr-TR 设备：I→ı。若实现仍用 toLocaleLowerCase，本用例会得到 'ı' 并失败。
 String.prototype.toLocaleLowerCase=function(){
  const lower=original.call(this);
  return String(this).includes('I')?lower.replace(/i/g,'ı'):lower;
 };
 try{
  assert.equal(normalized('I'),'i','courseSettingKey 必须跨设备稳定');
  assert.equal(courseSettingKey({name:'I'}),'i');
 }finally{String.prototype.toLocaleLowerCase=original;}
});

test('静态护栏：web/*.mjs 不再出现 localeCompare / toLocaleLowerCase 调用', () => {
 const dir=new URL('../web/',import.meta.url),files=readdirSync(dir).filter(name=>name.endsWith('.mjs'));
 assert.ok(files.length>20,'web 模块数量异常：'+files.length);
 for(const file of files){
  const source=readFileSync(new URL(file,dir),'utf8');
  assert.doesNotMatch(source,/\.localeCompare\s*\(/,file+' 仍有无显式 locale 的 localeCompare');
  assert.doesNotMatch(source,/toLocaleLowerCase/,file+' 仍有 toLocaleLowerCase');
 }
});
