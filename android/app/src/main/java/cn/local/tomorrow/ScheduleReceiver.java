package cn.local.tomorrow;
import android.content.*;
public class ScheduleReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context c,Intent i){if(Intent.ACTION_TIME_CHANGED.equals(i.getAction())||Intent.ACTION_TIMEZONE_CHANGED.equals(i.getAction()))ClassReminders.invalidateRendered(c);CheckScheduler.cancel(c);ClassReminders.reconcile(c);ScheduleWidgetProvider.updateAll(c);}
}
