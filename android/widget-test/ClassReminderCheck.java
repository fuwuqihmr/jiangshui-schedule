package cn.local.tomorrow;
import org.json.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class ClassReminderCheck {
 public static void main(String[] args)throws Exception{
  JSONObject upgrade=new JSONObject().put("classReminders",new JSONObject().put("enabled",false));
  if(!ClassReminderPlan.settings(null).enabled||!ClassReminderPlan.settings(upgrade).enabled)throw new AssertionError("default reminders must be enabled");
  upgrade.put("classReminderPreferenceSet",true);if(ClassReminderPlan.settings(upgrade).enabled)throw new AssertionError("explicitly disabled reminders must stay disabled");
  ClassReminderPlan.Event boundary=new ClassReminderPlan.Event();boundary.showAt=1000;boundary.startAt=2000;boundary.endAt=3000;boundary.expiresAt=4000;
  if(ClassReminderPlan.next(java.util.Arrays.asList(boundary),1500)!=2000||ClassReminderPlan.next(java.util.Arrays.asList(boundary),2500)!=3000||ClassReminderPlan.next(java.util.Arrays.asList(boundary),3500)!=4000)throw new AssertionError("status boundary alarms");
  if(!"即将上课".equals(ClassReminderPlan.phase(boundary,1999))||!"课程进行中".equals(ClassReminderPlan.phase(boundary,2000))||!"课程已结束".equals(ClassReminderPlan.phase(boundary,3000)))throw new AssertionError("status labels and boundaries");
  boundary.id="test";boundary.course=new ScheduleWidgetData.Item();boundary.course.name="课程";boundary.course.room="A101";boundary.course.teacher="老师";boundary.course.start="08:30";boundary.course.end="09:55";
  String stamp=ClassReminderPlan.fingerprint(boundary,1100,"checked:3:false");
  if(!stamp.equals(ClassReminderPlan.fingerprint(boundary,1200,"checked:3:false")))throw new AssertionError("Polling must keep the same render signature");
  if(stamp.equals(ClassReminderPlan.fingerprint(boundary,2000,"checked:3:false")))throw new AssertionError("Class start must update the card");
  if(stamp.equals(ClassReminderPlan.fingerprint(boundary,1100,"checked:3:true")))throw new AssertionError("Permission change must update the card");
  boundary.course.room="A102";if(stamp.equals(ClassReminderPlan.fingerprint(boundary,1100,"checked:3:false")))throw new AssertionError("Course edit must update the card");
  JSONArray cases=new JSONArray(new String(Files.readAllBytes(Paths.get(args[0])),StandardCharsets.UTF_8));
  for(int n=0;n<cases.length();n++){
   JSONObject c=cases.getJSONObject(n);long now=c.getLong("now");List<ClassReminderPlan.Event> actual=ClassReminderPlan.events(c.getJSONObject("state"),now);JSONArray expected=c.getJSONArray("events");
   Map<String,JSONObject> indexed=new HashMap<>();for(int i=0;i<expected.length();i++)indexed.put(expected.getJSONObject(i).getString("id"),expected.getJSONObject(i));
   if(actual.size()!=expected.length())throw new AssertionError(c.getString("label")+" count "+actual.size()+" != "+expected.length());
   Set<String> active=new HashSet<>();
   for(ClassReminderPlan.Event e:actual){JSONObject a=e.json(),b=indexed.get(e.id);if(b==null)throw new AssertionError("unexpected id "+e.id);
    for(String k:new String[]{"date","name","room","teacher","startTime","endTime","startAt","showAt","expiresAt"})if(!a.get(k).toString().equals(b.get(k).toString()))throw new AssertionError(c.getString("label")+" "+k+": "+a.get(k)+" != "+b.get(k));
    if(e.active(now))active.add(e.id);
   }
   Set<String> wanted=new HashSet<>();JSONArray ids=c.getJSONArray("active");for(int i=0;i<ids.length();i++)wanted.add(ids.getString(i));if(!active.equals(wanted))throw new AssertionError(c.getString("label")+" active window mismatch");
   long next=ClassReminderPlan.next(actual,now);if(next<=now)throw new AssertionError("alarm does not advance");for(ClassReminderPlan.Event e:actual){if(e.showAt>now&&next>e.showAt)throw new AssertionError("alarm misses start");if(e.expiresAt>now&&next>e.expiresAt)throw new AssertionError("alarm misses expiry");}
  }
  System.out.println("ANDROID CLASS REMINDERS PASS: "+cases.length()+" JS/native resolver and alarm timing cases.");
 }
}
