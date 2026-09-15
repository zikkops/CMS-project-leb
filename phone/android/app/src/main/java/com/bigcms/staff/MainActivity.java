package com.bigcms.staff;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HubPinPlugin.class);
        super.onCreate(savedInstanceState);
        // The paired hub's certificate, and only that one (HubPin).
        getBridge().setWebViewClient(new HubWebViewClient(getBridge()));
    }
}
