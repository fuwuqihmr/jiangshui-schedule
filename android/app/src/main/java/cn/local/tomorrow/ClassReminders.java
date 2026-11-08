package cn.local.tomorrow;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.service.notification.StatusBarNotification;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/** System alarms plus local acknowledgement; no running WebView is required. */
public final class ClassReminders {
 static final String PREF="class-reminders",CHANNEL="class-reminders",PREFIX="class/";
 static final String ACTION="cn.local.tomorrow.CLASS_REMINDER",RESTORE="cn.local.tomorrow.CLASS_REMINDER_RESTORE",PREVIEW="cn.local.tomorrow.CLASS_REMINDER_PREVIEW";
 static final int ALARM=2400,NOTICE=2401;
 static SharedPreferences prefs(Context c){return c.getSharedPreferences(PREF,Context.MODE_PRIVATE);}
 static JSONObject ledger(Context c,String key){try{return new JSONObject(prefs(c).getString(key,"{}"));}catch(Exception e){return new JSONObject();}}
 static void prune(JSONObject o,long now){Iterator<String> keys=o.keys();while(keys.hasNext()){String key=keys.next();if(o.optLong(key)<=now)keys.remove();}}
 static PendingIntent alarm(Context c){return PendingIntent.getBroadcast(c,ALARM,new Intent(c,ClassReminderReceiver.class).setAction(ACTION),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
 static void channel(Context c){
  NotificationChannel ch=new NotificationChannel(CHANNEL,"上课提醒",NotificationManager.IMPORTANCE_HIGH);
  ch.setDescription("课程、时间、地点和老师；在 App 首页确认关闭，或到设定时间自动结束");
  ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);c.getSystemService(NotificationManager.class).createNotificationChannel(ch);
 }
 static boolean allowed(Context c){NotificationManager nm=c.getSystemService(NotificationManager.class);NotificationChannel ch=nm.getNotificationChannel(CHANNEL);return nm.areNotificationsEnabled()&&(ch==null||ch.getImportance()!=NotificationManager.IMPORTANCE_NONE);}
 static void cancelNotices(Context c,Set<String> wanted){
  NotificationManager nm=c.getSystemService(NotificationManager.class);
  for(StatusBarNotification n:nm.getActiveNotifications())if(n.getId()==NOTICE&&n.getTag()!=null&&n.getTag().startsWith(PREFIX)&&!wanted.contains(n.getTag()))nm.cancel(n.getTag(),NOTICE);
 }
 public static void onStateChanged(Context c){Context app=c.getApplicationContext();new Handler(Looper.getMainLooper()).post(()->reconcile(app));}
 public static synchronized void reconcile(Context c){
  try{
   channel(c);XiaomiFocus.refreshAsync(c,null);JSONObject state=StateStore.load(c);ClassReminderPlan.Settings settings=ClassReminderPlan.settings(state);long now=System.currentTimeMillis();
   JSONObject closed=ledger(c,"closed"),posted=ledger(c,"posted"),rendered=ledger(c,"rendered");prune(closed,now);prune(posted,now);
   boolean enabled=UserConsent.granted(c)&&settings.enabled;
   List<ClassReminderPlan.Event> events=ClassReminderPlan.events(enabled?state:null,now);Set<String> wanted=new HashSet<>();
   java.util.Map<String,StatusBarNotification> current=new java.util.HashMap<>();for(StatusBarNotification n:c.getSystemService(NotificationManager.class).getActiveNotifications())if(n.getId()==NOTICE&&n.getTag()!=null)current.put(n.getTag(),n);
   if(enabled&&allowed(c))for(ClassReminderPlan.Event e:events)if(e.active(now)&&closed.optLong(e.id)<=now){
    String tag=PREFIX+e.id,signature=ClassReminderPlan.fingerprint(e,now,XiaomiFocus.mode());wanted.add(tag);StatusBarNotification existing=current.get(tag);
    // Leave the system clock running. Status polling must not post again or move the card into a silent group.
    if(existing==null||existing.getNotification().getGroup()!=null||!signature.equals(rendered.optString(e.id))){show(c,e,now,posted.has(e.id));rendered.put(e.id,signature);}
    posted.put(e.id,e.expiresAt+3*86400000L);
   }
   Iterator<String> stale=rendered.keys();while(stale.hasNext())if(!wanted.contains(PREFIX+stale.next()))stale.remove();
   cancelNotices(c,wanted);long next=enabled?ClassReminderPlan.next(events,now):0;
   AlarmManager am=c.getSystemService(AlarmManager.class);
   if(!enabled)am.cancel(alarm(c));
   else if(CheckScheduler.exact(c))try{am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next,alarm(c));}catch(SecurityException revoked){am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next,alarm(c));}
   else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next,alarm(c));
   prefs(c).edit().putString("closed",closed.toString()).putString("posted",posted.toString()).putString("rendered",rendered.toString()).putLong("next",next).apply();
  }catch(Exception e){StateStore.log(c,"class-reminder schedule skipped "+e.getClass().getSimpleName());}
 }
 static String field(String s,String fallback){return s==null||s.trim().isEmpty()||"—".equals(s)?fallback:s;}
 static void show(Context c,ClassReminderPlan.Event e,long now,boolean quiet){
  ScheduleWidgetData.Item r=e.course;
  Intent open=new Intent(c,MainActivity.class).setAction("cn.local.tomorrow.OPEN_CLASS")
   .setData(Uri.parse("jiangshui://class/"+Uri.encode(e.id))).putExtra("open_today",true).putExtra("open_date",r.date)
   .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
  PendingIntent content=PendingIntent.getActivity(c,NOTICE,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Intent restore=new Intent(c,ClassReminderReceiver.class).setAction(RESTORE).setData(Uri.parse("jiangshui://restore/"+Uri.encode(e.id)));
  PendingIntent deletion=PendingIntent.getBroadcast(c,NOTICE,restore,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Notification.Builder b=NotificationCards.lesson(c,e,now,content,quiet)
   .setDeleteIntent(deletion).setAutoCancel(false).setOngoing(true).setOnlyAlertOnce(true)
   .setTimeoutAfter(Math.max(1,e.expiresAt-now));
  c.getSystemService(NotificationManager.class).notify(PREFIX+e.id,NOTICE,b.build());
 }
 static PendingIntent previewAlarm(Context c){return PendingIntent.getBroadcast(c,NOTICE+1,new Intent(c,ClassReminderReceiver.class).setAction(PREVIEW),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
 public static JSONObject preview(Context c,boolean lockedTest)throws Exception{
  channel(c);if(!allowed(c))return new JSONObject().put("ok",false);
  if(!lockedTest)return preview(c);
  AlarmManager am=c.getSystemService(AlarmManager.class);long due=System.currentTimeMillis()+5000L;
  if(CheckScheduler.exact(c))try{am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,due,previewAlarm(c));}catch(SecurityException denied){am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,due,previewAlarm(c));}else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,due,previewAlarm(c));
  return new JSONObject().put("ok",true).put("delayed",true);
 }
 public static JSONObject preview(Context c)throws Exception{
  channel(c);if(!allowed(c))return new JSONObject().put("ok",false);
  long now=System.currentTimeMillis();java.time.ZonedDateTime start=java.time.Instant.ofEpochMilli(now+19*60000L).atZone(ClassReminderPlan.ZONE);
  ScheduleWidgetData.Item r=new ScheduleWidgetData.Item();r.date=start.toLocalDate().toString();r.name="示例课程 · 工程图学C";r.room="教学南大楼（B101）";r.teacher="示例老师";
  r.start=start.toLocalTime().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"));r.end=start.plusMinutes(85).toLocalTime().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"));
  ClassReminderPlan.Event e=new ClassReminderPlan.Event();e.course=r;e.id="preview";e.startAt=now+19*60000L;e.endAt=e.startAt+85*60000L;e.expiresAt=now+60000L;
  Intent open=new Intent(c,MainActivity.class).setAction("cn.local.tomorrow.PREVIEW_CLASS").putExtra("open_today",true).putExtra("open_date",r.date).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
  PendingIntent content=PendingIntent.getActivity(c,NOTICE+1,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  c.getSystemService(NotificationManager.class).notify("preview",NOTICE+1,NotificationCards.lesson(c,e,now,content).setOngoing(false).setAutoCancel(true).setTimeoutAfter(60000L).build());
  return new JSONObject().put("ok",true);
 }
 public static JSONObject notificationStatus(Context c)throws Exception{
  NotificationManager nm=c.getSystemService(NotificationManager.class);NotificationChannel channel=nm.getNotificationChannel(CHANNEL);int count=0,grouped=0;
  for(StatusBarNotification n:nm.getActiveNotifications())if(n.getId()==NOTICE&&n.getTag()!=null&&n.getTag().startsWith(PREFIX)){count++;if(n.getNotification().getGroup()!=null)grouped++;}
  return new JSONObject().put("enabled",nm.areNotificationsEnabled()).put("importance",channel==null?-1000:channel.getImportance()).put("lockVisibility",channel==null?-1000:channel.getLockscreenVisibility()).put("deviceLocked",c.getSystemService(android.app.KeyguardManager.class).isDeviceLocked()).put("activeCount",count).put("groupedCount",grouped).put("focus",XiaomiFocus.status(c));
 }
 public static void invalidateRendered(Context c){prefs(c).edit().remove("rendered").apply();}
 public static synchronized JSONObject status(Context c)throws Exception{
  JSONObject state=StateStore.load(c);ClassReminderPlan.Settings s=ClassReminderPlan.settings(state);long now=System.currentTimeMillis();JSONArray active=new JSONArray();JSONObject closed=ledger(c,"closed");
  if(UserConsent.granted(c)&&s.enabled)for(ClassReminderPlan.Event e:ClassReminderPlan.events(state,now))if(e.active(now)&&closed.optLong(e.id)<=now)active.put(e.json());
  return new JSONObject().put("enabled",s.enabled).put("leadMinutes",s.leadMinutes).put("afterStartMinutes",s.afterStartMinutes)
   .put("active",active).put("next",prefs(c).getLong("next",0)).put("exact",CheckScheduler.exact(c)).put("notificationsAllowed",allowed(c)).put("notificationStatus",notificationStatus(c));
 }
 public static synchronized JSONObject close(Context c,String id)throws Exception{
  UserConsent.require(c);long now=System.currentTimeMillis();ClassReminderPlan.Event found=null;
  for(ClassReminderPlan.Event e:ClassReminderPlan.events(StateStore.load(c),now))if(e.id.equals(id)&&e.active(now)){found=e;break;}
  if(found!=null){JSONObject closed=ledger(c,"closed");closed.put(id,found.expiresAt+3*86400000L);if(!prefs(c).edit().putString("closed",closed.toString()).commit())throw new Exception("提醒关闭状态无法保存，请重试");}
  c.getSystemService(NotificationManager.class).cancel(PREFIX+id,NOTICE);reconcile(c);return status(c);
 }
 public static synchronized void clear(Context c){c.getSystemService(AlarmManager.class).cancel(alarm(c));c.getSystemService(AlarmManager.class).cancel(previewAlarm(c));cancelNotices(c,new HashSet<>());c.getSystemService(NotificationManager.class).cancel("preview",NOTICE+1);prefs(c).edit().clear().commit();}
}
