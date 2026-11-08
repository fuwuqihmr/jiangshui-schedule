package cn.local.tomorrow;

/** Cookie header helpers. Values are never logged or included in diagnostics. */
public final class SessionCookies {
 private SessionCookies() {}
 public static String value(String header,String name){
  if(header==null||name==null)return null;
  for(String part:header.split(";")){String item=part.trim();int i=item.indexOf('=');if(i<=0)continue;if(name.equals(item.substring(0,i).trim()))return item.substring(i+1).trim();}
  return null;
 }
 public static boolean present(String header,String name){String v=value(header,name);return v!=null&&!v.isEmpty();}
 public static String choose(String header,String... names){if(names==null)return null;for(String name:names){String value=value(header,name);if(value!=null&&!value.isEmpty())return value;}return null;}
}
