import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {PERIOD_TIMES,SEMESTER_MONDAYS,parseWeekList,parseWeekSpec,parseSegments,buildBundle,normalizeJsxsd,supportedSemesters,semesterMapping,semesterCalendarError,semesterMonday} from '../web/jsxsd.mjs';import {addDays,sourceDay,createState,applySnapshot} from '../web/core.mjs';import {normalizeSchool} from '../web/school.mjs';
const MONDAY='2026-08-31';
function rows(){return [
 {kc_mc:'测试课程甲',jg0101mc:'教师甲',sktime:'周二第3、4节{第5-16周}(全部);周四第7、8节{第5-16周}(全部)',skddmc:'B204;B101',jx0404id:'plan-A',kch:'K1'},
 {kc_mc:'测试课程乙',jg0101mc:'教师乙',sktime:'周一第7、8节{第6,8,10,12,14周}(全部)',skddmc:'A103',jx0404id:'plan-B',kch:'K2'},
 {kc_mc:'测试课程丙',jg0101mc:'教师丙',sktime:'周二第1、2节{第7-15周}(全部);周五第7、8节{第5-6周}(全部);周一第7、8节{第6,8,10,12,14周}(全部)',skddmc:'B303;B205;B301',jx0404id:'plan-C',kch:'K3'}
];}
test('周次列表：范围与枚举展开、去重排序',()=>{assert.deepEqual(parseWeekList('第7-15周'),Array.from({length:9},(_,i)=>7+i));assert.deepEqual(parseWeekList('第6,8,10,12,14周'),[6,8,10,12,14]);assert.throws(()=>parseWeekList('第x周'));});
test('上课时间分段：天、节次、周集、地点一一对应',()=>{const s=parseSegments('周二第3、4节{第5-16周}(全部);周四第7、8节{第5-16周}(全部)','B204;B101');assert.equal(s.length,2);assert.deepEqual(s[0],{day:2,first:3,last:4,weeks:Array.from({length:12},(_,i)=>5+i),room:'B204',classWeek:'5-16'});assert.equal(s[1].day,4);assert.equal(s[1].room,'B101');});
test('单周和双周括号限定周次，区间外的周不显示',()=>{
 const odd=parseSegments('周三第5-6节{第5-10周}(单周)','南C201')[0];
 const even=parseSegments('周四第5-6节{第5-10周}(双周)','南C202')[0];
 assert.deepEqual(odd.weeks,[5,7,9]);assert.equal(odd.weekPattern,'odd');assert.equal(parseWeekSpec('第5-10周(单周)').pattern,'odd');
 assert.deepEqual(even.weeks,[6,8,10]);assert.equal(even.weekPattern,'even');assert.equal(parseWeekSpec('第5-10周(双周)').pattern,'even');
 assert.deepEqual(parseSegments('周一第1-2节{第5-10周（单周）}','A101')[0].weeks,[5,7,9]);
 assert.deepEqual(parseSegments('周一第1-2节{第5-10周}(双周)','A101')[0].weeks,[6,8,10]);
 assert.deepEqual(parseSegments('周一第1-2节{第5-10周}(全部)','A101')[0].weeks,[5,6,7,8,9,10]);
 assert.deepEqual(parseWeekList('第5-10周（单周）'),[5,7,9]);
 assert.deepEqual(parseWeekList('第5-10周(双周)'),[6,8,10]);
 assert.throws(()=>parseSegments('周一第1-2节{第5-10周}(单周)(双周)','A101'));
 assert.throws(()=>parseSegments('周一第1-2节{第5-10周}(未知)','A101'));
});
test('Android 实际采用课表路径按单周/双周生成，重新同步会移除旧的每周误排',()=>{
 const allWeeks={...rows()[0],jx0404id:'sync-parity-course',kc_mc:'单双周待修复课程',sktime:'周三第5-6节{第5-10周}(全部)',skddmc:'南C201'};
 const corrected={...allWeeks,sktime:'周三第5-6节{第5-10周}(单周)'};
 const opts={monday:MONDAY,totalWeeks:12,semesterId:'2026-2027-1'};
 const before=normalizeSchool(buildBundle([allWeeks],opts));
 const after=normalizeSchool(buildBundle([corrected],opts));
 const dateFor=week=>addDays(MONDAY,(week-1)*7+2);
 const refreshed=applySnapshot(createState(before),after,'2026-10-17T00:00:00.000Z');
 for(const week of [5,6,7,8,9,10])
  assert.equal(sourceDay(after,dateFor(week)).some(r=>r.name==='单双周待修复课程'),week%2===1,`第${week}周的学校导入结果`);
 assert.equal(sourceDay(refreshed.snapshot,dateFor(6)).length,0,'重新读取后，原来误显示的双周课程应被清除');
 assert.equal(sourceDay(refreshed.snapshot,dateFor(5)).length,1,'应保留单周课程');
});
test('单双周从学校原始行一路保留到最终日课表',()=>{
 const input=[
  {...rows()[0],jx0404id:'odd-course',kc_mc:'单周课程',sktime:'周三第5-6节{第5-10周}(单周)',skddmc:'南C201'},
  {...rows()[0],jx0404id:'even-course',kc_mc:'双周课程',sktime:'周四第5-6节{第5-10周}(双周)',skddmc:'南C202'}
 ];
 const snapshot=normalizeJsxsd(input,{monday:MONDAY,totalWeeks:12});
 const dateFor=(week,day)=>addDays(MONDAY,(week-1)*7+day-1);
 for(const week of [5,6,7,8,9,10]){
  const wed=sourceDay(snapshot,dateFor(week,3)).map(r=>r.name);
  const thu=sourceDay(snapshot,dateFor(week,4)).map(r=>r.name);
  assert.equal(wed.includes('单周课程'),week%2===1,`第${week}周的单周课程`);
  assert.equal(thu.includes('双周课程'),week%2===0,`第${week}周的双周课程`);
 }
 assert.equal(sourceDay(snapshot,dateFor(4,3)).some(r=>r.name==='单周课程'),false);
 assert.equal(sourceDay(snapshot,dateFor(11,4)).some(r=>r.name==='双周课程'),false);
});
test('实机错误格式：第1-4节及混合周次范围可导入，多节、单节、夜课均有正确时间',()=>{
 const exact='周日第1-4节{第2,6-12周}(全部)';
 const ranged=parseSegments(exact,'A101')[0];
 assert.deepEqual([ranged.day,ranged.first,ranged.last,ranged.weeks],[7,1,4,[2,6,7,8,9,10,11,12]]);
 const variants=['周一第9、10、11节{第2,6-12周}(全部)','周一第9-11节{第2,6-12周}(全部)','周一第9,10,11节{第2,6-12周}(全部)','周一第9～11节{第2,6-12周}(全部)','周一第11节{第2,6-12周}(全部)'];
 for(const text of variants){const segment=parseSegments(text,'晚课教室')[0];assert.equal(segment.first,text.includes('第11节')?11:9);assert.equal(segment.last,11);}
 const fifteen=rows().concat(Array.from({length:12},(_,n)=>({...rows()[0],jx0404id:'real-range-'+n,kc_mc:'综合课程'+n,sktime:n%2?exact:'周一第9-11节{第2,6-12周}(全部)',skddmc:'A101'})));
 const snapshot=normalizeJsxsd(fifteen,{monday:MONDAY,totalWeeks:25,semesterId:'2026-2027-1'});
 const sunday=sourceDay(snapshot,'2026-10-11').find(r=>r.id==='jsxsd-real-range-1-7-1-4-0');
 assert.ok(sunday);assert.deepEqual(sunday.periods,[1,2,3,4]);assert.equal(sunday.endTime,'11:40');
 const monday=sourceDay(snapshot,'2026-10-12').find(r=>r.id==='jsxsd-real-range-0-1-9-11-0');
 assert.ok(monday);assert.deepEqual([monday.startTime,monday.endTime],['19:00','21:10']);
});
test('bundle 展开：周次×日期×节次一一就位',()=>{const b=buildBundle(rows(),{monday:MONDAY,totalWeeks:25});assert.equal(b.weeks.length,25);const w5=b.weeks[4];assert.equal(w5.week,5);assert.equal(w5.date.length,7);assert.equal(w5.date[1].mxrq,addDays(MONDAY,(5-1)*7+1));const tue34=w5.item.find(i=>i.classTime==='20304'&&i.courseName==='测试课程甲');assert.ok(tue34,'第5周周二3、4节应有课程甲');assert.equal(tue34.location,'B204');assert.equal(tue34.startTime,'10:15');assert.equal(tue34.endTIme,'11:40');assert.equal(w5.date[0].mxrq,addDays(MONDAY,(5-1)*7));});
test('normalizeJsxsd 产出合法快照并按真实日期展开',()=>{const s=normalizeJsxsd(rows(),{monday:MONDAY,totalWeeks:25,semesterId:'2026-2027-1',sourceLabel:'学校教务系统 · 本机读取'});assert.equal(s.semester.startDate,MONDAY);assert.equal(s.semester.weeks,25);assert.equal(s.source.kind,'school');const d=addDays(MONDAY,(5-1)*7+1);const list=sourceDay(s,d);const a=list.find(r=>r.name==='测试课程甲');assert.ok(a);assert.equal(a.room,'B204');const w16=addDays(MONDAY,(16-1)*7+1);const l16=sourceDay(s,w16);assert.equal(l16.find(r=>r.name==='测试课程甲').room,'B204');});
test('畸形数据与空学期一律拒绝',()=>{const bad=rows();bad[0].sktime='乱七八糟';assert.throws(()=>buildBundle(bad,{monday:MONDAY,totalWeeks:25}));assert.throws(()=>buildBundle([],{monday:MONDAY,totalWeeks:25}));const bad2=rows();bad2[1].kc_mc='';assert.throws(()=>buildBundle(bad2,{monday:MONDAY,totalWeeks:25}));});
test('超出教学周的周次被忽略，不污染快照',()=>{const r=rows();r[0].sktime='周二第3、4节{第20-30周}(全部)';const b=buildBundle(r,{monday:MONDAY,totalWeeks:25});const w20=b.weeks[19];assert.ok(w20.item.find(i=>i.classTime==='20304'&&i.courseName==='测试课程甲'));const w26=b.weeks.length===25;assert.ok(w26,'周表仍为 25 周');});
test('按教务处完整第1–11节作息换算，不把第11节算成晚自习时间',()=>{
 const official=[['08:30','09:10'],['09:15','09:55'],['10:15','10:55'],['11:00','11:40'],['14:00','14:40'],['14:45','15:25'],['15:45','16:25'],['16:30','17:10'],['19:00','19:40'],['19:45','20:25'],['20:30','21:10']];
 for(let p=1;p<=11;p++)assert.deepEqual(PERIOD_TIMES[p],official[p-1],`第${p}节`);
 const nightly=[{...rows()[0],sktime:'周一第9、10、11节{第5-6周}(全部);周四第11节{第5-6周}(全部)',skddmc:'A101;B202'}];
 const bundle=buildBundle(nightly,{monday:MONDAY,totalWeeks:25});
 const triple=bundle.weeks[4].item.find(r=>r.classTime==='10911'),single=bundle.weeks[4].item.find(r=>r.classTime==='41111');
 assert.deepEqual([triple.startTime,triple.endTIme],['19:00','21:10']);
 assert.deepEqual([single.startTime,single.endTIme],['20:30','21:10']);
 const snapshot=normalizeJsxsd(nightly,{monday:MONDAY,totalWeeks:25,semesterId:'2026-2027-1'});
 assert.deepEqual(sourceDay(snapshot,'2026-09-28')[0].periods,[9,10,11]);
 assert.deepEqual(sourceDay(snapshot,'2026-10-01')[0].periods,[11]);
});
test('未公布的晚间节次不猜测时间，报告缺少第几节并保留原课表',()=>{
 const late=[{...rows()[0],sktime:'周二第11、12节{第5-6周}(全部)'}];
 assert.throws(()=>buildBundle(late,{monday:MONDAY,totalWeeks:25}),/第11–12节缺少有效上课时间/);
});

test('19:00–20:25 第9、10节晚课与只给周次的实习课能一起完整导入',()=>{
 const input=[{...rows()[0],jx0404id:'night-pair',sktime:'周三第9、10节{第4-16周}(全部)',skddmc:'B102'},
 {...rows()[0],jx0404id:'internship',kc_mc:'认识实习（应急管理）',sktime:'第4周',skddmc:''},
 {...rows()[0],jx0404id:'pending',kc_mc:'等待安排的课程',sktime:null,skddmc:''}];
 const snapshot=normalizeJsxsd(input,{monday:MONDAY,totalWeeks:25});
 assert.deepEqual([snapshot.rules[0].startTime,snapshot.rules[0].endTime],['19:00','20:25']);
 assert.equal(snapshot.unscheduled.length,2);assert.deepEqual(snapshot.unscheduled[0].weeks,[4]);assert.equal(snapshot.unscheduled[0].name,'认识实习（应急管理）');
 assert.equal(sourceDay(snapshot,'2026-09-23').length,1);
 const bundle=buildBundle(input,{monday:MONDAY,totalWeeks:25});assert.equal(bundle.unscheduled.length,2);
});
test('同门课程有已排时段与未排时段时保留两部分，仍拒绝未知的非空时间格式',()=>{
 const input=[{...rows()[0],sktime:'周三第9-10节{第4-16周}(全部);{第4周}(全部)',skddmc:'A101;B202'}];
 const snapshot=normalizeJsxsd(input,{monday:MONDAY,totalWeeks:25});assert.equal(snapshot.rules.length,1);assert.equal(snapshot.unscheduled.length,1);assert.equal(snapshot.unscheduled[0].room,'B202');
 for(const value of ['周三第9xx节{第4周}','第四周',[],42])assert.throws(()=>buildBundle([{...input[0],sktime:value}],{monday:MONDAY,totalWeeks:25}));
 assert.throws(()=>buildBundle([{...input[0],sktime:''}],{monday:MONDAY,totalWeeks:25}),/全学期无课程/);
});

// ── B1（1.5.0 决策 D-4）学期日历映射：可操作提示、诊断字段与维护流程 ─────────────
test('已登记学期不受影响：映射命中，buildBundle/normalizeJsxsd 与显式周一结果一致',()=>{
 assert.ok(supportedSemesters().includes('2026-2027-1'),'已实测学期必须保留在登记表');
 assert.deepEqual(supportedSemesters(),Object.keys(SEMESTER_MONDAYS),'诊断列表与登记表同源');
 assert.deepEqual(semesterMapping('2026-2027-1'),{semesterId:'2026-2027-1',registered:true,known:true,monday:MONDAY,supported:Object.keys(SEMESTER_MONDAYS)});
 assert.equal(semesterMonday('2026-2027-1'),MONDAY);
 assert.equal(semesterMonday(' 2026-2027-1 '),MONDAY,'首尾空白不影响命中');
 assert.deepEqual(buildBundle(rows(),{monday:semesterMonday('2026-2027-1'),totalWeeks:25,semesterId:'2026-2027-1'}),buildBundle(rows(),{monday:MONDAY,totalWeeks:25,semesterId:'2026-2027-1'}),'经映射解析与显式周一完全一致');
 const viaMapping=normalizeJsxsd(rows(),{monday:semesterMonday('2026-2027-1'),totalWeeks:25,semesterId:'2026-2027-1'});
 assert.equal(viaMapping.semester.startDate,MONDAY);
 assert.equal(viaMapping.semester.weeks,25);
 assert.deepEqual(sourceDay(viaMapping,'2026-10-13').map(r=>r.name).sort(),sourceDay(normalizeJsxsd(rows(),{monday:MONDAY,totalWeeks:25,semesterId:'2026-2027-1'}),'2026-10-13').map(r=>r.name).sort());
});

test('未登记学期：错误升级为可操作提示（说明未登记 + 补映射位置 + 已支持学期 + 维护流程），旧文案不再出现',()=>{
 for(const semesterId of ['2026-2027-2','2027-2028-1']){
  const error=semesterCalendarError(semesterId);
  assert.equal(error.code,'semester-calendar');
  assert.deepEqual(error.mapping,{semesterId,registered:false,known:false,monday:null,supported:Object.keys(SEMESTER_MONDAYS)});
  assert.ok(error.message.includes('当前已支持学期：'+Object.keys(SEMESTER_MONDAYS).map(id=>id+'（第一周 '+SEMESTER_MONDAYS[id]+'）').join('、')),'提示必须列出全部已支持学期');
  for(const fragment of ['该学期尚未登记日历映射','学期 ID：'+semesterId,'已保留旧课表','web/jsxsd.mjs 的 SEMESTER_MONDAYS','补充该学期第一周周一（YYYY-MM-DD 且为周一）','node --test tests/jsxsd.test.mjs'])
   assert.ok(error.message.includes(fragment),'可操作提示缺少「'+fragment+'」：'+error.message);
  assert.equal(error.message.includes('学期开始日期未知'),false,'不得回退为无从下手的旧文案');
  assert.throws(()=>semesterMonday(semesterId),thrown=>thrown.code==='semester-calendar'&&thrown.message===error.message);
 }
});

test('登记值不是合法周一时按未命中处理，并提示修正（防御维护失误）',()=>{
 const id='2099-2100-1';
 SEMESTER_MONDAYS[id]='2099-09-01'; // 周二，非法
 try{
  assert.equal(semesterMapping(id).registered,true);
  assert.equal(semesterMapping(id).known,false);
  const error=semesterCalendarError(id);
  assert.match(error.message,/该学期已登记但日历映射无效/);
  assert.match(error.message,/修正该学期第一周周一/);
  assert.throws(()=>semesterMonday(id),/登记值必须是 YYYY-MM-DD 且为周一/);
 }finally{delete SEMESTER_MONDAYS[id];}
 assert.equal(semesterMapping(id).registered,false,'测试后恢复登记表');
});

test('buildBundle 学期起始缺失/非法分别给出可操作提示，未映射时不臆造日期',()=>{
 assert.throws(()=>buildBundle(rows(),{totalWeeks:25,semesterId:'2026-2027-2'}),error=>error.code==='semester-calendar'&&error.message.includes('SEMESTER_MONDAYS'));
 assert.throws(()=>buildBundle(rows(),{totalWeeks:25}),error=>error.code==='semester-calendar'&&error.message.includes('未提供学期 ID'));
 assert.throws(()=>buildBundle(rows(),{monday:'2026-09-01',totalWeeks:25,semesterId:'2026-2027-1'}),/学期开始日期无效：第一周周一必须是周一/);
 assert.throws(()=>buildBundle(rows(),{monday:'',totalWeeks:25,semesterId:'2026-2027-2'}),error=>error.code==='semester-calendar');
 assert.equal(buildBundle(rows(),{monday:MONDAY,totalWeeks:25,semesterId:'2026-2027-1'}).weeks.length,25,'已登记学期照常生成');
});

test('诊断字段 semesterMapping：当前学期、登记与命中、已支持学期，且从不抛错',()=>{
 const supported=Object.keys(SEMESTER_MONDAYS);
 assert.deepEqual(semesterMapping('2026-2027-2'),{semesterId:'2026-2027-2',registered:false,known:false,monday:null,supported});
 assert.deepEqual(semesterMapping(null),{semesterId:'',registered:false,known:false,monday:null,supported});
 assert.equal(semesterMapping(undefined).semesterId,'');
 assert.equal(semesterMapping(undefined).known,false);
 assert.equal(semesterMapping(42).registered,false);
 assert.equal(semesterMapping('2026-2027-1').known,true);
 assert.equal(semesterMapping('2026-2027-1').monday,MONDAY);
});

test('应用接线：读取结果先解析学期映射再应用快照；未映射失败不替换旧课表',()=>{
 const old=createState(normalizeSchool(buildBundle(rows(),{monday:MONDAY,totalWeeks:25,semesterId:'2026-2027-1'})));
 const snapshotBefore=old.snapshot;
 const beforeDay=sourceDay(old.snapshot,'2026-10-13').length;
 // 与 app.mjs readSchool 相同顺序：先 semesterMonday()，再 buildBundle/normalizeSchool，最后才 applySnapshot
 const applyRead=result=>applySnapshot(old,normalizeSchool(buildBundle(result.rows,{monday:semesterMonday(result.semesterId),totalWeeks:result.totalWeeks,semesterId:result.semesterId})));
 assert.throws(()=>applyRead({semesterId:'2026-2027-2',totalWeeks:25,rows:rows()}),error=>error.code==='semester-calendar');
 assert.equal(old.snapshot,snapshotBefore,'导入失败必须原样保留旧课表快照');
 assert.equal(sourceDay(old.snapshot,'2026-10-13').length,beforeDay,'旧课表内容不变');
 const next=applyRead({semesterId:'2026-2027-1',totalWeeks:25,rows:rows()});
 assert.equal(next.snapshot.semester.startDate,MONDAY,'已登记学期同路径可正常更新');
 assert.notEqual(next.snapshot,snapshotBefore);

 // app.mjs 接线（app.mjs 依赖 DOM，无法 import，此处按仓库既有做法做源码断言）
 const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
 assert.ok(app.includes("import {buildBundle,SEMESTER_MONDAYS,semesterMonday,PERIOD_TIMES} from './jsxsd.mjs';"),'import 行应引入可操作映射解析');
 assert.ok(app.includes('monday:semesterMonday(result.semesterId)'),'导入前必须走可操作映射解析');
 assert.equal(app.includes('SEMESTER_MONDAYS[result.semesterId]'),false,'不得回退到原始表查找');
 assert.ok(app.includes("e.code==='semester-calendar'?(e.mapping?.registered?'该学期日历映射无效':'该学期尚未登记日历映射')"),'失败状态条展示可操作标题');
 const readSchool=/async function readSchool\([\s\S]*?\n\}/.exec(app)?.[0]||'';
 assert.ok(readSchool.length>0,'找不到 readSchool');
 assert.ok(readSchool.indexOf('semesterMonday(result.semesterId)')<readSchool.indexOf('applySnapshot(state,result.snapshot)'),'必须先解析映射再应用快照（失败才能保留旧课表）');
 assert.ok(app.includes('function semesterCalendarStat(){'),'设置页诊断字段');
 assert.ok(app.includes("' · 日历映射已登记（第一周 '"),'诊断行展示映射命中');
 assert.ok(app.includes("'日历映射未登记 · 第一周 '"),'诊断行展示未登记');
});
