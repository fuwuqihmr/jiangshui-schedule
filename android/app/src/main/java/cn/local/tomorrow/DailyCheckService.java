package cn.local.tomorrow;
import android.app.*;import android.content.*;import android.os.*;
public class DailyCheckService extends Service {
 BackgroundCheck runner;
 @Override public void onCreate(){super.onCreate();NotificationManager nm=getSystemService(NotificationManager.class);nm.createNotificationChannel(new NotificationChannel("daily-check","定期检查运行状态",NotificationManager.IMPORTANCE_LOW));Notification notice=NotificationCards.message(this,"daily-check","江水课表正在检查","每日"+CheckScheduler.time(this)+"核对，完成后自动结束","核对中",NotificationCards.openApp(this,2202),true);startForeground(2202,notice);}
 @Override public int onStartCommand(Intent i,int flags,int startId){CheckScheduler.cancel(this);stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();return START_NOT_STICKY;}
 @Override public void onTimeout(int startId,int type){if(runner!=null)runner.stop();runner=null;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
 @Override public void onDestroy(){if(runner!=null)runner.stop();runner=null;super.onDestroy();}
 @Override public IBinder onBind(Intent i){return null;}
}
