package com.msayed.qrferry;

import static org.junit.Assert.*;
import android.view.View;
import android.view.MotionEvent;
import android.view.InputDevice;
import android.os.SystemClock;
import android.webkit.WebView;
import android.webkit.JavascriptInterface;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Native scroll policy plus packaged CSS, without disabling WebView input. */
@RunWith(AndroidJUnit4.class)
public class ChromePolicyTest {
 public static class Sink {
  volatile String value;
  final CountDownLatch latch=new CountDownLatch(1);
  @JavascriptInterface public void result(String json){value=json;latch.countDown();}
 }
 @Test public void indicatorsAndOverscrollAreDisabledButDocumentStillScrollsAndInputsSelect() throws Exception {
  try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
   Sink sink=new Sink();AtomicReference<WebView> ref=new AtomicReference<>();
   scenario.onActivity(activity->{
    WebView view=activity.getBridge().getWebView();ref.set(view);
    assertFalse(view.isVerticalScrollBarEnabled());assertFalse(view.isHorizontalScrollBarEnabled());
    assertEquals(View.OVER_SCROLL_NEVER,view.getOverScrollMode());
    view.addJavascriptInterface(sink,"ChromePolicySink");view.reload();
   });
   WebView view=ref.get();long deadline=System.currentTimeMillis()+45000;boolean ready=false;
   while(System.currentTimeMillis()<deadline){
    CountDownLatch checked=new CountDownLatch(1);AtomicReference<String> answer=new AtomicReference<>();
    InstrumentationRegistry.getInstrumentation().runOnMainSync(()->view.evaluateJavascript("typeof ChromePolicySink!=='undefined' && !!document.querySelector('#nav-send') && !!document.querySelector('.transfer-page h1')",v->{answer.set(v);checked.countDown();}));
    checked.await(2,TimeUnit.SECONDS);if("true".equals(answer.get())){ready=true;break;}Thread.sleep(100);
   }
   assertTrue("Packaged page did not load",ready);
   // Long-press actual glyph geometry, not the centre of a full-width heading.
   CountDownLatch measured=new CountDownLatch(1);AtomicReference<String> geometry=new AtomicReference<>();
   InstrumentationRegistry.getInstrumentation().runOnMainSync(()->view.evaluateJavascript("(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('.transfer-page h1'));const r=range.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth};})()",v->{geometry.set(v);measured.countDown();}));
   assertTrue(measured.await(5,TimeUnit.SECONDS));JSONObject point=new JSONObject(geometry.get());
   int[] screen=new int[2];AtomicReference<Integer> nativeWidth=new AtomicReference<>();
   scenario.onActivity(a->{view.getLocationOnScreen(screen);nativeWidth.set(view.getWidth());});
   float scale=nativeWidth.get()/(float)point.getDouble("width"),x=screen[0]+(float)point.getDouble("x")*scale,y=screen[1]+(float)point.getDouble("y")*scale;
   long downAt=SystemClock.uptimeMillis();
   for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){
    MotionEvent event=MotionEvent.obtain(downAt,SystemClock.uptimeMillis(),action,x,y,0);event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
    assertTrue(InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(event,true));event.recycle();
    if(action==MotionEvent.ACTION_DOWN)Thread.sleep(900);
   }
   String js="(async()=>{if(getSelection().toString().trim())throw Error('Long press selected interface text');const title=document.querySelector('h1');if(getComputedStyle(title).userSelect!=='none')throw Error('UI text selectable');"
    +"if(getComputedStyle(document.documentElement,'::-webkit-scrollbar').display!=='none')throw Error('CSS scrollbar visible');"
    +"scrollTo(0,150);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(scrollY<100)throw Error('Document no longer scrolls');"
    +"document.querySelector('#nav-pair').click();const end=Date.now()+15000;while(!document.querySelector('#bridge-paste-input')){if(Date.now()>end)throw Error('Pair not ready');await new Promise(r=>setTimeout(r,50));}"
    +"const input=document.querySelector('#bridge-paste-input');if(getComputedStyle(input).userSelect!=='text')throw Error('Editing selection disabled');input.value='native selection';input.focus();input.setSelectionRange(0,6);if(input.selectionEnd-input.selectionStart!==6)throw Error('Input selection failed');input.blur();getSelection().removeAllRanges();await new Promise(r=>requestAnimationFrame(r));return true;})().then(value=>ChromePolicySink.result(JSON.stringify({ok:value}))).catch(error=>ChromePolicySink.result(JSON.stringify({ok:false,error:String(error)})))";
   InstrumentationRegistry.getInstrumentation().runOnMainSync(()->view.evaluateJavascript(js,null));
   assertTrue("Native policy test timed out",sink.latch.await(40,TimeUnit.SECONDS));
   JSONObject result=new JSONObject(sink.value);assertTrue(result.toString(),result.getBoolean("ok"));
  }
 }
}
