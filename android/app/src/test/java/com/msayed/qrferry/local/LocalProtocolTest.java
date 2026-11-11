package com.msayed.qrferry.local;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
public class LocalProtocolTest {
 @Test public void frameRoundTripAndBoundedAllocation()throws Exception{ByteArrayOutputStream bytes=new ByteArrayOutputStream();LocalProtocol.writeControl(new DataOutputStream(bytes),"{\"type\":\"hello\"}");assertEquals("{\"type\":\"hello\"}",LocalProtocol.readControl(new DataInputStream(new ByteArrayInputStream(bytes.toByteArray()))));for(int size:new int[]{-1,0,1,65537,Integer.MAX_VALUE}){bytes.reset();new DataOutputStream(bytes).writeInt(size);try{LocalProtocol.readControl(new DataInputStream(new ByteArrayInputStream(bytes.toByteArray())));fail();}catch(IOException expected){}}}
 @Test public void hostileNamesNeverEscapeDestination(){for(String s:new String[]{"../../secret","..\\..\\secret","/absolute",".hidden","\u202Eexe.txt","\u0000",".",""}){String n=LocalProtocol.safeName(s);assertFalse(n.contains("/"));assertFalse(n.contains("\\"));assertFalse(n.startsWith("."));assertFalse(n.contains("\u202E"));assertFalse(n.isEmpty());}assertTrue(LocalProtocol.safeName("ملف".repeat(200)+".mp4").getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=180);}
 @Test public void chunkBoundsRejectOverflow()throws Exception{LocalProtocol.checkChunk(0,100,100);LocalProtocol.checkChunk((1L<<32)+17,256*1024,(1L<<32)+17+256*1024);LocalProtocol.checkChunk((1L<<40)+17,1,(1L<<40)+18);for(long[]v:new long[][]{{-1,1,100},{99,2,100},{Long.MAX_VALUE,1,100},{0,262145,999999},{0,1,-1}}){try{LocalProtocol.checkChunk(v[0],(int)v[1],v[2]);fail();}catch(IOException expected){}}}
 @Test public void digestAndConstantTimeTokenCheck()throws Exception{assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",LocalProtocol.sha(new ByteArrayInputStream(new byte[0])));assertTrue(LocalProtocol.secret("abc","abc"));assertFalse(LocalProtocol.secret("abc","abd"));assertFalse(LocalProtocol.secret(null,"abc"));assertEquals("Files",LocalProtocol.category("application/zip"));}
 @Test public void receivedFilesAreRoutedIntoTheApplicationTreeByMimeType(){
  // QRFerry/{Audio,Videos,Images,Files}: the same mapping the publisher uses.
  assertEquals("Audio",LocalProtocol.category("audio/mpeg"));
  assertEquals("Audio",LocalProtocol.category("audio/x-wav"));
  assertEquals("Videos",LocalProtocol.category("video/mp4"));
  assertEquals("Images",LocalProtocol.category("image/jpeg"));
  assertEquals("Files",LocalProtocol.category("application/zip"));
  assertEquals("Files",LocalProtocol.category("application/vnd.android.package-archive"));
  assertEquals("Files",LocalProtocol.category("text/plain"));
  assertEquals("Files",LocalProtocol.category(null));
 }
 @Test public void transferIdentityPreservesNamesPathsAndMetadata()throws Exception{
  String digest=LocalProtocol.sha(new ByteArrayInputStream(new byte[0]));String a=LocalProtocol.transferId(digest,"first.txt","text/plain",0,"content://native/one");
  assertEquals(a,LocalProtocol.transferId(digest,"first.txt","text/plain",0,"content://native/one"));
  assertNotEquals(a,LocalProtocol.transferId(digest,"second.txt","text/plain",0,"content://native/one"));
  assertNotEquals(a,LocalProtocol.transferId(digest,"first.txt","text/plain",0,"content://native/two"));
  assertNotEquals(a,LocalProtocol.transferId(digest,"first.txt","application/octet-stream",0,"content://native/one"));
  assertTrue(LocalProtocol.hash(a));assertNotEquals(digest,a);
 }

}
