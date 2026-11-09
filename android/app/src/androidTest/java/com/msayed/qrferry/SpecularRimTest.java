package com.msayed.qrferry;

import static org.junit.Assert.*;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class SpecularRimTest {
 private static String evaluate(WebView view,String code) throws Exception {
  CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->view.evaluateJavascript(code,value->{result.set(value);latch.countDown();}));
  assertTrue("WebView evaluation timed out",latch.await(10,TimeUnit.SECONDS));return result.get();
 }
 @Test public void packagedPhysicalRimHasOneEdgeNoInteriorAndCorrectIntensity() throws Exception {
  try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
   AtomicReference<WebView> ref=new AtomicReference<>();scenario.onActivity(a->ref.set(a.getBridge().getWebView()));WebView view=ref.get();
   long end=System.currentTimeMillis()+45000;boolean ready=false;
   while(System.currentTimeMillis()<end){
    if("true".equals(evaluate(view,"!!document.querySelector('.lg-tab-bar-glass > canvas') && document.querySelector('.lg-tab-bar-glass > canvas').width>1"))){ready=true;break;}
    Thread.sleep(100);
   }
   assertTrue("Packaged rim did not render",ready);
   JSONObject r=new JSONObject(evaluate(view,"(()=>{const el=document.querySelector('.lg-tab-bar-glass'),c=el.querySelector('canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;const x=Math.floor(c.width/2),at=y=>d[(y*c.width+x)*4+3];const result={top:at(0),bottom:at(c.height-1),centre:at(Math.floor(c.height/2)),background:getComputedStyle(el).backgroundImage,one:[...document.querySelectorAll('[data-qf-rim]')].every(e=>e.querySelectorAll(':scope > .qf-specular-rim').length===1),panels:document.querySelectorAll('.card > .qf-specular-rim,.lg-menu-surface > .qf-specular-rim').length};document.documentElement.style.setProperty('--rim','0');result.off=getComputedStyle(c).opacity;document.documentElement.style.removeProperty('--rim');return result;})()"));
   assertTrue(r.toString(),Math.abs(r.getInt("top")-33)<=1);assertTrue(r.toString(),Math.abs(r.getInt("bottom")-24)<=1);
   assertEquals(0,r.getInt("centre"));assertEquals("none",r.getString("background"));assertTrue(r.getBoolean("one"));assertEquals(0,r.getInt("panels"));assertEquals("0",r.getString("off"));
  }
 }
}
