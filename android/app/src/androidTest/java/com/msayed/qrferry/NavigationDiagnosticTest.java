package com.msayed.qrferry;
import static org.junit.Assert.*;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.webkit.WebView;
import android.webkit.JavascriptInterface;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Diagnostic branch only: native input replay + actual RAF/geometry telemetry.
 * No reported timings are invented, no route is changed to simulate a drag. */
@RunWith(AndroidJUnit4.class)
public class NavigationDiagnosticTest {
 public static class Sink {
  volatile CountDownLatch latch;volatile String result;
  @JavascriptInterface public void result(String value){result=value;if(latch!=null)latch.countDown();}
 }
 private static String evaluate(WebView view,Sink sink,String body)throws Exception{
  sink.latch=new CountDownLatch(1);sink.result=null;
  String code="(async()=>{"+body+"})().then(value=>NavSink.result(JSON.stringify({ok:true,value}))).catch(error=>NavSink.result(JSON.stringify({ok:false,error:String(error)})))";
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->view.evaluateJavascript(code,null));
  assertTrue("JS timed out",sink.latch.await(45,TimeUnit.SECONDS));JSONObject r=new JSONObject(sink.result);assertTrue(r.toString(),r.getBoolean("ok"));return r.get("value").toString();
 }
 private static void ready(WebView view)throws Exception{
  long until=SystemClock.uptimeMillis()+45000;
  while(SystemClock.uptimeMillis()<until){
   CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();
   InstrumentationRegistry.getInstrumentation().runOnMainSync(()->view.evaluateJavascript("typeof NavSink!=='undefined' && !!document.querySelector('.lg-tab-bar[data-ready]')",r->{value.set(r);latch.countDown();}));latch.await(2,TimeUnit.SECONDS);if("true".equals(value.get()))return;Thread.sleep(100);
  }throw new AssertionError("Navigation did not become ready");
 }
 private static void event(long start,int action,float x,float y){
  MotionEvent event=MotionEvent.obtain(start,SystemClock.uptimeMillis(),action,x,y,0);event.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);assertTrue("Input injection failed",InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(event,false));event.recycle();
 }
 @Test public void compareNativeInputWithUnmodifiedUpstream()throws Exception{
  File dir=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir(null),"nav-diagnostic");dir.mkdirs();
  for(String variant:new String[]{"product-light","reference-light","product-dark","reference-dark","product-light-warm","product-light-no-paint","reference-light-no-paint","product-light-no-foreground","product-light-no-backdrop","product-light-no-rim","product-light-uncontained","product-light-stable-id"}){
   try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
    Sink sink=new Sink();AtomicReference<WebView> ref=new AtomicReference<>();
    scenario.onActivity(a->{WebView v=a.getBridge().getWebView();v.addJavascriptInterface(sink,"NavSink");v.loadUrl(variant.startsWith("reference")?"https://localhost/reference/index.html":"https://localhost/");ref.set(v);});
    WebView view=ref.get();ready(view);
    evaluate(view,sink,"document.documentElement.dataset.theme='"+(variant.contains("dark")?"dark":"light")+"';return true;");
    Thread.sleep(500);
    if(variant.endsWith("no-paint"))evaluate(view,sink,"const style=document.createElement('style');style.textContent='.lg-tab-labels{filter:none!important}.lg-glass{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;background-image:none!important}';document.head.append(style);return true;");
    if(variant.endsWith("stable-id"))evaluate(view,sink,"document.documentElement.dataset.diagnosticStableFilter='1';return true;");
    String css=variant.endsWith("no-foreground")?".lg-tab-labels{filter:none!important}":variant.endsWith("no-backdrop")?".lg-glass{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}":variant.endsWith("no-rim")?".lg-glass{background-image:none!important}":variant.endsWith("uncontained")?".qf-tab-bar{contain:none;isolation:auto}":"";
    if(!css.isEmpty())evaluate(view,sink,"const style=document.createElement('style');style.textContent="+JSONObject.quote(css)+";document.head.append(style);return true;");
    if(variant.endsWith("warm")){
     evaluate(view,sink,"const bar=document.querySelector('.lg-tab-bar'),tab=bar.querySelector('.lg-tab'),r=tab.getBoundingClientRect();tab.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,isPrimary:true,button:0,pointerId:999,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));await new Promise(r=>setTimeout(r,1000));window.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,isPrimary:true,pointerId:999}));return true;");Thread.sleep(500);
    }
    String setup="window.navTrace={ua:navigator.userAgent,dpr:devicePixelRatio,width:innerWidth,events:[],frames:[],longTasks:[],handlers:[]};window.navLive=true;new PerformanceObserver(list=>navTrace.longTasks.push(...list.getEntries().map(e=>({t:e.startTime,duration:e.duration})))).observe({entryTypes:['longtask']});"
     +"for(const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture'])document.addEventListener(type,e=>navTrace.events.push({type,t:performance.now(),eventTime:e.timeStamp,x:e.clientX,y:e.clientY,id:e.pointerId,primary:e.isPrimary,button:e.button,buttons:e.buttons,pointerType:e.pointerType,target:String(e.target.className)}),true);"
     +"for(const type of ['pointerdown','pointermove','pointerup'])window.addEventListener(type,e=>navTrace.handlers.push({type,t:performance.now()}));"
     +"function frame(t){const bar=document.querySelector('.lg-tab-bar'),lens=bar.querySelector('.lg-tab-lens'),r=lens.getBoundingClientRect();navTrace.frames.push({t,x:r.x,y:r.y,w:r.width,h:r.height,transform:lens.style.transform,lift:lens.style.getPropertyValue('--lg-lift'),path:location.pathname,scroll:scrollY});if(navLive)requestAnimationFrame(frame)}requestAnimationFrame(frame);"
     +"const tabs=document.querySelectorAll('.lg-tab-bar>.lg-tab-labels:not(.lg-tab-lensed)>.lg-tab');return {width:innerWidth,from:tabs[tabs.length-1].getBoundingClientRect().toJSON(),to:tabs[0].getBoundingClientRect().toJSON()};";
    JSONObject geometry=new JSONObject(evaluate(view,sink,setup));JSONObject from=geometry.getJSONObject("from"),to=geometry.getJSONObject("to");
    int[] screen=new int[2];AtomicReference<Integer> width=new AtomicReference<>();scenario.onActivity(a->{view.getLocationOnScreen(screen);width.set(view.getWidth());});
    float scale=width.get()/(float)geometry.getDouble("width"),x=screen[0]+(float)(from.getDouble("x")+from.getDouble("width")/2)*scale,y=screen[1]+(float)(from.getDouble("y")+from.getDouble("height")/2)*scale;
    float end=screen[0]+(float)(to.getDouble("x")+to.getDouble("width")/2)*scale;
    long start=SystemClock.uptimeMillis();event(start,MotionEvent.ACTION_DOWN,x,y);Thread.sleep(350);
    for(int i=1;i<=24;i++){event(start,MotionEvent.ACTION_MOVE,x+(end-x)*i/24,y);Thread.sleep(30);}
    Thread.sleep(350);for(int i=1;i<=24;i++){event(start,MotionEvent.ACTION_MOVE,end+(x-end)*i/24,y);Thread.sleep(30);}
    Thread.sleep(350);event(start,MotionEvent.ACTION_UP,x,y);Thread.sleep(1000);
    String result=evaluate(view,sink,"const end=Date.now()+8000;while(!navTrace.events.some(e=>e.type==='pointerup')){if(Date.now()>end)throw Error('Input did not finish');await new Promise(r=>setTimeout(r,50));}window.navLive=false;return window.navTrace;");
    try(FileOutputStream output=new FileOutputStream(new File(dir,variant+".json"))){output.write(result.getBytes(StandardCharsets.UTF_8));}
    android.graphics.Bitmap shot=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();try(FileOutputStream output=new FileOutputStream(new File(dir,variant+".png"))){shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output);}shot.recycle();
   }
  }
 }
}
