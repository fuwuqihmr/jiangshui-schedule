package cn.local.tomorrow;
import android.app.*;import android.appwidget.*;import android.content.*;import android.net.Uri;import android.os.*;import android.widget.RemoteViews;
/** All widget sizes share one read and one boundary refresh plan. */
public abstract class ScheduleWidgetProvider extends AppWidgetProvider {
    static final String ACTION_REFRESH = "cn.local.tomorrow.ACTION_WIDGET_REFRESH";
    private static final int REFRESH_REQUEST = 2301;
    protected abstract boolean isWide();
    protected boolean isTall() { return false; }
    protected abstract int layoutRes();
    @Override public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        ScheduleWidgetData.WidgetData data = ScheduleWidgetData.read(c);
        update(c, manager, ids, isWide(), isTall(), layoutRes(), data);
        schedule(c, manager, data);
    }
    @Override public void onAppWidgetOptionsChanged(Context c, AppWidgetManager manager, int id, Bundle options) { onUpdate(c, manager, new int[]{id}); }
    @Override public void onReceive(Context c, Intent intent) {
        super.onReceive(c, intent);if (ACTION_REFRESH.equals(intent.getAction())) updateAll(c);
    }
    @Override public void onDisabled(Context c) { super.onDisabled(c); ensureRefreshSchedule(c); }
    static void update(Context c, AppWidgetManager manager, int[] ids, boolean wide, boolean tall, int layout, ScheduleWidgetData.WidgetData data) {
        for (int id : ids) try {
            RemoteViews views = new RemoteViews(c.getPackageName(), layout);
            ScheduleWidgetData.bind(c, views, data, wide, tall);
            if (wide && Build.VERSION.SDK_INT < 31) {
                Intent service = new Intent(c, ScheduleWidgetListService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
                service.setData(Uri.parse("jiangshui-widget://courses/" + id));
                views.setRemoteAdapter(R.id.widget_course_list, service);
            }
            manager.updateAppWidget(id, views);
            if (wide && Build.VERSION.SDK_INT < 31) manager.notifyAppWidgetViewDataChanged(id, R.id.widget_course_list);
        } catch (RuntimeException e) { StateStore.log(c, "widget-update failed type=" + e.getClass().getSimpleName()); }
    }
    static int[] ids(Context c, AppWidgetManager manager, Class<?> type) { return manager.getAppWidgetIds(new ComponentName(c, type)); }
    public static void updateAll(Context c) {
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        ScheduleWidgetData.WidgetData data = ScheduleWidgetData.read(c);
        update(c, manager, ids(c, manager, SmallScheduleWidgetProvider.class), false, false, R.layout.widget_schedule_small, data);
        update(c, manager, ids(c, manager, TallScheduleWidgetProvider.class), false, true, R.layout.widget_schedule_tall, data);
        update(c, manager, ids(c, manager, WideScheduleWidgetProvider.class), true, false, R.layout.widget_schedule_wide, data);
        update(c, manager, ids(c, manager, LandscapeScheduleWidgetProvider.class), true, false, R.layout.widget_schedule_landscape, data);
        schedule(c, manager, data);
    }
    static void ensureRefreshSchedule(Context c) { schedule(c, AppWidgetManager.getInstance(c), ScheduleWidgetData.read(c)); }
    static void schedule(Context c, AppWidgetManager manager, ScheduleWidgetData.WidgetData data) {
        AlarmManager alarms = c.getSystemService(AlarmManager.class);if (alarms == null) return;
        PendingIntent pending = PendingIntent.getBroadcast(c, REFRESH_REQUEST, new Intent(c, WidgetRefreshReceiver.class).setAction(ACTION_REFRESH), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        int count = 0;for (Class<?> type : new Class<?>[]{SmallScheduleWidgetProvider.class, TallScheduleWidgetProvider.class, WideScheduleWidgetProvider.class, LandscapeScheduleWidgetProvider.class}) count += ids(c, manager, type).length;
        if (count == 0) { alarms.cancel(pending); return; }
        long next = data.nextRefresh > System.currentTimeMillis() ? data.nextRefresh : System.currentTimeMillis() + 15L * 60L * 1000L;
        try { if (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending);
              else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending);
        } catch (SecurityException revoked) { alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending); }
    }
}
