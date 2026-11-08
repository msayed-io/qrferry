package com.msayed.qrferry;

import static org.junit.Assert.*;
import android.app.LocaleManager;
import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import android.os.LocaleList;
import android.os.ParcelFileDescriptor;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Runs in a real Android WebView on the CI emulator, not a mocked Capacitor bridge.
 * This does NOT qualify physical camera, SAF vendor UI or background delivery. */
@RunWith(AndroidJUnit4.class)
public class NativeIntegrationTest {
    public static class Sink {
        volatile CountDownLatch latch;
        volatile String result;
        @JavascriptInterface public void result(String value){result=value;CountDownLatch current=latch;if(current!=null)current.countDown();}
    }
    private static String evaluate(WebView view,Sink sink,String body) throws Exception {
        sink.result=null;sink.latch=new CountDownLatch(1);
        String source="(async()=>{"+body+"})().then(value=>NativeTestSink.result(JSON.stringify({ok:true,value}))).catch(error=>NativeTestSink.result(JSON.stringify({ok:false,error:String(error)})))";
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->view.evaluateJavascript(source,null));
        assertTrue("JavaScript/native bridge timed out",sink.latch.await(60,TimeUnit.SECONDS));
        JSONObject response=new JSONObject(sink.result);assertTrue(response.toString(),response.getBoolean("ok"));
        return response.get("value").toString();
    }
    private static final String READY="const until=Date.now()+30000;while(!document.querySelector('#root main')){if(Date.now()>until)throw Error('App did not render');await new Promise(r=>setTimeout(r,50));}";
    private static WebView install(ActivityScenario<MainActivity> scenario,Sink sink) throws Exception {
        AtomicReference<WebView> result=new AtomicReference<>();
        scenario.onActivity(activity->{WebView view=activity.getBridge().getWebView();view.addJavascriptInterface(sink,"NativeTestSink");view.reload();result.set(view);});
        WebView view=result.get();
        // addJavascriptInterface is visible only after the reload completes. Do not
        // start async test code in the old JavaScript context being destroyed.
        long deadline=System.currentTimeMillis()+45000;
        while(System.currentTimeMillis()<deadline){
            CountDownLatch checked=new CountDownLatch(1);AtomicReference<String> ready=new AtomicReference<>();
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->view.evaluateJavascript(
                "typeof NativeTestSink !== 'undefined' && document.readyState !== 'loading' && Boolean(document.querySelector('#root main'))",
                value->{ready.set(value);checked.countDown();}));
            checked.await(2,TimeUnit.SECONDS);
            if("true".equals(ready.get()))return view;
            Thread.sleep(100);
        }
        throw new AssertionError("Reloaded WebView/test interface did not become ready");
    }
    @Test public void packagedWorkerDecodesQrAndRecoversTransferredBytes() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.msayed.qrferry",context.getPackageName());
        String worker=null;
        for(String name:context.getAssets().list("public/assets"))if(name.startsWith("scan.worker-")&&name.endsWith(".js"))worker="/assets/"+name;
        assertNotNull("Decoder worker missing from packaged APK",worker);
        String fixture;
        try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("decoder-fixture.json")){
            fixture=new String(input.readAllBytes(),StandardCharsets.UTF_8);
        }
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            Sink sink=new Sink();WebView view=install(scenario,sink);
            String body=READY+"const fixture="+fixture+";const worker=new Worker("+JSONObject.quote(worker)+",{type:'module'});let id=0;"
                +"const ask=(request,transfer=[])=>new Promise((resolve,reject)=>{const current=++id;worker.onmessage=e=>{if(e.data.id===current)e.data.ok?resolve(e.data.result):reject(Error(e.data.error));};worker.onerror=e=>reject(Error(e.message));worker.postMessage({...request,id:current},transfer);});"
                +"let detached=true,complete=false;for(const frame of fixture.frames){const scale=5,width=(frame.n+8)*scale;const pixels=new Uint8ClampedArray(width*width*4).fill(255);const modules=atob(frame.data);"
                +"for(let y=0;y<frame.n;y++)for(let x=0;x<frame.n;x++)if(modules.charCodeAt(y*frame.n+x))for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const offset=(((y+4)*scale+dy)*width+(x+4)*scale+dx)*4;pixels[offset]=pixels[offset+1]=pixels[offset+2]=0;}"
                +"const promise=ask({type:'scan',pixels:pixels.buffer,width,height:width,robust:true,count:1,rawOnly:false,purpose:'qr'},[pixels.buffer]);detached=detached&&pixels.byteLength===0;const result=await promise;if(result.snapshot.complete){complete=true;break;}}"
                +"if(!complete||!detached)throw Error('Recovery or ownership transfer failed');const recovered=await ask({type:'recover'});worker.terminate();if(new TextDecoder().decode(recovered.files[0].bytes)!==fixture.original)throw Error('Recovered bytes differ');return recovered.files[0].name;";
            assertEquals("native-worker.txt",evaluate(view,sink,body));
        }
    }
    @Test public void sharedContentUriReadsRealChunksAtNonzeroOffsets() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        File file=new File(context.getCacheDir(),"native-share-test.bin");
        byte[] bytes=new byte[400123];long expectedSum=0;
        for(int i=0;i<bytes.length;i++){bytes[i]=(byte)((i*73+19)&255);expectedSum+=bytes[i]&255;}
        try(FileOutputStream output=new FileOutputStream(file)){output.write(bytes);}
        Uri uri=FileProvider.getUriForFile(context,context.getPackageName()+".fileprovider",file);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            Sink sink=new Sink();WebView view=install(scenario,sink);
            // Isolate native chunk I/O from the UI consumer, without mocking the bridge/provider.
            evaluate(view,sink,READY+"await Capacitor.nativePromise('QRFerryDevice','removeAllListeners',{});return true;");
            Intent intent=new Intent(context,MainActivity.class).setAction(Intent.ACTION_SEND)
                .setType("application/octet-stream").putExtra(Intent.EXTRA_STREAM,uri)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_GRANT_READ_URI_PERMISSION);
            context.startActivity(intent);
            String value=evaluate(view,sink,"const deadline=Date.now()+15000;let files=[];while(!files.length){files=(await Capacitor.nativePromise('QRFerryDevice','getSharedFiles',{})).files;if(Date.now()>deadline)throw Error('Share intent not delivered');if(!files.length)await new Promise(r=>setTimeout(r,50));}"
                +"const file=files[0];let offset=0,sum=0,calls=0;while(true){const result=await Capacitor.nativePromise('QRFerryDevice','readSharedChunk',{id:file.id,offset,length:196608});const data=atob(result.data);calls++;if(!data.length)break;for(let i=0;i<data.length;i++)sum+=data.charCodeAt(i);offset+=data.length;if(offset>file.size)throw Error('Repeated or excess chunk');}"
                +"await Capacitor.nativePromise('QRFerryDevice','clearSharedFiles',{ids:[file.id]});return {size:offset,sum,calls};");
            JSONObject result=new JSONObject(value);assertEquals(bytes.length,result.getLong("size"));assertEquals(expectedSum,result.getLong("sum"));assertEquals(4,result.getInt("calls"));
            scenario.onActivity(activity->{
                assertNotNull("Clearing a share must preserve activity launch metadata",activity.getIntent().getComponent());
                assertEquals(MainActivity.class.getName(),activity.getIntent().getComponent().getClassName());
            });
        }finally{file.delete();}
    }
    private static void night(String value) throws Exception {
        ParcelFileDescriptor descriptor=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("cmd uimode night "+value);
        try(InputStream stream=new ParcelFileDescriptor.AutoCloseInputStream(descriptor)){stream.readAllBytes();}
    }
    @Test public void androidConfigurationUpdatesWebThemeAndLanguageWhileRunning() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        LocaleManager locales=context.getSystemService(LocaleManager.class);
        UiModeManager mode=context.getSystemService(UiModeManager.class);
        String previousLocales=locales.getApplicationLocales().toLanguageTags();int previousNight=mode.getNightMode();
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            Sink sink=new Sink();WebView view=install(scenario,sink);
            assertEquals("true",evaluate(view,sink,READY+"const p=await Capacitor.nativePromise('QRFerryDevice','getPreferences',{});return Array.isArray(p.languages)&&typeof p.dark==='boolean';"));
            night("yes");
            assertEquals("dark",evaluate(view,sink,"const end=Date.now()+15000;while(document.documentElement.dataset.theme!=='dark'){if(Date.now()>end)throw Error('Native theme did not update');await new Promise(r=>setTimeout(r,50));}return document.documentElement.dataset.theme;"));
            locales.setApplicationLocales(LocaleList.forLanguageTags("ar-EG"));
            assertEquals("ar:rtl",evaluate(view,sink,"const end=Date.now()+15000;while(document.documentElement.lang!=='ar'){if(Date.now()>end)throw Error('Native locale did not update');await new Promise(r=>setTimeout(r,50));}return document.documentElement.lang+':'+document.documentElement.dir;"));
            locales.setApplicationLocales(LocaleList.forLanguageTags("en-US"));
            assertEquals("en:ltr",evaluate(view,sink,"const end=Date.now()+15000;while(document.documentElement.lang!=='en'){if(Date.now()>end)throw Error('Native locale did not update');await new Promise(r=>setTimeout(r,50));}return document.documentElement.lang+':'+document.documentElement.dir;"));
        }finally{locales.setApplicationLocales(LocaleList.forLanguageTags(previousLocales));night(previousNight==UiModeManager.MODE_NIGHT_YES?"yes":previousNight==UiModeManager.MODE_NIGHT_NO?"no":"auto");}
    }
}
