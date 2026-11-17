// 真实编译并运行 Android 桌面小组件 resolver（ScheduleWidgetData.effectiveDay/read）。
// Android 平台类与 org.json 用 tests/fixtures/widget-resolver 下的最小 JVM 桩（与
// tools/android-login-check.cjs、tests/native-leave-renew-harness.mjs 同一手法：仓库不携带
// android.jar / org.json jar，CI 只需 JDK 的 javac/java）。被测代码是仓库中真实的
// ScheduleWidgetData.java，不做正则抽取或复制。
//
// 输出协议：行内用 ASCII 31（单元分隔符）分隔字段，避免课程名中的标点参与转义：
//   SCENARIO<SEP>id
//   ITEM<SEP>key name teacher room start end cancelled localActivity customCourse exam
//   READ<SEP>id hasState status courseCount
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,cpSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const javaFile=path.join(root,'android','app','src','main','java','cn','local','tomorrow','ScheduleWidgetData.java');
const stubDir=path.join(root,'tests','fixtures','widget-resolver');
const SEP=String.fromCharCode(31),NL=String.fromCharCode(10),CR=String.fromCharCode(13);

function javaTool(name){
  const home=process.env.JAVA_HOME;
  const exe=process.platform==='win32'?name+'.exe':name;
  return home?path.join(home,'bin',exe):exe;
}

function collectJava(dir,out){
  for(const name of readdirSync(dir)){
    const file=path.join(dir,name);
    if(statSync(file).isDirectory())collectJava(file,out);
    else if(name.endsWith('.java'))out.push(file);
  }
  return out;
}

// JSON 值 → Java 表达式：对象/数组用 obj()/arr() 构造桩 JSONObject/JSONArray，null 显式转成 Object。
function javaValue(value){
  if(value===null)return '(Object)null';
  if(typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('fixture 含非有限数字');return String(value);}
  if(typeof value==='boolean')return String(value);
  if(Array.isArray(value))return 'arr('+value.map(javaValue).join(',')+')';
  if(typeof value==='object'){
    const entries=Object.entries(value).filter(([,item])=>item!==undefined);
    return 'obj('+entries.map(([key,item])=>JSON.stringify(key)+','+javaValue(item)).join(',')+')';
  }
  throw new Error('fixture 含不支持的值类型: '+typeof value);
}

/**
 * 编译真实 ScheduleWidgetData.java 并在 JVM 上执行。
 * fixtures: [{id,state,date,epoch}]；state 形状即 state.json 子集（snapshot/holidaySettings/...）。
 * 返回 [{id,items,read:{hasState,status,courseCount}}]。
 */
export function runNativeWidgetResolver(fixtures){
  const dir=mkdtempSync(path.join(tmpdir(),'native-widget-resolver-'));
  try{
    const srcDir=path.join(dir,'src');
    cpSync(stubDir,srcDir,{recursive:true});
    const outFile=path.join(dir,'result.txt');
    const scenarios=fixtures.map((fixture)=>{
      const id=JSON.stringify(fixture.id);
      const date=JSON.stringify(fixture.date);
      return [
        '{',
        '  JSONObject state='+javaValue(fixture.state)+';',
        '  JSONObject snapshot=state.optJSONObject("snapshot");',
        '  out.println("SCENARIO"+SEP+'+id+');',
        '  for(ScheduleWidgetData.Item item:ScheduleWidgetData.effectiveDay(state,snapshot,'+date+'))out.println(itemLine(item));',
        '  ScheduleWidgetData.WidgetData widget=ScheduleWidgetData.read(state,'+String(fixture.epoch)+'L);',
        '  out.println("READ"+SEP+'+id+'+SEP+widget.hasState+SEP+widget.status+SEP+widget.courses.size());',
        '}'
      ].join(NL);
    }).join(NL);
    const java=[
      'package cn.local.tomorrow;',
      'import org.json.*;',
      'public class NativeWidgetResolver{',
      '  static final String SEP=String.valueOf((char)31);',
      '  static JSONObject obj(Object... kv)throws Exception{JSONObject out=new JSONObject();for(int i=0;i+1<kv.length;i+=2)out.put((String)kv[i],kv[i+1]);return out;}',
      '  static JSONArray arr(Object... values)throws Exception{JSONArray out=new JSONArray();for(Object value:values)out.put(value);return out;}',
      '  static String nz(String value){return value==null?"":value;}',
      '  static String itemLine(ScheduleWidgetData.Item item){return "ITEM"+SEP+item.key+SEP+nz(item.name)+SEP+nz(item.teacher)+SEP+nz(item.room)+SEP+item.start+SEP+item.end+SEP+item.cancelled+SEP+item.localActivity+SEP+item.customCourse+SEP+item.exam;}',
      '  public static void main(String[] args)throws Exception{',
      '  java.io.PrintWriter out=new java.io.PrintWriter(new java.io.OutputStreamWriter(new java.io.FileOutputStream(args[0]),"UTF-8"),true);',
      scenarios,
      '    out.flush();',
      '  }',
      '}'
    ].join(NL);
    writeFileSync(path.join(srcDir,'cn','local','tomorrow','NativeWidgetResolver.java'),java,'utf8');
    const files=collectJava(srcDir,[]);
    files.push(javaFile);
    const compile=spawnSync(javaTool('javac'),['-encoding','UTF-8','-d',dir,...files],{cwd:dir,encoding:'utf8'});
    if(compile.status!==0)throw new Error('javac 失败：'+(compile.stderr||compile.stdout||compile.error?.message||''));
    const run=spawnSync(javaTool('java'),['-cp',dir,'cn.local.tomorrow.NativeWidgetResolver',outFile],{cwd:dir,encoding:'utf8'});
    if(run.status!==0)throw new Error('java 失败：'+(run.stderr||run.stdout||run.error?.message||''));
    return parseOutput(readFileSync(outFile,'utf8'));
  }finally{
    try{rmSync(dir,{recursive:true,force:true});}catch{}
  }
}

function parseOutput(stdout){
  const scenarios=[];
  let current=null;
  for(const raw of stdout.split(NL)){
    const line=raw.endsWith(CR)?raw.slice(0,-1):raw;
    if(!line)continue;
    const parts=line.split(SEP);
    if(parts[0]==='SCENARIO'){current={id:parts[1],items:[],read:null};scenarios.push(current);}
    else if(parts[0]==='ITEM'&&current){
      current.items.push({key:parts[1],name:parts[2],teacher:parts[3],room:parts[4],start:parts[5],end:parts[6],cancelled:parts[7]==='true',localActivity:parts[8]==='true',customCourse:parts[9]==='true',exam:parts[10]==='true'});
    }
    else if(parts[0]==='READ'&&current)current.read={hasState:parts[2]==='true',status:parts[3],courseCount:Number(parts[4])};
    else throw new Error('无法解析 harness 输出行：'+line);
  }
  return scenarios;
}