import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {latestIso,createState,applySnapshot,adoptSchoolSnapshot} from '../web/core.mjs';

const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const snapshot={schemaVersion:1,semester:{name:'2026 秋',startDate:'2026-09-07',weeks:20},rules:[]};

test('latestIso：取较晚的合法时间，坏值不覆盖有效值',()=>{
  assert.equal(latestIso('2026-11-03T20:00:00.000Z','2026-11-03T16:30:00.000Z'),'2026-11-03T20:00:00.000Z');
  assert.equal(latestIso('2026-11-03T16:30:00.000Z','2026-11-03T20:00:00.000Z'),'2026-11-03T20:00:00.000Z');
  assert.equal(latestIso(null,'2026-11-04T00:27:00+08:00'),'2026-11-03T16:27:00.000Z');
  assert.equal(latestIso('2026-11-04T00:27:00+08:00','bad'),'2026-11-03T16:27:00.000Z');
  assert.equal(latestIso('bad',''),null);
  assert.equal(latestIso(null,null),null);
});

test('课表快照同时刷新 lastSuccess 与 courseLastSuccess；新建状态两者为空',()=>{
  const state=createState(snapshot);
  assert.equal(state.lastSuccess,null);
  assert.equal(state.courseLastSuccess,null);
  const applied=applySnapshot(state,snapshot,'2026-11-04T00:27:00.000Z');
  assert.equal(applied.lastSuccess,'2026-11-04T00:27:00.000Z');
  assert.equal(applied.courseLastSuccess,'2026-11-04T00:27:00.000Z');
  const adopted=adoptSchoolSnapshot(state,snapshot,'2026-11-04T00:28:00.000Z');
  assert.equal(adopted.lastSuccess,'2026-11-04T00:28:00.000Z');
  assert.equal(adopted.courseLastSuccess,'2026-11-04T00:28:00.000Z');
});

test('假条刷新只推进 lastSuccess，不冒充课表核对时间',()=>{
  const applied=applySnapshot(createState(snapshot),snapshot,'2026-11-04T00:20:00.000Z');
  const fetchedAt='2026-11-04T00:31:00.000Z';
  const next={...applied,lastSuccess:latestIso(applied.lastSuccess,fetchedAt)||applied.lastSuccess};
  assert.equal(next.lastSuccess,fetchedAt,'页脚/假条卡头时间必须在刷新后推进');
  assert.equal(next.courseLastSuccess,'2026-11-04T00:20:00.000Z','课表最近核对时间不得被假条刷新改写');
});

test('app.mjs 接线：两处假条刷新推进 lastSuccess，课表时间独立、页脚仍用 lastSuccess',()=>{
  assert.match(app,/function latestIso|latestIso\b/);
  assert.match(app,/state\.courseLastSuccess \?\?= state\.lastSuccess \?\? null;/);
  assert.equal((app.match(/state\.lastSuccess=latestIso\(state\.lastSuccess,/g)||[]).length,2,'请假与销假两条刷新路径都要推进 lastSuccess');
  assert.match(app,/数据截至 '\+stamp\(state\.lastSuccess\)/);
  assert.match(app,/if\(!state\.courseLastSuccess\)return pill\('idle','尚未核对'\)/);
  const start=app.indexOf('function leaveUpdatedLabel()');
  const fn=app.slice(start,app.indexOf('\n',start));
  assert.ok(fn.includes('displayState().lastSuccess'),'假条卡头继续使用 lastSuccess（断言不变）');
});
