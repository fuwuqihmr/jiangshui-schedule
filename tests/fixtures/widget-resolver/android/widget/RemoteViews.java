package android.widget;
/** JVM fixture stub: only the RemoteViews API used by ScheduleWidgetData.bind/row. */
public class RemoteViews{
  public RemoteViews(String packageName,int layout){}
  public void setOnClickPendingIntent(int id,android.app.PendingIntent pending){}
  public void setTextViewText(int id,CharSequence text){}
  public void setViewVisibility(int id,int visibility){}
  public void setTextColor(int id,int color){}
  public void setInt(int id,String method,int value){}
  public void setEmptyView(int id,int empty){}
  public void setPendingIntentTemplate(int id,android.app.PendingIntent pending){}
  public void setOnClickFillInIntent(int id,android.content.Intent intent){}
  public void setRemoteAdapter(int id,RemoteCollectionItems items){}
  public static class RemoteCollectionItems{
    public static class Builder{
      public Builder setHasStableIds(boolean stable){return this;}
      public Builder setViewTypeCount(int count){return this;}
      public Builder addItem(long id,RemoteViews view){return this;}
      public RemoteCollectionItems build(){return new RemoteCollectionItems();}
    }
  }
}
