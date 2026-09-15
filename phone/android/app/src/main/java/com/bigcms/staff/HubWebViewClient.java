package com.bigcms.staff;

import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.webkit.SslErrorHandler;
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

    public HubWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        String address = HubPinPlugin.prefs(view.getContext()).getString(HubPinPlugin.ADDRESS, null);
        String fingerprint = HubPinPlugin.prefs(view.getContext()).getString(HubPinPlugin.FINGERPRINT, null);
        if (HubPin.trusts(address, fingerprint, error.getUrl(), certificateDer(error.getCertificate()))) {
            handler.proceed();
        } else {
            handler.cancel();
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
