package com.msayed.qrferry;
import android.os.Bundle;
import android.content.res.Configuration;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(QRFerryDevicePlugin.class);
        registerPlugin(com.msayed.qrferry.local.LocalTransferPlugin.class);
        super.onCreate(state);
        SystemChrome.install(this);
        if(getBridge()!=null){
            android.webkit.WebView view=getBridge().getWebView();
            view.setVerticalScrollBarEnabled(false);
            view.setHorizontalScrollBarEnabled(false);
            view.setOverScrollMode(android.view.View.OVER_SCROLL_NEVER);
        }
    }
    @Override public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        SystemChrome.apply(this);
    }
    @Override public void onResume() {
        super.onResume();
        SystemChrome.apply(this);
    }
}
