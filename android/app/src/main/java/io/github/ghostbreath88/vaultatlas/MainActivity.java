package io.github.ghostbreath88.vaultatlas;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AtlasNativePlugin.class);
        super.onCreate(savedInstanceState);
        // Release builds: no remote WebView inspection (debug/test builds keep it for automated tests).
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0) WebView.setWebContentsDebuggingEnabled(false);
        WebSettings s = bridge.getWebView().getSettings();
        // No network for the WebView (it is already blocked by the OS because INTERNET isn't granted).
        s.setBlockNetworkLoads(true);
        s.setGeolocationEnabled(false);
        s.setAllowContentAccess(false);
        s.setSaveFormData(false);
        bridge.setWebViewClient(new LocalOnlyWebViewClient(bridge));
    }
}
