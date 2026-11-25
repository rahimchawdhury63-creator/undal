/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

package app.undal.rider.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** The two tokens a session is, as far as the client is concerned. */
data class Tokens(val access: String, val refresh: String)

/**
 * Where the session lives between launches.
 *
 * `EncryptedSharedPreferences` keys are held by the Android keystore, so a rooted phone with the
 * data directory pulled off it does not hand anybody a rider's session. `allowBackup` is false in
 * the manifest for the same reason: an encrypted file restored onto another device is a file whose
 * key does not exist there.
 */
class TokenStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "undal.session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun load(): Tokens? {
        val access = prefs.getString("access", null) ?: return null
        val refresh = prefs.getString("refresh", null) ?: return null
        return Tokens(access, refresh)
    }

    fun save(tokens: Tokens) {
        prefs.edit().putString("access", tokens.access).putString("refresh", tokens.refresh).apply()
    }

    /** A 401 clears the pair: half a session is worse than none, because it looks signed in. */
    fun clear() {
        prefs.edit().remove("access").remove("refresh").apply()
    }
}
