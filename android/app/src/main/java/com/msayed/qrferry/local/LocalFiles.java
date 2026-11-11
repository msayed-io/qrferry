package com.msayed.qrferry.local;

import android.content.*;
import android.content.pm.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import android.provider.*;
import androidx.documentfile.provider.DocumentFile;
import org.json.*;
import java.io.*;
import java.util.*;

/** Native catalogue, URI grants, staging, integrity verification and publication. */
public final class LocalFiles {
 public static final class Source {
  public final String id,name,mime;public final long size;final Uri uri;final File apk;public volatile String hash;
  Source(String id,String name,String mime,long size,Uri uri,File apk){this.id=id;this.name=LocalProtocol.safeName(name);this.mime=mime==null?"application/octet-stream":mime;this.size=size;this.uri=uri;this.apk=apk;}
  public JSONObject json()throws JSONException{return new JSONObject().put("id",id).put("name",name).put("mime",mime).put("size",size);}
 }
 private final Context context;private final ContentResolver resolver;private final File inbox;
 private final Map<String,Source> catalogue=new LinkedHashMap<>();private final LinkedHashSet<String> selection=new LinkedHashSet<>();
 public LocalFiles(Context c){context=c.getApplicationContext();resolver=c.getContentResolver();inbox=new File(c.getFilesDir(),"local-inbox");inbox.mkdirs();}
 public synchronized JSONArray selected()throws Exception{JSONArray a=new JSONArray();for(String id:selection){Source s=catalogue.get(id);if(s!=null)a.put(s.json());}return a;}
 public synchronized List<Source> sources(){List<Source>a=new ArrayList<>();for(String id:selection){Source s=catalogue.get(id);if(s!=null)a.add(s);}return a;}
 public synchronized void select(String id,boolean on){if(!catalogue.containsKey(id))throw new IllegalArgumentException("UNKNOWN_FILE");if(on){if(selection.size()>=LocalProtocol.MAX_FILES)throw new IllegalArgumentException("TOO_MANY_FILES");selection.add(id);}else selection.remove(id);}
 public synchronized JSONArray addUris(List<Uri> uris,int flags)throws Exception{
  JSONArray a=new JSONArray();for(Uri uri:uris){if(!"content".equals(uri.getScheme()))continue;if(selection.size()>=LocalProtocol.MAX_FILES)break;
   if((flags&Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)!=0)try{resolver.takePersistableUriPermission(uri,flags&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));}catch(SecurityException ignored){}
   String name="file";long size=-1;try(Cursor c=resolver.query(uri,new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE},null,null,null)){if(c!=null&&c.moveToFirst()){name=c.getString(0);if(!c.isNull(1))size=c.getLong(1);}}
   if(size<0){try(android.content.res.AssetFileDescriptor fd=resolver.openAssetFileDescriptor(uri,"r")){if(fd!=null)size=fd.getLength();}}
   if(size<0||size>LocalProtocol.MAX_FILE)throw new IOException("UNKNOWN_OR_EXCESSIVE_FILE_SIZE");
   String id=UUID.randomUUID().toString();Source s=new Source(id,name,resolver.getType(uri),size,uri,null);catalogue.put(id,s);selection.add(id);a.put(s.json());
  }return a;
 }
 public synchronized JSONArray list(String category,int page)throws Exception{
  if(page<0||page>10000)throw new IllegalArgumentException("INVALID_PAGE");if(category.equals("apps"))return apps(page);
  Uri collection;String filter=null;
  switch(category){case "images":collection=MediaStore.Images.Media.EXTERNAL_CONTENT_URI;break;case "videos":collection=MediaStore.Video.Media.EXTERNAL_CONTENT_URI;break;case "audio":collection=MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;break;default:collection=MediaStore.Files.getContentUri("external");filter=MediaStore.Files.FileColumns.MEDIA_TYPE+"=0 AND "+MediaStore.MediaColumns.SIZE+">0";}
  JSONArray a=new JSONArray();String[]cols={MediaStore.MediaColumns._ID,MediaStore.MediaColumns.DISPLAY_NAME,MediaStore.MediaColumns.MIME_TYPE,MediaStore.MediaColumns.SIZE};
  try(Cursor c=resolver.query(collection,cols,filter,null,MediaStore.MediaColumns.DATE_ADDED+" DESC")){
   if(c!=null&&c.moveToPosition(page*60))do{long size=c.getLong(3);if(size<0||size>LocalProtocol.MAX_FILE)continue;Uri uri=ContentUris.withAppendedId(collection,c.getLong(0));String id=category+":"+c.getLong(0);Source s=new Source(id,c.getString(1),c.getString(2),size,uri,null);catalogue.put(id,s);a.put(s.json().put("selected",selection.contains(id)));}while(a.length()<60&&c.moveToNext());
  }return a;
 }
 private JSONArray apps(int page)throws Exception{
  List<ResolveInfo> apps=context.getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),0);
  apps.sort((a,b)->a.loadLabel(context.getPackageManager()).toString().compareToIgnoreCase(b.loadLabel(context.getPackageManager()).toString()));
  JSONArray result=new JSONArray();Set<String>seen=new HashSet<>();int index=0;
  for(ResolveInfo r:apps){ApplicationInfo info=r.activityInfo.applicationInfo;if(!seen.add(info.packageName))continue;if(index++<page*30)continue;if(result.length()>=60)break;
   String label=r.loadLabel(context.getPackageManager()).toString();List<String>paths=new ArrayList<>();paths.add(info.sourceDir);if(info.splitSourceDirs!=null)Collections.addAll(paths,info.splitSourceDirs);
   for(int i=0;i<paths.size();i++){File file=new File(paths.get(i));String id="apk:"+info.packageName+":"+i;Source s=new Source(id,label+"-"+(i==0?"base":"split-"+i)+".apk","application/vnd.android.package-archive",file.length(),null,file);catalogue.put(id,s);result.put(s.json().put("package",info.packageName).put("splitCount",paths.size()).put("selected",selection.contains(id)));}
  }return result;
 }
 public InputStream open(Source s)throws IOException{InputStream in=s.apk!=null?new FileInputStream(s.apk):resolver.openInputStream(s.uri);if(in==null)throw new IOException("SOURCE_UNAVAILABLE");return in;}
 public String hash(Source s)throws Exception{try(InputStream in=open(s)){return s.hash=LocalProtocol.sha(in);}}
 public boolean broad(){return Build.VERSION.SDK_INT>=30&&Environment.isExternalStorageManager();}
 public String tree(){return context.getSharedPreferences("local-files",0).getString("tree","");}
 public void tree(Uri uri){resolver.takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);context.getSharedPreferences("local-files",0).edit().putString("tree",uri.toString()).apply();}
 private File root(){return new File(Environment.getExternalStorageDirectory(),"QRFerry");}
 public void ensureFolders()throws IOException{
  if(broad()||Build.VERSION.SDK_INT<=28){for(String n:new String[]{"Audio","Videos","Images","Files"}){File f=new File(root(),n);if(!f.isDirectory()&&!f.mkdirs())throw new IOException("STORAGE_ACCESS_REQUIRED");}}
  else if(!tree().isEmpty()){DocumentFile r=DocumentFile.fromTreeUri(context,Uri.parse(tree()));if(r==null||!r.canWrite())throw new IOException("STORAGE_ACCESS_REQUIRED");DocumentFile base=r.findFile("QRFerry");if(base==null)base=r.createDirectory("QRFerry");if(base==null)throw new IOException("CANNOT_CREATE_FOLDER");for(String n:new String[]{"Audio","Videos","Images","Files"})if(base.findFile(n)==null&&base.createDirectory(n)==null)throw new IOException("CANNOT_CREATE_FOLDER");}
  // Scoped-storage Downloads collections are created lazily when real data arrives.
 }
 private File path(String hash,String suffix)throws IOException{if(!LocalProtocol.hash(hash))throw new IOException("INVALID_FILE_ID");return new File(inbox,hash+suffix);}
 public synchronized long prepare(String id,String name,String mime,long size)throws Exception{
  if(!LocalProtocol.hash(id)||size<0||size>LocalProtocol.MAX_FILE)throw new IOException("INVALID_OFFER");
  if(new StatFs(inbox.getAbsolutePath()).getAvailableBytes()<Math.min(size,LocalProtocol.CHUNK)+16L*1024*1024)throw new IOException("STORAGE_FULL");
  File meta=path(id,".json"),part=path(id,".part");
  if(meta.isFile()){JSONObject o=read(meta);if(o.getLong("size")!=size)throw new IOException("FILE_ID_CONFLICT");}
  else write(meta,new JSONObject().put("id",id).put("name",LocalProtocol.safeName(name)).put("mime",mime).put("size",size));
  long length=part.isFile()?part.length():0;if(length>size)throw new IOException("INVALID_PARTIAL");return length;
 }
 public synchronized String published(String id)throws Exception{File f=path(id,".done");if(!f.isFile())return null;String uri=read(f).getString("uri");try(InputStream in=resolver.openInputStream(Uri.parse(uri))){return in==null?null:uri;}catch(Exception e){return null;}}
 public synchronized long append(String id,long offset,byte[]data,int length)throws Exception{
  JSONObject meta=read(path(id,".json"));LocalProtocol.checkChunk(offset,length,meta.getLong("size"));File f=path(id,".part");if(f.length()!=offset)throw new IOException("OFFSET_MISMATCH");
  try(RandomAccessFile out=new RandomAccessFile(f,"rw")){out.seek(offset);out.write(data,0,length);out.getFD().sync();return out.length();}
 }
 public synchronized String finish(String id)throws Exception{
  String previous=published(id);if(previous!=null)return previous;JSONObject m=read(path(id,".json"));File part=path(id,".part");if(!part.exists()&&m.getLong("size")==0)part.createNewFile();
  if(part.length()!=m.getLong("size"))throw new IOException("INCOMPLETE_FILE");try(InputStream in=new FileInputStream(part)){if(!LocalProtocol.secret(LocalProtocol.sha(in),id)){part.delete();throw new IOException("HASH_MISMATCH");}}
  ensureFolders();String name=m.getString("name"),mime=m.getString("mime"),category=LocalProtocol.category(mime);Uri uri;
  if(broad()||Build.VERSION.SDK_INT<=28){File dir=new File(root(),category),dest=new File(dir,name);for(int n=1;dest.exists();n++)dest=new File(dir,n+"-"+name);File tmp=new File(dir,".qrferry-"+UUID.randomUUID()+".part");try(FileOutputStream out=new FileOutputStream(tmp);InputStream in=new FileInputStream(part)){copy(in,out);out.getFD().sync();}catch(Exception e){tmp.delete();throw e;}if(!tmp.renameTo(dest)){tmp.delete();throw new IOException("PUBLISH_FAILED");}uri=Uri.fromFile(dest);android.media.MediaScannerConnection.scanFile(context,new String[]{dest.getAbsolutePath()},new String[]{mime},null);
  }else if(!tree().isEmpty()){
   DocumentFile base=DocumentFile.fromTreeUri(context,Uri.parse(tree())).findFile("QRFerry").findFile(category);DocumentFile tmp=base.createFile(mime,".qrferry-"+UUID.randomUUID()+".part");if(tmp==null)throw new IOException("PUBLISH_FAILED");try(OutputStream out=resolver.openOutputStream(tmp.getUri());InputStream in=new FileInputStream(part)){if(out==null)throw new IOException("PUBLISH_FAILED");copy(in,out);}catch(Exception e){tmp.delete();throw e;}
   String desired=name;for(int n=1;base.findFile(desired)!=null;n++)desired=n+"-"+name;if(!tmp.renameTo(desired)){tmp.delete();throw new IOException("PUBLISH_FAILED");}uri=tmp.getUri();
  }else if(Build.VERSION.SDK_INT>=29){
   ContentValues v=new ContentValues();v.put(MediaStore.MediaColumns.DISPLAY_NAME,name);v.put(MediaStore.MediaColumns.MIME_TYPE,mime);v.put(MediaStore.MediaColumns.RELATIVE_PATH,Environment.DIRECTORY_DOWNLOADS+"/QRFerry/"+category);v.put(MediaStore.MediaColumns.IS_PENDING,1);uri=resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,v);if(uri==null)throw new IOException("PUBLISH_FAILED");
   try(OutputStream out=resolver.openOutputStream(uri);InputStream in=new FileInputStream(part)){if(out==null)throw new IOException("PUBLISH_FAILED");copy(in,out);}catch(Exception e){resolver.delete(uri,null,null);throw e;}ContentValues done=new ContentValues();done.put(MediaStore.MediaColumns.IS_PENDING,0);if(resolver.update(uri,done,null,null)!=1)throw new IOException("PUBLISH_FAILED");
  }else throw new IOException("STORAGE_ACCESS_REQUIRED");
  write(path(id,".done"),new JSONObject().put("uri",uri.toString()));part.delete();return uri.toString();
 }
 private static void copy(InputStream in,OutputStream out)throws IOException{byte[]b=new byte[LocalProtocol.CHUNK];for(int n;(n=in.read(b))!=-1;)out.write(b,0,n);out.flush();}
 private static JSONObject read(File f)throws Exception{if(f.length()>8192)throw new IOException("INVALID_JOURNAL");try(InputStream in=new FileInputStream(f)){ByteArrayOutputStream out=new ByteArrayOutputStream();copy(in,out);return new JSONObject(out.toString("UTF-8"));}}
 private static void write(File f,JSONObject o)throws Exception{android.util.AtomicFile af=new android.util.AtomicFile(f);FileOutputStream out=null;try{out=af.startWrite();out.write(o.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));af.finishWrite(out);}catch(Exception e){if(out!=null)af.failWrite(out);throw e;}}
}
