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
public class FloatingChromeTest {
 private static String evaluate(WebView view,String code) throws Exception {
  CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->view.evaluateJavascript(code,value->{result.set(value);latch.countDown();}));
  assertTrue(latch.await(10,TimeUnit.SECONDS));return result.get();
 }
 private static void waitFor(WebView v,String condition) throws Exception {
  long end=System.currentTimeMillis()+45000;
  while(System.currentTimeMillis()<end){if("true".equals(evaluate(v,condition)))return;Thread.sleep(100);}
  fail("WebView condition timed out: "+condition);
 }
 @Test public void measuredSegmentsWorkWithoutContainerUnitsAndHeadersStayFixed() throws Exception {
  try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
   AtomicReference<WebView> ref=new AtomicReference<>();scenario.onActivity(a->ref.set(a.getBridge().getWebView()));WebView v=ref.get();
   waitFor(v,"!!document.querySelector('.qf-segmented[data-ready]') && document.querySelector('.qf-segmented').style.getPropertyValue('--lg-tab-width').endsWith('px')");
   JSONObject r=new JSONObject(evaluate(v,"(()=>{const e=document.querySelector('.qf-segmented'),w=e.getBoundingClientRect().width,t=[...e.querySelectorAll('.lg-tab')].map(x=>x.getBoundingClientRect());const saved=e.style.getPropertyValue('--lg-tab-width');e.style.setProperty('--lg-tab-width','calc(100cqw / 2)');const old=e.querySelector('.lg-tab').getBoundingClientRect().width;e.style.setProperty('--lg-tab-width',saved);return {width:w,a:t[0].width,b:t[1].width,overlap:t[0].right-t[1].left,cqw:CSS.supports('width','1cqw'),oldWidth:old,blur:getComputedStyle(document.querySelector('.progressive-blur i')).backdropFilter};})()"));
   assertTrue(r.toString(),Math.abs(r.getDouble("width")/2-r.getDouble("a"))<1);
   assertTrue(r.toString(),Math.abs(r.getDouble("a")-r.getDouble("b"))<1);
   assertTrue(r.toString(),r.getDouble("overlap")<1);
   if(!r.getBoolean("cqw")) assertTrue("Old unsupported unit must reproduce bad slot: "+r,Math.abs(r.getDouble("oldWidth")-r.getDouble("a"))>20);
   assertTrue(r.toString(),r.getString("blur").contains("blur"));
   evaluate(v,"history.pushState({},'', '/privacy');window.dispatchEvent(new PopStateEvent('popstate'));true");
   waitFor(v,"!!document.querySelector('.support-exit')");
   evaluate(v,"window.headerBefore=document.querySelector('.support-exit').getBoundingClientRect().top;window.scrollTo(0,200);true");Thread.sleep(250);
   JSONObject h=new JSONObject(evaluate(v,"(()=>{const a=document.querySelector('.support-title').getBoundingClientRect(),b=document.querySelector('.support-exit').getBoundingClientRect(),s=getComputedStyle(document.querySelector('.support-toolbar'));return {left:a.left<b.left,height:a.height,exit:b.width,delta:b.top-window.headerBefore,bg:s.backgroundColor,position:s.position,scroll:scrollY};})()"));
   assertTrue(h.toString(),h.getBoolean("left"));assertEquals(40,h.getInt("height"));assertEquals(40,h.getInt("exit"));assertEquals(0,h.getDouble("delta"),.1);assertEquals("fixed",h.getString("position"));assertEquals("rgba(0, 0, 0, 0)",h.getString("bg"));assertTrue(h.toString(),h.getDouble("scroll")>50);
  }
 }
 @Test public void shortNavigationTapNeverLiftsOriginalLens() throws Exception {
  try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
   AtomicReference<WebView> ref=new AtomicReference<>();scenario.onActivity(a->ref.set(a.getBridge().getWebView()));WebView v=ref.get();
   waitFor(v,"!!document.querySelector('.qf-tab-bar[data-ready] #nav-scan')");
   evaluate(v,"(()=>{const tab=document.querySelector('#nav-scan'),r=tab.getBoundingClientRect(),opts={bubbles:true,isPrimary:true,pointerId:41,pointerType:'touch',button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2};window.tapMax=0;window.tapDone=false;const stop=performance.now()+1200;function sample(t){window.tapMax=Math.max(window.tapMax,Number(document.querySelector('.qf-tab-bar .lg-tab-lens').style.getPropertyValue('--lg-lift')));if(t<stop)requestAnimationFrame(sample);else window.tapDone=true;}requestAnimationFrame(sample);tab.dispatchEvent(new PointerEvent('pointerdown',opts));setTimeout(()=>tab.dispatchEvent(new PointerEvent('pointerup',opts)),60);return true;})()");
   waitFor(v,"window.tapDone === true");assertEquals("0",evaluate(v,"window.tapMax"));assertEquals("true",evaluate(v,"location.pathname==='/scan' && document.querySelector('#nav-scan').getAttribute('aria-selected')==='true'"));
  }
 }
}
