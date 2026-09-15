package com.bigcms.staff;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import org.junit.Test;

/** HubPin on the JVM: the same rules as parseHubLink() in shared/src/hubNetwork.ts. */
public class HubPinTest {

    // SHA-256 of the bytes "hello", standing in for a certificate's DER.
    private static final byte[] CERT = "hello".getBytes(StandardCharsets.US_ASCII);
    private static final String FP = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    private static final String HUB = "https://192.168.1.20:3443";

    @Test
    public void privateAddressesAreTheCafeNetwork() {
        assertTrue(HubPin.isPrivateIPv4("10.0.2.2"));
        assertTrue(HubPin.isPrivateIPv4("172.16.0.1"));
        assertTrue(HubPin.isPrivateIPv4("172.31.255.1"));
        assertTrue(HubPin.isPrivateIPv4("192.168.68.148"));
        assertFalse(HubPin.isPrivateIPv4("172.32.0.1"));
        assertFalse(HubPin.isPrivateIPv4("8.8.8.8"));
        assertFalse(HubPin.isPrivateIPv4("127.0.0.1"));
        assertFalse(HubPin.isPrivateIPv4("192.168.1.256"));
        assertFalse(HubPin.isPrivateIPv4("hub.example"));
    }

    @Test
    public void aHubAddressIsHttpsOnAPrivateAddressAndNothingMore() {
        assertEquals(HUB, HubPin.hubOrigin(HUB));
        assertEquals(HUB, HubPin.hubOrigin(HUB + "/"));
        assertNull("plain http", HubPin.hubOrigin("http://192.168.1.20:3443"));
        assertNull("a public address", HubPin.hubOrigin("https://81.2.69.160:3443"));
        assertNull("a path", HubPin.hubOrigin(HUB + "/steal"));
        assertNull("a login", HubPin.hubOrigin("https://staff" + "@" + "192.168.1.20:3443"));
        assertNull("a query", HubPin.hubOrigin(HUB + "/?x=1"));
        assertNull("no port", HubPin.hubOrigin("https://192.168.1.20"));
        assertNull("garbage", HubPin.hubOrigin("not an address"));
        assertNull(HubPin.hubOrigin(null));
    }

    @Test
    public void fingerprintsAreWholeSha256() {
        assertEquals(FP, HubPin.normalizeFingerprint(FP.toUpperCase()));
        assertEquals(FP, HubPin.normalizeFingerprint(FP.toUpperCase().replaceAll("(..)(?!$)", "$1:")));
        assertNull(HubPin.normalizeFingerprint("abcd"));
        assertNull(HubPin.normalizeFingerprint(FP + "00"));
        assertEquals(FP, HubPin.sha256Hex(CERT));
    }

    @Test
    public void thePairedHubsOwnCertificateIsTrustedThere() {
        assertTrue(HubPin.trusts(HUB, FP, HUB + "/pos", CERT));
        assertTrue(HubPin.trusts(HUB, FP, HUB + "/api/hub/changes", CERT));
    }

    @Test
    public void theTrapAnyOtherCertificateOrAddressIsRefused() {
        assertFalse("another certificate at the hub's address",
            HubPin.trusts(HUB, FP, HUB + "/pos", "impostor".getBytes(StandardCharsets.US_ASCII)));
        assertFalse("the hub's certificate on another machine",
            HubPin.trusts(HUB, FP, "https://192.168.1.21:3443/pos", CERT));
        assertFalse("the hub's certificate on another port", HubPin.trusts(HUB, FP, "https://192.168.1.20:4443/pos", CERT));
        assertFalse("a public site", HubPin.trusts(HUB, FP, "https://81.2.69.160:3443/pos", CERT));
        assertFalse("no hub paired", HubPin.trusts(null, null, HUB + "/pos", CERT));
        assertFalse("a malformed pin", HubPin.trusts(HUB, "abcd", HUB + "/pos", CERT));
        assertFalse("no certificate", HubPin.trusts(HUB, FP, HUB + "/pos", null));
    }

    @Test
    public void theAppsOwnRequestsTrustOnlyThePinnedCertificate() {
        assertTrue(HubPin.certificateMatches(FP, CERT));
        assertTrue(HubPin.certificateMatches(FP.toUpperCase(), CERT));
        assertFalse(HubPin.certificateMatches(FP, "impostor".getBytes(StandardCharsets.US_ASCII)));
        assertFalse(HubPin.certificateMatches("abcd", CERT));
        assertFalse(HubPin.certificateMatches(null, CERT));
        assertFalse(HubPin.certificateMatches(FP, new byte[0]));
    }

    @Test
    public void onlyThePairedHubsPagesLoadInTheApp() {
        assertTrue(HubPin.isHubPage(HUB, HUB + "/pos/kds"));
        assertFalse(HubPin.isHubPage(HUB, "https://pos.example.com/pos"));
        assertFalse(HubPin.isHubPage(HUB, "http://192.168.1.20:3443/pos"));
        assertFalse(HubPin.isHubPage(null, HUB + "/pos"));
    }
}
