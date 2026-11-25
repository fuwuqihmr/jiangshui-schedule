import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,cpSync,rmSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {effectiveDay} from '../web/core.mjs';
import {normalizeHolidaySettings} from '../web/holiday-settings.mjs';
import {runNativeWidgetResolver} from './native-widget-resolver-harness.mjs';

// task-50 / Phase2 T1：桌面小组件数据层接入实验课。
// 验收对象：真实编译执行 android/.../ScheduleWidgetData.java（tests/fixtures/widget-resolver 最小 JVM 桩）。
// 契约：Item.lab/source/label + addLabs（week+weekday 固定日期注入、停课/假日按“课”取消）；
//   排序与 web/core.mjs compareCourses 一致（start 优先，实验课参与同起始时间冲突时 exam 0/lab 1/普通 2/本机 3）；
//   harness ITEM 协议在末尾追加 lab/source/label，旧 fixture 与既有断言不受影响。
// 未覆盖：RemoteViews 渲染、真机小组件刷新、真实 state.json 读盘；实验课底色/深色皮肤留待 UI 任务。

const TERM={id:'term-lab-widget',startDate:'2026-08-31',weeks:18};
const MON='2026-10-12'; // 学期第 7 周周一
const EPOCH=Date.parse(MON+'T10:30:00+08:00');
const LAB={id:'lab-1',week:7,weekday:1,name:'大学物理实验',room:'实验楼101',startTime:'08:30',endTime:'09:55',periods:[1,2]};
const LABKEY=MON+'/lab-lab-1';
const RULE_A={id:'a-1',name:'课程A',teacher:'乙',room:'A102',weekday:1,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'};
const RULE_SAME_NAME={id:'a-1',name:'大学物理实验',teacher:'乙',room:'A102',weekday:1,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'};
const RULE_LATE={id:'late-1',name:'稍后课',teacher:'丙',room:'A103',weekday:1,weeks:[7],periods:[3,4],startTime:'10:05',endTime:'11:30'};
const EXAM={id:'L001|期末|x|y|'+MON+'|08:30',name:'期末考试',teacher:'戊',room:'E101',date:MON,startTime:'08:30',endTime:'09:55',periods:[1,2],week:7,weekday:1};
const EXAMKEY=MON+'/exam-'+EXAM.id;
const CUSTOM={id:'custom-1700000000000',mode:'once',name:'临时加课',teacher:'丁',room:'D404',startTime:'08:30',endTime:'09:55',date:MON};
const CUSTOMKEY=MON+'/custom-1700000000000';
function holiday(extra={}){return {winter:null,summer:null,days:[],restoreDates:[],...extra};}
function makeState({rules=[],exams=null,labs=[LAB],closedDates=[],holidaySettings=holiday(),customCourses=[]}={}){
  const snapshot={semester:{...TERM},source:{kind:'school'},rules:rules.map(rule=>({...rule})),closedDates:[...closedDates],remaps:[],exceptions:[],studentProfile:{enrollmentYear:2026}};
  if(exams)snapshot.exams={semesterId:TERM.id,semesterStartDate:TERM.startDate,items:[{...EXAM}]};
  if(labs!==null)snapshot.labs={semesterId:TERM.id,semesterStartDate:TERM.startDate,fetchedAt:'2026-10-01T00:00:00+08:00',error:null,source:'school',items:labs.map(item=>({...item})),skipped:[]};
  return {snapshot,overrides:[],localMaps:[],courseSettings:{},customCourses:customCourses.map(item=>({...item})),holidaySettings};
}
const SCENARIOS=[
  {id:'lab-vs-normal-same-start',date:MON,state:makeState({rules:[RULE_A]})},
  {id:'lab-vs-exam-same-start',date:MON,state:makeState({rules:[],exams:true})},
  {id:'lab-vs-custom-same-start',date:MON,state:makeState({rules:[],customCourses:[CUSTOM]})},
  {id:'lab-multi-way-tie',date:MON,state:makeState({rules:[RULE_A],exams:true,customCourses:[CUSTOM]})},
  {id:'lab-start-secondary',date:MON,state:makeState({rules:[RULE_LATE]})},
  {id:'lab-name-clash',date:MON,state:makeState({rules:[RULE_SAME_NAME]})},
  {id:'lab-holiday',date:MON,state:makeState({holidaySettings:holiday({winter:{startDate:'2026-10-05',endDate:'2026-10-18'}})})},
  {id:'lab-holiday-restored',date:MON,state:makeState({holidaySettings:holiday({days:[{date:MON,skipStudy:false}],restoreDates:[MON]})})},
  {id:'lab-closed',date:MON,state:makeState({closedDates:[MON]})},
  {id:'lab-closed-restored',date:MON,state:makeState({closedDates:[MON],holidaySettings:holiday({restoreDates:[MON]})})},
  {id:'lab-read-only',date:MON,state:makeState({rules:[]})}
];
const native=runNativeWidgetResolver(SCENARIOS.map(({id,state,date})=>({id,state,date,epoch:EPOCH})));
const nativeById=new Map(native.map(entry=>[entry.id,entry]));
function scenario(id){const found=SCENARIOS.find(item=>item.id===id);assert.ok(found,'缺少场景 '+id);return found;}
function webRows(id){const state=scenario(id).state;return effectiveDay(state.snapshot,scenario(id).date,state.overrides,state.localMaps,state.courseSettings,state.customCourses,normalizeHolidaySettings(state.holidaySettings));}
function javaItems(id){const entry=nativeById.get(id);assert.ok(entry,'harness 缺少场景 '+id);return entry.items;}
function javaRead(id){const entry=nativeById.get(id);assert.ok(entry,'harness 缺少场景 '+id);return entry.read;}
const projection=item=>({key:item.key,name:item.name,room:item.room,start:item.startTime??item.start,end:item.endTime??item.end,cancelled:item.cancelled===true,lab:item.lab===true});
const keys=items=>items.map(item=>item.key);

test('协议与数据字段：实验课带 lab/source/label 进入 resolver，普通课保持缺省',()=>{
  const items=javaItems('lab-vs-normal-same-start');
  const lab=items.find(item=>item.lab);
  assert.ok(lab,'实验课必须出现在日视图 items');
  assert.equal(lab.key,LABKEY);
  assert.equal(lab.name,'大学物理实验');
  assert.equal(lab.room,'实验楼101');
  assert.equal(lab.source,'lab','数据层保留 source=lab 供 UI 决定实验蓝');
  assert.equal(lab.label,'【实验】','数据层保留【实验】独立标识');
  assert.equal(lab.teacher,'—','实验课无教师，占位与 addExams 一致');
  const normal=items.find(item=>!item.lab);
  assert.ok(normal);
  assert.equal(normal.source??'', '', '普通课 source 保持缺省');
  assert.equal(normal.label??'', '', '普通课 label 保持缺省');
  assert.equal(native.length,SCENARIOS.length,'harness 场景数与 fixture 一致');
});

test('排序：实验课参与同起始时间冲突时按 exam 0/lab 1/普通 2/本机 3，且与 web 逐项一致',()=>{
  const expected={
    'lab-vs-normal-same-start':[LABKEY,MON+'/a-1'],
    'lab-vs-exam-same-start':[EXAMKEY,LABKEY],
    'lab-vs-custom-same-start':[LABKEY,CUSTOMKEY],
    'lab-start-secondary':[LABKEY,MON+'/late-1']
  };
  for(const [id,want] of Object.entries(expected)){
    assert.deepEqual(keys(javaItems(id)),want,id+'：Java 顺序');
    assert.deepEqual(keys(webRows(id)),want,id+'：web 顺序');
    assert.deepEqual(javaItems(id).map(projection),webRows(id).map(projection),id+'：Java 与 web 内容不一致');
  }
  // 多行同起始时间时 compareCourses 故意只对“实验课参与的成对冲突”启用优先级，
  // 该比较器不满足传递性（exam<lab、lab<普通、普通<exam 可成环），因此多行并列不固定全序；
  // 这里只锁两端集合一致（Java 与 web 均不得丢行/合并行），不锁定具体顺序。
  const multi=javaItems('lab-multi-way-tie'),multiWeb=webRows('lab-multi-way-tie');
  assert.deepEqual([...keys(multi)].sort(),[...keys(multiWeb)].sort(),'多行并列 Java/web 集合一致');
  assert.equal(multi.length,4);
});

test('与普通课同名不合并：实验课与同名学校课双行并存，key/ruleId 独立',()=>{
  const java=javaItems('lab-name-clash'),web=webRows('lab-name-clash');
  assert.equal(java.length,2,'同名实验课与普通课不得合并');
  assert.equal(web.length,2);
  assert.deepEqual(keys(java),[LABKEY,MON+'/a-1']);
  assert.equal(java.filter(item=>item.lab).length,1);
  assert.equal(java.filter(item=>!item.lab).length,1);
  assert.equal(java[0].name,java[1].name,'同名保持');
  assert.notEqual(java[0].key,java[1].key,'实验课与普通课 key 独立');
  assert.deepEqual(java.map(projection),web.map(projection));
});

test('停课/假日按“课”取消，恢复日恢复：与 web core.mjs:99-100 同口径',()=>{
  const cancelled=id=>scenario(id)&&javaItems(id).filter(item=>item.lab).map(item=>item.cancelled);
  assert.deepEqual(cancelled('lab-holiday'),[true],'节假日实验课取消');
  assert.deepEqual(cancelled('lab-closed'),[true],'学校停课实验课取消');
  assert.deepEqual(cancelled('lab-holiday-restored'),[false],'恢复日实验课恢复');
  assert.deepEqual(cancelled('lab-closed-restored'),[false],'停课恢复日实验课恢复');
  for(const id of ['lab-holiday','lab-closed','lab-holiday-restored','lab-closed-restored']){
    assert.deepEqual(javaItems(id).map(projection),webRows(id).map(projection),id+'：Java 与 web 不一致');
  }
});

test('read 字段不破坏：hasState/status/courseCount 协议与取消过滤保持原样',()=>{
  const read=javaRead('lab-read-only');
  assert.deepEqual(Object.keys(read).sort(),['courseCount','hasState','status'],'READ 协议字段未扩展');
  assert.equal(read.hasState,true);
  assert.equal(read.courseCount,1,'实验课计入今日课程数');
  assert.equal(read.status,'今日已无课');
  const cancelled=javaRead('lab-holiday');
  assert.equal(cancelled.courseCount,0,'取消的实验课不计数');
  assert.equal(cancelled.status,'今日已无课');
});

const REPO_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function javaTool(name){const home=process.env.JAVA_HOME;const exe=process.platform==='win32'?name+'.exe':name;return home?path.join(home,'bin',exe):exe;}
function collectJava(dir,out=[]){for(const name of readdirSync(dir)){const file=path.join(dir,name);if(statSync(file).isDirectory())collectJava(file,out);else if(name.endsWith('.java'))out.push(file);}return out;}

test('渲染项可见【实验】：displayName 只给实验课加前缀，5 个绑定点全部走 displayName',()=>{
  const widgetFile=path.join(REPO_ROOT,'android','app','src','main','java','cn','local','tomorrow','ScheduleWidgetData.java');
  const stubDir=path.join(REPO_ROOT,'tests','fixtures','widget-resolver');
  const dir=mkdtempSync(path.join(tmpdir(),'widget-display-'));
  try{
    cpSync(stubDir,path.join(dir,'src'),{recursive:true});
    const probe=[
      'package cn.local.tomorrow;',
      'import java.io.*;',
      'public class WidgetDisplayProbe {',
      '  static void line(String tag, ScheduleWidgetData.Item item) { System.out.println(tag + "\\t" + ScheduleWidgetData.displayName(item)); }',
      '  public static void main(String[] args) throws Exception {',
      '    System.setOut(new PrintStream(new FileOutputStream(args[0]), true, "UTF-8"));',
      '    ScheduleWidgetData.Item lab = new ScheduleWidgetData.Item(); lab.lab = true; lab.label = "【实验】"; lab.name = "大学物理实验";',
      '    line("lab", lab);',
      '    ScheduleWidgetData.Item normal = new ScheduleWidgetData.Item(); normal.name = "高等数学";',
      '    line("normal", normal);',
      '    ScheduleWidgetData.Item exam = new ScheduleWidgetData.Item(); exam.exam = true; exam.name = "期末考试";',
      '    line("exam", exam);',
      '    ScheduleWidgetData.Item noLabel = new ScheduleWidgetData.Item(); noLabel.lab = true; noLabel.name = "实验课";',
      '    line("lab-no-label", noLabel);',
      '    line("null", null);',
      '  }',
      '}'
    ].join('\n');
    writeFileSync(path.join(dir,'src','cn','local','tomorrow','WidgetDisplayProbe.java'),probe,'utf8');
    const files=collectJava(path.join(dir,'src'));files.push(widgetFile);
    const compile=spawnSync(javaTool('javac'),['-encoding','UTF-8','-d',dir,...files],{cwd:dir,encoding:'utf8'});
    assert.equal(compile.status,0,'javac 编译 displayName probe 失败：'+(compile.stderr||compile.stdout||''));
    const run=spawnSync(javaTool('java'),['-cp',dir,'cn.local.tomorrow.WidgetDisplayProbe',path.join(dir,'display.txt')],{cwd:dir,encoding:'utf8'});
    assert.equal(run.status,0,'java 执行 displayName probe 失败：'+(run.stderr||run.stdout||''));
    assert.deepEqual(readFileSync(path.join(dir,'display.txt'),'utf8').trim().split(/\r?\n/).map(line=>line.split('\t')),[
      ['lab','【实验】大学物理实验'],
      ['normal','高等数学'],
      ['exam','期末考试'],
      ['lab-no-label','【实验】实验课'],
      ['null']
    ],'displayName 渲染字符串必须仅对实验课加【实验】');
  }finally{try{rmSync(dir,{recursive:true,force:true});}catch{}}
  const source=readFileSync(widgetFile,'utf8');
  assert.ok(/static String displayName\(Item item\)/.test(source),'缺少 displayName helper');
  const bindings=[
    /R\.id\.widget_course, displayName\(data\.(?:current|next)\)/g,
    /R\.id\.widget_current_course, first != null \? displayName\(first\)/g,
    /R\.id\.widget_next_course, second != null \? displayName\(second\)/g,
    /R\.id\.widget_row_name, displayName\(item\)/g
  ];
  let total=0;for(const pattern of bindings)total+=(source.match(pattern)||[]).length;
  assert.equal(total,5,'5 个课程名绑定点必须全部使用 displayName');
  assert.equal(/setTextViewText\(R\.id\.widget_(?:course|current_course|next_course|row_name), (?:data\.(?:current|next)|first|second|item)\.name\)/.test(source),false,'仍有绑定点直接使用 raw name');
});

test('四尺寸与深色资源未被本次改动破坏（静态守卫）',()=>{
  const layout=new URL('../android/app/src/main/res/layout/',import.meta.url);
  for(const name of ['widget_schedule_small.xml','widget_schedule_tall.xml','widget_schedule_wide.xml','widget_schedule_landscape.xml']){
    const xml=readFileSync(new URL(name,layout),'utf8');
    assert.ok(xml.includes('@+id/widget_root'),name+' 缺少 widget_root');
    assert.ok(xml.includes('@+id/widget_status'),name+' 缺少 widget_status');
  }
  const row=readFileSync(new URL('widget_course_row.xml',layout),'utf8');
  for(const id of ['widget_row_root','widget_row_name','widget_row_time','widget_row_meta','widget_row_status'])assert.ok(row.includes('@+id/'+id),'widget_course_row 缺少 '+id);
  const info=new URL('../android/app/src/main/res/xml/',import.meta.url);
  for(const name of ['widget_schedule_small_info.xml','widget_schedule_tall_info.xml','widget_schedule_wide_info.xml','widget_schedule_landscape_info.xml'])assert.ok(readFileSync(new URL(name,info),'utf8').length>0,name+' 缺失');
  const night=new URL('../android/app/src/main/res/values-night/',import.meta.url);
  const files=readdirSync(night).filter(name=>name.endsWith('.xml')).sort();
  assert.deepEqual(files,['notification_colors.xml'],'深色主题仍只有通知色，本次未引入小组件深色覆盖');
});
