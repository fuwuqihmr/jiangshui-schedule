import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const script=await readFile(new URL('../web/school-reader.js',import.meta.url),'utf8');
function setup({fetch,login=false,origin='http://jiaowu.juwp.edu.cn:8080',calendar=null,body='',controls=true,fakeTimers=false}={}){
  const calls=[],timers=[],context={location:{origin,pathname:'/jsxsd/xskb/xskb_list.do'},document:{body:{innerText:body},querySelector:()=>login?{}:null,getElementById:id=>controls?{value:id==='xnxq01id'?'2026-2027-1':'mode-test'}:null},window:{__tomorrowRequestId:'request-1',__tomorrowCalendar:calendar},fetch:async(url,opts)=>{calls.push(url);return fetch?fetch(url,opts):{ok:true,text:async()=>url.includes('jxzlzc')?'[{"jszc":25}]':url.includes('xsksap_list')?'{"code":0,"count":1,"data":[{"kssj":"2027-01-04 08:30~09:55","kskcmc":"课程A","kch":"K001","jsxm":"教师甲","js_mc":"考场A","zwh":"1","ksccmc":"场次A"}]}':'{"code":0,"data":[{"kc_mc":"合成测试课","jg0101mc":"测试教师","sktime":"周一第1、2节{第1-16周}(全部)","skddmc":"测试楼","jx0404id":"plan-test","kch":"test"}]}'};},setTimeout:fakeTimers?(fn,ms)=>{const id=timers.length+1;timers.push({id,fn,ms,cleared:false});return id;}:setTimeout,clearTimeout:fakeTimers?id=>{const timer=timers.find(item=>item.id===id);if(timer)timer.cleared=true;}:clearTimeout,AbortController,URLSearchParams,Date,JSON,Error,Object,Number};
  const fire=ms=>{const timer=timers.find(item=>!item.cleared&&item.ms===ms);if(!timer)throw Error('no pending timer '+ms);timer.cleared=true;timer.fn();};
  return {context:vm.createContext(context),calls,timers,fire};
}
test('读取复用DOM并串行请求周数、完整课程，不重复下载HTML',async()=>{const x=setup();await vm.runInContext(script,x.context);assert.equal(x.calls.length,3);assert.match(x.calls[0],/jxzlzc/);assert.match(x.calls[1],/pageSize=500/);assert.match(x.calls[2],/xsksap_list/);assert.equal(x.context.window.__tomorrowRead.rows.length,1);assert.equal(x.context.window.__tomorrowRead.weeks,25);assert.equal(x.context.window.__tomorrowRead.done,true);assert.equal(x.context.window.__tomorrowRead.modeKnown,true);assert.equal(x.context.window.__tomorrowRead.calendarCached,false);});
test('同一会话短期复用日历元数据，但每次重新读取全部课程',async()=>{const x=setup();await vm.runInContext(script,x.context);x.context.window.__tomorrowRequestId='request-2';await vm.runInContext(script,x.context);assert.equal(x.calls.length,5);assert.equal(x.context.window.__tomorrowRead.id,'request-2');assert.match(x.calls[3],/needData=1/);assert.match(x.calls[2],/xsksap_list/);assert.match(x.calls[4],/xsksap_list/,'第二次读取仍重新取考试');assert.equal(x.context.window.__tomorrowRead.calendarCached,true);});
test('不在准确教务来源时拒绝发出任何请求',async()=>{const x=setup({origin:'https://example.invalid'});await vm.runInContext(script,x.context);assert.equal(x.calls.length,0);assert.match(x.context.window.__tomorrowRead.error,/来源不符/);});
test('过期会话的登录页被识别，不把HTML当课表',async()=>{const x=setup({fetch:async()=>({ok:true,text:async()=>'<input type="password">'})});await vm.runInContext(script,x.context);assert.equal(x.calls.length,1);assert.equal(x.context.window.__tomorrowRead.login,true);assert.equal(x.context.window.__tomorrowRead.rows,undefined);});
test('学校会话过期 JSON 页面触发登录恢复，乱码提示也能识别',async()=>{for(const msgContent of ['请先登录系统','璇峰厛鐧诲綍绯荤粺']){const x=setup({body:JSON.stringify({flag1:2,msgContent}),controls:false});await vm.runInContext(script,x.context);assert.equal(x.calls.length,0);assert.equal(x.context.window.__tomorrowRead.login,true);assert.equal(x.context.window.__tomorrowRead.done,true);assert.equal(x.context.window.__tomorrowRead.error,undefined);}});
test('日历接口与课程接口的 JSON 会话过期都触发登录恢复',async()=>{for(const at of [1,2]){let n=0;const x=setup({fetch:async()=>({ok:true,text:async()=>++n===at?'{"flag1":2,"msgContent":"请先登录系统"}':'[{"jszc":25}]'})});await vm.runInContext(script,x.context);assert.equal(x.calls.length,at);assert.equal(x.context.window.__tomorrowRead.login,true);assert.equal(x.context.window.__tomorrowRead.rows,undefined);assert.equal(x.context.window.__tomorrowCalendar,null);}});
test('真正缺少课表控件仍报结构变化，不误触发登录',async()=>{const x=setup({body:'课程页面',controls:false});await vm.runInContext(script,x.context);assert.equal(x.calls.length,0);assert.equal(x.context.window.__tomorrowRead.login,false);assert.match(x.context.window.__tomorrowRead.error,/结构变化/);});
test('账号在其它地方登录（flag1:3）页面触发登录恢复，不报结构错误',async()=>{const x=setup({body:JSON.stringify({flag1:3,msgContent:'您的账号在其它地方登录'}),controls:false});await vm.runInContext(script,x.context);assert.equal(x.calls.length,0);assert.equal(x.context.window.__tomorrowRead.login,true);assert.equal(x.context.window.__tomorrowRead.done,true);assert.equal(x.context.window.__tomorrowRead.error,undefined);});
test('日历与课程接口返回账号在别处登录时都进入一次静默恢复',async()=>{for(const at of [1,2]){let n=0;const x=setup({fetch:async()=>({ok:true,text:async()=>++n===at?'{"flag1":3,"msgContent":"您的账号在其它地方登录"}':'[{"jszc":25}]'})});await vm.runInContext(script,x.context);assert.equal(x.calls.length,at);assert.equal(x.context.window.__tomorrowRead.login,true);assert.equal(x.context.window.__tomorrowRead.rows,undefined);assert.equal(x.context.window.__tomorrowCalendar,null);}});
test('接口失败不写日历缓存或半份课表',async()=>{let n=0;const x=setup({fetch:async()=>({ok:true,text:async()=>++n===1?'[{"jszc":25}]':'<html>invalid</html>'})});await vm.runInContext(script,x.context);assert.equal(x.context.window.__tomorrowCalendar,null);assert.equal(x.context.window.__tomorrowRead.rows,undefined);assert.match(x.context.window.__tomorrowRead.error,/格式变化/);});
test('取消会中止请求；晚到数据不能覆盖新的读取结果',async()=>{let complete;const x=setup({fetch:(_url,{signal})=>new Promise(resolve=>{complete=()=>resolve({ok:true,text:async()=>'[{"jszc":25}]'});assert.equal(signal.aborted,false);})});const pending=vm.runInContext(script,x.context);x.context.window.__tomorrowAbort.abort();x.context.window.__tomorrowRead={id:'new-request',done:false};complete();await pending;assert.equal(x.context.window.__tomorrowRead.id,'new-request');assert.equal(x.context.window.__tomorrowRead.done,false);assert.equal(x.calls.length,1);});

test('HTTP 失败保留具体状态及阶段，不导出学校响应或半份课程',async()=>{for(const at of [1,2]){let n=0;const x=setup({fetch:async()=>++n===at?{ok:false,status:503,text:async()=>'private-server-body'}:{ok:true,text:async()=>'[{"jszc":25}]'}});await vm.runInContext(script,x.context);const r=x.context.window.__tomorrowRead;assert.match(r.error,/HTTP 503/);assert.equal(r.httpStatus,503);assert.equal(r.kind,'http');assert.equal(r.stage,at===1?'weeks':'courses');assert.equal(r.rows,undefined);assert.equal(x.context.window.__tomorrowCalendar,null);assert.doesNotMatch(r.error,/private-server-body/);}});

test('教务读取接口返回 HTTP 401 视为会话过期并进入一次静默 SSO 恢复',async()=>{
 const x=setup({fetch:async()=>({ok:false,status:401,text:async()=>'<html>login</html>'})});
 await vm.runInContext(script,x.context);
 assert.equal(x.calls.length,1);assert.equal(x.context.window.__tomorrowRead.login,true);assert.equal(x.context.window.__tomorrowRead.rows,undefined);assert.match(x.context.window.__tomorrowRead.error,/会话已失效/);
});

const COURSE_JSON='{"code":0,"data":[{"kc_mc":"合成测试课","jg0101mc":"测试教师","sktime":"周一第1、2节{第1-16周}(全部)","skddmc":"测试楼","jx0404id":"plan-test","kch":"test"}]}';
const CALENDAR_JSON='[{"jszc":25}]';
function examRows(n,offset=1){return Array.from({length:n},(_,i)=>({kssj:'2027-01-04 08:30~09:55',kskcmc:'课程'+String(offset+i).padStart(2,'0'),kch:'K'+String(offset+i).padStart(3,'0'),jsxm:'教师甲',js_mc:'考场A',zwh:String(offset+i),ksccmc:'场次A'}));}
function sequenced(fetchImpl){let n=0;return async(url,opts)=>{n++;return fetchImpl(n,url,opts);};}

test('考试段：同源 GET 参数正确，成功后把原始考试行随课表结果透传',async()=>{
 const x=setup();await vm.runInContext(script,x.context);
 const r=x.context.window.__tomorrowRead;
 assert.equal(r.done,true);
 assert.match(x.calls[2],/^\/jsxsd\/xsks\/xsksap_list\?/,'考试请求必须是同源固定路径');
 assert.match(x.calls[2],/pageNum=1/);assert.match(x.calls[2],/pageSize=20/);
 assert.match(x.calls[2],/xnxqid=2026-2027-1/);assert.match(x.calls[2],/xqlb=/);
 assert.equal(r.exams.length,1);
 assert.equal(r.exams[0].kskcmc,'课程A');
 assert.equal(typeof r.examFetchedAt,'string');
 assert(r.examFetchedAt.length>10);
 assert.equal(r.examError,undefined);
 assert.equal(r.rows.length,1,'课表行仍然完整');
});

test('考试段 HTTP 失败只写 examError，不影响课表结果与登录态',async()=>{
 const x=setup({fetch:sequenced((n)=>n===1?{ok:true,text:async()=>CALENDAR_JSON}:n===2?{ok:true,text:async()=>COURSE_JSON}:{ok:false,status:503,text:async()=>'private-server-body'})});
 await vm.runInContext(script,x.context);
 const r=x.context.window.__tomorrowRead;
 assert.equal(x.calls.length,3);
 assert.equal(r.done,true);
 assert.equal(r.rows.length,1);
 assert.equal(r.weeks,25);
 assert.equal(r.login,undefined,'考试失败不得进入登录恢复');
 assert.equal(r.exams,undefined);
 assert.equal(r.examError,'http');
 assert.equal(r.examHttpStatus,503);
 assert.equal(r.error,undefined,'整次读取不应报错');
 assert.doesNotMatch(JSON.stringify({e:r.error}),/private-server-body/);
});

test('考试段返回 HTML 外壳时按格式变化隔离，课表仍成功',async()=>{
 const x=setup({fetch:sequenced((n)=>n===1?{ok:true,text:async()=>CALENDAR_JSON}:n===2?{ok:true,text:async()=>COURSE_JSON}:{ok:true,text:async()=>'<html>login-shell</html>'})});
 await vm.runInContext(script,x.context);
 const r=x.context.window.__tomorrowRead;
 assert.equal(r.rows.length,1);
 assert.equal(r.examError,'format');
 assert.equal(r.login,undefined);
 assert.equal(r.done,true);
});

test('考试段会话过期（flag1:2 或 401）不把整次课表读取拖入登录恢复',async()=>{
 const variants=[
  async()=>({ok:true,text:async()=>JSON.stringify({flag1:2,msgContent:'请先登录系统'})}),
  async()=>({ok:true,text:async()=>JSON.stringify({flag1:3,msgContent:'您的账号在其它地方登录'})}),
  async()=>({ok:false,status:401,text:async()=>'<html>login</html>'}),
 ];
 for(const examResponse of variants){
  const x=setup({fetch:sequenced((n)=>n===1?{ok:true,text:async()=>CALENDAR_JSON}:n===2?{ok:true,text:async()=>COURSE_JSON}:examResponse())});
  await vm.runInContext(script,x.context);
  const r=x.context.window.__tomorrowRead;
  assert.equal(r.rows.length,1,'已读到的课表必须保留');
  assert.equal(r.examError,'session');
  assert.notEqual(r.login,true,'考试段会话问题不触发整次读取的登录恢复');
  assert.equal(r.done,true);
 }
});

test('考试分页：count>首页条数时按同参数取第 2 页并拼接，最多 5 页',async()=>{
 const x=setup({fetch:sequenced((n)=>n===1?{ok:true,text:async()=>CALENDAR_JSON}:n===2?{ok:true,text:async()=>COURSE_JSON}:n===3?{ok:true,text:async()=>JSON.stringify({code:0,count:25,data:examRows(20)})}:{ok:true,text:async()=>JSON.stringify({code:0,count:25,data:examRows(5,21)})})});
 await vm.runInContext(script,x.context);
 const r=x.context.window.__tomorrowRead;
 assert.equal(x.calls.length,4,'第二页只请求一次');
 assert.match(x.calls[3],/pageNum=2/);
 assert.match(x.calls[3],/pageSize=20/);
 assert.equal(r.exams.length,25);
 assert.equal(r.exams[0].kskcmc,'课程01');
 assert.equal(r.exams[24].kskcmc,'课程25');
});

test('考试分页终止条件：count 已读全或首屏不足 pageSize 时不再盲目翻页',async()=>{
 const complete=setup({fetch:sequenced((n)=>n===1?{ok:true,text:async()=>CALENDAR_JSON}:n===2?{ok:true,text:async()=>COURSE_JSON}:{ok:true,text:async()=>JSON.stringify({code:0,count:2,data:examRows(2)})})});
 await vm.runInContext(script,complete.context);
 assert.equal(complete.calls.length,3);
 assert.equal(complete.context.window.__tomorrowRead.exams.length,2);
 const short=setup({fetch:sequenced((n)=>n===1?{ok:true,text:async()=>CALENDAR_JSON}:n===2?{ok:true,text:async()=>COURSE_JSON}:{ok:true,text:async()=>JSON.stringify({code:0,count:100,data:examRows(2)})})});
 await vm.runInContext(script,short.context);
 assert.equal(short.calls.length,3,'首页不足 pageSize 视为数据不足，不盲目翻页');
 assert.equal(short.context.window.__tomorrowRead.exams.length,2);
});

test('考试接口 code!==0 / data 非数组：examError=format（P2-2）',async()=>{
 for(const bodyText of ['{"code":1,"data":[]}','{"code":0,"data":{}}']){
  const x=setup({fetch:sequenced((n)=>n===1?{ok:true,text:async()=>CALENDAR_JSON}:n===2?{ok:true,text:async()=>COURSE_JSON}:{ok:true,text:async()=>bodyText})});
  await vm.runInContext(script,x.context);
  const r=x.context.window.__tomorrowRead;
  assert.equal(r.rows.length,1);
  assert.equal(r.examError,'format');
  assert.equal(r.login,undefined);
  assert.equal(r.done,true);
 }
});

test('考试请求 8s 超时只标记 examError=timeout，课表照常 finish（P1-1）',async()=>{
 const abortable=opts=>new Promise((_resolve,reject)=>{opts.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true});});
 const x=setup({fakeTimers:true,fetch:sequenced((n,url,opts)=>n===1?{ok:true,text:async()=>CALENDAR_JSON}:n===2?{ok:true,text:async()=>COURSE_JSON}:abortable(opts))});
 const pending=vm.runInContext(script,x.context);
 for(let i=0;i<200&&x.calls.length<3;i++) await new Promise(resolve=>setImmediate(resolve));
 assert.equal(x.calls.length,3,'课程读取完成后发出考试请求');
 x.fire(8000);
 await pending;
 const r=x.context.window.__tomorrowRead;
 assert.equal(r.done,true,'超时后整次读取仍必须结束');
 assert.equal(r.rows.length,1,'已读课表不丢');
 assert.equal(r.weeks,25);
 assert.equal(r.exams,undefined);
 assert.equal(r.examError,'timeout');
 assert.equal(r.examHttpStatus,0);
 assert.equal(r.login,undefined);
 assert.equal(r.error,undefined);
});

test('普通课表请求超时仍是整次失败 kind=timeout（既有语义回归）',async()=>{
 const abortable=opts=>new Promise((_resolve,reject)=>{opts.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true});});
 const x=setup({fakeTimers:true,fetch:(url,opts)=>abortable(opts)});
 const pending=vm.runInContext(script,x.context);
 for(let i=0;i<200&&x.calls.length<1;i++) await new Promise(resolve=>setImmediate(resolve));
 x.fire(20000);
 await pending;
 const r=x.context.window.__tomorrowRead;
 assert.equal(r.done,true);
 assert.equal(r.kind,'timeout');
 assert.match(r.error,/超时/);
 assert.equal(r.rows,undefined);
});

test('考试请求被整体取消时不写 examError、不 finish（保持取消语义）',async()=>{
 const abortable=opts=>new Promise((_resolve,reject)=>{opts.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true});});
 const x=setup({fetch:sequenced((n,url,opts)=>n===1?{ok:true,text:async()=>CALENDAR_JSON}:n===2?{ok:true,text:async()=>COURSE_JSON}:abortable(opts))});
 const pending=vm.runInContext(script,x.context);
 for(let i=0;i<200&&x.calls.length<3;i++) await new Promise(resolve=>setImmediate(resolve));
 x.context.window.__tomorrowAbort.abort();
 await pending;
 const r=x.context.window.__tomorrowRead;
 assert.equal(r.done,false);
 assert.equal(r.examError,undefined);
 assert.equal(r.exams,undefined);
 assert.equal(r.error,undefined);
});
