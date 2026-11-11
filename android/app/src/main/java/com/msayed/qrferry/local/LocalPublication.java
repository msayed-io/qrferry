package com.msayed.qrferry.local;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import androidx.documentfile.provider.DocumentFile;
import org.json.JSONObject;
import java.io.*;
import java.util.function.BooleanSupplier;

/** Recoverable external publication. A verified private part is never discarded
 * until the final URI and its integrity metadata have a durable receipt. */
final class LocalPublication {
 interface Checkpoint { void reached(String phase)throws Exception; }
 private final Context context;
 private final ContentResolver resolver;
 private final File inbox;
 private final Checkpoint checkpoint;
 LocalPublication(Context context,File inbox,Checkpoint checkpoint){this.context=context;this.resolver=context.getContentResolver();this.inbox=inbox;this.checkpoint=checkpoint;}
 private File journal(String id)throws IOException{if(!LocalProtocol.hash(id))throw new IOException("INVALID_FILE_ID");return new File(inbox,id+".txn");}
 void receiptWritten()throws Exception{checkpoint.reached("receipt");}
 void clear(String id)throws IOException{new android.util.AtomicFile(journal(id)).delete();}

 Uri publish(String id,JSONObject metadata,File part,boolean direct,String tree,BooleanSupplier active)throws Exception{
  File file=journal(id);JSONObject tx;
  if(file.exists()||new File(file+".bak").exists()){
   tx=read(file);
   for(String key:new String[]{"id","name","mime","sha256"})if(!tx.getString(key).equals(metadata.getString(key)))throw new IOException("PUBLICATION_METADATA_MISMATCH");
   if(tx.getLong("size")!=metadata.getLong("size"))throw new IOException("PUBLICATION_METADATA_MISMATCH");
  }else{
   tx=new JSONObject(metadata.toString()).put("phase","allocating");String category=LocalProtocol.category(metadata.getString("mime"));
   if(direct){
    File dir=new File(new File(Environment.getExternalStorageDirectory(),"QRFerry"),category);
    tx.put("kind","file").put("temporary",Uri.fromFile(new File(dir,".qrferry-"+id+".part")).toString()).put("destination",Uri.fromFile(uniqueFile(dir,metadata.getString("name"))).toString());
   }else if(!tree.isEmpty()){
    tx.put("kind","tree").put("tree",tree).put("category",category).put("temporaryName",".qrferry-"+id+".part");
    tx.put("destinationName",uniqueDocument(treeFolder(tx),metadata.getString("name")));
   }else if(Build.VERSION.SDK_INT>=29){
    tx.put("kind","media").put("relativePath",Environment.DIRECTORY_DOWNLOADS+"/QRFerry/"+category+"/").put("temporaryName","qrferry-"+id+".part");
   }else throw new IOException("STORAGE_ACCESS_REQUIRED");
   write(file,tx);
  }
  if(!active.getAsBoolean())throw new IOException("CANCELLED");
  if(tx.getString("phase").equals("published")){Uri uri=Uri.parse(tx.getString("uri"));verify(uri,metadata,active);return uri;}
  Uri result;
  switch(tx.getString("kind")){
   case "file":result=publishFile(file,tx,metadata,part,active);break;
   case "tree":result=publishTree(file,tx,metadata,part,active);break;
   case "media":result=publishMedia(file,tx,metadata,part,active);break;
   default:throw new IOException("INVALID_PUBLICATION_JOURNAL");
  }
  // A failure here deliberately leaves the previous phase in the journal.
  // Recovery must discover/revalidate the same output, not allocate a duplicate.
  checkpoint.reached("external-published");
  tx.put("phase","published").put("uri",result.toString());write(file,tx);return result;
 }

 private Uri publishFile(File journal,JSONObject tx,JSONObject metadata,File part,BooleanSupplier active)throws Exception{
  File temporary=new File(Uri.parse(tx.getString("temporary")).getPath()),destination=new File(Uri.parse(tx.getString("destination")).getPath());
  boolean copied=tx.getString("phase").equals("copied");
  if(copied&&!temporary.exists()){
   if(!destination.isFile())throw new IOException("PUBLICATION_RECOVERY_CONFLICT");
   verify(Uri.fromFile(destination),metadata,active);return Uri.fromFile(destination);
  }
  if(!copied){
   tx.put("phase","copying");write(journal,tx);checkpoint.reached("allocated");
   try(FileOutputStream out=new FileOutputStream(temporary);InputStream in=new FileInputStream(part)){copy(in,out,active);out.getFD().sync();}
   verify(Uri.fromFile(temporary),metadata,active);tx.put("phase","copied");write(journal,tx);checkpoint.reached("copied");
  }else verify(Uri.fromFile(temporary),metadata,active);
  if(destination.exists()){
   destination=uniqueFile(destination.getParentFile(),metadata.getString("name"));tx.put("destination",Uri.fromFile(destination).toString());write(journal,tx);
  }
  if(!active.getAsBoolean())throw new IOException("CANCELLED");
  if(destination.exists()||!temporary.renameTo(destination))throw new IOException("PUBLISH_FAILED");
  android.media.MediaScannerConnection.scanFile(context,new String[]{destination.getAbsolutePath()},new String[]{metadata.getString("mime")},null);
  return Uri.fromFile(destination);
 }

 private Uri publishMedia(File journal,JSONObject tx,JSONObject metadata,File part,BooleanSupplier active)throws Exception{
  if(Build.VERSION.SDK_INT<29)throw new IOException("STORAGE_ACCESS_REQUIRED");
  Uri uri=tx.has("uri")?Uri.parse(tx.getString("uri")):findPendingMedia(tx);
  if(uri==null){
   ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.DISPLAY_NAME,tx.getString("temporaryName"));values.put(MediaStore.MediaColumns.MIME_TYPE,"application/octet-stream");values.put(MediaStore.MediaColumns.RELATIVE_PATH,tx.getString("relativePath"));values.put(MediaStore.MediaColumns.IS_PENDING,1);
   uri=resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);if(uri==null)throw new IOException("PUBLISH_FAILED");
  }
  tx.put("uri",uri.toString());write(journal,tx);
  if(!tx.getString("phase").equals("copied")){
   tx.put("phase","copying");write(journal,tx);checkpoint.reached("allocated");
   try(OutputStream out=resolver.openOutputStream(uri,"wt");InputStream in=new FileInputStream(part)){if(out==null)throw new IOException("PUBLISH_FAILED");copy(in,out,active);}
   verify(uri,metadata,active);tx.put("phase","copied");write(journal,tx);checkpoint.reached("copied");
  }else verify(uri,metadata,active);
  if(!active.getAsBoolean())throw new IOException("CANCELLED");
  ContentValues done=new ContentValues();done.put(MediaStore.MediaColumns.DISPLAY_NAME,metadata.getString("name"));done.put(MediaStore.MediaColumns.MIME_TYPE,metadata.getString("mime"));done.put(MediaStore.MediaColumns.IS_PENDING,0);
  if(resolver.update(uri,done,null,null)!=1)throw new IOException("PUBLISH_FAILED");return uri;
 }
 private Uri findPendingMedia(JSONObject tx)throws Exception{
  String selection=MediaStore.MediaColumns.DISPLAY_NAME+"=? AND "+MediaStore.MediaColumns.RELATIVE_PATH+"=? AND "+MediaStore.MediaColumns.OWNER_PACKAGE_NAME+"=? AND "+MediaStore.MediaColumns.IS_PENDING+"=1";
  try(Cursor cursor=resolver.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI,new String[]{MediaStore.MediaColumns._ID},selection,new String[]{tx.getString("temporaryName"),tx.getString("relativePath"),context.getPackageName()},null)){
   if(cursor==null||!cursor.moveToFirst())return null;Uri found=ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI,cursor.getLong(0));if(cursor.moveToNext())throw new IOException("PUBLICATION_RECOVERY_CONFLICT");return found;
  }
 }

 private DocumentFile treeFolder(JSONObject tx)throws Exception{
  DocumentFile root=DocumentFile.fromTreeUri(context,Uri.parse(tx.getString("tree")));if(root==null)throw new IOException("STORAGE_ACCESS_REQUIRED");
  DocumentFile base=root.findFile("QRFerry");if(base!=null)base=base.findFile(tx.getString("category"));if(base==null||!base.canWrite())throw new IOException("STORAGE_ACCESS_REQUIRED");return base;
 }
 private Uri publishTree(File journal,JSONObject tx,JSONObject metadata,File part,BooleanSupplier active)throws Exception{
  DocumentFile base=treeFolder(tx),temporary=base.findFile(tx.getString("temporaryName"));boolean copied=tx.getString("phase").equals("copied");
  if(copied&&temporary==null){
   DocumentFile target=base.findFile(tx.getString("destinationName"));if(target==null)throw new IOException("PUBLICATION_RECOVERY_CONFLICT");verify(target.getUri(),metadata,active);return target.getUri();
  }
  if(temporary==null){temporary=base.createFile("application/octet-stream",tx.getString("temporaryName"));if(temporary==null)throw new IOException("PUBLISH_FAILED");tx.put("temporaryName",temporary.getName());}
  tx.put("uri",temporary.getUri().toString());write(journal,tx);
  if(!copied){
   tx.put("phase","copying");write(journal,tx);checkpoint.reached("allocated");
   try(OutputStream out=resolver.openOutputStream(temporary.getUri(),"wt");InputStream in=new FileInputStream(part)){if(out==null)throw new IOException("PUBLISH_FAILED");copy(in,out,active);}
   verify(temporary.getUri(),metadata,active);tx.put("phase","copied");write(journal,tx);checkpoint.reached("copied");
  }else verify(temporary.getUri(),metadata,active);
  String destination=tx.getString("destinationName");
  if(base.findFile(destination)!=null){destination=uniqueDocument(base,metadata.getString("name"));tx.put("destinationName",destination);write(journal,tx);}
  if(!active.getAsBoolean())throw new IOException("CANCELLED");
  if(!temporary.renameTo(destination))throw new IOException("PUBLISH_FAILED");return temporary.getUri();
 }
 private static File uniqueFile(File directory,String name)throws IOException{for(int n=0;n<10000;n++){File file=new File(directory,n==0?name:n+"-"+name);if(!file.exists())return file;}throw new IOException("NAME_COLLISION_LIMIT");}
 private static String uniqueDocument(DocumentFile directory,String name)throws IOException{for(int n=0;n<10000;n++){String candidate=n==0?name:n+"-"+name;if(directory.findFile(candidate)==null)return candidate;}throw new IOException("NAME_COLLISION_LIMIT");}
 private void verify(Uri uri,JSONObject metadata,BooleanSupplier active)throws Exception{
  try(InputStream in=resolver.openInputStream(uri)){if(in==null||!LocalProtocol.secret(LocalProtocol.sha(in,active),metadata.getString("sha256")))throw new IOException("PUBLICATION_RECOVERY_CONFLICT");}
 }
 private static void copy(InputStream in,OutputStream out,BooleanSupplier active)throws IOException{byte[]buffer=new byte[LocalProtocol.CHUNK];while(true){if(!active.getAsBoolean())throw new IOException("CANCELLED");int count=in.read(buffer);if(count<0)break;out.write(buffer,0,count);}out.flush();}
 private static JSONObject read(File file)throws Exception{if(file.length()>16384)throw new IOException("INVALID_PUBLICATION_JOURNAL");try(InputStream in=new android.util.AtomicFile(file).openRead();ByteArrayOutputStream out=new ByteArrayOutputStream()){copy(in,out,()->true);return new JSONObject(out.toString("UTF-8"));}}
 private static void write(File file,JSONObject value)throws Exception{android.util.AtomicFile atomic=new android.util.AtomicFile(file);FileOutputStream out=null;try{out=atomic.startWrite();out.write(value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));atomic.finishWrite(out);}catch(Exception e){if(out!=null)atomic.failWrite(out);throw e;}}
}
