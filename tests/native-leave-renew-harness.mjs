// 真实编译并运行 MainActivity 里与续假相关的纯函数（mergeRenewRecords / renewFailureDiagnostic）。
// org.json 用最小桩，仓库不携带 jar（android/widget-test/json-*.jar 不入库），与 tools/android-login-check.cjs 同一手法。
import {readFileSync,mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
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

function extract(source,regex,label){
  const matched=regex.exec(source);
  if(!matched)throw new Error('未找到 '+label);
  return matched[1];
}

const STUBS={
  'org/json/JSONException.java':'package org.json; public class JSONException extends Exception{public JSONException(String m){super(m);}}',
  'org/json/JSONArray.java':`package org.json;
import java.util.*;
public class JSONArray{
  final List<Object> data=new ArrayList<>();
  public int length(){return data.size();}
  public JSONArray put(Object value)throws JSONException{data.add(value);return this;}
  public Object opt(int index){return index>=0&&index<data.size()?data.get(index):null;}
  public JSONObject optJSONObject(int index){Object value=opt(index);return value instanceof JSONObject?(JSONObject)value:null;}
}`,
  'org/json/JSONObject.java':`package org.json;
import java.util.*;
public class JSONObject{
  final Map<String,Object> data=new LinkedHashMap<>();
  public JSONObject(){}
  public JSONObject put(String key,Object value)throws JSONException{data.put(key,value);return this;}
  public boolean has(String key){return data.containsKey(key);}
  public Object opt(String key){return data.get(key);}
  public String optString(String key){return optString(key,"");}
  public String optString(String key,String fallback){Object value=data.get(key);return value==null?fallback:String.valueOf(value);}
  public boolean optBoolean(String key){return optBoolean(key,false);}
  public boolean optBoolean(String key,boolean fallback){Object value=data.get(key);return value instanceof Boolean?(Boolean)value:fallback;}
  public JSONArray optJSONArray(String key){Object value=data.get(key);return value instanceof JSONArray?(JSONArray)value:null;}
  public JSONObject optJSONObject(String key){Object value=data.get(key);return value instanceof JSONObject?(JSONObject)value:null;}
}`
};

const MAIN=`
  static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
  static JSONObject record(String id,String type)throws Exception{
    JSONObject record=new JSONObject();
    record.put("id",id);
    record.put("type",type);
    return record;
  }
  static JSONArray list(JSONObject... records)throws Exception{
    JSONArray out=new JSONArray();
    for(JSONObject record:records)out.put(record);
    return out;
  }
  static JSONObject okResponse(long fetchedAt,JSONArray records)throws Exception{
    JSONObject out=new JSONObject();
    out.put("ok",true);
    out.put("fetchedAt",fetchedAt);
    out.put("records",records);
    return out;
  }
  static JSONObject errorResponse(String code)throws Exception{
    JSONObject out=new JSONObject();
    out.put("ok",false);
    out.put("code",code);
    return out;
  }
  static long fetchedAt(JSONObject response){return ((Number)response.opt("fetchedAt")).longValue();}
  public static void main(String[] args)throws Exception{
    JSONObject leave=okResponse(111L,list(record("leave-1","leave")));
    JSONObject renew=okResponse(222L,list(record("renew-1","renew"),record("renew-2","renew")));
    JSONObject merged=mergeRenewRecords(leave,renew);
    JSONArray joined=merged.optJSONArray("records");
    check(merged!=null&&merged.optBoolean("ok",false),"合并结果必须 ok");
    check(joined!=null&&joined.length()==3,"请假 1 条 + 续假 2 条应合并为 3 条");
    check("leave-1".equals(joined.optJSONObject(0).optString("id")),"请假记录必须排在前");
    check("renew-1".equals(joined.optJSONObject(1).optString("id")),"续假记录必须保留");
    check("renew".equals(joined.optJSONObject(1).optString("type")),"续假 type 必须原样保留");
    check("renew-2".equals(joined.optJSONObject(2).optString("id")),"续假顺序不变");
    check(fetchedAt(merged)==111L,"fetchedAt 取请假同步时间");
    check(leave.optJSONArray("records").length()==1,"合并不得修改请假入参");
    System.out.println("PASS merge-ok");

    JSONObject duplicated=mergeRenewRecords(
      okResponse(1L,list(record("dup","leave"),record("leave-9","leave"))),
      okResponse(2L,list(record("dup","renew"),record("renew-9","renew"))));
    check(duplicated.optJSONArray("records").length()==3,"重复 id 只保留首条");
    check("leave".equals(duplicated.optJSONArray("records").optJSONObject(0).optString("type")),"重复 id 保留请假表单记录");
    System.out.println("PASS merge-dedupe");

    JSONObject renewFailed=mergeRenewRecords(leave,errorResponse("NEED_RENEW_SESSION"));
    check(renewFailed==leave,"续假失败必须原样返回请假结果");
    JSONObject renewNull=mergeRenewRecords(leave,null);
    check(renewNull==leave,"续假无结果必须原样返回请假结果");
    JSONObject leaveFailed=mergeRenewRecords(errorResponse("NEED_LOGIN"),renew);
    check(!leaveFailed.optBoolean("ok",false)&&"NEED_LOGIN".equals(leaveFailed.optString("code")),"请假失败结果不得被续假改写");
    check(mergeRenewRecords(null,renew)==null,"请假为空时返回空");
    System.out.println("PASS merge-degrade");

    JSONObject noRecords=mergeRenewRecords(okResponse(5L,null),okResponse(6L,new JSONArray()));
    check(noRecords.optBoolean("ok",false)&&noRecords.optJSONArray("records")!=null&&noRecords.optJSONArray("records").length()==0,"缺 records 不得崩且返回空列表");
    JSONArray withNulls=list(record("r1","renew"),(JSONObject)null);
    JSONObject malformed=mergeRenewRecords(okResponse(7L,list(record("l1","leave"))),okResponse(8L,withNulls));
    check(malformed.optJSONArray("records").length()==2,"数组里的非对象元素必须跳过");
    System.out.println("PASS merge-malformed");

    check(renewFailureDiagnostic(okResponse(1L,list()))==null,"续假成功不得产生诊断");
    check("leave-renew-sync failed code=NO_RESULT".equals(renewFailureDiagnostic(null)),"无结果诊断码固定 NO_RESULT");
    check("leave-renew-sync failed code=NEED_RENEW_SESSION".equals(renewFailureDiagnostic(errorResponse("NEED_RENEW_SESSION"))),"会话缺失诊断码透传");
    check("leave-renew-sync failed code=HTTP_500".equals(renewFailureDiagnostic(errorResponse("HTTP_500"))),"HTTP 诊断码只允许安全字符且透传");
    check("leave-renew-sync failed code=UNKNOWN".equals(renewFailureDiagnostic(errorResponse("bad code!"))),"非法诊断码必须归一为 UNKNOWN");
    check(!renewFailureDiagnostic(errorResponse("cookie=abc")).contains("cookie=abc"),"诊断文本不得包含非固定码原文");
    System.out.println("PASS diagnostic");
  }
`;

/** 编译并运行真实 MainActivity 的续假合并/诊断函数；失败时抛错并带上 javac/java 输出。 */
export function runNativeLeaveRenew(){
  const source=readFileSync(javaFile,'utf8');
  const bodies=[
    'static String renewFailureDiagnostic(JSONObject renew){'+extract(source,/static String renewFailureDiagnostic\(JSONObject renew\)\{([\s\S]*?)\n    \}/,'renewFailureDiagnostic')+'}',
    'static void appendLeaveRecords(JSONArray target,java.util.HashSet<String> ids,JSONArray source){'+extract(source,/static void appendLeaveRecords\(JSONArray target,java\.util\.HashSet<String> ids,JSONArray source\)\{([\s\S]*?)\n    \}/,'appendLeaveRecords')+'}',
    'static JSONObject mergeRenewRecords(JSONObject leave,JSONObject renew){'+extract(source,/static JSONObject mergeRenewRecords\(JSONObject leave,JSONObject renew\)\{([\s\S]*?)\n    \}/,'mergeRenewRecords')+'}'
  ];
  const dir=mkdtempSync(path.join(tmpdir(),'native-leave-renew-'));
  try{
    const srcDir=path.join(dir,'src');
    for(const [name,text] of Object.entries(STUBS)){
      const file=path.join(srcDir,name);
      mkdirSync(path.dirname(file),{recursive:true});
      writeFileSync(file,text,'utf8');
    }
    const java='import org.json.*;\npublic class NativeLeaveRenew{\n  '+bodies.join('\n  ')+'\n'+MAIN+'\n}\n';
    writeFileSync(path.join(srcDir,'NativeLeaveRenew.java'),java,'utf8');
    const compile=spawnSync(javaTool('javac'),['-encoding','UTF-8','-d',dir,path.join(srcDir,'NativeLeaveRenew.java'),...Object.keys(STUBS).map(name=>path.join(srcDir,name))],{cwd:dir,encoding:'utf8'});
    if(compile.status!==0)throw new Error('javac 失败：'+(compile.stderr||compile.stdout||compile.error?.message||''));
    const run=spawnSync(javaTool('java'),['-cp',dir,'NativeLeaveRenew'],{cwd:dir,encoding:'utf8'});
    if(run.status!==0)throw new Error('java 失败：'+(run.stderr||run.stdout||run.error?.message||''));
    return String(run.stdout).trim().split(/\r?\n/).filter(Boolean);
  }finally{
    try{rmSync(dir,{recursive:true,force:true});}catch{}
  }
}
