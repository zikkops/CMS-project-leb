package com.bigcms.staff;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * The app's own requests, made natively rather than from its page.
 *
 * To the hub: the pinned certificate and nothing else (HubPin), the same trust
 * the WebView gives it. To Firebase and the cloud: ordinary https, checked by
 * Android as any app's is. Native, so no browser's cross-origin rules stand
 * between the app's page and three different addresses.
 */
final class HubHttp {

    private HubHttp() {}

    static final class Reply {
        final int status;
        final String body;
        Reply(int status, String body) { this.status = status; this.body = body; }
    }

    /** How long to wait for a reply once connected. */
    private static final int TIMEOUT_MS = 15_000;
    /**
     * How long to wait for a connection. A hub on the café wifi answers in
     * milliseconds; five seconds of nothing means it is not there (another
     * network, mobile data, the PC off), and fifteen was a long time to say so.
     */
    private static final int CONNECT_TIMEOUT_MS = 5_000;

    /**
     * What a failed request means, as a code the app turns into words
     * (shared/src/phoneMessages.ts): UNREACHABLE when nothing answered at the
     * hub's address, WRONG_HUB when something answered without the pinned
     * certificate, OFFLINE when an internet request got no answer, and null
     * when it is none of those. The whole cause chain is looked at, because
     * HttpsURLConnection wraps what went wrong.
     */
    static String classify(Throwable error, boolean toHub) {
        for (Throwable e = error; e != null; e = e.getCause()) {
            if (e instanceof javax.net.ssl.SSLHandshakeException || e instanceof javax.net.ssl.SSLPeerUnverifiedException
                || e instanceof java.security.cert.CertificateException) {
                return toHub ? "WRONG_HUB" : "OFFLINE";
            }
            if (e instanceof java.net.ConnectException || e instanceof java.net.SocketTimeoutException
                || e instanceof java.net.NoRouteToHostException || e instanceof java.net.UnknownHostException
                || e instanceof java.net.PortUnreachableException) {
                return toHub ? "UNREACHABLE" : "OFFLINE";
            }
            if (e.getCause() == e) break;
        }
        return null;
    }

    /** A request to the paired hub, trusting only its pinned certificate. */
    static Reply hub(String address, String fingerprint, String method, String path, String json) throws Exception {
        String origin = HubPin.hubOrigin(address);
        String pin = HubPin.normalizeFingerprint(fingerprint);
        if (origin == null || pin == null) throw new IllegalStateException("This phone is not paired with a hub.");
        if (path == null || !path.startsWith("/api/hub/")) throw new IllegalArgumentException("Not a hub request.");

        TrustManager pinned = new X509TrustManager() {
            @Override public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                throw new CertificateException("Not a server.");
            }
            @Override public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                if (chain == null || chain.length == 0 || !HubPin.certificateMatches(pin, chain[0].getEncoded())) {
                    throw new CertificateException("Not this hub's certificate.");
                }
            }
            @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
        };
        SSLContext tls = SSLContext.getInstance("TLS");
        tls.init(null, new TrustManager[] { pinned }, null);

        HttpsURLConnection conn = (HttpsURLConnection) new URL(origin + path).openConnection();
        conn.setSSLSocketFactory(tls.getSocketFactory());
        // The certificate is the hub's identity, checked above; it names no address.
        String host = URI.create(origin).getHost();
        conn.setHostnameVerifier((hostname, session) -> host.equals(hostname));
        return send(conn, method, json, null);
    }

    /** An ordinary https request: Firebase's sign-in, or the cloud's /api/staff-keys. */
    static Reply web(String url, String method, String json, String bearer) throws Exception {
        URI uri = URI.create(url);
        if (!"https".equals(uri.getScheme()) || uri.getRawUserInfo() != null) throw new IllegalArgumentException("Only https.");
        HttpsURLConnection conn = (HttpsURLConnection) uri.toURL().openConnection();
        return send(conn, method, json, bearer);
    }

    private static Reply send(HttpsURLConnection conn, String method, String json, String bearer) throws Exception {
        try {
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            conn.setRequestMethod(method);
            conn.setRequestProperty("Accept", "application/json");
            if (bearer != null) conn.setRequestProperty("Authorization", "Bearer " + bearer);
            if (json != null) {
                byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = conn.getOutputStream()) { out.write(bytes); }
            }
            int status = conn.getResponseCode();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            return new Reply(status, in == null ? "" : readAll(in));
        } finally {
            conn.disconnect();
        }
    }

    private static String readAll(InputStream in) throws Exception {
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            int total = 0;
            while ((n = stream.read(buf)) != -1) {
                total += n;
                if (total > 1_000_000) throw new IllegalStateException("The reply was too large.");
                out.write(buf, 0, n);
            }
            return out.toString("UTF-8");
        }
    }
}
