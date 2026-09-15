package com.bigcms.staff;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Which certificate this phone trusts — POS software, stage 5 (owner's decision
 * S11, 15 Sep 2026).
 *
 * The café hub's certificate is its own, so no authority vouches for it and
 * Android refuses it like any other unknown certificate. The app trusts
 * exactly one: the one whose SHA-256 fingerprint the counter screen's QR gave
 * it, at exactly the address that QR named. Another machine on the café wifi
 * answering at that address with any other certificate is refused.
 *
 * Plain Java with no Android in it, so HubPinTest runs it on the JVM. The same
 * rules as parseHubLink() in shared/src/hubNetwork.ts.
 */
public final class HubPin {

    private HubPin() {}

    private static final Pattern IPV4 = Pattern.compile("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$");
    private static final Pattern HEX64 = Pattern.compile("^[0-9a-f]{64}$");

    /** An address on a private network: 10/8, 172.16/12 or 192.168/16. */
    public static boolean isPrivateIPv4(String ip) {
        if (ip == null) return false;
        Matcher m = IPV4.matcher(ip);
        if (!m.matches()) return false;
        int[] n = new int[4];
        for (int i = 0; i < 4; i++) {
            n[i] = Integer.parseInt(m.group(i + 1));
            if (n[i] > 255) return false;
        }
        return n[0] == 10 || (n[0] == 172 && n[1] >= 16 && n[1] <= 31) || (n[0] == 192 && n[1] == 168);
    }

    /** 64 lower-case hex digits, from `AB:CD:…` or plain hex; null when it is not a SHA-256 fingerprint. */
    public static String normalizeFingerprint(String raw) {
        if (raw == null) return null;
        String hex = raw.replace(":", "").toLowerCase(Locale.ROOT);
        return HEX64.matcher(hex).matches() ? hex : null;
    }

    /**
     * `https://<private address>:<port>` for a hub address, or null: https only,
     * a private IPv4 address, an explicit port, and no login, path, query or
     * fragment.
     */
    public static String hubOrigin(String address) {
        if (address == null) return null;
        URI uri;
        try {
            uri = new URI(address);
        } catch (Exception e) {
            return null;
        }
        if (!"https".equals(uri.getScheme()) || !isPrivateIPv4(uri.getHost())) return null;
        if (uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) return null;
        String path = uri.getRawPath();
        if (path != null && !path.isEmpty() && !path.equals("/")) return null;
        int port = uri.getPort();
        if (port < 1 || port > 65535) return null;
        return "https://" + uri.getHost() + ":" + port;
    }

    /** The origin a page or request was loaded from, with its port written out; null for anything but https. */
    public static String originOf(String url) {
        if (url == null) return null;
        try {
            URI uri = new URI(url);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null) return null;
            int port = uri.getPort() == -1 ? 443 : uri.getPort();
            return "https://" + uri.getHost() + ":" + port;
        } catch (Exception e) {
            return null;
        }
    }

    public static String sha256Hex(byte[] bytes) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder out = new StringBuilder(64);
            for (byte b : digest) out.append(String.format(Locale.ROOT, "%02x", b & 0xff));
            return out.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * Whether a certificate Android refused may be trusted after all: only at
     * the paired hub's exact origin, and only if it is the pinned certificate.
     * With no hub paired, nothing is.
     */
    public static boolean trusts(String pinnedAddress, String pinnedFingerprint, String url, byte[] certificateDer) {
        String pinnedOrigin = hubOrigin(pinnedAddress);
        String fingerprint = normalizeFingerprint(pinnedFingerprint);
        if (pinnedOrigin == null || fingerprint == null || certificateDer == null || certificateDer.length == 0) return false;
        if (!pinnedOrigin.equals(originOf(url))) return false;
        return MessageDigest.isEqual(
            fingerprint.getBytes(StandardCharsets.US_ASCII),
            sha256Hex(certificateDer).getBytes(StandardCharsets.US_ASCII)
        );
    }

    /** Whether the app should load this address itself rather than hand it to another app: the paired hub's pages only. */
    public static boolean isHubPage(String pinnedAddress, String url) {
        String pinnedOrigin = hubOrigin(pinnedAddress);
        return pinnedOrigin != null && pinnedOrigin.equals(originOf(url));
    }
}
