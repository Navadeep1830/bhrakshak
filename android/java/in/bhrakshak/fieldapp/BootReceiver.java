package in.bhrakshak.fieldapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Restarts the background alert poller after the phone reboots, so the
 * officer keeps receiving heads-up landslide alerts without opening the
 * app. Safe no-op when no server has been configured yet.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        Prefs prefs = new Prefs(context);
        if (prefs.server() == null) return;
        try {
            Intent svc = new Intent(context, AlertService.class);
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(svc);
            else context.startService(svc);
        } catch (Exception ignored) {
            // some OEMs restrict FGS-from-boot; the app itself will start it on next open
        }
    }
}
