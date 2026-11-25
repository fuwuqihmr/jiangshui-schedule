package cn.local.tomorrow;

import android.app.*;
import android.app.job.*;
import android.content.*;
import android.os.*;
import org.json.*;
import java.util.*;

public final class CheckScheduler {
    static final int JOB = 2200, ALARM = 2201;
    static final String ACTION = "cn.local.tomorrow.DAILY_CHECK", PREF = "daily-check", DEFAULT_TIME = "22:00";
    // A due check that cannot run yet is retried later; arming a past instant would re-fire at once.
    static final long RETRY_DELAY = 10 * 60 * 1000L;

    static boolean enabled(Context c) {
        return UserConsent.granted(c) && c.getSharedPreferences(PREF, 0).getBoolean("enabled", true);
    }

    static String time(Context c) {
        String saved = c.getSharedPreferences(PREF, 0).getString("time", DEFAULT_TIME);
        try { return CheckTime.validate(saved); }
        catch (IllegalArgumentException e) { return DEFAULT_TIME; }
    }

    static PendingIntent pending(Context c) {
        return PendingIntent.getBroadcast(c, ALARM, new Intent(c, ScheduleReceiver.class).setAction(ACTION),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean exact(Context c) {
        return Build.VERSION.SDK_INT < 31 || c.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }

    public static void schedule(Context c) {
        try { scheduleInternal(c); }
        catch (RuntimeException e) { StateStore.log(c, "daily-schedule skipped " + e.getClass().getSimpleName()); }
    }

    private static void scheduleInternal(Context c) {
        if (!enabled(c)) { cancel(c); return; }
        android.content.SharedPreferences pref = c.getSharedPreferences(PREF, 0);
        String selectedTime = time(c);
        long now = System.currentTimeMillis();
        long previousAt = pref.getLong("next", 0), previousAttempt = pref.getLong("attempt", 0);
        String previousTime = pref.getString("scheduledForTime", "");
        // Do not replace a due-but-delayed alarm when the app resumes around the chosen time.
        // Once its run has started, or the user changed the time, calculate a fresh daily run.
        long at = CheckTime.armAt(now, previousAt,
            previousAt > 0 && selectedTime.equals(previousTime) && previousAt > previousAttempt && !alreadyAttempted(c),
            selectedTime, RETRY_DELAY);
        AlarmManager alarm = c.getSystemService(AlarmManager.class);
        boolean precise = exact(c);
        try {
            if (precise) alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(c));
            else alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(c));
        } catch (SecurityException e) {
            precise = false;
            try { alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(c)); }
            catch (SecurityException ignored) { }
        }
        pref.edit().putLong("next", at).putString("scheduledForTime", selectedTime).putBoolean("exact", precise).apply();
        scheduleJob(c, Math.max(1, at - System.currentTimeMillis() + 300000));
        StateStore.log(c, "daily-scheduled exact=" + precise + " next=" + at);
    }

    static void scheduleJob(Context c, long delay) {
        if (!enabled(c)) return;
        try {
            JobInfo job = new JobInfo.Builder(JOB, new ComponentName(c, DailyJob.class))
                .setMinimumLatency(delay).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true).setBackoffCriteria(3600000, JobInfo.BACKOFF_POLICY_LINEAR).build();
            c.getSystemService(JobScheduler.class).schedule(job);
        } catch (RuntimeException e) { StateStore.log(c, "job-schedule skipped " + e.getClass().getSimpleName()); }
    }

    public static void cancel(Context c) {
        c.getSystemService(AlarmManager.class).cancel(pending(c));
        c.getSystemService(JobScheduler.class).cancel(JOB);
        c.getSharedPreferences(PREF, 0).edit().putLong("next", 0).apply();
    }

    public static void configure(Context c, boolean value, String selectedTime) {
        String validTime = CheckTime.validate(selectedTime);
        if (!c.getSharedPreferences(PREF, 0).edit().putBoolean("enabled", value)
                .putString("time", validTime).commit()) throw new IllegalStateException("自动检查设置未能保存");
        if (value) schedule(c);
        else { cancel(c); c.stopService(new Intent(c, DailyCheckService.class)); }
    }

    public static void setEnabled(Context c, boolean value) { configure(c, value, time(c)); }

    public static void clear(Context c) {
        cancel(c);
        c.stopService(new Intent(c, DailyCheckService.class));
        c.getSharedPreferences(PREF, 0).edit().clear().apply();
    }

    static String day(long timestamp) {
        java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
        return format.format(new Date(timestamp));
    }

    static boolean alreadyAttempted(Context c) {
        long now = System.currentTimeMillis(), last = c.getSharedPreferences(PREF, 0).getLong("attempt", 0);
        // A changed time must not cause a second check today. A delayed job for yesterday
        // must still be suppressed until today's chosen time arrives.
        return last > 0 && (last >= CheckTime.mostRecentDue(now, time(c)) || day(last).equals(day(now)));
    }

    static boolean reachedScheduledTime(Context c) {
        long scheduledAt = c.getSharedPreferences(PREF, 0).getLong("next", 0);
        // Check the actual scheduled instant, including jobs delayed past midnight.
        return scheduledAt > 0 && System.currentTimeMillis() >= scheduledAt;
    }

    static void markAttempt(Context c) {
        c.getSharedPreferences(PREF, 0).edit().putLong("attempt", System.currentTimeMillis()).apply();
    }

    static void recordResult(Context c, boolean success) {
        android.content.SharedPreferences.Editor edit = c.getSharedPreferences(PREF, 0).edit()
            .putLong("lastAttempt", System.currentTimeMillis());
        if (success) edit.putLong("lastSuccess", System.currentTimeMillis());
        edit.apply();
    }

    public static JSONObject status(Context c) throws Exception {
        android.content.SharedPreferences pref = c.getSharedPreferences(PREF, 0);
        JSONObject status = new JSONObject();
        status.put("enabled", enabled(c));
        status.put("time", time(c));
        status.put("next", pref.getLong("next", 0));
        status.put("exact", exact(c));
        status.put("lastAttempt", pref.getLong("lastAttempt", 0));
        status.put("lastSuccess", pref.getLong("lastSuccess", 0));
        status.put("batteryExempt", c.getSystemService(PowerManager.class)
            .isIgnoringBatteryOptimizations(c.getPackageName()));
        return status;
    }

    public static void due(Context c) {
        if (!enabled(c)) return;
        // A read is already running (often the login page waiting for the user). Starting a
        // second one only fails on the lock, so defer the retry instead of spinning.
        if (!reachedScheduledTime(c) || alreadyAttempted(c) || StateStore.owner != null) { schedule(c); return; }
        try { c.startForegroundService(new Intent(c, DailyCheckService.class).putExtra("reason", "alarm")); }
        catch (Exception e) { StateStore.log(c, "daily-alarm service-deferred"); scheduleJob(c, 1); }
    }
}
