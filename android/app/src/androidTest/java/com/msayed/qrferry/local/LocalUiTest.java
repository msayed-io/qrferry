package com.msayed.qrferry.local;

import static org.junit.Assert.*;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.matcher.RootMatchers.isDialog;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.assertion.ViewAssertions.doesNotExist;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static org.hamcrest.Matchers.anyOf;
import static org.hamcrest.Matchers.is;

import android.content.Context;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.camera.core.CameraInfo;
import androidx.camera.core.CameraState;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.FileProvider;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.msayed.qrferry.MainActivity;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** Actual packaged WebView, Capacitor commands, Android consent dialog and CameraX.
 * The older API24/29 native-only jobs deliberately do not run this modern-WebView suite. */
@RunWith(AndroidJUnit4.class)
public class LocalUiTest {
 private interface Condition{boolean ready()throws Exception;}
 private static void until(String message,Condition condition,long timeout)throws Exception{
  long deadline=System.currentTimeMillis()+timeout;
  while(System.currentTimeMillis()<deadline){if(condition.ready())return;Thread.sleep(50);}
  fail(message);
 }
 private static String js(WebView view,String expression)throws Exception{
  CountDownLatch done=new CountDownLatch(1);AtomicReference<String>result=new AtomicReference<>();
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->view.evaluateJavascript(expression,value->{result.set(value);done.countDown();}));
  assertTrue("WebView evaluation did not return",done.await(5,TimeUnit.SECONDS));return result.get();
 }
 /** Real device pixels for every screen, shipped with the CI artifact so the
  *  chrome can be reviewed against the app's own History/Privacy pages. They are
  *  written inside the app sandbox and packed into one zip, which the CI script
  *  copies out with `run-as`: scoped storage otherwise hides them from adb. */
 private static final java.util.List<File> shotFiles=new java.util.ArrayList<>();
 private static int shotIndex;
 private static void shot(String name)throws Exception{
  // A route change settles a frame or two after the DOM updates; capturing too
  // early photographs the previous screen.
  Thread.sleep(500);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  android.graphics.Bitmap bitmap=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
  assertNotNull("Screenshot failed: "+name,bitmap);
  try{
   File dir=new File(context.getCacheDir(),"shots");if(!dir.exists()&&!dir.mkdirs())fail("Cannot create "+dir);
   File target=new File(dir,String.format("%02d-%s.png",++shotIndex,name));
   try(FileOutputStream out=new FileOutputStream(target)){
    assertTrue("Cannot write screenshot "+name,bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out));
   }
   shotFiles.add(target);
  }finally{bitmap.recycle();}
 }
 /** Packs every captured screen into one archive for the CI artifact. */
 @org.junit.AfterClass public static void packShots()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  File archive=new File(context.getCacheDir(),"shots.zip");
  try(java.util.zip.ZipOutputStream zip=new java.util.zip.ZipOutputStream(new FileOutputStream(archive))){
   for(File file:shotFiles){
    zip.putNextEntry(new java.util.zip.ZipEntry(file.getName()));
    try(java.io.InputStream in=new java.io.FileInputStream(file)){byte[] buffer=new byte[8192];int read;while((read=in.read(buffer))!=-1)zip.write(buffer,0,read);}
    zip.closeEntry();
   }
  }
 }
 private static android.widget.ImageView qrView(View view){
  if(view instanceof android.widget.ImageView && ((android.widget.ImageView)view).getDrawable()!=null)return (android.widget.ImageView)view;
  if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++){android.widget.ImageView found=qrView(group.getChildAt(i));if(found!=null)return found;}}
  return null;
 }
 private static PreviewView preview(View view){
  if(view instanceof PreviewView)return (PreviewView)view;
  if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++){PreviewView found=preview(group.getChildAt(i));if(found!=null)return found;}}
  return null;
 }
 // A dialog window can exist before Espresso's root picker sees window focus, for
 // example while the launching activity is still completing its first frame. That
 // is a transient state, so it is retried instead of failing the assertion.
 private static void pressCamera(WebView view)throws Exception{
  until("Camera button is unavailable",()->"true".equals(js(view,"(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Open camera')||b.textContent.includes('فتح الكاميرا'));if(!b||b.disabled)return false;b.click();return true})()")),15000);
 }
 /** Enters local mode idempotently and lands on its home screen. The switch only
  *  exists while the optical mode is showing, and the app remembers the last
  *  mode, so pressing it unconditionally would leave local mode instead. */
 private static void enterLocal(WebView view)throws Exception{
  until("App chrome did not render",()->"true".equals(js(view,"Boolean(document.querySelector('.local-page')||document.querySelector('.brand-mode'))")),45000);
  assertEquals("true",js(view,"(()=>{if(document.querySelector('.local-page'))return true;const b=document.querySelector('.brand-mode');if(!b)return false;b.click();return true})()"));
  until("Native mode entry did not mount",()->"true".equals(js(view,"Boolean(document.querySelector('.local-page'))")),20000);
  until("Native home did not mount",()->"true".equals(js(view,"(()=>{const p=document.querySelector('.local-page');if(!p||!p.dataset.screen)return false;if(p.dataset.screen==='home')return true;const x=document.querySelector('.support-exit');if(x)x.click();return false})()")),25000);
 }
 @Test public void nativeEntryConsentCameraGeometryAndPauseRelease()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();boolean previouslyAsked=context.getSharedPreferences("local-files",0).getBoolean("asked",false);
  context.getSharedPreferences("local-files",0).edit().putBoolean("asked",false).commit();
  File source=new File(context.getCacheDir(),"native-camera-consent-"+System.nanoTime()+".bin");try(FileOutputStream out=new FileOutputStream(source)){out.write(new byte[]{1,2,3,4});}
  LocalEngine engine=LocalTransferService.engine(context);engine.disconnect();String selectedId=null;
  try(ActivityScenario<MainActivity>scenario=ActivityScenario.launch(MainActivity.class)){
   AtomicReference<WebView>reference=new AtomicReference<>();scenario.onActivity(activity->reference.set(activity.getBridge().getWebView()));WebView view=reference.get();
   enterLocal(view);
   // Permissions belong to the preparation screen and to the Android dialogs only.
   onView(withText(anyOf(is("Access to your files"),is("الوصول إلى ملفاتك")))).check(doesNotExist());
   assertEquals("false",js(view,"Boolean(document.querySelector('.local-notice'))"));
   shot("home");
   selectedId=engine.files.addUris(Collections.singletonList(FileProvider.getUriForFile(context,context.getPackageName()+".fileprovider",source)),0).getJSONObject(0).getString("id");engine.changed();
   assertEquals("true",js(view,"(()=>{document.querySelector('.local-actions button').click();return true})()"));
   until("Real native selection did not reach Send",()->"true".equals(js(view,"document.querySelector('.local-page')?.dataset.screen==='send' && !document.querySelector('.local-send-action button')?.disabled")),15000);
   // No nested horizontal scroller may swallow vertical drags, and the primary
   // action must stay in the fixed capsule.
   shot("send");
   assertEquals("true",js(view,"(()=>{const seg=document.querySelector('.lf-seg');const bar=document.querySelector('.lf-bar');if(!seg||!bar)return false;const s=getComputedStyle(seg);return s.overflowX!=='auto'&&s.overflowY!=='auto'&&getComputedStyle(bar).position==='fixed'})()"));
   assertEquals("true",js(view,"(()=>{document.querySelector('.local-send-action button').click();return true})()"));
   until("Send did not open the scanner page",()->"true".equals(js(view,"document.querySelector('.local-page')?.dataset.screen==='scan'")),15000);
   assertEquals("false",js(view,"Boolean(document.querySelector('.bridge-composer'))"));assertFalse(engine.snapshot().getBoolean("started"));
   // Entering the scan screen requests the platform camera permission and opens
   // the bundled scanner directly; no app-made consent card exists any more.
   until("CameraX preview never streamed",()->{AtomicBoolean streaming=new AtomicBoolean();scenario.onActivity(activity->{PreviewView p=preview(activity.getWindow().getDecorView());streaming.set(p!=null&&p.getPreviewStreamState().getValue()==PreviewView.StreamState.STREAMING);});return streaming.get();},30000);
   // Captured once the camera is live: a capture taken during the surface swap
   // returns the frame that was still on screen.
   shot("scan");
   assertEquals("true",js(view,"(()=>{const b=[...document.querySelectorAll('button')].find(b=>document.querySelector('.lf-s')&&b.classList.contains('lf-s-quiet'));if(!b)return false;b.click();return true})()"));
   // Release travels JS -> bridge -> UI thread, so give it a frame budget
   // instead of asserting synchronously on the very next statement.
   until("Camera preview survived closing it",()->{AtomicBoolean gone=new AtomicBoolean();scenario.onActivity(activity->gone.set(preview(activity.getWindow().getDecorView())==null));return gone.get();},8000);
   pressCamera(view);
   until("CameraX preview never streamed",()->{AtomicBoolean streaming=new AtomicBoolean();scenario.onActivity(activity->{PreviewView p=preview(activity.getWindow().getDecorView());streaming.set(p!=null&&p.getPreviewStreamState().getValue()==PreviewView.StreamState.STREAMING);});return streaming.get();},30000);
   JSONObject bounds=new JSONObject(new JSONArray("["+js(view,"JSON.stringify((()=>{const r=document.querySelector('.local-native-surface').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,viewport:innerWidth}})())")+"]").getString(0));
   scenario.onActivity(activity->{
    PreviewView p=preview(activity.getWindow().getDecorView());assertNotNull(p);int[]web=new int[2],nativeView=new int[2];view.getLocationOnScreen(web);p.getLocationOnScreen(nativeView);double scale=view.getWidth()/bounds.optDouble("viewport");
    assertEquals("Native preview X must align with the real DOM surface",web[0]+bounds.optDouble("x")*scale,nativeView[0],2.0);
    assertEquals("Native preview Y must not duplicate the system inset",web[1]+bounds.optDouble("y")*scale,nativeView[1],2.0);
    assertEquals(bounds.optDouble("width")*scale,p.getWidth(),2.0);assertEquals(bounds.optDouble("height")*scale,p.getHeight(),2.0);
   });
   // Arabic devices are RTL, and the native overlay used to be anchored with the
   // default START gravity: it landed on the right edge, off its plate. The same
   // rects must stay aligned when the window is mirrored.
   scenario.onActivity(activity->activity.getWindow().getDecorView().setLayoutDirection(View.LAYOUT_DIRECTION_RTL));
   assertEquals("true",js(view,"(()=>{window.dispatchEvent(new Event('resize'));return true})()"));
   Thread.sleep(600);
   scenario.onActivity(activity->{
    PreviewView p=preview(activity.getWindow().getDecorView());assertNotNull("Preview vanished under RTL",p);
    int[] web=new int[2],nativeView=new int[2];view.getLocationOnScreen(web);p.getLocationOnScreen(nativeView);double scale=view.getWidth()/bounds.optDouble("viewport");
    assertEquals("RTL must not move the native preview",web[0]+bounds.optDouble("x")*scale,nativeView[0],2.0);
    assertEquals("RTL must not move the native preview",web[1]+bounds.optDouble("y")*scale,nativeView[1],2.0);
   });
   ProcessCameraProvider provider=ProcessCameraProvider.getInstance(context).get(10,TimeUnit.SECONDS);AtomicReference<List<CameraInfo>>cameras=new AtomicReference<>();InstrumentationRegistry.getInstrumentation().runOnMainSync(()->cameras.set(provider.getAvailableCameraInfos()));
   scenario.moveToState(Lifecycle.State.CREATED);
   until("Native camera view survived activity pause",()->{AtomicBoolean removed=new AtomicBoolean();scenario.onActivity(activity->removed.set(preview(activity.getWindow().getDecorView())==null));return removed.get();},5000);
   until("Camera hardware remained open after pause",()->{AtomicBoolean closed=new AtomicBoolean(true);InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{for(CameraInfo camera:cameras.get()){CameraState state=camera.getCameraState().getValue();if(state!=null&&state.getType()!=CameraState.Type.CLOSED)closed.set(false);}});return closed.get();},15000);
   scenario.moveToState(Lifecycle.State.RESUMED);
   until("Camera reopening control stayed disabled",()->"true".equals(js(view,"(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Open camera')||b.textContent.includes('فتح الكاميرا'));return !!b&&!b.disabled})()")),15000);
   pressCamera(view);
   until("CameraX preview did not restart after resume",()->{AtomicBoolean streaming=new AtomicBoolean();scenario.onActivity(activity->{PreviewView p=preview(activity.getWindow().getDecorView());streaming.set(p!=null&&p.getPreviewStreamState().getValue()==PreviewView.StreamState.STREAMING);});return streaming.get();},30000);
  }finally{
   engine.disconnect();if(selectedId!=null)engine.files.select(selectedId,false);source.delete();context.getSharedPreferences("local-files",0).edit().putBoolean("asked",previouslyAsked).commit();
  }
 }

 /** Prepare and Receive only, photographed on the device: the two screens that
  *  must not scroll, overlap or hide their capsules behind the top blur. */
 @Test public void prepareAndReceiveScreensKeepTheAppChrome()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  LocalEngine engine=LocalTransferService.engine(context);engine.disconnect();
  try(ActivityScenario<MainActivity>scenario=ActivityScenario.launch(MainActivity.class)){
   AtomicReference<WebView>reference=new AtomicReference<>();
   scenario.onActivity(activity->reference.set(activity.getBridge().getWebView()));WebView view=reference.get();
   enterLocal(view);
   // Home carries the app's own brand capsule; child screens the app toolbar.
   // 18 is the app's top blur layer (floating-chrome.css): capsules float above it.
   assertEquals("true",js(view,"(()=>{const h=document.querySelector('header.lf-home-header');if(!h)return false;return Boolean(h.querySelector('.brand'))&&Boolean(h.querySelector('button'))&&Number(getComputedStyle(h).zIndex)>18})()"));
   // Receive goes through Prepare, exactly like the home action does.
   assertEquals("true",js(view,"(()=>{document.querySelectorAll('.local-actions button')[1].click();return true})()"));
   until("Prepare did not open",()->"true".equals(js(view,"document.querySelector('.local-page')?.dataset.screen==='setup'")),15000);
   until("Prepare never reported its indicators",()->"true".equals(js(view,"document.querySelectorAll('.lf-live,.lf-warn,.lf-ok').length>0")),20000);
   // Same toolbar capsules as History and Privacy, above the app's top blur.
   assertEquals("true",js(view,"(()=>{const t=document.querySelector('.lf-toolbar .support-title'),x=document.querySelector('.lf-toolbar .support-exit');return Boolean(t)&&Boolean(x)&&Number(getComputedStyle(t.closest('header')).zIndex)>18})()"));
   shot("prepare");
   assertEquals("true",js(view,"(()=>{const b=document.querySelector('.lf-bar .lf-big');if(!b||b.disabled)return false;b.click();return true})()"));
   until("Receive did not open",()->"true".equals(js(view,"document.querySelector('.local-page')?.dataset.screen==='receive'")),15000);
   until("Receive code surface missing",()->"true".equals(js(view,"Boolean(document.querySelector('.lf-qr'))")),15000);
   shot("receive");
   // The code plate is a fixed small square, and when the native code does appear
   // it must be exactly that square: it used to be sized to the page-filling
   // wrapper, which is why the white card grew to half the screen.
   JSONObject plate=new JSONObject(new JSONArray("["+js(view,"JSON.stringify((()=>{const r=document.querySelector('.lf-qr').getBoundingClientRect();return {width:r.width,height:r.height,viewport:innerWidth}})())")+"]").getString(0));
   assertTrue("The code plate must stay small",plate.optDouble("width")<plate.optDouble("viewport")*0.65);
   assertEquals("The code plate must be square",plate.optDouble("width"),plate.optDouble("height"),1.0);
   boolean drawn=false;
   for(long deadline=System.currentTimeMillis()+20000;System.currentTimeMillis()<deadline&&!drawn;Thread.sleep(200)){
    AtomicBoolean found=new AtomicBoolean(false);scenario.onActivity(activity->found.set(qrView(activity.getWindow().getDecorView())!=null));drawn=found.get();
   }
   if(drawn)scenario.onActivity(activity->{
    android.widget.ImageView qr=qrView(activity.getWindow().getDecorView());assertNotNull("Native code view is missing",qr);
    double scale=view.getWidth()/plate.optDouble("viewport");
    assertEquals("The code view must match the plate width",plate.optDouble("width")*scale,qr.getWidth(),4.0);
    assertEquals("The code view must match the plate height",plate.optDouble("height")*scale,qr.getHeight(),4.0);
   });
   // Static page: the code never drags, and its plate is not bigger than the code.
   assertEquals("false",js(view,"(()=>{const p=document.querySelector('.local-page');const s=getComputedStyle(p);return (s.overflowY==='auto'||s.overflowY==='scroll')||p.scrollHeight>p.clientHeight+8})()"));
   assertEquals("true",js(view,"(()=>{const q=document.querySelector('.lf-qr').getBoundingClientRect();const w=document.querySelector('.lf-qr-wrap').getBoundingClientRect();return Math.abs(q.width-q.height)<2&&q.width<=w.width+1&&q.width<innerWidth*0.8})()"));
  }finally{engine.disconnect();}
 }
}
