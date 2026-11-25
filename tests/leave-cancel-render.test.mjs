import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeLeaveRecord,visibleLeaveRecords,leaveCancelState} from '../web/leave-status.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const leave=(extra={})=>normalizeLeaveRecord({id:'leave-1',type:'leave',status:'approved',number:'L1',startDate:'2026-10-01',startTime:'08:00',endDate:'2026-10-01',endTime:'09:00',...extra});
const cancel=(id,status,number='L1')=>normalizeLeaveRecord({id,type:'cancel',status,number,startDate:'',startTime:'',endDate:'',endTime:''});

test('列表只渲染请假/续假，销假记录不得单独占一行',()=>{
  const records=[leave(),cancel('cancel-1','approved'),normalizeLeaveRecord({id:'renew-1',type:'renew',status:'pending',number:'L1',startDate:'2026-10-02',startTime:'08:00',endDate:'2026-10-02',endTime:'09:00'})];
  assert.deepEqual(visibleLeaveRecords(records).map(record=>record.id),['leave-1','renew-1']);
  assert.deepEqual(visibleLeaveRecords([cancel('cancel-2','pending')]),[]);
  assert.deepEqual(visibleLeaveRecords(null),[]);
  assert.deepEqual(visibleLeaveRecords([null,undefined,cancel('cancel-3','approved')]),[]);
});

test('销假只作为对应请假编号的状态，仍用全量记录关联',()=>{
  const approved=cancel('cancel-1','approved');
  const pending=cancel('cancel-2','pending');
  assert.equal(leaveCancelState(leave(),[approved],{now:Date.parse('2026-10-02T00:00:00+08:00'),fresh:true}).state,'cancelled');
  assert.equal(leaveCancelState(leave(),[pending],{now:Date.parse('2026-10-02T00:00:00+08:00'),fresh:true}).state,'canceling');
  assert.equal(leaveCancelState(leave(),[approved],{now:Date.parse('2026-10-02T00:00:00+08:00'),fresh:true}).record.id,'cancel-1');
});

test('变更记录页、假条面板与查看全部都经过同一个可见性过滤',()=>{
  const app=readFileSync(path.join(root,'web/app.mjs'),'utf8');
  assert.match(app,/import \{[^}]*visibleLeaveRecords[^}]*\} from '\.\/leave-status\.mjs'/,'必须复用过滤函数');
  assert.match(app,/function visibleLeaveRecordsForUi\(records\)/);
  assert.match(app,/function renderLeavePageContent\(\)\{const records=sortLeaveRecords\(visibleLeaveRecordsForUi\(leaveView\.records\)\);/);
  assert.match(app,/function renderLeaveStatusPanel\(date=null\)\{[\s\S]{0,400}const visible=visibleLeaveRecordsForUi\(all\);/);
  assert.match(app,/function leaveAllBody\(\)\{[\s\S]{0,400}const records=sortLeaveRecords\(visibleLeaveRecordsForUi\(leaveView\.records\)\);/);
  assert.match(app,/console\.warn/);
  assert.match(app,/leave cancel records hidden/);
});
