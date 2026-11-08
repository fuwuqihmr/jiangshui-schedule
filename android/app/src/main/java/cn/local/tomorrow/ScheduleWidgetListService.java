package cn.local.tomorrow;
import android.content.*;import android.widget.*;
/** Collection fallback for Android 8–11. */
public final class ScheduleWidgetListService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent) { return new CourseFactory(this); }
    static final class CourseFactory implements RemoteViewsFactory {
        private final Context context;
        private ScheduleWidgetData.WidgetData data = new ScheduleWidgetData.WidgetData();
        CourseFactory(Context context) { this.context = context; }
        @Override public void onCreate() { onDataSetChanged(); }
        @Override public void onDataSetChanged() { data = ScheduleWidgetData.read(context); }
        @Override public void onDestroy() {}
        @Override public int getCount() { return data.courses.size(); }
        @Override public RemoteViews getViewAt(int position) { return position < 0 || position >= getCount() ? null : ScheduleWidgetData.row(context, data.courses.get(position), data.minute); }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return false; }
    }
}
