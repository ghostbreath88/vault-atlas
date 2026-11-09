package io.github.ghostbreath88.vaultatlas;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Second layer of network blocking (the first is the missing INTERNET permission).
 * Every sub-resource request that is not for the app's own bundled files (https://localhost/...)
 * is answered locally with an empty 403 and never reaches the network stack.
 */
public class LocalOnlyWebViewClient extends BridgeWebViewClient {
    static final AtomicInteger blocked = new AtomicInteger();
    private final String localHost;

    public LocalOnlyWebViewClient(Bridge bridge) {
        super(bridge);
        this.localHost = Uri.parse(bridge.getLocalUrl()).getHost();
    }

    static boolean isLocal(Uri u, String localHost) {
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
        if (scheme.equals("blob") || scheme.equals("data") || scheme.equals("about")) return true;
        return (scheme.equals("https") || scheme.equals("http")) && localHost != null && localHost.equalsIgnoreCase(u.getHost());
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri u = request.getUrl();
        if (isLocal(u, localHost)) return super.shouldInterceptRequest(view, request);
        blocked.incrementAndGet();
        HashMap<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked by Vault Atlas", h, new ByteArrayInputStream(new byte[0]));
    }
}
