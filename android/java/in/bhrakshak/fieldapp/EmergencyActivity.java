package in.bhrakshak.fieldapp;

import android.app.Activity;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * Full-screen emergency alarm — launched by the alert notification's
 * full-screen intent for LEVEL-4 events (rings like an incoming call:
 * looping alarm sound + vibration, shows over the lock screen).
 *
 * "ACKNOWLEDGE" marks it seen, tells the command centre this officer has
 * seen the alert (a status message appears in their Field-messages inbox),
 * and silences the alarm.
 */
public class EmergencyActivity extends Activity {

    private Vibrator vibrator;
    private MediaPlayer player;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // show over the lock screen, wake the screen
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }

        String title = getIntent().getStringExtra("title");
        String body = getIntent().getStringExtra("body");
        String zone = getIntent().getStringExtra("zone");
        final String id = getIntent().getStringExtra("id");
        if (title == null) title = "Landslide emergency";

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(Ui.dp(this, 24), Ui.dp(this, 60), Ui.dp(this, 24), Ui.dp(this, 30));
        scroll.setBackgroundColor(0xFF51101D);

        TextView icon = Ui.text(this, "⚠", 52f, 0xFFFCA5A5, true);
        icon.setGravity(Gravity.CENTER);
        root.addView(icon);

        TextView head = Ui.text(this, "ACTIVE EMERGENCY", 13f, 0xFFFECDD3, true);
        head.setGravity(Gravity.CENTER);
        head.setLetterSpacing(0.2f);
        root.addView(head);

        TextView titleTv = Ui.text(this, title, 24f, 0xFFFFFFFF, true);
        titleTv.setGravity(Gravity.CENTER);
        titleTv.setPadding(0, Ui.dp(this, 14), 0, Ui.dp(this, 6));
        root.addView(titleTv);

        if (body != null && !body.isEmpty()) {
            TextView bodyTv = Ui.text(this, body, 15f, 0xFFF1F5F9, false);
            bodyTv.setGravity(Gravity.CENTER);
            root.addView(bodyTv);
        }
        if (zone != null && !zone.isEmpty()) {
            TextView zoneTv = Ui.text(this, "📍 " + zone, 14f, Ui.TEAL, true);
            zoneTv.setGravity(Gravity.CENTER);
            zoneTv.setPadding(0, Ui.dp(this, 10), 0, 0);
            root.addView(zoneTv);
        }

        TextView note = Ui.text(this,
                "This is a level-4 landslide alert from the BhuRakshak engine.\n"
                        + "Move to your designated shelter, avoid the marked corridor, "
                        + "and follow the safest route in the MAP tab.", 12.5f, 0xFFFECDD3, false);
        note.setGravity(Gravity.CENTER);
        note.setPadding(0, Ui.dp(this, 22), 0, Ui.dp(this, 30));
        root.addView(note);

        Button ack = Ui.button(this, "✔ ACKNOWLEDGE — SILENCE & INFORM COMMAND", Ui.RED, 0xFFFFFFFF);
        root.addView(ack, Ui.lp(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, this, 0, 0, 0, 10));
        final String fTitle = title;
        final String fZone = zone;
        ack.setOnClickListener(v -> acknowledge(fTitle, fZone));

        Button open = Ui.button(this, "OPEN SAFE ROUTES (MAP)", 0xFF16323F, Ui.ACCENT);
        root.addView(open, Ui.lp(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, this, 0, 0, 0, 0));
        open.setOnClickListener(v -> {
            startActivity(new Intent(this, MainActivity.class));
            finish();
        });

        scroll.addView(root, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);

        startAlarm();
    }

    private void acknowledge(String title, String zone) {
        // tell the command centre this officer has seen the alert
        final Prefs prefs = new Prefs(this);
        final String server = prefs.server();
        if (server != null) {
            final JSONObject payload = new JSONObject();
            try {
                payload.put("category", "status");
                payload.put("body", "ACK — received & acknowledged alert: " + title
                        + (zone == null || zone.isEmpty() ? "" : " (" + zone + ")")
                        + ". Moving to safety, will report position.");
            } catch (Exception ignored) {
            }
            new Thread(() -> Api.post(server, "/api/app/message", payload, prefs.deviceId()),
                    "ack-msg").start();
        }
        finish();
    }

    /* ── alarm sound + vibration ─────────────────────────────── */

    private void startAlarm() {
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                VibratorManager vm = (VibratorManager) getSystemService(VIBRATOR_MANAGER_SERVICE);
                vibrator = vm.getDefaultVibrator();
            } else {
                vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            }
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = {0, 700, 300, 700, 300, 700};
                if (Build.VERSION.SDK_INT >= 26) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception ignored) {
        }

        try {
            Uri alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (alarm == null) alarm = Settings.System.DEFAULT_ALARM_ALERT_URI;
            player = new MediaPlayer();
            player.setDataSource(this, alarm);
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onDestroy() {
        if (vibrator != null) try { vibrator.cancel(); } catch (Exception ignored) {}
        if (player != null) try {
            player.stop();
            player.release();
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        // the emergency must be acknowledged, not swiped away — but allow
        // leaving without ack if the user insists (second press)
        if (backOnce) finish();
        else {
            backOnce = true;
            android.widget.Toast.makeText(this, "Press back again to dismiss without acknowledging",
                    android.widget.Toast.LENGTH_SHORT).show();
        }
    }

    private boolean backOnce;
}
