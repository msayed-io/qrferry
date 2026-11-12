package com.msayed.qrferry.local;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.*;
import android.media.ExifInterface;
import android.net.Uri;
import android.util.Base64;
import java.io.*;
import java.util.UUID;

/** The device identity used by the radar. It never leaves the app except as the
 *  short advertisement string and the card exchanged after a confirmed pairing. */
public final class LocalProfile {
 static final int AVATAR_LOCAL=256,AVATAR_SHARED=96;
 private final Context context;private final SharedPreferences prefs;
 LocalProfile(Context context){this.context=context.getApplicationContext();this.prefs=context.getSharedPreferences("local-profile",Context.MODE_PRIVATE);}

 /** Idempotent: the first call creates the identity, later calls return it. */
 synchronized org.json.JSONObject getOrCreate(){
  String id=prefs.getString("userId","");
  if(id.isEmpty()){
   id=UUID.randomUUID().toString();
   String name=defaultName();
   SharedPreferences.Editor editor=prefs.edit()
    .putString("userId",id).putString("displayName",name)
    .putString("avatarType","default").putInt("avatarIndex",(int)(Math.random()*10))
    .putInt("avatarVersion",0).putLong("createdAt",System.currentTimeMillis());
   editor.apply();
  }
  return snapshot();
 }

 synchronized org.json.JSONObject snapshot(){
  try{
   String name=prefs.getString("displayName","");
   if(name.isEmpty()){name=defaultName();prefs.edit().putString("displayName",name).apply();}
   String type=prefs.getString("avatarType","default");
   int version=prefs.getInt("avatarVersion",0);
   return new org.json.JSONObject()
    .put("userId",prefs.getString("userId",""))
    .put("displayName",name)
    .put("avatarType",type)
    .put("defaultAvatarIndex",prefs.getInt("avatarIndex",0))
    .put("avatarVersion",version)
    .put("hasCustomAvatar","custom".equals(type)&&avatarFile(version).isFile())
    .put("avatar",avatarDataUrl(AVATAR_LOCAL))
    .put("createdAt",prefs.getLong("createdAt",0))
    .put("updatedAt",prefs.getLong("updatedAt",0));
  }catch(org.json.JSONException e){return new org.json.JSONObject();}
 }

 /** Word + underscore + four digits. The word comes from the page so it stays localised. */
 private String defaultName(){
  String word=prefs.getString("nameWord","");
  if(word.isEmpty())word="User";
  int digits=(int)(new java.security.SecureRandom().nextInt(10000));
  return word+"_"+String.format(java.util.Locale.US,"%04d",digits);
 }

 synchronized org.json.JSONObject setName(String raw){
  String name=raw==null?"":raw.trim();
  if(name.isEmpty())name=defaultName();
  prefs.edit().putString("displayName",name).putLong("updatedAt",System.currentTimeMillis()).apply();
  return snapshot();
 }

 /** Remembers the localised word so a reset name still matches the UI language. */
 synchronized void setNameWord(String word){if(word!=null&&!word.isEmpty())prefs.edit().putString("nameWord",word).apply();}

 synchronized org.json.JSONObject setDefaultAvatar(int index){
  int safe=Math.max(0,Math.min(9,index));
  prefs.edit().putString("avatarType","default").putInt("avatarIndex",safe)
   .putLong("updatedAt",System.currentTimeMillis()).apply();
  return snapshot();
 }

 /** Writes the new picture atomically, then drops the superseded file. */
 synchronized org.json.JSONObject setCustomAvatar(Uri source)throws IOException{
  Bitmap square=decodeSquare(source,AVATAR_LOCAL);
  if(square==null)throw new IOException("AVATAR_DECODE_FAILED");
  int version=prefs.getInt("avatarVersion",0)+1;
  File target=avatarFile(version);
  File parent=target.getParentFile();
  if(parent!=null&&!parent.isDirectory()&&!parent.mkdirs())throw new IOException("AVATAR_DIRECTORY_FAILED");
  File temp=new File(target.getPath()+".tmp");
  try(FileOutputStream out=new FileOutputStream(temp)){
   if(!square.compress(Bitmap.CompressFormat.JPEG,88,out))throw new IOException("AVATAR_WRITE_FAILED");
   out.getFD().sync();
  }catch(IOException e){temp.delete();throw e;}
  if(!temp.renameTo(target)){temp.delete();throw new IOException("AVATAR_RENAME_FAILED");}
  prefs.edit().putString("avatarType","custom").putInt("avatarVersion",version)
   .putLong("updatedAt",System.currentTimeMillis()).apply();
  for(File file:avatars())if(!file.equals(target))file.delete();
  return snapshot();
 }

 /** The 96px JPEG as base64, used in the card exchanged after pairing. Empty when
  *  the avatar is one of the built-in ones. */
 String sharedAvatar(){
  if(!"custom".equals(prefs.getString("avatarType","default")))return "";
  Bitmap bitmap=read(avatarFile(prefs.getInt("avatarVersion",0)));
  if(bitmap==null)return "";
  Bitmap small=scaleSquare(bitmap,AVATAR_SHARED);
  ByteArrayOutputStream out=new ByteArrayOutputStream();
  small.compress(Bitmap.CompressFormat.JPEG,80,out);
  if(bitmap!=small)bitmap.recycle();
  small.recycle();
  return Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP);
 }

 private String avatarDataUrl(int size){
  if(!"custom".equals(prefs.getString("avatarType","default")))return "";
  Bitmap bitmap=read(avatarFile(prefs.getInt("avatarVersion",0)));
  if(bitmap==null)return "";
  Bitmap small=scaleSquare(bitmap,size);
  ByteArrayOutputStream out=new ByteArrayOutputStream();
  small.compress(Bitmap.CompressFormat.JPEG,86,out);
  if(bitmap!=small)bitmap.recycle();
  small.recycle();
  return "data:image/jpeg;base64,"+Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP);
 }

 File avatarFile(int version){return new File(new File(context.getFilesDir(),"profile"),"avatar_v"+version+".jpg");}
 private File[] avatars(){File dir=new File(context.getFilesDir(),"profile");File[] files=dir.listFiles();return files==null?new File[0]:files;}
 private Bitmap read(File file){return file.isFile()?BitmapFactory.decodeFile(file.getAbsolutePath()):null;}

 /** Bounded decode: pre-scale while reading so a 100MP photo cannot exhaust the heap. */
 private Bitmap decodeSquare(Uri uri,int target)throws IOException{
  BitmapFactory.Options probe=new BitmapFactory.Options();probe.inJustDecodeBounds=true;
  try(InputStream in=context.getContentResolver().openInputStream(uri)){
   if(in==null)return null;
   BitmapFactory.decodeStream(in,null,probe);
  }
  if(probe.outWidth<=0||probe.outHeight<=0)return null;
  int sample=1;while(Math.min(probe.outWidth,probe.outHeight)/(sample*2)>=target)sample*=2;
  BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=sample;
  Bitmap decoded;
  try(InputStream in=context.getContentResolver().openInputStream(uri)){
   if(in==null)return null;
   decoded=BitmapFactory.decodeStream(in,null,options);
  }
  if(decoded==null)return null;
  Bitmap rotated=rotate(decoded,uri);
  if(rotated!=decoded)decoded.recycle();
  return scaleSquare(rotated,target);
 }

 private Bitmap rotate(Bitmap bitmap,Uri uri){
  int degrees=0;
  try(InputStream in=context.getContentResolver().openInputStream(uri)){
   if(in!=null){
    ExifInterface exif=new ExifInterface(in);
    int orientation=exif.getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL);
    if(orientation==ExifInterface.ORIENTATION_ROTATE_90)degrees=90;
    else if(orientation==ExifInterface.ORIENTATION_ROTATE_180)degrees=180;
    else if(orientation==ExifInterface.ORIENTATION_ROTATE_270)degrees=270;
   }
  }catch(Exception ignored){/* a missing orientation is a normal image */}
  if(degrees==0)return bitmap;
  Matrix matrix=new Matrix();matrix.postRotate(degrees);
  return Bitmap.createBitmap(bitmap,0,0,bitmap.getWidth(),bitmap.getHeight(),matrix,true);
 }

 private Bitmap scaleSquare(Bitmap source,int target){
  int side=Math.min(source.getWidth(),source.getHeight());
  int left=(source.getWidth()-side)/2,top=(source.getHeight()-side)/2;
  return Bitmap.createScaledBitmap(Bitmap.createBitmap(source,left,top,side,side),target,target,true);
 }
}
