import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {XGXT_ORIGIN,SSO_ENTRY,LEAVE_SERVICES,LEAVE_SERVICE_KEYS,entryUrl,openLeaveService} from '../web/leave.mjs';

const serviceOf=key=>LEAVE_SERVICES.find(service=>service.key===key);
const recordBridge=(impl=async()=>({ok:true}))=>{
 const calls=[];
 return {calls,bridge:{native:{},call:async(action,payload)=>{calls.push({action,payload});return impl(action,payload);}}};
};

test('请假服务常量：三服务 key/label/mappId/formId 与稳定深链',()=>{
 assert.equal(XGXT_ORIGIN,'https://xgxt.juwp.edu.cn');
 assert.equal(SSO_ENTRY,'https://xgxt.juwp.edu.cn/sfrz/login343962');
 assert.deepEqual(LEAVE_SERVICE_KEYS,['leave','cancel','renew']);
 assert.deepEqual(LEAVE_SERVICES.map(service=>[service.key,service.label,service.mappId,service.formId]),[
  ['leave','请假',19998425,'278616'],
  ['cancel','销假',19998424,'278615'],
  ['renew','续假',19998423,'278618']
 ]);
 assert(Object.isFrozen(LEAVE_SERVICES)&&LEAVE_SERVICES.every(Object.isFrozen));
 assert.equal(entryUrl(19998425),'https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425');
 assert.equal(entryUrl('19998424'),'https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998424');
 for(const service of LEAVE_SERVICES){
  const url=entryUrl(service.mappId);
  assert.equal(url,`${XGXT_ORIGIN}/wfw/appInter/openPcApp?mappId=${service.mappId}`);
  assert(!/apply\.html|pageEnc|uuid|oauth|code=/.test(url),'深链不得拼接一次性票据：'+url);
 }
 for(const bad of [19998426,'javascript:alert(1)','https://evil.example/','',null,undefined])assert.throws(()=>entryUrl(bad),/未知的请假服务/,String(bad));
});

test('原生路径：默认带 warmupUrl，warmup:false 不带，返回 via native',async()=>{
 const first=recordBridge();
 const result=await openLeaveService(first.bridge,'leave',{android:true});
 assert.equal(first.calls.length,1);
 assert.equal(first.calls[0].action,'openWebApp');
 assert.deepEqual(first.calls[0].payload,{url:'https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425',warmupUrl:SSO_ENTRY});
 assert.deepEqual(result,{via:'native',key:'leave',label:'请假',url:'https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425'});
 const second=recordBridge();
 await openLeaveService(second.bridge,'cancel',{android:true,warmup:false});
 assert.equal(second.calls.length,1);
 assert.deepEqual(second.calls[0].payload,{url:'https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998424'});
 assert.equal(Object.hasOwn(second.calls[0].payload,'warmupUrl'),false,'warmup:false 时不得出现 warmupUrl 键');
});

test('三个服务分别映射正确 mappId；未知 key 与原生不可用抛明确错误',async()=>{
 for(const [key,mappId] of [['leave',19998425],['cancel',19998424],['renew',19998423]]){
  const {calls,bridge}=recordBridge();
  const result=await openLeaveService(bridge,key,{android:true});
  assert.equal(calls[0].payload.url,`${XGXT_ORIGIN}/wfw/appInter/openPcApp?mappId=${mappId}`);
  assert.equal(result.key,key);assert.equal(result.label,serviceOf(key).label);
 }
 await assert.rejects(openLeaveService(recordBridge().bridge,'unknown',{android:true}),/未知的请假服务/);
 await assert.rejects(openLeaveService({native:null},'leave',{android:true}),/当前版本暂不支持应用内打开/);
 await assert.rejects(openLeaveService({native:{},call:'not-a-function'},'leave',{android:true}),/当前版本暂不支持应用内打开/);
});

test('原生失败：ok:false 抛受控错误，reject 原样透传，不拼 URL',async()=>{
 const failed=recordBridge(async()=>({ok:false,error:'学校页面暂时无法打开'}));
 await assert.rejects(openLeaveService(failed.bridge,'leave',{android:true}),/学校页面暂时无法打开/);
 const rejected=recordBridge(async()=>{throw Error('网络不可用');});
 await assert.rejects(openLeaveService(rejected.bridge,'renew',{android:true}),/网络不可用/);
});

test('纯浏览器路径：两参 window.open、opener 置空；被拦与无 open 抛明确错误',async()=>{
 const previous=globalThis.open;
 const opened=[];
 const fakeWindow={};
 globalThis.open=(...args)=>{opened.push(args);return fakeWindow;};
 try{
  const result=await openLeaveService({native:null},'cancel',{android:false});
  assert.deepEqual(opened,[['https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998424','_blank']],'不得再传 noopener 参数');
  assert.equal(fakeWindow.opener,null,'打开后必须清空 opener');
  assert.deepEqual(result,{via:'window',key:'cancel',label:'销假',url:'https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998424'});
  globalThis.open=()=>null;
  await assert.rejects(openLeaveService({native:null},'leave',{android:false}),/浏览器拦截了新窗口，请允许弹窗后重试/,'无 native 且被拦必须报错');
  await assert.rejects(openLeaveService({native:{}},'leave',{android:false}),/浏览器拦截了新窗口，请允许弹窗后重试/,'没有 call 不算原生桥');
  delete globalThis.open;
  await assert.rejects(openLeaveService({native:null},'leave',{android:false}),/当前环境无法打开外部页面/);
 }finally{
  if(previous===undefined)delete globalThis.open;else globalThis.open=previous;
 }
});

test('原生桥优先：完整 bridge 总走原生；无桥时 Android 报不支持、android:false 走 window.open',async()=>{
 const previousAndroid=globalThis.Android,previousOpen=globalThis.open;
 const opened=[];
 globalThis.open=(...args)=>{opened.push(args);return {};};
 try{
  // 非 Android、显式 android:false，只要有 native+call 就走原生，不调用 window.open。
  const nativeCall=recordBridge();
  const nativeResult=await openLeaveService(nativeCall.bridge,'leave',{android:false});
  assert.equal(nativeResult.via,'native','完整原生桥优先于平台判断');
  assert.equal(nativeCall.calls.length,1);
  assert.deepEqual(nativeCall.calls[0].payload,{url:'https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425',warmupUrl:SSO_ENTRY});
  assert.equal(opened.length,0,'有原生桥时不得调用 window.open');
  // Android 环境但无桥 → 明确不支持（异常态）
  globalThis.Android={};
  await assert.rejects(openLeaveService({native:null},'leave'),/当前版本暂不支持应用内打开/);
  await assert.rejects(openLeaveService({native:{}},'leave'),/当前版本暂不支持应用内打开/,'没有 call 不算原生桥');
  // 无桥且 android:false → 纯浏览器路径
  const windowResult=await openLeaveService({native:null},'renew',{android:false,warmup:false});
  assert.equal(windowResult.via,'window');
  assert.equal(opened.length,1);
  assert.deepEqual(opened[0],['https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998423','_blank']);
 }finally{
  if(previousAndroid===undefined)delete globalThis.Android;else globalThis.Android=previousAndroid;
  if(previousOpen===undefined)delete globalThis.open;else globalThis.open=previousOpen;
 }
});

test('安全静态检查：leave.mjs 不实现任何网络/凭据/存储访问',()=>{
 const source=readFileSync(new URL('../web/leave.mjs',import.meta.url),'utf8');
 const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
 for(const token of ['fetch(','XMLHttpRequest','document.cookie','localStorage','sessionStorage','X-Token','TGC=','password=','CookieManager','setCookie','Authorization'])
  assert.equal(code.includes(token),false,'leave.mjs 实现代码不得出现 '+token);
});

// 规格 §5.2：原生白名单按 Android Uri 语义判定，host/协议必须精确小写匹配。
// 该镜像函数用于在 Node 中验证对抗输入；Java 源码断言确保实现使用同样的精确比较。
function expectedAllowedOpenUrl(raw){
 if(typeof raw!=='string'||raw.length>2048||/[\\\n\r]/.test(raw))return false;
 const matched=/^https:\/\/([^/?#]*)([^?#]*)(?:\?[^#]*)?(?:#.*)?$/.exec(raw);
 if(!matched)return false;
 const authority=matched[1],path=matched[2];
 if(authority.includes('@'))return false;
 let host=authority,port=-1;
 const portMatch=/:(\d+)$/.exec(authority);
 if(portMatch){host=authority.slice(0,portMatch.index);port=Number(portMatch[1]);}
 if(host!=='xgxt.juwp.edu.cn')return false;
 if(port!==-1&&port!==443)return false;
 return path.startsWith('/');
}

test('原生 openWebApp：URL 白名单静态契约与对抗性输入全部拒绝',()=>{
 const java=readFileSync(new URL('../android/app/src/main/java/cn/local/tomorrow/MainActivity.java',import.meta.url),'utf8');
 assert.match(java,/case\s+"openWebApp":/,'Bridge 必须提供 openWebApp');
 assert.match(java,/static\s+boolean\s+allowedOpenUrl\s*\(\s*String\s+raw\s*\)/,'必须校验入口 URL');
 assert.match(java,/static\s+boolean\s+allowedWarmupUrl\s*\(\s*String\s+raw\s*\)/,'必须校验 warmupUrl');
 assert.match(java,/static\s+boolean\s+allowedNav\s*\(\s*Uri\s+u\s*\)/,'必须限制 WebView 内部导航');
 assert.match(java,/openWebApp\s*\([^)]*\)[\s\S]{0,500}allowedOpenUrl\(url\)/,'openWebApp 必须先校验 URL');
 assert.match(java,/allowedWarmupUrl\(warmupUrl\)/);
 // 规格要求精确比较：大写协议/大写 host 不得被接受（lead 对抗性要求）。
 assert.match(java,/"https"\.equals\(u\.getScheme\(\)\)/,'scheme 必须大小写敏感 equals 比较');
 assert.match(java,/"xgxt\.juwp\.edu\.cn"\.equals\(u\.getHost\(\)\)/,'host 必须大小写敏感 equals 比较');
 assert.match(java,/u\.getUserInfo\(\)\s*!=\s*null/,'必须拒绝 userinfo@');
 assert.match(java,/2048/,'必须有长度上限');
 assert.match(java,/indexOf\('\\\\'\)/,'必须拒绝反斜杠');
 assert.match(java,/indexOf\('\\n'\)/,'必须拒绝换行');
 assert.match(java,/indexOf\('\\r'\)/,'必须拒绝回车');
 assert.match(java,/allowedWarmupUrl\s*\(String raw\)\s*\{\s*return raw==null\s*\|\|\s*LEAVE_SSO\.equals\(raw\)/,'warmupUrl 只能为 null 或精确 SSO 入口');
 assert.match(java,/eapp2\.juwp\.edu\.cn/);assert.match(java,/eapp2\.nit\.edu\.cn/);assert.match(java,/9443/,'CAS 9443 端口需放行');
 // lead 裁决：WebView 内部导航来自学校服务器重定向，域名比较保留大小写不敏感；
 // 但必须仍只放行 xgxt 与 CAS eapp2，且端口受限。
 const nav=/static\s+boolean\s+allowedNav\s*\(\s*Uri\s+u\s*\)\s*\{[\s\S]*?\n\s{4}\}/.exec(java)?.[0]||'';
 assert.match(nav,/equalsIgnoreCase/,'内部导航需容忍学校服务器的大小写重定向');
 assert.match(nav,/"xgxt\.juwp\.edu\.cn"/);
 assert.match(nav,/"eapp2\.juwp\.edu\.cn"/);assert.match(nav,/"eapp2\.nit\.edu\.cn"/);
 assert.match(nav,/9443/);assert.match(nav,/443/);
 assert.doesNotMatch(nav,/portal\.juwp\.edu\.cn|jiaowu\.juwp\.edu\.cn|jiaowuh5/, '内部导航不得放行教务/门户域');
 const ssl=/onReceivedSslError[\s\S]{0,300}/.exec(java)?.[0]||'';
 assert.match(ssl,/handler\.cancel\(\)/);
 assert.doesNotMatch(ssl,/handler\.proceed\(\)/);
 assert.match(java,/webApp\s*=\s*new WebView\(this\)/,'请假 WebView 必须独立创建');
 // 主 WebView 的 Android JS 接口是既有功能；请假 WebView 的初始化段不得再注入任何 JS 接口。
 const webAppInit=/void\s+ensureWebApp\s*\(\)\s*\{[\s\S]*?\n\s{4}\}/.exec(java)?.[0]||'';
 assert.match(webAppInit,/webApp\s*=\s*new WebView\(this\)/);
 assert.doesNotMatch(webAppInit,/addJavascriptInterface/,'请假 WebView 不得注入 JS 接口');
 assert.doesNotMatch(java,/webApp\.addJavascriptInterface/,'不得向 webApp 注入 JS 接口');
 // reviewer P1：外部链接必须要求用户手势；下载必须拦截；计时器必须复用单例 Handler。
 assert.match(java,/request\.hasGesture\(\)/,'外部 http(s) 链接必须要求用户手势');
 assert.match(java,/setDownloadListener/,'请假 WebView 必须拦截下载');
 assert.match(java,/final\s+Handler\s+webAppHandler\s*=\s*new\s+Handler\(Looper\.getMainLooper\(\)\)/,'计时器必须复用单例 Handler');
 assert.match(java,/webAppHandler\.postDelayed/);assert.match(java,/webAppHandler\.removeCallbacks/);
 // 请假覆盖层与教务读取/登录覆盖层互斥，避免两层叠加。
 const beginSchoolRead=/void\s+beginSchoolRead\s*\(String id,boolean userInitiated\)\{[\s\S]*?\n    \}/.exec(java)?.[0]||'';
 assert.match(java,/void\s+beginSchoolRead\s*\(String id\)\{beginSchoolRead\(id,true\);\}/,'保留单参入口并默认视为用户主动读取');
 assert.match(beginSchoolRead,/if\(schoolReadBlocked\(webAppVisible,pendingFileRequest\)\)/,'请假页打开或等待附件时不得开始课表读取');
 assert.match(java,/static boolean schoolReadBlocked\(boolean webAppVisible,int pendingFileRequest\)\{return webAppVisible\|\|pendingFileRequest!=0;\}/,'守卫条件由纯函数表达，便于行为测试');
 assert.match(beginSchoolRead,/if\(userInitiated\)hideWebApp\(\)/,'仅用户主动读取时才收起请假页');
 assert.match(java,/void\s+openSchool\s*\([^)]*\)\s*\{[^}]*hideWebApp\(\)/,'打开学校登录前必须收起请假覆盖层');

 const good='https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425';
 assert.equal(expectedAllowedOpenUrl(good),true,'合法深链必须接受');
 assert.equal(expectedAllowedOpenUrl('https://xgxt.juwp.edu.cn/sfrz/login343962'),true);
 const bad=[
  'javascript:alert(1)',
  'http://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425',
  'HTTPS://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425',
  'https://xgxt.juwp.edu.cn./wfw/appInter/openPcApp?mappId=19998425',
  'https://XGXT.JUWp.EDU.CN/wfw/appInter/openPcApp?mappId=19998425',
  'https://xgxt.juwp.edu.cn.evil.example/wfw/appInter/openPcApp?mappId=19998425',
  'https://evil.example/?u=https://xgxt.juwp.edu.cn/',
  '//evil.example/wfw/appInter/openPcApp?mappId=19998425',
  'https://user@xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425',
  'https://xgxt.juwp.edu.cn:8443/wfw/appInter/openPcApp?mappId=19998425',
  'https://xgxt.juwp.edu.cn\\@evil.example/',
  ' https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425',
  'https://xgxt.juwp.edu.cn',
  'file:///data/data/cn.local.tomorrow/',
  'content://com.example/x',
  'intent://scan/#Intent;scheme=zxing;end',
  ''
 ];
 for(const raw of bad)assert.equal(expectedAllowedOpenUrl(raw),false,'非法入口必须拒绝：'+JSON.stringify(raw));
 assert.equal(expectedAllowedOpenUrl(null),false);
 assert.equal(expectedAllowedOpenUrl('https://xgxt.juwp.edu.cn/'+'a'.repeat(2100)),false,'超长 URL 必须拒绝');
 // warmupUrl 只允许 null 或精确 SSO 入口，任何其他 xgxt 路径/大写/查询串都拒绝。
 const expectedAllowedWarmup=raw=>raw==null||raw===SSO_ENTRY;
 for(const raw of [null,SSO_ENTRY])assert.equal(expectedAllowedWarmup(raw),true,String(raw));
 for(const raw of ['', 'https://xgxt.juwp.edu.cn/', 'https://xgxt.juwp.edu.cn/sfrz/login343962?x=1', 'HTTPS://xgxt.juwp.edu.cn/sfrz/login343962', 'https://XGXT.JUWp.EDU.CN/sfrz/login343962', 'javascript:alert(1)'])
  assert.equal(expectedAllowedWarmup(raw),false,'非法 warmupUrl 必须拒绝：'+JSON.stringify(raw));
});

// Electron 桌面主进程也是 openWebApp 的入口：同样只接受精确的 xgxt 深链与固定路径。
function expectedDesktopAllowed(raw){
 if(typeof raw!=='string'||raw.length>2048)return false;
 if(/[\\\n\r]/.test(raw))return false;
 if(!raw.startsWith('https://xgxt.juwp.edu.cn/'))return false;
 let parsed;try{parsed=new URL(raw);}catch{return false;}
 return parsed.protocol==='https:'&&parsed.hostname==='xgxt.juwp.edu.cn'
  &&(!parsed.port||parsed.port==='443')&&!parsed.username&&!parsed.password
  &&['/wfw/appInter/openPcApp','/sfrz/login343962'].includes(parsed.pathname);
}

test('Electron 桌面 openWebApp：URL 白名单静态契约与对抗性输入全部拒绝',()=>{
 const desktop=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8');
 assert.match(desktop,/case 'openWebApp':/, '桌面 IPC 必须实现 openWebApp');
 assert.match(desktop,/new URL\(target\)/);
 assert.match(desktop,/target\.length>2048/,'必须有长度上限');
 assert.match(desktop,/target\.startsWith\('https:\/\/xgxt\.juwp\.edu\.cn\/'\)/,'入口必须按原始字符串精确前缀校验（大写 host 拒绝）');
 assert.match(desktop,/parsed\.protocol!=='https:'/);
 assert.match(desktop,/parsed\.hostname!=='xgxt\.juwp\.edu\.cn'/);
 assert.match(desktop,/parsed\.username/);assert.match(desktop,/parsed\.password/);
 assert.match(desktop,/\/wfw\/appInter\/openPcApp/,'只放行稳定深链路径');
 assert.match(desktop,/\/sfrz\/login343962/,'只放行 SSO 入口路径');
 assert.match(desktop,/includes\(parsed\.pathname\)/,'路径必须精确白名单');
 assert.match(desktop,/shell\.openExternal\(target\)/,'桌面入口必须交给系统浏览器');
 const good='https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425';
 assert.equal(expectedDesktopAllowed(good),true);
 assert.equal(expectedDesktopAllowed('https://xgxt.juwp.edu.cn/sfrz/login343962'),true);
 assert.equal(expectedDesktopAllowed('https://xgxt.juwp.edu.cn/sfrz/login343962?ticket=ST-1'),true);
 const bad=[
  'javascript:alert(1)','http://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425',
  'HTTPS://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425',
  'https://XGXT.JUWp.EDU.CN/wfw/appInter/openPcApp?mappId=19998425',
  'https://xgxt.juwp.edu.cn./wfw/appInter/openPcApp?mappId=19998425',
  'https://xgxt.juwp.edu.cn.evil.example/wfw/appInter/openPcApp?mappId=19998425',
  'https://user@xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425',
  'https://xgxt.juwp.edu.cn:8443/wfw/appInter/openPcApp?mappId=19998425',
  '//evil.example/wfw/appInter/openPcApp?mappId=19998425',
  'https://xgxt.juwp.edu.cn\\@evil.example/',
  'https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425\nX-Evil: 1',
  'https://xgxt.juwp.edu.cn/office/apps/forms/web/apply.html',
  'file:///data/data/cn.local.tomorrow/',''
 ];
 for(const raw of bad)assert.equal(expectedDesktopAllowed(raw),false,'桌面入口必须拒绝：'+JSON.stringify(raw));
 assert.equal(expectedDesktopAllowed('https://xgxt.juwp.edu.cn/'+'a'.repeat(2100)),false);
});
