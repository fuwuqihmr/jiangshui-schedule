package cn.local.tomorrow;
import org.json.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
public class CustomWidgetCheck {
 public static void main(String[] args) throws Exception {
  Method resolve=ScheduleWidgetData.class.getDeclaredMethod("effectiveDay",JSONObject.class,JSONObject.class,String.class);resolve.setAccessible(true);
  JSONArray cases=new JSONArray(new String(Files.readAllBytes(Paths.get(args[0])),StandardCharsets.UTF_8));
  for(int n=0;n<cases.length();n++){
   JSONObject c=cases.getJSONObject(n),state=c.getJSONObject("state"),snapshot=state.getJSONObject("snapshot");
   @SuppressWarnings("unchecked") List<ScheduleWidgetData.Item> rows=(List<ScheduleWidgetData.Item>)resolve.invoke(null,state,snapshot,c.getString("date"));
   List<String> actual=new ArrayList<>(),expected=new ArrayList<>();
   for(ScheduleWidgetData.Item r:rows)actual.add(r.key+"|"+r.name+"|"+r.room+"|"+r.teacher+"|"+r.start+"|"+r.end+"|"+r.cancelled);
   JSONArray e=c.getJSONArray("expected");for(int i=0;i<e.length();i++)expected.add(e.getString(i));
   Collections.sort(actual);Collections.sort(expected);
   if(!actual.equals(expected))throw new AssertionError(c.getString("label")+"\nactual: "+actual+"\nexpected: "+expected);
  }
  System.out.println("ANDROID WIDGET CUSTOM COURSES PASS: "+cases.length()+" native/JS resolver cases.");
 }
}