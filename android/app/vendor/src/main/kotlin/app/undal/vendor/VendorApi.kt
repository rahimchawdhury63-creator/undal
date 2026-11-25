/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

package app.undal.vendor

import app.undal.api.ApiRoute
import app.undal.api.ApiRoutes
import java.io.IOException
import java.util.UUID
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * What a kitchen can do through the API today: read itself, pause, resume.
 *
 * There is deliberately no order-intake call here, and its absence is not an oversight in this file
 * — the route table has no vendor-scoped order route, so a kitchen cannot see the orders it is
 * meant to cook. That is recorded in STATUS.md as a product gap rather than papered over with a
 * screen that would show nothing.
 */
class VendorApi(private val baseUrl: String, private val client: OkHttpClient = OkHttpClient()) {
    data class Vendor(val id: String, val name: String, val status: String, val openState: String)

    fun vendor(id: String, token: String?): Vendor {
        val data = send(ApiRoutes.VENDORS_ID, "GET", token, UUID.randomUUID().toString(), id)
        return Vendor(
            id = data.optString("id", id),
            name = data.optString("name"),
            status = data.optString("status"),
            openState = data.optString("openState"),
        )
    }

    /** Pause with a reason: the Worker records it, and a pause without one is a support ticket. */
    fun pause(id: String, reason: String, token: String?): JSONObject =
        send(ApiRoutes.VENDORS_ID_PAUSE, "POST", token, UUID.randomUUID().toString(), id, body = JSONObject().put("reason", reason).toString())

    fun resume(id: String, token: String?): JSONObject =
        send(ApiRoutes.VENDORS_ID_RESUME, "POST", token, UUID.randomUUID().toString(), id)

    private fun send(route: ApiRoute, method: String, token: String?, key: String, vararg args: String, body: String? = null): JSONObject {
        val path = if (args.isEmpty()) route.path else String.format(route.path, *args)
        val json = "application/json; charset=utf-8".toMediaType()
        val builder = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .header("accept", "application/json")
            .header("idempotency-key", key)
            .apply { if (token != null) header("authorization", "Bearer $token") }
        if (method == "GET") builder.get() else
            builder.post((body ?: "{}").toRequestBody(json)).header("content-type", "application/json")

        client.newCall(builder.build()).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val parsed = if (text.isEmpty()) JSONObject() else JSONObject(text)
            if (!response.isSuccessful) {
                val code = parsed.optJSONObject("error")?.optString("code").orEmpty()
                throw IOException(if (code.isEmpty()) "HTTP ${response.code}" else code)
            }
            return parsed.optJSONObject("data") ?: parsed
        }
    }
}
