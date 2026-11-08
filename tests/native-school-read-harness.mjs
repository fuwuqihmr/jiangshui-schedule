import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const mainPath=new URL('../android/app/src/main/java/cn/local/tomorrow/MainActivity.java',import.meta.url);
const main=readFileSync(mainPath,'utf8');
const method=main.match(/static boolean schoolReadBlocked\(boolean webAppVisible,int pendingFileRequest\)\{return webAppVisible\|\|pendingFileRequest!=0;\}/)?.[0];
if(!method)throw new Error('native-school-read-harness: 未找到 schoolReadBlocked 方法');

export function runNativeSchoolReadBlocked(cases){
  const dir=mkdtempSync(path.join(tmpdir(),'school-read-'));
  try{
    const source=['public class NativeSchoolRead {',method,'public static void main(String[] args){','for(int i=0;i<args.length;i+=2){System.out.println(schoolReadBlocked(Boolean.parseBoolean(args[i]),Integer.parseInt(args[i+1])));}','}','}'].join('\n');
    writeFileSync(path.join(dir,'NativeSchoolRead.java'),source,'utf8');
    execFileSync(process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin','javac'):'javac',['-encoding','UTF-8','-d',dir,path.join(dir,'NativeSchoolRead.java')],{stdio:'pipe'});
    const args=cases.flatMap(([visible,pending])=>[String(visible),String(pending)]);
    const out=execFileSync(process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin','java'):'java',['-cp',dir,'NativeSchoolRead',...args],{encoding:'utf8'});
    return out.trim().split(/\r?\n/).map(line=>line.trim()==='true');
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
}
