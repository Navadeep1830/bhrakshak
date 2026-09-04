package in.bhrakshak.fieldapp;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;

/**
 * BhuRakshak Field — native Android client (v2.0).
 *
 * Four native tabs:
 *   ⚠ ALERTS — live alert feed + emergency banner (native, no WebView)
 *   💬 CHAT  — two-way messaging with the command centre (native)
 *   🗺 MAP    — the full field app: street map, alternative routes, hazard
 *              marks, street view, crack-photo reports (server's /mobile)
 *   ☰ STATUS — connection, I'M SAFE, manual rain gauge
 *
 * A foreground service (AlertService) keeps polling for alerts in the
 * background and raises heads-up notifications + the full-screen
 * emergency alarm even when the app is closed.
 */
public class MainActivity extends Activity implements AlertsPanel.Host, ChatPanel.Host, StatusPanel.Host {

    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_LOCATION = 1002;
    private static final int REQ_NOTIF = 1003;
    private static final long POLL_MS = 10_000L;

    private Prefs prefs;
    private FrameLayout content;
    private LinearLayout navBar;
    private TextView liveChip;
    private AlertsPanel alertsPanel;
    private ChatPanel chatPanel;
    private StatusPanel statusPanel;
    private WebView mapView;
    private boolean mapInited;
    private ValueCallback<Uri[]> fileCallback;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (alive) pollCycle();
            if (alive) ui.postDelayed(this, POLL_MS);
        }
    };
    private boolean alive;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = new Prefs(this);

        if (prefs.server() == null) {
            startActivity(new Intent(this, ConnectActivity.class));
            finish();
            return;
        }

        buildUi();

        // notification permission (Android 13+) — needed for heads-up alerts
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
        }
    }

    /* ── UI shell ─────────────────────────────────────────────── */

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.BG);

        // header
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(Ui.dp(this, 16), Ui.dp(this, 10), Ui.dp(this, 16), Ui.dp(this, 10));
        GradientDrawable hd = new GradientDrawable();
        hd.setColor(0xFF0A121C);
        header.setBackground(hd);
        TextView title = Ui.text(this, "BHURAKSHAK", 17f, Ui.TEXT, true);
        title.setLetterSpacing(0.12f);
        header.addView(title);
        liveChip = Ui.text(this, "○ …", 11f, Ui.MUTED, true);
        liveChip.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        lp.gravity = Gravity.END;
        liveChip.setLayoutParams(lp);
        header.addView(liveChip);
        root.addView(header, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // content
        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        // bottom nav
        navBar = new LinearLayout(this);
        navBar.setOrientation(LinearLayout.HORIZONTAL);
        GradientDrawable nd = new GradientDrawable();
        nd.setColor(0xFF0A121C);
        navBar.setBackground(nd);
        root.addView(navBar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        addTab("⚠\nALERTS");
        addTab("💬\nCHAT");
        addTab("🗺\nMAP");
        addTab("☰\nSTATUS");

        setContentView(root);
        selectTab(0);
    }

    private void addTab(String label) {
        Button tab = new Button(this);
        tab.setText(label);
        tab.setTextSize(11f);
        tab.setAllCaps(false);
        tab.setTextColor(Ui.MUTED);
        tab.setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 8));
        tab.setBackground(null);
        tab.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        tab.setLayoutParams(p);
        tab.setOnClickListener(v -> selectTab(navBar.indexOfChild(v)));
        navBar.addView(tab);
    }

    private void selectTab(int index) {
        for (int i = 0; i < navBar.getChildCount(); i++) {
            Button b = (Button) navBar.getChildAt(i);
            b.setTextColor(i == index ? Ui.ACCENT : Ui.MUTED);
            b.setTypeface(i == index ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        }
        content.removeAllViews();
        if (index == 0) content.addView(alertsPanel().view());
        else if (index == 1) content.addView(chatPanel().view());
        else if (index == 2) content.addView(mapView());
        else {
            content.addView(statusPanel().view());
            refreshHealth();
        }
    }

    private AlertsPanel alertsPanel() {
        if (alertsPanel == null) alertsPanel = new AlertsPanel(this, this);
        return alertsPanel;
    }

    private ChatPanel chatPanel() {
        if (chatPanel == null) chatPanel = new ChatPanel(this, this);
        return chatPanel;
    }

    private StatusPanel statusPanel() {
        if (statusPanel == null) statusPanel = new StatusPanel(this, this);
        return statusPanel;
    }

    /* ── the MAP tab: the full server /mobile app in a WebView ── */

    @SuppressLint("SetJavaScriptEnabled")
    private View mapView() {
        if (mapInited && mapView != null) return mapView;
        mapInited = true;
        mapView = new WebView(this);
        mapView.setBackgroundColor(0xFF070C14);
        WebSettings s = mapView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // localStorage + offline queue
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(true);                   // asset error page
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        mapView.addJavascriptInterface(new Bridge(), "Bhrak");

        mapView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
                if (scheme.equals("file")) return false;
                if (scheme.equals("http") || scheme.equals("https")) {
                    String origin = originOf(uri);
                    String saved = prefs.server();
                    if (saved != null && origin.equals(saved)) return false;   // our server stays in app
                    openExternal(uri);                                        // street view etc → browser
                    return true;
                }
                openExternal(uri);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                String failed = request.getUrl().toString();
                if (failed.startsWith("file://")) return;
                String q = "";
                try {
                    q = prefs.server() == null ? "" : "?server=" + URLEncoder.encode(prefs.server(), "UTF-8");
                } catch (UnsupportedEncodingException ignored) {
                }
                view.loadUrl("file:///android_asset/error.html" + q);
            }
        });

        mapView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (hasLocationPermission()) cb.invoke(origin, true, false);
                else {
                    requestLocationPermission();
                    cb.invoke(origin, false, false);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "No file picker on this device", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        mapView.loadUrl(prefs.server() + "/mobile");
        return mapView;
    }

    /** JS bridge for the offline error page (retry / change server). */
    private class Bridge {
        @JavascriptInterface
        public void retry() {
            ui.post(() -> {
                if (mapView != null) mapView.loadUrl(prefs.server() + "/mobile");
            });
        }

        @JavascriptInterface
        public void changeServer() {
            ui.post(() -> startActivity(new Intent(MainActivity.this, ConnectActivity.class)));
        }
    }

    /* ── polling loop (alerts + chat + health, every 10 s) ───── */

    private void pollCycle() {
        final String server = prefs.server();
        final String deviceId = prefs.deviceId();
        new Thread(() -> {
            boolean live = false;
            // 1. notifications → alerts tab
            Api.Resp notif = Api.get(server, "/api/app/notifications", deviceId);
            final JSONObject notifData = notif.ok() ? notif.json : null;
            if (notif.ok()) live = true;
            // 2. message thread → chat tab (also flushes the offline queue)
            Api.Resp msgs = flushPendingThenFetch(server, deviceId);
            final JSONObject msgData = msgs.ok() ? msgs.json : null;
            if (msgs.ok()) live = true;
            // 3. health → status tab chip
            Api.Resp health = Api.get(server, "/api/health", null);
            final JSONObject healthData = health.ok() ? health.json : null;
            if (health.ok()) live = true;

            final boolean isLive = live;
            ui.post(() -> {
                if (isFinishing() || isDestroyedCompat()) return;
                setLive(isLive);
                alertsPanel().render(notifData);
                chatPanel().render(msgData);
                statusPanel().renderHealth(healthData);
            });
        }, "poll").start();
    }

    private boolean isDestroyedCompat() {
        return Build.VERSION.SDK_INT >= 17 && isDestroyed();
    }

    private void refreshHealth() {
        final String server = prefs.server();
        new Thread(() -> {
            Api.Resp r = Api.get(server, "/api/health", null);
            final JSONObject data = r.ok() ? r.json : null;
            ui.post(() -> statusPanel().renderHealth(data));
        }, "health").start();
    }

    private void setLive(boolean live) {
        liveChip.setText(live ? "● LIVE" : "○ OFFLINE");
        liveChip.setTextColor(live ? Ui.GREEN : Ui.RED);
    }

    /** Send every queued (offline) message, then fetch the thread. */
    private Api.Resp flushPendingThenFetch(String server, String deviceId) {
        java.util.List<JSONObject> pending = prefs.pending();
        for (int i = 0; i < pending.size(); i++) {
            JSONObject p = pending.get(i);
            try {
                Api.Resp r = Api.post(server, "/api/app/message", p, deviceId);
                if (r.ok()) {
                    prefs.removePending(0);
                    ui.post(() -> Toast.makeText(this,
                            "✓ Offline message delivered: " + p.optString("body", "").substring(0,
                                    Math.min(40, p.optString("body", "").length())),
                            Toast.LENGTH_SHORT).show());
                } else {
                    break; // still offline — keep the queue, try next cycle
                }
            } catch (Exception e) {
                break;
            }
        }
        return Api.get(server, "/api/app/messages", deviceId);
    }

    /* ── Host interfaces (panels) ────────────────────────────── */

    @Override
    public Prefs prefs() {
        return prefs;
    }

    @Override
    public String server() {
        return prefs.server();
    }

    @Override
    public double[] location() {
        if (!hasLocationPermission()) return null;
        try {
            LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
            Location best = null;
            for (String provider : lm.getProviders(true)) {
                try {
                    Location l = lm.getLastKnownLocation(provider);
                    if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                } catch (SecurityException ignored) {
                }
            }
            if (best != null) return new double[]{best.getLatitude(), best.getLongitude()};
        } catch (Exception ignored) {
        }
        return null;
    }

    @Override
    public void requestLocationPermission() {
        requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
    }

    @Override
    public void onSentRefreshHint() {
        // nudge the poll loop so the sent message shows up immediately
        ui.removeCallbacks(poll);
        ui.post(poll);
    }

    /* ── lifecycle ────────────────────────────────────────────── */

    @Override
    protected void onStart() {
        super.onStart();
        alive = true;
        // background alert polling + heads-up notifications (survives app close)
        try {
            Intent svc = new Intent(this, AlertService.class);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc);
            else startService(svc);
        } catch (Exception e) {
            Toast.makeText(this, "Background alerts unavailable: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
        // refresh device registration (heartbeat → shows online on the website)
        final String server = prefs.server();
        final String deviceId = prefs.deviceId();
        new Thread(() -> {
            JSONObject payload = new JSONObject();
            try {
                payload.put("deviceId", deviceId);
                payload.put("name", prefs.deviceName());
            } catch (Exception ignored) {
            }
            Api.post(server, "/api/app/register", payload, deviceId);
        }, "register").start();
        ui.removeCallbacks(poll);
        ui.post(poll);
    }

    @Override
    protected void onStop() {
        alive = false;
        ui.removeCallbacks(poll);
        super.onStop();
    }

    @Override
    protected void onPause() {
        if (mapView != null) mapView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (mapView != null) mapView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (mapView != null) mapView.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (mapView != null && content.indexOfChild(mapView) >= 0 && mapView.canGoBack()) {
            mapView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_FILE_CHOOSER) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (fileCallback == null) return;
        Uri[] results = null;
        if (resultCode == Activity.RESULT_OK && data != null) {
            results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        }
        fileCallback.onReceiveValue(results);
        fileCallback = null;
    }

    /* ── helpers ──────────────────────────────────────────────── */

    private static String originOf(Uri uri) {
        StringBuilder sb = new StringBuilder();
        sb.append(uri.getScheme()).append("://").append(uri.getHost());
        int port = uri.getPort();
        if (port > 0) sb.append(':').append(port);
        return sb.toString();
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException | SecurityException ignored) {
        }
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }
}
