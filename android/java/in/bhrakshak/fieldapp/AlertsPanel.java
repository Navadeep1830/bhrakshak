package in.bhrakshak.fieldapp;

import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * ALERTS tab — native notification centre: active-emergency banner,
 * live alert feed (levels L0–L4, colour-coded like the website map) and
 * the SMS fan-out inbox. No WebView involved — works the moment the app
 * opens, even while the map is still loading.
 */
public class AlertsPanel {

    public interface Host {
        Prefs prefs();

        String server();
    }

    private final Context ctx;
    private final Host host;
    private final LinearLayout list;
    private final ScrollView scroll;
    private int count = -1;
    private String updated = "";

    public AlertsPanel(Context ctx, Host host) {
        this.ctx = ctx;
        this.host = host;
        list = new LinearLayout(ctx);
        list.setOrientation(LinearLayout.VERTICAL);
        scroll = new ScrollView(ctx);
        scroll.setBackgroundColor(Ui.BG);
        scroll.setFillViewport(true);
        scroll.addView(list, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        empty("Connecting to the command server …");
    }

    public View view() {
        return scroll;
    }

    private void empty(String msg) {
        list.removeAllViews();
        TextView tv = Ui.text(ctx, msg, 14f, Ui.MUTED, false);
        tv.setGravity(Gravity.CENTER_HORIZONTAL);
        tv.setPadding(0, Ui.dp(ctx, 40), 0, 0);
        list.addView(tv);
    }

    /** Render the /api/app/notifications payload. */
    public void render(JSONObject data) {
        if (data == null) {
            empty("Connection lost — retrying …");
            return;
        }
        list.removeAllViews();
        JSONArray notifications = data.optJSONArray("notifications");
        JSONArray sms = data.optJSONArray("sms");
        int n = notifications == null ? 0 : notifications.length();

        // ── emergency banner: worst active notification ─────────
        JSONObject worst = null;
        for (int i = 0; i < n; i++) {
            JSONObject ev = notifications.optJSONObject(i);
            if (ev != null && ev.optInt("level", 0) >= 3) {
                worst = ev;
                break;
            }
        }
        if (worst != null) addBanner(worst);

        // ── header ──────────────────────────────────────────────
        LinearLayout head = Ui.row(ctx);
        head.setPadding(Ui.dp(ctx, 4), Ui.dp(ctx, 14), Ui.dp(ctx, 4), Ui.dp(ctx, 6));
        head.addView(Ui.text(ctx, "LIVE ALERT FEED", 12f, Ui.MUTED, true));
        TextView right = Ui.text(ctx, n + " events · " + Ui.shortTime(data.optString("serverTime")), 12f, Ui.MUTED, false);
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        rp.gravity = Gravity.END;
        right.setLayoutParams(rp);
        head.addView(right);
        list.addView(head);

        if (n == 0) {
            TextView none = Ui.text(ctx, "No alerts in the last 12 hours — all zones stable.", 14f, Ui.MUTED, false);
            none.setPadding(0, Ui.dp(ctx, 10), 0, Ui.dp(ctx, 10));
            list.addView(none);
        }

        for (int i = 0; i < n; i++) {
            JSONObject ev = notifications.optJSONObject(i);
            if (ev != null) addAlertCard(ev);
        }

        // ── SMS fan-out section ─────────────────────────────────
        if (sms != null && sms.length() > 0) {
            LinearLayout smsHead = Ui.row(ctx);
            smsHead.setPadding(Ui.dp(ctx, 4), Ui.dp(ctx, 20), Ui.dp(ctx, 4), Ui.dp(ctx, 6));
            smsHead.addView(Ui.text(ctx, "SMS FAN-OUT (DRY-RUN GATEWAY)", 12f, Ui.MUTED, true));
            list.addView(smsHead);
            int max = Math.min(sms.length(), 4);
            for (int i = 0; i < max; i++) {
                JSONObject s = sms.optJSONObject(i);
                if (s == null) continue;
                LinearLayout card = Ui.card(ctx, Ui.BG_CARD);
                LinearLayout row = Ui.row(ctx);
                String status = s.optString("status", "queued");
                int chipColor = "delivered".equals(status) ? Ui.GREEN : ("sent".equals(status) ? Ui.ACCENT : Ui.MUTED);
                TextView chip = Ui.text(ctx, status.toUpperCase(), 10f, chipColor, true);
                chip.setPadding(Ui.dp(ctx, 8), Ui.dp(ctx, 2), Ui.dp(ctx, 8), Ui.dp(ctx, 2));
                GradientDrawable cd = new GradientDrawable();
                cd.setColor(0xFF0B1017);
                cd.setCornerRadius(Ui.dp(ctx, 6));
                chip.setBackground(cd);
                row.addView(chip);
                TextView phone = Ui.text(ctx, " " + s.optString("phone", ""), 12f, Ui.MUTED, false);
                row.addView(phone);
                TextView t = Ui.text(ctx, Ui.shortTime(s.optString("queuedAt")), 11f, Ui.MUTED, false);
                LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
                tp.gravity = Gravity.END;
                t.setLayoutParams(tp);
                row.addView(t);
                card.addView(row);
                card.addView(Ui.text(ctx, s.optString("body", ""), 13f, Ui.TEXT, false));
                list.addView(card, Ui.lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, ctx, 4, 4, 4, 4));
            }
        }
    }

    private void addBanner(JSONObject ev) {
        int level = ev.optInt("level", 0);
        boolean critical = level >= 4;
        LinearLayout banner = new LinearLayout(ctx);
        banner.setOrientation(LinearLayout.VERTICAL);
        banner.setPadding(Ui.dp(ctx, 16), Ui.dp(ctx, 14), Ui.dp(ctx, 16), Ui.dp(ctx, 14));
        GradientDrawable d = new GradientDrawable();
        d.setColor(critical ? 0xFF7F1D2B : 0xFF7A4A0E);
        d.setCornerRadius(Ui.dp(ctx, 14));
        d.setStroke(2, critical ? Ui.RED : Ui.AMBER);
        banner.setBackground(d);

        LinearLayout row = Ui.row(ctx);
        TextView icon = Ui.text(ctx, critical ? "⚠ ACTIVE EMERGENCY" : "⚠ HIGH RISK", 13f,
                critical ? 0xFFFCA5A5 : 0xFFFDE68A, true);
        row.addView(icon);
        TextView lvl = Ui.text(ctx, "  L" + level, 13f, 0xFFFFFFFF, true);
        row.addView(lvl);
        TextView prob = Ui.text(ctx, " " + Math.round(ev.optDouble("probability", 0) * 100) + "%", 13f, 0xFFFFFFFF, false);
        row.addView(prob);
        banner.addView(row);

        banner.addView(Ui.text(ctx, ev.optString("title", "Landslide alert"), 18f, 0xFFFFFFFF, true));
        String body = ev.optString("body", "");
        if (!body.isEmpty()) banner.addView(Ui.text(ctx, body, 13f, 0xFFF1F5F9, false));
        String zone = ev.optString("zoneCode", "");
        String district = ev.optString("district", "");
        if (!zone.isEmpty() || !district.isEmpty()) {
            TextView meta = Ui.text(ctx, (zone.isEmpty() ? "" : zone + " · ") + district
                    + " · " + Ui.shortTime(ev.optString("createdAt")), 11f, 0xFFE2E8F0, false);
            meta.setPadding(0, Ui.dp(ctx, 6), 0, 0);
            banner.addView(meta);
        }
        list.addView(banner, Ui.lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, ctx, 4, 8, 4, 4));
    }

    private void addAlertCard(JSONObject ev) {
        int level = ev.optInt("level", 0);
        LinearLayout card = Ui.card(ctx, Ui.BG_CARD);

        LinearLayout row = Ui.row(ctx);
        TextView lvl = Ui.text(ctx, "L" + level, 11f, 0xFF070C14, true);
        lvl.setPadding(Ui.dp(ctx, 7), Ui.dp(ctx, 2), Ui.dp(ctx, 7), Ui.dp(ctx, 2));
        GradientDrawable ld = new GradientDrawable();
        ld.setColor(Ui.levelColor(level));
        ld.setCornerRadius(Ui.dp(ctx, 6));
        lvl.setBackground(ld);
        lvl.setTypeface(Typeface.DEFAULT_BOLD);
        row.addView(lvl);

        String kind = ev.optString("kind", "alert");
        TextView kindTv = Ui.text(ctx, "  " + kind.replace('-', ' ').toUpperCase(), 11f, Ui.MUTED, true);
        row.addView(kindTv);

        TextView time = Ui.text(ctx, Ui.shortTime(ev.optString("createdAt")), 11f, Ui.MUTED, false);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        tp.gravity = Gravity.END;
        time.setLayoutParams(tp);
        row.addView(time);
        card.addView(row);

        card.addView(Ui.text(ctx, ev.optString("title", ""), 15f, Ui.TEXT, true));
        String body = ev.optString("body", "");
        if (!body.isEmpty()) {
            TextView bodyTv = Ui.text(ctx, body, 12.5f, Ui.MUTED, false);
            bodyTv.setMaxLines(3);
            card.addView(bodyTv);
        }
        String zone = ev.optString("zoneCode", "");
        if (!zone.isEmpty()) {
            TextView zoneTv = Ui.text(ctx, zone + (ev.optString("district", "").isEmpty()
                    ? "" : " · " + ev.optString("district")), 11f, Ui.TEAL, true);
            card.addView(zoneTv);
        }
        list.addView(card, Ui.lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, ctx, 4, 4, 4, 4));
    }

    public int count() {
        return count;
    }

    public String updated() {
        return updated;
    }
}
