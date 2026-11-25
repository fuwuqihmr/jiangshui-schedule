// JVM contract check for production notification binding; does not simulate SystemUI rendering.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const project=path.resolve(__dirname,'..'),work=path.resolve(project,'android/notification-test');
const sdk=path.resolve(project,'../toolchain/android-sdk/platforms/android-35/android.jar'),app=path.join(process.env.ANDROID_BUILD||path.join(project,'android/direct-build'),'classes');
const generated=path.join(process.env.ANDROID_BUILD||path.join(project,'android/direct-build'),'gen/cn/local/tomorrow/R.java');
const stubs={
 'android/content/Context.java':'package android.content;public class Context{public String getPackageName(){return "cn.local.tomorrow";}public int getColor(int id){return id;}}',
 'android/content/Intent.java':'package android.content;public class Intent{public static final int FLAG_ACTIVITY_CLEAR_TOP=1,FLAG_ACTIVITY_SINGLE_TOP=2;public boolean changes;public Intent(Context c,Class<?> target){}public Intent putExtra(String k,boolean v){if(k.equals("open_changes"))changes=v;return this;}public Intent addFlags(int v){return this;}}',
 'android/app/PendingIntent.java':'package android.app;public class PendingIntent{public static final int FLAG_UPDATE_CURRENT=1,FLAG_IMMUTABLE=2;public android.content.Intent intent;public static PendingIntent getActivity(android.content.Context c,int request,android.content.Intent intent,int flags){PendingIntent p=new PendingIntent();p.intent=intent;return p;}}',
 'android/os/SystemClock.java':'package android.os;public class SystemClock{public static long elapsedRealtime(){return 42000;}}',
 'android/view/View.java':'package android.view;public class View{public static final int VISIBLE=0,GONE=8;}',
 'android/app/Notification.java':`package android.app;public class Notification{
 public static final int VISIBILITY_PUBLIC=1;public static final String CATEGORY_EVENT="event",CATEGORY_SERVICE="service";
 public String title,body;public Notification publicVersion;public boolean ongoing,autoCancel;public PendingIntent open;public android.widget.RemoteViews compact,expanded,heads;
 public static class Style{}public static class DecoratedCustomViewStyle extends Style{}public static class BigTextStyle extends Style{public BigTextStyle bigText(CharSequence t){return this;}}
 public static class Builder{final Notification n=new Notification();public Builder(android.content.Context c,String channel){}
 public Builder setSmallIcon(int v){return this;}public Builder setContentTitle(CharSequence v){n.title=v.toString();return this;}public Builder setContentText(CharSequence v){n.body=v.toString();return this;}
 public Builder setContentIntent(PendingIntent v){n.open=v;return this;}public Builder setStyle(Style v){return this;}public Builder setShowWhen(boolean v){return this;}public Builder setColor(int v){return this;}public Builder setVisibility(int v){return this;}public Builder setSubText(CharSequence v){return this;}
 public Builder setCustomContentView(android.widget.RemoteViews v){n.compact=v;return this;}public Builder setCustomBigContentView(android.widget.RemoteViews v){n.expanded=v;return this;}public Builder setCustomHeadsUpContentView(android.widget.RemoteViews v){n.heads=v;return this;}
 public Builder setPublicVersion(Notification v){n.publicVersion=v;return this;}public Builder setCategory(String v){return this;}public Builder setOngoing(boolean v){n.ongoing=v;return this;}public Builder setAutoCancel(boolean v){n.autoCancel=v;return this;}public Builder setOnlyAlertOnce(boolean v){return this;}public Notification build(){return n;}
 }} `,
 'android/widget/RemoteViews.java':`package android.widget;import java.util.*;public class RemoteViews{
 public static Map<Integer,Set<Integer>> layouts=new HashMap<>();public final int layout;public Map<Integer,String> text=new HashMap<>();public Map<Integer,Integer> visibility=new HashMap<>();public Map<Integer,android.app.PendingIntent> actions=new HashMap<>();public long clock;public boolean countdown;
 public RemoteViews(String p,int l){layout=l;if(!layouts.containsKey(l))throw new AssertionError("Missing layout");}
 void id(int v){if(!layouts.get(layout).contains(v))throw new AssertionError("Missing target id in layout: "+v);}
 public void setTextViewText(int v,CharSequence t){id(v);text.put(v,t.toString());}public void setViewVisibility(int v,int value){id(v);visibility.put(v,value);}public void setInt(int v,String m,int n){id(v);}
 public void setOnClickPendingIntent(int v,android.app.PendingIntent p){id(v);actions.put(v,p);}public void setChronometerCountDown(int v,boolean b){id(v);countdown=b;}public void setChronometer(int v,long base,String format,boolean started){id(v);clock=base;if(!started)throw new AssertionError("Clock not started");}
 }`
};
stubs['cn/local/tomorrow/XiaomiFocus.java']='package cn.local.tomorrow;final class XiaomiFocus{static boolean attach(android.content.Context c,android.app.Notification.Builder b,ClassReminderPlan.Event e,long now,android.app.PendingIntent p,boolean updating){return false;}}';
let fixtures='';
for(const name of ['notification_compact','notification_expanded','notification_heads_up']){
 const xml=fs.readFileSync(path.join(project,'android/app/src/main/res/layout',name+'.xml'),'utf8');
 for(const tag of xml.matchAll(/<([A-Za-z][\w.]*)\b/g))if(!['LinearLayout','FrameLayout','TextView','Chronometer','ImageView'].includes(tag[1]))throw Error('Unsupported RemoteViews node: '+tag[1]);
 const ids=[...xml.matchAll(/@\+id\/(\w+)/g)].map(m=>'R.id.'+m[1]);fixtures+=`RemoteViews.layouts.put(R.layout.${name},new HashSet<>(Arrays.asList(${ids.join(',')})));\n`;
}
stubs['cn/local/tomorrow/NotificationCardsCheck.java']=`package cn.local.tomorrow;import android.app.*;import android.content.*;import android.widget.*;import java.util.*;
public class NotificationCardsCheck{
 static int count;static void check(boolean ok,String why){count++;if(!ok)throw new AssertionError(why);}
 public static void main(String[] args)throws Exception{${fixtures}
 Context context=new Context();PendingIntent open=NotificationCards.openApp(context,2401);long now=1000000;
 ScheduleWidgetData.Item r=new ScheduleWidgetData.Item();r.name="工程图学C";r.start="14:00";r.end="15:25";r.room="教学南大楼（南C101）";r.teacher="示例教师";
 ClassReminderPlan.Event e=new ClassReminderPlan.Event();e.course=r;e.showAt=now;e.startAt=now+19*60000L;e.endAt=e.startAt+85*60000L;e.expiresAt=e.startAt+5*60000L;
 Notification notice=NotificationCards.lesson(context,e,now,open).build();
 check(notice.title.contains("14:00–15:25")&&notice.title.contains("南C101"),"Time and location in accessible title");check(notice.body.contains("工程图学C")&&notice.body.contains("示例教师"),"Course and teacher in accessible body");
 for(RemoteViews v:new RemoteViews[]{notice.compact,notice.expanded,notice.heads}){check(v!=null,"Three notification surfaces");check(v.clock==42000+19*60000L&&v.countdown,"Monotonic countdown");check(v.visibility.get(R.id.notice_status)==8,"Before-class status is countdown");check(v.text.get(R.id.notice_course).contains("工程图学C"),"Course retained on all surfaces");}
 check(notice.publicVersion!=null&&notice.publicVersion.title.contains("南C101"),"Public lockscreen version keeps course time and room");
 check(notice.expanded.text.get(R.id.notice_teacher).contains("示例教师"),"Expanded teacher");check(notice.expanded.actions.get(R.id.notice_action)==open,"Manage opens app; no direct close action");
 notice=NotificationCards.lesson(context,e,e.startAt,open).build();check(notice.expanded.text.get(R.id.notice_status).equals("课程进行中"),"Class start state");check(notice.expanded.visibility.get(R.id.notice_clock)==8,"Countdown hidden after start");
 notice=NotificationCards.lesson(context,e,e.endAt,open).build();check(notice.heads.text.get(R.id.notice_status).equals("课程已结束"),"Class end state");
 r.room="—";r.teacher="";notice=NotificationCards.lesson(context,e,now,open).build();check(notice.title.contains("地点待确认"),"Room fallback");check(notice.expanded.text.get(R.id.notice_teacher).contains("老师待确认"),"Teacher fallback");
 Notification change=NotificationCards.message(context,"changes","课表发生变化","课程地点已调整","课表变更",NotificationCards.openApp(context,1001),false);
 check(change.autoCancel&&!change.ongoing,"Changes are dismissible");check(change.open.intent.changes,"Changes open change records");check(change.expanded.text.get(R.id.notice_action).equals("查看变更"),"Change action label");check(change.heads.text.get(R.id.notice_status).equals("课表变更"),"Change heads-up content");
 Notification running=NotificationCards.message(context,"daily-check","正在核对","完成后结束","核对中",open,true);check(running.ongoing&&!running.autoCancel,"Background check remains ongoing");
 org.json.JSONObject focus=FocusTemplate.payload(e,now,3,false),v2=focus.getJSONObject("param_v2");
 check(v2.getLong("timeout")==Math.max(1,(e.expiresAt-now+59999)/60000),"Focus timeout is in minutes and covers the reminder window");
 check(!focus.has("param_island")&&v2.has("param_island"),"Island uses the documented nested param_v2 location");
 check(v2.getJSONObject("baseInfo").getString("content").equals("工程图学C"),"Focus course text");
 check(v2.getJSONObject("hintInfo").getJSONObject("timerInfo").getLong("timerWhen")==e.startAt,"Focus system countdown uses the course start timestamp");
 check(v2.getJSONObject("param_island").getJSONObject("bigIslandArea").has("sameWidthDigitInfo"),"OS3 island includes system countdown");
 check(!FocusTemplate.payload(e,now,2,false).getJSONObject("param_v2").has("param_island"),"OS2 does not receive OS3 island fields");
 check(!FocusTemplate.payload(e,now,3,true).getJSONObject("param_v2").getBoolean("enableFloat"),"Content updates do not request another floating banner");
 check(!FocusTemplate.payload(e,e.startAt,3,false).getJSONObject("param_v2").getJSONObject("hintInfo").has("timerInfo"),"Focus countdown removed at start");
 r.name=String.join("",Collections.nCopies(80,"课"));r.room=String.join("",Collections.nCopies(80,"室"));r.teacher=String.join("",Collections.nCopies(80,"师"));
 check(FocusTemplate.payload(e,now,3,false).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=3072,"Focus payload respects Xiaomi's 3072-byte limit");
 System.out.println("NOTIFICATION CARDS PASS: "+count+" notification payload/layout assertions; three actual XML layout ID contracts. SystemUI rendering not exercised.");
 }} `;
fs.mkdirSync(work,{recursive:true});const files=[];for(const [name,text] of Object.entries(stubs)){const file=path.join(work,'src',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);files.push(file);}
const classes=path.join(work,'classes');fs.mkdirSync(classes,{recursive:true});
const cp=[app,path.join(project,'android/widget-test/json-20240303.jar'),sdk].join(path.delimiter);
execFileSync('javac',['-encoding','UTF-8','-classpath',cp,'-d',classes,...files,generated,path.join(project,'android/app/src/main/java/cn/local/tomorrow/NotificationCards.java'),path.join(project,'android/app/src/main/java/cn/local/tomorrow/FocusTemplate.java')],{stdio:'inherit'});
execFileSync('java',['-cp',[classes,cp].join(path.delimiter),'cn.local.tomorrow.NotificationCardsCheck'],{stdio:'inherit'});
