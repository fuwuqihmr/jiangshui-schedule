package cn.local.tomorrow;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ClassReminderReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context context,Intent intent){
  if(ClassReminders.PREVIEW.equals(intent.getAction())){try{if(UserConsent.granted(context))ClassReminders.preview(context);}catch(Exception ignored){}return;}
  // A system swipe is never an in-app acknowledgement. Restore if still due.
  ClassReminders.reconcile(context);
 }
}
