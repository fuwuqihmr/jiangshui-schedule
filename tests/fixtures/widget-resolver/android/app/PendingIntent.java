package android.app;
/** JVM fixture stub: only the PendingIntent API used by ScheduleWidgetData. */
public class PendingIntent{
  public static final int FLAG_UPDATE_CURRENT=0x08000000,FLAG_IMMUTABLE=0x04000000,FLAG_MUTABLE=0x02000000;
  public static PendingIntent getActivity(android.content.Context context,int requestCode,android.content.Intent intent,int flags){return new PendingIntent();}
}
