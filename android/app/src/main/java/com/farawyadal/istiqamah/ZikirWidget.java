package com.farawyadal.istiqamah;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

public class ZikirWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        WidgetUpdater.updateAll(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (WidgetUpdater.ACTION_ZIKIR.equals(intent.getAction())) {
            SharedPreferences p = WidgetData.prefs(context);
            p.edit().putInt("zk_c", p.getInt("zk_c", 0) + 1).apply();
            WidgetUpdater.updateAll(context);
            return;
        }
        super.onReceive(context, intent);
    }
}
