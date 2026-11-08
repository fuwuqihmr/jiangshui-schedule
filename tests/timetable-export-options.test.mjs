import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createState,addDays,timetableDay,saveOverride} from '../web/core.mjs';
import {saveCustomCourse} from '../web/custom-courses.mjs';
import {withStudyPolicy} from '../web/study.mjs';
import {formatWeekParts,formatWeekSpec,occurrencePeriods,buildSemesterOverviewModel,renderSemesterOverviewPages,buildRulesModel,buildRulesText,semesterOccurrences,createTimetableExport} from '../web/timetable-export.mjs';
const require=createRequire(import.meta.url),{decodeExport}=require('../desktop/export-file.cjs');
const calendar=JSON.parse(readFileSync(new URL('../web/data/holidays.json',import.meta.url),'utf8'));
const START='2026-08-31',WEEKS=16;
const base=(rules=[],extra={})=>({schemaVersion:1,semester:{id:'test-term',name:'测试学期',startDate:START,weeks:WEEKS},rules,exceptions:[],remaps:[],closedDates:[],unscheduled:[],...extra});
// 第 week 周、星期 weekday（1=周一）的日期。
const dayOf=(weekday,week=1)=>addDays(START,(week-1)*7+weekday-1);
const rule=(id,extra={})=>({id,name:'课程'+id,teacher:'老师'+id,room:'A101',weekday:1,weeks:[1,2,3],periods:[1,2],startTime:'08:30',endTime:'09:55',...extra});
const allCards=model=>model.days.flatMap(day=>day.courses);
// B 恒为单张图片：Node 里用假 canvas 走真实 createTimetableExport 路径，校验只编码
// 一张 2520 宽、动态高度 1782..4096 的 PNG；真实浏览器画布由 Electron e2e 覆盖。
function overviewCanvasRecorder(){
 const record={encoded:[],texts:[]};
 const createCanvas=()=>{
  const canvas={width:0,height:0};
  canvas.getContext=()=>{
   const ctx={textBaseline:'',font:'',fillStyle:'',strokeStyle:'',lineWidth:1};
   ctx.measureText=text=>{const size=Number((/(\d+(?:\.\d+)?)px/.exec(ctx.font)||[])[1]||24);let width=0;for(const character of String(text))width+=character.charCodeAt(0)<256?size*.55:size;return {width};};
   ctx.fillText=text=>record.texts.push(String(text));
   ctx.fillRect=()=>{};ctx.strokeRect=()=>{};ctx.beginPath=()=>{};ctx.moveTo=()=>{};ctx.lineTo=()=>{};ctx.stroke=()=>{};
   ctx.save=()=>{};ctx.restore=()=>{};ctx.scale=()=>{};ctx.translate=()=>{};ctx.setTransform=()=>{};
   return ctx;
  };
  canvas.toBlob=(callback,type='image/png')=>{record.encoded.push({type,width:canvas.width,height:canvas.height});callback(new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type}));};
  return canvas;
 };
 return {record,createCanvas};
}
async function exportOverview(state){
 const {record,createCanvas}=overviewCanvasRecorder(),previous=globalThis.document;
 globalThis.document={createElement:()=>createCanvas()};
 try{const output=await createTimetableExport(state,{kind:'semester-overview',yieldPage:()=>Promise.resolve()});return {output,record};}
 finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
}

test('周次压缩：连续区间、单双周、离散枚举与过滤边界',()=>{
 const cases=[
  [[7,8,9,10,11,12,13,14,15],'第7-15周','全部','第7-15周(全部)'],
  [[7,9,11,13,15],'第7-15周','单周','第7-15周(单周)'],
  [[6,8,10,12,14],'第6-14周','双周','第6-14周(双周)'],
  [[7,9,13,15],'第7、9、13、15周','全部','第7、9、13、15周(全部)'],
  [[1,2,3,5,6,7,9,11,13],'第1-3、5-7、9、11、13周','全部','第1-3、5-7、9、11、13周(全部)'],
  [[7],'第7周','全部','第7周(全部)'],
  [[7,9],'第7、9周','全部','第7、9周(全部)'],
  [[],'', '全部',''],
  [[0,19],'','全部',''],
  [[3,3,2,2,1],'第1-3周','全部','第1-3周(全部)']
 ];
 for(const [weeks,text,pattern,spec] of cases){
  assert.deepEqual(formatWeekParts(weeks,18),{text,pattern},`formatWeekParts(${JSON.stringify(weeks)})`);
  assert.equal(formatWeekSpec(weeks,18),spec,`formatWeekSpec(${JSON.stringify(weeks)})`);
 }
 assert.deepEqual(formatWeekParts([1,2,3],1),{text:'第1周',pattern:'全部'});
 assert.equal(formatWeekSpec([1,2,3],1),'第1周(全部)');
 assert.notEqual(formatWeekSpec([7,9,11,13,15],18),'第7-15周(全部)','单周课程不能被写成每周');
 assert.equal(formatWeekSpec([6,8,10,12],18),'第6-12周(双周)','≥3 周且全偶才压缩为双周');
 assert.equal(formatWeekSpec([5,6,7],18),'第5-7周(全部)','连续周次优先于单双周');
});

test('节次从最终时间推导：空 periods、过期 periods 与深夜非标准时段',()=>{
 assert.deepEqual(occurrencePeriods({startTime:'08:30',endTime:'09:55',periods:[]}),[1,2]);
 assert.deepEqual(occurrencePeriods({startTime:'10:15',endTime:'11:40',periods:[1,2]}),[3,4]);
 assert.deepEqual(occurrencePeriods({startTime:'19:10',endTime:'21:10',periods:[]}),[9,10,11]);
 assert.deepEqual(occurrencePeriods({startTime:'21:40',endTime:'22:20',periods:[]}),[]);
 assert.deepEqual(occurrencePeriods({startTime:'07:10',endTime:'08:00',periods:[]}),[],'早于第1节时不臆造节次');
 assert.deepEqual(occurrencePeriods({startTime:'09:15',endTime:'09:55'}),[2]);
});

test('B 总览：同一门课多时段各一张卡，连续周次合并',()=>{
 const state=createState(base([
  rule('math-mon',{name:'高等数学',teacher:'李老师',room:'B204',weekday:1,weeks:Array.from({length:16},(_,i)=>i+1),periods:[1,2],startTime:'08:30',endTime:'09:55'}),
  rule('math-wed',{name:'高等数学',teacher:'李老师',room:'B204',weekday:3,weeks:Array.from({length:8},(_,i)=>i+1),periods:[3,4],startTime:'10:15',endTime:'11:40'}),
  rule('english',{name:'大学英语',teacher:'陈老师',room:'南A301',weekday:2,weeks:Array.from({length:16},(_,i)=>i+1),periods:[5,6],startTime:'14:00',endTime:'15:25'})
 ]));
 const before=JSON.stringify(state),model=buildSemesterOverviewModel(state),cards=allCards(model).filter(c=>c.name==='高等数学');
 assert.equal(model.kind,'semester-overview');assert.equal(model.totalWeeks,16);
 assert.equal(model.days.length,7);assert.deepEqual(model.days.map(d=>d.weekday),[1,2,3,4,5,6,7]);
 assert.equal(cards.length,2,'同一门课两个时段应各一张卡');
 const monday=cards.find(c=>c.weekday===1),wednesday=cards.find(c=>c.weekday===3);
 assert.equal(monday.startTime,'08:30');assert.deepEqual(monday.weeks,Array.from({length:16},(_,i)=>i+1));
 assert.equal(wednesday.startTime,'10:15');assert.deepEqual(wednesday.weeks,[1,2,3,4,5,6,7,8]);
 assert.equal(formatWeekSpec(monday.weeks,16),'第1-16周(全部)');
 assert.equal(JSON.stringify(state),before,'导出模型不得修改状态');
});

test('B 总览：单日换教室拆成两张卡，周次各归各位',()=>{
 let state=createState(base([rule('physics',{name:'大学物理',teacher:'赵老师',room:'北B102',weekday:4,weeks:Array.from({length:16},(_,i)=>i+1),periods:[7,8],startTime:'15:45',endTime:'17:10'})]));
 const row=timetableDay(state.snapshot,dayOf(4,4),state.overrides,state.localMaps,state.courseSettings,state.customCourses,state.holidaySettings).find(r=>r.name==='大学物理');
 state=saveOverride(state,row,{room:'北B203'});
 const cards=allCards(buildSemesterOverviewModel(state)).filter(c=>c.name==='大学物理');
 assert.equal(cards.length,2);
 assert.deepEqual(cards.find(c=>c.room==='北B102').weeks,[1,2,3,5,6,7,8,9,10,11,12,13,14,15,16]);
 assert.deepEqual(cards.find(c=>c.room==='北B203').weeks,[4]);
 assert.equal(cards.find(c=>c.room==='北B203').override,true);
});

test('B 总览：同步重叠保留双方、跨节只算一次、调休改到实际上课星期',()=>{
 const rules=[
  rule('a',{name:'重叠甲',teacher:'甲',room:'A1',weekday:5,weeks:[1,2],periods:[1,2],startTime:'08:30',endTime:'09:55'}),
  rule('b',{name:'重叠乙',teacher:'乙',room:'A2',weekday:5,weeks:[1,2],periods:[1,2],startTime:'08:30',endTime:'09:55'}),
  rule('lab',{name:'程序设计实验',teacher:'张老师',room:'计算机实验室',weekday:4,weeks:[10,11,12,13,14],periods:[9,10,11],startTime:'19:10',endTime:'21:10'}),
  rule('remapped',{name:'调休课程',teacher:'李老师',room:'A101',weekday:1,weeks:[7,8,9],periods:[3,4],startTime:'10:15',endTime:'11:40'})
 ];
 let state=createState(base(rules));
 const both=allCards(buildSemesterOverviewModel(state)).filter(c=>['重叠甲','重叠乙'].includes(c.name));
 assert.equal(both.length,2);assert(both.every(c=>c.overlap===true),'同格重叠双方都要保留并标重叠');
 assert.equal(both.find(c=>c.name==='重叠甲').weeks.length,2);
 const labCards=allCards(buildSemesterOverviewModel(state)).filter(c=>c.name==='程序设计实验');
 assert.equal(labCards.length,1,'跨节课程只出现一次');assert.equal(labCards[0].startTime,'19:10');assert.equal(labCards[0].endTime,'21:10');
 assert.deepEqual(labCards[0].weeks,[10,11,12,13,14]);
 state.localMaps=[{id:'move',date:dayOf(6,8),fromDate:dayOf(1,8),mode:'replace'}];
 const moved=allCards(buildSemesterOverviewModel(state)).filter(c=>c.name==='调休课程');
 assert.equal(moved.length,2,'调休后原星期与目标星期各一张卡');
 assert.deepEqual(moved.find(c=>c.weekday===1).weeks,[7,9]);
 assert.deepEqual(moved.find(c=>c.weekday===6).weeks,[8]);
 assert.equal(moved.find(c=>c.weekday===6).remap,true);
 const occurrences=semesterOccurrences(state).filter(o=>o.name==='调休课程');
 assert.equal(occurrences.length,3,'调休不丢失也不重复计数');
 assert(occurrences.every(o=>o.weekday===1&&o.week!==8||o.weekday===6&&o.week===8));
});

test('B 总览：自定义课程、晚自习与来源冲突都进入结果',()=>{
 let state=createState(base([rule('school',{name:'学校课程',teacher:'甲',room:'A101',weekday:1,weeks:[1,2,3],periods:[1,2]})]));
 state=saveCustomCourse(state,{mode:'once',date:'2026-11-17',name:'独立加课',startTime:'20:30',endTime:'21:10',room:'B402',teacher:'王老师'});
 const custom=allCards(buildSemesterOverviewModel(state)).filter(c=>c.name==='独立加课');
 assert.equal(custom.length,1);assert.equal(custom[0].customCourse,true);assert.deepEqual(custom[0].weeks,[12]);
 // 晚自习：大一 + 已开启，每周一至周四、周日晚间出现。
 const studySnapshot=withStudyPolicy(base([]),{enrollmentYear:2026},calendar,{studyPolicy:{userEnabled:true,room:'B303'}});
 const studyModel=buildSemesterOverviewModel(createState(studySnapshot));
 const studyCards=allCards(studyModel).filter(c=>c.localActivity);
 assert.equal(studyCards.length,5,'晚自习应覆盖周一至周四与周日');
 assert(studyCards.every(c=>c.name==='晚自习'&&c.startTime==='19:00'));
 // 8 月 31 日仍属上一学年，周一第一节晚自习从第 2 周开始；其余 4 天 16 周全有。
 assert.deepEqual(studyCards.find(c=>c.weekday===1).weeks,Array.from({length:15},(_,i)=>i+2));
 for(const weekday of [2,3,4,7])assert.deepEqual(studyCards.find(c=>c.weekday===weekday).weeks,Array.from({length:16},(_,i)=>i+1));
 assert.equal(semesterOccurrences(createState(studySnapshot)).filter(o=>o.localActivity).length,79);
});

test('C 纯文本：教务风格字段、多段合并与单双周压缩',()=>{
 const state=createState(base([
  rule('math',{name:'高等数学',teacher:'李老师',room:'A101',weekday:1,weeks:[7,8,9,10,11,12,13,14,15],periods:[1,2],startTime:'08:30',endTime:'09:55'}),
  rule('ai1',{name:'人工智能导论',teacher:'[REDACTED-NAME]',room:'B301',weekday:1,weeks:[6,8,10,12,14],periods:[7,8],startTime:'15:45',endTime:'17:10'}),
  rule('ai2',{name:'人工智能导论',teacher:'[REDACTED-NAME]',room:'B303',weekday:2,weeks:[7,8,9,10,11,12,13,14,15],periods:[1,2],startTime:'08:30',endTime:'09:55'}),
  rule('ai3',{name:'人工智能导论',teacher:'[REDACTED-NAME]',room:'B205',weekday:5,weeks:[5,6],periods:[7,8],startTime:'15:45',endTime:'17:10'}),
  rule('odd',{name:'单周课程',teacher:'甲',room:'B1',weekday:3,weeks:[7,9,11,13,15],periods:[3,4],startTime:'10:15',endTime:'11:40'}),
  rule('even',{name:'双周课程',teacher:'乙',room:'B2',weekday:4,weeks:[6,8,10,12,14],periods:[5,6],startTime:'14:00',endTime:'15:25'}),
  rule('sparse',{name:'离散课程',teacher:'丙',room:'B3',weekday:5,weeks:[7,9,13,15],periods:[9,10],startTime:'19:00',endTime:'20:25'})
 ]));
 const text=buildRulesText(state),model=buildRulesModel(state);
 assert.equal(model.kind,'rules-text');assert.equal(model.empty,false);assert.equal(model.conflictCount,0);
 assert(text.includes(['高等数学','李老师','A101','周一第1、2节{第7-15周}(全部)'].join('\t')));
 assert(text.includes(['人工智能导论','[REDACTED-NAME]','B301;B303;B205','周一第7、8节{第6-14周}(双周);周二第1、2节{第7-15周}(全部);周五第7、8节{第5-6周}(全部)'].join('\t')),'多段必须一行、教室与段同序');
 assert(text.includes('周三第3、4节{第7-15周}(单周)'));
 assert(text.includes('周四第5、6节{第6-14周}(双周)'));
 assert(text.includes('周五第9、10节{第7、9、13、15周}(全部)'));
 assert(!text.includes('周三第3、4节{第7-15周}(全部)'),'单周课程绝不能写成每周');
 assert.match(text,/^# 教学周：第1-16周（2026-08-31 至 2026-12-20）$/m);
 assert.match(text,/^# 来源：.*（非学校教务来源）$/m);
 assert.equal(new TextDecoder('utf-8',{fatal:true}).decode(new TextEncoder().encode(text)),text);
 assert.deepEqual(model.courses.map(c=>c.name).slice(0,3),['高等数学','人工智能导论','单周课程']);
});

test('C 纯文本：无节次自定义课、数组/字符串未排周次与 UTF-8 输出',async()=>{
 let state=createState(base([rule('math',{name:'高等数学',teacher:'李老师',room:'A101',weekday:1,weeks:[1,2,3],periods:[1,2]})],{
  unscheduled:[
   {name:'劳动教育',teacher:'教师K',room:'—',weeks:[5,6,7,8,9,10,11,12,13,14,15,16]},
   {name:'大学生心理健康',weeks:'8、12周',teacher:'赵老师',room:'南A201'}
  ]
 }));
 state=saveCustomCourse(state,{mode:'weekly',name:'社团活动',room:'活动室',teacher:'王老师',startTime:'21:40',endTime:'22:20',semesterId:state.snapshot.semester.id,semesterStartDate:START,weekdays:[1],startWeek:1,endWeek:16,weekPattern:'every'});
 const text=buildRulesText(state);
 assert(text.includes(['社团活动','王老师','活动室','周一21:40–22:20{第1-16周}(全部)'].join('\t')),'无节次应写时间范围');
 assert.match(text,/^# 未排时间的课程$/m);
 assert(text.includes(['劳动教育','教师K','—','第5-16周(全部)','学校仅提供周次，具体上课时间待通知'].join('\t')));
 assert(text.includes(['大学生心理健康','赵老师','南A201','第8、12周(全部)','学校仅提供周次，具体上课时间待通知'].join('\t')));
 const output=await createTimetableExport(state,{kind:'rules-text'});
 assert.equal(output.mime,'text/plain');assert.equal(output.pages,1);
 assert.match(output.filename,/^江水课表-整学期规则-2026-08-31\.txt$/);
 assert(new TextDecoder('utf-8',{fatal:true}).decode(output.bytes).includes('高等数学'));
 assert.equal(new TextDecoder('utf-8',{fatal:true}).decode(output.bytes),text);
 assert.equal(output.bytes[0],35,'UTF-8 无 BOM');
 assert.equal(output.bytes.at(-1),10,'文件末尾一个换行');
 await assert.rejects(createTimetableExport(state,{kind:'rules-text',shouldCancel:()=>true}),/已取消导出/);
 await assert.rejects(createTimetableExport(state,{kind:'no-such-kind'}),/导出类型无效/);
});

test('C 纯文本：不泄露账号、凭据、Cookie、URL；空课表与单周学期可导出',()=>{
 const state=createState(base([rule('secret',{name:'高等数学',teacher:'李老师',room:'A101',weekday:1,weeks:[1,2,3],periods:[1,2]})]));
 state.studentProfile={name:'SECRET-学生',studentId:'SECRET-学号'};
 state.snapshot.studentProfile={name:'SECRET-快照学生'};
 state.snapshot.source={kind:'sample',label:'测试来源'};
 state.cookies='SECRET-COOKIE';state.token='SECRET-TOKEN';state.url='https://secret.example/login';
 state.snapshot.session={cookies:['SECRET'],token:'SECRET'};
 const text=buildRulesText(state);
 assert.doesNotMatch(text,/SECRET/i);assert.doesNotMatch(text,/http/i);assert.doesNotMatch(text,/cookie/i);assert.doesNotMatch(text,/token/i);
 const emptyText=buildRulesText(createState(base([])));
 assert.match(emptyText,/^# 本学期没有可导出的课程$/m);
 assert.match(emptyText,/^# 江水课表 · 纯文本课表规则$/m);
 const oneWeekSource=base([rule('only',{name:'唯一课程',teacher:'甲',room:'A1',weekday:2,weeks:[1],periods:[1,2]})],{semester:{id:'one-week',name:'单周学期',startDate:START,weeks:1}});
 const oneWeekText=buildRulesText(createState(oneWeekSource));
 assert.match(oneWeekText,/^# 教学周：第1周（2026-08-31 至 2026-09-06）$/m,'单周学期不得写成 第1-1周');
 assert.match(oneWeekText,/周二第1、2节\{第1周\}\(全部\)/);
});

test('B 边界：空课表、单周学期、每周 20+ 门与同格 28 门不丢不重',()=>{
 const empty=buildSemesterOverviewModel(createState(base([])));
 assert.equal(empty.days.length,7);assert(empty.days.every(d=>d.courses.length===0));assert.deepEqual(empty.unscheduled,[]);
 const withPending=buildSemesterOverviewModel(createState(base([],{unscheduled:[{name:'劳动教育',weeks:'1—16周'}]})));
 assert.equal(allCards(withPending).length,0);assert.equal(withPending.unscheduled.length,1,'未排课程保留给页脚计数，不进入周网格');
 const oneWeek=buildSemesterOverviewModel(createState(base([rule('one',{name:'唯一课程',weeks:[1],weekday:2})],{semester:{id:'one',name:'单周学期',startDate:START,weeks:1}})));
 assert.equal(oneWeek.totalWeeks,1);assert.deepEqual(allCards(oneWeek)[0].weeks,[1]);
 // 每周 24 门：周一至周六 × 4 个时段，全部进入总览与纯文本。
 const many=[];
 for(let day=1;day<=6;day++)for(let slot=0;slot<4;slot++){
  many.push(rule(`many-${day}-${slot}`,{name:`课程${day}-${slot}`,teacher:'老师',room:`R${day}${slot}`,weekday:day,weeks:Array.from({length:WEEKS},(_,i)=>i+1),periods:[slot*2+1,slot*2+2],startTime:['08:30','10:15','14:00','15:45'][slot],endTime:['09:55','11:40','15:25','17:10'][slot]}));
 }
 const manyState=createState(base(many));
 const manyModel=buildSemesterOverviewModel(manyState);
 assert.equal(allCards(manyModel).length,24,'每周 20+ 门全部进入总览');
 assert.equal(new Set(allCards(manyModel).map(c=>c.name)).size,24);
 const manyText=buildRulesText(manyState);
 for(let day=1;day<=6;day++)for(let slot=0;slot<4;slot++)assert(manyText.includes(`课程${day}-${slot}\t`));
 // 同一天同一时段 28 门不同课：全部保留、全部标时间重叠。
 const crowded=Array.from({length:28},(_,i)=>rule(`crowded-${i}`,{name:'拥挤课程'+String(i+1).padStart(2,'0'),teacher:'测试教师',room:'A101',weekday:1,weeks:[1],periods:[1,2],startTime:'08:30',endTime:'09:10'}));
 const crowdedModel=buildSemesterOverviewModel(createState(base(crowded)));
 const crowdedCards=crowdedModel.days[0].courses;
 assert.equal(crowdedCards.length,28);assert(crowdedCards.every(c=>c.overlap===true));
 for(let i=1;i<=28;i++)assert(crowdedCards.some(c=>c.name==='拥挤课程'+String(i).padStart(2,'0')));
});

test('C 纯文本：来源冲突按最终显示版本输出并统计',()=>{
 let state=createState(base([rule('conflict',{name:'来源冲突课程',teacher:'乙',room:'A101',weekday:1,weeks:[1,2,3]})]));
 const row=timetableDay(state.snapshot,dayOf(1,1),state.overrides,state.localMaps,state.courseSettings,state.customCourses,state.holidaySettings)[0];
 state=saveOverride(state,row,{room:'本地教室'});
 state.snapshot.rules[0].room='学校新教室';
 const model=buildRulesModel(state),text=buildRulesText(state);
 assert.equal(model.conflictCount,1,'单日修改只与当周学校版本冲突，按发生次数计 1 次');
 assert.equal(model.courses.find(c=>c.name==='来源冲突课程').segments[0].weeks.length,3,'冲突周次之外的周仍按学校版本导出');
 assert(text.includes(['来源冲突课程','乙','学校新教室','周一第1、2节{第1-3周}(全部)'].join('\t')));
 assert.match(text,/# 注意：有 1 处来源冲突，按当前显示版本导出，请向学校确认。/);
});

test('B 输出契约：空课表/单周/普通/每周 24 门/28 门拥挤都只输出一张 PNG',async()=>{
 const oneWeek=createState(base([rule('one',{name:'唯一课程',weeks:[1],weekday:2})],{semester:{id:'one',name:'单周学期',startDate:START,weeks:1}}));
 const normal=createState(base([
  rule('math',{name:'高等数学',teacher:'李老师',room:'B204',weekday:1,weeks:Array.from({length:16},(_,i)=>i+1)}),
  rule('english',{name:'大学英语',teacher:'陈老师',room:'南A301',weekday:2,weeks:Array.from({length:16},(_,i)=>i+1),periods:[5,6],startTime:'14:00',endTime:'15:25'})
 ]));
 const many=[];
 for(let day=1;day<=6;day++)for(let slot=0;slot<4;slot++)many.push(rule(`many-${day}-${slot}`,{name:`课程${day}-${slot}`,teacher:'老师',room:`R${day}${slot}`,weekday:day,weeks:Array.from({length:WEEKS},(_,i)=>i+1),periods:[slot*2+1,slot*2+2],startTime:['08:30','10:15','14:00','15:45'][slot],endTime:['09:55','11:40','15:25','17:10'][slot]}));
 const weekly24=createState(base(many));
 const crowded=createState(base(Array.from({length:28},(_,i)=>rule(`crowded-${i}`,{name:'拥挤课程'+String(i+1).padStart(2,'0'),teacher:'测试教师',room:'A101',weeks:[1],periods:[1,2],startTime:'08:30',endTime:'09:10'}))));
 const scenarios=[['空课表',createState(base([]))],['单周学期',oneWeek],['普通课表',normal],['每周 24 门',weekly24],['28 门同格拥挤',crowded]];
 for(const [name,state] of scenarios){
  const {output,record}=await exportOverview(state);
  assert.equal(output.mime,'image/png',`${name} mime`);
  assert.equal(output.pages,1,`${name} pages`);
  assert.match(output.filename,new RegExp(`^江水课表-整学期总览-${START}\\.png$`),`${name} filename`);
  assert.deepEqual([...output.bytes.subarray(0,4)],[137,80,78,71],`${name} PNG 魔数`);
  assert.equal(record.encoded.length,1,`${name} 只编码一张图，不得走 PDF 或多页`);
  assert.equal(record.encoded[0].type,'image/png',`${name} 编码格式`);
  assert.equal(record.encoded[0].width,2520,`${name} 宽度`);
  assert.ok(record.encoded[0].height>=1782&&record.encoded[0].height<=4096,`${name} 高度 ${record.encoded[0].height} 应在 1782..4096`);
 }
});

test('B 极端拥挤：100 门同格仍单页 PNG，课程名/周次/时间不丢且页脚提示降级',async()=>{
 const extreme=Array.from({length:100},(_,i)=>({id:`extreme-${i}`,name:'极端课程'+String(i+1).padStart(3,'0'),teacher:'测试教师',room:'A101',weekday:1,weeks:[1],periods:[1,2],startTime:'08:30',endTime:'09:10'}));
 const state=createState(base(extreme));
 const {record,createCanvas}=overviewCanvasRecorder();
 const pages=renderSemesterOverviewPages(buildSemesterOverviewModel(state),createCanvas);
 assert.equal(pages.length,1,'极端拥挤也始终只有一张画布');
 assert.equal(pages[0].width,2520);
 assert.ok(pages[0].height>=1782&&pages[0].height<=4096,String(pages[0].height));
 for(let i=1;i<=100;i++)assert(record.texts.includes('极端课程'+String(i).padStart(3,'0')),'课程名不丢：'+i);
 assert(record.texts.some(text=>text.includes('周次：第1周(全部)')),'实际周次不丢');
 assert(record.texts.some(text=>text.includes('08:30–09:10')),'上课时间不丢');
 const footer=record.texts.filter(text=>/课程较多|课程极多|已自动缩小|紧凑|压缩/.test(text));
 assert.ok(footer.length>0,'拥挤时页脚应有降级提示，实际：'+JSON.stringify(record.texts.slice(-3)));
 const {output,record:exportRecord}=await exportOverview(state);
 assert.equal(output.mime,'image/png');
 assert.equal(output.pages,1);
 assert.match(output.filename,new RegExp(`^江水课表-整学期总览-${START}\\.png$`));
 assert.equal(exportRecord.encoded.length,1);
});

test('桌面保存：text/plain 与 .txt 白名单、UTF-8 与安全校验',()=>{
 const text='# 江水课表 · 纯文本课表规则\n高等数学\t李老师\tA101\t周一第1、2节{第7-15周}(全部)\n';
 const valid={filename:'江水课表-整学期规则-2026-08-31.txt',mime:'text/plain',base64:Buffer.from(text,'utf8').toString('base64')};
 const decoded=decodeExport(valid);
 assert.equal(decoded.mime,'text/plain');assert.equal(decoded.extension,'txt');assert.equal(decoded.bytes.toString('utf8'),text);
 const bad=[
  {filename:'江水课表-整学期规则-2026-08-31.pdf'},
  {filename:'../课表.txt'},
  {filename:'课表.txt.exe'},
  {mime:'application/pdf'},
  {base64:Buffer.from([0xff,0xfe,0x00,0x41]).toString('base64')},
  {base64:Buffer.from('text\u0000withnul','utf8').toString('base64')},
  {base64:''},{base64:'!!!!'},
  {mime:'image/png'}
 ];
 for(const patch of bad)assert.throws(()=>decodeExport({...valid,...patch}),undefined,JSON.stringify(patch));
 const png={filename:'课表.png',mime:'image/png',base64:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')};
 assert.equal(decodeExport(png).extension,'png');
 const pdf={filename:'课表.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\nexample').toString('base64')};
 assert.equal(decodeExport(pdf).extension,'pdf');
});
