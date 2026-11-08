import test from 'node:test';
import assert from 'node:assert/strict';
import {runNativeSchoolReadBlocked} from './native-school-read-harness.mjs';

test('原生 schoolReadBlocked 行为：请假页可见或附件等待中必须跳过课表读取',()=>{
  const cases=[
    [false,0,false],
    [true,0,true],
    [false,2,true],
    [true,1,true]
  ];
  assert.deepEqual(runNativeSchoolReadBlocked(cases.map(([visible,pending])=>[visible,pending])),cases.map(item=>item[2]));
});
