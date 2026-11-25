package cn.local.tomorrow;
import org.json.*;import java.time.*;
public class WidgetModelCheck {
 static int checks=0;static void check(boolean ok,String text){checks++;if(!ok)throw new AssertionError(text);}
 static long at(String d,String t){return LocalDate.parse(d).atTime(LocalTime.parse(t)).atZone(ZoneId.of("Asia/Shanghai")).toInstant().toEpochMilli();}
 public static void main(String[] args)throws Exception{
  JSONObject state=new JSONObject(),snapshot=new JSONObject();state.put("snapshot",snapshot);snapshot.put("semester",new JSONObject().put("id","test").put("startDate","2026-08-31").put("weeks",25));JSONArray rules=new JSONArray();int[] hours={8,10,12,14,16,18,19,20};
  for(int i=0;i<hours.length;i++)rules.put(new JSONObject().put("id","test-"+i).put("name","测试课程"+i).put("teacher","老师").put("room","教室").put("weekday",2).put("weeks",new JSONArray().put(7)).put("startTime",String.format(java.util.Locale.US,"%02d:00",hours[i])).put("endTime",String.format(java.util.Locale.US,"%02d:45",hours[i])));snapshot.put("rules",rules);
  String before=state.toString();ScheduleWidgetData.WidgetData morning=ScheduleWidgetData.read(state,at("2026-10-13","07:00"));check(morning.courses.size()==8,"Full day includes all eight courses");check(morning.pair.size()==2&&morning.current==null,"Two upcoming courses before day starts");check(morning.pair.get(0).name.equals("测试课程0")&&morning.pair.get(1).name.equals("测试课程1"),"First two sorted");
  ScheduleWidgetData.WidgetData active=ScheduleWidgetData.read(state,at("2026-10-13","19:10"));check(active.courses.size()==8,"Completed classes retained in full day");check(active.pair.size()==2&&active.pair.get(0).name.equals("测试课程6")&&active.pair.get(1).name.equals("测试课程7"),"Active plus next pair");check(active.status.equals("课程进行中"),"Active label");check(ScheduleWidgetData.courseStatus(active.courses.get(0),active.minute).equals("已结束"),"Completed label");check(ScheduleWidgetData.courseStatus(active.courses.get(7),active.minute).equals("未开始"),"Upcoming label");check(ScheduleWidgetData.ongoing(active.pair.get(0),19*60),"Start inclusive");check(!ScheduleWidgetData.ongoing(active.pair.get(0),19*60+45),"End exclusive");
  ScheduleWidgetData.WidgetData imminent=ScheduleWidgetData.read(state,at("2026-10-13","18:59"));check(imminent.nextRefresh==at("2026-10-13","19:00"),"Alarm at start");ScheduleWidgetData.WidgetData ending=ScheduleWidgetData.read(state,at("2026-10-13","19:44"));check(ending.nextRefresh==at("2026-10-13","19:45"),"Alarm at end");
  ScheduleWidgetData.WidgetData single=ScheduleWidgetData.read(state,at("2026-10-13","20:10"));check(single.pair.size()==1,"Single remaining course");ScheduleWidgetData.WidgetData ended=ScheduleWidgetData.read(state,at("2026-10-13","21:00"));check(ended.pair.size()==0&&ended.courses.size()==8&&ended.status.equals("今日已无课"),"End-of-day keeps full list while pair is empty");ScheduleWidgetData.WidgetData nextDay=ScheduleWidgetData.read(state,at("2026-10-14","10:00"));check(nextDay.courses.isEmpty()&&nextDay.hasState,"Empty date");check(ScheduleWidgetData.read((JSONObject)null,at("2026-10-13","10:00")).status.equals("暂无课表"),"No state");
  snapshot.getJSONArray("rules").getJSONObject(6).put("cancelled",true);ScheduleWidgetData.WidgetData cancelled=ScheduleWidgetData.read(state,at("2026-10-13","19:10"));check(cancelled.courses.size()==7&&cancelled.current==null&&cancelled.pair.size()==1,"Cancelled class excluded from active and collection");snapshot.getJSONArray("rules").getJSONObject(6).remove("cancelled");check(state.toString().equals(before),"Resolver never writes personal data");
  JSONObject holidays=new JSONObject().put("winter",new JSONObject().put("startDate","2026-10-12").put("endDate","2026-10-13"));state.put("holidaySettings",holidays);
  check(ScheduleWidgetData.read(state,at("2026-10-13","07:00")).courses.isEmpty(),"Winter holiday suppresses regular courses");
  snapshot.put("studentProfile",new JSONObject().put("grade",1).put("academicYear",2026));snapshot.put("studyPolicy",new JSONObject().put("enabled",true).put("userEnabled",true));
  check(ScheduleWidgetData.read(state,at("2026-10-13","07:00")).courses.size()==1,"Evening study defaults to visible during holiday");
  holidays.put("days",new JSONArray().put(new JSONObject().put("date","2026-10-13").put("skipStudy",true)));
  check(ScheduleWidgetData.read(state,at("2026-10-13","07:00")).courses.isEmpty(),"One day leave can suppress evening study");
  holidays.remove("winter");holidays.remove("days");
  state.put("localMaps",new JSONArray().put(new JSONObject().put("id","move").put("fromDate","2026-10-13").put("date","2026-10-15").put("mode","replace")));
  check(ScheduleWidgetData.effectiveDay(state,snapshot,"2026-10-13").size()==1,"Moved day keeps optional study");
  check(ScheduleWidgetData.effectiveDay(state,snapshot,"2026-10-15").size()==8,"Target has full replacement; real late class wins over study");
  System.out.println("WIDGET MODEL PASS: "+checks+" native-model checks, two upcoming/ongoing, full day, cancelled, empty, boundary alarms, no state mutation.");
 }
}
