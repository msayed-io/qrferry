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
 @Test public void nativeEntryConsentCameraGeometryAndPauseRelease()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();boolean previouslyAsked=context.getSharedPreferences("local-files",0).getBoolean("asked",false);
  context.getSharedPreferences("local-files",0).edit().putBoolean("asked",false).commit();
  File source=new File(context.getCacheDir(),"native-camera-consent-"+System.nanoTime()+".bin");try(FileOutputStream out=new FileOutputStream(source)){out.write(new byte[]{1,2,3,4});}
  LocalEngine engine=LocalTransferService.engine(context);engine.disconnect();String selectedId=null;
  try(ActivityScenario<MainActivity>scenario=ActivityScenario.launch(MainActivity.class)){
   AtomicReference<WebView>reference=new AtomicReference<>();scenario.onActivity(activity->reference.set(activity.getBridge().getWebView()));WebView view=reference.get();
   until("Native mode entry was not rendered",()->"true".equals(js(view,"Boolean(document.querySelector('.brand-mode'))")),45000);
   assertEquals("true",js(view,"(()=>{document.querySelector('.brand-mode').click();return true})()"));
   // Permissions belong to the preparation screen and to the Android dialogs only.
   onView(withText(anyOf(is("Access to your files"),is("الوصول إلى ملفاتك")))).inRoot(isDialog()).check(doesNotExist());
   until("Native home did not mount",()->"true".equals(js(view,"document.querySelector('.local-page')?.dataset.screen==='home'")),15000);
   assertEquals("false",js(view,"Boolean(document.querySelector('.local-notice'))"));
   // The send screen must scroll and keep one fixed capsule with the primary action.
   assertEquals("true",js(view,"(()=>{const page=document.querySelector('.local-page');const bar=document.querySelector('.lf-bar');return !!page&&!!bar&&getComputedStyle(bar).position==='fixed'&&document.scrollingElement.scrollHeight>=innerHeight-1})()"));
   selectedId=engine.files.addUris(Collections.singletonList(FileProvider.getUriForFile(context,context.getPackageName()+".fileprovider",source)),0).getJSONObject(0).getString("id");engine.changed();
   assertEquals("true",js(view,"(()=>{document.querySelector('.local-actions button').click();return true})()"));
   until("Real native selection did not reach Send",()->"true".equals(js(view,"document.querySelector('.local-page')?.dataset.screen==='send' && !document.querySelector('.local-send-action button')?.disabled")),15000);
   assertEquals("true",js(view,"(()=>{document.querySelector('.local-send-action button').click();return true})()"));
   until("Send did not open the scanner page",()->"true".equals(js(view,"document.querySelector('.local-page')?.dataset.screen==='scan'")),15000);
   assertEquals("false",js(view,"Boolean(document.querySelector('.bridge-composer'))"));assertFalse(engine.snapshot().getBoolean("started"));
   // Entering the scan screen requests the platform camera permission and opens
   // the bundled scanner directly; no app-made consent card exists any more.
   until("CameraX preview never streamed",()->{AtomicBoolean streaming=new AtomicBoolean();scenario.onActivity(activity->{PreviewView p=preview(activity.getWindow().getDecorView());streaming.set(p!=null&&p.getPreviewStreamState().getValue()==PreviewView.StreamState.STREAMING);});return streaming.get();},30000);
   assertEquals("true",js(view,"(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('إغلاق')||b.textContent.includes('Close'));if(!b)return false;b.click();return true})()"));
   scenario.onActivity(activity->assertNull("Camera preview survived closing it",preview(activity.getWindow().getDecorView())));
   pressCamera(view);
   until("CameraX preview never streamed",()->{AtomicBoolean streaming=new AtomicBoolean();scenario.onActivity(activity->{PreviewView p=preview(activity.getWindow().getDecorView());streaming.set(p!=null&&p.getPreviewStreamState().getValue()==PreviewView.StreamState.STREAMING);});return streaming.get();},30000);
   JSONObject bounds=new JSONObject(new JSONArray("["+js(view,"JSON.stringify((()=>{const r=document.querySelector('.local-native-surface').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,viewport:innerWidth}})())")+"]").getString(0));
   scenario.onActivity(activity->{
    PreviewView p=preview(activity.getWindow().getDecorView());assertNotNull(p);int[]web=new int[2],nativeView=new int[2];view.getLocationOnScreen(web);p.getLocationOnScreen(nativeView);double scale=view.getWidth()/bounds.optDouble("viewport");
    assertEquals("Native preview X must align with the real DOM surface",web[0]+bounds.optDouble("x")*scale,nativeView[0],2.0);
    assertEquals("Native preview Y must not duplicate the system inset",web[1]+bounds.optDouble("y")*scale,nativeView[1],2.0);
    assertEquals(bounds.optDouble("width")*scale,p.getWidth(),2.0);assertEquals(bounds.optDouble("height")*scale,p.getHeight(),2.0);
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
}
