package cn.local.tomorrow;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class WidgetRefreshReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (ScheduleWidgetProvider.ACTION_REFRESH.equals(intent.getAction())) {
            ScheduleWidgetProvider.updateAll(context);
        }
    }
}
