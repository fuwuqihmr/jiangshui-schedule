const {app,BrowserWindow,ipcMain,session,safeStorage,Notification,dialog,nativeTheme,shell}=require('electron');
const agreementVersion=require('../web/agreement.json').version;
const fs=require('node:fs/promises');
const path=require('node:path');
const diagnostics=require('./diagnostics.cjs');
let diagnosticWrites=Promise.resolve();
diagnostics.setWriter(event=>{const d=new Date(),stamp=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'}).format(d)+' '+new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(d);diagnosticWrites=diagnosticWrites.then(()=>fs.appendFile(path.join(folder(),'diagnostics.log'),stamp+' '+event+'\n')).catch(()=>{});});
const {fetchJsxsdRows,fetchBundle}=require('./school-source.cjs');
let main,school,schoolSession;
app.setName('江水课表');
const legacyFolder=path.join(app.isPackaged?path.dirname(process.execPath):path.resolve(__dirname,'..','..'),'runtime','tomorrow');
const dataFolder=process.env.TOMORROW_TEST?path.join(path.resolve(__dirname,'..','..'),'runtime','ui-test-'+Date.now()):path.join(app.getPath('appData'),'江水课表');
app.setPath('userData',dataFolder);
app.setAppUserModelId('cn.local.jiangshui.schedule');
if(!process.env.TOMORROW_TEST){if(!app.requestSingleInstanceLock())app.quit();else app.on('second-instance',()=>{if(main){if(main.isMinimized())main.restore();main.show();main.focus();}});}
async function migrateLocalData(){if(process.env.TOMORROW_TEST)return;for(const file of ['state.json','school-session.enc','mobile-token.enc']){try{await fs.access(path.join(dataFolder,file));}catch{try{await fs.copyFile(path.join(legacyFolder,file),path.join(dataFolder,file));}catch{}}}}

const folder=()=>app.getPath('userData');
const consentFile=()=>path.join(folder(),'consent.json');
async function consentStatus(){try{return JSON.parse(await fs.readFile(consentFile(),'utf8'));}catch{return {};}}
async function requireConsent(){const s=await consentStatus();if(s.version!==agreementVersion||!s.acceptedAt)throw Error('请先阅读并同意用户协议');}
const allowed=url=>{try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)&&['portal.juwp.edu.cn','eapp2.juwp.edu.cn','jiaowu.juwp.edu.cn','jiaowuh5.juwp.edu.cn','eapp2.nit.edu.cn'].includes(u.hostname);}catch{return false;}};
let sessionWriteEnabled=true,sessionWrites=Promise.resolve();
function saveSession(){if(!sessionWriteEnabled||!schoolSession||!safeStorage.isEncryptionAvailable())return sessionWrites;sessionWrites=sessionWrites.then(async()=>{if(!sessionWriteEnabled)return;const cookies=(await schoolSession.cookies.get({})).filter(c=>allowed((c.secure?'https://':'http://')+c.domain.replace(/^\./,'')+(c.path||'/')));await fs.mkdir(folder(),{recursive:true});await fs.writeFile(path.join(folder(),'school-session.enc'),safeStorage.encryptString(JSON.stringify(cookies)));}).catch(()=>{});return sessionWrites;}
async function restoreSession(){try{if(!safeStorage.isEncryptionAvailable())return;const data=await fs.readFile(path.join(folder(),'school-session.enc'));for(const c of JSON.parse(safeStorage.decryptString(data))){const url=(c.secure?'https://':'http://')+c.domain.replace(/^\./,'')+(c.path||'/');if(allowed(url)){const clean={url,name:c.name,value:c.value,path:c.path,secure:c.secure,httpOnly:c.httpOnly,sameSite:c.sameSite};if(!c.hostOnly)clean.domain=c.domain;if(c.expirationDate)clean.expirationDate=c.expirationDate;await schoolSession.cookies.set(clean);}}}catch{}}
async function jsxsdCookie(){if(!schoolSession)return '';try{const list=await schoolSession.cookies.get({domain:'jiaowu.juwp.edu.cn'});const b=list.find(c=>c.name==='bzb_jsxsd');return b?'bzb_jsxsd='+b.value:'';}catch{return '';}}
function schoolWindow(mobile=false){if(school&&!school.isDestroyed()){if(mobile)school.loadURL('http://jiaowuh5.juwp.edu.cn/');school.show();school.focus();return;}ssoNavDone=false;autoNavTries=0;school=new BrowserWindow({width:1140,height:820,title:'学校登录 · 仅在本机',webPreferences:{session:schoolSession,nodeIntegration:false,contextIsolation:true,sandbox:true}});school.webContents.setWindowOpenHandler(({url})=>{if(allowed(url))school.loadURL(url);return {action:'deny'};});school.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});school.webContents.on('did-finish-load',async()=>{if(!school||school.isDestroyed())return;saveSession();const url=school.webContents.getURL();diagnostics.record('desktop-page page='+diagnostics.pageName(url));try{if(url.startsWith('http://jiaowuh5.juwp.edu.cn')||url.startsWith('https://jiaowuh5.juwp.edu.cn')){const tok=await school.webContents.executeJavaScript('sessionStorage.getItem("Token")');if(tok&&String(tok).length>4&&safeStorage.isEncryptionAvailable()){await fs.mkdir(folder(),{recursive:true});await fs.writeFile(path.join(folder(),'mobile-token.enc'),safeStorage.encryptString(String(tok)));}}}catch{}autoNav(url);});school.on('closed',()=>{school=null;if(autoNavTimer){clearTimeout(autoNavTimer);autoNavTimer=null;}autoNavBusy=false;saveSession();});school.loadURL(mobile?'http://jiaowuh5.juwp.edu.cn/':'http://portal.juwp.edu.cn');}
let ssoNavDone=false,autoNavTries=0,autoNavBusy=false,autoNavTimer=null;
// 确定性 SSO：从门户页面读出它自己的教务入口链接后直接导航，不依赖任何点击。
function autoNav(url){const win=school;if(!win||win.isDestroyed()||autoNavBusy||ssoNavDone||autoNavTries>=30)return;try{if(new URL(url).hostname!=='portal.juwp.edu.cn')return;}catch{return;}autoNavBusy=true;autoNavTries++;win.webContents.executeJavaScript(`(function(){var a=document.querySelector('a[href*="jiaowu.juwp.edu.cn"]');return {href:a?a.href:'',login:!!document.querySelector('input[type=password]')};})()`).then(page=>{if(win.isDestroyed()||school!==win)return;const href=page?.login?'':page?.href;if(href&&allowed(href)&&new URL(href).hostname==='jiaowu.juwp.edu.cn'){ssoNavDone=true;win.hide();if(main&&!main.isDestroyed())main.focus();win.loadURL(href).catch(()=>{});}else if(!autoNavTimer&&autoNavTries<30){autoNavTimer=setTimeout(()=>{autoNavTimer=null;if(school===win&&!win.isDestroyed())autoNav(win.webContents.getURL());},1000);}}).catch(()=>{}).finally(()=>{autoNavBusy=false;});}
async function ensureJsxsdCookie(timeout=60000){
  let c=await jsxsdCookie();
  if(c)return c;
  if(!school||school.isDestroyed())schoolWindow(false);else {school.show();school.focus();}
  const cur=school.webContents.getURL();
  if(!cur.includes('portal.juwp.edu.cn'))school.loadURL('http://portal.juwp.edu.cn');
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    await new Promise(r=>setTimeout(r,1500));
    c=await jsxsdCookie();
    if(c)return c;
    try{autoNav(school.webContents.getURL());}catch{}
  }
  throw Error('门户登录态不可用：请在已打开的门户窗口登录一次后重试');
}
app.whenReady().then(async()=>{await fs.mkdir(folder(),{recursive:true});await migrateLocalData();schoolSession=session.fromPartition('school-memory');schoolSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));const priorConsent=await consentStatus();if(priorConsent.version===agreementVersion&&priorConsent.acceptedAt)await restoreSession();
main=new BrowserWindow({width:1350,height:930,minWidth:390,minHeight:640,title:'江水课表',icon:path.join(__dirname,'..','assets','app-icon.ico'),backgroundColor:'#f6f7fb',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
main.on('closed',()=>{main=null;if(school&&!school.isDestroyed())school.close();});
const allowedLeaveExternal=value=>{try{const u=new URL(value);return value.startsWith('https://xgxt.juwp.edu.cn/')&&u.protocol==='https:'&&u.hostname==='xgxt.juwp.edu.cn'&&(u.port===''||u.port==='443')&&!u.username&&!u.password&&['/','/sfrz/login343962','/wfw/appInter/openPcApp'].includes(u.pathname);}catch{return false;}};
main.webContents.setWindowOpenHandler(({url})=>{if(allowedLeaveExternal(url))shell.openExternal(url).catch(()=>{});return {action:'deny'};});main.webContents.on('will-navigate',(e,url)=>{if(url!==main.webContents.getURL())e.preventDefault();});
ipcMain.handle('app:request',async(event,action,p={})=>{if(event.sender!==main.webContents)throw Error('未授权的窗口');if(!['consentStatus','acceptConsent','declineConsent'].includes(action))await requireConsent();
switch(action){case 'consentStatus':return await consentStatus();
case 'acceptConsent':if(String(p.version)!==agreementVersion)throw Error('协议已更新，请重新打开应用确认');{const record={version:agreementVersion,acceptedAt:new Date().toISOString()};await fs.writeFile(consentFile()+'.tmp',JSON.stringify(record));await fs.rename(consentFile()+'.tmp',consentFile());await restoreSession();return record;}
case 'declineConsent':setImmediate(()=>app.quit());return {ok:true};
case 'loadState':try{return JSON.parse(await fs.readFile(path.join(folder(),'state.json'),'utf8'));}catch{return null;}
case 'saveState':{const data=JSON.stringify(p.state);if(data.length>8000000)throw Error('本地数据过大');const temporary=path.join(folder(),'state.tmp');await fs.writeFile(temporary,data);await fs.rename(temporary,path.join(folder(),'state.json'));return {ok:true};}
case 'setTheme':nativeTheme.themeSource=p.preference==='system'?'system':p.dark?'dark':'light';if(main)main.setBackgroundColor(String(p.background||'#f6f7fb'));return {ok:true};
case 'requestNotifications':return {ok:Notification.isSupported()};
case 'notify':if(!Notification.isSupported())return {ok:false};new Notification({title:String(p.title).slice(0,100),body:String(p.body).slice(0,500)}).show();return {ok:true};
case 'openSchool':await requireConsent();schoolWindow(!!p.mobile);return {ok:true};
case 'openWebApp':{const target=String(p.url||'');if(target.length>2048||target.indexOf('\\')>=0||target.indexOf('\n')>=0||target.indexOf('\r')>=0||!target.startsWith('https://xgxt.juwp.edu.cn/'))throw Error('请假地址无效');let parsed;try{parsed=new URL(target);}catch{throw Error('请假地址无效');}if(parsed.protocol!=='https:'||parsed.hostname!=='xgxt.juwp.edu.cn'||(parsed.port&&parsed.port!=='443')||parsed.username||parsed.password||!parsed.pathname.startsWith('/')||!['/wfw/appInter/openPcApp','/sfrz/login343962'].includes(parsed.pathname))throw Error('请假地址无效');await shell.openExternal(target);return {ok:true};}
case 'capture':{await requireConsent();if(!school||school.isDestroyed())return {message:'请先打开学校窗口登录'};const host=new URL(school.webContents.getURL()).hostname;
if(host==='jiaowuh5.juwp.edu.cn'){const token=await school.webContents.executeJavaScript('sessionStorage.getItem("Token")');if(!token)throw Error('移动教务尚未登录');if(!safeStorage.isEncryptionAvailable())throw Error('系统凭据保护不可用');await fs.writeFile(path.join(folder(),'mobile-token.enc'),safeStorage.encryptString(token));return {bundle:await fetchBundle(token)};}
const cookie=await ensureJsxsdCookie();if(!cookie)return {message:'请先登录门户，进入教务系统后再读取'};return await fetchJsxsdRows(cookie);}
case 'sync':{await requireConsent();const cookie=await ensureJsxsdCookie();if(cookie)return await fetchJsxsdRows(cookie);let token;try{token=safeStorage.decryptString(await fs.readFile(path.join(folder(),'mobile-token.enc')));}catch{}if(!token)throw Error('请先登录门户进入教务系统，或登录移动教务后读取');return {bundle:await fetchBundle(token)};}
case 'getDiagnostics':await diagnosticWrites;return {platform:'windows',appVersion:app.getVersion(),systemVersion:require('node:os').release(),engineVersion:process.versions.chrome,events:await diagnostics.readEvents(folder())};
case 'recordDiagnostic':{if(!['http','cancelled','session','timeout','structure','network','other'].includes(p.kind)||!Number.isInteger(p.httpStatus)||p.httpStatus<0||p.httpStatus>599)throw Error('排查记录无效');diagnostics.record('import-error kind='+p.kind+' http-status='+p.httpStatus);return {ok:true};}
case 'exportDiagnostics':{if(!/^江水课表-排查日志-[0-9-]+\.txt$/.test(p.filename)||typeof p.text!=='string'||p.text.length>200000)throw Error('排查文件格式无效');const result=await dialog.showSaveDialog(main,{defaultPath:p.filename,filters:[{name:'排查日志',extensions:['txt']}]});if(result.canceled)return {};await fs.writeFile(result.filePath,p.text,'utf8');return {ok:true};}
case 'exportFile':{const file=require('./export-file.cjs').decodeExport(p);const result=await dialog.showSaveDialog(main,{defaultPath:file.filename,filters:[{name:file.mime==='image/png'?'高清课表图片':file.mime==='application/pdf'?'横向课表 PDF':'纯文本课表规则',extensions:[file.extension]}]});if(result.canceled)return {};await fs.writeFile(result.filePath,file.bytes);return {ok:true};}
case 'export':{const result=await dialog.showSaveDialog(main,{defaultPath:'课表快照.json',filters:[{name:'课表快照',extensions:['json']}]});if(result.canceled)return {};await fs.writeFile(result.filePath,String(p.text));return {ok:true};}
case 'import':{const result=await dialog.showOpenDialog(main,{properties:['openFile'],filters:[{name:'课表快照',extensions:['json']}]});if(result.canceled)return {};const stat=await fs.stat(result.filePaths[0]);if(stat.size>2000000)throw Error('文件超过2MB');return {text:await fs.readFile(result.filePaths[0],'utf8')};}
case 'logout':sessionWriteEnabled=false;if(school&&!school.isDestroyed())school.close();await sessionWrites;await schoolSession.clearStorageData();await Promise.all(['state.json','school-session.enc','mobile-token.enc','state.tmp','consent.json'].map(f=>fs.rm(path.join(folder(),f),{force:true})));sessionWriteEnabled=true;return {ok:true};
default:throw Error('不支持的操作');}});
await main.loadFile(path.join(__dirname,'..','web','index.html'));
});
app.on('window-all-closed',()=>app.quit());
