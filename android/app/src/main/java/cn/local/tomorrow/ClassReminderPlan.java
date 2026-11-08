package cn.local.tomorrow;

import org.json.JSONObject;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/** Timing only; course data comes from the same resolver as home-screen widgets. */
final class ClassReminderPlan {
 static final ZoneId ZONE=ZoneId.of("Asia/Shanghai");
 static final class Settings {
  boolean enabled=true; int leadMinutes=30,afterStartMinutes=5;
 }
 static Settings settings(JSONObject state){
  Settings s=new Settings();JSONObject o=state==null?null:state.optJSONObject("classReminders");
  if(o!=null){s.enabled=!state.optBoolean("classReminderPreferenceSet",false)||Boolean.TRUE.equals(o.opt("enabled"));s.leadMinutes=minutes(o,"leadMinutes",30,180);s.afterStartMinutes=minutes(o,"afterStartMinutes",5,120);}return s;
 }
 static int minutes(JSONObject o,String key,int fallback,int max){Object v=o.opt(key);if(!(v instanceof Number))return fallback;double n=((Number)v).doubleValue();return n==Math.rint(n)&&n>=0&&n<=max?(int)n:fallback;}
 static final class Event {
  ScheduleWidgetData.Item course;String id;long showAt,startAt,endAt,expiresAt;
  boolean active(long now){return showAt<=now&&now<expiresAt;}
  JSONObject json()throws Exception{return new JSONObject().put("id",id).put("date",course.date).put("name",course.name).put("room",course.room).put("teacher",course.teacher).put("startTime",course.start).put("endTime",course.end).put("startAt",startAt).put("showAt",showAt).put("expiresAt",expiresAt);}
 }
 static List<Event> events(JSONObject state,long now)throws Exception{
  List<Event> result=new ArrayList<>();Settings s=settings(state);JSONObject snapshot=state==null?null:state.optJSONObject("snapshot");if(!s.enabled||snapshot==null)return result;
  LocalDate today=Instant.ofEpochMilli(now).atZone(ZONE).toLocalDate();
  for(int d=-1;d<=7;d++)for(ScheduleWidgetData.Item item:ScheduleWidgetData.effectiveDay(state,snapshot,today.plusDays(d).toString())){
   // Demonstration courses are not a real schedule; user-added courses still qualify.
   if(item.cancelled||"sample".equals(snapshot.optJSONObject("source")==null?"":snapshot.optJSONObject("source").optString("kind"))&&!item.customCourse)continue;
   Event e=new Event();e.course=item;e.id=item.date+"|"+item.key;
   try{e.startAt=LocalDate.parse(item.date).atTime(LocalTime.parse(item.start)).atZone(ZONE).toInstant().toEpochMilli();}catch(RuntimeException invalid){continue;}
   try{e.endAt=LocalDate.parse(item.date).atTime(LocalTime.parse(item.end)).atZone(ZONE).toInstant().toEpochMilli();}catch(RuntimeException invalid){e.endAt=e.startAt;}
   e.showAt=e.startAt-s.leadMinutes*60000L;e.expiresAt=e.startAt+s.afterStartMinutes*60000L;if(e.expiresAt>e.showAt)result.add(e);
  }
  Collections.sort(result,Comparator.comparingLong((Event e)->e.startAt).thenComparing(e->e.id));return result;
 }
 static String fingerprint(Event e,long now,String mode){
  String value=e.id+"|"+e.course.name+"|"+e.course.room+"|"+e.course.teacher+"|"+e.course.start+"|"+e.course.end+"|"+e.showAt+"|"+e.startAt+"|"+e.endAt+"|"+e.expiresAt+"|"+phase(e,now)+"|"+mode+"|beta8";
  try{byte[] bytes=java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));StringBuilder hash=new StringBuilder();for(byte b:bytes)hash.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return hash.toString();}catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
 }
 static String phase(Event event,long now){return now<event.startAt?"即将上课":now<event.endAt?"课程进行中":"课程已结束";}
 static long next(List<Event> events,long now){
  long next=Instant.ofEpochMilli(now).atZone(ZONE).toLocalDate().plusDays(1).atStartOfDay(ZONE).toInstant().toEpochMilli();
  for(Event e:events){if(e.showAt>now)next=Math.min(next,e.showAt);if(e.active(now)){if(e.startAt>now)next=Math.min(next,e.startAt);if(e.endAt>now)next=Math.min(next,e.endAt);}if(e.expiresAt>now)next=Math.min(next,e.expiresAt);}return next;
 }
}
