import test from 'node:test';
import assert from 'node:assert/strict';
import {WEEK_SLOTS,courseWeekRange,weekDayBlocks} from '../web/week-layout.mjs';
import {buildBundle,PERIOD_TIMES} from '../web/jsxsd.mjs';
import {normalizeSchool} from '../web/school.mjs';
import {createState,timetableDay,saveOverride} from '../web/core.mjs';
import {courseOngoing} from '../web/course-time.mjs';
import {exportWeekModel} from '../web/timetable-export.mjs';
const course=(startTime,endTime,id='course')=>({id,startTime,endTime,periods:[1,2]});
test('第1–4节和第3–6节完整占用两个周课表时段',()=>{
 assert.deepEqual(courseWeekRange(course('08:30','11:40')),{start:0,end:1});
 assert.deepEqual(courseWeekRange(course('10:15','15:25')),{start:1,end:2});
 assert.deepEqual(courseWeekRange(course('08:30','17:10')),{start:0,end:3});
});
test('正常课程保持一格，结束边界不多占下一个时段',()=>{
 WEEK_SLOTS.forEach(([, ,start,end],index)=>assert.deepEqual(courseWeekRange(course(start,end)),{start:index,end:index}));
 assert.deepEqual(courseWeekRange(course('08:30','10:15')),{start:0,end:0});
 assert.deepEqual(courseWeekRange(course('10:15','11:00')),{start:1,end:1});
});
test('本地修改和自定义课程依据实际时间跨格，原节次不会限制显示',()=>{
 assert.deepEqual(courseWeekRange({...course('14:30','16:30'),customCourse:true}),{start:2,end:3});
 assert.deepEqual(courseWeekRange(course('19:00','20:30')),{start:4,end:4});
 for(const [start,end,index] of [['07:00','08:00',0],['12:20','13:30',1],['22:00','23:00',4]])
  assert.deepEqual(courseWeekRange(course(start,end)),{start:index,end:index});
});
test('跨节课程只展示一次，下方普通课程仍在自己的时段',()=>{
 const long=course('08:30','11:40','long'),later=course('14:00','15:25','later');
 const blocks=weekDayBlocks([long,later]);
 assert.deepEqual(blocks.map(b=>[b.start,b.end,b.courses.map(r=>r.id)]),[[0,1,['long']],[2,2,['later']],[3,3,[]],[4,4,[]]]);
 assert.strictEqual(blocks[0].courses[0],long);
});
test('多门长课相互连接或重叠时完整保留，空位和取消不会挤掉其他课',()=>{
 const rows=[course('08:30','11:40','long'),{...course('10:15','15:25','cross'),overlap:true},course('10:15','11:40','short'),{...course('14:00','15:25','vacant'),cancelled:true,vacant:true},course('19:00','21:10','night')];
 const before=JSON.stringify(rows),blocks=weekDayBlocks(rows);
 assert.deepEqual(blocks.map(b=>[b.start,b.end]),[[0,2],[3,3],[4,4]]);
 assert.deepEqual(blocks.flatMap(b=>b.courses),rows);assert.equal(JSON.stringify(rows),before);
 assert.deepEqual(blocks.flatMap(b=>Array.from({length:b.end-b.start+1},(_,i)=>b.start+i)),[0,1,2,3,4]);
 assert.equal(weekDayBlocks([]).length,5);
});
test('真实读取链保留第1–4节完整时间，周显示、进行中与导出一致',()=>{
 const bundle=buildBundle([{jx0404id:'long',kc_mc:'测试跨节课程',jg0101mc:'测试教师',sktime:'周一第1-4节{第1周}(全部)',skddmc:'测试教室'}],{monday:'2026-10-12',totalWeeks:2});
 let state=createState(normalizeSchool(bundle));
 let rows=timetableDay(state.snapshot,'2026-10-12');
 assert.deepEqual(rows[0].periods,[1,2,3,4]);assert.equal(rows[0].endTime,'11:40');
 assert.deepEqual(courseWeekRange(rows[0]),{start:0,end:1});
 assert.equal(courseOngoing(rows[0],Date.parse('2026-10-12T11:30:00+08:00')),true);
 assert.equal(exportWeekModel(state,1).days[0].courses[0].endTime,'11:40');
 state=saveOverride(state,rows[0],{startTime:'10:15',endTime:'15:25'});
 rows=timetableDay(state.snapshot,'2026-10-12',state.overrides);
 assert.deepEqual(courseWeekRange(rows[0]),{start:1,end:2});
});

// An independent mapping of school periods to the five rows of the weekly timetable.
const periodBand=[null,0,0,1,1,2,2,3,3,4,4,4];
const allRanges=[];
for(let first=1;first<=11;first++)for(let last=first;last<=11;last++)allRanges.push([first,last]);
for(const [first,last] of allRanges)test(`全部连续节次：第${first}–${last}节读取、显示与完整结束时间`,()=>{
 const periods=Array.from({length:last-first+1},(_,i)=>first+i),startTime=PERIOD_TIMES[first][0],endTime=PERIOD_TIMES[last][1];
 const bundle=buildBundle([{jx0404id:`range-${first}-${last}`,kc_mc:'全节次验证',jg0101mc:'测试教师',sktime:`周一第${first}-${last}节{第1周}(全部)`,skddmc:'测试教室'}],{monday:'2026-10-12',totalWeeks:1});
 const state=createState(normalizeSchool(bundle)),rows=timetableDay(state.snapshot,'2026-10-12');
 assert.equal(rows.length,1);assert.deepEqual(rows[0].periods,periods);
 assert.equal(rows[0].startTime,startTime);assert.equal(rows[0].endTime,endTime);
 const expected={start:periodBand[first],end:periodBand[last]};
 assert.deepEqual(courseWeekRange(rows[0]),expected);
 const blocks=weekDayBlocks(rows),occupied=blocks.filter(b=>b.courses.length);
 assert.equal(occupied.length,1);assert.equal(occupied[0].start,expected.start);assert.equal(occupied[0].end,expected.end);
 assert.strictEqual(occupied[0].courses[0],rows[0]);assert.equal(blocks.flatMap(b=>b.courses).length,1);
 assert.equal(courseOngoing(rows[0],Date.parse(`2026-10-12T${endTime}:00+08:00`)-1000),true);
 assert.equal(exportWeekModel(state,1).days[0].courses[0].endTime,endTime);
 // Local edits use effective time regardless of the original [1,2] period metadata.
 assert.deepEqual(courseWeekRange({...rows[0],periods:[1,2],customCourse:true}),expected);
});
test('全部66种连续课程同时存在时不遗漏、不复制、不修改原数据',()=>{
 const rows=allRanges.map(([first,last])=>course(PERIOD_TIMES[first][0],PERIOD_TIMES[last][1],`${first}-${last}`));
 const before=JSON.stringify(rows),blocks=weekDayBlocks(rows);
 assert.equal(rows.length,66);assert.deepEqual(blocks.flatMap(b=>b.courses),rows);
 assert.deepEqual(blocks.map(b=>[b.start,b.end]),[[0,4]]);assert.equal(JSON.stringify(rows),before);
});
