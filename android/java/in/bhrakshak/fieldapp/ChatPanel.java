package in.bhrakshak.fieldapp;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * CHAT tab — native two-way messaging with the command centre.
 *
 * The field officer sends SOS / help / status / info messages (optionally
 * with GPS position); command staff reply from the website's Operations →
 * Field messages inbox; this thread shows both sides live (10 s poll).
 * Failed sends are queued locally and auto-flushed when connectivity
 * returns.
 */
public class ChatPanel {

    public interface Host {
        Prefs prefs();

        String server();

        /** best-effort last known GPS position as {lat, lon} or null */
        double[] location();

        void onSentRefreshHint();
    }

    private static final String[] CATS = {"sos", "help", "status", "info"};
    private static final int[] CAT_COLORS = {0xFF7F1D2B, 0xFF7A4A0E, 0xFF0E3A5C, 0xFF14202C};
    private static final int[] CAT_TEXT = {0xFFFCA5A5, 0xFFFDE68A, 0xFF7DD3FC, Ui.MUTED};

    private final Context ctx;
    private final Host host;
    private final LinearLayout threadList;
    private final ScrollView threadScroll;
    private final EditText input;
    private final CheckBox attachLoc;
    private String category = "info";

    public ChatPanel(Context ctx, Host host) {
        this.ctx = ctx;
        this.host = host;

        LinearLayout root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.BG);

        threadScroll = new ScrollView(ctx);
        threadList = new LinearLayout(ctx);
        threadList.setOrientation(LinearLayout.VERTICAL);
        threadList.setPadding(Ui.dp(ctx, 10), Ui.dp(ctx, 8), Ui.dp(ctx, 10), Ui.dp(ctx, 8));
        threadScroll.addView(threadList, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        threadScroll.setFillViewport(true);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        root.addView(threadScroll, sp);

        emptyThread();

        // ── composer ────────────────────────────────────────────
        LinearLayout composer = new LinearLayout(ctx);
        composer.setOrientation(LinearLayout.VERTICAL);
        composer.setPadding(Ui.dp(ctx, 10), Ui.dp(ctx, 8), Ui.dp(ctx, 10), Ui.dp(ctx, 6));
        GradientDrawable cd = new GradientDrawable();
        cd.setColor(Ui.BG_CARD);
        cd.setCornerRadius(Ui.dp(ctx, 14));
        composer.setBackground(cd);

        LinearLayout chips = new LinearLayout(ctx);
        chips.setOrientation(LinearLayout.HORIZONTAL);
        for (int i = 0; i < CATS.length; i++) {
            final String cat = CATS[i];
            Button chip = Ui.button(ctx, cat.toUpperCase(), CAT_COLORS[i], CAT_TEXT[i]);
            LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            cp.setMargins(i == 0 ? 0 : Ui.dp(ctx, 6), 0, 0, 0);
            chip.setLayoutParams(cp);
            chip.setPadding(0, Ui.dp(ctx, 8), 0, Ui.dp(ctx, 8));
            chip.setOnClickListener(v -> setCategory(cat));
            chips.addView(chip);
            if ("info".equals(cat)) styleSelected(chip); // default selection
        }
        composer.addView(chips);

        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        input = new EditText(ctx);
        input.setHint("Message to command centre …");
        input.setTextSize(15f);
        input.setTextColor(Ui.TEXT);
        input.setHintTextColor(0xFF5B6979);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        input.setBackgroundColor(0x00000000);
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        input.setLayoutParams(ip);
        row.addView(input);

        attachLoc = Ui.check(ctx, "📍");
        attachLoc.setPadding(0, 0, Ui.dp(ctx, 6), 0);
        row.addView(attachLoc);

        Button send = Ui.button(ctx, "SEND", Ui.ACCENT, 0xFF04121C);
        send.setOnClickListener(v -> send());
        row.addView(send);
        composer.addView(row, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        root.addView(composer, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        rootView = root;
    }

    private LinearLayout rootView;
    private Button selectedChip;

    public View view() {
        return rootView;
    }

    private void styleSelected(Button chip) {
        if (selectedChip != null) {
            GradientDrawable reset = new GradientDrawable();
            reset.setColor(Ui.BG_CARD);
            reset.setCornerRadius(Ui.dp(ctx, 10));
            selectedChip.setBackground(reset);
            selectedChip.setTextColor(Ui.MUTED);
        }
        selectedChip = chip;
        GradientDrawable d = new GradientDrawable();
        d.setColor(Ui.ACCENT);
        d.setCornerRadius(Ui.dp(ctx, 10));
        chip.setBackground(d);
        chip.setTextColor(0xFF04121C);
    }

    private void setCategory(String cat) {
        category = cat;
        // restyle chips
        LinearLayout chips = (LinearLayout) selectedChip.getParent();
        for (int i = 0; i < chips.getChildCount(); i++) {
            View v = chips.getChildAt(i);
            if (v instanceof Button) {
                Button b = (Button) v;
                if (b.getText().toString().toLowerCase().equals(cat)) styleSelected(b);
            }
        }
    }

    private void emptyThread() {
        threadList.removeAllViews();
        TextView tv = Ui.text(ctx, "No messages yet.\nSend an SOS, request help, or report status — "
                + "command staff see it instantly in Operations → Field messages.", 13f, Ui.MUTED, false);
        tv.setGravity(Gravity.CENTER_HORIZONTAL);
        tv.setPadding(0, Ui.dp(ctx, 40), 0, Ui.dp(ctx, 10));
        threadList.addView(tv);
    }

    /** Render the /api/app/messages thread (newest at the bottom). */
    public void render(JSONObject data) {
        if (data == null) {
            return;
        }
        JSONArray messages = data.optJSONArray("messages");
        if (messages == null || messages.length() == 0) {
            emptyThread();
            return;
        }
        threadList.removeAllViews();
        for (int i = 0; i < messages.length(); i++) {
            JSONObject m = messages.optJSONObject(i);
            if (m != null) addBubble(m);
        }
        threadScroll.post(() -> threadScroll.fullScroll(ScrollView.FOCUS_DOWN));
    }

    private void addBubble(JSONObject m) {
        boolean fromCommand = "command".equals(m.optString("authorRole", "field"));
        boolean urgent = m.optInt("priority", 0) > 0 || "sos".equals(m.optString("category"));

        LinearLayout bubble = new LinearLayout(ctx);
        bubble.setOrientation(LinearLayout.VERTICAL);
        bubble.setPadding(Ui.dp(ctx, 12), Ui.dp(ctx, 9), Ui.dp(ctx, 12), Ui.dp(ctx, 9));
        GradientDrawable d = new GradientDrawable();
        d.setColor(fromCommand ? 0xFF0E3A5C : (urgent ? 0xFF7F1D2B : Ui.BG_CARD_HI));
        d.setCornerRadius(Ui.dp(ctx, 12));
        d.setStroke(fromCommand ? 1 : 0, Ui.ACCENT);
        bubble.setBackground(d);

        LinearLayout meta = new LinearLayout(ctx);
        meta.setOrientation(LinearLayout.HORIZONTAL);
        String cat = m.optString("category", "info");
        TextView who = Ui.text(ctx, (fromCommand ? "▣ COMMAND" : "▶ ") + m.optString("authorName", "Field")
                + (cat.isEmpty() || "info".equals(cat) ? "" : " · " + cat.toUpperCase()), 10.5f,
                fromCommand ? Ui.ACCENT : (urgent ? 0xFFFCA5A5 : Ui.MUTED), true);
        meta.addView(who);
        TextView time = Ui.text(ctx, Ui.shortTime(m.optString("createdAt")), 10.5f, Ui.MUTED, false);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        tp.gravity = Gravity.END;
        time.setLayoutParams(tp);
        meta.addView(time);
        bubble.addView(meta);

        bubble.addView(Ui.text(ctx, m.optString("body", ""), 14.5f, Ui.TEXT, false));

        String zone = m.optString("zoneCode", "");
        if (!zone.isEmpty() && zone.length() > 0) {
            TextView z = Ui.text(ctx, "📍 " + zone, 10.5f, Ui.TEAL, true);
            bubble.addView(z);
        }

        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.setMargins(0, Ui.dp(ctx, 4), 0, Ui.dp(ctx, 4));
        if (fromCommand) bp.leftMargin = Ui.dp(ctx, 26);
        else bp.rightMargin = Ui.dp(ctx, 26);
        threadList.addView(bubble, bp);
    }

    /* ── sending ─────────────────────────────────────────────── */

    private void send() {
        final String text = input.getText().toString().trim();
        if (text.isEmpty()) {
            Toast.makeText(ctx, "Type a message first", Toast.LENGTH_SHORT).show();
            return;
        }
        final JSONObject payload = new JSONObject();
        try {
            payload.put("category", category);
            payload.put("body", text);
            if (attachLoc.isChecked()) {
                double[] loc = host.location();
                if (loc != null) {
                    payload.put("lat", loc[0]);
                    payload.put("lon", loc[1]);
                } else {
                    Toast.makeText(ctx, "No GPS fix — sending without position", Toast.LENGTH_SHORT).show();
                }
            }
        } catch (Exception ignored) {
        }
        input.setText("");
        Toast.makeText(ctx, category.equals("sos") ? "SOS sending …" : "Sending …", Toast.LENGTH_SHORT).show();
        final String cat = category;
        new Thread(() -> {
            Api.Resp r = Api.post(host.server(), "/api/app/message", payload, host.prefs().deviceId());
            if (r.ok()) {
                final String zone = r.json == null ? "" : r.json.optString("zoneCode", "");
                host.onSentRefreshHint();
                uiToast("✓ Delivered" + (zone.isEmpty() ? "" : " — attributed to zone " + zone));
            } else {
                host.prefs().addPending(payload);
                uiToast("✗ Offline — queued (" + host.prefs().pending().size() + " pending). "
                        + "It will auto-send when the connection returns.");
            }
        }, "chat-send").start();
        if (cat.equals("sos")) {
            Toast.makeText(ctx, "SOS — command centre will be alerted", Toast.LENGTH_LONG).show();
        }
    }

    private void uiToast(final String msg) {
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() ->
                Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show());
    }
}
