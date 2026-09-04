package in.bhrakshak.fieldapp;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * Native connect screen — first launch (and "change server" later).
 *
 * Types the BhuRakshak server URL (e.g. http://10.66.1.19:3100 — the
 * machine running the command centre on the same Wi-Fi), health-checks it
 * with /api/health and gives a precise, actionable diagnosis on failure,
 * then registers this device and opens the app.
 */
public class ConnectActivity extends Activity {

    private Prefs prefs;
    private EditText urlEdit;
    private EditText nameEdit;
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = new Prefs(this);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Ui.BG);
        scroll.setFillViewport(true);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(Ui.dp(this, 26), Ui.dp(this, 54), Ui.dp(this, 26), Ui.dp(this, 30));
        scroll.addView(root, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // ── brand header ────────────────────────────────────────
        TextView logo = Ui.text(this, "BHURAKSHAK", 34f, Ui.ACCENT, true);
        logo.setLetterSpacing(0.14f);
        root.addView(logo);
        TextView sub = Ui.text(this, "Field app · landslide early warning", 14f, Ui.MUTED, false);
        sub.setPadding(0, Ui.dp(this, 4), 0, Ui.dp(this, 34));
        root.addView(sub);

        // ── server card ─────────────────────────────────────────
        LinearLayout card = Ui.card(this, Ui.BG_CARD);
        card.addView(Ui.label(this, "COMMAND SERVER ADDRESS"));
        urlEdit = Ui.edit(this, "http://10.66.1.19:3100");
        urlEdit.setText(prefs.server() == null ? "" : prefs.server());
        urlEdit.setTextSize(16f);
        urlEdit.setSelectAllOnFocus(true);
        card.addView(urlEdit);

        TextView hint = Ui.text(this,
                "The machine running BhuRakshak, on the same Wi-Fi as this phone.\n"
                        + "Start it there with:  npm run dev -- -p 3100", 12f, Ui.MUTED, false);
        hint.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 14));
        card.addView(hint);

        card.addView(Ui.label(this, "THIS PHONE SHOWS UP AS"));
        nameEdit = Ui.edit(this, "Field phone");
        nameEdit.setText(prefs.deviceName());
        nameEdit.setTextSize(16f);
        card.addView(nameEdit);

        root.addView(card, Ui.lp(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, this, 0, 0, 0, 18));

        // ── buttons ─────────────────────────────────────────────
        android.widget.Button test = Ui.button(this, "TEST CONNECTION", 0xFF16323F, Ui.ACCENT);
        root.addView(test, Ui.lp(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, this, 0, 0, 0, 10));
        test.setOnClickListener(v -> runTest());

        android.widget.Button connect = Ui.button(this, "CONNECT  →", Ui.ACCENT, 0xFF04121C);
        root.addView(connect, Ui.lp(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, this, 0, 0, 0, 16));
        connect.setOnClickListener(v -> runConnect());

        // ── status line ─────────────────────────────────────────
        status = Ui.text(this, "Not connected yet.", 13f, Ui.MUTED, false);
        status.setPadding(0, Ui.dp(this, 2), 0, 0);
        root.addView(status);

        TextView footer = Ui.text(this,
                "Tips: no scheme needed (10.66.1.19:3100 works). If the test fails, "
                        + "check the IP, the port, and that the server machine's firewall allows Node.",
                12f, 0xFF5B6979, false);
        footer.setPadding(0, Ui.dp(this, 26), 0, 0);
        root.addView(footer);

        setContentView(scroll);
    }

    /* ── actions ─────────────────────────────────────────────── */

    /** set the status line from a worker thread */
    private void statusFromThread(final int color, final String msg) {
        runOnUiThread(() -> {
            status.setTextColor(color);
            status.setText(msg);
        });
    }

    private void runTest() {
        final String url = Api.normalizeUrl(urlEdit.getText().toString());
        if (url == null) {
            status.setTextColor(Ui.AMBER);
            status.setText("Enter the server address first.");
            return;
        }
        status.setTextColor(Ui.ACCENT);
        status.setText("Pinging " + url + " …");
        new Thread(() -> {
            Api.Resp r = Api.get(url, "/api/health", null);
            if (r.ok() && r.json != null && r.json.has("zones")) {
                statusFromThread(Ui.GREEN, "✓ BhuRakshak server online — " + r.json.optInt("zones", 0)
                        + " risk zones · engine " + r.json.optString("engine", "v3"));
            } else {
                statusFromThread(Ui.RED, "✗ " + Api.diagnose(r));
            }
        }, "health-check").start();
    }

    private void runConnect() {
        final String url = Api.normalizeUrl(urlEdit.getText().toString());
        if (url == null) {
            status.setTextColor(Ui.AMBER);
            status.setText("Enter the server address first.");
            return;
        }
        final String name = nameEdit.getText().toString().trim();
        prefs.saveDeviceName(name);
        status.setTextColor(Ui.ACCENT);
        status.setText("Connecting & registering this device …");
        new Thread(() -> {
            Api.Resp health = Api.get(url, "/api/health", null);
            if (!health.ok() || health.json == null || !health.json.has("zones")) {
                statusFromThread(Ui.RED, "✗ Cannot reach the server. " + Api.diagnose(health));
                return;
            }
            // register the device (device auth — no website login needed on the phone)
            JSONObject payload = new JSONObject();
            try {
                payload.put("deviceId", prefs.deviceId());
                payload.put("name", name.isEmpty() ? prefs.deviceName() : name);
            } catch (Exception ignored) {
            }
            Api.Resp reg = Api.post(url, "/api/app/register", payload, prefs.deviceId());
            if (!reg.ok()) {
                statusFromThread(Ui.RED, "✗ Server reached, but registration failed: " + reg.message());
                return;
            }
            prefs.saveServer(url);
            statusFromThread(Ui.GREEN, "✓ Connected. Opening BhuRakshak …");
            startActivity(new Intent(ConnectActivity.this, MainActivity.class));
            finish();
        }, "connect").start();
    }

    @Override
    public void onBackPressed() {
        // from "change server": just go back to the app if a server is saved
        if (prefs.server() != null) super.onBackPressed();
        else moveTaskToBack(true);
    }
}
