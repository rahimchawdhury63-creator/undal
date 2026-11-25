/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

package app.undal.rider.auth

import app.undal.api.ApiRoutes
import java.io.IOException
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Signing in, and staying signed in.
 *
 * Two routes and no invented ones: `POST /v1/auth/login` with a phone and a password, and
 * `POST /v1/auth/refresh` with the refresh token when the access token has expired. Both are
 * `ApiRoute` constants, so the day the Worker renames one this stops compiling.
 */
class AuthApi(private val baseUrl: String, private val client: OkHttpClient = OkHttpClient()) {
    private val json = "application/json; charset=utf-8".toMediaType()

    fun login(phone: String, password: String, fingerprint: String): Tokens {
        val body = JSONObject()
            .put("phone", phone)
            .put("password", password)
            .put("fingerprint", fingerprint)
            .put("platform", "ANDROID")
        return tokens(post(ApiRoutes.AUTH_LOGIN, body.toString()))
    }

    fun refresh(refreshToken: String): Tokens {
        val body = JSONObject().put("refreshToken", refreshToken)
        return tokens(post(ApiRoutes.AUTH_REFRESH, body.toString()))
    }

    private fun post(route: app.undal.api.ApiRoute, payload: String): JSONObject {
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + route.path)
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .post(payload.toRequestBody(json))
            .build()
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val parsed = if (text.isEmpty()) JSONObject() else JSONObject(text)
            if (!response.isSuccessful) {
                val code = parsed.optJSONObject("error")?.optString("code").orEmpty()
                throw IOException(if (code.isEmpty()) "HTTP ${response.code}" else code)
            }
            return parsed.optJSONObject("data") ?: parsed
        }
    }

    private fun tokens(data: JSONObject): Tokens {
        val access = data.optString("accessToken")
        val refresh = data.optString("refreshToken")
        if (access.isEmpty() || refresh.isEmpty()) throw IOException("AUTH_NO_TOKENS")
        return Tokens(access, refresh)
    }
}
