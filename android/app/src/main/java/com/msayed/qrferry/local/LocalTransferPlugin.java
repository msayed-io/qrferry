package com.msayed.qrferry.local;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import com.google.zxing.*;
import com.google.zxing.common.BitMatrix;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;

@CapacitorPlugin(name="QRFerryLocal", permissions={
 @Permission(alias="camera",strings={Manifest.permission.CAMERA}),
 @Permission(alias="nearby",strings={Manifest.permission.NEARBY_WIFI_DEVICES}),
 @Permission(alias="location",strings={Manifest.permission.ACCESS_FINE_LOCATION}),
 @Permission(alias="read",strings={Manifest.permission.READ_EXTERNAL_STORAGE}),
 @Permission(alias="legacyStorage",strings={Manifest.permission.READ_EXTERNAL_STORAGE,Manifest.permission.WRITE_EXTERNAL_STORAGE}),
 @Permission(alias="media",strings={Manifest.permission.READ_MEDIA_IMAGES,Manifest.permission.READ_MEDIA_VIDEO,Manifest.permission.READ_MEDIA_AUDIO})
})
public class LocalTransferPlugin extends Plugin {
 private LocalEngine engine;private LocalEngine.Listener listener;private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final Map<PluginCall,Integer> pickerGenerations=new ConcurrentHashMap<>();
 private LocalScanner scanner;private FrameLayout overlay;private boolean overlayQr;private final Handler main=new Handler(Looper.getMainLooper());
 @Override public void load(){engine=LocalTransferService.engine(getContext());listener=s->{try{JSObject data=new JSObject(s.toString());notifyListeners("state",data);}catch(Exception ignored){}if(!s.optBoolean("qrReady")&&overlayQr)main.post(this::hideOverlay);};engine.subscribe(listener);worker.execute(()->{try{ // The receiving tree exists from the first run that already holds the scope.
   if(storageReady()&&engine.files.tree().isEmpty())engine.files.ensureFolders();}catch(Exception ignored){}});}
 private boolean ar(){return getContext().getResources().getConfiguration().getLocales().get(0).getLanguage().equals("ar");}
 /** One readiness flag per Android storage model: all-files (R+), legacy write
  * (≤10), or a granted read scope (11/12). The UI must never keep prompting a
  * scope this device cannot grant. */
 private boolean legacyWrite(){return getPermissionState("legacyStorage")==PermissionState.GRANTED;}
 private boolean storageReady(){
  if(Build.VERSION.SDK_INT>=30)return engine.files.broad();
  if(Build.VERSION.SDK_INT<=29)return legacyWrite();
  return getPermissionState("read")==PermissionState.GRANTED;
 }
 /** Android 13+ needs per-type media scopes unless all-files access is granted. */
 private boolean mediaReady(){
  if(Build.VERSION.SDK_INT<33)return true;
  if(engine.files.broad())return true;
  return getPermissionState("media")==PermissionState.GRANTED;
 }
 private void resolve(PluginCall call){try{JSObject s=new JSObject(engine.snapshot().toString());s.put("native",true);s.put("sdk",Build.VERSION.SDK_INT);s.put("allFiles",engine.files.broad());s.put("storageReady",storageReady());s.put("media",mediaReady());s.put("storageAsked",getContext().getSharedPreferences("local-files",0).getBoolean("asked",false));s.put("camera",getPermissionState("camera")==PermissionState.GRANTED);s.put("nearby",getPermissionState(Build.VERSION.SDK_INT>=33?"nearby":"location")==PermissionState.GRANTED);s.put("wifi",((android.net.wifi.WifiManager)getContext().getApplicationContext().getSystemService(android.content.Context.WIFI_SERVICE)).isWifiEnabled());s.put("destination",!engine.files.tree().isEmpty()?"Selected folder/QRFerry":engine.files.broad()||engine.files.legacyWritable()?"QRFerry":Build.VERSION.SDK_INT>=29?"Downloads/QRFerry":"Choose destination");call.resolve(s);}catch(Exception e){call.reject("STATUS_FAILED",e);}}
 @PluginMethod public void getState(PluginCall call){resolve(call);}
 /** The entire category in one response; no paging step exists in the UI. */
 @PluginMethod public void listFiles(PluginCall call){worker.execute(()->{try{call.resolve(new JSObject().put("files",engine.files.list(call.getString("category","files"))));}catch(Exception e){call.reject("FILE_ACCESS_REQUIRED",e);}});}
 /** Pictures for a visible batch of rows; never part of the listing call. */
 @PluginMethod public void thumbnails(PluginCall call){worker.execute(()->{try{call.resolve(new JSObject().put("thumbs",engine.files.thumbnails(call.getArray("ids"))));}catch(Exception e){call.reject("THUMBNAIL_FAILED",e);}});}
 @PluginMethod public void clearSelection(PluginCall call){try{engine.files.clearSelection();engine.changed();resolve(call);}catch(Exception e){call.reject("SELECTION_FAILED",e);}}
 @PluginMethod public void selectFile(PluginCall call){try{engine.files.select(call.getString("id",""),Boolean.TRUE.equals(call.getBoolean("selected",false)));engine.changed();resolve(call);}catch(Exception e){call.reject("SELECTION_FAILED",e);}}
 @PluginMethod public void pickFiles(PluginCall call){pickerGenerations.put(call,engine.files.fileWorkGeneration());hideOverlay();Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType(call.getString("mime","*/*")).addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);startActivityForResult(call,i,"pickedFiles");}
 @ActivityCallback private void pickedFiles(PluginCall call,ActivityResult result){if(call==null)return;Integer generation=pickerGenerations.remove(call);if(generation==null||generation!=engine.files.fileWorkGeneration()){call.reject("CANCELLED");return;}if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null){resolve(call);return;}Intent data=result.getData();List<Uri>uris=new ArrayList<>();if(data.getClipData()!=null)for(int n=0;n<data.getClipData().getItemCount();n++)uris.add(data.getClipData().getItemAt(n).getUri());else if(data.getData()!=null)uris.add(data.getData());worker.execute(()->{try{engine.files.addUris(uris,data.getFlags(),generation);engine.changed();resolve(call);}catch(Exception e){call.reject("FILES_NOT_READABLE",e);}});}
 @PluginMethod public void requestStorage(PluginCall call){
  getContext().getSharedPreferences("local-files",0).edit().putBoolean("asked",true).apply();
  if(Build.VERSION.SDK_INT>=30){
   if(engine.files.broad()){prepareFolders(call);return;}
   // The official all-files screen is the only way Android grants this scope.
   Intent direct=new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,Uri.parse("package:"+getContext().getPackageName()));
   try{startActivityForResult(call,direct,"storageReturned");}
   catch(Exception unsupported){try{startActivityForResult(call,new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION),"storageReturned");}catch(Exception e){call.reject("STORAGE_SETTINGS_UNAVAILABLE",e);}}
   return;
  }
  requestPermissionForAlias(Build.VERSION.SDK_INT<=29?"legacyStorage":"read",call,"storagePermission");
 }
 @PermissionCallback private void storagePermission(PluginCall call){prepareFolders(call);}
 /** Second layer on Android 13+: the official photo/video/audio dialog when the
  * all-files screen was declined, so media categories are never silently empty. */
 @PluginMethod public void requestMedia(PluginCall call){
  if(Build.VERSION.SDK_INT<33||engine.files.broad()||getPermissionState("media")==PermissionState.GRANTED){resolve(call);return;}
  requestPermissionForAlias("media",call,"mediaGranted");
 }
 @PermissionCallback private void mediaGranted(PluginCall call){resolve(call);}
 @ActivityCallback private void storageReturned(PluginCall call,ActivityResult r){prepareFolders(call);}
 private void prepareFolders(PluginCall call){if(call==null)return;worker.execute(()->{try{if(storageReady())engine.files.ensureFolders();resolve(call);}catch(Exception e){call.reject("CANNOT_PREPARE_STORAGE",e);}});}
 /** Preparation screen: only official Android dialogs/screens are opened here. */
 @PluginMethod public void requestNearby(PluginCall call){networkPermission(call);if(getPermissionState(Build.VERSION.SDK_INT>=33?"nearby":"location")==PermissionState.GRANTED)resolve(call);}
 @PluginMethod public void openSettings(PluginCall call){
  String which=call.getString("which","app");
  Intent intent;
  if("wifi".equals(which))intent=new Intent(Settings.ACTION_WIFI_SETTINGS);
  else if("storage".equals(which))intent=Build.VERSION.SDK_INT>=30?new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,Uri.parse("package:"+getContext().getPackageName())):new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getContext().getPackageName()));
  else intent=new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getContext().getPackageName()));
  try{intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);getContext().startActivity(intent);resolve(call);}catch(Exception e){call.reject("SETTINGS_UNAVAILABLE",e);}
 }
 @PluginMethod public void chooseDestination(PluginCall call){if(engine.busy()){call.reject("SESSION_ACTIVE");return;}startActivityForResult(call,new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),"destinationPicked");}
 @ActivityCallback private void destinationPicked(PluginCall call,ActivityResult r){if(call==null)return;if(r.getResultCode()!=Activity.RESULT_OK||r.getData()==null||r.getData().getData()==null){resolve(call);return;}worker.execute(()->{try{if(engine.busy()){call.reject("SESSION_ACTIVE");return;}engine.files.tree(r.getData().getData());engine.files.ensureFolders();resolve(call);}catch(Exception e){call.reject("DESTINATION_NOT_WRITABLE",e);}});}
 private boolean networkPermission(PluginCall call){String alias=Build.VERSION.SDK_INT>=33?"nearby":"location";if(getPermissionState(alias)==PermissionState.GRANTED)return true;requestPermissionForAlias(alias,call,"networkGranted");return false;}
 @PermissionCallback private void networkGranted(PluginCall call){String alias=Build.VERSION.SDK_INT>=33?"nearby":"location";if(getPermissionState(alias)!=PermissionState.GRANTED){call.reject("NEARBY_PERMISSION_REQUIRED");return;}if(call.getMethodName().equals("startReceive"))startReceive(call);else if(call.getMethodName().equals("startScan"))startScan(call);else resolve(call);}
 private void foreground(){ContextCompat.startForegroundService(getContext(),new Intent(getContext(),LocalTransferService.class));}
 @PluginMethod public void startReceive(PluginCall call){
  if(!networkPermission(call))return;
  String method=call.getString("method","auto");if(!Arrays.asList("auto","direct","hotspot","lan").contains(method)){call.reject("INVALID_METHOD");return;}
  try{foreground();engine.receive(method);resolve(call);}catch(Exception e){call.reject("FOREGROUND_START_FAILED",e);}
 }
 @PluginMethod public void startScan(PluginCall call){
  if(engine.files.sources().isEmpty()){call.reject("SELECT_FILES_FIRST");return;}
  if(!networkPermission(call))return;
  if(getPermissionState("camera")==PermissionState.GRANTED)openScanner(call);
  else requestPermissionForAlias("camera",call,"cameraGranted");
 }
 @PermissionCallback private void cameraGranted(PluginCall call){if(getPermissionState("camera")!=PermissionState.GRANTED){call.reject("CAMERA_PERMISSION_REQUIRED");return;}openScanner(call);}
 private void openScanner(PluginCall call){main.post(()->{try{hideOverlay();overlay=makeOverlay(call);overlayQr=false;scanner=new LocalScanner(getActivity());final FrameLayout host=overlay;scanner.start(host,new LocalScanner.Result(){public void scanned(String raw){hideOverlay();try{foreground();engine.join(raw);}catch(Exception e){engine.fail("INVALID_OR_EXPIRED_QR");}}public void failed(String code){hideOverlay();engine.fail(code);}});host.addView(new LocalScanFrame(getActivity()),new FrameLayout.LayoutParams(-1,-1));call.resolve(new JSObject().put("scanning",true));}catch(Exception e){hideOverlay();call.reject("CAMERA_UNAVAILABLE",e);}});}
 private FrameLayout.LayoutParams overlayBounds(PluginCall call,boolean opening){
  double x=call.getDouble("x",0.0),y=call.getDouble("y",0.0),w=call.getDouble("width",0.0),h=call.getDouble("height",0.0),viewport=call.getDouble("viewport",0.0);
  if(!Double.isFinite(x)||!Double.isFinite(y)||!Double.isFinite(w)||!Double.isFinite(h)||!Double.isFinite(viewport)||w<80||h<80||viewport<200||w>viewport+1||x+w>viewport+1||(opening&&(x<0||y<0)))throw new IllegalArgumentException("INVALID_VIEWPORT");
  android.webkit.WebView web=getBridge().getWebView();View parent=getActivity().findViewById(android.R.id.content);
  float scale=web.getWidth()/(float)viewport;int[]webLocation=new int[2],parentLocation=new int[2];web.getLocationInWindow(webLocation);parent.getLocationInWindow(parentLocation);
  // addContentView uses content-parent coordinates, not window coordinates.
  // SystemChrome already applies system-bar/IME insets to the decor parent.
  FrameLayout.LayoutParams params=new FrameLayout.LayoutParams(Math.round((float)(w*scale)),Math.round((float)(h*scale)));
  params.leftMargin=webLocation[0]-parentLocation[0]+Math.round((float)(x*scale));params.topMargin=webLocation[1]-parentLocation[1]+Math.round((float)(y*scale));return params;
 }
 private FrameLayout makeOverlay(PluginCall call){
  FrameLayout host=new FrameLayout(getActivity());FrameLayout.LayoutParams params=overlayBounds(call,true);getActivity().addContentView(host,params);
  float scale=getBridge().getWebView().getWidth()/call.getDouble("viewport",1.0).floatValue();host.setClipToOutline(true);host.setOutlineProvider(new ViewOutlineProvider(){public void getOutline(View v,Outline o){o.setRoundRect(0,0,v.getWidth(),v.getHeight(),16*scale);}});return host;
 }
 @PluginMethod public void showPairingCode(PluginCall call){worker.execute(()->{try{String raw=engine.pairingCode();Map<EncodeHintType,Object>hints=new EnumMap<>(EncodeHintType.class);hints.put(EncodeHintType.MARGIN,2);hints.put(EncodeHintType.ERROR_CORRECTION,com.google.zxing.qrcode.decoder.ErrorCorrectionLevel.M);BitMatrix matrix=new MultiFormatWriter().encode(raw,BarcodeFormat.QR_CODE,768,768,hints);Bitmap bitmap=Bitmap.createBitmap(768,768,Bitmap.Config.ARGB_8888);int[]pixels=new int[768*768];for(int y=0;y<768;y++)for(int x=0;x<768;x++)pixels[y*768+x]=matrix.get(x,y)?Color.BLACK:Color.WHITE;bitmap.setPixels(pixels,0,768,0,0,768,768);main.post(()->{try{if(!engine.snapshot().optBoolean("qrReady"))throw new IllegalStateException("QR_NOT_READY");hideOverlay();overlay=makeOverlay(call);overlayQr=true;ImageView image=new ImageView(getActivity());image.setBackgroundColor(Color.WHITE);image.setScaleType(ImageView.ScaleType.FIT_CENTER);image.setImageBitmap(bitmap);overlay.addView(image,new FrameLayout.LayoutParams(-1,-1));call.resolve();}catch(Exception e){call.reject("QR_DISPLAY_FAILED",e);}});}catch(Exception e){call.reject("QR_NOT_READY",e);}});}
 @PluginMethod public void updateNativeView(PluginCall call){main.post(()->{try{if(overlay!=null)overlay.setLayoutParams(overlayBounds(call,false));call.resolve();}catch(Exception e){call.reject("INVALID_VIEWPORT",e);}});}
 @PluginMethod public void hideNativeView(PluginCall call){main.post(()->{hideOverlay();call.resolve();});}
 private void hideOverlay(){if(Looper.myLooper()!=Looper.getMainLooper()){main.post(this::hideOverlay);return;}overlayQr=false;if(scanner!=null){scanner.close();scanner=null;}if(overlay!=null){if(overlay.getParent()instanceof ViewGroup)((ViewGroup)overlay.getParent()).removeView(overlay);overlay=null;}}
 @PluginMethod public void pause(PluginCall call){worker.execute(()->{engine.pause(Boolean.TRUE.equals(call.getBoolean("paused",true)));resolve(call);});}
 @PluginMethod public void sendSelected(PluginCall call){engine.sendSelected();resolve(call);}
 @PluginMethod public void sendMessage(PluginCall call){worker.execute(()->{try{engine.message(call.getString("text",""));resolve(call);}catch(Exception e){call.reject("MESSAGE_NOT_SENT",e);}});}
 @PluginMethod public void disconnect(PluginCall call){main.post(()->{hideOverlay();engine.disconnect();getContext().stopService(new Intent(getContext(),LocalTransferService.class));resolve(call);});}
 @Override protected void handleOnPause(){main.post(()->{hideOverlay();notifyListeners("lifecycle",new JSObject().put("active",false));});}
 @Override protected void handleOnResume(){notifyListeners("lifecycle",new JSObject().put("active",true));}
 @Override protected void handleOnDestroy(){
  engine.unsubscribe(listener);main.post(this::hideOverlay);worker.shutdown();
  // The WebView is gone: the session (and its ongoing notification) must not
  // survive it. The recovery journal keeps anything unfinished resumable.
  try{getContext().stopService(new Intent(getContext(),LocalTransferService.class));}catch(Exception ignored){}
 }
}
