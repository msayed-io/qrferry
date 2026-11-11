package com.msayed.qrferry.local;

import android.content.Context;
import android.content.pm.*;
import android.graphics.*;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import java.io.*;

/** Small, bounded UI thumbnails only. File content never crosses the bridge:
 * at most a 96px JPEG under 8KiB, cached for a fixed number of rows. */
final class LocalThumbs {
 static final int MAX_BYTES=8*1024,SIZE=96;
 private LocalThumbs(){}
 static String of(Context context,LocalFiles.Source source){
  try{
   Bitmap bitmap=source.apk!=null?appIcon(context,source.apk):mediaThumb(context,source.uri);
   if(bitmap==null)return null;
   bitmap=scale(bitmap);
   ByteArrayOutputStream out=new ByteArrayOutputStream();
   bitmap.compress(Bitmap.CompressFormat.JPEG,72,out);bitmap.recycle();
   if(out.size()>MAX_BYTES)return null;
   return "data:image/jpeg;base64,"+android.util.Base64.encodeToString(out.toByteArray(),android.util.Base64.NO_WRAP);
  }catch(Exception|OutOfMemoryError ignored){return null;}
 }
 private static Bitmap appIcon(Context context,File apk){
  PackageManager manager=context.getPackageManager();
  PackageInfo info=manager.getPackageArchiveInfo(apk.getAbsolutePath(),PackageManager.GET_ACTIVITIES);
  if(info==null||info.applicationInfo==null)return null;
  ApplicationInfo application=info.applicationInfo;
  application.sourceDir=apk.getAbsolutePath();application.publicSourceDir=apk.getAbsolutePath();
  return manager.getApplicationIcon(application);
 }
 private static Bitmap mediaThumb(Context context,Uri uri)throws Exception{
  if(uri==null||!"content".equals(uri.getScheme()))return null;
  String type=context.getContentResolver().getType(uri);
  boolean video=type!=null&&type.startsWith("video/"),image=type!=null&&type.startsWith("image/");
  if(!video&&!image)return null;
  if(Build.VERSION.SDK_INT>=29)return context.getContentResolver().loadThumbnail(uri,new android.util.Size(SIZE,SIZE),null);
  long id;
  try{id=Long.parseLong(uri.getLastPathSegment());}catch(Exception numeric){return null;}
  return video
   ?MediaStore.Video.Thumbnails.getThumbnail(context.getContentResolver(),id,MediaStore.Video.Thumbnails.MINI_KIND,null)
   :MediaStore.Images.Thumbnails.getThumbnail(context.getContentResolver(),id,MediaStore.Images.Thumbnails.MINI_KIND,null);
 }
 private static Bitmap scale(Bitmap source){
  int width=source.getWidth(),height=source.getHeight();
  if(width<=SIZE&&height<=SIZE)return source;
  float ratio=Math.min((float)SIZE/width,(float)SIZE/height);
  Bitmap scaled=Bitmap.createScaledBitmap(source,Math.max(1,Math.round(width*ratio)),Math.max(1,Math.round(height*ratio)),true);
  if(scaled!=source)source.recycle();
  return scaled;
 }
}
