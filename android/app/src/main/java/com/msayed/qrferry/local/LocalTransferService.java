package com.msayed.qrferry.local;

import android.app.*;
import android.content.*;
import android.os.*;
import androidx.core.app.NotificationCompat;
import com.msayed.qrferry.MainActivity;

/** User-initiated device transfer; not a sticky or invisible background service. */
public class LocalTransferService extends Service {
 private static LocalEngine engine;private LocalEngine.Listener listener;
 public static synchronized LocalEngine engine(Context c){if(engine==null)engine=new LocalEngine(c.getApplicationContext());return engine;}
 @Override public void onCreate(){super.onCreate();NotificationManager nm=getSystemService(NotificationManager.class);if(Build.VERSION.SDK_INT>=26)nm.createNotificationChannel(new NotificationChannel("local-transfer","QRFerry · Local transfer",NotificationManager.IMPORTANCE_LOW));listener=s->{String phase=s.optString("phase");if(phase.equals("closed")){stopSelf();return;}Notification n=notification(phase);nm.notify(7342,n);};}
 private Notification notification(String phase){boolean ar=getResources().getConfiguration().getLocales().get(0).getLanguage().equals("ar");Intent open=new Intent(this,MainActivity.class);PendingIntent tap=PendingIntent.getActivity(this,7342,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Intent stop=new Intent(this,LocalTransferService.class).setAction("cancel");PendingIntent cancel=PendingIntent.getService(this,7343,stop,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);return new NotificationCompat.Builder(this,"local-transfer").setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle(ar?"QRFerry · نقل محلي":"QRFerry · Local transfer").setContentText(ar?"جلسة محلية نشطة؛ اضغط لعرض حالتها":"Local session active; tap to view status").setContentIntent(tap).setOngoing(true).setSilent(true).addAction(0,ar?"إنهاء الجلسة":"End session",cancel).build();}
 @Override public int onStartCommand(Intent intent,int flags,int id){if(intent!=null&&"cancel".equals(intent.getAction())){engine(this).disconnect();stopSelf();return START_NOT_STICKY;}startForeground(7342,notification("preparing"));engine(this).unsubscribe(listener);engine(this).subscribe(listener);return START_NOT_STICKY;}
 @Override public IBinder onBind(Intent i){return null;}
 @Override public void onDestroy(){engine(this).unsubscribe(listener);engine(this).disconnect();super.onDestroy();}
}
