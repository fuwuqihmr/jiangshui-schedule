import cn.local.tomorrow.CheckTime;
import java.time.Instant;

public class CheckTimeTest {
    static void verify(boolean condition, String label) {
        if (!condition) throw new AssertionError(label);
    }

    public static void main(String[] args) {
        for (String valid : new String[]{"00:00", "09:30", "22:00", "23:59"})
            verify(valid.equals(CheckTime.validate(valid)), "valid: " + valid);
        for (String invalid : new String[]{"24:00", "12:60", "9:00", "", "abc"}) {
            try { CheckTime.validate(invalid); throw new AssertionError("invalid accepted: " + invalid); }
            catch (IllegalArgumentException expected) { }
        }
        long before = Instant.parse("2026-10-14T13:59:59Z").toEpochMilli();
        long exact = Instant.parse("2026-10-14T14:00:00Z").toEpochMilli();
        verify(CheckTime.next(before, "22:00") == exact, "22:00 today");
        verify(CheckTime.next(exact, "22:00") == Instant.parse("2026-10-15T14:00:00Z").toEpochMilli(), "22:00 tomorrow");
        verify(CheckTime.next(before, "07:30") == Instant.parse("2026-10-14T23:30:00Z").toEpochMilli(), "07:30 tomorrow");
        verify(CheckTime.mostRecentDue(before, "22:00") == Instant.parse("2026-10-13T14:00:00Z").toEpochMilli(), "previous 22:00");
        verify(CheckTime.mostRecentDue(exact, "22:00") == exact, "current 22:00");

        // rc2 regression: a due-but-skipped run must never arm an alarm in the past.
        long night = Instant.parse("2026-10-18T00:03:00Z").toEpochMilli();          // 08:03 Beijing
        long today2200 = Instant.parse("2026-10-18T14:00:00Z").toEpochMilli();     // 22:00 Beijing
        long missed2200 = Instant.parse("2026-10-17T14:00:00Z").toEpochMilli();    // 22:00 the night before
        long delay = 10 * 60 * 1000L;
        verify(CheckTime.armAt(night, 0, false, "22:00", delay) == today2200, "fresh daily arm");
        verify(CheckTime.armAt(night, missed2200, true, "22:00", delay) == night + delay, "missed run retries later");
        verify(CheckTime.armAt(night, today2200, true, "22:00", delay) == today2200, "pending future alarm kept");
        verify(CheckTime.armAt(night, missed2200, false, "22:00", delay) == today2200, "ignored pending time recalculates");
        verify(CheckTime.armAt(missed2200, missed2200, true, "22:00", delay) == missed2200 + delay, "exact instant still moves forward");
        verify(CheckTime.armAt(night, missed2200, true, "22:00", 0) == night + 60000L, "invalid retry delay guarded");
        verify(CheckTime.armAt(night, missed2200, true, "22:00", delay) > night, "never arms the past");

        System.out.println("CheckTime: defaults, custom times, day boundary, invalid times and retry arming PASS");
    }
}
