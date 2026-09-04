package in.bhrakshak.fieldapp;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * STATUS tab — device + server identity, live server stats, and the two
 * field-official actions that feed the REAL risk engine from the ground:
 *   • I'M SAFE check-in (geo-tagged, shows on the website activity feed)
 *   • Manual rain-gauge reading (mm) → injectConditions() → real engine
 *     pass → possible escalation + alert/SMS fan-out
 */
public class StatusPanel {

    public interface Host {
        Prefs prefs();

        String server();

        double[] location();

        void requestLocationPermission();
    }

    private final Context ctx;
    private final Host host;
    private final TextView serverLine;
    private final TextView engineLine;
    private final TextView deviceLine;
    private final EditText gauge1h;
    private final EditText gauge24h;
    private final EditText safeNote;

    public StatusPanel(Context ctx, Host host) {
        this.ctx = ctx;
        this.host = host;

        ScrollView scroll = new ScrollView(ctx);
        scroll.setBackgroundColor(Ui.BG);
        scroll.setFillViewport(true);
        LinearLayout list = new LinearLayout(ctx);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(Ui.dp(ctx, 10), Ui.dp(ctx, 12), Ui.dp(ctx, 10), Ui.dp(ctx, 24));
        scroll.addView(list, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // ── connection card ─────────────────────────────────────
        LinearLayout conn = Ui.card(ctx, Ui.BG_CARD);
        conn.addView(Ui.label(ctx, "CONNECTION"));
        serverLine = Ui.text(ctx, host.server() == null ? "—" : host.server(), 15f, Ui.TEXT, true);
        conn.addView(serverLine);
        engineLine = Ui.text(ctx, "checking …", 12.5f, Ui.MUTED, false);
        engineLine.setPadding(0, Ui.dp(ctx, 4), 0, 0);
        conn.addView(engineLine);
        Button change = Ui.button(ctx, "CHANGE SERVER", 0xFF16323F, Ui.ACCENT);
        change.setAllCaps(false);
        conn.addView(change, Ui.lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, ctx, 0, 10, 0, 0));
        change.setOnClickListener(v ->
                ctx.startActivity(new Intent(ctx, ConnectActivity.class)));
        list.addView(conn, Ui.matchWrap(ctx));

        // ── device card ─────────────────────────────────────────
        LinearLayout dev = Ui.card(ctx, Ui.BG_CARD);
        dev.addView(Ui.label(ctx, "THIS DEVICE"));
        deviceLine = Ui.text(ctx, host.prefs().deviceName() + "\n" + host.prefs().deviceId(), 13f, Ui.TEXT, false);
        dev.addView(deviceLine);
        TextView dHint = Ui.text(ctx, "Registered with the command centre — no website login needed. "
                + "The website sees this phone live in Operations → Comms & SMS.", 11.5f, Ui.MUTED, false);
        dHint.setPadding(0, Ui.dp(ctx, 6), 0, 0);
        dev.addView(dHint);
        list.addView(dev, Ui.matchWrap2(ctx));

        // ── I'm safe card ───────────────────────────────────────
        LinearLayout safe = Ui.card(ctx, 0xFF0C2A1E);
        safe.addView(Ui.label(ctx, "I'M SAFE CHECK-IN"));
        safe.addView(Ui.text(ctx, "Tell the command centre you are safe — geo-tagged with the nearest risk zone, "
                + "visible on the website activity feed.", 12f, Ui.MUTED, false));
        safeNote = Ui.edit(ctx, "Optional note (e.g. 'team at shelter, all 6 accounted for')");
        safe.addView(safeNote, Ui.lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, ctx, 0, 8, 0, 8));
        Button safeBtn = Ui.button(ctx, "✔  I'M SAFE — CHECK IN NOW", Ui.GREEN, 0xFF03130A);
        safe.addView(safeBtn);
        safeBtn.setOnClickListener(v -> checkIn());
        list.addView(safe, Ui.matchWrap2(ctx));

        // ── rain gauge card ─────────────────────────────────────
        LinearLayout gauge = Ui.card(ctx, Ui.BG_CARD);
        gauge.addView(Ui.label(ctx, "MANUAL RAIN GAUGE (MM)"));
        gauge.addView(Ui.text(ctx, "Read your gauge in the valley and submit real numbers. The production risk "
                + "engine runs over them — same thresholds, hysteresis, alert & SMS fan-out as any telemetry.", 12f, Ui.MUTED, false));
        LinearLayout gRow = new LinearLayout(ctx);
        gRow.setOrientation(LinearLayout.HORIZONTAL);
        gauge1h = Ui.edit(ctx, "mm last 1 h");
        gauge1h.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);
        LinearLayout.LayoutParams g1 = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        gauge1h.setLayoutParams(g1);
        gRow.addView(gauge1h);
        gauge24h = Ui.edit(ctx, "mm last 24 h (optional)");
        gauge24h.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);
        LinearLayout.LayoutParams g2 = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        g2.leftMargin = Ui.dp(ctx, 10);
        gauge24h.setLayoutParams(g2);
        gRow.addView(gauge24h);
        gauge.addView(gRow, Ui.lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, ctx, 0, 8, 0, 8));
        Button gaugeBtn = Ui.button(ctx, "SUBMIT READING → ENGINE", Ui.AMBER, 0xFF1F1302);
        gauge.addView(gaugeBtn);
        gaugeBtn.setOnClickListener(v -> submitGauge());
        list.addView(gauge, Ui.matchWrap2(ctx));

        // ── about card ──────────────────────────────────────────
        LinearLayout about = Ui.card(ctx, Ui.BG_CARD);
        about.addView(Ui.label(ctx, "ABOUT"));
        about.addView(Ui.text(ctx, "BhuRakshak Field v2.0 — native landslide early-warning client.\n"
                + "• Heads-up ALERTS + full-screen emergency alarm, polled every 15 s in the background\n"
                + "• Two-way CHAT with the command centre (offline queue with auto-send)\n"
                + "• MAP: the full field app — street map, 3 alternative routes, hazard marks, street view, "
                + "crack-photo reports with AI pre-screen and offline sync\n"
                + "• STATUS: I'M SAFE + manual rain gauge feed the real engine\n"
                + "Zero external dependencies — plain Android framework + HttpURLConnection.",
                12f, Ui.MUTED, false));
        list.addView(about, Ui.matchWrap2(ctx));

        rootView = scroll;
    }

    private View rootView;

    public View view() {
        return rootView;
    }

    /* ── live server stats (called after each poll cycle) ─────── */

    public void renderHealth(JSONObject health) {
        if (health == null) {
            engineLine.setTextColor(Ui.RED);
            engineLine.setText("offline — reconnecting …");
            return;
        }
        engineLine.setTextColor(Ui.GREEN);
        engineLine.setText("● LIVE — " + health.optInt("zones", 0) + " risk zones · engine "
                + health.optString("engine", "bhrakshak-v3"));
    }

    /* ── actions ─────────────────────────────────────────────── */

    private void checkIn() {
        double[] loc = host.location();
        if (loc == null) {
            host.requestLocationPermission();
            Toast.makeText(ctx, "No GPS fix yet — tap again in a few seconds", Toast.LENGTH_LONG).show();
            return;
        }
        final JSONObject payload = new JSONObject();
        try {
            payload.put("lat", loc[0]);
            payload.put("lon", loc[1]);
            String note = safeNote.getText().toString().trim();
            if (!note.isEmpty()) payload.put("message", note);
        } catch (Exception ignored) {
        }
        Toast.makeText(ctx, "Sending check-in …", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            Api.Resp r = Api.post(host.server(), "/api/app/checkin", payload, host.prefs().deviceId());
            final String zone = r.ok() && r.json != null ? r.json.optString("zoneCode", "") : "";
            ui(r.ok()
                    ? "✓ Check-in delivered" + (zone.isEmpty() ? "" : " — nearest zone " + zone)
                    : "✗ Check-in failed: " + (r.error != null ? Api.diagnose(r) : r.message()));
        }, "checkin").start();
    }

    private void submitGauge() {
        final String mm1 = gauge1h.getText().toString().trim();
        if (mm1.isEmpty()) {
            Toast.makeText(ctx, "Enter the mm reading for the last hour", Toast.LENGTH_SHORT).show();
            return;
        }
        final JSONObject payload = new JSONObject();
        try {
            payload.put("rain1h", Double.parseDouble(mm1));
            String mm24 = gauge24h.getText().toString().trim();
            if (!mm24.isEmpty()) payload.put("rain24h", Double.parseDouble(mm24));
            double[] loc = host.location();
            if (loc != null) {
                payload.put("lat", loc[0]);
                payload.put("lon", loc[1]);
            }
        } catch (NumberFormatException e) {
            Toast.makeText(ctx, "Numbers only, e.g. 12.5", Toast.LENGTH_SHORT).show();
            return;
        } catch (Exception ignored) {
        }
        Toast.makeText(ctx, "Submitting reading — running the engine …", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            Api.Resp r = Api.post(host.server(), "/api/app/gauge", payload, host.prefs().deviceId());
            if (r.ok() && r.json != null) {
                String zone = r.json.optString("zoneCode", "");
                String level = r.json.has("hazardLevel") ? r.json.optString("hazardLevel", "")
                        : String.valueOf(r.json.optInt("hazardLevel", -1));
                StringBuilder sb = new StringBuilder("✓ Engine pass complete");
                if (!zone.isEmpty()) sb.append(" — zone ").append(zone);
                if (!level.isEmpty() && !"-1".equals(level)) sb.append(" now L").append(level);
                if (r.json.optBoolean("escalated", false)) sb.append(" · ALERT RAISED");
                ui(sb.toString());
            } else {
                ui("✗ Gauge failed: " + (r.error != null ? Api.diagnose(r) : r.message()));
            }
        }, "gauge").start();
    }

    private void ui(final String msg) {
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() ->
                Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show());
    }
}
