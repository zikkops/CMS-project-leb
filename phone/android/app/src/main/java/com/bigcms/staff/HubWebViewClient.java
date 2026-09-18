package com.bigcms.staff;

import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.security.cert.X509Certificate;

/**
 * Capacitor's WebView client, plus the one exception to Android's certificate
 * check: the paired hub's own certificate, at the paired hub's address
 * (HubPin.trusts). Every other certificate error is refused, as before.
 */
public class HubWebViewClient extends BridgeWebViewClient {

    private final Bridge bridge;

    public HubWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    /**
     * A hub page that cannot load goes back to the app's own page, which says
     * why in words (shared/src/phoneMessages.ts), instead of leaving Chromium's
     * error page in the app (UPGRADE.md T1.19). Only the page itself: a picture
     * that fails to load is not a reason to leave the till.
     */
    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        super.onReceivedError(view, request, error);
        if (request != null && request.isForMainFrame() && isHubPage(view, request.getUrl().toString())) {
            backToApp(view, "unreachable");
        }
    }

    private boolean isHubPage(WebView view, String url) {
        String origin = HubPin.hubOrigin(HubPinPlugin.prefs(view.getContext()).getString(HubPinPlugin.ADDRESS, null));
        return origin != null && url != null && (url.equals(origin) || url.startsWith(origin + "/"));
    }

    private void backToApp(WebView view, String why) {
        view.post(() -> view.loadUrl(bridge.getLocalUrl() + "/?error=" + why));
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        String address = HubPinPlugin.prefs(view.getContext()).getString(HubPinPlugin.ADDRESS, null);
        String fingerprint = HubPinPlugin.prefs(view.getContext()).getString(HubPinPlugin.FINGERPRINT, null);
        if (HubPin.trusts(address, fingerprint, error.getUrl(), certificateDer(error.getCertificate()))) {
            handler.proceed();
        } else {
            handler.cancel();
            // The hub's address answered with another certificate: not this phone's hub.
            if (isHubPage(view, error.getUrl())) backToApp(view, "wrong_hub");
        }
    }

    private static byte[] certificateDer(SslCertificate certificate) {
        if (certificate == null) return null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                X509Certificate x509 = certificate.getX509Certificate();
                return x509 == null ? null : x509.getEncoded();
            }
            Bundle state = SslCertificate.saveState(certificate);
            return state == null ? null : state.getByteArray("x509-certificate");
        } catch (Exception e) {
            return null;
        }
    }
}
