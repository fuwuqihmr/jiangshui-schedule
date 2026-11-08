import test from 'node:test';
import assert from 'node:assert/strict';
import {runNativeLeaveStatus} from './native-leave-status-harness.mjs';

test('原生 leaveStatus 行为：真实编译执行，否定优先且文本缺失不猜',()=>{
  const cases=[
    ['未通过',''],['不通过','2'],['未批准',''],['未同意','2'],['未审核通过',''],
    ['已通过',''],['审批通过','9'],['待审批','2'],['审批中',''],
    ['驳回','2'],['','2'],['未知状态','2']
  ];
  const expected=['rejected','rejected','rejected','rejected','rejected',
    'approved','approved','pending','pending','rejected','unknown','unknown'];
  assert.deepEqual(runNativeLeaveStatus(cases),expected);
});
