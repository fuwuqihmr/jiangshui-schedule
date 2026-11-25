package cn.local.tomorrow;

import android.app.*;
import android.os.*;
import android.Manifest;
import android.content.*;
import android.net.http.SslError;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.drawable.ColorDrawable;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.graphics.Color;
import android.net.Uri;
import android.webkit.*;
import android.widget.*;
import android.security.keystore.*;
import android.util.Base64;
import android.view.View;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.util.Set;
import java.util.ArrayList;

public class MainActivity extends Activity {
    WebView web, school;
    FrameLayout mainLayout;
    LinearLayout schoolLayout; TextView schoolNote;
    String notificationRequest, documentRequest;
    byte[] exportBytes;
    boolean schoolVisible=false;
    WebView webApp;
    LinearLayout webAppLayout;
    TextView webAppNote;
    boolean webAppVisible=false;
    String webAppTargetUrl,webAppWarmupUrl;
    boolean webAppWarmupPending=false,webAppTargetRequested=false,webAppReloginTried=false;
    boolean webAppOfficeLoaded=false,webAppRetargetTried=false;
    Runnable webAppSlowTimer=null;
    final Handler webAppHandler=new Handler(Looper.getMainLooper());
    static final int REQ_FILE_CHOOSER=23,REQ_LOCATION=12,REQ_CALENDAR=13;
    static final long FILE_CHOOSER_TIMEOUT_MS=10*60*1000L;
    static final String PERMISSION_PREFS="permission-onboarding";
    ValueCallback<Uri[]> pendingFileCallback;
    long fileChooserStartedAt=0L;
    int fileChooserGeneration=0,pendingFileRequest=0;
    GeolocationPermissions.Callback pendingGeoCallback;
    String pendingGeoOrigin;
    boolean appDark=false;
    int appBackground=Color.WHITE,appSurface=Color.WHITE;
    String appThemePreference="system";
    boolean pageReady=false, openTodayOnLoad=false,openChangesOnLoad=false;
    String openDateOnLoad=null;
    int ssoStage=0,navTries=0,portalRetries=0,jiaowuRetries=0;
    boolean autoSsoUsed=false;
    String pendingReadId=null;
    java.util.concurrent.atomic.AtomicBoolean autoNavDone=new java.util.concurrent.atomic.AtomicBoolean(false);
    static final Set<String> HOSTS=new java.util.HashSet<>(java.util.Arrays.asList("portal.juwp.edu.cn","eapp2.juwp.edu.cn","jiaowu.juwp.edu.cn","jiaowuh5.juwp.edu.cn","eapp2.nit.edu.cn"));
    static final String XGXT_ORIGIN="https://xgxt.juwp.edu.cn";
    static final String LEAVE_SSO=XGXT_ORIGIN+"/sfrz/login343962";
    static final String LEAVE_PREFS="leave-session";
    static final String LEAVE_FORM_ID="278616";
    static final String LEAVE_LIST_URL=XGXT_ORIGIN+"/office/data/approve/apps/forms/fore/user/list";
    final java.util.concurrent.ExecutorService leaveExecutor=java.util.concurrent.Executors.newSingleThreadExecutor();
    final Object leaveSyncLock=new Object();
    String leaveSyncId=null;
    boolean leaveSyncActive=false;
    Runnable leaveSyncWatchdog=null;
    final java.util.concurrent.ExecutorService calendarExecutor=java.util.concurrent.Executors.newSingleThreadExecutor();
    final Handler calendarHandler=new Handler(Looper.getMainLooper());
    boolean calendarBusy=false;
    String calendarRequestId=null,calendarPendingAction=null;
    JSONObject calendarPendingPayload=null;
    Runnable calendarWatchdog=null;
    // 入口 URL 是 JS/用户可传的攻击面：scheme/host 必须精确小写 equals。
    static boolean allowedOpenUrl(String raw){
        if(raw==null||raw.length()>2048||raw.indexOf('\\')>=0||raw.indexOf('\n')>=0||raw.indexOf('\r')>=0)return false;
        // 其余 C0/DEL 控制字符也一律拒绝（tab、NUL 等）。
        for(int i=0;i<raw.length();i++){char c=raw.charAt(i);if(c<0x20||c==0x7f)return false;}
        try{
            Uri u=Uri.parse(raw);
            if(!"https".equals(u.getScheme())||!"xgxt.juwp.edu.cn".equals(u.getHost())||u.getUserInfo()!=null)return false;
            int port=u.getPort();if(port!=-1&&port!=443)return false;
            String path=u.getPath();return path!=null&&path.startsWith("/");
        }catch(Exception e){return false;}
    }
    static boolean allowedWarmupUrl(String raw){return raw==null||LEAVE_SSO.equals(raw);}
    // 内部导航来自学校服务器重定向，scheme/host 按 RFC 大小写不敏感；
    // 用 equalsIgnoreCase 以免把学校偶发的大写重定向挡掉，导致登录链中断。
    static boolean allowedNav(Uri u){
        if(u==null||!"https".equalsIgnoreCase(u.getScheme())||u.getUserInfo()!=null)return false;
        String raw=u.toString();
        if(raw.length()>2048||raw.indexOf('\\')>=0)return false;
        for(int i=0;i<raw.length();i++){char c=raw.charAt(i);if(c<0x20||c==0x7f)return false;}
        String host=u.getHost();int port=u.getPort();
        if(host==null)return false;
        if("xgxt.juwp.edu.cn".equalsIgnoreCase(host))return port==-1||port==443;
        if("eapp2.juwp.edu.cn".equalsIgnoreCase(host)||"eapp2.nit.edu.cn".equalsIgnoreCase(host))return port==-1||port==443||port==9443;
        return false;
    }
    static boolean isXgxtUrl(Uri u){return u!=null&&"https".equalsIgnoreCase(u.getScheme())&&"xgxt.juwp.edu.cn".equalsIgnoreCase(u.getHost());}
    static boolean isCasUrl(Uri u){if(u==null||!"https".equalsIgnoreCase(u.getScheme()))return false;String host=u.getHost();return "eapp2.juwp.edu.cn".equalsIgnoreCase(host)||"eapp2.nit.edu.cn".equalsIgnoreCase(host);}
    static boolean isOfficePath(String raw){try{Uri u=Uri.parse(raw);return isXgxtUrl(u)&&u.getPath()!=null&&u.getPath().contains("/office/");}catch(Exception e){return false;}}
    static final String LOCAL="https://app.local/";
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        log("onCreate sdk="+Build.VERSION.SDK_INT);
        openChangesOnLoad=getIntent().getBooleanExtra("open_changes",false);openTodayOnLoad=getIntent().getBooleanExtra("open_today",false);openDateOnLoad=getIntent().getStringExtra("open_date");
        try{JSONObject savedState=StateStore.load(this);if(savedState!=null)appThemePreference=savedState.optString("theme","system");}catch(Exception ignored){}
        resolveAppPalette();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS|WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        if(Build.VERSION.SDK_INT>=30)getWindow().setDecorFitsSystemWindows(false);
        if(Build.VERSION.SDK_INT>=28){WindowManager.LayoutParams params=getWindow().getAttributes();params.layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;getWindow().setAttributes(params);}
        web=new WebView(this); configure(web); web.addJavascriptInterface(new Bridge(),"Android");
        mainLayout=new FrameLayout(this){
            final android.graphics.Paint barPaint=new android.graphics.Paint();
            @Override protected void onDraw(android.graphics.Canvas canvas){
                canvas.drawColor(appBackground);barPaint.setColor(appSurface);
                canvas.drawRect(0,getHeight()-getPaddingBottom(),getWidth(),getHeight(),barPaint);
            }
        };
        mainLayout.setWillNotDraw(false);mainLayout.addView(web,new FrameLayout.LayoutParams(-1,-1));
        installSafeInsets(mainLayout);applyWindowTheme();
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView view,String url){
                super.onPageFinished(view,url);
                if(!url.startsWith(LOCAL))return;
                pageReady=true;dispatchSystemTheme();
                if(openChangesOnLoad){openChangesOnLoad=false;openChanges(view);}else if(openTodayOnLoad){openTodayOnLoad=false;openSchedule(view,openDateOnLoad);openDateOnLoad=null;}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest r){return !r.getUrl().toString().startsWith(LOCAL);}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                if(!request.getUrl().toString().startsWith(LOCAL))return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",null,new ByteArrayInputStream(new byte[0]));
                String p=request.getUrl().getPath();if(p.equals("/"))p="/index.html";if(p.contains(".."))return null;
                String mime=p.endsWith(".html")?"text/html":p.endsWith(".css")?"text/css":p.endsWith(".json")?"application/json":p.endsWith(".png")?"image/png":"application/javascript";
                try{return new WebResourceResponse(mime,"UTF-8",getAssets().open(p.substring(1)));}catch(IOException e){return new WebResourceResponse("text/plain","UTF-8",404,"Not found",null,new ByteArrayInputStream(new byte[0]));}
            }
        });
        setContentView(mainLayout);mainLayout.requestApplyInsets();applyWindowTheme();web.loadUrl(LOCAL+"index.html");
        NotificationChannel channel=new NotificationChannel("changes","课表变化",NotificationManager.IMPORTANCE_HIGH);channel.setDescription("近期课表变化提醒");getSystemService(NotificationManager.class).createNotificationChannel(channel);
        CheckScheduler.cancel(this);ClassReminders.reconcile(this);
    }
    static int parseThemeColor(String value){if(value.length()==4)value="#"+value.charAt(1)+value.charAt(1)+value.charAt(2)+value.charAt(2)+value.charAt(3)+value.charAt(3);return Color.parseColor(value);}
    boolean systemDarkMode(){return (getResources().getConfiguration().uiMode&Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES;}
    void resolveAppPalette(){
        appDark="dark".equals(appThemePreference)||("system".equals(appThemePreference)&&systemDarkMode());
        appBackground=Color.parseColor(appDark?"#000000":"blue".equals(appThemePreference)?"#f5f9fc":"purple".equals(appThemePreference)?"#f5f6fa":"#ffffff");
        appSurface=Color.parseColor(appDark?"#121212":"#ffffff");
    }
    void installSafeInsets(View root){root.setOnApplyWindowInsetsListener((v,insets)->{
        if(Build.VERSION.SDK_INT>=30){android.graphics.Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());v.setPadding(safe.left,safe.top,safe.right,safe.bottom);return WindowInsets.CONSUMED;}
        v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();
    });}
    void applyWindowTheme(){
        // The padded native root paints the system bar areas too. Android 15
        // ignores statusBarColor, so changing that color alone leaves a strip.
        boolean dark=schoolVisible||webAppVisible?false:appDark;
        int background=schoolVisible||webAppVisible?Color.WHITE:appBackground;
        getWindow().setBackgroundDrawable(new ColorDrawable(background));
        getWindow().setStatusBarColor(Color.TRANSPARENT);getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if(Build.VERSION.SDK_INT>=29){getWindow().setStatusBarContrastEnforced(false);getWindow().setNavigationBarContrastEnforced(false);}
        int flags=View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        if(!dark)flags|=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        getWindow().getDecorView().setSystemUiVisibility(flags);
        if(Build.VERSION.SDK_INT>=30&&getWindow().getInsetsController()!=null){int mask=android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;getWindow().getInsetsController().setSystemBarsAppearance(dark?0:mask,mask);}
        if(mainLayout!=null)mainLayout.invalidate();if(web!=null)web.setBackgroundColor(appBackground);
        if(schoolLayout!=null)schoolLayout.setBackgroundColor(Color.WHITE);
        if(webAppLayout!=null)webAppLayout.setBackgroundColor(Color.WHITE);
    }
    void dispatchSystemTheme(){
        if("system".equals(appThemePreference)){resolveAppPalette();applyWindowTheme();}
        if(web!=null)web.evaluateJavascript("window.onNativeSystemThemeChanged&&window.onNativeSystemThemeChanged("+systemDarkMode()+")",null);
    }
    @Override public void onConfigurationChanged(Configuration config){super.onConfigurationChanged(config);dispatchSystemTheme();}
    void openChanges(WebView view){view.evaluateJavascript("window.__openChangesRequest=true;if(window.openChanges)window.openChanges()",null);}
    void openSchedule(WebView view,String date){view.evaluateJavascript("window.__openScheduleRequest={date:"+JSONObject.quote(date==null?"":date)+"};if(window.openToday)window.openToday(window.__openScheduleRequest.date)",null);}
    void configure(WebView v){v.getSettings().setJavaScriptEnabled(true);v.getSettings().setDomStorageEnabled(true);v.getSettings().setAllowFileAccess(false);v.getSettings().setAllowContentAccess(false);v.getSettings().setSaveFormData(false);v.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);}
    JSONObject object(String key,Object value){JSONObject o=new JSONObject();try{o.put(key,value);}catch(Exception ignored){}return o;}
    void result(String id,Object value){runOnUiThread(()->{WebView target=web;if(target==null||isFinishing()||isDestroyed())return;try{target.evaluateJavascript("window.onNativeResult("+JSONObject.quote(id)+","+object("value",value).toString()+")",null);}catch(Exception ignored){}});}
    void failure(String id,String message){runOnUiThread(()->{WebView target=web;if(target==null||isFinishing()||isDestroyed())return;try{target.evaluateJavascript("window.onNativeResult("+JSONObject.quote(id)+","+object("error",message).toString()+")",null);}catch(Exception ignored){}});}
    File stateFile(){return new File(getFilesDir(),"state.json");}
    File logFile(){File dir=getExternalFilesDir(null);return dir==null?new File(getFilesDir(),"applog.txt"):new File(dir,"applog.txt");}
    void log(String msg){try{File f=logFile();File dir=f.getParentFile();if(dir!=null&&!dir.exists())dir.mkdirs();String line=new java.text.SimpleDateFormat("MM-dd HH:mm:ss",java.util.Locale.US).format(new java.util.Date())+" "+msg+"\n";try(FileOutputStream out=new FileOutputStream(f,true)){out.write(line.getBytes(StandardCharsets.UTF_8));}}catch(Exception ignored){}}
    byte[] readLimited(InputStream in,int limit)throws IOException {ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){out.write(buf,0,n);if(out.size()>limit)throw new IOException("文件过大");}return out.toByteArray();}
    String unprotect()throws Exception {KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);JSONObject envelope;try(FileInputStream in=openFileInput("school.enc")){envelope=new JSONObject(new String(readLimited(in,100000),StandardCharsets.UTF_8));}Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,store.getKey("school-session",null),new GCMParameterSpec(128,Base64.decode(envelope.getString("iv"),Base64.NO_WRAP)));return new String(cipher.doFinal(Base64.decode(envelope.getString("data"),Base64.NO_WRAP)),StandardCharsets.UTF_8);}
    JSONArray schoolRequest(String endpoint,String query,String token)throws Exception {
        if(!java.util.Arrays.asList("/teachingWeek","/Get_sjkbms","/student/curriculum").contains(endpoint))throw new Exception("不允许的学校请求");
        java.net.HttpURLConnection conn=(java.net.HttpURLConnection)new java.net.URL("http://jiaowuh5.juwp.edu.cn/njwhd"+endpoint+query).openConnection();
        conn.setRequestMethod("POST");conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(20000);conn.setReadTimeout(20000);conn.setRequestProperty("token",token);
        try{if(conn.getResponseCode()!=200)throw new Exception("学校读取失败，请重新确认登录");try(InputStream in=conn.getInputStream()){JSONObject data=new JSONObject(new String(readLimited(in,2000000),StandardCharsets.UTF_8));if(!(data.opt("data") instanceof JSONArray))throw new Exception("学校会话失效或响应结构变化，请重新登录");return data.getJSONArray("data");}}finally{conn.disconnect();}
    }
    String extract(String cookies,String name){if(cookies==null)return null;for(String kv:cookies.split(";")){String[]p=kv.trim().split("=",2);if(p.length==2&&p[0].equals(name))return p[1];}return null;}
    String grab(String text,String regex){java.util.regex.Matcher m=java.util.regex.Pattern.compile(regex).matcher(text);return m.find()?m.group(1):null;}
    String selectedOption(String html,String id){
        java.util.regex.Matcher block=java.util.regex.Pattern.compile("<select[^>]*id=\""+id+"\"[\\s\\S]*?</select>").matcher(html);
        if(!block.find())return null;
        String s=block.group();
        java.util.regex.Matcher m=java.util.regex.Pattern.compile("<option[^>]*selected[^>]*value=\"([^\"]+)\"").matcher(s);
        if(m.find())return m.group(1);
        m=java.util.regex.Pattern.compile("<option[^>]*value=\"([^\"]+)\"[^>]*selected").matcher(s);
        return m.find()?m.group(1):null;
    }
    String httpGet(String pathQuery,String cookie)throws Exception{
        String shortPath=pathQuery.split("\\?")[0];
        java.net.HttpURLConnection conn=(java.net.HttpURLConnection)new java.net.URL("http://jiaowu.juwp.edu.cn:8080/jsxsd"+pathQuery).openConnection();
        conn.setConnectTimeout(20000);conn.setReadTimeout(20000);conn.setInstanceFollowRedirects(false);conn.setRequestProperty("Cookie",cookie);
        try{int code=conn.getResponseCode();if(code!=200){log("httpGet "+shortPath+" status="+code);throw new Exception("学校读取失败，请重新确认登录");}try(InputStream in=conn.getInputStream()){String text=new String(readLimited(in,4000000),StandardCharsets.UTF_8);log("httpGet "+shortPath+" len="+text.length()+" login="+(text.contains("LoginToXk")||text.contains("userAccount")));return text;}}catch(Exception e){log("httpGet-err "+shortPath+" "+e.getMessage());throw e;}finally{conn.disconnect();}
    }
    SchoolClient schoolClient; String activeReadId=null;
    void ensureSchool(){if(schoolClient!=null)return;schoolClient=new SchoolClient(this,new SchoolClient.Listener(){
        public void progress(String text){if(activeReadId!=null)web.evaluateJavascript("window.onNativeProgress&&window.onNativeProgress("+JSONObject.quote(activeReadId)+","+JSONObject.quote(text)+")",null);}
        public void loginRequired(WebView v){school=v;showSchool();}
        public void portalEntered(){showMain();}
        public void success(JSONObject data){String id=activeReadId;activeReadId=null;showMain();if(id!=null)result(id,data);}
        public void failure(String text){String id=activeReadId;activeReadId=null;showMain();if(id!=null)MainActivity.this.failure(id,text);}
    });school=schoolClient.view();hideSchool();}
    void beginSchoolRead(String id){if(webAppVisible)hideWebApp();if(activeReadId!=null){failure(id,"正在读取课表，请稍候");return;}ensureSchool();activeReadId=id;JSONObject profile=null;try{JSONObject saved=StateStore.load(this);if(saved!=null)profile=saved.getJSONObject("snapshot").optJSONObject("studentProfile");}catch(Exception ignored){}schoolClient.start(id,false,profile);}
    void cancelRead(){if(schoolClient!=null)schoolClient.cancel();}
    void showSchool(){if(school==null||schoolVisible)return;schoolLayout=new LinearLayout(this);schoolLayout.setOrientation(LinearLayout.VERTICAL);installSafeInsets(schoolLayout);TextView note=new TextView(this);schoolNote=note;note.setText("请在学校页面完成登录，完成后会自动读取课表");note.setPadding(20,10,20,10);schoolLayout.addView(note);Button back=new Button(this);back.setText(activeReadId!=null?"取消读取并返回课表":"返回课表");back.setOnClickListener(v->{if(activeReadId!=null)cancelRead();else showMain();});schoolLayout.addView(back);if(school.getParent()!=null)((android.view.ViewGroup)school.getParent()).removeView(school);school.setVisibility(View.VISIBLE);school.setAlpha(1f);school.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);schoolLayout.addView(school,new LinearLayout.LayoutParams(-1,0,1));schoolVisible=true;setContentView(schoolLayout);schoolLayout.requestApplyInsets();applyWindowTheme();}
    void hideSchool(){if(school==null)return;if(school.getParent()!=null)((android.view.ViewGroup)school.getParent()).removeView(school);school.setVisibility(View.INVISIBLE);school.setAlpha(0f);school.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);mainLayout.addView(school,new FrameLayout.LayoutParams(-1,-1));if(schoolVisible){if(mainLayout.getParent()!=null)((android.view.ViewGroup)mainLayout.getParent()).removeView(mainLayout);setContentView(mainLayout);mainLayout.requestApplyInsets();}schoolVisible=false;applyWindowTheme();}
    void showMain(){hideSchool();hideWebApp();}
    void openSchool(boolean mobile){if(webAppVisible)hideWebApp();ensureSchool();showSchool();school.loadUrl(mobile?"http://jiaowuh5.juwp.edu.cn/":"http://portal.juwp.edu.cn");}
    void ensureWebApp(){
        if(webApp!=null)return;
        webApp=new WebView(this);
        WebSettings settings=webApp.getSettings();
        settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setSaveFormData(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUseWideViewPort(true);settings.setLoadWithOverviewMode(true);
        settings.setBuiltInZoomControls(true);settings.setDisplayZoomControls(false);settings.setTextZoom(100);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setSupportMultipleWindows(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setGeolocationEnabled(true);
        webApp.setBackgroundColor(Color.WHITE);
        webApp.setDownloadListener((url,userAgent,contentDisposition,mimeType,contentLength)->setWebAppNote("学校页面下载已拦截，请用浏览器打开"));
        webApp.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(view!=webApp||callback==null){if(callback!=null)callback.onReceiveValue(null);return false;}
                return showWebAppFileChooser(callback,params);
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin,GeolocationPermissions.Callback callback){
                if(callback==null)return;
                if(webApp==null||!allowedGeoOrigin(origin)){callback.invoke(origin,false,false);return;}
                if(hasLocationPermission()){callback.invoke(origin,true,false);return;}
                if(pendingGeoCallback!=null)pendingGeoCallback.invoke(pendingGeoOrigin,false,false);
                pendingGeoCallback=callback;pendingGeoOrigin=origin;
                setWebAppNote("请假表单需要位置信息，请允许定位权限");
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},REQ_LOCATION);
            }
        });
        webApp.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();
                if(allowedNav(uri))return false;
                if(request.isForMainFrame()&&uri!=null&&("http".equalsIgnoreCase(uri.getScheme())||"https".equalsIgnoreCase(uri.getScheme()))){
                    if(request.hasGesture()){
                        try{startActivity(new Intent(Intent.ACTION_VIEW,uri));setWebAppNote("已用系统浏览器打开外部链接");}
                        catch(Exception e){setWebAppNote("外部链接无法打开");}
                    }else setWebAppNote("已拦截自动跳转到校外页面");
                }
                return true;
            }
            @Override public void onPageFinished(WebView view,String url){
                super.onPageFinished(view,url);
                if(webApp!=null&&view==webApp){rememberLeaveSession(url);webAppPageFinished(url);}
            }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){
                handler.cancel();cancelWebAppTimer();setWebAppNote("学校安全连接验证失败，请检查系统时间或网络");
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){
                if(request.isForMainFrame()){cancelWebAppTimer();setWebAppNote("学校页面暂时无法连接，请检查网络后点刷新");}
            }
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){
                if(request.isForMainFrame()){cancelWebAppTimer();setWebAppNote("学校页面返回 HTTP "+response.getStatusCode()+"，请稍后重试");}
            }
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){
                if(view==webApp){destroyWebApp();Toast.makeText(MainActivity.this,"请假页面已关闭，请重新打开",Toast.LENGTH_SHORT).show();}
                return true;
            }
        });
        webAppLayout=new LinearLayout(this);
        webAppLayout.setOrientation(LinearLayout.VERTICAL);
        webAppLayout.setBackgroundColor(Color.WHITE);
        installSafeInsets(webAppLayout);
        LinearLayout bar=new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        bar.setPadding(16,10,16,10);
        bar.setBackgroundColor(Color.WHITE);
        Button back=new Button(this);back.setText("返回课表");back.setOnClickListener(v->hideWebApp());
        TextView title=new TextView(this);title.setText("请假服务（实验）");title.setTextSize(16);title.setGravity(android.view.Gravity.CENTER);title.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));
        Button refresh=new Button(this);refresh.setText("刷新");refresh.setOnClickListener(v->{if(webApp==null)return;setWebAppNote("正在刷新…");startWebAppTimer();webApp.reload();});
        bar.addView(back);bar.addView(title);bar.addView(refresh);
        webAppLayout.addView(bar);
        webAppNote=new TextView(this);webAppNote.setTextSize(12);webAppNote.setTextColor(Color.parseColor("#7b8595"));webAppNote.setPadding(16,4,16,10);webAppNote.setText("正在加载学校页面…");
        webAppLayout.addView(webAppNote);
        webAppLayout.addView(webApp,new LinearLayout.LayoutParams(-1,0,1));
    }
    void showWebApp(){
        if(webAppLayout==null)return;
        if(schoolVisible)showMain();
        webAppVisible=true;
        if(webAppLayout.getParent()!=null)((android.view.ViewGroup)webAppLayout.getParent()).removeView(webAppLayout);
        setContentView(webAppLayout);webAppLayout.requestApplyInsets();applyWindowTheme();
    }
    void hideWebApp(){
        boolean wasVisible=webAppVisible;
        webAppVisible=false;cancelWebAppTimer();
        if(pendingGeoCallback!=null){pendingGeoCallback.invoke(pendingGeoOrigin,false,false);pendingGeoCallback=null;pendingGeoOrigin=null;}
        if(pendingFileCallback!=null)finishFileChooser(null);
        if(webAppLayout!=null&&webAppLayout.getParent()!=null)((android.view.ViewGroup)webAppLayout.getParent()).removeView(webAppLayout);
        if(mainLayout!=null){setContentView(mainLayout);mainLayout.requestApplyInsets();}
        applyWindowTheme();
        if(wasVisible&&web!=null&&pageReady)web.evaluateJavascript("window.onLeaveServiceReturn&&window.onLeaveServiceReturn()",null);
    }
    void destroyWebApp(){
        cancelWebAppTimer();webAppVisible=false;
        if(pendingGeoCallback!=null){pendingGeoCallback.invoke(pendingGeoOrigin,false,false);pendingGeoCallback=null;pendingGeoOrigin=null;}
        if(pendingFileCallback!=null){pendingFileCallback.onReceiveValue(null);pendingFileCallback=null;fileChooserStartedAt=0L;}
        if(webAppLayout!=null){
            if(webAppLayout.getParent()!=null)((android.view.ViewGroup)webAppLayout.getParent()).removeView(webAppLayout);
            webAppLayout.removeAllViews();webAppLayout=null;
        }
        if(webApp!=null){webApp.stopLoading();webApp.destroy();webApp=null;}
        webAppNote=null;webAppTargetUrl=null;webAppWarmupUrl=null;
        webAppWarmupPending=false;webAppTargetRequested=false;webAppReloginTried=false;
        webAppOfficeLoaded=false;webAppRetargetTried=false;
        if(mainLayout!=null&&!schoolVisible){setContentView(mainLayout);mainLayout.requestApplyInsets();applyWindowTheme();}
    }
    boolean hasXgxtSession(){
        String header=null;try{header=CookieManager.getInstance().getCookie(XGXT_ORIGIN);}catch(Exception ignored){}
        if(header==null)return false;
        for(String part:header.split(";")){int eq=part.indexOf('=');if(eq>0&&"UID".equals(part.substring(0,eq).trim()))return true;}
        return false;
    }
    void setWebAppNote(String text){if(webAppNote!=null)webAppNote.setText(text);}
    void startWebAppTimer(){
        cancelWebAppTimer();
        webAppSlowTimer=()->{webAppSlowTimer=null;if(webAppVisible)setWebAppNote("加载较慢，可刷新或返回");};
        webAppHandler.postDelayed(webAppSlowTimer,30000);
    }
    void cancelWebAppTimer(){
        if(webAppSlowTimer!=null){webAppHandler.removeCallbacks(webAppSlowTimer);webAppSlowTimer=null;}
    }
    void loadWebAppTarget(){
        if(webApp==null||webAppTargetUrl==null)return;
        webAppTargetRequested=true;setWebAppNote("正在打开请假页面…");startWebAppTimer();webApp.loadUrl(webAppTargetUrl);
    }
    void webAppPageFinished(String url){
        cancelWebAppTimer();
        Uri uri=null;try{uri=Uri.parse(url);}catch(Exception ignored){}
        if(uri==null)return;
        if(isCasUrl(uri)){setWebAppNote("请在学校页面完成统一身份认证登录（本应用不保存密码）");return;}
        if(!isXgxtUrl(uri))return;
        if(webAppWarmupPending){
            if(hasXgxtSession()){webAppWarmupPending=false;if(!webAppTargetRequested)loadWebAppTarget();}
            else{
                webAppWarmupPending=false;setWebAppNote("登录未完成，请在学校页面完成登录");
                // Cookie 写入可能滞后于 onPageFinished，稍后复检一次 UID。
                final WebView view=webApp;
                webAppHandler.postDelayed(()->{
                    if(webApp!=view||webAppTargetRequested||webAppWarmupPending||webAppTargetUrl==null||!webAppVisible)return;
                    if(hasXgxtSession())loadWebAppTarget();
                },450);
            }
            return;
        }
        if(!webAppTargetRequested){if(hasXgxtSession())loadWebAppTarget();return;}
        if(isOfficePath(url)){
            webAppOfficeLoaded=true;
            setWebAppNote("请在学校页面完成请假、销假或续假操作");
            final WebView view=webApp;
            view.evaluateJavascript("(document.body&&document.body.innerText||'').includes('请重新登录')",raw->{
                if(webApp!=view||!"true".equals(raw)||webAppReloginTried)return;
                webAppReloginTried=true;setWebAppNote("学校会话已过期，正在重新登录…");
                if(webAppWarmupUrl!=null){webAppWarmupPending=true;webAppTargetRequested=false;webAppOfficeLoaded=false;startWebAppTimer();view.loadUrl(webAppWarmupUrl);}
                else setWebAppNote("学校会话已过期，请点刷新重新登录");
            });
            return;
        }
        // UID 存在但已失效：CAS 登录后可能落回 xgxt 首页而不是 office 表单。
        // 只自动重载目标一次，避免循环；之后保留页面让用户手动刷新。
        if(!webAppOfficeLoaded&&!webAppRetargetTried&&webAppTargetUrl!=null){
            webAppRetargetTried=true;setWebAppNote("正在打开请假页面…");startWebAppTimer();webApp.loadUrl(webAppTargetUrl);
            return;
        }
        setWebAppNote("请在学校页面完成请假、销假或续假操作");
    }
    void openWebApp(String url,String warmupUrl)throws Exception{
        if(!allowedOpenUrl(url))throw new Exception("不允许的请假地址");
        if(!allowedWarmupUrl(warmupUrl))throw new Exception("不允许的登录地址");
        if(activeReadId!=null||schoolVisible)throw new Exception("正在读取课表，请稍后再打开请假服务");
        webAppTargetUrl=url;webAppWarmupUrl=warmupUrl;webAppTargetRequested=false;webAppReloginTried=false;webAppWarmupPending=false;
        webAppOfficeLoaded=false;webAppRetargetTried=false;
        ensureWebApp();showWebApp();
        if(!hasXgxtSession()&&warmupUrl!=null){webAppWarmupPending=true;setWebAppNote("正在加载学校登录页面…");startWebAppTimer();webApp.loadUrl(warmupUrl);}
        else loadWebAppTarget();
    }
    boolean showWebAppFileChooser(ValueCallback<Uri[]> callback,WebChromeClient.FileChooserParams params){
        if(callback==null)return false;
        int mode=params==null?WebChromeClient.FileChooserParams.MODE_OPEN:params.getMode();
        if(mode!=WebChromeClient.FileChooserParams.MODE_OPEN&&mode!=WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE){
            callback.onReceiveValue(null);setWebAppNote("学校页面请求的文件选择模式暂不支持");return true;
        }
        if(pendingFileCallback!=null)finishFileChooser(null);
        fileChooserGeneration++;
        pendingFileRequest=REQ_FILE_CHOOSER+(fileChooserGeneration%100);
        pendingFileCallback=callback;fileChooserStartedAt=SystemClock.elapsedRealtime();
        try{
            startActivityForResult(buildFileChooserIntent(params,false),pendingFileRequest);
            setWebAppNote("请选择要上传的附件");return true;
        }catch(Exception first){
            try{startActivityForResult(buildFileChooserIntent(params,true),pendingFileRequest);return true;}
            catch(Exception second){finishFileChooser(null);setWebAppNote("无法打开文件选择器，请稍后重试");return true;}
        }
    }
    Intent buildFileChooserIntent(WebChromeClient.FileChooserParams params,boolean fallback){
        Intent intent=new Intent(fallback?Intent.ACTION_GET_CONTENT:Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        boolean multiple=params!=null&&params.getMode()==WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,multiple);
        ArrayList<String> mimes=new ArrayList<>();
        boolean any=false;
        String[] accepts=params==null?null:params.getAcceptTypes();
        if(accepts!=null)for(String raw:accepts){
            if(raw==null)continue;
            String type=raw.trim();if(type.isEmpty())continue;
            if("*/*".equals(type)){any=true;continue;}
            if(type.contains("/")){if(!mimes.contains(type))mimes.add(type);continue;}
            String extension=type.startsWith(".")?type.substring(1):type;
            String mapped=MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase(java.util.Locale.US));
            if(mapped!=null&&!mimes.contains(mapped))mimes.add(mapped);
        }
        if(any||mimes.isEmpty())intent.setType("*/*");
        else if(mimes.size()==1)intent.setType(mimes.get(0));
        else{intent.setType("*/*");intent.putExtra(Intent.EXTRA_MIME_TYPES,mimes.toArray(new String[0]));}
        return intent;
    }
    void finishFileChooser(Uri[] result){
        ValueCallback<Uri[]> callback=pendingFileCallback;
        pendingFileCallback=null;fileChooserStartedAt=0L;pendingFileRequest=0;
        if(callback!=null)callback.onReceiveValue(result);
        if(result==null)setWebAppNote("未选择附件");
        else setWebAppNote(result.length+" 个附件已交给学校页面");
    }
    static boolean allowedGeoOrigin(String origin){
        if(origin==null)return false;
        try{
            Uri u=Uri.parse(origin);
            return "https".equals(u.getScheme())&&"xgxt.juwp.edu.cn".equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443)&&u.getUserInfo()==null;
        }catch(Exception e){return false;}
    }
    boolean hasLocationPermission(){
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED
            ||checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;
    }
    JSONObject permissionStatus(){
        JSONObject status=new JSONObject();
        try{
            status.put("sdk",Build.VERSION.SDK_INT);
            JSONObject notifications=new JSONObject();
            boolean runtime=Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED;
            boolean granted=Build.VERSION.SDK_INT<33||checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED;
            boolean systemEnabled=getSystemService(NotificationManager.class).areNotificationsEnabled();
            notifications.put("runtime",runtime);notifications.put("granted",granted);notifications.put("systemEnabled",systemEnabled);notifications.put("allowed",granted&&systemEnabled);
            status.put("notifications",notifications);
            JSONObject exact=new JSONObject();boolean required=Build.VERSION.SDK_INT>=31;
            exact.put("required",required);exact.put("allowed",CheckScheduler.exact(this));status.put("exactAlarm",exact);
            JSONObject battery=new JSONObject();battery.put("exempt",getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName()));status.put("battery",battery);
            JSONObject autostart=new JSONObject();autostart.put("supported",true);autostart.put("known",false);
            String manufacturer=Build.MANUFACTURER==null?"":Build.MANUFACTURER.toLowerCase(java.util.Locale.US);
            autostart.put("oem",manufacturer);autostart.put("openedAt",getSharedPreferences(PERMISSION_PREFS,0).getLong("autostart_opened_at",0));
            status.put("autostart",autostart);
        }catch(Exception ignored){}
        return status;
    }
    boolean isXiaomiDevice(){
        String manufacturer=Build.MANUFACTURER==null?"":Build.MANUFACTURER.toLowerCase(java.util.Locale.US);
        String brand=Build.BRAND==null?"":Build.BRAND.toLowerCase(java.util.Locale.US);
        return manufacturer.contains("xiaomi")||manufacturer.contains("redmi")||manufacturer.contains("poco")||brand.contains("xiaomi")||brand.contains("redmi")||brand.contains("poco");
    }
    void markAutostartOpened(){getSharedPreferences(PERMISSION_PREFS,0).edit().putLong("autostart_opened_at",System.currentTimeMillis()).apply();}
    void openAppDetails(){try{startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));}catch(Exception ignored){}}
    boolean tryStartSettings(Intent intent){try{startActivity(intent);return true;}catch(Exception e){return false;}}
    void openAutostartSettings()throws Exception{
        if(isXiaomiDevice()){
            if(tryStartSettings(new Intent("miui.intent.action.OP_AUTO_START").setComponent(new android.content.ComponentName("com.miui.securitycenter","com.miui.permcenter.autostart.AutoStartManagementActivity")))){markAutostartOpened();return;}
            if(tryStartSettings(new Intent().setComponent(new android.content.ComponentName("com.miui.securitycenter","com.miui.permcenter.permissions.PermissionsEditorActivity")))){markAutostartOpened();return;}
        }
        if(tryStartSettings(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())))){markAutostartOpened();return;}
        throw new Exception("无法打开系统设置，请手动到设置中允许自启动");
    }
    void openExactAlarmSettings(){
        if(Build.VERSION.SDK_INT<31||CheckScheduler.exact(this)){openAppDetails();return;}
        try{startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName())));}
        catch(Exception e){openAppDetails();setWebAppNote("请在本机设置中允许“闹钟和提醒”");}
    }
    void openBatterySettings(){
        if(getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName())){openAppDetails();return;}
        try{startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,Uri.parse("package:"+getPackageName())));return;}
        catch(Exception ignored){}
        try{startActivity(new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));}
        catch(Exception ignored){openAppDetails();}
    }
    void protect(String value)throws Exception {KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);if(!store.containsAlias("school-session")){KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");gen.init(new KeyGenParameterSpec.Builder("school-session",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());gen.generateKey();}Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,store.getKey("school-session",null));JSONObject envelope=object("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP));envelope.put("data",Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP));try(FileOutputStream out=openFileOutput("school.enc",MODE_PRIVATE)){out.write(envelope.toString().getBytes(StandardCharsets.UTF_8));}}
    String queryParameter(Uri uri,String name){try{String value=uri.getQueryParameter(name);return value==null?"":value.trim();}catch(Exception e){return "";}}
    void rememberLeaveSession(String url){
        // 只在请假页 URL 上记忆会话参数；不保存 cookie、账号或密码。
        if(url==null||!url.startsWith(XGXT_ORIGIN+"/office/")||!url.contains("apply.html"))return;
        try{
            Uri uri=Uri.parse(url);
            if(!isXgxtUrl(uri)||uri.getPath()==null||!uri.getPath().contains("apply.html"))return;
            String uid=queryParameter(uri,"uid");
            String pageEnc=queryParameter(uri,"pageEnc");
            String formId=queryParameter(uri,"formid");if(formId.isEmpty())formId=queryParameter(uri,"formId");
            if(!uid.matches("[0-9]{1,30}")||!pageEnc.matches("[A-Za-z0-9_-]{8,256}")||!formId.matches("[0-9]{1,20}"))return;
            getSharedPreferences(LEAVE_PREFS,MODE_PRIVATE).edit().putString("leave.uid",uid).putString("leave.pageEnc."+formId,pageEnc).apply();
        }catch(Exception ignored){}
    }
    JSONObject leaveSyncError(String code){JSONObject out=object("ok",false);try{out.put("code",code);}catch(Exception ignored){}return out;}
    String leaveFormValue(JSONObject fields,String... labels){
        for(String label:labels){String value=fields==null?"":fields.optString(label,"");if(value!=null&&!value.trim().isEmpty())return value.trim();}
        return "";
    }
    JSONObject leaveFormFields(JSONObject item){
        JSONObject fields=new JSONObject();
        JSONArray blocks=item==null?null:item.optJSONArray("formData");
        if(blocks==null)return fields;
        for(int i=0;i<blocks.length();i++){
            JSONObject block=blocks.optJSONObject(i);if(block==null)continue;
            JSONArray rows=block.optJSONArray("fields");if(rows==null)continue;
            for(int j=0;j<rows.length();j++){
                JSONObject field=rows.optJSONObject(j);if(field==null)continue;
                String label=field.optString("label","").trim();if(label.isEmpty()||fields.has(label))continue;
                String value="";JSONArray values=field.optJSONArray("values");
                if(values!=null&&values.length()>0){JSONObject first=values.optJSONObject(0);if(first!=null)value=first.optString("val","");}
                try{fields.put(label,value==null?"":value);}catch(Exception ignored){}
            }
        }
        return fields;
    }
    String leaveStatus(String text,String statusId){
        String value=text==null?"":text.trim();
        if(!value.isEmpty()){
            if(value.matches(".*(驳回|退回|不通过|拒绝|不同意).*"))return "rejected";
            if(value.matches(".*(待|审批中|处理中|审核中).*"))return "pending";
            if(value.matches(".*(通过|批准|同意|已完成).*"))return "approved";
            return "unknown";
        }
        return "2".equals(statusId==null?"":statusId.trim())?"approved":"unknown";
    }
    String leaveIsoTime(String value){
        if(value==null)return "";
        String text=value.trim();if(text.isEmpty())return "";
        if(text.matches("\\d{4}-\\d{2}-\\d{2}"))return text;
        if(text.matches("\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}"))return text.replace(' ','T')+":00+08:00";
        if(text.matches("\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}"))return text.replace(' ','T')+"+08:00";
        return text;
    }
    String leaveSubmittedAt(JSONObject item,JSONObject fields){
        String formValue=leaveFormValue(fields,"请假申请时间","申请时间");
        if(!formValue.isEmpty())return leaveIsoTime(formValue);
        try{
            long ms=Long.parseLong(item.optString("inserttime","").trim());
            if(ms<=0)return "";
            java.text.SimpleDateFormat format=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'+08:00'",java.util.Locale.US);
            format.setTimeZone(java.util.TimeZone.getTimeZone("GMT+8"));
            return format.format(new java.util.Date(ms));
        }catch(Exception e){return "";}
    }
    JSONObject leaveTrimmedRecord(JSONObject item){
        if(item==null)return null;
        String id=item.optString("id","").trim();if(id.isEmpty())id=item.optString("autoId","").trim();
        if(id.isEmpty())return null;
        JSONObject fields=leaveFormFields(item);
        String statusText=item.optString("aprvStatusType","").trim();
        String statusId=item.optString("aprvStatusTypeId","").trim();
        JSONObject out=new JSONObject();
        try{
            out.put("id",id);
            out.put("status",leaveStatus(statusText,statusId));
            out.put("statusText",statusText);
            out.put("statusId",statusId);
            out.put("typeText",leaveFormValue(fields,"请假类型"));
            out.put("reason",leaveFormValue(fields,"请假原因"));
            out.put("startAt",leaveIsoTime(leaveFormValue(fields,"请假开始时间")));
            out.put("endAt",leaveIsoTime(leaveFormValue(fields,"请假结束时间")));
            out.put("submittedAt",leaveSubmittedAt(item,fields));
            out.put("approver",item.optString("allAprvUserList","").trim());
            out.put("number",leaveFormValue(fields,"请假编号"));
            out.put("durationDays",leaveFormValue(fields,"请假时长"));
        }catch(Exception ignored){return null;}
        return out;
    }
    JSONObject fetchLeaveRecords(){
        String cookie=null;
        try{cookie=CookieManager.getInstance().getCookie(XGXT_ORIGIN);}catch(Exception ignored){}
        if(cookie==null||cookie.trim().isEmpty())return leaveSyncError("NEED_LOGIN");
        String uid,pageEnc;
        try{
            SharedPreferences prefs=getSharedPreferences(LEAVE_PREFS,MODE_PRIVATE);
            uid=prefs.getString("leave.uid","");pageEnc=prefs.getString("leave.pageEnc."+LEAVE_FORM_ID,"");
        }catch(Exception e){return leaveSyncError("NEED_SESSION");}
        if(uid==null||pageEnc==null||uid.trim().isEmpty()||pageEnc.trim().isEmpty())return leaveSyncError("NEED_SESSION");
        java.net.HttpURLConnection conn=null;
        try{
            StringBuilder body=new StringBuilder();
            body.append("formId=").append(LEAVE_FORM_ID)
                .append("&uid=").append(java.net.URLEncoder.encode(uid,"UTF-8"))
                .append("&formUserId=0&aprvAppId=").append(LEAVE_FORM_ID)
                .append("&pageEnc=").append(java.net.URLEncoder.encode(pageEnc,"UTF-8"))
                .append("&cpage=1&pageSize=50&desensitization=&startTime=&endTime=");
            byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);
            conn=(java.net.HttpURLConnection)new java.net.URL(LEAVE_LIST_URL).openConnection();
            conn.setRequestMethod("POST");conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(8000);conn.setReadTimeout(12000);
            conn.setDoOutput(true);conn.setFixedLengthStreamingMode(bytes.length);
            conn.setRequestProperty("Content-Type","application/x-www-form-urlencoded; charset=UTF-8");
            conn.setRequestProperty("X-Requested-With","XMLHttpRequest");
            conn.setRequestProperty("Cookie",cookie);
            try(OutputStream out=conn.getOutputStream()){out.write(bytes);out.flush();}
            int code=conn.getResponseCode();
            if(code!=200)return leaveSyncError("HTTP_"+code);
            String text;
            try(InputStream in=conn.getInputStream()){text=new String(readLimited(in,2000000),StandardCharsets.UTF_8);}
            JSONObject root=new JSONObject(text);
            JSONObject data=root.optJSONObject("data");
            JSONArray list=data==null?null:data.optJSONArray("formsUserList");
            if(list==null)return leaveSyncError("PARSE");
            JSONArray records=new JSONArray();
            for(int i=0;i<list.length();i++){
                JSONObject record=leaveTrimmedRecord(list.optJSONObject(i));
                if(record!=null)records.put(record);
            }
            JSONObject result=object("ok",true);
            try{result.put("fetchedAt",System.currentTimeMillis());result.put("records",records);}catch(Exception e){return leaveSyncError("PARSE");}
            return result;
        }catch(java.net.SocketTimeoutException e){return leaveSyncError("TIMEOUT");}
        catch(java.io.InterruptedIOException e){return leaveSyncError("TIMEOUT");}
        catch(org.json.JSONException e){return leaveSyncError("PARSE");}
        catch(java.io.IOException e){return leaveSyncError("NETWORK");}
        catch(Exception e){return leaveSyncError("NETWORK");}
        finally{if(conn!=null)try{conn.disconnect();}catch(Exception ignored){}}
    }
    void finishLeaveSync(String id,JSONObject value){
        synchronized(leaveSyncLock){
            if(!leaveSyncActive||id==null||!id.equals(leaveSyncId))return;
            leaveSyncActive=false;leaveSyncId=null;
            if(leaveSyncWatchdog!=null){webAppHandler.removeCallbacks(leaveSyncWatchdog);leaveSyncWatchdog=null;}
        }
        if(web==null||isFinishing())return;
        result(id,value);
    }
    void beginLeaveRecordSync(String id){
        synchronized(leaveSyncLock){
            if(leaveSyncActive){failure(id,"正在同步假条，请稍候");return;}
            leaveSyncActive=true;leaveSyncId=id;
        }
        leaveSyncWatchdog=()->finishLeaveSync(id,leaveSyncError("TIMEOUT"));
        webAppHandler.postDelayed(leaveSyncWatchdog,15000);
        leaveExecutor.execute(()->{
            JSONObject response;
            try{response=fetchLeaveRecords();}
            catch(Exception e){response=leaveSyncError("NETWORK");}
            finishLeaveSync(id,response==null?leaveSyncError("NETWORK"):response);
        });
    }
    void cancelLeaveSync(){
        synchronized(leaveSyncLock){
            leaveSyncActive=false;leaveSyncId=null;
            if(leaveSyncWatchdog!=null){webAppHandler.removeCallbacks(leaveSyncWatchdog);leaveSyncWatchdog=null;}
        }
    }
    void beginCalendarAction(String id,String action,JSONObject payload){
        if(calendarBusy||calendarRequestId!=null){result(id,CalendarSync.error("CALENDAR_BUSY","日历操作正在进行，请稍候"));return;}
        if("calendarSync".equals(action)||"calendarRemove".equals(action)){
            if(!CalendarSync.hasPermission(this)){
                calendarRequestId=id;calendarPendingAction=action;calendarPendingPayload=payload;
                CalendarSync.markPermissionAsked(this);
                requestPermissions(new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR},REQ_CALENDAR);
                return;
            }
        }
        calendarBusy=true;calendarRequestId=id;
        calendarWatchdog=()->finishCalendarAction(id,CalendarSync.error("CALENDAR_TIMEOUT","读取或写入系统日历超时，请稍后重试"));
        calendarHandler.postDelayed(calendarWatchdog,30000L);
        final JSONObject requestPayload=payload;
        calendarExecutor.execute(()->{
            JSONObject response;
            try{
                if("calendarStatus".equals(action))response=CalendarSync.status(this);
                else if("calendarSync".equals(action))response=CalendarSync.sync(this,requestPayload);
                else if("calendarRemove".equals(action))response=CalendarSync.remove(this);
                else response=CalendarSync.error("CALENDAR_WRITE_FAILED","日历操作无效");
            }catch(Throwable ignored){response=CalendarSync.error("CALENDAR_WRITE_FAILED","写入系统日历失败，请稍后重试");}
            final JSONObject out=response;
            calendarHandler.post(()->finishCalendarAction(id,out));
        });
    }
    void finishCalendarAction(String id,JSONObject response){
        if(!calendarBusy||calendarRequestId==null||!calendarRequestId.equals(id))return;
        calendarBusy=false;calendarRequestId=null;
        if(calendarWatchdog!=null){calendarHandler.removeCallbacks(calendarWatchdog);calendarWatchdog=null;}
        if(web==null||isFinishing()||isDestroyed())return;
        result(id,response);
    }
    void cancelCalendarAction(){
        calendarBusy=false;calendarRequestId=null;calendarPendingAction=null;calendarPendingPayload=null;
        if(calendarWatchdog!=null){calendarHandler.removeCallbacks(calendarWatchdog);calendarWatchdog=null;}
    }
    class Bridge {
        @JavascriptInterface public boolean systemDarkMode(){return MainActivity.this.systemDarkMode();}
        @JavascriptInterface public void request(String id,String action,String payload){runOnUiThread(()->{try{JSONObject p=new JSONObject(payload);if(!java.util.Arrays.asList("consentStatus","acceptConsent","declineConsent","setTheme").contains(action))UserConsent.require(MainActivity.this);switch(action){
            case "consentStatus":result(id,UserConsent.status(MainActivity.this));break;
            case "acceptConsent":{JSONObject accepted=UserConsent.accept(MainActivity.this,p.optString("version"));result(id,accepted);break;}
            case "declineConsent":result(id,object("ok",true));finishAndRemoveTask();break;
            case "loadState": {JSONObject saved=StateStore.load(MainActivity.this);result(id,saved==null?JSONObject.NULL:saved);break;}
            case "saveState": {JSONObject data=p.getJSONObject("state");long revision=StateStore.save(MainActivity.this,data,p.optLong("expectedRevision",-1));ScheduleWidgetProvider.updateAll(MainActivity.this);result(id,object("revision",revision));break;}
            case "setTheme":{String bg=p.optString("background"),surface=p.optString("surface");if(!bg.matches("#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}")||!surface.matches("#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}"))throw new Exception("主题颜色无效");appThemePreference=p.optString("preference","system");appDark=p.optBoolean("dark");appBackground=parseThemeColor(bg);appSurface=parseThemeColor(surface);applyWindowTheme();result(id,object("ok",true));break;}
            case "classReminderStatus":ClassReminders.reconcile(MainActivity.this);result(id,ClassReminders.status(MainActivity.this));break;
            case "previewClassReminder":XiaomiFocus.invalidate();XiaomiFocus.refreshAsync(MainActivity.this,()->{try{result(id,ClassReminders.preview(MainActivity.this,p.optBoolean("lockedTest")));}catch(Exception e){failure(id,"预览通知暂时无法发送");}});break;
            case "classReminderSystemSettings":startActivity(new Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName()).putExtra(android.provider.Settings.EXTRA_CHANNEL_ID,ClassReminders.CHANNEL));result(id,object("ok",true));break;
            case "closeClassReminder":result(id,ClassReminders.close(MainActivity.this,p.getString("id")));break;
            case "notificationSettings":try{startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName()));}catch(Exception e){openAppDetails();}result(id,object("ok",true));break;
            case "permissionStatus":result(id,permissionStatus());break;
            case "autostartSettings":openAutostartSettings();result(id,object("ok",true));break;
            case "runtimeStatus":result(id,CheckScheduler.status(MainActivity.this));break;
            case "requestExactAlarm":openExactAlarmSettings();result(id,object("ok",true));break;
            case "batterySettings":openBatterySettings();result(id,object("ok",true));break;
            case "openSchool":if(p.optBoolean("mobile")){openSchool(true);result(id,object("ok",true));}else beginSchoolRead(id);break;
            case "openWebApp":openWebApp(p.optString("url"),p.isNull("warmupUrl")?null:p.optString("warmupUrl"));result(id,object("ok",true));break;
            case "leaveRecordSync":beginLeaveRecordSync(id);break;
            case "calendarStatus":beginCalendarAction(id,"calendarStatus",p);break;
            case "calendarSync":beginCalendarAction(id,"calendarSync",p);break;
            case "calendarRemove":beginCalendarAction(id,"calendarRemove",p);break;
            case "calendarOpenSettings":openAppDetails();result(id,object("ok",true));break;
            case "cancelRead":cancelRead();result(id,object("ok",true));break;
            case "capture":beginSchoolRead(id);break;
            case "sync":beginSchoolRead(id);break;
            case "requestNotifications":if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){notificationRequest=id;requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},11);}else result(id,object("ok",getSystemService(NotificationManager.class).areNotificationsEnabled()));break;
            case "notify":{NotificationManager nm=getSystemService(NotificationManager.class);if(!nm.areNotificationsEnabled()){result(id,object("ok",false));break;}nm.notify(1001,NotificationCards.message(MainActivity.this,"changes",p.optString("title"),p.optString("body"),"课表变更",NotificationCards.openApp(MainActivity.this,1001),false));result(id,object("ok",true));break;}
            case "import":Intent load=new Intent(Intent.ACTION_OPEN_DOCUMENT);load.setType("application/json");load.addCategory(Intent.CATEGORY_OPENABLE);beginDocument(id,load,21,null);break;
            case "export":Intent output=new Intent(Intent.ACTION_CREATE_DOCUMENT);output.setType("application/json");output.addCategory(Intent.CATEGORY_OPENABLE);output.putExtra(Intent.EXTRA_TITLE,"课表快照.json");beginDocument(id,output,22,p.getString("text").getBytes(StandardCharsets.UTF_8));break;
            case "getDiagnostics":result(id,Diagnostics.read(MainActivity.this));break;
            case "recordDiagnostic":{String kind=p.optString("kind");if(!java.util.Arrays.asList("http","cancelled","session","timeout","structure","network","other").contains(kind))throw new Exception("排查记录无效");int status=p.optInt("httpStatus");if(status<0||status>599)throw new Exception("排查记录无效");StateStore.log(MainActivity.this,"import-error kind="+kind+" http-status="+status);result(id,object("ok",true));break;}
            case "exportDiagnostics":{String name=p.getString("filename"),text=p.getString("text");if(!name.matches("江水课表-排查日志-[0-9-]+\\.txt")||text.length()>200000)throw new Exception("排查文件格式无效");Intent file=new Intent(Intent.ACTION_CREATE_DOCUMENT);file.setType("text/plain");file.addCategory(Intent.CATEGORY_OPENABLE);file.putExtra(Intent.EXTRA_TITLE,name);beginDocument(id,file,22,text.getBytes(StandardCharsets.UTF_8));break;}
            case "exportFile":{String mime=p.getString("mime"),name=p.getString("filename");String extension="image/png".equals(mime)?".png":"application/pdf".equals(mime)?".pdf":"text/plain".equals(mime)?".txt":null;if(extension==null||!name.endsWith(extension)||name.length()>180||name.matches(".*[\\\\/:*?\"<>|].*"))throw new Exception("导出文件格式无效");String encoded=p.getString("base64");if(encoded.length()>44739244)throw new Exception("文件超过32MB");byte[] bytes=Base64.decode(encoded,Base64.NO_WRAP);if(bytes.length==0||bytes.length>32*1024*1024)throw new Exception("文件大小无效");Intent file=new Intent(Intent.ACTION_CREATE_DOCUMENT);file.setType(mime);file.addCategory(Intent.CATEGORY_OPENABLE);file.putExtra(Intent.EXTRA_TITLE,name);beginDocument(id,file,22,bytes);break;}
            case "logout":UserConsent.revoke(MainActivity.this);ClassReminders.clear(MainActivity.this);CheckScheduler.clear(MainActivity.this);cancelRead();cancelLeaveSync();destroyWebApp();getSharedPreferences(LEAVE_PREFS,MODE_PRIVATE).edit().clear().apply();if(schoolClient!=null){schoolClient.destroy();schoolClient=null;school=null;}WebStorage.getInstance().deleteAllData();stateFile().delete();try{SessionVault.clear(MainActivity.this);}catch(Exception ignored){}new File(getFilesDir(),"school.enc").delete();try{KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);if(store.containsAlias("school-session"))store.deleteEntry("school-session");}catch(Exception ignored){}CookieManager.getInstance().removeAllCookies(removed->{CookieManager.getInstance().flush();result(id,object("ok",true));});break;
            default:failure(id,"不支持的操作");
        }}catch(Exception e){failure(id,e.getMessage()==null?"操作失败":e.getMessage());}});}
    }
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] grants){super.onRequestPermissionsResult(code,permissions,grants);if(code==11&&notificationRequest!=null){result(notificationRequest,object("ok",grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED));notificationRequest=null;}if(code==REQ_CALENDAR){String id=calendarRequestId,action=calendarPendingAction;JSONObject payload=calendarPendingPayload;calendarRequestId=null;calendarPendingAction=null;calendarPendingPayload=null;if(id!=null){if(CalendarSync.hasPermission(this))beginCalendarAction(id,action,payload);else result(id,CalendarSync.error("CALENDAR_PERMISSION_DENIED","需要日历权限才能写入，请在系统设置中允许"));}}if(code==REQ_LOCATION){boolean granted=hasLocationPermission();if(pendingGeoCallback!=null)pendingGeoCallback.invoke(pendingGeoOrigin,granted,false);pendingGeoCallback=null;pendingGeoOrigin=null;setWebAppNote(granted?"已允许定位，正在等待学校页面读取位置…":"定位权限未开启，无法自动填写定位；可在系统设置允许位置信息");}}
    private void beginDocument(String id,Intent intent,int request,byte[] bytes) throws Exception {
        if(documentRequest!=null)throw new Exception("请先完成上一次文件操作");
        documentRequest=id;exportBytes=bytes;
        try{startActivityForResult(intent,request);}catch(Exception e){documentRequest=null;exportBytes=null;throw e;}
    }
    @Override protected void onActivityResult(int request,int code,Intent data){
        super.onActivityResult(request,code,data);
        if(request>=REQ_FILE_CHOOSER&&request<REQ_FILE_CHOOSER+100){
            if(request!=pendingFileRequest)return;
            Uri[] uris=null;
            if(code==RESULT_OK&&data!=null){
                ClipData clip=data.getClipData();
                if(clip!=null){
                    ArrayList<Uri> list=new ArrayList<>();
                    for(int i=0;i<clip.getItemCount();i++){Uri u=clip.getItemAt(i).getUri();if(u!=null&&"content".equals(u.getScheme()))list.add(u);}
                    if(!list.isEmpty())uris=list.toArray(new Uri[0]);
                }else{
                    Uri u=data.getData();if(u!=null&&"content".equals(u.getScheme()))uris=new Uri[]{u};
                }
            }
            finishFileChooser(uris);
            if(uris==null&&code==RESULT_OK)setWebAppNote("请选择本机文件");
            return;
        }
        if((request!=21&&request!=22)||documentRequest==null)return;
        String id=documentRequest;byte[] pendingBytes=exportBytes;documentRequest=null;exportBytes=null;
        if(code!=RESULT_OK||data==null||data.getData()==null){result(id,new JSONObject());return;}
        try{
            if(request==21){try(InputStream in=getContentResolver().openInputStream(data.getData())){
                if(in==null)throw new IOException("无法打开文件");
                byte[] bytes=readLimited(in,2000000);if(bytes.length>2000000)throw new Exception("文件超过2MB");
                result(id,object("text",new String(bytes,StandardCharsets.UTF_8)));
            }}else{try(OutputStream out=getContentResolver().openOutputStream(data.getData())){
                if(out==null||pendingBytes==null)throw new IOException("无法写入文件");
                out.write(pendingBytes);out.flush();
            }result(id,object("ok",true));}
        }catch(Exception e){failure(id,"文件读写失败，请重新选择保存位置");}
    }
    @Override protected void onResume(){super.onResume();if(pendingFileCallback!=null&&fileChooserStartedAt>0L&&SystemClock.elapsedRealtime()-fileChooserStartedAt>FILE_CHOOSER_TIMEOUT_MS){finishFileChooser(null);setWebAppNote("选择附件超时，请重试");}dispatchSystemTheme();applyWindowTheme();ScheduleWidgetProvider.updateAll(this);XiaomiFocus.invalidate();ClassReminders.reconcile(this);if(web!=null)web.evaluateJavascript("window.onNativeResume&&window.onNativeResume()",null);}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);if(intent.getBooleanExtra("open_changes",false)){if(pageReady)openChanges(web);else openChangesOnLoad=true;}else if(intent.getBooleanExtra("open_today",false)){String date=intent.getStringExtra("open_date");if(pageReady)openSchedule(web,date);else{openTodayOnLoad=true;openDateOnLoad=date;}}}
    @Override protected void onDestroy(){cancelLeaveSync();cancelCalendarAction();calendarExecutor.shutdownNow();leaveExecutor.shutdownNow();destroyWebApp();if(schoolClient!=null)schoolClient.destroy();schoolClient=null;if(web!=null){web.removeJavascriptInterface("Android");web.destroy();web=null;}super.onDestroy();}
    @Override public void onBackPressed(){
        WebView target=web;
        if(target==null){handleNativeBack();return;}
        try{target.evaluateJavascript("(function(){try{return window.__dsjOnBack?window.__dsjOnBack()===true:false}catch(e){return false}})()",raw->{
            if(target!=web||isFinishing()||isDestroyed())return;
            if("true".equals(raw))return;
            handleNativeBack();
        });}
        catch(Exception ignored){handleNativeBack();}
    }
    void handleNativeBack(){
        if(webAppVisible){if(webApp!=null&&webApp.canGoBack()&&isOfficePath(webApp.getUrl()))webApp.goBack();else hideWebApp();return;}
        if(schoolVisible){if(activeReadId!=null)cancelRead();else showMain();}
        else moveTaskToBack(true);
    }
}



