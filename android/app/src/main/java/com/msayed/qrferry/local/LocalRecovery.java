package com.msayed.qrferry.local;

import android.content.Context;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

/** Private, no-backup recovery metadata. Never persists QR secrets, TLS keys,
 * tickets, network passwords or a claim that a restarted connection is trusted. */
final class LocalRecovery implements AutoCloseable {
 private static final int LIMIT=12*1024*1024;
 private final AtomicFile file;
 private final ScheduledExecutorService writer=Executors.newSingleThreadScheduledExecutor();
 private JSONObject pending;private long revision=-1;private boolean scheduled;private volatile boolean failed;
 LocalRecovery(Context context){file=new AtomicFile(new File(context.getNoBackupFilesDir(),"local-recovery.json"));}
 synchronized JSONObject read(){
  try(InputStream in=file.openRead();ByteArrayOutputStream out=new ByteArrayOutputStream()){
   byte[]buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>LIMIT)throw new IOException("RECOVERY_TOO_LARGE");out.write(buffer,0,n);}
   JSONObject data=new JSONObject(out.toString("UTF-8"));if(data.getInt("version")!=1)throw new IOException("RECOVERY_VERSION");revision=data.optLong("revision",0);return data;
  }catch(FileNotFoundException absent){return null;}catch(Exception damaged){failed=true;return null;}
 }
 synchronized void save(JSONObject snapshot,JSONArray sources){
  long next=snapshot.optLong("revision");if(next<revision||writer.isShutdown())return;
  try{
   JSONObject data=new JSONObject().put("version",1).put("revision",next).put("savedAt",System.currentTimeMillis()).put("sources",sources);
   for(String key:new String[]{"role","method","started","files","messages","bytes","phase"})data.put(key,snapshot.get(key));
   pending=new JSONObject(data.toString());revision=next;
   if(!scheduled){scheduled=true;writer.schedule(this::flush,500,TimeUnit.MILLISECONDS);}
  }catch(Exception e){failed=true;}
 }
 synchronized void flush(){
  scheduled=false;if(pending==null)return;FileOutputStream out=null;
  try{byte[]data=pending.toString().getBytes(StandardCharsets.UTF_8);if(data.length>LIMIT)throw new IOException("RECOVERY_TOO_LARGE");out=file.startWrite();out.write(data);file.finishWrite(out);pending=null;failed=false;}
  catch(Exception e){if(out!=null)file.failWrite(out);failed=true;}
 }
 boolean failed(){return failed;}
 @Override public void close(){flush();writer.shutdown();}
}
