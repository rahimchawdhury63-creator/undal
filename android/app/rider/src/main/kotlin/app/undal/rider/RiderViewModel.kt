/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

package app.undal.rider

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The rider's screen state, and nothing else.
 *
 * One failure field rather than a boolean per panel: a rider on a bad connection needs to know *why*
 * the list is empty — an expired token and an honest empty queue look identical without it.
 */
class RiderViewModel(private val api: RiderApi, private val token: String?) : ViewModel() {
    data class State(
        val loading: Boolean = false,
        val offers: List<RiderApi.Offer> = emptyList(),
        val shift: RiderApi.Shift? = null,
        val cash: RiderApi.Cash? = null,
        val failure: String? = null,
    )

    var state: State = State()
        private set

    private val listeners = mutableListOf<(State) -> Unit>()

    fun observe(listener: (State) -> Unit) {
        listeners += listener
        listener(state)
    }

    private fun publish(next: State) {
        state = next
        listeners.forEach { it(next) }
    }

    /**
     * Accept, then reload. A rider who has taken an order should see the queue without it — leaving
     * the accepted offer on screen is how the same order gets accepted twice by one person.
     */
    fun accept(offer: RiderApi.Offer) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                try {
                    api.acceptOffer(token, offer.orderCode, offer.id, java.util.UUID.randomUUID().toString())
                } catch (error: Exception) {
                    publish(state.copy(failure = error.message ?: "NETWORK"))
                    return@withContext
                }
            }
            refresh()
        }
    }

    fun refresh() {
        publish(state.copy(loading = true, failure = null))
        viewModelScope.launch {
            val next = withContext(Dispatchers.IO) {
                try {
                    State(loading = false, offers = api.offers(token), shift = api.shift(token), cash = api.cash(token))
                } catch (error: Exception) {
                    State(loading = false, failure = error.message ?: "NETWORK")
                }
            }
            publish(next)
        }
    }
}
