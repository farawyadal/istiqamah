package com.farawyadal.istiqamah;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(IstiWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
