package in.bhrakshak.fieldapp;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;

/**
 * BhuRakshak Field — the Android client for the BhuRakshak landslide EWS.
 *
 * The app is a hardened WebView shell over the BhuRakshak server's /mobile
 * surface. It is NOT a static copy: the phone talks to the live engine
 * (register / bootstrap / routes / reports / notifications / SMS) of whatever
 * BhuRakshak server it is pointed at — typically the same laptop the command
 * center runs on, on the demo Wi-Fi/hotspot.
 *
 * First launch  → assets/start.html (pick the server URL, saved to prefs)
 * Later launches → <server>/mobile directly
 * Server down   → assets/error.html with retry + change-server
 */
public class MainActivity extends Activity {

    private static final String PREFS = "bhrakshak";
    private static final String KEY_SERVER = "server";
    private static final String START_URL = "file:///android_asset/start.html";
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_LOCATION = 1002;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private SharedPreferences prefs;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF070C14);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);              // localStorage + offline queue
        s.setGeolocationEnabled(true);             // GPS locate in the map
        s.setAllowFileAccess(true);                // asset pages (start/error)
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setSupportMultipleWindows(false);        // target=_blank stays in-shell → routed externally

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
                if (scheme.equals("file")) return false;               // local asset pages

                if (scheme.equals("http") || scheme.equals("https")) {
                    String origin = originOf(uri);
                    String saved = getServer();
                    if (saved != null && origin.equals(saved)) {
                        return false;                                   // our server → stay in app
                    }
                    // any other website (e.g. the Google Street View link) → system browser
                    openExternal(uri);
                    return true;
                }
                openExternal(uri);                                      // tel:, mailto:, geo:, intent:
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // remember the server the user connected to (origin only, path stripped)
                if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                    prefs.edit().putString(KEY_SERVER, originOf(Uri.parse(url))).apply();
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // only surface errors of the top-level page (not tiles/images)
                if (!request.isForMainFrame()) return;
                String failed = request.getUrl().toString();
                if (failed.startsWith("file://")) return;                // asset pages don't "fail"
                String server = getServer();
                String q = "";
                try {
                    // single-arg overload: the Charset overload needs API 33 (minSdk is 24)
                    q = server == null ? "" : "?server=" + URLEncoder.encode(server, "UTF-8");
                } catch (UnsupportedEncodingException ignored) { }
                view.loadUrl(START_PAGE_ERROR + q);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                // the field app is location-first — grant WebView geolocation,
                // subject to the Android runtime permission below
                if (hasLocationPermission()) {
                    cb.invoke(origin, true, false);
                } else {
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

        setContentView(webView);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);                    // resume where we were
            return;
        }

        String server = getServer();
        if (server != null) {
            webView.loadUrl(server + "/mobile");
        } else {
            webView.loadUrl(START_URL);
        }
    }

    /* ── helpers ─────────────────────────────────────────────── */

    private static final String START_PAGE_ERROR = "file:///android_asset/error.html";

    private String getServer() {
        String s = prefs.getString(KEY_SERVER, null);
        return (s == null || s.trim().isEmpty()) ? null : s.trim();
    }

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
        } catch (ActivityNotFoundException | SecurityException ignored) { }
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void requestLocationPermission() {
        requestPermissions(new String[]{
                android.Manifest.permission.ACCESS_FINE_LOCATION,
                android.Manifest.permission.ACCESS_COARSE_LOCATION
        }, REQ_LOCATION);
    }

    /* ── activity result (photo picker for field reports) ───── */

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

    /* ── lifecycle ───────────────────────────────────────────── */

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() { webView.onPause(); super.onPause(); }

    @Override
    protected void onResume() { super.onResume(); webView.onResume(); }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
