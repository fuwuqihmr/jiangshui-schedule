package android.content;
/** JVM fixture stub: only the Intent API used by ScheduleWidgetData. */
public class Intent{
  public static final int FLAG_ACTIVITY_CLEAR_TOP=0x04000000,FLAG_ACTIVITY_SINGLE_TOP=0x20000000;
  public Intent(){}
  public Intent(Context context,Class<?> cls){}
  public Intent setAction(String action){return this;}
  public Intent putExtra(String key,boolean value){return this;}
  public Intent putExtra(String key,String value){return this;}
  public Intent addFlags(int flags){return this;}
}
