package com.msayed.qrferry;

import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.Window;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/** One native owner of edge-to-edge insets. The WebView never paints under the
 * status icons; consumed insets prevent duplicate CSS/IME padding. No overlays,
 * fullscreen mode, broad permissions or third-party system-bar plugin. */
final class SystemChrome {
    static int background(Configuration config) {
        return Color.parseColor((config.uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES ? "#121014" : "#F7F4F6");
    }
    static void install(MainActivity activity) {
        Window window=activity.getWindow();
        WindowCompat.setDecorFitsSystemWindows(window,false);
        ViewCompat.setOnApplyWindowInsetsListener(window.getDecorView(),(view,insets)->{
            Insets bars=insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime=insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,ime.bottom));
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime(),Insets.NONE)
                .build();
        });
        apply(activity);
        ViewCompat.requestApplyInsets(window.getDecorView());
    }
    @SuppressWarnings("deprecation")
    static void apply(MainActivity activity) {
        Window window=activity.getWindow();
        boolean dark=(activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES;
        int background=background(activity.getResources().getConfiguration());
        window.setBackgroundDrawable(new ColorDrawable(background));
        window.getDecorView().setBackgroundColor(background);
        if(activity.getBridge()!=null)activity.getBridge().getWebView().setBackgroundColor(background);
        window.setStatusBarColor(Color.TRANSPARENT);
        // API 24/25 cannot draw dark navigation icons; keep a contrast-safe base there.
        window.setNavigationBarColor(Build.VERSION.SDK_INT<26?Color.parseColor("#241B24"):Color.TRANSPARENT);
        if(Build.VERSION.SDK_INT>=29){
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        WindowInsetsControllerCompat controller=WindowCompat.getInsetsController(window,window.getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }
}
