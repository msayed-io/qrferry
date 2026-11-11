package com.msayed.qrferry.local;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/** Test APK only: real SAF documents whose IDs/URIs change when renamed. */
public final class TestDocumentsProvider extends DocumentsProvider {
 public static final String AUTHORITY="com.msayed.qrferry.test.documents";
 private static final String[] DOCUMENT_COLUMNS={DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_FLAGS,DocumentsContract.Document.COLUMN_SIZE,DocumentsContract.Document.COLUMN_LAST_MODIFIED};
 @Override public boolean onCreate(){root().mkdirs();return true;}
 private File root(){return new File(getContext().getFilesDir(),"saf-fixture");}
 private File file(String id)throws FileNotFoundException{
  if(!id.equals("root")&&!id.startsWith("root/"))throw new FileNotFoundException("Invalid document ID");
  try{File base=root().getCanonicalFile(),file=id.equals("root")?base:new File(base,id.substring(5)).getCanonicalFile();if(!file.equals(base)&&!file.getPath().startsWith(base.getPath()+File.separator))throw new FileNotFoundException("Path escape");return file;}catch(IOException e){throw new FileNotFoundException(e.getMessage());}
 }
 private String id(File file)throws FileNotFoundException{try{String base=root().getCanonicalPath(),path=file.getCanonicalPath();return path.equals(base)?"root":"root/"+path.substring(base.length()+1);}catch(IOException e){throw new FileNotFoundException(e.getMessage());}}
 private void row(MatrixCursor cursor,File file)throws FileNotFoundException{
  Object[]row=new Object[cursor.getColumnCount()];String[]columns=cursor.getColumnNames();
  for(int i=0;i<columns.length;i++){
   switch(columns[i]){
    case DocumentsContract.Document.COLUMN_DOCUMENT_ID:row[i]=id(file);break;
    case DocumentsContract.Document.COLUMN_DISPLAY_NAME:row[i]=file.getName();break;
    case DocumentsContract.Document.COLUMN_MIME_TYPE:row[i]=file.isDirectory()?DocumentsContract.Document.MIME_TYPE_DIR:"application/octet-stream";break;
    case DocumentsContract.Document.COLUMN_FLAGS:row[i]=DocumentsContract.Document.FLAG_SUPPORTS_DELETE|DocumentsContract.Document.FLAG_SUPPORTS_RENAME|(file.isDirectory()?DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE:DocumentsContract.Document.FLAG_SUPPORTS_WRITE);break;
    case DocumentsContract.Document.COLUMN_SIZE:row[i]=file.length();break;
    case DocumentsContract.Document.COLUMN_LAST_MODIFIED:row[i]=file.lastModified();break;
    default:row[i]=null;
   }
  }
  cursor.addRow(row);
 }
 @Override public Cursor queryRoots(String[]projection){
  String[]columns=projection==null?new String[]{DocumentsContract.Root.COLUMN_ROOT_ID,DocumentsContract.Root.COLUMN_DOCUMENT_ID,DocumentsContract.Root.COLUMN_TITLE,DocumentsContract.Root.COLUMN_FLAGS}:projection;
  MatrixCursor cursor=new MatrixCursor(columns);Object[]row=new Object[columns.length];for(int i=0;i<columns.length;i++)switch(columns[i]){case DocumentsContract.Root.COLUMN_ROOT_ID:case DocumentsContract.Root.COLUMN_DOCUMENT_ID:row[i]="root";break;case DocumentsContract.Root.COLUMN_TITLE:row[i]="QRFerry instrumentation documents";break;case DocumentsContract.Root.COLUMN_FLAGS:row[i]=DocumentsContract.Root.FLAG_SUPPORTS_CREATE|DocumentsContract.Root.FLAG_LOCAL_ONLY;break;default:row[i]=null;}
  cursor.addRow(row);return cursor;
 }
 @Override public Cursor queryDocument(String documentId,String[]projection)throws FileNotFoundException{File file=file(documentId);MatrixCursor cursor=new MatrixCursor(projection==null?DOCUMENT_COLUMNS:projection);if(file.exists())row(cursor,file);return cursor;}
 @Override public Cursor queryChildDocuments(String parentDocumentId,String[]projection,String sortOrder)throws FileNotFoundException{MatrixCursor cursor=new MatrixCursor(projection==null?DOCUMENT_COLUMNS:projection);File[]files=file(parentDocumentId).listFiles();if(files!=null)for(File file:files)row(cursor,file);return cursor;}
 @Override public boolean isChildDocument(String parentDocumentId,String documentId){try{return file(documentId).getCanonicalPath().startsWith(file(parentDocumentId).getCanonicalPath()+File.separator);}catch(IOException e){return false;}}
 @Override public ParcelFileDescriptor openDocument(String documentId,String mode,CancellationSignal signal)throws FileNotFoundException{if(signal!=null)signal.throwIfCanceled();return ParcelFileDescriptor.open(file(documentId),ParcelFileDescriptor.parseMode(mode));}
 private static void validName(String name)throws FileNotFoundException{if(name==null||name.isEmpty()||name.equals(".")||name.equals("..")||name.contains("/")||name.contains("\\"))throw new FileNotFoundException("Invalid filename");}
 @Override public String createDocument(String parentDocumentId,String mimeType,String displayName)throws FileNotFoundException{
  validName(displayName);File parent=file(parentDocumentId),result=new File(parent,displayName);for(int n=1;result.exists();n++)result=new File(parent,n+"-"+displayName);
  try{if(DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType)){if(!result.mkdir())throw new IOException("mkdir failed");}else if(!result.createNewFile())throw new IOException("create failed");return id(result);}catch(IOException e){throw new FileNotFoundException(e.getMessage());}
 }
 @Override public String renameDocument(String documentId,String displayName)throws FileNotFoundException{validName(displayName);File from=file(documentId),to=new File(from.getParentFile(),displayName);if(to.exists()||!from.renameTo(to))throw new FileNotFoundException("Rename conflict");return id(to);}
 @Override public void deleteDocument(String documentId)throws FileNotFoundException{if(!remove(file(documentId)))throw new FileNotFoundException("Delete failed");}
 static boolean remove(File file){File[]children=file.listFiles();if(children!=null)for(File child:children)if(!remove(child))return false;return !file.exists()||file.delete();}
}
