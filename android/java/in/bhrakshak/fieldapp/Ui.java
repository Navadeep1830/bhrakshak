package in.bhrakshak.fieldapp;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Small programmatic-UI toolkit (dark brand theme) so every screen is
 * pure framework widgets — no XML layouts, no external libraries.
 */
public class Ui {

    // brand palette (matches the web command centre)
    public static final int BG = 0xFF070C14;
    public static final int BG_CARD = 0xFF111A26;
    public static final int BG_CARD_HI = 0xFF18232F;
    public static final int ACCENT = 0xFF38BDF8;
    public static final int TEAL = 0xFF2DD4BF;
    public static final int RED = 0xFFEF4444;
    public static final int AMBER = 0xFFF59E0B;
    public static final int GREEN = 0xFF22C55E;
    public static final int TEXT = 0xFFE7EDF4;
    public static final int MUTED = 0xFF8B99A9;

    public static int dp(Context c, float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v,
                c.getResources().getDisplayMetrics());
    }

    public static TextView text(Context c, String s, float sp, int color, boolean bold) {
        TextView tv = new TextView(c);
        tv.setText(s == null ? "" : s);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        tv.setTextColor(color);
        if (bold) tv.setTypeface(Typeface.DEFAULT_BOLD);
        return tv;
    }

    public static TextView label(Context c, String s) {
        return text(c, s, 13f, MUTED, true);
    }

    public static EditText edit(Context c, String hint) {
        EditText et = new EditText(c);
        et.setHint(hint);
        et.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f);
        et.setTextColor(TEXT);
        et.setHintTextColor(0xFF5B6979);
        et.setBackgroundColor(Color.TRANSPARENT);
        et.setPadding(0, dp(c, 6), 0, dp(c, 6));
        return et;
    }

    public static Button button(Context c, String label, int bg, int fg) {
        Button b = new Button(c);
        b.setText(label);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f);
        b.setTextColor(fg);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setAllCaps(false);
        b.setPadding(dp(c, 18), dp(c, 10), dp(c, 18), dp(c, 10));
        GradientDrawable d = new GradientDrawable();
        d.setColor(bg);
        d.setCornerRadius(dp(c, 10));
        b.setBackground(d);
        return b;
    }

    public static CheckBox check(Context c, String label) {
        CheckBox cb = new CheckBox(c);
        cb.setText(label);
        cb.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
        cb.setTextColor(MUTED);
        return cb;
    }

    /** Rounded dark card container. */
    public static LinearLayout card(Context c, int bgColor) {
        LinearLayout card = new LinearLayout(c);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(c, 14), dp(c, 12), dp(c, 14), dp(c, 12));
        GradientDrawable d = new GradientDrawable();
        d.setColor(bgColor);
        d.setCornerRadius(dp(c, 12));
        d.setStroke(1, 0xFF1F2B38);
        card.setBackground(d);
        return card;
    }

    public static LinearLayout row(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    public static LinearLayout.LayoutParams lp(int w, int h, Context c, int mL, int mT, int mR, int mB) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h);
        p.setMargins(dp(c, mL), dp(c, mT), dp(c, mR), dp(c, mB));
        return p;
    }

    public static LinearLayout.LayoutParams matchWrap(Context c) {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    /** match/wrap with a top margin — spacing between stacked cards. */
    public static LinearLayout.LayoutParams matchWrap2(Context c) {
        LinearLayout.LayoutParams p = matchWrap(c);
        p.setMargins(0, dp(c, 10), 0, 0);
        return p;
    }

    /** Risk-level colour, same scale as the website (L0–L4). */
    public static int levelColor(int level) {
        switch (level) {
            case 4: return 0xFFF43F5E;
            case 3: return 0xFFF59E0B;
            case 2: return 0xFFEAB308;
            case 1: return 0xFF22D3EE;
            default: return 0xFF64748B;
        }
    }

    /** "12:04" from an ISO timestamp (server sends UTC ISO). */
    public static String shortTime(String iso) {
        if (iso == null) return "";
        try {
            String s = iso.length() > 19 ? iso.substring(0, 19) : iso;
            String hh = s.substring(11, 13);
            String mm = s.substring(14, 16);
            return hh + ":" + mm;
        } catch (Exception e) {
            return iso.length() > 16 ? iso.substring(11, 16) : iso;
        }
    }
}
