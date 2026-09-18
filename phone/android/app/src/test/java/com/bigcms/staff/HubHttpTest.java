package com.bigcms.staff;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.io.IOException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.security.cert.CertificateException;
import javax.net.ssl.SSLHandshakeException;
import org.junit.Test;

/**
 * HubHttp.classify(): what a failed request means, as the code the app turns
 * into words (shared/src/phoneMessages.ts, UPGRADE.md T1.18).
 */
public class HubHttpTest {

    @Test
    public void nothingAnsweringAtTheHubIsUnreachable() {
        // The 16 Sep 2026 case: a phone on mobile data, "failed to connect … after 15000ms".
        assertEquals("UNREACHABLE", HubHttp.classify(new SocketTimeoutException("failed to connect to /192.168.68.148 (port 3443)"), true));
        assertEquals("UNREACHABLE", HubHttp.classify(new ConnectException("ECONNREFUSED"), true));
        assertEquals("UNREACHABLE", HubHttp.classify(new NoRouteToHostException("no route"), true));
    }

    @Test
    public void theWrongCertificateIsTheWrongHub() {
        assertEquals("WRONG_HUB", HubHttp.classify(new SSLHandshakeException("pin"), true));
        // HttpsURLConnection wraps what went wrong: the whole chain is read.
        assertEquals("WRONG_HUB", HubHttp.classify(new IOException("wrapped", new CertificateException("Not the paired hub.")), true));
    }

    @Test
    public void anInternetRequestWithNoAnswerIsOffline() {
        assertEquals("OFFLINE", HubHttp.classify(new UnknownHostException("identitytoolkit.googleapis.com"), false));
        assertEquals("OFFLINE", HubHttp.classify(new SocketTimeoutException("timeout"), false));
    }

    @Test
    public void anythingElseKeepsItsOwnWords() {
        assertNull(HubHttp.classify(new IllegalStateException("This phone is not paired with a hub."), true));
        assertNull(HubHttp.classify(null, true));
    }
}
