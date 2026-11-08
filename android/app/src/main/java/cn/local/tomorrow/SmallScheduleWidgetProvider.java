package cn.local.tomorrow;

public final class SmallScheduleWidgetProvider extends ScheduleWidgetProvider {
    @Override protected boolean isWide() { return false; }
    @Override protected int layoutRes() { return R.layout.widget_schedule_small; }
}
