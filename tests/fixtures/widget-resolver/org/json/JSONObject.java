package org.json;
import java.util.*;
/** JVM fixture stub: only the JSONObject API used by ScheduleWidgetData (values are built by the fixture). */
public class JSONObject{
  final Map<String,Object> data=new LinkedHashMap<>();
  public JSONObject(){}
  public JSONObject put(String key,Object value){data.put(key,value);return this;}
  public boolean has(String key){return data.containsKey(key);}
  public Object opt(String key){return data.get(key);}
  public String optString(String key){return optString(key,"");}
  public String optString(String key,String fallback){Object value=data.get(key);return value==null?fallback:String.valueOf(value);}
  public boolean optBoolean(String key){return optBoolean(key,false);}
  public boolean optBoolean(String key,boolean fallback){Object value=data.get(key);return value instanceof Boolean?(Boolean)value:fallback;}
  public int optInt(String key){return optInt(key,0);}
  public int optInt(String key,int fallback){Object value=data.get(key);if(value instanceof Number)return ((Number)value).intValue();return fallback;}
  public JSONObject optJSONObject(String key){Object value=data.get(key);return value instanceof JSONObject?(JSONObject)value:null;}
  public JSONArray optJSONArray(String key){Object value=data.get(key);return value instanceof JSONArray?(JSONArray)value:null;}
  public JSONObject getJSONObject(String key)throws Exception{Object value=data.get(key);if(value instanceof JSONObject)return (JSONObject)value;throw new Exception("not a JSONObject: "+key);}
  public String getString(String key)throws Exception{Object value=data.get(key);if(value instanceof String)return (String)value;throw new Exception("not a JSON string: "+key);}
}
