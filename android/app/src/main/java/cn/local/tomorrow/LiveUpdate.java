package cn.local.tomorrow;

import android.app.Notification;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import java.lang.reflect.Method;

/**
 * Android 16 promoted ongoing notification (Live Update) helper.
 * compileSdk stays 35: the promotion extra and the capability query are used by name/reflection,
 * never compiled in, so no API 36 symbol is referenced. When promotion is unavailable the caller
 * keeps posting the existing decorated card, exactly as before.
 */
final class LiveUpdate {
 /** Literal of Notification.EXTRA_REQUEST_PROMOTED_ONGOING (public only from SDK 36.1). */
 static final String EXTRA="android.requestPromotedOngoing";
 /** Build.VERSION_CODES.BAKLAVA; that constant is not available while compiling against SDK 35. */
 static final int API=36;
 /** Dedicated silent channel: only used while a class is actually in session. */
 static final String CHANNEL="class-live",TAG="class-live";
 /** Notification id, next to the reminder id 2401 and the preview id 2402. */
 static final int ID=2403;
 /** Safety net so a promoted card cannot outlive its class if reconcile never runs again. */
 static final long END_BUFFER=10*60000L;
 static final String OK="promoted",OLD_SDK="sdk-below-36",NO_MANAGER="notification-manager-missing",NO_API="promotion-api-missing",USER_OFF="promotion-disabled";

 /** Scalar, course-free reason so settings/diagnostics can explain a degradation. */
 static String reason(NotificationManager nm){
  if(Build.VERSION.SDK_INT<API)return OLD_SDK;
  if(nm==null)return NO_MANAGER;
  try{
   Method query=NotificationManager.class.getMethod("canPostPromotedNotifications");
   return Boolean.TRUE.equals(query.invoke(nm))?OK:USER_OFF;
  }catch(Throwable unavailable){return NO_API;}
 }
 static boolean canPost(NotificationManager nm){return OK.equals(reason(nm));}

 /**
  * Applies the AOSP promotion contract to a standard-style builder: request promotion,
  * stay ongoing, keep one content title, count down to {@code endAt} with the system
  * chronometer and expire shortly after the class. No RemoteViews, colour or group state
  * is touched here, so the notification keeps its promotion eligibility.
  */
 static void apply(Notification.Builder builder,long endAt,long now){
  Bundle extras=new Bundle();extras.putBoolean(EXTRA,true);
  builder.addExtras(extras).setOngoing(true).setOnlyAlertOnce(true)
   .setShowWhen(true).setWhen(endAt).setUsesChronometer(true).setChronometerCountDown(true)
   .setCategory(Notification.CATEGORY_PROGRESS)
   .setTimeoutAfter(Math.max(1L,endAt+END_BUFFER-now));
 }
 private LiveUpdate(){}
}
