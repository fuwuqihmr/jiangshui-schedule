package cn.local.tomorrow;
public final class LandscapeScheduleWidgetProvider extends ScheduleWidgetProvider {
    @Override protected boolean isWide() { return true; }
    @Override protected int layoutRes() { return R.layout.widget_schedule_landscape; }
}
