package cn.local.tomorrow;

import org.json.JSONObject;

/** Xiaomi's documented OS2/OS3 system template. It is only used after a permission probe. */
final class FocusTemplate {
 static JSONObject timer(long startAt,long now)throws Exception{return new JSONObject().put("timerType",-1).put("timerWhen",startAt).put("timerSystemCurrent",now);}
 static JSONObject payload(ClassReminderPlan.Event e,long now,int protocol,boolean updating)throws Exception{
  ScheduleWidgetData.Item r=e.course;boolean upcoming=now<e.startAt;
  String room=ClassReminders.field(r.room,"地点待确认"),teacher=ClassReminders.field(r.teacher,r.localActivity?"无任课老师":"老师待确认");
  String phase=upcoming?"即将上课":ClassReminderPlan.phase(e,now);
  JSONObject base=new JSONObject().put("type",2).put("title",r.start+"–"+r.end+"  "+room).put("content",r.name).put("subContent",teacher).put("showDivider",true).put("colorTitle","#192C37").put("colorTitleDark","#F2F7FA");
  JSONObject hint=new JSONObject().put("type",1).put("title",phase).put("content",upcoming?"距上课":phase).put("colorTitle","#007EA8").put("colorTitleDark","#61CFF5").put("actionInfo",new JSONObject().put("action","miui.focus.action_class"));
  if(upcoming)hint.put("timerInfo",timer(e.startAt,now));
  JSONObject focus=new JSONObject().put("protocol",1).put("updatable",true).put("enableFloat",!updating).put("timeout",Math.max(1L,(e.expiresAt-now+59999L)/60000L)).put("ticker",upcoming?"即将上课":"课程进行中").put("aodTitle",r.start+" "+r.name).put("baseInfo",base).put("picInfo",new JSONObject().put("type",1).put("pic","miui.focus.pic_class")).put("hintInfo",hint);
  JSONObject root=new JSONObject().put("param_v2",focus);
  if(protocol>=3){
   JSONObject right=upcoming?new JSONObject().put("sameWidthDigitInfo",new JSONObject().put("timerInfo",timer(e.startAt,now)).put("content","上课").put("showHighlightColor",true)):new JSONObject().put("textInfo",new JSONObject().put("title",phase));
   JSONObject island=new JSONObject().put("islandProperty",1).put("islandTimeout",Math.max(1L,(e.expiresAt-now+999L)/1000L)).put("smallIslandArea",new JSONObject().put("picInfo",new JSONObject().put("type",1).put("pic","miui.focus.pic_class"))).put("bigIslandArea",new JSONObject().put("imageTextInfoLeft",new JSONObject().put("type",1).put("picInfo",new JSONObject().put("type",1).put("pic","miui.focus.pic_class"))));
   if(upcoming)island.getJSONObject("bigIslandArea").put("sameWidthDigitInfo",right.getJSONObject("sameWidthDigitInfo"));else island.getJSONObject("bigIslandArea").put("textInfo",right.getJSONObject("textInfo"));
   focus.put("param_island",island);

  }
  return root;
 }
 private FocusTemplate(){}
}
