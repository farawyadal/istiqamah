package com.farawyadal.istiqamah;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/** Kemas kini widget selepas but, tukar masa/zon, penggera waktu solat, dan klik pada widget. */
public class WidgetEventReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent == null ? null : intent.getAction();
        SharedPreferences p = WidgetData.prefs(context);
        if (WidgetUpdater.ACTION_CELL.equals(a)) {
            int idx = intent.getIntExtra("idx", -1);
            int cur = p.getInt("sel", -1);
            SharedPreferences.Editor e = p.edit();
            if (idx < 0 || idx == cur) {
                e.putInt("sel", -1);
            } else {
                e.putInt("sel", idx);
                e.putLong("sel_ts", System.currentTimeMillis());
                e.putString("sel_day", WidgetData.ymd(java.util.Calendar.getInstance()));
            }
            e.apply();
        } else if (WidgetUpdater.ACTION_DISMISS.equals(a)) {
            p.edit().putLong("dis_at", System.currentTimeMillis()).putInt("sel", -1).apply();
            try {
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) nm.cancelAll();
            } catch (Exception ignored) {
                // abaikan
            }
        }
        WidgetUpdater.updateAll(context);
    }
}
