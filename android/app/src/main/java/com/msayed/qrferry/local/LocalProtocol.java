package com.msayed.qrferry.local;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.regex.Pattern;

/** Bounded native framing. File bytes never cross the Capacitor bridge. */
public final class LocalProtocol {
 public static final int VERSION=1, CHUNK=256*1024, MAX_CONTROL=64*1024, MAX_FILES=1000;
 public static final long MAX_FILE=1L<<40;
 private static final Pattern HASH=Pattern.compile("[a-f0-9]{64}");
 public static boolean hash(String value){return value!=null&&HASH.matcher(value).matches();}
 public static String hex(byte[] bytes){StringBuilder s=new StringBuilder(bytes.length*2);for(byte b:bytes)s.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return s.toString();}
 public static String sha(InputStream in)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");byte[] b=new byte[CHUNK];for(int n;(n=in.read(b))!=-1;)d.update(b,0,n);return hex(d.digest());}
 public static boolean secret(String a,String b){return a!=null&&b!=null&&MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8),b.getBytes(StandardCharsets.UTF_8));}
 public static String safeName(String name){
  if(name==null)name="file";name=Normalizer.normalize(name,Normalizer.Form.NFC).replaceAll("[\\\\/\\p{Cntrl}\\u202a-\\u202e\\u2066-\\u2069]","_").trim();
  while(name.startsWith("."))name=name.substring(1);if(name.isEmpty())name="file";
  // Bound UTF-8 filename length, retaining the extension when practical.
  if(name.getBytes(StandardCharsets.UTF_8).length>180){int dot=name.lastIndexOf('.');String ext=dot>0&&name.length()-dot<=16?name.substring(dot):"";String base=ext.isEmpty()?name:name.substring(0,dot);while((base+ext).getBytes(StandardCharsets.UTF_8).length>180)base=base.substring(0,base.offsetByCodePoints(base.length(),-1));name=base+ext;}
  return name;
 }
 public static String category(String mime){if(mime==null)return "Files";if(mime.startsWith("image/"))return "Images";if(mime.startsWith("video/"))return "Videos";if(mime.startsWith("audio/"))return "Audio";return "Files";}
 public static void writeControl(DataOutputStream out,String json)throws IOException{byte[] b=json.getBytes(StandardCharsets.UTF_8);if(b.length>MAX_CONTROL)throw new IOException("CONTROL_TOO_LARGE");out.writeInt(b.length);out.write(b);out.flush();}
 public static String readControl(DataInputStream in)throws IOException{int n=in.readInt();if(n<2||n>MAX_CONTROL)throw new IOException("INVALID_CONTROL_LENGTH");byte[] b=new byte[n];in.readFully(b);return new String(b,StandardCharsets.UTF_8);}
 public static void skipFully(InputStream in,long offset)throws IOException{while(offset>0){long n=in.skip(offset);if(n<=0){if(in.read()<0)throw new EOFException("SOURCE_CHANGED");n=1;}offset-=n;}}
 public static void checkChunk(long offset,int count,long size)throws IOException{if(size<0||size>MAX_FILE||offset<0||offset>size||count<1||count>CHUNK||count>size-offset)throw new IOException("INVALID_CHUNK");}
 private LocalProtocol(){}
}
