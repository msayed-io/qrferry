package com.msayed.qrferry.local;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.core.content.FileProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Collections;
import java.util.Random;
import java.util.UUID;

/** Metadata recovery after an app-process interruption.
 *
 * CI runs this in two separate instrumentation processes with `am force-stop`
 * between them, so the restored record must come from disk, never from memory.
 * The second process also proves that durable received bytes are reused and
 * that no transport trust (ticket/authentication) survives the interruption. */
@RunWith(AndroidJUnit4.class)
public class LocalRecoveryProcessTest {
 private static final String PREFS="local-recovery-process-fixture";
 private static final long KEPT=4096;
 private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 private static byte[] content(){byte[]data=new byte[12345];new Random(1907).nextBytes(data);return data;}
 private static String hex(byte[]value){StringBuilder out=new StringBuilder();for(byte b:value)out.append(String.format("%02x",b));return out.toString();}
 private static String digest(byte[]value)throws Exception{return hex(MessageDigest.getInstance("SHA-256").digest(value));}
 private File inbox(){return new File(context().getFilesDir(),"local-inbox");}

 private void checkpoint()throws Exception{
  Context c=context();byte[]bytes=content();
  File source=new File(c.getCacheDir(),"recovery-process-source.bin");try(FileOutputStream out=new FileOutputStream(source)){out.write(bytes);out.getFD().sync();}
  LocalFiles files=new LocalFiles(c);
  Uri uri=FileProvider.getUriForFile(c,c.getPackageName()+".fileprovider",source);
  files.addUris(Collections.singletonList(uri),0);
  LocalFiles.Source selected=files.sources().get(0);
  assertEquals(bytes.length,selected.size);
  String digest=files.hash(selected),id=selected.transferId(digest);
  assertEquals(0,files.prepare(id,selected.name,selected.mime,selected.size,digest));
  assertEquals(KEPT,files.append(id,0,bytes,(int)KEPT));
  JSONObject transfer=new JSONObject().put("id",id).put("name",selected.name).put("size",bytes.length).put("direction","in").put("status","receiving").put("bytes",KEPT);
  JSONObject message=new JSONObject().put("id",UUID.randomUUID().toString()).put("text","recovered local message").put("direction","out").put("status","sending").put("time",System.currentTimeMillis());
  JSONObject state=new JSONObject().put("revision",10).put("role","receive").put("method","lan").put("started",true).put("phase","transferring")
   .put("files",new JSONArray().put(transfer)).put("messages",new JSONArray().put(message)).put("bytes",KEPT)
   .put("ticket","MUST_NOT_PERSIST").put("receiverTicket","MUST_NOT_PERSIST").put("secret","MUST_NOT_PERSIST").put("authenticated",true);
  try(LocalRecovery recovery=new LocalRecovery(c)){
   recovery.save(state,files.recoverySources());recovery.flush();
   assertFalse("recovery journal must be writable",recovery.failed());
   String saved;try(InputStream journal=new FileInputStream(new File(c.getNoBackupFilesDir(),"local-recovery.json"))){java.io.ByteArrayOutputStream text=new java.io.ByteArrayOutputStream();byte[]buffer=new byte[8192];for(int n;(n=journal.read(buffer))!=-1;)text.write(buffer,0,n);saved=new String(text.toByteArray(),StandardCharsets.UTF_8);}
   assertFalse("tickets must never be persisted",saved.contains("MUST_NOT_PERSIST"));
   assertFalse("trust state must never be persisted",saved.contains("authenticated"));
  }
  SharedPreferences fixture=c.getSharedPreferences(PREFS,0);
  assertTrue(fixture.edit().putInt("pid",android.os.Process.myPid()).putString("id",id).putString("digest",digest).putString("source",selected.id).commit());
 }

 private void restore(boolean otherProcess)throws Exception{
  Context c=context();SharedPreferences fixture=c.getSharedPreferences(PREFS,0);
  String id=fixture.getString("id",""),digest=fixture.getString("digest","");
  assertTrue("checkpoint stage must run first",LocalProtocol.hash(id));
  assertTrue("checkpoint stage must run first",LocalProtocol.hash(digest));
  if(otherProcess)assertNotEquals("recovery must be read after the original app process ended",fixture.getInt("pid",-1),android.os.Process.myPid());

  LocalEngine engine=new LocalEngine(c,true);
  try{
   JSONObject state=engine.snapshot();
   assertTrue("interrupted session must be reported as recovered",state.getBoolean("recovered"));
   assertEquals("recovery",state.getString("phase"));
   assertFalse("restored session must not claim trust",state.getBoolean("authenticated"));
   assertFalse("restored session must not offer a pairing code",state.getBoolean("qrReady"));
   assertTrue("restored session must not run unattended",state.getBoolean("paused"));
   assertEquals(KEPT,state.getJSONArray("files").getJSONObject(0).getLong("bytes"));
   assertEquals("paused",state.getJSONArray("files").getJSONObject(0).getString("status"));
   assertEquals("failed",state.getJSONArray("messages").getJSONObject(0).getString("status"));
   assertFalse("recovery phase must allow choosing files or a destination",engine.busy());

   assertEquals(1,engine.files.sources().size());
   LocalFiles.Source source=engine.files.sources().get(0);
   assertEquals(fixture.getString("source",""),source.id);
   assertEquals("the restored source must keep the same transfer identity",id,source.transferId(engine.files.hash(source)));
   assertEquals("durable bytes must be kept",KEPT,engine.files.prepare(id,source.name,source.mime,source.size,digest));
   byte[]remaining=Arrays.copyOfRange(content(),(int)KEPT,content().length);
   engine.files.append(id,KEPT,remaining,remaining.length);
   assertEquals(content().length,new File(inbox(),id+".part").length());
   try(InputStream in=new FileInputStream(new File(inbox(),id+".part"))){assertEquals("resumed file must be complete and intact",digest,LocalProtocol.sha(in));}

   engine.checkpointRecovery();
   engine.shutdown();
   assertTrue("recovery record must survive a clean shutdown",new File(c.getNoBackupFilesDir(),"local-recovery.json").isFile());
  }finally{
   engine.shutdown();
   for(String suffix:new String[]{".part",".json",".done",".txn"})new android.util.AtomicFile(new File(inbox(),id+suffix)).delete();
   new android.util.AtomicFile(new File(c.getNoBackupFilesDir(),"local-recovery.json")).delete();
   new File(c.getCacheDir(),"recovery-process-source.bin").delete();
   getPreferencesCleanup(fixture);
  }
 }
 private static void getPreferencesCleanup(SharedPreferences fixture){fixture.edit().clear().commit();}

 @Test public void recoversMetadataAndDurableBytesWithoutRestoringTrust()throws Exception{
  String stage=InstrumentationRegistry.getArguments().getString("recoveryStage","roundtrip");
  if("checkpoint".equals(stage)){checkpoint();return;}
  if("restore".equals(stage)){restore(true);return;}
  checkpoint();restore(false);
 }
}
