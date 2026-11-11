package com.msayed.qrferry.local;

import android.graphics.*;
import android.view.*;
import android.widget.*;
import androidx.camera.core.*;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.LifecycleOwner;
import com.google.mlkit.vision.barcode.*;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Fully bundled QR-only analysis. No image or decoded credential is passed to JS. */
public final class LocalScanner implements AutoCloseable {
 public interface Result {void scanned(String raw);void failed(String code);}
 private final androidx.appcompat.app.AppCompatActivity activity;private final ExecutorService analysis=Executors.newSingleThreadExecutor();
 private final BarcodeScanner scanner=BarcodeScanning.getClient(new BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build());
 private final AtomicBoolean busy=new AtomicBoolean(),closed=new AtomicBoolean();private ProcessCameraProvider provider;private Preview preview;private ImageAnalysis analyzer;private PreviewView view;
 public LocalScanner(androidx.appcompat.app.AppCompatActivity a){activity=a;}
 public void start(FrameLayout host,Result callback){
  view=new PreviewView(activity);view.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);view.setScaleType(PreviewView.ScaleType.FILL_CENTER);host.addView(view,new FrameLayout.LayoutParams(-1,-1));
  ListenableFuture<ProcessCameraProvider> future=ProcessCameraProvider.getInstance(activity);future.addListener(()->{if(closed.get())return;try{
   provider=future.get();preview=new Preview.Builder().build();preview.setSurfaceProvider(view.getSurfaceProvider());analyzer=new ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build();
   analyzer.setAnalyzer(analysis,proxy->{if(closed.get()||!busy.compareAndSet(false,true)){proxy.close();return;}
    android.media.Image image=proxy.getImage();if(image==null){busy.set(false);proxy.close();return;}
    try{scanner.process(InputImage.fromMediaImage(image,proxy.getImageInfo().getRotationDegrees()))
     .addOnSuccessListener(analysis,codes->{if(closed.get())return;for(Barcode code:codes){String raw=code.getRawValue();if(raw!=null&&raw.startsWith("QFL1:")){try{LocalPairing.decode(raw);}catch(Exception e){continue;}activity.runOnUiThread(()->{if(!closed.get()){close();callback.scanned(raw);}});break;}}})
     .addOnFailureListener(analysis,e->{/* A decode failure is not a successful scan; the next frame may recover. */})
     .addOnCompleteListener(ContextCompat.getMainExecutor(activity),task->{proxy.close();busy.set(false);if(closed.get()){scanner.close();analysis.shutdown();}});
    }catch(Exception e){proxy.close();busy.set(false);}
   });
   provider.bindToLifecycle((LifecycleOwner)activity,CameraSelector.DEFAULT_BACK_CAMERA,preview,analyzer);
  }catch(Exception e){close();callback.failed("CAMERA_UNAVAILABLE");}},ContextCompat.getMainExecutor(activity));
 }
 @Override public void close(){if(!closed.compareAndSet(false,true))return;if(analyzer!=null)analyzer.clearAnalyzer();if(provider!=null){if(preview!=null&&analyzer!=null)provider.unbind(preview,analyzer);}if(view!=null&&view.getParent()instanceof android.view.ViewGroup)((android.view.ViewGroup)view.getParent()).removeView(view);if(!busy.get()){scanner.close();analysis.shutdown();}}
}
