package cn.local.tomorrow;
import android.content.*;import android.net.Uri;import android.os.*;import android.webkit.*;import org.json.*;import java.io.*;import java.nio.charset.StandardCharsets;import java.util.*;
public final class SchoolClient {
 public interface Listener{void progress(String text);void loginRequired(WebView view);void portalEntered();void success(JSONObject data);void failure(String text);}
 static final String ROOT="http://jiaowu.juwp.edu.cn:8080",FRAME=ROOT+"/jsxsd/framework/xsMainV.htmlx",TABLE=ROOT+"/jsxsd/xskb/xskb_list.do?viweType=1",SSO_ENTRY="https://jiaowu.juwp.edu.cn:81/sso.jsp",CAS_COOKIE_URL="https://eapp2.juwp.edu.cn:9443/cas/login";
 static final Set<String> HOSTS=new HashSet<>(Arrays.asList("portal.juwp.edu.cn","eapp2.juwp.edu.cn","jiaowu.juwp.edu.cn","jiaowuh5.juwp.edu.cn","eapp2.nit.edu.cn"));
 final Context context;final Listener listener;final Handler handler=new Handler(Looper.getMainLooper());WebView view;
 String id,owner;boolean background,ssoUsed,script,profileDone,tableReady,awaitingLogin;int stage,generation,deadlineVersion;long started;JSONObject profile;
 public SchoolClient(Context c,Listener l){context=c;listener=l;}
 public WebView view(){if(view==null)create();return view;}
 static boolean jsxsd(String url){try{Uri u=Uri.parse(url);return "http".equals(u.getScheme())&&"jiaowu.juwp.edu.cn".equals(u.getHost())&&u.getPort()==8080&&u.getPath()!=null&&u.getPath().startsWith("/jsxsd/");}catch(Exception e){return false;}}
 boolean current(String request){return request!=null&&request.equals(id);}
 void create(){view=new WebView(context);StateStore.configure(view);WebSettings settings=view.getSettings();settings.setUseWideViewPort(true);settings.setLoadWithOverviewMode(true);settings.setTextZoom(100);settings.setBuiltInZoomControls(true);settings.setDisplayZoomControls(false);view.setInitialScale(0);view.setWebViewClient(new WebViewClient(){
  @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !HOSTS.contains(r.getUrl().getHost())||!("http".equals(r.getUrl().getScheme())||"https".equals(r.getUrl().getScheme()));}
  @Override public void onPageStarted(WebView v,String url,android.graphics.Bitmap icon){script=false;tableReady=false;generation++;}
  @Override public void onPageFinished(WebView v,String url){if(!url.equals(v.getUrl()))return;persistSessionCookies();if(id==null)return;try{Uri u=Uri.parse(url);StateStore.log(context,"page "+u.getHost()+u.getPath());}catch(Exception ignored){}page(url);}
  @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e){if(r.isForMainFrame()&&id!=null){StateStore.log(context,"school-page network-error="+e.getErrorCode()+" page="+Diagnostics.page(r.getUrl().toString())+" method="+Diagnostics.method(r.getMethod()));fail("学校页面暂时无法连接（错误码 "+e.getErrorCode()+"），原课表已保留。可在设置页导出排查日志");}}
  @Override public void onReceivedHttpError(WebView v,WebResourceRequest r,WebResourceResponse e){if(r.isForMainFrame()&&id!=null){String page=Diagnostics.page(r.getUrl().toString());StateStore.log(context,"school-page http-error="+e.getStatusCode()+" page="+page+" method="+Diagnostics.method(r.getMethod()));if(e.getStatusCode()==401&&Arrays.asList("academic-home","timetable","academic").contains(page)){sso("expired-school-cookie");return;}if(!background&&e.getStatusCode()==401&&"POST".equals(r.getMethod())&&"school-login".equals(page)){clearExpiredTgc();needLogin();return;}fail(Diagnostics.label(page)+"返回 HTTP "+e.getStatusCode()+"，原课表已保留。可在设置页导出排查日志");}}
  @Override public void onReceivedSslError(WebView v,SslErrorHandler h,android.net.http.SslError e){h.cancel();if(id!=null){StateStore.log(context,"school-ssl-error page="+Diagnostics.page(e.getUrl()));fail("学校安全连接验证失败，原课表已保留。请检查系统日期或网络后重试");}}
  @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail d){if(id!=null)fail("学校页面进程已回收，保留上次课表");if(v.getParent()!=null)((android.view.ViewGroup)v.getParent()).removeView(v);v.destroy();view=null;return true;}
 });}
 public void start(String request,boolean inBackground,JSONObject cachedProfile){
  if(!UserConsent.granted(context)){listener.failure("请先阅读并同意用户协议");return;}
  if(id!=null){listener.failure("正在读取课表，请稍候");return;}
  String candidate="school-"+request;
  if(!StateStore.acquire(candidate)){listener.failure("正在进行另一项课表检查，请稍后重试");return;}
  owner=candidate;
  try{
   id=request;background=inBackground;awaitingLogin=false;ssoUsed=false;script=false;stage=0;profile=cachedProfile;profileDone=profile!=null;started=SystemClock.elapsedRealtime();view();listener.progress("正在检查学校会话…");timeout(90000);StateStore.log(context,"read-start background="+background+" profile-known="+profileDone);
   restoreCookies(request);
  }catch(Exception e){
   // 任何启动期异常都必须释放 id/owner 并回传，避免 Activity 与 web 同时卡在 busy。
   StateStore.log(context,"read-start-failed");
   if(id!=null)fail(context.getString(R.string.school_read_start_failed));
   else{StateStore.release(owner);owner=null;listener.failure(context.getString(R.string.school_read_start_failed));}
  }
 }
 boolean safeCookieValue(String value){return value!=null&&!value.isEmpty()&&value.length()<=4096&&value.matches("[A-Za-z0-9._~+/%=-]+");}
 void restoreCookies(String request){
  JSONObject saved=null;try{saved=SessionVault.load(context);}catch(Exception e){StateStore.log(context,"session-store read-failed");}
  CookieManager cm=CookieManager.getInstance();JSONObject snapshot=saved;
  String tgc=snapshot!=null&&snapshot.has("tgc")&&!snapshot.isNull("tgc")?snapshot.optString("tgc"):null,academic=snapshot!=null&&snapshot.has("academic")&&!snapshot.isNull("academic")?snapshot.optString("academic"):null;
  restoreCookie(cm,CAS_COOKIE_URL,"TGC",tgc,"; Path=/cas/; Secure; HttpOnly",false,request,()->restoreCookie(cm,TABLE,"bzb_jsxsd",academic,"; Path=/jsxsd; HttpOnly",false,request,()->{
   if(!current(request))return;cm.flush();boolean has=SessionCookies.present(cm.getCookie(TABLE),"bzb_jsxsd"),hasTgc=SessionCookies.present(cm.getCookie(CAS_COOKIE_URL),"TGC");
   StateStore.log(context,"session-cookie-restore tgc="+hasTgc+" academic="+has);continueStart();
  }));
 }
 void restoreCookie(CookieManager cm,String url,String name,String value,String attributes,boolean replaceExisting,String request,Runnable next){
  if(!current(request))return;if(!UserConsent.granted(context)){fail("学校登录授权已撤回");return;}if((!replaceExisting&&SessionCookies.present(cm.getCookie(url),name))||!safeCookieValue(value)){next.run();return;}
  cm.setCookie(url,name+"="+value+attributes,accepted->{if(current(request)&&UserConsent.granted(context)){if(Boolean.TRUE.equals(accepted))StateStore.log(context,"session-cookie-restored name="+("TGC".equals(name)?"tgc":"academic"));next.run();}});
 }
 void continueStart(){if(id==null)return;String cookie=CookieManager.getInstance().getCookie(TABLE);boolean has=SessionCookies.present(cookie,"bzb_jsxsd");if(has){if(!profileDone)view.loadUrl(FRAME);else if(tableReady&&jsxsd(view.getUrl())&&view.getUrl().contains("/xskb/"))read();else view.loadUrl(TABLE);}else sso("missing-academic-cookie");}
 void persistSessionCookies(){if(!UserConsent.granted(context))return;try{CookieManager cm=CookieManager.getInstance();cm.flush();String tgc=SessionCookies.value(cm.getCookie(CAS_COOKIE_URL),"TGC"),academic=SessionCookies.value(cm.getCookie(TABLE),"bzb_jsxsd");SessionVault.save(context,tgc,academic);StateStore.log(context,"session-cookie-state tgc="+(tgc!=null&&!tgc.isEmpty())+" academic="+(academic!=null&&!academic.isEmpty()));}catch(Exception e){StateStore.log(context,"session-store write-failed");}}
 void clearExpiredTgc(){try{CookieManager cm=CookieManager.getInstance();cm.setCookie(CAS_COOKIE_URL,"TGC=; Path=/cas/; Max-Age=0; Secure; HttpOnly",accepted->cm.flush());SessionVault.clearTgc(context);StateStore.log(context,"school-session tgc-expired");}catch(Exception e){StateStore.log(context,"session-store clear-failed");}}
 void timeout(long ms){String request=id;int version=++deadlineVersion;handler.postDelayed(()->{if(current(request)&&version==deadlineVersion)fail("学校响应超时，保留上次课表");},ms);}
 void sso(String reason){if(id==null)return;if(ssoUsed){StateStore.log(context,"session-renewal failed reason=repeat");fail("学校会话自动恢复未成功，原课表已保留。请稍后重试；如统一身份认证已过期，系统会要求重新登录");return;}ssoUsed=true;awaitingLogin=false;stage=0;tableReady=false;timeout(90000);StateStore.log(context,"session-renewal start reason="+("expired-school-cookie".equals(reason)?"expired-school-cookie":"missing-school-cookie"));listener.progress("正在使用已保存的学校登录状态恢复教务会话…");view.loadUrl(SSO_ENTRY);}
 void needLogin(){if(id==null)return;if(background){fail("学校会话已失效，请打开江水课表重新登录");return;}// A login form owns its errors and remains available until login succeeds or the user cancels.
  if(!awaitingLogin)StateStore.log(context,"school-login awaiting-user");awaitingLogin=true;deadlineVersion++;listener.progress("请在学校页面完成登录");listener.loginRequired(view);}
 void leaveLogin(){if(!awaitingLogin)return;awaitingLogin=false;StateStore.log(context,"school-login accepted");timeout(60000);listener.portalEntered();}
 void page(String url){if(id==null)return;Uri u=Uri.parse(url);String host=u.getHost(),path=u.getPath();
  if(jsxsd(url)){
   if(path.startsWith("/jsxsd/framework/")){leaveLogin();CookieManager.getInstance().flush();if(ssoUsed)StateStore.log(context,"session-renewal reached academic-home");if(!profileDone)readProfile();else view.loadUrl(TABLE);return;}
   if(path.startsWith("/jsxsd/xskb/")){leaveLogin();read();return;}
   if(path.startsWith("/jsxsd/xk/LoginToXk")){return;}
   if(path.toLowerCase().contains("login")){if(!ssoUsed)sso("expired-school-cookie");else fail("学校会话自动恢复未成功，原课表已保留");return;}
  }
  if("portal.juwp.edu.cn".equals(host)){inspectPortal(url,0);return;}
  if("eapp2.juwp.edu.cn".equals(host)||"eapp2.nit.edu.cn".equals(host)){String request=id;view.evaluateJavascript("!!document.querySelector('input[type=password],input[name=userAccount],input[name=execution]')",raw->{if(current(request)&&url.equals(view.getUrl())&&"true".equals(raw)){clearExpiredTgc();needLogin();}});}
 }
 void inspectPortal(String expected,int attempt){String request=id;if(request==null||stage>=1||!expected.equals(view.getUrl()))return;
  view.evaluateJavascript("JSON.stringify({href:(document.querySelector('a[href*=\"jiaowu.juwp.edu.cn\"]')||{}).href||'',login:!!document.querySelector('input[type=password],input[name=userAccount],input[name=execution]')})",raw->{if(!current(request)||stage>=1||!expected.equals(view.getUrl()))return;try{JSONObject o=new JSONObject((String)new JSONTokener(raw).nextValue());if(o.optBoolean("login")){needLogin();return;}String href=o.optString("href");Uri u=Uri.parse(href);if("jiaowu.juwp.edu.cn".equals(u.getHost())&&("http".equals(u.getScheme())||"https".equals(u.getScheme()))){stage=1;leaveLogin();timeout(60000);listener.progress("正在连接教务系统…");view.loadUrl(href);return;}}catch(Exception ignored){}if(attempt<20)handler.postDelayed(()->inspectPortal(expected,attempt+1),400);else fail("门户页面未提供教务入口，保留原课表");});
 }
 String asset(String name)throws Exception{try(InputStream in=context.getAssets().open(name)){return new String(StateStore.read(in,100000),StandardCharsets.UTF_8);}}
 void readProfile(){String request=id;int doc=generation;listener.progress("正在读取学校年级信息…");try{view.evaluateJavascript(asset("profile-reader.js"),v->pollProfile(request,doc,0));}catch(Exception e){profileDone=true;view.loadUrl(TABLE);}}
 void pollProfile(String request,int doc,int n){if(!current(request)||doc!=generation)return;view.evaluateJavascript("JSON.stringify(window.__jiangshuiProfile||null)",raw->{if(!current(request)||doc!=generation)return;try{JSONObject o=new JSONObject((String)new JSONTokener(raw).nextValue());if(o.optBoolean("done")){profile=o.optJSONObject("profile");profileDone=true;StateStore.log(context,"profile-read recognized="+(profile!=null)+" links="+o.optInt("linkCount")+" path="+o.optString("path"));view.loadUrl(TABLE);return;}}catch(Exception ignored){}if(n<90)handler.postDelayed(()->pollProfile(request,doc,n+1),200);else{profileDone=true;view.loadUrl(TABLE);}});}
 void read(){if(id==null||script)return;if(!jsxsd(view.getUrl())){fail("当前页面不是学校教务，保留原课表");return;}script=true;String request=id;int doc=generation;listener.progress("正在读取教学周和课程…");try{view.evaluateJavascript("window.__tomorrowRequestId="+JSONObject.quote(request)+";"+asset("school-reader.js"),v->poll(request,doc));}catch(Exception e){fail("课表读取组件加载失败");}}
 void poll(String request,int doc){if(!current(request)||doc!=generation||!script)return;view.evaluateJavascript("JSON.stringify(window.__tomorrowRead||null)",raw->{if(!current(request)||doc!=generation||!script)return;try{JSONObject o=new JSONObject((String)new JSONTokener(raw).nextValue());if(request.equals(o.optString("id"))&&o.optBoolean("done")){script=false;if(o.optBoolean("login")){StateStore.log(context,"school-session expired; recovery-used="+ssoUsed);sso("expired-school-cookie");return;}if(!o.optString("error").isEmpty()){String st=o.optString("stage"),kind=o.optString("kind");if(!Arrays.asList("weeks","courses").contains(st))st="unknown";if(!Arrays.asList("http","session","timeout","format","other").contains(kind))kind="other";StateStore.log(context,"reader-error stage="+st+" http-status="+o.optInt("httpStatus")+" kind="+kind);fail(o.optString("error"));return;}JSONArray rows=o.optJSONArray("rows");int weeks=o.optInt("weeks");if(rows==null||rows.length()<1||weeks<1||weeks>60){fail("学校课表不完整，保留上次课表");return;}String sem=o.optString("sem");if(!sem.matches("\\d{4}-\\d{4}-[12]"))sem="unknown";StateStore.log(context,"reader-selection semester="+sem+" mode-known="+o.optBoolean("modeKnown")+" calendar-cached="+o.optBoolean("calendarCached"));JSONObject data=new JSONObject();data.put("rows",rows);data.put("totalWeeks",weeks);data.put("semesterId",o.optString("sem"));if(profile!=null)data.put("studentProfile",profile);tableReady=true;persistSessionCookies();StateStore.log(context,"web-read ok weeks="+weeks+" rows="+rows.length()+" elapsed-ms="+(SystemClock.elapsedRealtime()-started)+" sso="+ssoUsed+" background="+background);finish();listener.success(data);return;}}catch(Exception ignored){}handler.postDelayed(()->poll(request,doc),200);});}
 void finish(){if(owner!=null)StateStore.release(owner);id=null;owner=null;script=false;deadlineVersion++;}
 void fail(String text){if(id==null)return;tableReady=false;StateStore.log(context,"read-failed background="+background);finish();if(view!=null){try{view.evaluateJavascript("window.__tomorrowAbort&&window.__tomorrowAbort.abort()",null);view.stopLoading();}catch(Exception ignored){}}listener.failure(text);}
 public void cancel(){if(id!=null)fail(context.getString(R.string.school_read_cancelled));}
 public void destroy(){cancel();if(view!=null){if(view.getParent()!=null)((android.view.ViewGroup)view.getParent()).removeView(view);view.destroy();view=null;}}
}
