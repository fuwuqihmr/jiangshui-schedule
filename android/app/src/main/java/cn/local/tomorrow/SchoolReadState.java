package cn.local.tomorrow;

/** Single-owner school read lock; UI and SchoolClient callbacks share it. */
final class SchoolReadState {
    private String active;
    synchronized String active(){return active;}
    synchronized boolean isActive(){return active!=null;}
    synchronized boolean begin(String id){if(id==null||active!=null)return false;active=id;return true;}
    synchronized String finish(){String id=active;active=null;return id;}
    synchronized String finishIf(String id){if(id!=null&&id.equals(active)){active=null;return id;}return null;}
}
