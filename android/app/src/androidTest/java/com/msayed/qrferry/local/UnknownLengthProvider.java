package com.msayed.qrferry.local;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Binder;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.FileNotFoundException;
import java.io.OutputStream;

/** Instrumentation APK only. A re-openable pipe-backed document, not a runtime mock. */
public final class UnknownLengthProvider extends ContentProvider {
 public static final int SIZE=3*256*1024+17;
 public static final Uri URI=Uri.parse("content://com.msayed.qrferry.test.unknown/document");
 @Override public boolean onCreate(){return true;}
 private void authorize(){
  try{int app=getContext().getPackageManager().getApplicationInfo("com.msayed.qrferry",0).uid;if(Binder.getCallingUid()!=app&&Binder.getCallingUid()!=android.os.Process.myUid())throw new SecurityException("Test fixture is private to the tested app");}
  catch(android.content.pm.PackageManager.NameNotFoundException e){throw new SecurityException(e);}
 }
 @Override public Cursor query(Uri uri,String[]projection,String selection,String[]args,String order){
  authorize();String[]columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;
  MatrixCursor cursor=new MatrixCursor(columns);Object[]values=new Object[columns.length];for(int i=0;i<columns.length;i++)if(columns[i].equals(OpenableColumns.DISPLAY_NAME))values[i]="unknown-length.bin";
  cursor.addRow(values);return cursor;
 }
 @Override public String getType(Uri uri){authorize();return "application/octet-stream";}
 @Override public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{
  authorize();if(!"r".equals(mode))throw new FileNotFoundException("Read only fixture");
  try{
   ParcelFileDescriptor[]pipe=ParcelFileDescriptor.createPipe();
   new Thread(()->{try(OutputStream out=new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])){byte[]buffer=new byte[8192];for(int offset=0;offset<SIZE;){int count=Math.min(buffer.length,SIZE-offset);for(int i=0;i<count;i++)buffer[i]=(byte)((offset+i)*73+19);out.write(buffer,0,count);offset+=count;}}catch(java.io.IOException closedReader){}},"unknown-length-fixture").start();
   return pipe[0];
  }catch(java.io.IOException e){throw new FileNotFoundException(e.getMessage());}
 }
 @Override public AssetFileDescriptor openAssetFile(Uri uri,String mode)throws FileNotFoundException{return new AssetFileDescriptor(openFile(uri,mode),0,AssetFileDescriptor.UNKNOWN_LENGTH);}
 @Override public android.os.Bundle call(String method,String arg,android.os.Bundle extras){
  authorize();long identity=Binder.clearCallingIdentity();try{
  if("grant-document-tree".equals(method)){
   Uri tree=android.provider.DocumentsContract.buildTreeDocumentUri(TestDocumentsProvider.AUTHORITY,"root");
   getContext().grantUriPermission("com.msayed.qrferry",tree,android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION|android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION|android.content.Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|android.content.Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
   android.os.Bundle result=new android.os.Bundle();result.putString("uri",tree.toString());return result;
  }
  if("revoke-document-tree".equals(method)){getContext().revokeUriPermission(android.provider.DocumentsContract.buildTreeDocumentUri(TestDocumentsProvider.AUTHORITY,"root"),android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION|android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION);return new android.os.Bundle();}
  if("reset-document-tree".equals(method)){java.io.File root=new java.io.File(getContext().getFilesDir(),"saf-fixture");TestDocumentsProvider.remove(root);root.mkdirs();return new android.os.Bundle();}
  return super.call(method,arg,extras);
  }finally{Binder.restoreCallingIdentity(identity);}
 }
 @Override public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
 @Override public int update(Uri uri,ContentValues values,String where,String[]args){throw new UnsupportedOperationException();}
 @Override public int delete(Uri uri,String where,String[]args){throw new UnsupportedOperationException();}
}
