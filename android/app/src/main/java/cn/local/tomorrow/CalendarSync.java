package cn.local.tomorrow;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import android.provider.CalendarContract.Calendars;
import android.provider.CalendarContract.Events;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** All system-calendar work stays inside the dedicated local calendar owned by this app. */
final class CalendarSync {
    static final String CALENDAR_NAME = "江水课表";
    static final String CALENDAR_ACCOUNT = "jiangshui-schedule";
    static final String CALENDAR_PREFS = "calendar-sync";
    static final String TIME_ZONE = "Asia/Shanghai";
    static final int EVENT_LIMIT = 5000;

    private CalendarSync() {}

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(CALENDAR_PREFS, Context.MODE_PRIVATE);
    }

    static boolean hasPermission(Context context) {
        return context.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED
                && context.checkSelfPermission(Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED;
    }

    static void markPermissionAsked(Context context) {
        prefs(context).edit().putBoolean("permissionAsked", true).apply();
    }

    static JSONObject error(String code, String message) {
        JSONObject out = new JSONObject();
        try {
            out.put("ok", false);
            out.put("code", code);
            out.put("message", message);
        } catch (JSONException ignored) {}
        return out;
    }

    static JSONObject status(Context context) {
        JSONObject out = new JSONObject();
        try {
            boolean provider = context.getPackageManager().resolveContentProvider(CalendarContract.AUTHORITY, 0) != null;
            boolean permission = hasPermission(context);
            SharedPreferences p = prefs(context);
            out.put("available", provider);
            out.put("writable", false);
            out.put("permission", permission ? "granted" : (p.getBoolean("permissionAsked", false) ? "denied" : "prompt"));
            out.put("lastSyncAt", p.contains("lastSyncAt") ? p.getString("lastSyncAt", null) : null);
            out.put("lastEventCount", p.getInt("lastEventCount", 0));
            out.put("lastSemesterId", p.contains("lastSemesterId") ? p.getString("lastSemesterId", null) : null);
            if (!provider) {
                out.put("calendarId", JSONObject.NULL);
                return out;
            }
            if (!permission) {
                out.put("calendarId", JSONObject.NULL);
                return out;
            }
            CalendarRef ref = findCalendar(context);
            out.put("calendarId", ref == null ? JSONObject.NULL : ref.id);
            out.put("writable", ref != null && ref.writable);
            return out;
        } catch (Exception ex) {
            return error("CALENDAR_UNAVAILABLE", "本机没有可用的系统日历应用");
        }
    }

    static JSONObject sync(Context context, JSONObject payload) {
        try {
            if (context.getPackageManager().resolveContentProvider(CalendarContract.AUTHORITY, 0) == null) {
                return error("CALENDAR_UNAVAILABLE", "本机没有可用的系统日历应用");
            }
            if (!hasPermission(context)) {
                return error("CALENDAR_PERMISSION_DENIED", "需要日历权限才能写入，请在系统设置中允许");
            }
            if (payload == null) return error("CALENDAR_INVALID_EVENT", "写入数据无效");
            JSONArray rawEvents = payload.optJSONArray("events");
            if (rawEvents == null || rawEvents.length() > EVENT_LIMIT) {
                return error("CALENDAR_INVALID_EVENT", "写入数据无效或课程数量过多");
            }
            String semesterId = payload.optString("semesterId", "");
            List<ContentValues> values = new ArrayList<>();
            for (int i = 0; i < rawEvents.length(); i++) {
                JSONObject item = rawEvents.optJSONObject(i);
                ContentValues value = eventValues(item);
                if (value == null) return error("CALENDAR_INVALID_EVENT", "写入数据中有无效课程");
                values.add(value);
            }
            CalendarRef calendar = ensureCalendar(context);
            if (calendar == null) return error("CALENDAR_NOT_WRITABLE", "系统日历当前不可写，请换一个本地日历账户");
            if (!calendar.writable) return error("CALENDAR_NOT_WRITABLE", "系统日历当前不可写，请换一个本地日历账户");

            SharedPreferences p = prefs(context);
            List<Long> oldIds = readIds(p.getString("eventIds", "[]"));
            int deleted = 0;
            List<Long> failedIds = new ArrayList<>();
            ContentResolver resolver = context.getContentResolver();
            for (long oldId : oldIds) {
                if (deleteTracked(resolver, calendar.id, oldId)) deleted++;
                else failedIds.add(oldId);
            }
            if (!failedIds.isEmpty()) {
                p.edit().putString("eventIds", idsJson(failedIds)).apply();
                JSONObject failedOut = partialError(
                        "CALENDAR_WRITE_FAILED",
                        "清理旧事件失败：成功 " + deleted + " 条，失败 " + failedIds.size() + " 条，请稍后重试",
                        deleted,
                        failedIds.size());
                try {
                    failedOut.put("remainingEventIds", failedIds.size());
                } catch (JSONException ignored) {}
                return failedOut;
            }
            List<Long> newIds = new ArrayList<>();
            for (ContentValues value : values) {
                value.put(Events.CALENDAR_ID, calendar.id);
                try {
                    Uri uri = resolver.insert(Events.CONTENT_URI, value);
                    if (uri == null) {
                        deleteIds(context, calendar.id, newIds);
                        return error("CALENDAR_WRITE_FAILED", "写入系统日历失败，请稍后重试");
                    }
                    newIds.add(ContentUris.parseId(uri));
                } catch (Exception ex) {
                    deleteIds(context, calendar.id, newIds);
                    return error("CALENDAR_WRITE_FAILED", "写入系统日历失败，请稍后重试");
                }
            }
            String lastSyncAt = Instant.now().toString();
            p.edit()
                    .putString("eventIds", idsJson(newIds))
                    .putLong("calendarId", calendar.id)
                    .putString("lastSyncAt", lastSyncAt)
                    .putInt("lastEventCount", newIds.size())
                    .putString("lastSemesterId", semesterId)
                    .apply();
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("written", newIds.size());
            out.put("deleted", deleted);
            out.put("failed", 0);
            out.put("skipped", 0);
            out.put("calendarId", calendar.id);
            out.put("lastSyncAt", lastSyncAt);
            out.put("lastEventCount", newIds.size());
            return out;
        } catch (Exception ex) {
            return error("CALENDAR_WRITE_FAILED", "写入系统日历失败，请稍后重试");
        }
    }

    static JSONObject remove(Context context) {
        try {
            if (context.getPackageManager().resolveContentProvider(CalendarContract.AUTHORITY, 0) == null) {
                return error("CALENDAR_UNAVAILABLE", "本机没有可用的系统日历应用");
            }
            if (!hasPermission(context)) {
                return error("CALENDAR_PERMISSION_DENIED", "需要日历权限才能移除，请在系统设置中允许");
            }
            SharedPreferences p = prefs(context);
            long calendarId = p.getLong("calendarId", -1L);
            CalendarRef owned = findCalendar(context);
            if (calendarId <= 0 && owned != null) calendarId = owned.id;
            List<Long> ids = readIds(p.getString("eventIds", "[]"));
            int removed = 0;
            List<Long> remainingIds = new ArrayList<>();
            ContentResolver resolver = context.getContentResolver();
            for (long id : ids) {
                if (deleteTracked(resolver, calendarId, id)) removed++;
                else remainingIds.add(id);
            }
            if (!remainingIds.isEmpty()) {
                p.edit()
                        .putString("eventIds", idsJson(remainingIds))
                        .putInt("lastEventCount", remainingIds.size())
                        .apply();
                JSONObject failedOut = partialError(
                        "CALENDAR_WRITE_FAILED",
                        "移除部分失败：成功 " + removed + " 条，失败 " + remainingIds.size() + " 条，请稍后重试",
                        removed,
                        remainingIds.size());
                try {
                    failedOut.put("removed", removed);
                    failedOut.put("remaining", remainingIds.size());
                } catch (JSONException ignored) {}
                return failedOut;
            }
            p.edit().putString("eventIds", "[]").remove("lastSyncAt").putInt("lastEventCount", 0).remove("lastSemesterId").apply();
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("removed", removed);
            out.put("failed", 0);
            out.put("calendarId", calendarId > 0 ? calendarId : JSONObject.NULL);
            out.put("lastSyncAt", JSONObject.NULL);
            out.put("lastEventCount", 0);
            return out;
        } catch (Exception ex) {
            return error("CALENDAR_WRITE_FAILED", "从系统日历移除失败，请稍后重试");
        }
    }

    private static final class CalendarRef {
        final long id;
        final boolean writable;
        CalendarRef(long id, boolean writable) {
            this.id = id;
            this.writable = writable;
        }
    }

    private static CalendarRef findCalendar(Context context) {
        Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(
                    Calendars.CONTENT_URI,
                    new String[]{Calendars._ID, Calendars.CALENDAR_ACCESS_LEVEL},
                    Calendars.ACCOUNT_NAME + "=? AND " + Calendars.ACCOUNT_TYPE + "=? AND " + Calendars.DELETED + "=0",
                    new String[]{CALENDAR_ACCOUNT, CalendarContract.ACCOUNT_TYPE_LOCAL},
                    Calendars._ID + " ASC");
            if (cursor == null || !cursor.moveToFirst()) return null;
            long id = cursor.getLong(0);
            int access = cursor.getInt(1);
            return new CalendarRef(id, access >= Calendars.CAL_ACCESS_CONTRIBUTOR);
        } catch (Exception ignored) {
            return null;
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private static CalendarRef ensureCalendar(Context context) {
        CalendarRef existing = findCalendar(context);
        if (existing != null) return existing;
        try {
            Uri.Builder builder = Calendars.CONTENT_URI.buildUpon();
            builder.appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true");
            builder.appendQueryParameter(Calendars.ACCOUNT_NAME, CALENDAR_ACCOUNT);
            builder.appendQueryParameter(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL);
            ContentValues value = new ContentValues();
            value.put(Calendars.ACCOUNT_NAME, CALENDAR_ACCOUNT);
            value.put(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL);
            value.put(Calendars.CALENDAR_DISPLAY_NAME, CALENDAR_NAME);
            value.put(Calendars.CALENDAR_ACCESS_LEVEL, Calendars.CAL_ACCESS_OWNER);
            value.put(Calendars.OWNER_ACCOUNT, CALENDAR_ACCOUNT);
            value.put(Calendars.CALENDAR_TIME_ZONE, TIME_ZONE);
            value.put(Calendars.VISIBLE, 1);
            value.put(Calendars.SYNC_EVENTS, 1);
            Uri uri = context.getContentResolver().insert(builder.build(), value);
            if (uri == null) return null;
            return new CalendarRef(ContentUris.parseId(uri), true);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static ContentValues eventValues(JSONObject item) {
        if (item == null) return null;
        try {
            String title = item.optString("title", "").trim();
            String location = item.optString("location", "").trim();
            String description = item.optString("description", "").trim();
            long start = item.optLong("startMillis", Long.MIN_VALUE);
            long end = item.optLong("endMillis", Long.MIN_VALUE);
            if (title.isEmpty() || title.length() > 200 || location.length() > 200 || description.length() > 1000 || start == Long.MIN_VALUE || end <= start) return null;
            ContentValues value = new ContentValues();
            value.put(Events.TITLE, title);
            value.put(Events.EVENT_LOCATION, location);
            value.put(Events.DESCRIPTION, description);
            value.put(Events.DTSTART, start);
            value.put(Events.DTEND, end);
            value.put(Events.EVENT_TIMEZONE, TIME_ZONE);
            value.put(Events.EVENT_END_TIMEZONE, TIME_ZONE);
            value.put(Events.ALL_DAY, 0);
            value.put(Events.HAS_ALARM, 0);
            value.put(Events.AVAILABILITY, Events.AVAILABILITY_BUSY);
            value.put(Events.STATUS, Events.STATUS_CONFIRMED);
            return value;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static List<Long> readIds(String raw) {
        List<Long> ids = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(raw == null ? "[]" : raw);
            for (int i = 0; i < array.length(); i++) ids.add(array.getLong(i));
        } catch (Exception ignored) {}
        return ids;
    }

    private static String idsJson(List<Long> ids) {
        JSONArray array = new JSONArray();
        for (long id : ids) array.put(id);
        return array.toString();
    }

    private static boolean eventExists(ContentResolver resolver, long id) throws Exception {
        Cursor cursor = null;
        try {
            cursor = resolver.query(
                    Events.CONTENT_URI,
                    new String[]{Events._ID},
                    Events._ID + "=?",
                    new String[]{String.valueOf(id)},
                    null);
            if (cursor == null) throw new IllegalStateException("无法读取系统日历");
            return cursor.moveToFirst();
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    /** true 表示事件已不存在或已删除；false 表示删除失败且事件仍可能存在。 */
    private static boolean deleteTracked(ContentResolver resolver, long calendarId, long id) {
        try {
            String selection;
            String[] args;
            if (calendarId > 0) {
                selection = Events._ID + "=? AND " + Events.CALENDAR_ID + "=?";
                args = new String[]{String.valueOf(id), String.valueOf(calendarId)};
            } else {
                selection = Events._ID + "=?";
                args = new String[]{String.valueOf(id)};
            }
            int count = resolver.delete(Events.CONTENT_URI, selection, args);
            if (count > 0) return true;
            return !eventExists(resolver, id);
        } catch (Exception ignored) {
            return false;
        }
    }

    private static JSONObject partialError(String code, String message, int deleted, int failed) {
        JSONObject out = error(code, message);
        try {
            out.put("deleted", deleted);
            out.put("failed", failed);
            out.put("written", 0);
        } catch (JSONException ignored) {}
        return out;
    }

    private static void deleteIds(Context context, long calendarId, List<Long> ids) {
        for (long id : ids) {
            try {
                context.getContentResolver().delete(Events.CONTENT_URI, "_id=? AND calendar_id=?", new String[]{String.valueOf(id), String.valueOf(calendarId)});
            } catch (Exception ignored) {}
        }
    }
}
