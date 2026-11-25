package cn.local.tomorrow;
import android.content.*;import org.json.*;import java.io.*;import java.nio.charset.StandardCharsets;
public final class UserConsent {
 static final String PREF="user-consent";
 static String version(Context c)throws Exception{try(InputStream in=c.getAssets().open("agreement.json")){return new JSONObject(new String(StateStore.read(in,100000),StandardCharsets.UTF_8)).getString("version");}}
 public static boolean granted(Context c){try{android.content.SharedPreferences p=c.getSharedPreferences(PREF,0);return version(c).equals(p.getString("version",""))&&p.getLong("acceptedAt",0)>0;}catch(Exception e){return false;}}
 public static JSONObject status(Context c)throws Exception{android.content.SharedPreferences p=c.getSharedPreferences(PREF,0);return new JSONObject().put("version",p.getString("version","")).put("acceptedAt",p.getLong("acceptedAt",0));}
 public static JSONObject accept(Context c,String requested)throws Exception{if(!version(c).equals(requested))throw new Exception("协议已更新，请重新打开应用确认");if(!c.getSharedPreferences(PREF,0).edit().putString("version",requested).putLong("acceptedAt",System.currentTimeMillis()).commit())throw new Exception("协议确认无法保存，请重试");return status(c);}
 public static void revoke(Context c)throws Exception{if(!c.getSharedPreferences(PREF,0).edit().clear().commit())throw new Exception("授权撤回无法保存，请重试");}
 public static void require(Context c)throws Exception{if(!granted(c))throw new Exception("请先阅读并同意用户协议");}
}
