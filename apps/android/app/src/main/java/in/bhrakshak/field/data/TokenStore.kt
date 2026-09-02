package in.bhrakshak.field.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * JWT persistence. Access + refresh tokens live in EncryptedSharedPreferences
 * (AES-256, hardware-backed Keystore) — never in plain SharedPreferences.
 *
 * Same contract as the PWA: access token is attached to every request;
 * on 401 the sync worker transparently re-logs-in with the stored refresh
 * or falls back to the demo citizen, mirroring db.ts syncQueue().
 */
object TokenStore {
    private const val FILE = "bhrakshak_secure"
    private const val KEY_ACCESS = "bh_access"
    private const val KEY_REFRESH = "bh_refresh"
    private const val KEY_EMAIL = "bh_email"

    private fun prefs(ctx: Context) = EncryptedSharedPreferences.create(
        ctx,
        FILE,
        MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun save(ctx: Context, access: String, refresh: String?, email: String) {
        prefs(ctx).edit()
            .putString(KEY_ACCESS, access)
            .putString(KEY_REFRESH, refresh)
            .putString(KEY_EMAIL, email)
            .apply()
    }

    fun access(ctx: Context): String? = prefs(ctx).getString(KEY_ACCESS, null)
    fun refresh(ctx: Context): String? = prefs(ctx).getString(KEY_REFRESH, null)
    fun email(ctx: Context): String? = prefs(ctx).getString(KEY_EMAIL, null)

    fun clear(ctx: Context) = prefs(ctx).edit().clear().apply()
}
