package cn.local.tomorrow;

/** Narrow two-column, four-row view of the same local schedule. */
public final class TallScheduleWidgetProvider extends ScheduleWidgetProvider {
    @Override protected boolean isWide() { return false; }
    @Override protected boolean isTall() { return true; }
    @Override protected int layoutRes() { return R.layout.widget_schedule_tall; }
}
