package io.github.ghostbreath88.vaultatlas;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AtlasNativePlugin.class);
        super.onCreate(savedInstanceState);
        WebSettings s = bridge.getWebView().getSettings();
        // No network for the WebView (it is already blocked by the OS because INTERNET isn't granted).
        s.setBlockNetworkLoads(true);
        s.setGeolocationEnabled(false);
        s.setAllowContentAccess(false);
        s.setSaveFormData(false);
        bridge.setWebViewClient(new LocalOnlyWebViewClient(bridge));
    }
}
