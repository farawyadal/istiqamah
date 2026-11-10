package com.farawyadal.istiqamah;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.List;

/** Bina dan kemas kini semua widget Istiqamah. */
final class WidgetUpdater {
    static final String ACTION_REFRESH = "com.farawyadal.istiqamah.REFRESH";
    static final String ACTION_ZIKIR = "com.farawyadal.istiqamah.ZIKIR_TAP";

    private static final int[] CELL = {R.id.cell1, R.id.cell2, R.id.cell3, R.id.cell4, R.id.cell5, R.id.cell6};
    private static final int[] LB = {R.id.lb1, R.id.lb2, R.id.lb3, R.id.lb4, R.id.lb5, R.id.lb6};
    private static final int[] TM = {R.id.tm1, R.id.tm2, R.id.tm3, R.id.tm4, R.id.tm5, R.id.tm6};
    private static final String[] KEYS = {"subuh", "syuruk", "zohor", "asar", "maghrib", "isyak"};

    private WidgetUpdater() {}

    static void updateAll(Context ctx) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(ctx);
            JSONObject r = WidgetData.root(ctx);
            List<WidgetData.Item> items = WidgetData.items(r);
            long now = System.currentTimeMillis();

            int[] ids = ids(ctx, m, WaktuWidget.class);
            if (ids.length > 0) {
                RemoteViews rv = buildWaktu(ctx, r, items, now, R.layout.widget_waktu);
                if (Build.VERSION.SDK_INT >= 31) {
                    // satu widget, dua susun atur: satu baris (4x1), dua baris tiga waktu (4x2)
                    java.util.Map<android.util.SizeF, RemoteViews> map = new java.util.LinkedHashMap<>();
                    map.put(new android.util.SizeF(250f, 40f), rv);
                    map.put(new android.util.SizeF(250f, 125f), buildWaktu(ctx, r, items, now, R.layout.widget_waktu_big));
                    rv = new RemoteViews(map);
                }
                m.updateAppWidget(ids, rv);
            }
            ids = ids(ctx, m, ZikirWidget.class);
            if (ids.length > 0) m.updateAppWidget(ids, buildZikir(ctx, r));

            schedule(ctx, items, now);
        } catch (Exception ignored) {
            // jangan jatuhkan proses kerana widget
        }
    }

    private static int[] ids(Context ctx, AppWidgetManager m, Class<?> c) {
        return m.getAppWidgetIds(new ComponentName(ctx, c));
    }

    private static PendingIntent openApp(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static RemoteViews buildWaktu(Context ctx, JSONObject r, List<WidgetData.Item> items, long now, int layout) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), layout);
        Calendar cal = Calendar.getInstance();
        String today = WidgetData.ymd(cal);
        JSONObject d = WidgetData.day(r, today);
        String zone = r == null ? "" : r.optString("zone");
        v.setTextViewText(R.id.zone, zone);
        String dline = "";
        if (d != null) {
            String dow = dowName(r, cal);
            dline = dow + " · " + d.optString("hijri");
        }
        v.setTextViewText(R.id.dline, dline);

        JSONObject p = d == null ? null : d.optJSONObject("p");
        int nextIdx = -1;
        long[] at = new long[6];
        for (int i = 0; i < 6; i++) {
            String t = p == null ? "" : p.optString(KEYS[i]);
            at[i] = t.length() >= 5 ? WidgetData.epoch(today, t) : 0;
        }
        for (int i = 0; i < 6; i++) {
            if (at[i] >= now) { nextIdx = i; break; }
        }
        for (int i = 0; i < 6; i++) {
            String t = p == null ? "" : p.optString(KEYS[i]);
            v.setTextViewText(LB[i], WidgetData.label(r, KEYS[i], KEYS[i]));
            v.setTextViewText(TM[i], t.length() >= 5 ? WidgetData.fmt12(r, t, false) : "--");
            int color;
            if (i == nextIdx) color = 0xFFF0D78C;
            else if (at[i] < now) color = 0xFF8FA9C4;
            else color = 0xFFF4EFE0;
            v.setTextColor(LB[i], i == nextIdx ? 0xFFF0D78C : (at[i] < now ? 0xFF8FA9C4 : 0xFFB9CCE0));
            v.setTextColor(TM[i], color);
            v.setInt(CELL[i], "setBackgroundResource", i == nextIdx ? R.drawable.widget_cell_hl : R.drawable.widget_cell_none);
        }
        WidgetData.Item sun = WidgetData.next(items, now, 2);
        v.setTextViewText(R.id.sunl, WidgetData.label(r, "sunatNext", "Sunat seterusnya") + ":");
        v.setTextViewText(R.id.sunv, sun == null ? "-" : sun.name + " " + WidgetData.fmt12(r, sun.at, true));
        v.setOnClickPendingIntent(R.id.root, openApp(ctx));
        return v;
    }

    private static RemoteViews buildZikir(Context ctx, JSONObject r) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_zikir);
        android.content.SharedPreferences p = WidgetData.prefs(ctx);
        int c = p.getInt("zk_c", 0);
        int t = p.getInt("zk_t", 33);
        String n = p.getString("zk_n", "Subhanallah");
        v.setTextViewText(R.id.lbl, WidgetData.label(r, "zikirTap", "Zikir · klik untuk kira"));
        v.setTextViewText(R.id.count, String.valueOf(c));
        v.setTextViewText(R.id.sub, "/ " + t + " " + n);
        Intent i = new Intent(ctx, ZikirWidget.class);
        i.setAction(ACTION_ZIKIR);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.root, pi);
        return v;
    }

    private static String dowName(JSONObject r, Calendar cal) {
        try {
            JSONArray a = r.getJSONObject("labels").getJSONArray("dow");
            return a.getString(cal.get(Calendar.DAY_OF_WEEK) - 1);
        } catch (Exception e) {
            return "";
        }
    }

    /** Jadualkan kemas kini seterusnya: selepas waktu solat seterusnya atau tengah malam. */
    static void schedule(Context ctx, List<WidgetData.Item> items, long now) {
        try {
            long t = Long.MAX_VALUE;
            WidgetData.Item it = WidgetData.next(items, now + 1000, 0);
            if (it != null) t = it.at + 2000;
            Calendar mid = Calendar.getInstance();
            mid.add(Calendar.DAY_OF_MONTH, 1);
            mid.set(Calendar.HOUR_OF_DAY, 0);
            mid.set(Calendar.MINUTE, 0);
            mid.set(Calendar.SECOND, 5);
            mid.set(Calendar.MILLISECOND, 0);
            t = Math.min(t, mid.getTimeInMillis());
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            Intent i = new Intent(ctx, WidgetEventReceiver.class);
            i.setAction(ACTION_REFRESH);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 2, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            if (am != null) {
                if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC, t, pi);
                else am.set(AlarmManager.RTC, t, pi);
            }
        } catch (Exception ignored) {
            // abaikan
        }
    }
}
