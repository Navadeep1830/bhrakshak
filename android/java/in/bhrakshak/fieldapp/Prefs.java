package in.bhrakshak.fieldapp;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Tiny persistence layer over SharedPreferences: server origin, device
 * identity, seen-notification/message ids (dedupe), offline chat queue.
 */
public class Prefs {

    private static final String FILE = "bhrakshak";
    private static final String K_SERVER = "server";
    private static final String K_DEVICE_ID = "deviceId";
    private static final String K_NAME = "deviceName";
    private static final String K_SEEN_NOTIF = "seenNotifs";
    private static final String K_SEEN_MSG = "seenMsgs";
    private static final String K_PENDING = "pendingMsgs";
    private static final int SEEN_CAP = 400;

    private final SharedPreferences sp;

    public Prefs(Context c) {
        sp = c.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /* ── server ──────────────────────────────────────────────── */

    public String server() {
        String s = sp.getString(K_SERVER, null);
        return (s == null || s.trim().isEmpty()) ? null : s.trim();
    }

    public void saveServer(String s) {
        sp.edit().putString(K_SERVER, s == null ? "" : s.trim()).apply();
    }

    /* ── device identity ─────────────────────────────────────── */

    public String deviceId() {
        String id = sp.getString(K_DEVICE_ID, null);
        if (id == null || id.trim().isEmpty()) {
            id = "android-" + UUID.randomUUID().toString().substring(0, 8);
            sp.edit().putString(K_DEVICE_ID, id).apply();
        }
        return id;
    }

    public String deviceName() {
        String n = sp.getString(K_NAME, null);
        if (n == null || n.trim().isEmpty()) {
            String tail = deviceId();
            int cut = Math.max(0, tail.length() - 4);
            n = "Field phone " + tail.substring(cut).toUpperCase();
            sp.edit().putString(K_NAME, n).apply();
        }
        return n;
    }

    public void saveDeviceName(String n) {
        if (n != null && !n.trim().isEmpty()) sp.edit().putString(K_NAME, n.trim()).apply();
    }

    /* ── seen ids (notification + message dedupe) ────────────── */

    public boolean seen(Set<String> seen, String id) {
        return id != null && seen.contains(id);
    }

    public void markSeen(String key, Set<String> current, String id) {
        if (id == null) return;
        Set<String> next = new LinkedHashSet<>(current);
        next.add(id);
        // cap the set so prefs don't grow forever
        if (next.size() > SEEN_CAP) {
            List<String> keep = new ArrayList<>(next);
            next = new LinkedHashSet<>(keep.subList(keep.size() - SEEN_CAP, keep.size()));
        }
        sp.edit().putStringSet(key, next).apply();
        current.clear();
        current.addAll(next);
    }

    public Set<String> seenNotifs() {
        return sp.getStringSet(K_SEEN_NOTIF, new LinkedHashSet<>());
    }

    public void markNotifSeen(String id) {
        markSeen(K_SEEN_NOTIF, seenNotifs(), id);
    }

    public Set<String> seenMsgs() {
        return sp.getStringSet(K_SEEN_MSG, new LinkedHashSet<>());
    }

    public void markMsgSeen(String id) {
        markSeen(K_SEEN_MSG, seenMsgs(), id);
    }

    /* ── offline chat queue (messages that failed to send) ───── */

    public List<JSONObject> pending() {
        List<JSONObject> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(sp.getString(K_PENDING, "[]"));
            for (int i = 0; i < a.length(); i++) out.add(a.getJSONObject(i));
        } catch (Exception ignored) {
        }
        return out;
    }

    public void addPending(JSONObject msg) {
        try {
            JSONArray a = new JSONArray(sp.getString(K_PENDING, "[]"));
            a.put(msg);
            sp.edit().putString(K_PENDING, a.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    public void clearPending() {
        sp.edit().putString(K_PENDING, "[]").apply();
    }

    public void removePending(int index) {
        try {
            JSONArray a = new JSONArray(sp.getString(K_PENDING, "[]"));
            JSONArray out = new JSONArray();
            for (int i = 0; i < a.length(); i++) if (i != index) out.put(a.get(i));
            sp.edit().putString(K_PENDING, out.toString()).apply();
        } catch (Exception ignored) {
        }
    }
}
