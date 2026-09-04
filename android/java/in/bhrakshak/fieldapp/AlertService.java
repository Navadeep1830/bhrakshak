package in.bhrakshak.fieldapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Process;
import android.content.pm.ServiceInfo;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Background alert poller (foreground service).
 *
 * Every 15 s: heartbeat register → GET /api/app/notifications → for every
 * NEW level-3/4 event (or flagged report) raise a heads-up system
 * notification; level-4 raises the full-screen EmergencyActivity alarm
 * (alarm sound + vibration, like an incoming call). Also watches the
 * message thread and notifies when the command centre replies.
 *
 * This is the "dual-path guaranteed delivery" pattern: even if the app is
 * closed or the map WebView is reloading, alerts still reach the officer.
 */
public class AlertService extends Service {

    private static final int FG_ID = 1001;
    private static final int ALERT_BASE = 2000;
    private static final long POLL_MS = 15_000L;

    private HandlerThread thread;
    private Handler handler;
    private Prefs prefs;
    private NotificationManager nm;
    private boolean live = true;   // last known connectivity
    private int beats = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = new Prefs(this);
        nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        createChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (prefs.server() == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startInForeground();
        if (thread == null) {
            thread = new HandlerThread("alert-poll", Process.THREAD_PRIORITY_BACKGROUND);
            thread.start();
            handler = new Handler(thread.getLooper());
            handler.post(loop);
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        if (thread != null) {
            thread.quitSafely();
            thread = null;
        }
        super.onDestroy();
    }

    /* ── polling loop ─────────────────────────────────────────── */

    private final Runnable loop = new Runnable() {
        @Override
        public void run() {
            if (thread == null || !thread.isAlive()) return;
            try {
                pollOnce();
            } catch (Exception ignored) {
            }
            if (thread != null) handler.postDelayed(this, POLL_MS);
        }
    };

    private void pollOnce() {
        final String server = prefs.server();
        if (server == null) {
            stopSelf();
            return;
        }
        String deviceId = prefs.deviceId();

        PowerManager.WakeLock wl = null;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "bhrakshak:alert-poll");
            wl.acquire(10_000L);

            // heartbeat every ~60 s (4 cycles) so the website shows the phone online
            if (beats++ % 4 == 0) {
                try {
                    JSONObject hb = new JSONObject();
                    hb.put("deviceId", deviceId);
                    hb.put("name", prefs.deviceName());
                    Api.post(server, "/api/app/register", hb, deviceId);
                } catch (Exception ignored) {
                }
            }

            boolean ok = false;

            // 1. notifications → heads-up / full-screen emergency
            Api.Resp notif = Api.get(server, "/api/app/notifications", deviceId);
            if (notif.ok() && notif.json != null) {
                ok = true;
                JSONArray events = notif.json.optJSONArray("notifications");
                java.util.Set<String> seen = prefs.seenNotifs();
                if (events != null) {
                    for (int i = events.length() - 1; i >= 0; i--) {  // oldest first
                        JSONObject ev = events.optJSONObject(i);
                        if (ev == null) continue;
                        String id = ev.optString("id", "");
                        if (id.isEmpty() || seen.contains(id)) continue;
                        int level = ev.optInt("level", 0);
                        String kind = ev.optString("kind", "alert");
                        if (level >= 3 || "report-flagged".equals(kind)) {
                            raiseAlert(ev, level >= 4);
                        }
                        prefs.markNotifSeen(id);
                    }
                }
            }

            // 2. command replies → chat notification
            Api.Resp msgs = Api.get(server, "/api/app/messages", deviceId);
            if (msgs.ok() && msgs.json != null) {
                ok = true;
                JSONArray list = msgs.json.optJSONArray("messages");
                java.util.Set<String> seenMsg = prefs.seenMsgs();
                if (list != null) {
                    for (int i = list.length() - 1; i >= 0; i--) {
                        JSONObject m = list.optJSONObject(i);
                        if (m == null) continue;
                        String id = m.optString("id", "");
                        if (id.isEmpty() || seenMsg.contains(id)) continue;
                        if ("command".equals(m.optString("authorRole", "field"))) {
                            raiseReply(m);
                        }
                        prefs.markMsgSeen(id);
                    }
                }
            }

            if (ok != live) {
                live = ok;
                notifyForeground(ok);
            }
        } finally {
            if (wl != null && wl.isHeld()) wl.release();
        }
    }

    /* ── notifications ────────────────────────────────────────── */

    private void createChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel alerts = new NotificationChannel(
                "alerts", "Landslide alerts", NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("Heads-up landslide alerts and emergencies");
        alerts.enableVibration(true);
        alerts.setVibrationPattern(new long[]{0, 500, 250, 500});
        alerts.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        alerts.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), alarmAudio());
        nm.createNotificationChannel(alerts);

        NotificationChannel comms = new NotificationChannel(
                "comms", "Command centre replies", NotificationManager.IMPORTANCE_DEFAULT);
        comms.setDescription("Replies from the command centre");
        nm.createNotificationChannel(comms);

        NotificationChannel status = new NotificationChannel(
                "status", "Monitoring status", NotificationManager.IMPORTANCE_LOW);
        nm.createNotificationChannel(status);
    }

    private static AudioAttributes alarmAudio() {
        return new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
    }

    private void startInForeground() {
        Notification n = buildForeground(true);
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(FG_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(FG_ID, n);
        }
    }

    private void notifyForeground(boolean isLive) {
        try {
            nm.notify(FG_ID, buildForeground(isLive));
        } catch (Exception ignored) {
        }
    }

    private Notification buildForeground(boolean isLive) {
        String host = hostOf(prefs.server());
        String text = isLive
                ? "Monitoring for landslide alerts — " + host
                : "Reconnecting to " + host + " …";
        PendingIntent pi = contentIntent(MainActivity.class);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, "status")
                : new Notification.Builder(this).setPriority(Notification.PRIORITY_LOW);
        b.setContentTitle("BhuRakshak Field")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_dialog_map)
                .setContentIntent(pi)
                .setOngoing(true)
                .setOnlyAlertOnce(true);
        return b.build();
    }

    /** Heads-up alert notification; full-screen alarm for level 4. */
    private void raiseAlert(JSONObject ev, boolean critical) {
        String title = ev.optString("title", "Landslide alert");
        String body = ev.optString("body", "");
        String zone = ev.optString("zoneCode", "");
        String id = ev.optString("id", "");

        Intent open = new Intent(this, critical ? EmergencyActivity.class : MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra("title", title);
        open.putExtra("body", body);
        open.putExtra("zone", zone);
        open.putExtra("id", id);
        open.putExtra("level", ev.optInt("level", 0));
        int nid = id.hashCode();
        PendingIntent pi = PendingIntent.getActivity(this, nid, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent full = new Intent(this, EmergencyActivity.class);
        full.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        full.putExtra("title", title);
        full.putExtra("body", body);
        full.putExtra("zone", zone);
        full.putExtra("id", id);
        full.putExtra("level", ev.optInt("level", 0));
        PendingIntent fullPi = PendingIntent.getActivity(this, nid + 1, full,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, "alerts")
                : new Notification.Builder(this).setPriority(Notification.PRIORITY_MAX)
                .setDefaults(Notification.DEFAULT_ALL);
        b.setContentTitle("⚠ " + title + (zone.isEmpty() ? "" : " — " + zone))
                .setContentText(body)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_ALARM)
                .setColor(0xFFF43F5E)
                .setVibrate(new long[]{0, 500, 250, 500, 250, 500})
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), alarmAudio());
        if (critical) b.setFullScreenIntent(fullPi, true);
        try {
            nm.notify(ALERT_BASE + Math.abs(nid) % 10000, b.build());
        } catch (Exception ignored) {
        }
    }

    /** Command centre replied in the chat. */
    private void raiseReply(JSONObject m) {
        String body = m.optString("body", "");
        PendingIntent pi = contentIntent(MainActivity.class);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, "comms")
                : new Notification.Builder(this).setPriority(Notification.PRIORITY_DEFAULT);
        b.setContentTitle("▣ Command centre replied")
                .setContentText(body.length() > 120 ? body.substring(0, 120) + "…" : body)
                .setSmallIcon(android.R.drawable.sym_action_chat)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setColor(0xFF38BDF8);
        try {
            nm.notify(4000 + Math.abs(m.optString("id", "").hashCode()) % 1000, b.build());
        } catch (Exception ignored) {
        }
    }

    private PendingIntent contentIntent(Class<?> cls) {
        Intent i = new Intent(this, cls);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String hostOf(String url) {
        if (url == null) return "—";
        String s = url.replaceFirst("^[a-zA-Z]+://", "");
        return s.split("/")[0];
    }
}
