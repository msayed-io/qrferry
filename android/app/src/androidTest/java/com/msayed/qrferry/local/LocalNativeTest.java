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
  assertEquals(0,files.prepare(hash,"../../native-test.bin","application/octet-stream",data.length,hash));assertEquals(4000,files.append(hash,0,data,4000));
  LocalFiles restarted=new LocalFiles(InstrumentationRegistry.getInstrumentation().getTargetContext());assertEquals(4000,restarted.prepare(hash,"../../native-test.bin","application/octet-stream",data.length,hash));
  try{restarted.append(hash,0,data,1);fail("Wrong offset accepted");}catch(IOException expected){}
  byte[]bad=new byte[data.length-4000];restarted.append(hash,4000,bad,bad.length);
  try{restarted.finish(hash);fail("Corrupted file published");}catch(IOException expected){assertEquals("HASH_MISMATCH",expected.getMessage());}
 }
 @Test public void qrValidationRejectsExpiredAndPublicEndpoints()throws Exception{
  String pin=String.join("",Collections.nCopies(64,"a"));LocalPairing p=new LocalPairing(UUID.randomUUID().toString(),"192.168.49.1",12345,pin,LocalPairing.token(),"DIRECT-QF","temporary-password","direct",System.currentTimeMillis()+60000);assertEquals(p.session,LocalPairing.decode(p.encode()).session);
  for(String invalid:new String[]{p.encode().replace("192.168.49.1","8.8.8.8"),p.encode().replace("192.168.49.1","127.0.0.1"),"QFL1:{}","https://example.com"}){try{LocalPairing.decode(invalid);fail("Invalid pairing accepted");}catch(Exception expected){}}
 }
 @Test public void fullNativeSessionTransfersCommitsAndAcknowledgesMessages()throws Exception{exerciseSession(false);}
 @Test public void interruptedSessionResumesPartialWithoutCollapsingIdenticalFiles()throws Exception{exerciseSession(true);}
 private void exerciseSession(boolean interrupt)throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  if(android.os.Build.VERSION.SDK_INT<=28)assertEquals("Grant storage before starting instrumentation",android.content.pm.PackageManager.PERMISSION_GRANTED,androidx.core.content.ContextCompat.checkSelfPermission(context,android.Manifest.permission.WRITE_EXTERNAL_STORAGE));
  byte[]payload=new byte[12*LocalProtocol.CHUNK+31];new java.security.SecureRandom().nextBytes(payload);
  String hash=LocalProtocol.sha(new ByteArrayInputStream(payload)),emptyHash=LocalProtocol.sha(new ByteArrayInputStream(new byte[0]));
  List<File>sources=new ArrayList<>();List<android.net.Uri>uris=new ArrayList<>();List<String>ids=new ArrayList<>();
  for(int i=0;i<4;i++){
   File source=new File(context.getCacheDir(),"native-session-"+System.nanoTime()+"-"+i+".bin");
   try(FileOutputStream out=new FileOutputStream(source)){if(i<2)out.write(payload);}
   sources.add(source);uris.add(androidx.core.content.FileProvider.getUriForFile(context,context.getPackageName()+".fileprovider",source));
  }
  LocalEngine receiver=new LocalEngine(context),sender=new LocalEngine(context);ExecutorService serverThread=Executors.newSingleThreadExecutor();
  CountDownLatch stopped=new CountDownLatch(1);java.util.concurrent.atomic.AtomicBoolean once=new java.util.concurrent.atomic.AtomicBoolean();
  try{
   sender.files.addUris(uris,0);List<LocalFiles.Source>selected=sender.files.sources();
   for(int i=0;i<selected.size();i++)ids.add(selected.get(i).transferId(i<2?hash:emptyHash));
   assertEquals("Identical bytes must not collapse distinct source files",4,new HashSet<>(ids).size());
   java.lang.reflect.Field role=LocalEngine.class.getDeclaredField("role"),pairing=LocalEngine.class.getDeclaredField("pairing");role.setAccessible(true);pairing.setAccessible(true);role.set(receiver,"receive");role.set(sender,"send");
   if(interrupt)receiver.subscribe(snapshot->{if(snapshot.optLong("bytes")>=LocalProtocol.CHUNK&&once.compareAndSet(false,true)){sender.pause(true);stopped.countDown();}});
   Future<?>serving=serverThread.submit(()->{try{receiver.listen("127.0.0.1","","","lan",0);}catch(Exception e){throw new RuntimeException(e);}});
   long until=System.currentTimeMillis()+15000;while(pairing.get(receiver)==null&&System.currentTimeMillis()<until)Thread.sleep(50);
   assertNotNull(pairing.get(receiver));assertFalse(receiver.snapshot().getBoolean("started"));pairing.set(sender,pairing.get(receiver));
   java.lang.reflect.Method connect=LocalEngine.class.getDeclaredMethod("connect",int.class);connect.setAccessible(true);connect.invoke(sender,0);
   if(interrupt){
    assertTrue("Transfer did not reach a resumable partial",stopped.await(20,TimeUnit.SECONDS));
    long offset=receiver.files.prepare(ids.get(0),selected.get(0).name,selected.get(0).mime,payload.length,hash);
    assertTrue(offset>0&&offset<payload.length);
    java.lang.reflect.Method close=LocalEngine.class.getDeclaredMethod("closeSocket");close.setAccessible(true);close.invoke(sender);
    assertFalse(sender.snapshot().getBoolean("authenticated"));sender.pause(false);
   }
   until=System.currentTimeMillis()+60000;while(!sender.snapshot().getString("phase").equals("complete")&&System.currentTimeMillis()<until)Thread.sleep(100);
   assertEquals(sender.snapshot().toString(),"complete",sender.snapshot().getString("phase"));assertTrue(sender.snapshot().getBoolean("authenticated"));assertTrue(receiver.snapshot().getBoolean("started"));
   assertEquals(4,sender.snapshot().getJSONArray("files").length());assertEquals(4,receiver.snapshot().getJSONArray("files").length());
   if(interrupt)assertTrue("Sender did not use the receiver's durable offset",sender.snapshot().getJSONArray("files").getJSONObject(0).getLong("resumeOffset")>0);
   Set<String>published=new HashSet<>();
   for(int i=0;i<ids.size();i++){
    String saved=receiver.files.published(ids.get(i));assertNotNull(saved);assertTrue("Different selected files must publish separately",published.add(saved));
    try(InputStream in=context.getContentResolver().openInputStream(android.net.Uri.parse(saved))){assertEquals(i<2?hash:emptyHash,LocalProtocol.sha(in));}
   }
   sender.message("native hello");until=System.currentTimeMillis()+5000;
   while((receiver.snapshot().getJSONArray("messages").length()==0||!sender.snapshot().getJSONArray("messages").getJSONObject(0).getString("status").equals("delivered"))&&System.currentTimeMillis()<until)Thread.sleep(50);
   assertEquals("native hello",receiver.snapshot().getJSONArray("messages").getJSONObject(0).getString("text"));assertEquals("delivered",sender.snapshot().getJSONArray("messages").getJSONObject(0).getString("status"));
   receiver.message("native reply");until=System.currentTimeMillis()+5000;while(sender.snapshot().getJSONArray("messages").length()<2&&System.currentTimeMillis()<until)Thread.sleep(50);assertEquals(2,sender.snapshot().getJSONArray("messages").length());
   String exposed=sender.snapshot().toString();assertFalse(exposed.contains("QFL1:"));assertFalse(exposed.contains("content://"));assertFalse(exposed.contains("file://"));
   receiver.disconnect();serving.get(5,TimeUnit.SECONDS);
  }finally{
   sender.shutdown();receiver.shutdown();serverThread.shutdownNow();for(File source:sources)source.delete();
   for(String id:ids){String saved=receiver.files.published(id);if(saved!=null){android.net.Uri uri=android.net.Uri.parse(saved);if("file".equals(uri.getScheme()))new File(uri.getPath()).delete();else context.getContentResolver().delete(uri,null,null);}for(String suffix:new String[]{".json",".done",".part"})new File(context.getFilesDir(),"local-inbox/"+id+suffix).delete();}
  }
 }

 @Test public void bundledScannerDecodesLocalQrBitmap()throws Exception{
  LocalPairing pairing=new LocalPairing(UUID.randomUUID().toString(),"192.168.49.1",12345,String.join("",Collections.nCopies(64,"a")),LocalPairing.token(),"DIRECT-QF","temporary-password","direct",System.currentTimeMillis()+60000);
  String raw=pairing.encode();com.google.zxing.common.BitMatrix qr=new com.google.zxing.MultiFormatWriter().encode(raw,com.google.zxing.BarcodeFormat.QR_CODE,768,768);
  android.graphics.Bitmap image=android.graphics.Bitmap.createBitmap(768,768,android.graphics.Bitmap.Config.ARGB_8888);for(int y=0;y<768;y++)for(int x=0;x<768;x++)image.setPixel(x,y,qr.get(x,y)?android.graphics.Color.BLACK:android.graphics.Color.WHITE);
  com.google.mlkit.vision.barcode.BarcodeScanner scanner=com.google.mlkit.vision.barcode.BarcodeScanning.getClient(new com.google.mlkit.vision.barcode.BarcodeScannerOptions.Builder().setBarcodeFormats(com.google.mlkit.vision.barcode.common.Barcode.FORMAT_QR_CODE).build());
  try{java.util.List<com.google.mlkit.vision.barcode.common.Barcode>codes=com.google.android.gms.tasks.Tasks.await(scanner.process(com.google.mlkit.vision.common.InputImage.fromBitmap(image,0)),20,TimeUnit.SECONDS);assertEquals(1,codes.size());assertEquals(raw,codes.get(0).getRawValue());}finally{scanner.close();image.recycle();}
 }

}
