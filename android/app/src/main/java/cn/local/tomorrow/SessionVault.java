package cn.local.tomorrow;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.spec.GCMParameterSpec;

/** Encrypted local backup for the CAS TGC and the academic-session cookie. */
public final class SessionVault {
 private static final String FILE="school-cookies.enc",ALIAS="school-cookies-v1";
 private SessionVault() {}
 private static KeyStore store()throws Exception{KeyStore s=KeyStore.getInstance("AndroidKeyStore");s.load(null);return s;}
 private static void ensureKey(KeyStore s)throws Exception{if(s.containsAlias(ALIAS))return;KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();}
 private static File file(Context c){return new File(c.getFilesDir(),FILE);}
 private static JSONObject read(Context c)throws Exception{File f=file(c);if(!f.exists())return null;KeyStore s=store();if(!s.containsAlias(ALIAS))return null;JSONObject e;try(FileInputStream in=new FileInputStream(f)){e=new JSONObject(new String(StateStore.read(in,100000),StandardCharsets.UTF_8));}Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,s.getKey(ALIAS,null),new GCMParameterSpec(128,Base64.decode(e.getString("iv"),Base64.NO_WRAP)));return new JSONObject(new String(cipher.doFinal(Base64.decode(e.getString("data"),Base64.NO_WRAP)),StandardCharsets.UTF_8));}
 private static void write(Context c,JSONObject payload)throws Exception{KeyStore s=store();ensureKey(s);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,s.getKey(ALIAS,null));JSONObject e=new JSONObject();e.put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP));e.put("data",Base64.encodeToString(cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP));File tmp=new File(c.getFilesDir(),FILE+".tmp"),dst=file(c);try(FileOutputStream out=new FileOutputStream(tmp)){out.write(e.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();}if(!tmp.renameTo(dst))throw new IOException("学校会话保存失败");}
 public static synchronized void save(Context c,String tgc,String academic)throws Exception{JSONObject p=null;try{p=read(c);}catch(Exception ignored){}if(p==null)p=new JSONObject();p.put("version",1);p.put("savedAt",System.currentTimeMillis());if(tgc!=null&&!tgc.isEmpty())p.put("tgc",tgc);if(academic!=null&&!academic.isEmpty())p.put("academic",academic);if(!p.has("tgc")&&!p.has("academic"))return;write(c,p);}
 public static synchronized JSONObject load(Context c)throws Exception{return read(c);}
 public static synchronized void clearTgc(Context c)throws Exception{JSONObject p=read(c);if(p==null)return;p.remove("tgc");if(!p.has("academic")){clear(c);return;}p.put("savedAt",System.currentTimeMillis());write(c,p);}
 public static synchronized void clear(Context c)throws Exception{file(c).delete();new File(c.getFilesDir(),FILE+".tmp").delete();KeyStore s=store();if(s.containsAlias(ALIAS))s.deleteEntry(ALIAS);}
}
