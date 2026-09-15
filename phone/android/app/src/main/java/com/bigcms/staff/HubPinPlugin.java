package com.bigcms.staff;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.util.Base64;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.Signature;
import java.util.regex.Pattern;

/**
 * The paired hub, this phone's sign-in key, and the app's own requests.
 *
 * Only the app's own page (www/) can call this. Capacitor exposes plugins to
 * the app's own origin, not to the hub's pages, so a page served by a hub (or
 * by something pretending to be one) cannot re-pin the app, use its key, or
 * make its requests.
 */
@CapacitorPlugin(name = "HubPin")
public class HubPinPlugin extends Plugin {

    static final String PREFS = "hub-pin";
    static final String ADDRESS = "address";
    static final String FINGERPRINT = "fingerprint";

    private static final Pattern HANDOFF = Pattern.compile("^#key-session=[A-Za-z0-9._%\\-+/=]{20,400}$");

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── The paired hub ────────────────────────────────────────────────────

    @PluginMethod
    public void get(PluginCall call) {
        SharedPreferences p = prefs(getContext());
        JSObject out = new JSObject();
        String address = p.getString(ADDRESS, null);
        String fingerprint = p.getString(FINGERPRINT, null);
        if (HubPin.hubOrigin(address) != null && HubPin.normalizeFingerprint(fingerprint) != null) {
            out.put(ADDRESS, address);
            out.put(FINGERPRINT, fingerprint);
        }
        call.resolve(out);
    }

    /** Checked again here: the page's reading of the QR is not the last word on what this app trusts. */
    @PluginMethod
    public void pair(PluginCall call) {
        String origin = HubPin.hubOrigin(call.getString(ADDRESS));
        String fingerprint = HubPin.normalizeFingerprint(call.getString(FINGERPRINT));
        if (origin == null || fingerprint == null) {
            call.reject("That is not a café hub: it needs an https address on the café network and a whole certificate fingerprint.");
            return;
        }
        prefs(getContext()).edit().putString(ADDRESS, origin).putString(FINGERPRINT, fingerprint).apply();
        call.resolve();
    }

    @PluginMethod
    public void forget(PluginCall call) {
        prefs(getContext()).edit().clear().apply();
        call.resolve();
    }

    /** Opens the till's sign-in page, with a key sign-in handed over in the fragment when there is one. */
    @PluginMethod
    public void open(PluginCall call) {
        String origin = HubPin.hubOrigin(prefs(getContext()).getString(ADDRESS, null));
        if (origin == null) {
            call.reject("This phone is not paired with a hub.");
            return;
        }
        String hash = call.getString("hash");
        if (hash != null && !HANDOFF.matcher(hash).matches()) {
            call.reject("Not a sign-in to hand over.");
            return;
        }
        String url = origin + (hash == null ? "/pos" : "/pos/login" + hash);
        getBridge().executeOnMainThread(() -> getBridge().getWebView().loadUrl(url));
        call.resolve();
    }

    /** The paired hub's pages load in the app; any other address goes to Capacitor's own rule. */
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        String address = prefs(getContext()).getString(ADDRESS, null);
        return HubPin.isHubPage(address, url.toString()) ? Boolean.FALSE : null;
    }

    // ── This phone's sign-in key (S12) ────────────────────────────────────

    /** Whether the phone has a sign-in key, and whether it has a strong fingerprint or face to unlock one. */
    @PluginMethod
    public void keyStatus(PluginCall call) {
        JSObject out = new JSObject();
        try {
            String publicKey = HubKeys.publicKey();
            out.put("hasKey", publicKey != null);
            if (publicKey != null) out.put("publicKey", publicKey);
        } catch (Exception e) {
            out.put("hasKey", false);
        }
        int can = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        out.put("strongBiometrics", can == BiometricManager.BIOMETRIC_SUCCESS);
        out.put("model", (Build.MANUFACTURER + " " + Build.MODEL).trim());
        call.resolve(out);
    }

    @PluginMethod
    public void createKey(PluginCall call) {
        int can = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        if (can != BiometricManager.BIOMETRIC_SUCCESS) {
            call.reject("This phone has no fingerprint (or face unlock Android counts as strong) set up, so it cannot sign in by itself. Add a fingerprint in the phone's settings, or ask a manager.");
            return;
        }
        byte[] challenge;
        try {
            challenge = Base64.decode(call.getString("challenge", ""), Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
        } catch (IllegalArgumentException e) {
            challenge = new byte[0];
        }
        if (challenge.length != 32) {
            call.reject("The cloud's registration challenge is missing. Start again.");
            return;
        }
        try {
            JSObject out = new JSObject();
            out.put("publicKey", HubKeys.create(challenge));
            JSArray chain = new JSArray();
            for (String cert : HubKeys.chain()) chain.put(cert);
            out.put("chain", chain);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("The phone could not make a sign-in key: " + e.getMessage());
        }
    }

    @PluginMethod
    public void deleteKey(PluginCall call) {
        try {
            HubKeys.delete();
            call.resolve();
        } catch (Exception e) {
            call.reject("The phone could not remove its sign-in key: " + e.getMessage());
        }
    }

    /** Signs a message with the key, after a strong fingerprint or face check. Never the phone's PIN. */
    @PluginMethod
    public void sign(PluginCall call) {
        String message = call.getString("message");
        if (message == null || message.isEmpty() || message.length() > 2000) {
            call.reject("Nothing to sign.");
            return;
        }
        final Signature signer;
        try {
            signer = HubKeys.signer();
        } catch (KeyPermanentlyInvalidatedException e) {
            try { HubKeys.delete(); } catch (Exception ignored) { /* it is unusable either way */ }
            call.reject("A fingerprint was added to this phone since it was registered, so its sign-in key no longer works. Register the phone again.");
            return;
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "This phone has no sign-in key." : e.getMessage());
            return;
        }
        FragmentActivity activity = getActivity();
        activity.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    try {
                        Signature unlocked = result.getCryptoObject() == null ? null : result.getCryptoObject().getSignature();
                        if (unlocked == null) throw new IllegalStateException("The key was not unlocked.");
                        unlocked.update(message.getBytes(StandardCharsets.UTF_8));
                        JSObject out = new JSObject();
                        out.put("signature", Base64.encodeToString(unlocked.sign(), Base64.NO_WRAP));
                        call.resolve(out);
                    } catch (Exception e) {
                        call.reject("The phone could not sign: " + e.getMessage());
                    }
                }

                @Override
                public void onAuthenticationError(int code, CharSequence text) {
                    call.reject(String.valueOf(text), String.valueOf(code));
                }
            });
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(call.getString("title", "Confirm it is you"))
                .setSubtitle(call.getString("subtitle", "BIG CMS till"))
                .setNegativeButtonText("Cancel")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build();
            prompt.authenticate(info, new BiometricPrompt.CryptoObject(signer));
        });
    }

    // ── The app's own requests ────────────────────────────────────────────

    /** A request to the paired hub, trusting only its pinned certificate. */
    @PluginMethod
    public void hubRequest(PluginCall call) {
        SharedPreferences p = prefs(getContext());
        try {
            JSObject body = call.getObject("body");
            HubHttp.Reply reply = HubHttp.hub(
                p.getString(ADDRESS, null), p.getString(FINGERPRINT, null),
                call.getString("method", "GET"), call.getString("path"), body == null ? null : body.toString());
            call.resolve(reply(reply));
        } catch (Exception e) {
            call.reject("The phone could not reach the hub: " + e.getMessage(), "NETWORK");
        }
    }

    /** An ordinary https request: Firebase's sign-in, or the cloud's registration route. */
    @PluginMethod
    public void webRequest(PluginCall call) {
        try {
            JSObject body = call.getObject("body");
            HubHttp.Reply reply = HubHttp.web(
                call.getString("url"), call.getString("method", "GET"), body == null ? null : body.toString(), call.getString("bearer"));
            call.resolve(reply(reply));
        } catch (Exception e) {
            call.reject("The phone could not reach the internet: " + e.getMessage(), "NETWORK");
        }
    }

    private static JSObject reply(HubHttp.Reply reply) {
        JSObject out = new JSObject();
        out.put("status", reply.status);
        out.put("body", reply.body);
        return out;
    }
}
