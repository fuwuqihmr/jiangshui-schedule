import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../web/core.mjs';
import {saveCustomCourse} from '../web/custom-courses.mjs';
import {exportWeekModel,weekBandRows,renderWeekPages,buildSemesterOverviewModel,renderSemesterOverviewPages,buildRulesText,rowHeaderMetrics} from '../web/timetable-export.mjs';
const START='2026-10-12',WEEKS=3;
const base=rules=>({schemaVersion:1,semester:{id:'span',name:'跨节导出测试',startDate:START,weeks:WEEKS},rules,exceptions:[],remaps:[],unscheduled:[]});
const rule=(id,extra={})=>({id,name:'课程'+id,teacher:'教师A',room:'A101',weekday:1,weeks:[1,2,3],periods:[1,2],startTime:'08:30',endTime:'09:55',...extra});
function custom(state,course){
 return saveCustomCourse(state,{mode:'weekly',teacher:'教师A',semesterId:'span',semesterStartDate:START,startWeek:1,endWeek:WEEKS,weekPattern:'every',weekdays:[1],...course});
}
function spanState(){
 let state=createState(base([
  rule('normal',{name:'普通课程',weekday:2}),
  rule('late',{name:'三四节课程',weekday:3,periods:[3,4],startTime:'10:15',endTime:'11:40'}),
  rule('school',{name:'学校跨节课程',teacher:'教师B',room:'A102',weekday:4,periods:[1,2,3,4],startTime:'08:30',endTime:'11:40'})
 ]));
 state=custom(state,{name:'整上午课程',room:'B101',startTime:'08:30',endTime:'12:00'});
 state=custom(state,{name:'整下午课程',room:'B102',startTime:'14:00',endTime:'17:10'});
 return state;
}
// B 导出的行结构：跨上午/下午的课程把相邻时段合并成一行，课程只出现一次；
// 没有跨节课程的普通时段仍保持 08:30 / 10:15 两行。
test('周课表行：跨上午/下午课程按实际占用合并时段且只出现一次',()=>{
 const rows=weekBandRows(exportWeekModel(spanState(),1));
 const morning=rows.find(row=>row.title==='上午');
 assert.equal(morning.span,2,'整上午课程应覆盖 08:30-10:15 与 10:15-12:00 两个时段');
 assert.equal(morning.start,'08:30');assert.equal(morning.end,'12:00');assert.equal(morning.time,'08:30–12:00');
 assert.deepEqual(morning.cells.map(cell=>cell.map(course=>course.name)),[
  ['整上午课程'],
  ['普通课程'],
  ['三四节课程'],
  ['学校跨节课程'],
  [],[],[]
 ],'同一合并行内每门课只出现一次，落到各自的星期列');
 const afternoon=rows.find(row=>row.title==='下午');
 assert.equal(afternoon.span,2);assert.equal(afternoon.time,'14:00–17:10');
 assert.deepEqual(afternoon.cells[0].map(course=>course.name),['整下午课程']);
 assert.equal(afternoon.cells.slice(1).flat().length,0);
 const names=rows.flatMap(row=>row.cells.flat().map(course=>course.name));
 for(const name of ['整上午课程','整下午课程','学校跨节课程','普通课程','三四节课程'])assert.equal(names.filter(value=>value===name).length,1,name+' 必须恰好出现一次');
 assert(!rows.some(row=>row.title==='上午'&&row.time==='10:15 起'),'整上午课程覆盖 10:15 段时不应再单独留一行');
});

test('周课表行：普通单节课程不受影响，仍按 08:30 / 10:15 分两行',()=>{
 const state=createState(base([
  rule('normal',{name:'普通课程',weekday:2}),
  rule('late',{name:'三四节课程',weekday:3,periods:[3,4],startTime:'10:15',endTime:'11:40'})
 ]));
 const rows=weekBandRows(exportWeekModel(state,1));
 const morningRows=rows.filter(row=>row.title==='上午');
 assert.equal(morningRows.length,2,'没有跨节课程时保留两个独立时段行');
 assert.equal(morningRows[0].span,1);assert.equal(morningRows[0].time,'08:30 起');
 assert.deepEqual(morningRows[0].cells.map(cell=>cell.map(course=>course.name)),[[],['普通课程'],[],[],[],[],[]]);
 assert.equal(morningRows[1].span,1);assert.equal(morningRows[1].time,'10:15 起');
 assert.deepEqual(morningRows[1].cells.map(cell=>cell.map(course=>course.name)),[[],[],['三四节课程'],[],[],[],[]]);
});

// B 图片导出：真实 createTimetableExport 排版路径（假 canvas 只记录文字），
// 断言跨节课程在图片里只画一次且时段标题给出完整范围。
// Close-to-real font metrics: ASCII digits/symbols ~0.55em, CJK 1em.
// This is what makes the header-width assertions meaningful (a crude 1em
// per character model would under/over-estimate and hide clipping).
function measureTextWidth(font,text){
 const size=Number((/(\d+(?:\.\d+)?)px/.exec(font)||[])[1]||24);let width=0;
 for(const character of String(text))width+=character.codePointAt(0)>=0x2e80?size:size*.55;
 return width;
}
function measureContext(){
 const ctx={font:'400 24px sans-serif'};
 ctx.measureText=text=>({width:measureTextWidth(ctx.font,text)});
 return ctx;
}
function canvasRecorder(){
 const record={texts:[],items:[],encoded:[]};
 const createCanvas=()=>{
  const canvas={width:0,height:0};
  canvas.getContext=()=>{
   const ctx={textBaseline:'',font:'',fillStyle:'',strokeStyle:'',lineWidth:1};
   ctx.measureText=text=>({width:measureTextWidth(ctx.font,text)});
   ctx.fillText=(value,x,y)=>{record.texts.push(String(value));record.items.push({text:String(value),x,y,font:ctx.font,size:Number((/(\d+(?:\.\d+)?)px/.exec(ctx.font)||[])[1]||24)});};
   ctx.fillRect=()=>{};ctx.strokeRect=()=>{};ctx.beginPath=()=>{};ctx.moveTo=()=>{};ctx.lineTo=()=>{};ctx.stroke=()=>{};
   ctx.save=()=>{};ctx.restore=()=>{};ctx.scale=()=>{};ctx.translate=()=>{};ctx.setTransform=()=>{};
   return ctx;
  };
  canvas.toBlob=(callback,type='image/png')=>{record.encoded.push({type,width:canvas.width,height:canvas.height});callback(new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type}));};
  return canvas;
 };
 return {record,createCanvas};
}
const count=(list,value)=>list.filter(item=>item===value).length;

test('周课表图片：上午/下午时段标题写完整时间范围，跨节课程画一次',()=>{
 const state=spanState(),{record,createCanvas}=canvasRecorder();
 const pages=renderWeekPages(exportWeekModel(state,1),createCanvas);
 assert.equal(pages.length,1);
 for(const name of ['整上午课程','整下午课程','学校跨节课程','普通课程','三四节课程'])assert.equal(count(record.texts,name),1,name+' 在图片中只应出现一次');
 assert(record.texts.includes('08:30–12:00'),'上午合并行的时段标题必须给出 08:30–12:00');
 assert(record.texts.includes('14:00–17:10'),'下午合并行的时段标题必须给出 14:00–17:10');
 assert(!record.texts.includes('10:15 起'),'整上午课程覆盖的 10:15 段不再单独成行');
 assert(!record.texts.includes('15:45 起'),'整下午课程覆盖的 15:45 段不再单独成行');
});

test('整学期总览：跨节课程合并时段后仍只画一次，行标题与图片一致',()=>{
 const state=spanState(),{record,createCanvas}=canvasRecorder();
 const pages=renderSemesterOverviewPages(buildSemesterOverviewModel(state),createCanvas);
 assert.equal(pages.length,1);
 for(const name of ['整上午课程','整下午课程','学校跨节课程','普通课程','三四节课程'])assert.equal(count(record.texts,name),1,name+' 在总览中只应出现一次');
 assert(record.texts.includes('08:30–12:00'));
 assert(record.texts.includes('14:00–17:10'));
 assert(!record.texts.includes('10:15 起'));
 assert(!record.texts.includes('15:45 起'));
});

test('纯文本规则：跨节自定义课程按实际节次输出，与图片语义一致',()=>{
 const text=buildRulesText(spanState());
 assert(text.includes(['整上午课程','教师A','B101','周一第1、2、3、4节{第1-3周}(全部)'].join('\t')));
 assert(text.includes(['整下午课程','教师A','B102','周一第5、6、7、8节{第1-3周}(全部)'].join('\t')));
 assert(text.includes(['学校跨节课程','教师B','A102','周四第1、2、3、4节{第1-3周}(全部)'].join('\t')));
});

// 行头宽度：白底从 MARGIN+TIME_WIDTH 开始覆盖，标签必须在这个边界前结束。
// 用接近真实的字宽模型（ASCII ~0.55em、CJK 1em）验证四种典型行。
function rowHeaderSample(startTime,endTime){
 let state=createState(base([]));
 state=custom(state,{name:'跨节课程',room:'B101',startTime,endTime});
 return weekBandRows(exportWeekModel(state,1));
}
test('行头宽度：跨上午/跨下午/跨上午到下午/单行标签均不越界且不截断',()=>{
 const ctx=measureContext();
 const cases=[
  {rows:rowHeaderSample('08:30','12:00'),title:'上午',time:'08:30–12:00'},
  {rows:rowHeaderSample('14:00','17:10'),title:'下午',time:'14:00–17:10'},
  {rows:rowHeaderSample('08:30','15:25'),title:'上午–午间–下午',time:'08:30–15:25'},
 ];
 for(const item of cases){
  const row=item.rows.find(value=>value.title===item.title&&value.time===item.time);
  assert(row,'应生成 '+item.title+' / '+item.time+' 合并行');
  const metrics=rowHeaderMetrics(ctx,row);
  assert.equal(metrics.title.text,item.title);
  assert.equal(metrics.time.text,item.time);
  assert(metrics.title.width<=metrics.title.available+0.01,`标题 ${item.title} 宽 ${metrics.title.width} 超过可用 ${metrics.title.available}`);
  assert(metrics.time.width<=metrics.time.available+0.01,`时段 ${item.time} 宽 ${metrics.time.width} 超过可用 ${metrics.time.available}`);
  assert(metrics.title.size>=10&&metrics.time.size>=8);
 }
 const cross=rowHeaderSample('08:30','15:25');
 const crossRow=cross.find(row=>row.title==='上午–午间–下午');
 const crossMetrics=rowHeaderMetrics(ctx,crossRow);
 assert(crossMetrics.title.size<28,'长标题应自适应缩小字号而不是被白底裁掉');
 assert.equal(crossMetrics.title.text,'上午–午间–下午','标题不得省略关键时段');
 // 单行时段不得回归：没有跨节课程时仍是 08:30 起 / 10:15 起。
 const plain=createState(base([
  rule('normal',{name:'普通课程',weekday:2}),
  rule('late',{name:'三四节课程',weekday:3,periods:[3,4],startTime:'10:15',endTime:'11:40'})
 ]));
 const plainRows=weekBandRows(exportWeekModel(plain,1)).filter(row=>row.title==='上午');
 assert.deepEqual(plainRows.map(row=>row.time),['08:30 起','10:15 起']);
 for(const row of plainRows){
  const metrics=rowHeaderMetrics(ctx,row);
  assert(metrics.title.width<=metrics.title.available+0.01);
  assert(metrics.time.width<=metrics.time.available+0.01);
 }
});
// 渲染层再验一次：记录每个 fillText 的坐标与字号，行头文字实际占宽不得超过
// 白底起点（title/time 共用同一上限），周图与总览两条路径都要通过。
function assertRenderedHeadersFit(record){
 const empty=rowHeaderMetrics(measureContext(),{title:'',time:''});
 const limitX=empty.title.limit;
 const items=record.items.filter(item=>item.y>=316&&(item.x===empty.title.x||item.x===empty.time.x));
 assert(items.length>0,'应记录到行头文字');
 for(const item of items){
  const width=measureTextWidth(item.font,item.text);
  assert(item.x+width<=limitX+0.51,`渲染行头 "${item.text}" 结束于 ${(item.x+width).toFixed(2)}px，越过多行头边界 ${limitX}px`);
  assert(!item.text.includes('…')&&!item.text.includes('...'),'行头不得用省略号裁切');
 }
}
test('周课表图片：真实绘制的行头文字宽度不越过白底边界',()=>{
 const {record,createCanvas}=canvasRecorder();
 renderWeekPages(exportWeekModel(spanState(),1),createCanvas);
 assertRenderedHeadersFit(record);
});
test('整学期总览：真实绘制的行头文字宽度不越过白底边界',()=>{
 const {record,createCanvas}=canvasRecorder();
 renderSemesterOverviewPages(buildSemesterOverviewModel(spanState()),createCanvas);
 assertRenderedHeadersFit(record);
});
