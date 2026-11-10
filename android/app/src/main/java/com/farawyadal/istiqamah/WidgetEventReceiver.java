package com.farawyadal.istiqamah;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Kemas kini widget selepas but, tukar masa/zon, kemas kini app, atau penggera waktu solat. */
public class WidgetEventReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        WidgetUpdater.updateAll(context);
    }
}
