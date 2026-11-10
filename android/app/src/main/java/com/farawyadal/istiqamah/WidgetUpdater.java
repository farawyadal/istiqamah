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
    static final String ACTION_CELL = "com.farawyadal.istiqamah.CELL";
    static final String ACTION_DISMISS = "com.farawyadal.istiqamah.DISMISS";
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
                if (Build.VERSION.SDK_INT >= 31) {
                    // satu widget, dua susun atur: 4x1 dan 4x2 (Android 12+ pilih ikut saiz)
                    java.util.Map<android.util.SizeF, RemoteViews> map = new java.util.LinkedHashMap<>();
                    map.put(new android.util.SizeF(250f, 40f), buildWaktu(ctx, r, items, now, false));
                    map.put(new android.util.SizeF(250f, 125f), buildWaktu(ctx, r, items, now, true));
                    m.updateAppWidget(ids, new RemoteViews(map));
                } else {
                    for (int id : ids) {
                        int h = m.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
                        m.updateAppWidget(id, buildWaktu(ctx, r, items, now, h >= 125));
                    }
                }
            }

            schedule(ctx, items, now);
        } catch (Exception ignored) {
            // jangan jatuhkan proses kerana widget
        }
    }

    private static int[] ids(Context ctx, AppWidgetManager m, Class<?> c) {
        return m.getAppWidgetIds(new ComponentName(ctx, c));
    }

    private static PendingIntent open(Context ctx, String target, int code) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (target != null) i.putExtra("isti_open", target);
        return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent bcast(Context ctx, String action, int idx, int code) {
        Intent i = new Intent(ctx, WidgetEventReceiver.class);
        i.setAction(action);
        i.putExtra("idx", idx);
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static final long MASUK_MS = 3 * 60 * 1000L;
    private static final long SEL_MS = 2 * 60 * 1000L;

    private static RemoteViews buildWaktu(Context ctx, JSONObject r, List<WidgetData.Item> items, long now, boolean big) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), big ? R.layout.widget_waktu_big : R.layout.widget_waktu);
        android.content.SharedPreferences sp = WidgetData.prefs(ctx);
        Calendar cal = Calendar.getInstance();
        String today = WidgetData.ymd(cal);
        JSONObject d = WidgetData.day(r, today);
        v.setTextViewText(R.id.zone, r == null ? "" : r.optString("zone"));
        v.setTextViewText(R.id.dline, d == null ? "" : dowName(r, cal) + " · " + d.optString("hijri"));

        // kelegapan latar
        String opa = r == null ? "mid" : r.optString("opa", "mid");
        int bg = "solid".equals(opa) ? R.drawable.widget_bg_navy : ("glass".equals(opa) ? R.drawable.widget_bg_glass : R.drawable.widget_bg_mid);
        v.setInt(R.id.root, "setBackgroundResource", bg);

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

        // Masuk Waktu: 3 minit dari waktu azan, hanya jika loceng waktu itu dihidupkan dan belum ditutup
        int masuk = -1;
        long dis = sp.getLong("dis_at", 0);
        for (int i = 0; i < 6; i++) {
            if (i == 1 || at[i] <= 0 || now < at[i] || now >= at[i] + MASUK_MS || dis >= at[i]) continue;
            for (WidgetData.Item it : items) {
                if (it.fardu && it.at == at[i] && it.bell) { masuk = i; break; }
            }
            if (masuk >= 0) break;
        }
        int sel = sp.getInt("sel", -1);
        if (sel >= 0 && (now - sp.getLong("sel_ts", 0) > SEL_MS || !today.equals(sp.getString("sel_day", "")))) sel = -1;
        int show = masuk >= 0 ? masuk : sel;

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
            v.setOnClickPendingIntent(CELL[i], bcast(ctx, ACTION_CELL, i, 100 + i));
        }

        if (show >= 0) {
            v.setViewVisibility(R.id.list, android.view.View.GONE);
            v.setViewVisibility(R.id.det, android.view.View.VISIBLE);
            boolean m = masuk >= 0;
            v.setTextViewText(R.id.dlab, WidgetData.label(r, m ? "masuk" : "waktu", m ? "MASUK WAKTU" : "WAKTU"));
            v.setTextColor(R.id.dlab, m ? 0xFFF0D78C : 0xFFC3D3E4);
            String t = p == null ? "" : p.optString(KEYS[show]);
            v.setTextViewText(R.id.dtit, WidgetData.label(r, KEYS[show], KEYS[show]) + " " + (t.length() >= 5 ? WidgetData.fmt12(r, t, false) : "--"));
            String[] su = {"", ""};
            JSONArray g = null;
            try { g = d == null ? null : d.getJSONObject("g").getJSONArray(KEYS[show]); } catch (Exception ignored) { /* tiada */ }
            for (int k = 0; g != null && k < 2 && k < g.length(); k++) {
                JSONArray e = g.optJSONArray(k);
                if (e != null) su[k] = e.optString(0) + " " + WidgetData.fmt12(r, e.optString(1), false);
            }
            v.setTextViewText(R.id.dsu1, su[0]);
            v.setTextViewText(R.id.dsu2, su[1]);
            v.setViewVisibility(R.id.dsu1, su[0].isEmpty() ? android.view.View.GONE : android.view.View.VISIBLE);
            v.setViewVisibility(R.id.dsu2, su[1].isEmpty() ? android.view.View.GONE : android.view.View.VISIBLE);
            PendingIntent back = m ? bcast(ctx, ACTION_DISMISS, -1, 120) : bcast(ctx, ACTION_CELL, -1, 121);
            v.setOnClickPendingIntent(R.id.det, back);
            v.setOnClickPendingIntent(R.id.root, back);
        } else {
            v.setViewVisibility(R.id.list, android.view.View.VISIBLE);
            v.setViewVisibility(R.id.det, android.view.View.GONE);
            v.setOnClickPendingIntent(R.id.root, open(ctx, null, 0));
        }

        WidgetData.Item sun = WidgetData.next(items, now, 2);
        v.setTextViewText(R.id.sunl, WidgetData.label(r, "sunatNext", "Sunat seterusnya") + ":");
        v.setTextViewText(R.id.sunv, sun == null ? "-" : sun.name + " " + WidgetData.fmt12(r, sun.at, true));
        v.setOnClickPendingIntent(R.id.loc, open(ctx, "zone", 1));
        v.setOnClickPendingIntent(R.id.kib, open(ctx, "kiblat", 2));

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

    /** Jadualkan kemas kini seterusnya: waktu item seterusnya, tamat Masuk Waktu (3 minit), tamat pilihan, atau tengah malam. */
    static void schedule(Context ctx, List<WidgetData.Item> items, long now) {
        try {
            long t = Long.MAX_VALUE;
            for (WidgetData.Item it : items) {
                long a = it.at + 2000;
                if (a > now + 1000 && a < t) t = a;
                long e = it.at + MASUK_MS + 2000;
                if (it.fardu && it.bell && e > now + 1000 && e < t) t = e;
            }
            android.content.SharedPreferences sp = WidgetData.prefs(ctx);
            if (sp.getInt("sel", -1) >= 0) {
                long e = sp.getLong("sel_ts", 0) + SEL_MS + 1000;
                if (e > now + 1000 && e < t) t = e;
            }
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
                boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
                if (Build.VERSION.SDK_INT >= 23) {
                    if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC, t, pi);
                    else am.setAndAllowWhileIdle(AlarmManager.RTC, t, pi);
                } else am.set(AlarmManager.RTC, t, pi);
            }
        } catch (Exception ignored) {
            // abaikan
        }
    }
}
