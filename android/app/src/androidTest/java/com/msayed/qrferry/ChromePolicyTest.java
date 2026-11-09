package com.msayed.qrferry;

import static org.junit.Assert.*;
import android.view.View;
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
    InstrumentationRegistry.getInstrumentation().runOnMainSync(()->view.evaluateJavascript("typeof ChromePolicySink!=='undefined' && !!document.querySelector('#nav-send')",v->{answer.set(v);checked.countDown();}));
    checked.await(2,TimeUnit.SECONDS);if("true".equals(answer.get())){ready=true;break;}Thread.sleep(100);
   }
   assertTrue("Packaged page did not load",ready);
   String js="(async()=>{const title=document.querySelector('h1');if(getComputedStyle(title).userSelect!=='none')throw Error('UI text selectable');"
    +"if(getComputedStyle(document.documentElement,'::-webkit-scrollbar').display!=='none')throw Error('CSS scrollbar visible');"
    +"scrollTo(0,150);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(scrollY<100)throw Error('Document no longer scrolls');"
    +"document.querySelector('#nav-pair').click();const end=Date.now()+15000;while(!document.querySelector('#bridge-paste-input')){if(Date.now()>end)throw Error('Pair not ready');await new Promise(r=>setTimeout(r,50));}"
    +"const input=document.querySelector('#bridge-paste-input');if(getComputedStyle(input).userSelect!=='text')throw Error('Editing selection disabled');input.value='native selection';input.focus();input.setSelectionRange(0,6);if(input.selectionEnd-input.selectionStart!==6)throw Error('Input selection failed');return true;})().then(value=>ChromePolicySink.result(JSON.stringify({ok:value}))).catch(error=>ChromePolicySink.result(JSON.stringify({ok:false,error:String(error)})))";
   InstrumentationRegistry.getInstrumentation().runOnMainSync(()->view.evaluateJavascript(js,null));
   assertTrue("Native policy test timed out",sink.latch.await(40,TimeUnit.SECONDS));
   JSONObject result=new JSONObject(sink.value);assertTrue(result.toString(),result.getBoolean("ok"));
  }
 }
}
