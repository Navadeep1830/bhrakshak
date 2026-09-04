package in.bhrakshak.fieldapp;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;

/**
 * Minimal HTTP/JSON client for the BhuRakshak server, built on plain
 * HttpURLConnection + org.json (both ship with Android — zero deps).
 *
 * ALL methods are blocking and MUST be called off the UI thread.
 */
public class Api {

    public static class Resp {
        public final int code;          // HTTP status (0 = transport failure)
        public final JSONObject json;   // parsed body (null if not JSON)
        public final String error;      // classified transport error code
        public final String detail;     // raw detail (exception message / body)

        Resp(int code, JSONObject json, String error, String detail) {
            this.code = code;
            this.json = json;
            this.error = error;
            this.detail = detail;
        }

        public boolean ok() {
            return code >= 200 && code < 300;
        }

        /** Best-effort human text from an error body: {"error": "..."} */
        public String message() {
            if (json != null && json.has("error")) {
                return json.optJSONObject("error") == null
                        ? json.optString("error", detail)
                        : json.optJSONObject("error").toString();
            }
            return detail == null ? "" : detail;
        }
    }

    public static Resp get(String server, String path, String deviceId) {
        return exchange("GET", server + path, null, deviceId);
    }

    public static Resp post(String server, String path, JSONObject payload, String deviceId) {
        return exchange("POST", server + path, payload == null ? new JSONObject() : payload, deviceId);
    }

    private static Resp exchange(String method, String urlStr, JSONObject payload, String deviceId) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(7000);
            conn.setReadTimeout(12000);
            conn.setRequestProperty("Accept", "application/json");
            if (deviceId != null) conn.setRequestProperty("x-device-id", deviceId);
            if ("POST".equals(method)) {
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setDoOutput(true);
                byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bytes);
                    os.flush();
                }
            } else {
                conn.setRequestMethod("GET");
            }

            int code = conn.getResponseCode();
            BufferedReader reader = new BufferedReader(new InputStreamReader(
                    code >= 400 ? conn.getErrorStream() : conn.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            reader.close();
            String body = sb.toString();
            JSONObject json = null;
            try {
                if (body.startsWith("{") || body.startsWith("[")) json = new JSONObject(body);
            } catch (Exception ignored) {
            }
            return new Resp(code, json, null, body.length() > 300 ? body.substring(0, 300) : body);

        } catch (UnknownHostException e) {
            return new Resp(0, null, "HOST_NOT_FOUND", e.getMessage());
        } catch (ConnectException e) {
            return new Resp(0, null, "CONN_REFUSED", e.getMessage());
        } catch (SocketTimeoutException e) {
            return new Resp(0, null, "TIMEOUT", e.getMessage());
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            if (msg.contains("EHOSTUNREACH") || msg.contains("No route to host"))
                return new Resp(0, null, "NO_ROUTE", msg);
            if (msg.contains("ECONNREFUSED")) return new Resp(0, null, "CONN_REFUSED", msg);
            if (msg.contains("EAI_AGAIN") || msg.contains("Unable to resolve"))
                return new Resp(0, null, "HOST_NOT_FOUND", msg);
            return new Resp(0, null, "NETWORK", msg);
        } finally {
            if (conn != null) try { conn.disconnect(); } catch (Exception ignored) {}
        }
    }

    /** Turn a classified transport error into an actionable diagnosis. */
    public static String diagnose(Resp r) {
        if (r == null) return "No response.";
        switch (r.error == null ? "" : r.error) {
            case "HOST_NOT_FOUND":
                return "Host not found. Check the IP address — and that the phone and the machine "
                        + "running BhuRakshak are on the SAME Wi-Fi / hotspot.";
            case "CONN_REFUSED":
                return "Connection refused. The machine is reachable but nothing is listening on that port. "
                        + "On the server run:  npm run dev -- -p <port>   and double-check the port number.";
            case "NO_ROUTE":
                return "No route to host. The IP is not reachable from this phone — verify both are on the "
                        + "same network and the server machine's firewall allows Node.js / the port.";
            case "TIMEOUT":
                return "No response in time. Usually a firewall silently dropping packets, or a wrong port. "
                        + "Allow Node.js through the server machine's firewall on private networks.";
            case "NETWORK":
                return "Network error: " + (r.detail == null ? "" : r.detail);
            default:
                return "HTTP " + r.code + " — " + r.message();
        }
    }

    /** Normalize a user-typed server URL ("10.0.0.5:3100" → "http://10.0.0.5:3100"). */
    public static String normalizeUrl(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty()) return null;
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        if (!s.contains("://")) s = "http://" + s;
        return s;
    }
}
