package com.bigcms.staff;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.spec.ECGenParameterSpec;

/**
 * This phone's sign-in key — POS software, stage 5 (owner's decisions S12–S13).
 *
 * A P-256 key pair made inside Android's Keystore. The private key never leaves
 * it, and Android will only use it right after a strong biometric check: a
 * fingerprint, or a face unlock Android classes as strong. Never the phone's
 * PIN (S12). Adding a new fingerprint to the phone invalidates the key, so
 * somebody who learns the phone's PIN cannot enrol their own finger and sign in.
 */
final class HubKeys {

    private HubKeys() {}

    static final String ALIAS = "bigcms-staff-sign-in";

    private static KeyStore store() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        return ks;
    }

    /** The public key as base64 SPKI, which is what the cloud registers, or null when there is no key. */
    static String publicKey() throws Exception {
        Certificate cert = store().getCertificate(ALIAS);
        return cert == null ? null : Base64.encodeToString(cert.getPublicKey().getEncoded(), Base64.NO_WRAP);
    }

    /**
     * The key's certificate chain as base64 DER, first certificate first. The
     * first carries Android's attestation: where the key lives and what unlocks
     * it, signed by the secure hardware and chained to Google (S20).
     */
    static String[] chain() throws Exception {
        Certificate[] certs = store().getCertificateChain(ALIAS);
        if (certs == null) return new String[0];
        String[] out = new String[certs.length];
        for (int i = 0; i < certs.length; i++) out[i] = Base64.encodeToString(certs[i].getEncoded(), Base64.NO_WRAP);
        return out;
    }

    /**
     * Makes the key, replacing any earlier one, with the cloud's registration
     * challenge written into its attestation. Returns its public key.
     */
    static String create(byte[] attestationChallenge) throws Exception {
        delete();
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setAttestationChallenge(attestationChallenge)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Every use needs its own strong biometric check, never a device credential.
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        } else {
            // Before Android 11, -1 is the same rule: a biometric check for each use.
            spec.setUserAuthenticationValidityDurationSeconds(-1);
        }
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
        generator.initialize(spec.build());
        generator.generateKeyPair();
        return publicKey();
    }

    static void delete() throws Exception {
        KeyStore ks = store();
        if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
    }

    /**
     * A signature ready to be unlocked by the biometric prompt. Throws
     * KeyPermanentlyInvalidatedException when a fingerprint was added since the
     * key was made.
     */
    static Signature signer() throws Exception {
        PrivateKey key = (PrivateKey) store().getKey(ALIAS, null);
        if (key == null) throw new IllegalStateException("This phone has no sign-in key yet.");
        Signature signature = Signature.getInstance("SHA256withECDSA");
        signature.initSign(key);
        return signature;
    }
}
