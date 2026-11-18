import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const javaFile=path.join(root,'android','app','src','main','java','cn','local','tomorrow','MainActivity.java');
// 中文用例经 UTF-8 临时文件传给 JVM，不经过命令行参数。
// 原因：Windows 的 java.exe 启动器按进程 ANSI 代码页（GetACP）解码 argv，
// GitHub windows-2022 runner 是 en-US/CP1252，中文会在进入 JVM 前被替换成 '?'；
// 文件通道 + 显式 UTF-8 读写与 runner 的 locale/代码页无关。
// 文件名与分隔符见下：argv 只承载 ASCII 选项、类名与相对文件名。
const CASE_SEP='\u001f';
const JVM_UTF8=['-Dfile.encoding=UTF-8'];

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
      '  public static void main(String[] args)throws Exception{\n'+
      '    java.util.List<String> lines=java.nio.file.Files.readAllLines(java.nio.file.Paths.get("cases.txt"),java.nio.charset.StandardCharsets.UTF_8);\n'+
      '    for(String line:lines){\n'+
      '      int separator=line.indexOf(31);\n'+
      '      if(separator<0)throw new IllegalArgumentException("case line without separator");\n'+
      '      System.out.println(leaveStatus(line.substring(0,separator),line.substring(separator+1)));\n'+
      '    }\n'+
      '  }\n}\n';
    writeFileSync(path.join(dir,'NativeLeaveStatus.java'),java,'utf8');
    // 用例文本按 UTF-8 写盘；每行 "文本\u001fstatusId"，Java 端按同一分隔符切分。
    writeFileSync(path.join(dir,'cases.txt'),cases.map(([text,statusId])=>text+CASE_SEP+String(statusId)).join('\n')+'\n','utf8');
    // cwd 固定为临时目录，javac/java 的 argv 只含 ASCII（相对文件名/类名/选项）：
    // 即使启动器按 CP1252 解码 argv，用例文本也不会受影响；javac 显式声明源码 UTF-8。
    const compile=spawnSync(javaTool('javac'),['-encoding','UTF-8','NativeLeaveStatus.java'],{cwd:dir,encoding:'utf8'});
    if(compile.status!==0)throw new Error('javac 失败：'+(compile.stderr||compile.stdout||compile.error?.message||''));
    const run=spawnSync(javaTool('java'),[...JVM_UTF8,'-cp','.','NativeLeaveStatus','cases.txt'],{cwd:dir,encoding:'utf8'});
    if(run.status!==0)throw new Error('java 失败：'+(run.stderr||run.stdout||run.error?.message||''));
    const results=String(run.stdout).trim().split(/\r?\n/).filter(Boolean);
    if(results.length!==cases.length)throw new Error('原生结果数量不匹配：'+results.length+'/'+cases.length);
    return results;
  }finally{
    try{rmSync(dir,{recursive:true,force:true});}catch{}
  }
}
