import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest=readFileSync(new URL('../android/app/src/main/AndroidManifest.xml',import.meta.url),'utf8');
const java=readFileSync(new URL('../android/app/src/main/java/cn/local/tomorrow/MainActivity.java',import.meta.url),'utf8');
const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');

test('AndroidManifest：加定位与读写日历权限，权限总数 12，不含存储/后台定位/QUERY_ALL',()=>{
 const permissions=[...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map(match=>match[1]);
 assert(permissions.includes('android.permission.ACCESS_FINE_LOCATION'),'必须声明精确位置');
 assert(permissions.includes('android.permission.ACCESS_COARSE_LOCATION'),'必须声明粗略位置');
 const forbidden=['READ_EXTERNAL_STORAGE','WRITE_EXTERNAL_STORAGE','MANAGE_EXTERNAL_STORAGE','ACCESS_BACKGROUND_LOCATION','ACCESS_MEDIA_LOCATION','READ_MEDIA_IMAGES','READ_MEDIA_VIDEO','READ_MEDIA_AUDIO','QUERY_ALL_PACKAGES','CAMERA','RECORD_AUDIO','READ_CONTACTS','READ_PHONE_STATE','GET_ACCOUNTS'];
 for(const name of forbidden)assert.equal(permissions.some(permission=>permission.endsWith('.'+name)),false,'不得声明 '+name);
 const expected=['INTERNET','ACCESS_NETWORK_STATE','ACCESS_COARSE_LOCATION','ACCESS_FINE_LOCATION','POST_NOTIFICATIONS','RECEIVE_BOOT_COMPLETED','SCHEDULE_EXACT_ALARM','FOREGROUND_SERVICE','FOREGROUND_SERVICE_DATA_SYNC','REQUEST_IGNORE_BATTERY_OPTIMIZATIONS','READ_CALENDAR','WRITE_CALENDAR'].map(name=>'android.permission.'+name);
 assert.equal(permissions.length,12,'权限总数必须为 12 项');
 assert(permissions.includes('android.permission.READ_CALENDAR')&&permissions.includes('android.permission.WRITE_CALENDAR'),'必须声明读写日历权限');
 assert.deepEqual([...permissions].sort(),[...expected].sort(),'权限集合必须最小化');
});

test('文件选择器：只挂在请假 WebApp 的 WebChromeClient，使用 SAF 并正确回传 Uri[]',()=>{
 assert.equal((java.match(/onShowFileChooser/g)||[]).length,1,'只允许请假 WebApp 实现一次文件选择器');
 const chooserAt=java.indexOf('onShowFileChooser'),webClientAt=java.indexOf('webApp.setWebChromeClient'),viewClientAt=java.indexOf('webApp.setWebViewClient');
 assert(chooserAt>webClientAt&&chooserAt<viewClientAt,'onShowFileChooser 必须在 webApp 的 WebChromeClient 内');
 assert.match(java,/if\(view!=webApp\|\|callback==null\)/,'非请假 WebView 必须拒绝');
 assert.match(java,/intent=new Intent\(fallback\?Intent\.ACTION_GET_CONTENT:Intent\.ACTION_OPEN_DOCUMENT\)/,'优先 SAF，保留 GET_CONTENT 兜底');
 assert.match(java,/FLAG_GRANT_READ_URI_PERMISSION/);
 assert.match(java,/EXTRA_ALLOW_MULTIPLE/);
 assert.match(java,/getAcceptTypes\(\)/,'必须按页面 accept 类型过滤');
 assert.match(java,/REQ_FILE_CHOOSER/);
 assert.match(java,/"content"\.equals\(u\.getScheme\(\)\)/,'只接受 content:// Uri');
 assert.match(java,/finishFileChooser\(uris\)/);assert.match(java,/finishFileChooser\(null\)/,'取消必须回传 null');
 assert.match(java,/FILE_CHOOSER_TIMEOUT_MS/,'必须有选择超时兜底');
 assert.match(java,/onResume\(\)[\s\S]{0,400}FILE_CHOOSER_TIMEOUT_MS/,'onResume 检查超时');
 assert.doesNotMatch(java,/(READ|WRITE)_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE/,'文件选择不需要存储权限');
});

test('定位：只对 xgxt 源放行，运行时申请 FINE/COARSE 并在拒绝时回调 false',()=>{
 assert.match(java,/setGeolocationEnabled\(true\)/);
 assert.equal((java.match(/onGeolocationPermissionsShowPrompt/g)||[]).length,1,'只允许请假 WebApp 实现地理定位回调');
 assert.match(java,/allowedGeoOrigin\(origin\)/);
 assert.match(java,/"https"\.equals\(u\.getScheme\(\)\)&&"xgxt\.juwp\.edu\.cn"\.equals\(u\.getHost\(\)\)/,'仅精确 xgxt https 源');
 assert.match(java,/u\.getUserInfo\(\)==null/);
 assert.match(java,/callback\.invoke\(origin,false,false\)/,'非白名单源必须拒绝');
 assert.match(java,/requestPermissions\(new String\[\]\{Manifest\.permission\.ACCESS_FINE_LOCATION,Manifest\.permission\.ACCESS_COARSE_LOCATION\},REQ_LOCATION\)/,'申请精确+粗略位置');
 assert.match(java,/hasLocationPermission\(\)/);
 assert.match(java,/onRequestPermissionsResult[\s\S]{0,600}REQ_LOCATION[\s\S]{0,300}pendingGeoCallback\.invoke\(pendingGeoOrigin,granted,false\)/,'权限结果要回传给 WebView');
 assert.match(java,/定位权限未开启/,'拒绝后有可见提示');
});

test('权限状态/跳转 action 与自启动 Intent 兜底',()=>{
 for(const action of ['permissionStatus','autostartSettings','requestExactAlarm','batterySettings','notificationSettings','requestNotifications'])
  assert.match(java,new RegExp(`case "${action}":`),'缺少 Bridge action '+action);
 assert.match(java,/JSONObject permissionStatus\(\)/);
 for(const key of ['notifications','exactAlarm','battery','autostart'])assert.match(java,new RegExp(`status\\.put\\("${key}"`),'状态缺 '+key);
 assert.match(java,/miui\.intent\.action\.OP_AUTO_START/);assert.match(java,/com\.miui\.securitycenter/);
 assert.match(java,/ACTION_APPLICATION_DETAILS_SETTINGS/,'自启动必须有系统设置兜底');
 assert.match(java,/boolean tryStartSettings\(Intent intent\)\{try\{startActivity\(intent\);return true;\}catch\(Exception e\)\{return false;\}\}/,'跳转必须捕获 ActivityNotFound');
 assert.match(java,/自启动无法由应用直接开启|无法打开系统设置，请手动到设置中允许/,'自启动需明确提示手动开启');
 assert.match(java,/ACTION_REQUEST_SCHEDULE_EXACT_ALARM/);assert.match(java,/ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);assert.match(java,/ACTION_APP_NOTIFICATION_SETTINGS/);
});

test('启动时不自动弹系统权限框：onCreate/onResume 不调用 requestPermissions',()=>{
 const onCreate=/void onCreate\(Bundle saved\)\s*\{[\s\S]*?\n    \}/.exec(java)?.[0]||'';
 assert(onCreate.length>0,'找不到 onCreate');
 assert.doesNotMatch(onCreate,/requestPermissions\(/,'启动阶段不得主动弹权限框');
 const onResumeLine=/@Override protected void onResume\(\)\{([^\n]*)\}/.exec(java)?.[1]||'';
 assert(onResumeLine.length>0,'找不到 onResume');
 assert.doesNotMatch(onResumeLine,/requestPermissions\(/,'onResume 不得主动弹权限框');
 // 运行时申请只允许三处：地理定位回调、用户点击“去开启通知”、日历写入/移除用户动作。
 const requests=[...java.matchAll(/requestPermissions\(/g)];
 assert.equal(requests.length,3,'requestPermissions 只应有定位/通知/日历三个用户触发点，实际 '+requests.length);
 assert.match(java,/onGeolocationPermissionsShowPrompt[\s\S]{0,600}requestPermissions\(/);
 assert.match(java,/case "requestNotifications":[\s\S]{0,400}requestPermissions\(/);
 assert.match(java,/if\("calendarSync"\.equals\(action\)\|\|"calendarRemove"\.equals\(action\)\)\{[\s\S]{0,600}requestPermissions\(new String\[\]\{Manifest\.permission\.READ_CALENDAR,Manifest\.permission\.WRITE_CALENDAR\},REQ_CALENDAR\)/,'日历权限只能由写入/移除动作触发');
 assert.doesNotMatch(onCreate,/READ_CALENDAR|WRITE_CALENDAR/,'启动阶段不得触碰日历权限');
});

test('前端权限检查卡片：四行状态、重新检查、自启动说明、无 Android 不渲染',()=>{
 assert.match(app,/function permissionPanel\(\)\{[\s\S]*?if\(!globalThis\.Android\)return ''/);
 assert.match(app,/id="permission-panel"/);
 for(const kind of ['notifications','exact-alarm','battery','autostart'])assert.match(app,new RegExp(`row\\([^\\n]*'${kind}'`),'缺少权限行 '+kind);
 for(const name of ['通知','精确闹钟','电池优化','自启动'])assert.match(app,new RegExp(`row\\('${name}'`),'缺少权限行 '+name);
 assert.match(app,/data-action="permission-refresh"/);assert.match(app,/重新检查/);
 assert.match(app,/data-action="permission-fix"/);assert.match(app,/data-kind="\$\{kind\}"/);
 assert.match(app,/自启动无法由应用直接开启/);
 assert.match(app,/permissionError\?'暂时无法读取权限状态'/);
});

test('一次性权限提示：只弹一次、可跳过、示例模式不弹且不自动申请系统权限',()=>{
 assert.match(app,/PERMISSION_ONBOARDING_KEY='jiangshui-permission-onboarding-v1'/);
 assert.match(app,/localStorage\.getItem\(PERMISSION_ONBOARDING_KEY\)==='1'/);assert.match(app,/localStorage\.setItem\(PERMISSION_ONBOARDING_KEY,'1'\)/);
 assert.match(app,/权限检查（可跳过）/);assert.match(app,/data-action="close">稍后再说/);
 assert.match(app,/if\(permissionOnboardingTried\|\|!globalThis\.Android\|\|sampleState\|\|document\.querySelector\('\.modal'\)\)return/,'示例模式/已有弹窗时不弹');
 // 启动只读取状态并弹“检查提示”，不调用 requestNotifications / requestPermissions。
 const boot=/if\(globalThis\.Android\)setTimeout\(async\(\)=>\{await refreshPermissionStatus\(\);maybeShowPermissionOnboarding\(\);\},800\)/.exec(app)?.[0]||'';
 assert(boot.length>0,'启动时必须只读状态+一次性提示');
 assert.doesNotMatch(boot,/requestNotifications|requestExactAlarm|batterySettings|autostartSettings/,'启动不得自动拉起系统权限/设置页');
});
