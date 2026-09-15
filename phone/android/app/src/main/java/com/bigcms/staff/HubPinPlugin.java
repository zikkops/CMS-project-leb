package com.bigcms.staff;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The paired hub: stored here, and nowhere a web page can write it.
 *
 * Only the app's own page (www/) can call this. Capacitor exposes plugins to
 * the app's own origin, not to the hub's pages, so a page served by a hub —
 * or by something pretending to be one — cannot re-pin the app to itself.
 */
@CapacitorPlugin(name = "HubPin")
public class HubPinPlugin extends Plugin {

    static final String PREFS = "hub-pin";
    static final String ADDRESS = "address";
    static final String FINGERPRINT = "fingerprint";

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

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

    @PluginMethod
    public void open(PluginCall call) {
        String origin = HubPin.hubOrigin(prefs(getContext()).getString(ADDRESS, null));
        if (origin == null) {
            call.reject("This phone is not paired with a hub.");
            return;
        }
        getBridge().executeOnMainThread(() -> getBridge().getWebView().loadUrl(origin + "/pos"));
        call.resolve();
    }

    /** The paired hub's pages load in the app; any other address goes to Capacitor's own rule. */
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        String address = prefs(getContext()).getString(ADDRESS, null);
        return HubPin.isHubPage(address, url.toString()) ? Boolean.FALSE : null;
    }
}
