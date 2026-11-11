package com.msayed.qrferry.local;
import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import org.junit.runner.RunWith;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.*;

@RunWith(AndroidJUnit4.class)
public class LocalNativeTest {
 @Test public void platformTlsPinsCertificateAndStreamsExactBytes()throws Exception{
  LocalIdentity identity=new LocalIdentity(UUID.randomUUID().toString());SSLServerSocket server=(SSLServerSocket)identity.server.getServerSocketFactory().createServerSocket(0);ExecutorService worker=Executors.newSingleThreadExecutor();
  byte[]payload=new byte[1048579];new Random(31).nextBytes(payload);
  Future<String>received=worker.submit(()->{try(SSLSocket s=(SSLSocket)server.accept()){s.setSoTimeout(15000);s.startHandshake();byte[]out=new byte[payload.length];new DataInputStream(s.getInputStream()).readFully(out);assertArrayEquals(payload,out);s.getOutputStream().write(1);return LocalProtocol.sha(new ByteArrayInputStream(out));}});
  try(SSLSocket client=(SSLSocket)LocalIdentity.client(identity.fingerprint).getSocketFactory().createSocket("127.0.0.1",server.getLocalPort())){client.setSoTimeout(15000);try{client.startHandshake();}catch(Exception clientError){try{received.get(3,TimeUnit.SECONDS);}catch(Exception serverError){throw new IOException("Native TLS server failure: "+serverError,serverError);}throw clientError;}client.getOutputStream().write(payload);client.getOutputStream().flush();assertEquals(1,client.getInputStream().read());}
  assertEquals(LocalProtocol.sha(new ByteArrayInputStream(payload)),received.get(20,TimeUnit.SECONDS));server.close();worker.shutdownNow();identity.close();
 }
 @Test public void wrongCertificatePinIsRejected()throws Exception{
  LocalIdentity identity=new LocalIdentity(UUID.randomUUID().toString());SSLServerSocket server=(SSLServerSocket)identity.server.getServerSocketFactory().createServerSocket(0);ExecutorService worker=Executors.newSingleThreadExecutor();Future<?>f=worker.submit(()->{try(SSLSocket s=(SSLSocket)server.accept()){s.setSoTimeout(10000);s.startHandshake();}catch(Exception expected){}});
  try(SSLSocket client=(SSLSocket)LocalIdentity.client(String.join("",Collections.nCopies(64,"0"))).getSocketFactory().createSocket("127.0.0.1",server.getLocalPort())){client.setSoTimeout(10000);try{client.startHandshake();fail("Unpinned server accepted");}catch(SSLException expected){}}
  f.get(15,TimeUnit.SECONDS);server.close();worker.shutdownNow();identity.close();
 }
 @Test public void journalResumesOnlyExactOffsetsAndRejectsCorruption()throws Exception{
  LocalFiles files=new LocalFiles(InstrumentationRegistry.getInstrumentation().getTargetContext());byte[]data=new byte[9001];new java.security.SecureRandom().nextBytes(data);String hash=LocalProtocol.sha(new ByteArrayInputStream(data));
  assertEquals(0,files.prepare(hash,"../../native-test.bin","application/octet-stream",data.length));assertEquals(4000,files.append(hash,0,data,4000));
  LocalFiles restarted=new LocalFiles(InstrumentationRegistry.getInstrumentation().getTargetContext());assertEquals(4000,restarted.prepare(hash,"../../native-test.bin","application/octet-stream",data.length));
  try{restarted.append(hash,0,data,1);fail("Wrong offset accepted");}catch(IOException expected){}
  byte[]bad=new byte[data.length-4000];restarted.append(hash,4000,bad,bad.length);
  try{restarted.finish(hash);fail("Corrupted file published");}catch(IOException expected){assertEquals("HASH_MISMATCH",expected.getMessage());}
 }
 @Test public void qrValidationRejectsExpiredAndPublicEndpoints()throws Exception{
  String pin=String.join("",Collections.nCopies(64,"a"));LocalPairing p=new LocalPairing(UUID.randomUUID().toString(),"192.168.49.1",12345,pin,LocalPairing.token(),"DIRECT-QF","temporary-password","direct",System.currentTimeMillis()+60000);assertEquals(p.session,LocalPairing.decode(p.encode()).session);
  for(String invalid:new String[]{p.encode().replace("192.168.49.1","8.8.8.8"),p.encode().replace("192.168.49.1","127.0.0.1"),"QFL1:{}","https://example.com"}){try{LocalPairing.decode(invalid);fail("Invalid pairing accepted");}catch(Exception expected){}}
 }
 @Test public void fullNativeSessionTransfersCommitsAndAcknowledgesMessages()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  if(android.os.Build.VERSION.SDK_INT<=28){InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("pm grant "+context.getPackageName()+" android.permission.WRITE_EXTERNAL_STORAGE").close();}
  byte[]payload=new byte[2*LocalProtocol.CHUNK+31];new java.security.SecureRandom().nextBytes(payload);String hash=LocalProtocol.sha(new ByteArrayInputStream(payload));
  java.io.File source=new java.io.File(context.getCacheDir(),"native-session-"+System.nanoTime()+".bin");try(FileOutputStream out=new FileOutputStream(source)){out.write(payload);}
  android.net.Uri uri=androidx.core.content.FileProvider.getUriForFile(context,context.getPackageName()+".fileprovider",source);
  LocalEngine receiver=new LocalEngine(context),sender=new LocalEngine(context);ExecutorService serverThread=Executors.newSingleThreadExecutor();
  try{
   sender.files.addUris(java.util.Collections.singletonList(uri),0);
   java.lang.reflect.Field role=LocalEngine.class.getDeclaredField("role"),pairing=LocalEngine.class.getDeclaredField("pairing");role.setAccessible(true);pairing.setAccessible(true);role.set(receiver,"receive");role.set(sender,"send");
   Future<?> serving=serverThread.submit(()->{try{receiver.listen("127.0.0.1","","","lan",0);}catch(Exception e){throw new RuntimeException(e);}});
   long until=System.currentTimeMillis()+15000;while(pairing.get(receiver)==null&&System.currentTimeMillis()<until)Thread.sleep(50);assertNotNull(pairing.get(receiver));assertFalse(receiver.snapshot().getBoolean("started"));pairing.set(sender,pairing.get(receiver));
   java.lang.reflect.Method connect=LocalEngine.class.getDeclaredMethod("connect",int.class);connect.setAccessible(true);connect.invoke(sender,0);
   until=System.currentTimeMillis()+60000;while(!sender.snapshot().getString("phase").equals("complete")&&System.currentTimeMillis()<until)Thread.sleep(100);
   assertEquals(sender.snapshot().toString(),"complete",sender.snapshot().getString("phase"));assertTrue(sender.snapshot().getBoolean("authenticated"));assertTrue(receiver.snapshot().getBoolean("started"));
   String saved=receiver.files.published(hash);assertNotNull(saved);try(InputStream in=context.getContentResolver().openInputStream(android.net.Uri.parse(saved))){assertEquals(hash,LocalProtocol.sha(in));}
   sender.message("native hello");until=System.currentTimeMillis()+5000;while(receiver.snapshot().getJSONArray("messages").length()==0&&System.currentTimeMillis()<until)Thread.sleep(50);assertEquals("native hello",receiver.snapshot().getJSONArray("messages").getJSONObject(0).getString("text"));
   receiver.message("native reply");until=System.currentTimeMillis()+5000;while(sender.snapshot().getJSONArray("messages").length()<2&&System.currentTimeMillis()<until)Thread.sleep(50);assertEquals(2,sender.snapshot().getJSONArray("messages").length());
   String exposed=sender.snapshot().toString();assertFalse(exposed.contains("QFL1:"));assertFalse(exposed.contains("content://"));assertFalse(exposed.contains("file://"));
   if(saved.startsWith("file:"))new File(android.net.Uri.parse(saved).getPath()).delete();else context.getContentResolver().delete(android.net.Uri.parse(saved),null,null);
   receiver.disconnect();serving.get(5,TimeUnit.SECONDS);
  }finally{sender.shutdown();receiver.shutdown();serverThread.shutdownNow();source.delete();for(String suffix:new String[]{".json",".done",".part"})new File(context.getFilesDir(),"local-inbox/"+hash+suffix).delete();}
 }

}
