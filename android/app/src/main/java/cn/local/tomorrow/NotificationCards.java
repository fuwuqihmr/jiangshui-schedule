package cn.local.tomorrow;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

/** Separate sizes fit the notification shade and the system heads-up window. */
final class NotificationCards {
 static Notification.Builder base(Context c,String channel,String title,String body,PendingIntent open){
  return new Notification.Builder(c,channel).setSmallIcon(R.drawable.ic_calendar)
   .setContentTitle(title).setContentText(body).setContentIntent(open)
   .setStyle(new Notification.DecoratedCustomViewStyle()).setShowWhen(false)
   .setColor(c.getColor(R.color.notification_accent)).setVisibility(Notification.VISIBILITY_PUBLIC);
 }
 static RemoteViews view(Context c,int layout,String headline,String course,String teacher,String status,String action,PendingIntent open,long startAt,long now){
  RemoteViews v=new RemoteViews(c.getPackageName(),layout);
  v.setTextViewText(R.id.notice_headline,headline);v.setTextViewText(R.id.notice_course,course);
  if(layout==R.layout.notification_expanded){v.setTextViewText(R.id.notice_teacher,teacher);if(startAt==0)v.setInt(R.id.notice_course,"setMaxLines",4);v.setViewVisibility(R.id.notice_teacher,teacher.isEmpty()?View.GONE:View.VISIBLE);}
  boolean countdown=startAt>now;
  v.setViewVisibility(R.id.notice_clock,countdown?View.VISIBLE:View.GONE);v.setViewVisibility(R.id.notice_status,countdown?View.GONE:View.VISIBLE);
  if(countdown){v.setChronometerCountDown(R.id.notice_clock,true);v.setChronometer(R.id.notice_clock,SystemClock.elapsedRealtime()+startAt-now,"距上课 %s",true);}
  v.setTextViewText(R.id.notice_status,status);
  if(layout!=R.layout.notification_compact){v.setTextViewText(R.id.notice_action,action);v.setOnClickPendingIntent(R.id.notice_action,open);}
  return v;
 }
 static Notification.Builder lesson(Context c,ClassReminderPlan.Event e,long now,PendingIntent open){return lesson(c,e,now,open,false);}
 static Notification.Builder lesson(Context c,ClassReminderPlan.Event e,long now,PendingIntent open,boolean updating){
  ScheduleWidgetData.Item r=e.course;
  String room=ClassReminders.field(r.room,"地点待确认"),teacher=ClassReminders.field(r.teacher,r.localActivity?"无任课老师":"老师待确认");
  String headline=r.start+"–"+r.end+"  "+room,course=r.name+" · "+teacher;
  String status=now<e.startAt?"即将上课":ClassReminderPlan.phase(e,now);
  Notification.Builder b=base(c,ClassReminders.CHANNEL,headline,course,open).setSubText("上课提醒")
   .setCustomContentView(view(c,R.layout.notification_compact,headline,course,"",status,"",open,e.startAt,now))
   .setCustomBigContentView(view(c,R.layout.notification_expanded,headline,r.name,"老师："+teacher,status,"管理提醒",open,e.startAt,now))
   .setCustomHeadsUpContentView(view(c,R.layout.notification_heads_up,headline,course,"",status,"查看课表",open,e.startAt,now))
   .setCategory(Notification.CATEGORY_EVENT);
  Notification publicView=new Notification.Builder(c,ClassReminders.CHANNEL).setSmallIcon(R.drawable.ic_calendar).setContentTitle(headline).setContentText(course).setContentIntent(open).setVisibility(Notification.VISIBILITY_PUBLIC).setShowWhen(false).setStyle(new Notification.BigTextStyle().bigText(r.name+"\n时间："+r.start+"–"+r.end+"\n地点："+room+"\n老师："+teacher)).build();
  b.setPublicVersion(publicView);XiaomiFocus.attach(c,b,e,now,open,updating);return b;
 }
 static PendingIntent openApp(Context c,int request){
  return PendingIntent.getActivity(c,request,new Intent(c,MainActivity.class).putExtra("open_changes",request==1001).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
 }
 static Notification message(Context c,String channel,String title,String body,String status,PendingIntent open,boolean ongoing){
  return base(c,channel,title,body,open)
   .setCustomContentView(view(c,R.layout.notification_compact,title,body,"",status,"",open,0,0))
   .setCustomBigContentView(view(c,R.layout.notification_expanded,title,body,"",status,"changes".equals(channel)?"查看变更":"查看课表",open,0,0))
   .setCustomHeadsUpContentView(view(c,R.layout.notification_heads_up,title,body,"",status,"changes".equals(channel)?"查看变更":"查看课表",open,0,0))
   .setCategory(ongoing?Notification.CATEGORY_SERVICE:Notification.CATEGORY_EVENT).setOngoing(ongoing).setAutoCancel(!ongoing).setOnlyAlertOnce(ongoing).build();
 }
 private NotificationCards(){}
}
