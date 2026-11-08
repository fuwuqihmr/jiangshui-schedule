import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createState,saveOverride,sourceDay} from '../web/core.mjs';
import {appendScheduleTrace,scheduleDiagnosticLines} from '../web/schedule-diagnostics.mjs';
import {formatDiagnostics,safeDiagnosticLines} from '../web/diagnostics.mjs';

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
