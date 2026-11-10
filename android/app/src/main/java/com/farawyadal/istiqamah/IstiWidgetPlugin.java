package com.farawyadal.istiqamah;

import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Jambatan app web ke widget skrin utama. */
@CapacitorPlugin(name = "IstiWidget")
public class IstiWidgetPlugin extends Plugin {

    @PluginMethod
    public void sync(PluginCall call) {
        SharedPreferences.Editor e = WidgetData.prefs(getContext()).edit();
        String data = call.getString("data");
        if (data != null) e.putString("data", data);
        String zid = call.getString("zid");
        if (zid != null) {
            e.putString("zk_id", zid);
            e.putString("zk_n", call.getString("zn", ""));
            e.putInt("zk_t", call.getInt("zt", 33));
            e.putInt("zk_c", call.getInt("zc", 0));
        }
        e.apply();
        WidgetUpdater.updateAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void getZikir(PluginCall call) {
        SharedPreferences p = WidgetData.prefs(getContext());
        JSObject o = new JSObject();
        o.put("id", p.getString("zk_id", ""));
        o.put("c", p.getInt("zk_c", 0));
        call.resolve(o);
    }

    @PluginMethod
    public void getOpen(PluginCall call) {
        SharedPreferences p = WidgetData.prefs(getContext());
        JSObject o = new JSObject();
        o.put("o", p.getString("open", ""));
        p.edit().remove("open").apply();
        call.resolve(o);
    }
}
