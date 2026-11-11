package com.msayed.qrferry.local;

import android.content.Context;
import android.os.PowerManager;

/** Bounded CPU ownership only while a user-started session is doing work. */
final class LocalPower implements AutoCloseable {
 private final PowerManager.WakeLock lock;
 LocalPower(Context context){lock=((PowerManager)context.getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"QRFerry:local-transfer");lock.setReferenceCounted(false);}
 synchronized void update(String phase,boolean paused){
  boolean active=!paused&&(phase.equals("preparing")||phase.equals("connecting")||phase.equals("preparing-files")||phase.equals("transferring"));
  if(active)lock.acquire(120000);else close();
 }
 synchronized boolean held(){return lock.isHeld();}
 @Override public synchronized void close(){if(lock.isHeld())lock.release();}
}
