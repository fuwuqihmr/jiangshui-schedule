import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createState,saveOverride,sourceDay} from '../web/core.mjs';
import {appendScheduleTrace,scheduleDiagnosticLines} from '../web/schedule-diagnostics.mjs';
import {formatDiagnostics,safeDiagnosticLines} from '../web/diagnostics.mjs';
import {normalizeExamList} from '../web/jiaowu-exam.mjs';
import {PERIOD_TIMES} from '../web/jsxsd.mjs';

const sample=JSON.parse(fs.readFileSync(new URL('../web/data/adjusted.json',import.meta.url)));

test('课表诊断记录同步前后时段、来源和本地修改但不导出课程内容',()=>{
  const initial=structuredClone(sample);
  initial.source={...initial.source,kind:'school'};
  initial.rules.push({id:'synthetic-week7-course',name:'私人秘密课程',teacher:'机密教师',room:'临时地点',weekday:3,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'});
  const before={...createState(initial),lastSuccess:'2026-10-13T02:00:00.000Z',lastAttempt:'2026-10-13T02:00:00.000Z'};
  const removed=structuredClone(initial);
  removed.rules=removed.rules.filter(r=>r.id!=='synthetic-week7-course');
  const after={...before,snapshot:removed,lastSuccess:'2026-10-14T03:00:00.000Z',lastAttempt:'2026-10-14T03:00:00.000Z',error:null};
  const traced=appendScheduleTrace(before,after,'foreground','2026-10-14T03:00:00.000Z');
  const edited=saveOverride(traced,sourceDay(removed,'2026-10-14')[0],{room:'临时地点'},'2026-10-14T04:00:00.000Z');
  const lines=scheduleDiagnosticLines(edited,'2026-10-14');
  assert(lines.some(x=>x.includes('日期=2026-10-14')));
  assert(lines.some(x=>x.includes('来源=school')));
  assert(lines.some(x=>x.includes('来源=local')));
  assert(lines.some(x=>x.includes('核对变化=2026-10-14 旧时段=01-02/05-06 新时段=05-06')));
  const text=formatDiagnostics({platform:'android',appVersion:'1.1.9beta1',systemVersion:'11',androidApi:30,events:[]},'',edited);
  assert.match(text,/应用版本：1\.1\.9beta1/);
  assert.doesNotMatch(text,/大学体育|习近平|私人秘密课程|机密教师|临时地点/);
});

test('课表诊断同步历史最多保留12次，事件字段只接受固定状态',()=>{
  let state=createState(sample);
  for(let i=0;i<20;i++)state=appendScheduleTrace(state,state,'foreground',`2026-10-${String(1+i).padStart(2,'0')}T00:00:00.000Z`);
  assert.equal(state.diagnosticSyncHistory.length,12);
  assert.equal(safeDiagnosticLines(['10-14 10:00:00 reader-selection semester=2026-2027-1 mode-known=true calendar-cached=false','10-14 10:00:01 reader-selection semester=bad mode-known=true calendar-cached=false']).length,1);
});

// 考试诊断：只导出计数/时间/来源类别，不导出课程名、考场、教师、座位（样本已脱敏）。
test('考试计入诊断：来源类别 exam、快照行含计数，且不导出考试内容',()=>{
 const initial=structuredClone(sample);
 initial.source={...initial.source,kind:'school'};
 initial.exams=normalizeExamList({code:0,count:2,data:[
  {kssj:'2026-10-12 19:00~20:25',kskcmc:'课程A',kch:'K001',jsxm:'教师甲',js_mc:'考场A',zwh:'777',ksccmc:'场次A'},
  {kssj:'2026-10-13 10:15~11:40',kskcmc:'课程B',kch:'K002',jsxm:'教师乙',js_mc:'考场B',zwh:'778',ksccmc:'场次A'},
 ]},{semesterId:initial.semester.id,semesterStartDate:initial.semester.startDate,totalWeeks:initial.semester.weeks,periodTimes:PERIOD_TIMES,fetchedAt:'2026-11-17T00:00:00.000Z'});
 const state={...createState(initial),lastSuccess:'2026-11-17T00:00:00.000Z',lastAttempt:'2026-11-17T00:00:00.000Z'};
 const lines=scheduleDiagnosticLines(state,'2026-10-12');
 assert(lines.some(line=>line.includes('考试数=2')),'快照行含考试计数');
 assert(lines.some(line=>line.includes('考试截至=2026-11-17T00:00:00Z')),'快照行含考试数据时间');
 assert(lines.some(line=>line.includes('来源=exam')),'考试显示行来源类别为 exam');
 assert(lines.some(line=>line.includes('学校快照内=yes')&&line.includes('来源=exam')),'考试来源判定为学校快照内');
 assert.doesNotMatch(lines.join('\n'),/课程A|课程B|考场A|考场B|教师甲|教师乙|777|778/,'诊断不得导出考试内容或座位号');
 const text=formatDiagnostics({platform:'android',appVersion:'1.4.0-rc1',systemVersion:'16',androidApi:36,events:[]},'',state);
 assert.doesNotMatch(text,/课程A|考场A|777/);
});

test('保留旧考试数据时诊断「考试跳过」使用本轮 lastSkipped 计数并保留分类（P2-R3-2）',()=>{
 const initial=structuredClone(sample);
 initial.source={...initial.source,kind:'school'};
 initial.exams={semesterId:initial.semester.id,semesterStartDate:initial.semester.startDate,fetchedAt:'2026-11-17T00:00:00.000Z',lastAttempt:'2026-11-18T01:00:00.000Z',error:'format',source:'school',items:[{id:'exam-1'}],skipped:[],lastSkipped:[{reason:'time'}]};
 const kept={...createState(initial),lastSuccess:'2026-11-17T00:00:00.000Z',lastAttempt:'2026-11-18T01:00:00.000Z'};
 const lines=scheduleDiagnosticLines(kept,'2026-10-12');
 assert(lines.some(line=>line.includes('考试跳过=1')),'保留旧数据时显示本轮跳过数');
 assert(lines.some(line=>line.includes('考试跳过分类=time=1')),'保留本轮分类计数');
 assert(!lines.some(line=>line.includes('考试跳过=0')),'不能显示旧数据的 0');
 const applied=structuredClone(initial);
 applied.exams={...applied.exams,error:null,lastSkipped:null,skipped:[{reason:'period'},{reason:'duplicate'}]};
 const lines2=scheduleDiagnosticLines(createState(applied),'2026-10-12');
 assert(lines2.some(line=>line.includes('考试跳过=2')&&line.includes('period=1/duplicate=1')),'应用新数据时显示该批分类计数');
});
