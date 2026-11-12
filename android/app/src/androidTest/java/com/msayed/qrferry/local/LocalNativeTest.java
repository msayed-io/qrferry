package com.msayed.qrferry.local;
import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import org.json.JSONObject;
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
 /** The official scope is what unlocks the shared tree; once held, the four
  *  routing folders must exist at the documented path. On API < 30 the legacy
  *  read/write grant plays the same role. */
 @Test public void applicationTreeIsCreatedOnceTheStorageScopeIsHeld()throws Exception{
  LocalFiles files=new LocalFiles(InstrumentationRegistry.getInstrumentation().getTargetContext());
  // Without the official scope there is nothing to assert here: the publisher
  // then falls back to Downloads/QRFerry/<category> through MediaStore.
  if(!(files.broad()||files.legacyWritable()))return;
  files.ensureFolders();
  File root=new File(android.os.Environment.getExternalStorageDirectory(),"QRFerry");
  assertTrue("application root missing",root.isDirectory());
  for(String name:new String[]{"Audio","Videos","Images","Files"})assertTrue(name+" missing",new File(root,name).isDirectory());
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

 @Test public void journalMetadataCannotBeReboundToAnotherFile()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();LocalFiles files=new LocalFiles(context);
  byte[]bytes={1,2,3,4};String digest=LocalProtocol.sha(new ByteArrayInputStream(bytes)),id=LocalProtocol.transferId(digest,"first.bin","application/octet-stream",4,UUID.randomUUID().toString());
  try{
   assertEquals(0,files.prepare(id,"first.bin","application/octet-stream",4,digest));
   for(String[]change:new String[][]{{"other.bin","application/octet-stream",digest},{"first.bin","text/plain",digest},{"first.bin","application/octet-stream",String.join("",Collections.nCopies(64,"0"))}}){
    try{files.prepare(id,change[0],change[1],4,change[2]);fail("An existing journal was rebound");}catch(IOException expected){assertEquals("FILE_ID_CONFLICT",expected.getMessage());}
   }
  }finally{new File(context.getFilesDir(),"local-inbox/"+id+".json").delete();}
 }
 @Test public void sparseJournalOffsetsBeyond4GiBAreNotTruncated()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();LocalFiles files=new LocalFiles(context);long offset=(1L<<32)+17;
  String digest=String.join("",Collections.nCopies(64,"a")),id=LocalProtocol.transferId(digest,"large.bin","application/octet-stream",offset+4,UUID.randomUUID().toString());
  File part=new File(context.getFilesDir(),"local-inbox/"+id+".part");
  try{
   try(RandomAccessFile file=new RandomAccessFile(part,"rw")){file.setLength(offset);}
   assertEquals(offset,files.prepare(id,"large.bin","application/octet-stream",offset+4,digest));
   assertEquals(offset+4,files.append(id,offset,new byte[]{1,2,3,4},4));assertEquals(offset+4,part.length());
  }finally{part.delete();new File(context.getFilesDir(),"local-inbox/"+id+".json").delete();}
 }
 @Test public void cancellationRetainsPartialAndVerificationDoesNotLockUiMetadata()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();LocalFiles files=new LocalFiles(context);byte[]bytes=new byte[LocalProtocol.CHUNK+3];new java.security.SecureRandom().nextBytes(bytes);
  String digest=LocalProtocol.sha(new ByteArrayInputStream(bytes)),id=LocalProtocol.transferId(digest,"cancelled.bin","application/octet-stream",bytes.length,UUID.randomUUID().toString());
  ExecutorService worker=Executors.newFixedThreadPool(2);CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);java.util.concurrent.atomic.AtomicInteger checks=new java.util.concurrent.atomic.AtomicInteger();
  try{
   files.prepare(id,"cancelled.bin","application/octet-stream",bytes.length,digest);files.append(id,0,bytes,LocalProtocol.CHUNK);files.append(id,LocalProtocol.CHUNK,Arrays.copyOfRange(bytes,LocalProtocol.CHUNK,bytes.length),3);
   Future<?> task=worker.submit(()->{try{files.finish(id,()->{if(checks.incrementAndGet()==2){entered.countDown();try{release.await(10,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}return false;}return true;});throw new AssertionError("Cancelled finalization published a file");}catch(IOException expected){assertEquals("CANCELLED",expected.getMessage());}catch(Exception e){throw new RuntimeException(e);}});
   assertTrue(entered.await(3,TimeUnit.SECONDS));assertEquals(0,(int)worker.submit(()->files.selected().length()).get(2,TimeUnit.SECONDS));release.countDown();task.get(5,TimeUnit.SECONDS);
   assertNull(files.published(id));assertEquals(bytes.length,files.prepare(id,"cancelled.bin","application/octet-stream",bytes.length,digest));
  }finally{release.countDown();worker.shutdownNow();for(String suffix:new String[]{".json",".done",".part"})new File(context.getFilesDir(),"local-inbox/"+id+suffix).delete();}
 }

 @Test public void unknownLengthDocumentIsMeasuredAndReopenedNatively()throws Exception{
  LocalFiles files=new LocalFiles(InstrumentationRegistry.getInstrumentation().getTargetContext());
  files.addUris(Collections.singletonList(UnknownLengthProvider.URI),0);assertEquals(1,files.sources().size());LocalFiles.Source source=files.sources().get(0);assertEquals(UnknownLengthProvider.SIZE,source.size);
  byte[]expected=new byte[UnknownLengthProvider.SIZE];for(int i=0;i<expected.length;i++)expected[i]=(byte)(i*73+19);
  assertEquals(LocalProtocol.sha(new ByteArrayInputStream(expected)),files.hash(source));
  files.addUris(Collections.singletonList(UnknownLengthProvider.URI),0);assertEquals("Selecting the same URI again should not duplicate it",1,files.sources().size());assertFalse(files.selected().toString().contains("content://"));
 }
 @Test public void committedReceiptIsReverifiedRatherThanTrustingAnEditedFile()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();LocalFiles files=new LocalFiles(context);byte[]data={1,2,3,4};String digest=LocalProtocol.sha(new ByteArrayInputStream(data)),name="receipt-"+System.nanoTime()+".bin",id=LocalProtocol.transferId(digest,name,"application/octet-stream",4,UUID.randomUUID().toString());String saved=null;
  try{
   files.prepare(id,name,"application/octet-stream",4,digest);files.append(id,0,data,4);saved=files.finish(id);assertEquals(saved,files.finish(id));
   try(OutputStream out=context.getContentResolver().openOutputStream(android.net.Uri.parse(saved),"wt")){assertNotNull(out);out.write(new byte[]{4,3,2,1});}
   try{files.finish(id);fail("An edited published file was reported as verified");}catch(IOException expected){assertEquals("PUBLISHED_FILE_CHANGED",expected.getMessage());}
   assertNull(files.published(id));
  }finally{
   if(saved!=null){android.net.Uri uri=android.net.Uri.parse(saved);if("file".equals(uri.getScheme()))new File(uri.getPath()).delete();else context.getContentResolver().delete(uri,null,null);}
   for(String suffix:new String[]{".json",".done",".part"})new File(context.getFilesDir(),"local-inbox/"+id+suffix).delete();
  }
 }

 @Test public void interruptedWelcomeRetainsTicketAndConfirmedQrCannotBeReused()throws Exception{
  LocalEngine receiver=new LocalEngine(InstrumentationRegistry.getInstrumentation().getTargetContext());ExecutorService worker=Executors.newSingleThreadExecutor();
  try{
   java.lang.reflect.Field role=LocalEngine.class.getDeclaredField("role"),field=LocalEngine.class.getDeclaredField("pairing");role.setAccessible(true);field.setAccessible(true);role.set(receiver,"receive");
   Future<?>serving=worker.submit(()->{try{receiver.listen("127.0.0.1","","","lan",0);}catch(Exception e){throw new RuntimeException(e);}});
   long deadline=System.currentTimeMillis()+15000;while(field.get(receiver)==null&&System.currentTimeMillis()<deadline)Thread.sleep(25);LocalPairing offer=(LocalPairing)field.get(receiver);assertNotNull(offer);
   String peer=UUID.randomUUID().toString(),ticket;
   try(SSLSocket client=(SSLSocket)LocalIdentity.client(offer.pin).getSocketFactory().createSocket("127.0.0.1",offer.port)){
    client.setSoTimeout(5000);client.startHandshake();LocalProtocol.writeControl(new DataOutputStream(client.getOutputStream()),hello(offer,peer,offer.secret).toString());
    ticket=new JSONObject(LocalProtocol.readControl(new DataInputStream(client.getInputStream()))).getString("ticket");
   }
   assertFalse(receiver.snapshot().getBoolean("authenticated"));assertFalse(receiver.snapshot().getBoolean("started"));
   try(SSLSocket client=(SSLSocket)LocalIdentity.client(offer.pin).getSocketFactory().createSocket("127.0.0.1",offer.port)){
    client.setSoTimeout(5000);client.startHandshake();DataOutputStream out=new DataOutputStream(client.getOutputStream());DataInputStream in=new DataInputStream(client.getInputStream());LocalProtocol.writeControl(out,hello(offer,peer,ticket).toString());
    assertEquals(ticket,new JSONObject(LocalProtocol.readControl(in)).getString("ticket"));LocalProtocol.writeControl(out,new JSONObject().put("type","confirm").put("ticket",ticket).toString());assertEquals("ready",new JSONObject(LocalProtocol.readControl(in)).getString("type"));
    deadline=System.currentTimeMillis()+3000;while(!receiver.snapshot().getBoolean("authenticated")&&System.currentTimeMillis()<deadline)Thread.sleep(10);assertTrue(receiver.snapshot().getBoolean("authenticated"));assertFalse(receiver.snapshot().getBoolean("started"));assertFalse(receiver.snapshot().getBoolean("qrReady"));
   }
   deadline=System.currentTimeMillis()+3000;while(receiver.snapshot().getBoolean("authenticated")&&System.currentTimeMillis()<deadline)Thread.sleep(10);
   try(SSLSocket client=(SSLSocket)LocalIdentity.client(offer.pin).getSocketFactory().createSocket("127.0.0.1",offer.port)){
    client.setSoTimeout(3000);client.startHandshake();LocalProtocol.writeControl(new DataOutputStream(client.getOutputStream()),hello(offer,UUID.randomUUID().toString(),offer.secret).toString());
    try{LocalProtocol.readControl(new DataInputStream(client.getInputStream()));fail("Consumed QR authorized a second peer");}catch(IOException expected){}
   }
   receiver.disconnect();serving.get(5,TimeUnit.SECONDS);
  }finally{receiver.shutdown();worker.shutdownNow();}
 }
 private static JSONObject hello(LocalPairing offer,String peer,String credential)throws Exception{return new JSONObject().put("type","hello").put("v",1).put("session",offer.session).put("peer",peer).put("credential",credential);}
 @Test public void cancelledHandshakeDoesNotBlockTheNextSession()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();LocalEngine receiver=new LocalEngine(context),sender=new LocalEngine(context);ExecutorService worker=Executors.newFixedThreadPool(2);
  java.net.ServerSocket stalled=new java.net.ServerSocket(0);CountDownLatch accepted=new CountDownLatch(1),release=new CountDownLatch(1);
  try{
   Future<?>old=worker.submit(()->{try(java.net.Socket socket=stalled.accept()){accepted.countDown();release.await(15,TimeUnit.SECONDS);}catch(Exception e){throw new RuntimeException(e);}});
   java.lang.reflect.Field role=LocalEngine.class.getDeclaredField("role"),field=LocalEngine.class.getDeclaredField("pairing");role.setAccessible(true);field.setAccessible(true);role.set(sender,"send");role.set(receiver,"receive");
   field.set(sender,new LocalPairing(UUID.randomUUID().toString(),"127.0.0.1",stalled.getLocalPort(),String.join("",Collections.nCopies(64,"a")),LocalPairing.token(),"","","lan",System.currentTimeMillis()+60000));
   java.lang.reflect.Method connect=LocalEngine.class.getDeclaredMethod("connect",int.class);connect.setAccessible(true);connect.invoke(sender,0);assertTrue(accepted.await(5,TimeUnit.SECONDS));sender.reset();
   Future<?>serving=worker.submit(()->{try{receiver.listen("127.0.0.1","","","lan",0);}catch(Exception e){throw new RuntimeException(e);}});
   long deadline=System.currentTimeMillis()+15000;while(field.get(receiver)==null&&System.currentTimeMillis()<deadline)Thread.sleep(25);assertNotNull(field.get(receiver));role.set(sender,"send");field.set(sender,field.get(receiver));connect.invoke(sender,1);release.countDown();old.get(5,TimeUnit.SECONDS);
   deadline=System.currentTimeMillis()+15000;while(!sender.snapshot().getBoolean("authenticated")&&System.currentTimeMillis()<deadline)Thread.sleep(25);assertTrue("A cancelled client task blocked the new session",sender.snapshot().getBoolean("authenticated"));assertFalse(sender.snapshot().getBoolean("started"));
   receiver.disconnect();serving.get(5,TimeUnit.SECONDS);
  }finally{release.countDown();stalled.close();sender.shutdown();receiver.shutdown();worker.shutdownNow();}
 }

 @Test public void publicationRecoversWithoutDuplicatingAfterEveryCommitBoundary()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  for(String boundary:new String[]{"allocated","copied","external-published","receipt"}){
   byte[]data=new byte[8193];new java.security.SecureRandom().nextBytes(data);String digest=LocalProtocol.sha(new ByteArrayInputStream(data)),name="publication-"+System.nanoTime()+".bin",id=LocalProtocol.transferId(digest,name,"application/octet-stream",data.length,UUID.randomUUID().toString());String expectedUri=null;
   LocalFiles interrupted=new LocalFiles(context,phase->{if(phase.equals(boundary))throw new IOException("SIMULATED_PROCESS_EXIT");});
   try{
    interrupted.prepare(id,name,"application/octet-stream",data.length,digest);interrupted.append(id,0,data,data.length);
    try{interrupted.finish(id);fail("Fault injection boundary was not reached: "+boundary);}catch(IOException expected){assertEquals("SIMULATED_PROCESS_EXIT",expected.getMessage());}
    File journal=new File(context.getFilesDir(),"local-inbox/"+id+".txn");assertTrue(journal.isFile());JSONObject tx;
    try(InputStream in=new android.util.AtomicFile(journal).openRead();ByteArrayOutputStream text=new ByteArrayOutputStream()){byte[]buffer=new byte[4096];for(int n;(n=in.read(buffer))!=-1;)text.write(buffer,0,n);tx=new JSONObject(text.toString("UTF-8"));}
    expectedUri=tx.getString(tx.getString("kind").equals("file")?"destination":"uri");
    LocalFiles recovered=new LocalFiles(context);assertEquals("Recovery allocated a different output after "+boundary,expectedUri,recovered.finish(id));assertEquals(expectedUri,recovered.finish(id));assertFalse(journal.exists());
    try(InputStream in=context.getContentResolver().openInputStream(android.net.Uri.parse(expectedUri))){assertEquals(digest,LocalProtocol.sha(in));}
   }finally{
    if(expectedUri!=null){android.net.Uri uri=android.net.Uri.parse(expectedUri);if("file".equals(uri.getScheme()))new File(uri.getPath()).delete();else context.getContentResolver().delete(uri,null,null);}
    for(String suffix:new String[]{".json",".done",".part",".txn"})new android.util.AtomicFile(new File(context.getFilesDir(),"local-inbox/"+id+suffix)).delete();
   }
  }
 }

 @Test public void safRecoveryFollowsRenamedUrisAndRevocationNeverRedirectsWrites()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();android.content.ContentResolver resolver=context.getContentResolver();String previous=context.getSharedPreferences("local-files",0).getString("tree","");List<String>ids=new ArrayList<>();
  resolver.call(UnknownLengthProvider.URI,"reset-document-tree",null,null);android.os.Bundle grant=resolver.call(UnknownLengthProvider.URI,"grant-document-tree",null,null);assertNotNull(grant);android.net.Uri tree=android.net.Uri.parse(grant.getString("uri"));
  try{
   LocalFiles destination=new LocalFiles(context);destination.tree(tree);destination.ensureFolders();
   for(String boundary:new String[]{"allocated","copied","external-published","receipt"}){
    byte[]data=new byte[4097];new java.security.SecureRandom().nextBytes(data);String digest=LocalProtocol.sha(new ByteArrayInputStream(data)),name="saf-"+System.nanoTime()+".bin",id=LocalProtocol.transferId(digest,name,"application/octet-stream",data.length,UUID.randomUUID().toString());ids.add(id);
    LocalFiles interrupted=new LocalFiles(context,phase->{if(phase.equals(boundary))throw new IOException("SIMULATED_PROCESS_EXIT");});interrupted.prepare(id,name,"application/octet-stream",data.length,digest);interrupted.append(id,0,data,data.length);
    try{interrupted.finish(id);fail("Missing SAF fault boundary "+boundary);}catch(IOException expected){assertEquals("SIMULATED_PROCESS_EXIT",expected.getMessage());}
    LocalFiles recovered=new LocalFiles(context);String saved=recovered.finish(id);assertTrue(saved.contains(TestDocumentsProvider.AUTHORITY));assertEquals(saved,recovered.finish(id));
    try(InputStream in=resolver.openInputStream(android.net.Uri.parse(saved))){assertEquals(digest,LocalProtocol.sha(in));}
    androidx.documentfile.provider.DocumentFile directory=androidx.documentfile.provider.DocumentFile.fromTreeUri(context,tree).findFile("QRFerry").findFile("Files");int count=0;for(androidx.documentfile.provider.DocumentFile file:directory.listFiles())if(name.equals(file.getName()))count++;assertEquals("Recovery duplicated a renamed SAF document",1,count);
   }
   resolver.call(UnknownLengthProvider.URI,"revoke-document-tree",null,null);
   try{new LocalFiles(context).ensureFolders();fail("Revoked SAF destination was silently replaced with another location");}catch(IOException expected){assertEquals("STORAGE_ACCESS_REQUIRED",expected.getMessage());}
   assertEquals(tree.toString(),new LocalFiles(context).tree());
  }finally{
   context.getSharedPreferences("local-files",0).edit().putString("tree",previous).commit();resolver.call(UnknownLengthProvider.URI,"reset-document-tree",null,null);resolver.call(UnknownLengthProvider.URI,"revoke-document-tree",null,null);
   for(String id:ids)for(String suffix:new String[]{".json",".done",".part",".txn"})new android.util.AtomicFile(new File(context.getFilesDir(),"local-inbox/"+id+suffix)).delete();
  }
 }

 @Test public void cancelledPickerGenerationCannotRepopulateANewSession()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();LocalFiles files=new LocalFiles(context);
  int picker=files.fileWorkGeneration();files.cancelFileWork();
  try{files.addUris(Collections.singletonList(UnknownLengthProvider.URI),0,picker);fail("Stale picker selection was accepted");}catch(IOException expected){assertEquals("CANCELLED",expected.getMessage());}
  assertEquals(0,files.sources().size());
  assertEquals(1,files.addUris(Collections.singletonList(UnknownLengthProvider.URI),0,files.fileWorkGeneration()).length());assertEquals(1,files.sources().size());
 }

 /** The automatic plan must only offer a transport the QR can actually carry:
  *  a Wi-Fi Direct group needs the owner's P2P address and cannot be joined from
  *  an SSID + passphrase, so it is never chosen automatically. */
 @Test public void automaticTransportPlanNeverOffersWifiDirect()throws Exception{
  LocalNetwork network=new LocalNetwork(InstrumentationRegistry.getInstrumentation().getTargetContext());
  java.lang.reflect.Method plan=LocalNetwork.class.getDeclaredMethod("plan",String.class);plan.setAccessible(true);
  @SuppressWarnings("unchecked") java.util.List<String> steps=(java.util.List<String>)plan.invoke(network,"auto");
  assertFalse("Wi-Fi Direct cannot be joined from a QR",steps.contains("direct"));
  assertTrue("a joinable transport must be offered",steps.contains("hotspot")||steps.contains("lan"));
 }
 @Test public void networkCancellationInvalidatesStartsBeforeTheMainQueueRuns()throws Exception{
  LocalNetwork network=new LocalNetwork(InstrumentationRegistry.getInstrumentation().getTargetContext());java.util.concurrent.atomic.AtomicInteger callbacks=new java.util.concurrent.atomic.AtomicInteger();
  LocalNetwork.Receiver receiver=new LocalNetwork.Receiver(){public void ready(String host,String ssid,String password,String method){callbacks.incrementAndGet();}public void failed(String code){callbacks.incrementAndGet();}};
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
   network.receive("lan",receiver);network.close();
   network.receive("lan",receiver);
   Thread cancel=new Thread(network::close,"cancel-network-generation");cancel.start();try{cancel.join(2000);}catch(InterruptedException e){throw new AssertionError(e);}assertFalse("close must not block on the main looper",cancel.isAlive());
  });
  InstrumentationRegistry.getInstrumentation().waitForIdleSync();assertEquals("A cancelled queued network start called its receiver",0,callbacks.get());network.close();
 }

}
