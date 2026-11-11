package com.msayed.qrferry.local;

import android.app.*;
import android.content.*;
import android.os.*;
import androidx.core.app.NotificationCompat;
import com.msayed.qrferry.MainActivity;

/** User-initiated, visible transfer. No silent restart after force-stop. */
public class LocalTransferService extends Service {
 private static LocalEngine engine;private LocalEngine.Listener listener;private LocalPower power;
 private final Handler main=new Handler(Looper.getMainLooper());private boolean destroyed;private long lastNotification;
 private final Runnable refresh=new Runnable(){public void run(){if(destroyed)return;org.json.JSONObject s=engine(LocalTransferService.this).snapshot();power.update(s.optString("phase"),s.optBoolean("paused"));main.postDelayed(this,30000);}};
 public static synchronized LocalEngine engine(Context c){if(engine==null)engine=new LocalEngine(c.getApplicationContext(),true);return engine;}
 @Override public void onCreate(){
  super.onCreate();power=new LocalPower(this);NotificationManager nm=getSystemService(NotificationManager.class);
  if(Build.VERSION.SDK_INT>=26)nm.createNotificationChannel(new NotificationChannel("local-transfer","QRFerry · Local transfer",NotificationManager.IMPORTANCE_LOW));
  listener=s->main.post(()->{if(destroyed)return;String phase=s.optString("phase");power.update(phase,s.optBoolean("paused"));if(phase.equals("closed")){stopSelf();return;}long now=SystemClock.elapsedRealtime();if(now-lastNotification>=1000){lastNotification=now;nm.notify(7342,notification(phase));}});
  main.post(refresh);
 }
 private Notification notification(String phase){
  boolean ar=getResources().getConfiguration().getLocales().get(0).getLanguage().equals("ar");
  String status=phase.equals("paused")||phase.equals("recovery")?(ar?"النقل متوقف؛ افتح التطبيق للاستكمال":"Transfer paused; open the app to resume"):phase.equals("complete")?(ar?"اكتمل نقل الملفات والتحقق منها":"Files transferred and verified"):phase.equals("waiting")?(ar?"بانتظار الجهاز الآخر":"Waiting for the other device"):(ar?"جلسة نقل محلية نشطة":"Local transfer session active");
  Intent open=new Intent(this,MainActivity.class);PendingIntent tap=PendingIntent.getActivity(this,7342,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Intent stop=new Intent(this,LocalTransferService.class).setAction("cancel");PendingIntent cancel=PendingIntent.getService(this,7343,stop,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  return new NotificationCompat.Builder(this,"local-transfer").setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle(ar?"QRFerry · نقل محلي":"QRFerry · Local transfer").setContentText(status).setContentIntent(tap).setOngoing(true).setSilent(true).addAction(0,ar?"إنهاء الجلسة":"End session",cancel).build();
 }
 @Override public int onStartCommand(Intent intent,int flags,int id){if(intent!=null&&"cancel".equals(intent.getAction())){engine(this).disconnect();stopSelf();return START_NOT_STICKY;}startForeground(7342,notification(engine(this).snapshot().optString("phase")));engine(this).unsubscribe(listener);engine(this).subscribe(listener);return START_NOT_STICKY;}
 @Override public void onTaskRemoved(Intent rootIntent){engine(this).checkpointRecovery();super.onTaskRemoved(rootIntent);}
 @Override public IBinder onBind(Intent i){return null;}
 @Override public void onDestroy(){destroyed=true;main.removeCallbacksAndMessages(null);engine(this).unsubscribe(listener);power.close();engine(this).suspend();super.onDestroy();}
}
