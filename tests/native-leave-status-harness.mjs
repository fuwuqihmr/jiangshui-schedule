import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const javaFile=path.join(root,'android','app','src','main','java','cn','local','tomorrow','MainActivity.java');

function javaTool(name){
  const home=process.env.JAVA_HOME;
  const exe=process.platform==='win32'?name+'.exe':name;
  return home?path.join(home,'bin',exe):exe;
}

function extractLeaveStatus(){
  const source=readFileSync(javaFile,'utf8');
  const matched=/String leaveStatus\(String text,String statusId\)\{([\s\S]*?)\n    \}/.exec(source);
  if(!matched)throw new Error('未找到 leaveStatus(String,String)');
  return matched[1];
}

/** 真实编译并运行 MainActivity 的 leaveStatus，返回每个用例的原生结果。 */
export function runNativeLeaveStatus(cases){
  const dir=mkdtempSync(path.join(tmpdir(),'native-leave-status-'));
  try{
    const body=extractLeaveStatus();
    const java='public class NativeLeaveStatus {\n'+
      '  static String leaveStatus(String text,String statusId){'+body+'}\n'+
      '  public static void main(String[] args){\n'+
      '    for(int i=0;i+1<args.length;i+=2)System.out.println(leaveStatus(args[i],args[i+1]));\n'+
      '  }\n}\n';
    writeFileSync(path.join(dir,'NativeLeaveStatus.java'),java,'utf8');
    const compile=spawnSync(javaTool('javac'),['-encoding','UTF-8','NativeLeaveStatus.java'],{cwd:dir,encoding:'utf8'});
    if(compile.status!==0)throw new Error('javac 失败：'+(compile.stderr||compile.stdout||compile.error?.message||''));
    const args=cases.flatMap(([text,statusId])=>[text,statusId]);
    const run=spawnSync(javaTool('java'),['-cp',dir,'NativeLeaveStatus',...args],{cwd:dir,encoding:'utf8'});
    if(run.status!==0)throw new Error('java 失败：'+(run.stderr||run.stdout||run.error?.message||''));
    const results=String(run.stdout).trim().split(/\r?\n/).filter(Boolean);
    if(results.length!==cases.length)throw new Error('原生结果数量不匹配：'+results.length+'/'+cases.length);
    return results;
  }finally{
    try{rmSync(dir,{recursive:true,force:true});}catch{}
  }
}
