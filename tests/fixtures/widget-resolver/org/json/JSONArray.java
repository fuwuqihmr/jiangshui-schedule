package org.json;
import java.util.*;
/** JVM fixture stub: only the JSONArray API used by ScheduleWidgetData. */
public class JSONArray{
  final List<Object> data=new ArrayList<>();
  public JSONArray(){}
  public JSONArray put(Object value){data.add(value);return this;}
  public int length(){return data.size();}
  public Object opt(int index){return index>=0&&index<data.size()?data.get(index):null;}
  public JSONObject optJSONObject(int index){Object value=opt(index);return value instanceof JSONObject?(JSONObject)value:null;}
  public String optString(int index){Object value=opt(index);return value==null?"":String.valueOf(value);}
  public int optInt(int index,int fallback){Object value=opt(index);if(value instanceof Number)return ((Number)value).intValue();return fallback;}
  public JSONObject getJSONObject(int index)throws Exception{Object value=opt(index);if(value instanceof JSONObject)return (JSONObject)value;throw new Exception("not a JSONObject at "+index);}
}
