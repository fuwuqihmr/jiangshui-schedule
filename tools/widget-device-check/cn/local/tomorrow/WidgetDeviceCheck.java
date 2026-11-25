package cn.local.tomorrow;
import android.app.*;import android.appwidget.*;import android.os.*;import android.view.*;import android.widget.*;import android.content.*;import org.json.*;import java.io.*;import java.nio.file.*;import java.time.*;import java.util.*;import android.graphics.*;
/** Only synthetic course data is used; this check never writes state.json or credentials. */
public final class WidgetDeviceCheck extends Instrumentation {
 private final StringBuilder result=new StringBuilder();private Context context;private int assertions=0;
 public void onCreate(Bundle args){super.onCreate(args);start();}
 void check(boolean ok,String message){assertions++;if(!ok)throw new AssertionError(message);}
 long at(String date,String time){return LocalDate.parse(date).atTime(LocalTime.parse(time)).atZone(ZoneId.of("Asia/Shanghai")).toInstant().toEpochMilli();}
 JSONObject fixture()throws Exception{
  JSONObject state=new JSONObject(),snapshot=new JSONObject();state.put("snapshot",snapshot);
  snapshot.put("semester",new JSONObject().put("id","synthetic").put("startDate","2026-08-31").put("weeks",25));
  JSONArray rules=new JSONArray();int[] hours={8,10,12,14,16,18,19,20};
  for(int i=0;i<hours.length;i++)rules.put(new JSONObject().put("id","fixture-"+i).put("name","测试课程"+i).put("teacher","测试老师"+i).put("room","测试教室"+i).put("weekday",2).put("weeks",new JSONArray().put(7)).put("startTime",String.format(java.util.Locale.US,"%02d:00",hours[i])).put("endTime",String.format(java.util.Locale.US,"%02d:45",hours[i])));
  snapshot.put("rules",rules);return state;
 }
 View apply(int layout,ScheduleWidgetData.WidgetData data,boolean full,boolean tall,int width,int height)throws Exception{
  RemoteViews remote=new RemoteViews(context.getPackageName(),layout);ScheduleWidgetData.bind(context,remote,data,full,tall);
  View v=remote.apply(context,new FrameLayout(context));int w=Math.round(width*context.getResources().getDisplayMetrics().density),h=Math.round(height*context.getResources().getDisplayMetrics().density);
  v.measure(View.MeasureSpec.makeMeasureSpec(w,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(h,View.MeasureSpec.EXACTLY));v.layout(0,0,w,h);
  if(full){ListView list=v.findViewById(R.id.widget_course_list);check(list.getCount()==data.courses.size(),"Full collection must retain all rows");check(list.getHeight()>0,"List viewport must fit inside widget");}
  return v;
 }
 String text(View root,int id){return ((TextView)root.findViewById(id)).getText().toString();}
 void save(View view,String name)throws Exception{
  File dir=new File(context.getExternalFilesDir(null),"widget-check");dir.mkdirs();Bitmap b=Bitmap.createBitmap(view.getWidth(),view.getHeight(),Bitmap.Config.ARGB_8888);view.draw(new Canvas(b));try(FileOutputStream out=new FileOutputStream(new File(dir,name))){b.compress(Bitmap.CompressFormat.PNG,100,out);}b.recycle();
 }
 public void onStart(){Bundle report=new Bundle();final Throwable[] failure=new Throwable[1];runOnMainSync(()->{try{
  context=getTargetContext();File stateFile=new File(context.getFilesDir(),"state.json");byte[] before=stateFile.exists()?Files.readAllBytes(stateFile.toPath()):null;
  JSONObject state=fixture();ScheduleWidgetData.WidgetData active=ScheduleWidgetData.read(state,at("2026-10-13","19:10"));
  check(active.courses.size()==8,"Full day contains eight synthetic courses");check(active.pair.size()==2,"Two-course widget retains active and next");check("测试课程6".equals(active.pair.get(0).name)&&"测试课程7".equals(active.pair.get(1).name),"Pair selection respects time");check("课程进行中".equals(active.status),"Ongoing label");check(active.nextRefresh>at("2026-10-13","19:10")&&active.nextRefresh<=at("2026-10-13","19:25"),"Boundary refresh is bounded");
  ScheduleWidgetData.WidgetData pending=ScheduleWidgetData.read(state,at("2026-10-13","07:00"));check(pending.pair.size()==2&&pending.current==null,"Before school show two upcoming courses");
  check(ScheduleWidgetData.ongoing(active.pair.get(0),19*60),"Start inclusive");check(!ScheduleWidgetData.ongoing(active.pair.get(0),19*60+45),"End exclusive");
  View tall=apply(R.layout.widget_schedule_tall,active,false,true,110,250);check(text(tall,R.id.widget_current_label).equals("课程进行中"),"Tall active label");check(text(tall,R.id.widget_current_meta).contains("测试老师6"),"Tall teacher");check(text(tall,R.id.widget_next_course).equals("测试课程7"),"Tall second course");save(tall,"2x4-两门课与进行中.png");
  View pendingTall=apply(R.layout.widget_schedule_tall,pending,false,true,110,250);check(pendingTall.findViewById(R.id.widget_current_block).getVisibility()==View.VISIBLE&&pendingTall.findViewById(R.id.widget_next_block).getVisibility()==View.VISIBLE,"Two future blocks visible");
  ScheduleWidgetData.WidgetData single=ScheduleWidgetData.read(state,at("2026-10-13","20:10"));View one=apply(R.layout.widget_schedule_tall,single,false,true,110,250);check(one.findViewById(R.id.widget_next_block).getVisibility()==View.GONE,"One course hides empty second block");save(one,"2x4-单门课居中.png");
  ScheduleWidgetData.WidgetData ended=ScheduleWidgetData.read(state,at("2026-10-13","21:00"));check(ended.courses.size()==8&&ended.pair.size()==0&&"今日已无课".equals(ended.status),"End of day full list retains completed courses");
  View landscape=apply(R.layout.widget_schedule_landscape,active,true,false,250,110);save(landscape,"4x2-今日完整课程.png");View full=apply(R.layout.widget_schedule_wide,active,true,false,250,250);save(full,"4x4-今日完整课程.png");
  ListView list=full.findViewById(R.id.widget_course_list);View row=list.getAdapter().getView(6,null,list);check(text(row,R.id.widget_row_status).equals("课程进行中"),"Collection active row status");check(text(row,R.id.widget_row_meta).contains("测试老师6"),"Collection teacher");
  check(text(list.getAdapter().getView(0,null,list),R.id.widget_row_status).equals("已结束"),"Full widget keeps finished rows");check(text(list.getAdapter().getView(7,null,list),R.id.widget_row_status).equals("未开始"),"Full widget upcoming rows");
  View noCourse=apply(R.layout.widget_schedule_wide,ScheduleWidgetData.read(state,at("2026-10-14","12:00")),true,false,250,250);check(text(noCourse,R.id.widget_empty).equals("今日已无课"),"Empty day message");apply(R.layout.widget_schedule_small,active,false,false,110,110);
  RemoteViews rowRemote=ScheduleWidgetData.row(context,active.pair.get(0),active.minute);android.os.Parcel parcel=android.os.Parcel.obtain();rowRemote.writeToParcel(parcel,0);parcel.setDataPosition(0);RemoteViews transferred=RemoteViews.CREATOR.createFromParcel(parcel);check(text(transferred.apply(context,new FrameLayout(context)),R.id.widget_row_status).equals("课程进行中"),"Binder serialization and inflation");parcel.recycle();
  check(Arrays.equals(before,stateFile.exists()?Files.readAllBytes(stateFile.toPath()):null),"Personal state must not change");
  result.append("PASS "+assertions+" assertions: four RemoteViews layouts inflate; two-course pair; full-day list count; ongoing boundaries; empty/single-course states; binder; personal state unchanged.\n");
 }catch(Throwable e){failure[0]=e;result.append("FAIL "+e.toString()+"\n");for(StackTraceElement line:e.getStackTrace())result.append(line.toString()+"\n");}});
  report.putString("stream",result.toString());finish(failure[0]==null?Activity.RESULT_OK:Activity.RESULT_CANCELED,report);
 }
}
