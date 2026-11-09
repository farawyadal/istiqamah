package com.farawyadal.istiqamah;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/** Data waktu solat yang disegerakkan daripada app web (SharedPreferences). */
final class WidgetData {
    static final String PREF = "isti_widget";

    static final class Item {
        String name;
        String sub;
        String time; // HH:MM
        long at;
        boolean fardu;
        boolean bell = true;
    }

    private WidgetData() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    static JSONObject root(Context c) {
        try {
            String s = prefs(c).getString("data", null);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) {
            return null;
        }
    }

    static String ymd(Calendar cal) {
        return String.format(java.util.Locale.US, "%04d-%02d-%02d",
                cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH));
    }

    static long epoch(String ymd, String hhmm) {
        try {
            String[] d = ymd.split("-");
            Calendar c = Calendar.getInstance();
            c.clear();
            c.set(Integer.parseInt(d[0]), Integer.parseInt(d[1]) - 1, Integer.parseInt(d[2]),
                    Integer.parseInt(hhmm.substring(0, 2)), Integer.parseInt(hhmm.substring(3, 5)), 0);
            return c.getTimeInMillis();
        } catch (Exception e) {
            return 0;
        }
    }

    static JSONObject day(JSONObject r, String ymd) {
        if (r == null) return null;
        JSONArray days = r.optJSONArray("days");
        if (days == null) return null;
        for (int i = 0; i < days.length(); i++) {
            JSONObject d = days.optJSONObject(i);
            if (d != null && ymd.equals(d.optString("ymd"))) return d;
        }
        return null;
    }

    static List<Item> items(JSONObject r) {
        List<Item> out = new ArrayList<>();
        if (r == null) return out;
        JSONArray days = r.optJSONArray("days");
        if (days == null) return out;
        for (int i = 0; i < days.length(); i++) {
            JSONObject d = days.optJSONObject(i);
            if (d == null) continue;
            String ymd = d.optString("ymd");
            JSONArray arr = d.optJSONArray("items");
            if (arr == null) continue;
            for (int j = 0; j < arr.length(); j++) {
                JSONObject o = arr.optJSONObject(j);
                if (o == null) continue;
                Item it = new Item();
                it.name = o.optString("n");
                it.sub = o.optString("s");
                it.time = o.optString("t");
                it.fardu = o.optInt("f") == 1;
                it.bell = o.optInt("b", 1) == 1;
                it.at = epoch(ymd, it.time);
                out.add(it);
            }
        }
        Collections.sort(out, new Comparator<Item>() {
            @Override public int compare(Item a, Item b) { return Long.compare(a.at, b.at); }
        });
        return out;
    }

    /** mode: 0 mana-mana, 1 fardu, 2 sunat */
    static Item next(List<Item> list, long now, int mode) {
        for (Item it : list) {
            if (it.at < now) continue;
            if (mode == 1 && !it.fardu) continue;
            if (mode == 2 && it.fardu) continue;
            return it;
        }
        return null;
    }

    static String label(JSONObject r, String key, String def) {
        if (r == null) return def;
        JSONObject l = r.optJSONObject("labels");
        return l == null ? def : l.optString(key, def);
    }

    static String fmt12(JSONObject r, String hhmm, boolean suffix) {
        try {
            int h = Integer.parseInt(hhmm.substring(0, 2));
            String m = hhmm.substring(3, 5);
            boolean am = h < 12;
            h = h % 12;
            if (h == 0) h = 12;
            String s = h + ":" + m;
            return suffix ? s + " " + label(r, am ? "am" : "pm", am ? "pg" : "ptg") : s;
        } catch (Exception e) {
            return hhmm;
        }
    }

    static String fmt12(JSONObject r, long at, boolean suffix) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(at);
        return fmt12(r, String.format(java.util.Locale.US, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE)), suffix);
    }
}
