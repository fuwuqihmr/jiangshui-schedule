import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,cpSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createState} from '../web/core.mjs';
import {reminderWindows,activeReminderWindows} from '../web/reminders.mjs';
import {setRestoreDate} from '../web/holiday-settings.mjs';

// task-53 / Phase2 T4：上课提醒接入实验课。
// 契约：实验课（snapshot.labs，Phase1 由 jiaowu-lab 归一化）经 effectiveDay 进入提醒候选，
//   行数据带 lab/label/source 独立标识；停课/假日按课取消、调休不移动（与 Phase1 一致）；
//   与普通课同时间并存，不去重合并（id/key 不同）。
// Java 侧：ClassReminderPlan.events 走真实编译执行的 ScheduleWidgetData.effectiveDay，
//   本文件用最小 JVM 桩真实 javac/java 运行，断言 Event.lab/label 与 labLabel。
// NotificationCards：android 渲染层无法在 JVM 运行，仅做静态守卫（含条件化前缀），报告中记为静态检查。

const TERM={id:'reminder-lab-term',name:'合成学期',startDate:'2026-08-31',weeks:18};
const MON='2026-10-12'; // 学期第 7 周周一
const time=(value)=>Date.parse(value+'+08:00');
const AT=time(MON+'T08:00:00');
const LAB_ITEM={id:'K1|7|1|10102',week:7,weekday:1,name:'大学物理实验',room:'实验楼101',startTime:'08:30',endTime:'09:55',periods:[1,2]};
const NORMAL={id:'normal-1',name:'高等数学',teacher:'李老师',room:'B204',weekday:1,weeks:[7],periods:[1,2],startTime:'08:30',endTime:'09:55'};
const LAB_KEY=MON+'/lab-'+LAB_ITEM.id;
const LAB_ID=MON+'|'+LAB_KEY;

function snapshot({rules=[NORMAL],labs=[LAB_ITEM],closedDates=[],source={kind:'school',label:'合成学校'}}={}){
 const out={schemaVersion:1,semester:{...TERM},source:{...source},rules:rules.map(rule=>({...rule})),closedDates:[...closedDates],remaps:[],exceptions:[]};
 if(labs!==null)out.labs={semesterId:TERM.id,semesterStartDate:TERM.startDate,fetchedAt:'2026-11-17T00:00:00.000Z',error:null,source:'school',items:labs.map(item=>({...item})),skipped:[]};
 return out;
}
function state(options={}){
 const value=createState(snapshot(options));
 value.classReminders={enabled:true,leadMinutes:30,afterStartMinutes:5};
 if(options.holidaySettings)value.holidaySettings=options.holidaySettings;
 return value;
}
const labRow=(rows)=>rows.find(row=>row.lab===true);
const normalRow=(rows)=>rows.find(row=>row.lab!==true);

test('实验课进入提醒候选：逐字段与普通课同窗口，并带 lab/label/source 标识',()=>{
 const rows=reminderWindows(state(),AT);
 assert.equal(rows.length,2,'同时间实验课与普通课都应进入候选');
 const lab=labRow(rows);
 assert.ok(lab,'实验课必须进入提醒候选');
 assert.equal(lab.id,LAB_ID);
 assert.equal(lab.key,LAB_KEY);
 assert.equal(lab.date,MON);
 assert.equal(lab.name,'大学物理实验','数据层保留原始课程名，标识走 label 字段');
 assert.equal(lab.room,'实验楼101');
 assert.equal(lab.teacher,undefined,'实验课无教师时保持 undefined，由 UI 兜底');
 assert.equal(lab.startTime,'08:30');
 assert.equal(lab.endTime,'09:55');
 assert.equal(lab.startAt,time(MON+'T08:30:00'));
 assert.equal(lab.showAt,time(MON+'T08:00:00'),'默认提前 30 分钟');
 assert.equal(lab.expiresAt,time(MON+'T08:35:00'),'默认开课后保留 5 分钟');
 assert.equal(lab.lab,true);
 assert.equal(lab.label,'【实验】');
 assert.equal(lab.source,'lab','提醒行用 source=lab 标识实验课来源');
 const normal=normalRow(rows);
 assert.equal(normal.lab,false);
 assert.equal(normal.label,'');
 assert.equal(normal.source,'school','普通学校课保持 Phase1 source');
});

test('提醒窗口边界与普通课一致：提前 30 分钟出现、开课后 5 分钟结束',()=>{
 const s=state();
 assert.equal(activeReminderWindows(s,time(MON+'T07:59:59')).length,0);
 assert.ok(activeReminderWindows(s,time(MON+'T08:00:00')).some(row=>row.lab===true),'08:00 实验课提醒出现');
 assert.ok(activeReminderWindows(s,time(MON+'T08:34:59')).some(row=>row.lab===true));
 assert.equal(activeReminderWindows(s,time(MON+'T08:35:00')).some(row=>row.lab===true),false,'08:35 实验课提醒结束');
});

test('与普通课同起始时间不被去重合并：两条候选、id/key 互不相同',()=>{
 const rows=reminderWindows(state(),AT);
 assert.equal(rows.length,2);
 assert.deepEqual(new Set(rows.map(row=>row.id)).size,2);
 assert.deepEqual(new Set(rows.map(row=>row.key)).size,2);
 assert.deepEqual(rows.map(row=>row.name).sort(),['大学物理实验','高等数学'].sort());
 assert.deepEqual(new Set(rows.map(row=>row.startAt)).size,1,'两条提醒的开始时间相同');
});

test('停课/假日按课取消实验课提醒，单日恢复后回归；假日期间课程不提醒',()=>{
 const closed=state({closedDates:[MON]});
 assert.deepEqual(reminderWindows(closed,AT),[]);
 const restored=state({closedDates:[MON],holidaySettings:setRestoreDate({winter:null,summer:null,days:[],restoreDates:[]},MON,true)});
 const restoredRows=reminderWindows(restored,AT);
 assert.equal(restoredRows.length,2,'恢复日实验课与普通课都回归');
 assert.equal(restoredRows.filter(row=>row.lab===true).length,1);
 const holiday=state({holidaySettings:{winter:{startDate:'2026-10-05',endDate:'2026-10-18'},summer:null,days:[],restoreDates:[]}});
 assert.deepEqual(reminderWindows(holiday,AT),[],'寒暑假区间内实验课不提醒');
});

test('调休不移动实验课：调出日普通课消失但实验课保留，目标日也不出现实验课',()=>{
 const s=state();
 s.localMaps=[{id:'move-1',fromDate:MON,date:'2026-10-16',mode:'replace'}];
 // reminderWindows 覆盖前后 9 天，这里按 row.date 精确断言两天的差异。
 const monday=reminderWindows(s,AT).filter(row=>row.date===MON);
 assert.ok(monday.some(row=>row.lab===true),'调出日实验课不随普通课搬走');
 assert.equal(monday.some(row=>row.lab!==true),false,'调出日普通课已被搬走');
 const friday=reminderWindows(s,time('2026-10-16T08:00:00')).filter(row=>row.date==='2026-10-16');
 assert.equal(friday.some(row=>row.lab===true),false,'目标日只有被搬入的普通课');
 assert.equal(friday.some(row=>row.lab!==true),true);
});

test('示例源不提醒实验课；关闭上课提醒后无任何候选',()=>{
 assert.deepEqual(reminderWindows(state({source:{kind:'sample',label:'内置演示'}}),AT),[],'示例源（含实验课）默认不提醒');
 const off=state();off.classReminders.enabled=false;
 assert.deepEqual(reminderWindows(off,AT),[]);
});

// ---------------------------------------------------------------------------
// Java 逻辑层：真实编译 ClassReminderPlan.java + ScheduleWidgetData.java（tests/fixtures/widget-resolver 最小桩）
// ---------------------------------------------------------------------------
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const planFile=path.join(root,'android','app','src','main','java','cn','local','tomorrow','ClassReminderPlan.java');
const widgetFile=path.join(root,'android','app','src','main','java','cn','local','tomorrow','ScheduleWidgetData.java');
const stubDir=path.join(root,'tests','fixtures','widget-resolver');
const SEP=String.fromCharCode(31),NL=String.fromCharCode(10),CR=String.fromCharCode(13);
function javaTool(name){const home=process.env.JAVA_HOME;const exe=process.platform==='win32'?name+'.exe':name;return home?path.join(home,'bin',exe):exe;}
function collectJava(dir,out){for(const name of readdirSync(dir)){const file=path.join(dir,name);if(statSync(file).isDirectory())collectJava(file,out);else if(name.endsWith('.java'))out.push(file);}return out;}
function javaValue(value){
 if(value===null)return '(Object)null';
 if(typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('fixture 含非有限数字');return String(value);}
 if(typeof value==='boolean')return String(value);
 if(Array.isArray(value))return 'arr('+value.map(javaValue).join(',')+')';
 if(typeof value==='object'){const entries=Object.entries(value).filter(([,item])=>item!==undefined);return 'obj('+entries.map(([key,item])=>JSON.stringify(key)+','+javaValue(item)).join(',')+')';}
 throw new Error('fixture 含不支持的值类型: '+typeof value);
}
function runNativeReminderPlan(scenarios){
 const dir=mkdtempSync(path.join(tmpdir(),'native-reminder-plan-'));
 try{
  const srcDir=path.join(dir,'src');
  cpSync(stubDir,srcDir,{recursive:true});
  const outFile=path.join(dir,'result.txt');
  const blocks=scenarios.map(({id,state:value,now})=>[
   '{',
   '  JSONObject state='+javaValue(value)+';',
   '  out.println("SCENARIO"+SEP+'+JSON.stringify(id)+');',
   '  for(ClassReminderPlan.Event e:ClassReminderPlan.events(state,'+String(now)+'L)){',
   '    JSONObject j=e.json();',
   '    out.println("EVENT"+SEP+e.id+SEP+nz(e.course.name)+SEP+nz(e.course.room)+SEP+nz(e.course.teacher)+SEP+e.course.start+SEP+e.course.end+SEP+e.lab+SEP+nz(e.course.source)+SEP+j.optString("label")+SEP+String.valueOf(j.opt("lab"))+SEP+j.optString("name")+SEP+ClassReminderPlan.labLabel(e));',
   '  }',
   '}'
  ].join(NL)).join(NL);
  const java=[
   'package cn.local.tomorrow;',
   'import org.json.*;',
   'public class NativeReminderPlan{',
   '  static final String SEP=String.valueOf((char)31);',
   '  static JSONObject obj(Object... kv)throws Exception{JSONObject out=new JSONObject();for(int i=0;i+1<kv.length;i+=2)out.put((String)kv[i],kv[i+1]);return out;}',
   '  static JSONArray arr(Object... values)throws Exception{JSONArray out=new JSONArray();for(Object value:values)out.put(value);return out;}',
   '  static String nz(String value){return value==null?"":value;}',
   '  public static void main(String[] args)throws Exception{',
   '  java.io.PrintWriter out=new java.io.PrintWriter(new java.io.OutputStreamWriter(new java.io.FileOutputStream(args[0]),"UTF-8"),true);',
   blocks,
   '  out.flush();',
   '  }',
   '}'
  ].join(NL);
  writeFileSync(path.join(srcDir,'cn','local','tomorrow','NativeReminderPlan.java'),java,'utf8');
  const files=collectJava(srcDir,[]);
  files.push(widgetFile,planFile);
  const compile=spawnSync(javaTool('javac'),['-encoding','UTF-8','-d',dir,...files],{cwd:dir,encoding:'utf8'});
  if(compile.status!==0)throw new Error('javac 失败：'+(compile.stderr||compile.stdout||compile.error?.message||''));
  const run=spawnSync(javaTool('java'),['-cp',dir,'cn.local.tomorrow.NativeReminderPlan',outFile],{cwd:dir,encoding:'utf8'});
  if(run.status!==0)throw new Error('java 失败：'+(run.stderr||run.stdout||run.error?.message||''));
  const scenariosOut=[];let current=null;
  for(const raw of readFileSync(outFile,'utf8').split(NL)){
   const line=raw.endsWith(CR)?raw.slice(0,-1):raw;
   if(!line)continue;
   const parts=line.split(SEP);
   if(parts[0]==='SCENARIO'){current={id:parts[1],events:[]};scenariosOut.push(current);}
   else if(parts[0]==='EVENT'&&current){
    current.events.push({id:parts[1],name:parts[2],room:parts[3],teacher:parts[4],start:parts[5],end:parts[6],lab:parts[7]==='true',source:parts[8],label:parts[9],jsonLab:parts[10]==='true',jsonName:parts[11],prefix:parts[12]});
   } else throw new Error('无法解析 harness 输出行：'+line);
  }
  return scenariosOut;
 }finally{try{rmSync(dir,{recursive:true,force:true});}catch{}}
}
const holiday=()=>({winter:null,summer:null,days:[],restoreDates:[]});
function javaState({rules=[NORMAL],labs=[LAB_ITEM],closedDates=[],source={kind:'school',label:'合成学校'},holidaySettings=holiday()}={}){
 const snap=snapshot({rules,labs,closedDates,source});
 return {snapshot:snap,overrides:[],localMaps:[],courseSettings:{},customCourses:[],holidaySettings,classReminders:{enabled:true,leadMinutes:30,afterStartMinutes:5}};
}
test('Java ClassReminderPlan 逻辑层：实验课产生提醒事件，Event.lab/label/labLabel 正确且与普通课互不去重',()=>{
 const result=runNativeReminderPlan([
  {id:'same-time',state:javaState(),now:AT},
  {id:'closed',state:javaState({closedDates:[MON]}),now:AT},
  {id:'holiday',state:javaState({holidaySettings:{winter:{startDate:'2026-10-05',endDate:'2026-10-18'},summer:null,days:[],restoreDates:[]}}),now:AT},
  {id:'restored',state:javaState({closedDates:[MON],holidaySettings:{winter:null,summer:null,days:[],restoreDates:[MON]}}),now:AT},
  {id:'sample',state:javaState({source:{kind:'sample',label:'内置演示'}}),now:AT},
 ]);
 const byId=new Map(result.map(entry=>[entry.id,entry]));
 assert.equal(byId.size,5);
 const same=byId.get('same-time').events;
 assert.equal(same.length,2,'同时间实验课与普通课各一条提醒，不去重合并');
 const lab=same.find(event=>event.lab===true);
 assert.ok(lab,'Java effectiveDay 后实验课必须产生提醒事件');
 assert.equal(lab.id,LAB_ID);
 assert.equal(lab.name,'大学物理实验');
 assert.equal(lab.room,'实验楼101');
 assert.equal(lab.teacher,'—','实验课无教师，占位与小组件一致');
 assert.equal(lab.start,'08:30');
 assert.equal(lab.end,'09:55');
 assert.equal(lab.label,'【实验】');
 assert.equal(lab.jsonLab,true);
 assert.equal(lab.jsonName,'大学物理实验','Event.json 保留原始名，标识走 label');
 assert.equal(lab.prefix,'【实验】','labLabel 供通知渲染层使用');
 assert.equal(lab.source,'lab');
 const normal=same.find(event=>event.lab!==true);
 assert.ok(normal);
 assert.equal(normal.label,'');
 assert.equal(normal.prefix,'','非实验课 labLabel 必须为空串，保证通知输出逐字节不变');
 assert.equal(normal.jsonLab,false);
 assert.notEqual(lab.id,normal.id);
 assert.deepEqual(byId.get('closed').events,[],'停课日取消实验课提醒');
 assert.deepEqual(byId.get('holiday').events,[],'假日区间取消提醒');
 assert.equal(byId.get('restored').events.length,2,'单日恢复后实验课与普通课提醒回归');
 assert.deepEqual(byId.get('sample').events,[],'示例源不提醒（含实验课）');
});

test('NotificationCards 静态守卫：仅 Event.lab=true 时在 lesson/live 标题与正文加【实验】前缀',()=>{
 const source=readFileSync(path.join(root,'android','app','src','main','java','cn','local','tomorrow','NotificationCards.java'),'utf8');
 const plan=readFileSync(planFile,'utf8');
 assert.match(plan,/static String labLabel\(Event event\)\{return event!=null&&event\.lab\?"【实验】":"";\}/,'labLabel 必须在 Event.lab 为 true 时返回【实验】，否则空串');
 assert.equal((source.match(/ClassReminderPlan\.labLabel\(e\)/g)||[]).length,2,'lesson 与 live 两个模板都必须取条件前缀');
 assert.match(source,/String headline=prefix\+r\.start\+"–"\+r\.end\+"  "\+room,name=prefix\+r\.name,course=name\+" · "\+teacher;/,'lesson 标题行与正文都加前缀');
 assert.match(source,/bigText\(name\+"\\n时间："/,'lesson 公开版本大文本也加前缀');
 assert.match(source,/String title=prefix\+name\+" · 剩 "/,'live 标题加前缀');
 assert.match(source,/String body=prefix\+r\.start\+"–"\+r\.end\+"  "\+room\+"  "\+teacher;/,'live 正文加前缀');
 const code=source.split('\n').filter(line=>!line.trim().startsWith('//')).join('\n');
 assert.equal(code.includes('【实验】'),false,'【实验】字面量只在 ClassReminderPlan 的条件 helper 中，渲染层代码不得硬编码');
});
