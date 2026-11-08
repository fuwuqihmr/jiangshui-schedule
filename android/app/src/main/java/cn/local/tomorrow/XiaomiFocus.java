package cn.local.tomorrow;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import org.json.JSONObject;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Official permission queries run off the UI thread; never assumes the app is approved. */
final class XiaomiFocus {
 static final ExecutorService WORK=Executors.newSingleThreadExecutor();
 static volatile boolean checked=false,allowed=false;static volatile int protocol=0;static volatile long lastCheck=-60000L;
 static boolean device(){String value=(Build.MANUFACTURER+" "+Build.BRAND).toLowerCase(Locale.ROOT);return value.contains("xiaomi")||value.contains("redmi")||value.contains("poco");}
 static void invalidate(){lastCheck=-60000L;}
 static void refreshAsync(Context context,Runnable done){
  Context c=context.getApplicationContext();
  if(!device()){checked=true;if(done!=null)new Handler(Looper.getMainLooper()).post(done);return;}
  WORK.execute(()->{
   if(!checked||SystemClock.elapsedRealtime()-lastCheck>=60000L){
    boolean nextAllowed=false;int nextProtocol=0;
    try{
     nextProtocol=Math.max(0,Math.min(3,android.provider.Settings.System.getInt(c.getContentResolver(),"notification_focus_protocol",0)));
     Uri uri=Uri.parse("content://miui.statusbar.notification.public");Bundle request=new Bundle();request.putString("package",c.getPackageName());
     Bundle permission=c.getContentResolver().call(uri,"canShowFocus",null,request);nextAllowed=permission!=null&&permission.getBoolean("canShowFocus",false);
    }catch(Exception unsupported){nextAllowed=false;}
    boolean changed=!checked||protocol!=nextProtocol||allowed!=nextAllowed;protocol=nextProtocol;allowed=nextAllowed;checked=true;lastCheck=SystemClock.elapsedRealtime();
    if(changed)ClassReminders.onStateChanged(c);
   }
   if(done!=null)new Handler(Looper.getMainLooper()).post(done);
  });
 }
 static String mode(){return (checked?"checked":"pending")+":"+protocol+":"+allowed;}
 static boolean configured(Context c){try{Bundle meta=c.getPackageManager().getApplicationInfo(c.getPackageName(),android.content.pm.PackageManager.GET_META_DATA).metaData;return meta!=null&&meta.get("com.xiaomi.xms.APP_ID")!=null&&!String.valueOf(meta.get("com.xiaomi.xms.APP_ID")).isEmpty();}catch(Exception missing){return false;}}
 static JSONObject status(Context c)throws Exception{return new JSONObject().put("xiaomi",device()).put("checked",checked).put("protocol",protocol).put("permission",allowed).put("configured",configured(c)).put("allowed",checked&&protocol>=2&&allowed&&(protocol<3||configured(c)));}
 static boolean attach(Context c,Notification.Builder builder,ClassReminderPlan.Event e,long now,PendingIntent open,boolean updating){
  if(!device()||!checked||!allowed||protocol<2||protocol>=3&&!configured(c))return false;
  try{
   Bundle extras=new Bundle();extras.putString("miui.focus.param",FocusTemplate.payload(e,now,protocol,updating).toString());
   Bundle pictures=new Bundle();pictures.putParcelable("miui.focus.pic_class",Icon.createWithResource(c,R.drawable.ic_launcher_foreground));extras.putBundle("miui.focus.pics",pictures);
   Bundle actions=new Bundle();actions.putParcelable("miui.focus.action_class",new Notification.Action.Builder(Icon.createWithResource(c,R.drawable.ic_calendar),"查看课表",open).build());extras.putBundle("miui.focus.actions",actions);
   builder.addExtras(extras);return true;
  }catch(Exception invalid){StateStore.log(c,"class-reminder focus-template unavailable");return false;}
 }
 private XiaomiFocus(){}
}
