package cn.local.tomorrow;

import java.util.Calendar;
import java.util.TimeZone;

// Keep scheduling calculations independent of Android so time changes can be checked directly.
public final class CheckTime {
    private CheckTime() {}

    public static String validate(String value) {
        if (value == null || !value.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]"))
            throw new IllegalArgumentException("请选择有效的每日检查时间");
        return value;
    }

    public static long next(long now, String value) {
        String time = validate(value);
        Calendar calendar = Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai"));
        calendar.setTimeInMillis(now);
        calendar.set(Calendar.HOUR_OF_DAY, Integer.parseInt(time.substring(0, 2)));
        calendar.set(Calendar.MINUTE, Integer.parseInt(time.substring(3, 5)));
        calendar.set(Calendar.SECOND, 0);
        calendar.set(Calendar.MILLISECOND, 0);
        if (calendar.getTimeInMillis() <= now) calendar.add(Calendar.DAY_OF_MONTH, 1);
        return calendar.getTimeInMillis();
    }

    // When the next daily check should be armed. A run that is due but cannot start
    // (for example another read is waiting for the user to log in) must retry later,
    // never immediately: arming an instant in the past makes the alarm fire in a loop.
    public static long armAt(long now, long pendingAt, boolean keepScheduled, String value, long retryDelay) {
        long at = keepScheduled && pendingAt > 0 ? pendingAt : next(now, value);
        if (at <= now) at = now + (retryDelay > 0 ? retryDelay : 60000L);
        return at;
    }

    public static long mostRecentDue(long now, String value) {
        Calendar calendar = Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai"));
        calendar.setTimeInMillis(next(now, value));
        calendar.add(Calendar.DAY_OF_MONTH, -1);
        return calendar.getTimeInMillis();
    }
}
