package com.msayed.qrferry;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(QRFerryDevicePlugin.class);
        super.onCreate(state);
    }
}
