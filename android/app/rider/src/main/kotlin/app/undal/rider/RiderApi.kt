/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

package app.undal.rider

import app.undal.api.ApiRoutes
import java.io.IOException
import okhttp3.OkHttpClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * The three reads the rider app needs, over HTTPS, against the routes the Worker publishes.
 *
 * Every path is an `ApiRoute` constant generated from the surface, so a route renamed in the Worker
 * is a compile error here rather than a 404 in a rider's hand. Parsing uses `org.json`, which ships
 * with Android: a 40 KB dependency for three shapes would be a cost with no reader.
 */
class RiderApi(private val baseUrl: String, private val client: OkHttpClient = OkHttpClient()) {
    /** One offer as the rider sees it: what, from where, how far, how much. */
    data class Offer(val id: String, val orderCode: String, val vendorName: String, val payoutPaisa: Long, val distanceM: Int)

    /** The shift, or null when the rider is off. */
    data class Shift(val state: String, val startedAt: String?)

    /** What the rider owes, and what they have collected. */
    data class Cash(val collectedPaisa: Long, val owedPaisa: Long, val settledPaisa: Long)

    /**
     * GET a route and hand back its `data` object.
     *
     * A refusal carries the platform's error envelope, and its `code` is what the UI shows: a rider
     * staring at "Something went wrong" cannot tell a dead token from an empty offer list.
     */
    fun get(route: app.undal.api.ApiRoute, token: String?, vararg args: String): JSONObject {
        val path = if (args.isEmpty()) route.path else String.format(route.path, *args)
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .header("accept", "application/json")
            .apply { if (token != null) header("authorization", "Bearer $token") }
            .get()
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            val json = if (body.isEmpty()) JSONObject() else JSONObject(body)
            if (!response.isSuccessful) {
                val code = json.optJSONObject("error")?.optString("code").orEmpty()
                throw IOException(if (code.isEmpty()) "HTTP ${response.code}" else code)
            }
            return json.optJSONObject("data") ?: json
        }
    }

    /**
     * Take an offer. The first write this app makes.
     *
     * The `Idempotency-Key` is minted once per tap and sent on every retry of that tap: the Worker
     * replays the first response instead of creating a second acceptance, which is the difference
     * between a rider getting one order and getting two they cannot deliver.
     */
    fun acceptOffer(token: String?, orderCode: String, offerId: String, idempotencyKey: String): JSONObject {
        val path = String.format(ApiRoutes.ORDERS_CODE_OFFER_OFFERID_ACCEPT.path, orderCode, offerId)
        val body = "{}".toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .header("idempotency-key", idempotencyKey)
            .apply { if (token != null) header("authorization", "Bearer $token") }
            .post(body)
            .build()

        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val json = if (text.isEmpty()) JSONObject() else JSONObject(text)
            if (!response.isSuccessful) {
                val code = json.optJSONObject("error")?.optString("code").orEmpty()
                throw IOException(if (code.isEmpty()) "HTTP ${response.code}" else code)
            }
            return json.optJSONObject("data") ?: json
        }
    }

    fun offers(token: String?): List<Offer> {
        val data = get(ApiRoutes.RIDER_OFFERS, token)
        val array = data.optJSONArray("offers") ?: return emptyList()
        return (0 until array.length()).map { index ->
            val offer = array.getJSONObject(index)
            Offer(
                id = offer.getString("id"),
                orderCode = offer.optString("orderCode"),
                vendorName = offer.optString("vendorName"),
                payoutPaisa = offer.optLong("payoutPaisa"),
                distanceM = offer.optInt("distanceM"),
            )
        }
    }

    fun shift(token: String?): Shift? {
        val data = get(ApiRoutes.RIDER_SHIFT_CURRENT, token)
        val state = data.optString("state")
        return if (state.isEmpty()) null else Shift(state, data.optString("startedAt").ifEmpty { null })
    }

    fun cash(token: String?): Cash {
        val data = get(ApiRoutes.RIDER_CASH, token)
        return Cash(
            collectedPaisa = data.optLong("collectedPaisa"),
            owedPaisa = data.optLong("owedPaisa"),
            settledPaisa = data.optLong("settledPaisa"),
        )
    }
}
