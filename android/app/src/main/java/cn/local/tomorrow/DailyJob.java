package cn.local.tomorrow;
import android.app.job.*;import android.os.*;
public class DailyJob extends JobService {
 BackgroundCheck runner;
 @Override public boolean onStartJob(JobParameters p){CheckScheduler.cancel(this);jobFinished(p,false);return false;}
 @Override public boolean onStopJob(JobParameters p){if(runner!=null)runner.stop();runner=null;return true;}
}
