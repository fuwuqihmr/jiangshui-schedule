package cn.local.tomorrow;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.text.TextUtils;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Normalizer;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Native, dependency-free resolver for the data already stored by the WebView app. */
final class ScheduleWidgetData {
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    private static final String DASH = "—";

    static final class Item {
        String date, key, ruleId, name, teacher, room, start, end;
        boolean cancelled, localActivity, customCourse;

        Item copy() {
            Item x = new Item();
            x.date = date; x.key = key; x.ruleId = ruleId; x.name = name;
            x.teacher = teacher; x.room = room; x.start = start; x.end = end;
            x.cancelled = cancelled; x.localActivity = localActivity; x.customCourse = customCourse;
            return x;
        }
    }

    static final class WidgetData {
        String dateLabel = "今天", status = "暂无课表";
        Item current, next;
        List<Item> courses = new ArrayList<>(), pair = new ArrayList<>();
        int minute;
        boolean hasState;
        long nextRefresh;
    }

    private ScheduleWidgetData() {}

    static WidgetData read(Context context) {
        try { return read(StateStore.load(context), System.currentTimeMillis()); }
        catch (Exception ignored) { WidgetData data = new WidgetData(); data.status = "课表读取失败"; return data; }
    }

    static WidgetData read(JSONObject state, long epoch) throws Exception {
        ZonedDateTime now = java.time.Instant.ofEpochMilli(epoch).atZone(ZONE);
        WidgetData result = new WidgetData(); result.minute = now.getHour() * 60 + now.getMinute();
        result.dateLabel = label(now.toLocalDate());
        result.nextRefresh = now.toLocalDate().plusDays(1).atStartOfDay(ZONE).toInstant().toEpochMilli();
        result.nextRefresh = Math.min(result.nextRefresh, epoch + 15L * 60L * 1000L);
        JSONObject snapshot = state == null ? null : state.optJSONObject("snapshot");
        if (snapshot == null) return result;
        result.hasState = true;
        for (Item item : effectiveDay(state, snapshot, now.toLocalDate().toString())) {
            if (item.cancelled) continue;
            result.courses.add(item);
            int start = minutes(item.start), end = minutes(item.end);
            boolean active = start <= result.minute && result.minute < end;
            if (active && result.current == null) result.current = item;
            if (start > result.minute && result.next == null) result.next = item;
            if (end > result.minute && result.pair.size() < 2) result.pair.add(item);
            for (int boundary : new int[]{start, end}) {
                long at = now.toLocalDate().atStartOfDay(ZONE).plusMinutes(boundary).toInstant().toEpochMilli();
                if (at > epoch) result.nextRefresh = Math.min(result.nextRefresh, at);
            }
        }
        if (result.current != null) result.status = "课程进行中";
        else if (result.next != null) result.status = "下节课";
        else result.status = "今日已无课";
        return result;
    }

    static boolean ongoing(Item item, int minute) {
        return item != null && !item.cancelled && minutes(item.start) <= minute && minute < minutes(item.end);
    }

    static String courseStatus(Item item, int minute) {
        return ongoing(item, minute) ? "课程进行中" : minutes(item.end) <= minute ? "已结束" : "未开始";
    }

    static void bind(Context context, RemoteViews views, WidgetData data, boolean wide, boolean tall) {
        Intent open = new Intent(context, MainActivity.class)
                .setAction("cn.local.tomorrow.OPEN_TODAY")
                .putExtra("open_today", true)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(context, wide ? 2302 : tall ? 2304 : 2303, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pending);
        views.setTextViewText(R.id.widget_date, data.dateLabel);
        if (wide) bindFull(context, views, data); else if (tall) bindTall(views, data); else bindSmall(views, data);
    }

    private static void bindSmall(RemoteViews views, WidgetData data) {
        views.setTextViewText(R.id.widget_status, data.status);
        if (data.current != null) {
            views.setTextViewText(R.id.widget_course, data.current.name);
            views.setTextViewText(R.id.widget_time, data.current.start + "–" + data.current.end);
            views.setTextViewText(R.id.widget_meta, meta(data.current));
        } else if (data.next != null) {
            views.setTextViewText(R.id.widget_course, data.next.name);
            views.setTextViewText(R.id.widget_time, data.next.start + "–" + data.next.end);
            views.setTextViewText(R.id.widget_meta, meta(data.next));
        } else if (data.hasState) {
            views.setTextViewText(R.id.widget_course, "今天没有安排课程");
            views.setTextViewText(R.id.widget_time, "点击打开江水课表");
            views.setTextViewText(R.id.widget_meta, "");
        } else {
            views.setTextViewText(R.id.widget_course, "请先打开应用同步");
            views.setTextViewText(R.id.widget_time, "点击完成首次读取");
            views.setTextViewText(R.id.widget_meta, "");
        }
    }

    private static void bindTall(RemoteViews views, WidgetData data) {
        views.setTextViewText(R.id.widget_status, data.status);
        Item first = data.pair.size() > 0 ? data.pair.get(0) : null;
        Item second = data.pair.size() > 1 ? data.pair.get(1) : null;
        views.setViewVisibility(R.id.widget_current_block, first == null ? View.GONE : View.VISIBLE);
        views.setViewVisibility(R.id.widget_next_block, second != null || first == null ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_wide_divider, second != null ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_current_label, first != null && ongoing(first, data.minute) ? "课程进行中" : "下节课");
        views.setTextViewText(R.id.widget_current_course, first != null ? first.name : "");
        views.setTextViewText(R.id.widget_current_meta, first != null ? tallLine(first) : "");
        views.setTextViewText(R.id.widget_next_label, second != null && ongoing(second, data.minute) ? "课程进行中" : first != null && ongoing(first, data.minute) ? "下节课" : "之后的课");
        views.setTextViewText(R.id.widget_next_course, second != null ? second.name : data.hasState ? "今日已无课" : "请先打开应用同步");
        views.setTextViewText(R.id.widget_next_meta, second != null ? tallLine(second) : "点击打开江水课表");
        if (first == null) views.setTextViewText(R.id.widget_next_label, data.status);
    }

    private static String tallLine(Item item) {
        return item.start + "–" + item.end + "\n" + safe(item.room) + "\n" + teacher(item);
    }

    static void bindFull(Context context, RemoteViews views, WidgetData data) {
        int remaining = 0; for (Item item : data.courses) if (minutes(item.end) > data.minute) remaining++;
        String suffix = data.current != null ? "课程进行中" : data.next != null ? "未开始课程 " + remaining + " 节" : "今日已无后续课程";
        views.setTextViewText(R.id.widget_status, data.hasState ? "今日 " + data.courses.size() + " 节 · " + suffix : data.status);
        views.setTextViewText(R.id.widget_empty, data.hasState ? "今日已无课" : "请先打开江水课表同步");
        views.setEmptyView(R.id.widget_course_list, R.id.widget_empty);
        Intent template = new Intent(context, MainActivity.class).setAction("cn.local.tomorrow.OPEN_TODAY")
                .putExtra("open_today", true).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        views.setPendingIntentTemplate(R.id.widget_course_list, PendingIntent.getActivity(context, 2305, template,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            RemoteViews.RemoteCollectionItems.Builder items = new RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(false).setViewTypeCount(1);
            for (int i = 0; i < data.courses.size(); i++) items.addItem(i, row(context, data.courses.get(i), data.minute));
            views.setRemoteAdapter(R.id.widget_course_list, items.build());
        }
    }

    static RemoteViews row(Context context, Item item, int minute) {
        RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_course_row);
        boolean active = ongoing(item, minute), ended = minutes(item.end) <= minute;
        row.setTextViewText(R.id.widget_row_name, item.name);
        row.setTextViewText(R.id.widget_row_time, item.start + "–" + item.end);
        row.setTextViewText(R.id.widget_row_meta, safe(item.room) + " · " + teacher(item));
        row.setTextViewText(R.id.widget_row_status, courseStatus(item, minute));
        row.setInt(R.id.widget_row_root, "setBackgroundResource", active ? R.drawable.widget_course_active : R.drawable.widget_course_normal);
        row.setTextColor(R.id.widget_row_name, ended ? 0xff657887 : 0xff213746);
        row.setTextColor(R.id.widget_row_status, active ? 0xff126892 : ended ? 0xff73808a : 0xff4b6e84);
        row.setOnClickFillInIntent(R.id.widget_row_root, new Intent().putExtra("open_today", true).putExtra("open_date", item.date));
        return row;
    }

    private static String teacher(Item item) {
        return item.localActivity && DASH.equals(safe(item.teacher)) ? "无任课老师" : safe(item.teacher);
    }

    private static String meta(Item item) {
        String room = safe(item.room), teacher = safe(item.teacher);
        if (DASH.equals(teacher)) return room;
        if (DASH.equals(room)) return teacher;
        return room + " · " + teacher;
    }

    private static String safe(String value) { return TextUtils.isEmpty(value) ? DASH : value; }

    static List<Item> effectiveDay(JSONObject state, JSONObject snapshot, String date) throws Exception {
        List<Item> list = new ArrayList<>();
        boolean holiday = isHoliday(state, date);
        boolean movedOut = hasOutgoingMap(snapshot.optJSONArray("remaps"), date) || hasOutgoingMap(state.optJSONArray("localMaps"), date);
        if (!holiday) {
            if (!movedOut && !contains(snapshot.optJSONArray("closedDates"), date)) list.addAll(baseDay(snapshot, date));
            applyMaps(snapshot.optJSONArray("remaps"), snapshot, date, list, false);
            applyMaps(state.optJSONArray("localMaps"), snapshot, date, list, true);
            applyExceptions(snapshot.optJSONArray("exceptions"), date, list);
            addCustomCourses(state, snapshot, date, list);
        }
        addEveningStudy(state, snapshot, date, list);
        applyCourseSettings(state.optJSONObject("courseSettings"), list);
        applyOverrides(state.optJSONArray("overrides"), date, list, holiday || movedOut || hasIncomingMap(state.optJSONArray("localMaps"), date));
        list.removeIf(item -> item.localActivity && list.stream().anyMatch(other ->
                other != item && !other.localActivity && !other.cancelled &&
                other.start.compareTo(item.end) < 0 && other.end.compareTo(item.start) > 0));
        Collections.sort(list, Comparator.comparing(x -> x.start));
        return list;
    }

    private static List<Item> baseDay(JSONObject snapshot, String date) throws Exception {
        List<Item> result = new ArrayList<>();
        LocalDate target = LocalDate.parse(date);
        LocalDate start = LocalDate.parse(snapshot.getJSONObject("semester").getString("startDate"));
        int week = (int) (ChronoUnit.DAYS.between(start, target) / 7) + 1;
        if (week < 1 || week > snapshot.getJSONObject("semester").optInt("weeks", 0)) return result;
        int weekday = target.getDayOfWeek().getValue();
        JSONArray rules = snapshot.optJSONArray("rules");
        if (rules == null) return result;
        for (int i = 0; i < rules.length(); i++) {
            JSONObject rule = rules.getJSONObject(i);
            if (rule.optInt("weekday") != weekday || !containsInt(rule.optJSONArray("weeks"), week)) continue;
            result.add(fromJson(rule, date, date + "/" + rule.optString("id"), rule.optString("id")));
        }
        return result;
    }

    private static boolean isHoliday(JSONObject state, String date) {
        JSONObject settings = state.optJSONObject("holidaySettings");
        if (settings == null) return false;
        for (String name : new String[]{"winter", "summer"}) {
            JSONObject range = settings.optJSONObject(name);
            if (range != null && date.compareTo(range.optString("startDate")) >= 0 && date.compareTo(range.optString("endDate")) <= 0) return true;
        }
        return holidayDay(settings, date) != null;
    }
    private static JSONObject holidayDay(JSONObject settings, String date) {
        if (settings == null) return null;
        JSONArray days = settings.optJSONArray("days");
        if (days == null) return null;
        for (int i = 0; i < days.length(); i++) {
            JSONObject item = days.optJSONObject(i);
            if (item != null && date.equals(item.optString("date"))) return item;
        }
        return null;
    }
    private static boolean hasIncomingMap(JSONArray maps, String date) {
        if (maps == null) return false;
        for (int i = 0; i < maps.length(); i++) {
            JSONObject item = maps.optJSONObject(i);
            if (item != null && date.equals(item.optString("date"))) return true;
        }
        return false;
    }

    private static boolean hasOutgoingMap(JSONArray maps, String date) {
        if (maps == null) return false;
        for (int i = 0; i < maps.length(); i++) {
            JSONObject map = maps.optJSONObject(i);
            if (map != null && date.equals(map.optString("fromDate")) && !date.equals(map.optString("date"))) return true;
        }
        return false;
    }

    private static void applyMaps(JSONArray maps, JSONObject snapshot, String date, List<Item> list, boolean local) throws Exception {
        if (maps == null) return;
        for (int i = 0; i < maps.length(); i++) {
            JSONObject map = maps.getJSONObject(i);
            if (!date.equals(map.optString("date"))) continue;
            if (local || "replace".equals(map.optString("mode"))) list.clear();
            String from = map.optString("fromDate");
            for (Item item : baseDay(snapshot, from)) {
                Item moved = item.copy();
                moved.date = date;
                moved.key = date + "/" + moved.ruleId + "/map-" + map.optString("id");
                list.add(moved);
            }
        }
    }

    private static void applyExceptions(JSONArray exceptions, String date, List<Item> list) throws Exception {
        if (exceptions == null) return;
        for (int i = 0; i < exceptions.length(); i++) {
            JSONObject exception = exceptions.getJSONObject(i);
            if (!date.equals(exception.optString("date"))) continue;
            String ruleId = exception.optString("ruleId");
            for (int n = list.size() - 1; n >= 0; n--) {
                Item item = list.get(n);
                if (!ruleId.equals(item.ruleId)) continue;
                if (exception.optBoolean("cancel")) list.remove(n);
                else applyPatch(item, exception.optJSONObject("patch"));
            }
        }
    }

    private static void addCustomCourses(JSONObject state, JSONObject snapshot, String date, List<Item> list) throws Exception {
        JSONArray courses = state.optJSONArray("customCourses");
        if (courses == null) return;
        List<Item> custom = contains(snapshot.optJSONArray("closedDates"), date) ? new ArrayList<>() : regularCustomDay(courses, snapshot, date);
        JSONArray[] groups = {snapshot.optJSONArray("remaps"), state.optJSONArray("localMaps")};
        for (int group = 0; group < groups.length; group++) {
            JSONArray maps = groups[group];
            if (maps == null) continue;
            for (int i = 0; i < maps.length(); i++) {
                JSONObject map = maps.getJSONObject(i);
                if (!date.equals(map.optString("date"))) continue;
                if (group == 1 || "replace".equals(map.optString("mode"))) custom.clear();
                for (Item item : regularCustomDay(courses, snapshot, map.optString("fromDate"))) {
                    item.date = date; item.key = date + "/" + item.ruleId + "/map-" + map.optString("id");
                    custom.add(item);
                }
            }
        }
        if (hasOutgoingMap(state.optJSONArray("localMaps"), date)) custom.removeIf(item -> !item.key.contains("/map-"));
        for (int i = 0; i < courses.length(); i++) {
            JSONObject course = courses.getJSONObject(i);
            if ("once".equals(course.optString("mode")) && date.equals(course.optString("date"))) {
                Item item = fromJson(course, date, date + "/" + course.optString("id"), course.optString("id"));
                item.customCourse = true; custom.add(item);
            }
        }
        list.addAll(custom);
    }

    private static List<Item> regularCustomDay(JSONArray courses, JSONObject snapshot, String date) throws Exception {
        List<Item> result = new ArrayList<>();
        JSONObject semester = snapshot.getJSONObject("semester");
        LocalDate day = LocalDate.parse(date), start = LocalDate.parse(semester.getString("startDate"));
        int week = (int) Math.floorDiv(ChronoUnit.DAYS.between(start, day), 7) + 1;
        if (week < 1 || week > semester.optInt("weeks")) return result;
        for (int i = 0; i < courses.length(); i++) {
            JSONObject course = courses.getJSONObject(i);
            if (!"weekly".equals(course.optString("mode")) || !semester.optString("id").equals(course.optString("semesterId")) || !semester.optString("startDate").equals(course.optString("semesterStartDate"))) continue;
            if (!containsInt(course.optJSONArray("weekdays"), day.getDayOfWeek().getValue()) || week < course.optInt("startWeek") || week > course.optInt("endWeek")) continue;
            String pattern = course.optString("weekPattern", "every");
            if (("odd".equals(pattern) && week % 2 == 0) || ("even".equals(pattern) && week % 2 != 0)) continue;
            Item item = fromJson(course, date, date + "/" + course.optString("id"), course.optString("id"));
            item.customCourse = true; result.add(item);
        }
        return result;
    }
    private static void addEveningStudy(JSONObject state, JSONObject snapshot, String date, List<Item> list) throws Exception {
        JSONObject policy = snapshot.optJSONObject("studyPolicy");
        if (policy == null || !policy.optBoolean("userEnabled", false) || !policy.optBoolean("enabled", false) || !isFirstYear(snapshot, date)) return;
        JSONObject semester = snapshot.getJSONObject("semester");
        LocalDate day = LocalDate.parse(date), start = LocalDate.parse(semester.getString("startDate"));
        if (day.isBefore(start) || !day.isBefore(start.plusWeeks(semester.optInt("weeks")))) return;
        JSONObject exception = holidayDay(state.optJSONObject("holidaySettings"), date);
        if (exception != null && exception.optBoolean("skipStudy")) return;
        String origin = date;
        int weekday = LocalDate.parse(date).getDayOfWeek().getValue();
        if (!(weekday == 7 || (weekday >= 1 && weekday <= 4))) {
            JSONArray[] groups = {snapshot.optJSONArray("remaps"), state.optJSONArray("localMaps")};
            for (JSONArray maps : groups) {
                if (maps == null) continue;
                for (int i = 0; i < maps.length(); i++) {
                    JSONObject map = maps.getJSONObject(i);
                    if (!date.equals(map.optString("date"))) continue;
                    String candidate = map.optString("fromDate");
                    int candidateDay = LocalDate.parse(candidate).getDayOfWeek().getValue();
                    if (candidateDay == 7 || (candidateDay >= 1 && candidateDay <= 4)) { origin = candidate; break; }
                }
                if (!date.equals(origin)) break;
            }
            if (date.equals(origin)) return;
        }
        Item evening = new Item();
        evening.date = date; evening.ruleId = "local-evening-study"; evening.key = date + "/local-evening-study";
        evening.name = "晚自习"; evening.teacher = DASH; evening.room = DASH;
        evening.start = policy.optString("startTime", "19:00"); evening.end = policy.optString("endTime", "20:30");
        evening.localActivity = true; list.add(evening);
    }

    private static void applyCourseSettings(JSONObject settings, List<Item> list) {
        if (settings == null) return;
        for (Item item : list) {
            String key = item.customCourse ? "custom/" + item.ruleId : item.localActivity ? "local-evening-study" : normalize(item.name);
            JSONObject setting = settings.optJSONObject(key);
            if (setting != null) applyPatch(item, setting.optJSONObject("patch"));
        }
    }

    private static void applyOverrides(JSONArray overrides, String date, List<Item> list, boolean suppressed) throws Exception {
        if (overrides == null) return;
        for (int i = 0; i < overrides.length(); i++) {
            JSONObject override = overrides.getJSONObject(i);
            if (!date.equals(override.optString("date"))) continue;
            String key = override.optString("key");
            Item target = null;
            for (Item item : list) if (key.equals(item.key)) { target = item; break; }
            if (target == null && !suppressed && override.optJSONObject("base") != null) {
                if (override.getJSONObject("base").optBoolean("localActivity") || override.getJSONObject("base").optBoolean("customCourse")) continue;
                target = fromJson(override.getJSONObject("base"), date, key, override.getJSONObject("base").optString("ruleId"));
                list.add(target);
            }
            if (target != null) applyPatch(target, override.optJSONObject("patch"));
        }
    }

    private static Item fromJson(JSONObject row, String date, String key, String ruleId) {
        Item item = new Item();
        item.date = date; item.key = key; item.ruleId = ruleId;
        item.name = row.optString("name", "未命名课程"); item.teacher = row.optString("teacher", DASH);
        item.room = row.optString("room", DASH); item.start = row.optString("startTime", "00:00");
        item.end = row.optString("endTime", "00:00"); item.cancelled = row.optBoolean("cancelled", false);
        item.localActivity = row.optBoolean("localActivity", false); item.customCourse = row.optBoolean("customCourse", false);
        return item;
    }

    private static void applyPatch(Item item, JSONObject patch) {
        if (patch == null) return;
        if (patch.has("name")) item.name = patch.optString("name", item.name);
        if (patch.has("teacher")) item.teacher = patch.optString("teacher", item.teacher);
        if (patch.has("room")) item.room = patch.optString("room", item.room);
        if (patch.has("startTime")) item.start = patch.optString("startTime", item.start);
        if (patch.has("endTime")) item.end = patch.optString("endTime", item.end);
        if (patch.has("cancelled")) item.cancelled = patch.optBoolean("cancelled", item.cancelled);
    }

    private static boolean isFirstYear(JSONObject snapshot, String date) {
        JSONObject profile = snapshot.optJSONObject("studentProfile");
        if (profile == null) {
            JSONObject policy = snapshot.optJSONObject("studyPolicy");
            profile = policy == null ? null : policy.optJSONObject("profile");
        }
        if (profile == null) return false;
        int academicYear = LocalDate.parse(date).getMonthValue() >= 9 ? LocalDate.parse(date).getYear() : LocalDate.parse(date).getYear() - 1;
        if (profile.has("enrollmentYear")) return academicYear - profile.optInt("enrollmentYear") + 1 == 1;
        return profile.optInt("academicYear", -1) == academicYear && profile.optInt("grade", -1) == 1;
    }

    private static boolean contains(JSONArray array, String value) {
        if (array == null) return false;
        for (int i = 0; i < array.length(); i++) if (value.equals(array.optString(i))) return true;
        return false;
    }

    private static boolean containsInt(JSONArray array, int value) {
        if (array == null) return false;
        for (int i = 0; i < array.length(); i++) if (array.optInt(i, Integer.MIN_VALUE) == value) return true;
        return false;
    }

    private static int minutes(String value) {
        try { return Integer.parseInt(value.substring(0, 2)) * 60 + Integer.parseInt(value.substring(3, 5)); }
        catch (Exception ignored) { return 0; }
    }

    private static String label(LocalDate day) {
        String[] names = {"一", "二", "三", "四", "五", "六", "日"};
        return day.getMonthValue() + "月" + day.getDayOfMonth() + "日 · 星期" + names[day.getDayOfWeek().getValue() - 1];
    }

    private static String normalize(String value) {
        String normalized = Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC).toLowerCase(java.util.Locale.ROOT);
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < normalized.length(); i++) {
            char c = normalized.charAt(i);
            if (!Character.isWhitespace(c) && !Character.isLetterOrDigit(c)) continue;
            result.append(c);
        }
        return result.toString();
    }
}
