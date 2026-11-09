package com.farawyadal.istiqamah;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(IstiWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        stash(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        stash(intent);
    }

    /** Klik pada widget: simpan skrin sasaran supaya app web membukanya. */
    private void stash(Intent i) {
        try {
            String o = i == null ? null : i.getStringExtra("isti_open");
            if (o != null && o.length() > 0) {
                WidgetData.prefs(this).edit().putString("open", o).apply();
                i.removeExtra("isti_open");
            }
        } catch (Exception ignored) {
            // abaikan
        }
    }
}
