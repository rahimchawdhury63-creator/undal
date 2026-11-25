/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

package app.undal.rider

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * The rider's three screens: offers, the shift, and the cash they are carrying.
 *
 * Those three are the whole job. A rider opens the phone between deliveries, with one hand and often
 * one bar of signal, so every screen is a plain list that refreshes — no charts, no tabs inside tabs.
 *
 * Sign-in is the next screen to build; until it exists the token is `null` and every call is the
 * guest path, which is the honest state of this app rather than a mock session that pretends.
 */
private const val API_BASE = "https://api.undal.app"

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) { RiderScreen() }
            }
        }
    }
}

@Composable
private fun RiderScreen() {
    val model = remember { RiderViewModel(RiderApi(API_BASE), token = null) }
    var ui by remember { mutableStateOf(model.state) }
    var tab by remember { mutableStateOf(0) }

    LaunchedEffect(Unit) {
        model.observe { next -> ui = next }
        model.refresh()
    }

    Scaffold { insets ->
        Column(modifier = Modifier.padding(insets).padding(16.dp)) {
            Text("Undal rider", style = MaterialTheme.typography.headlineSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 12.dp)) {
                OutlinedButton(onClick = { tab = 0 }) { Text("Offers") }
                OutlinedButton(onClick = { tab = 1 }) { Text("Shift") }
                OutlinedButton(onClick = { tab = 2 }) { Text("Cash") }
            }
            ui.failure?.let { code ->
                Text("Could not load: $code", color = MaterialTheme.colorScheme.error)
            }
            if (ui.loading) Text("Loading…")
            when (tab) {
                0 -> Offers(ui.offers)
                1 -> Shift(ui.shift)
                else -> Cash(ui.cash)
            }
        }
    }
}

@Composable
private fun Offers(offers: List<RiderApi.Offer>) {
    if (offers.isEmpty()) {
        Text("No offers right now.")
        return
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(offers) { offer ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(offer.orderCode, style = MaterialTheme.typography.titleMedium)
                    Text(offer.vendorName)
                    Text("${offer.distanceM} m · ${taka(offer.payoutPaisa)}")
                }
            }
        }
    }
}

@Composable
private fun Shift(shift: RiderApi.Shift?) {
    if (shift == null) {
        Text("You are off shift.")
        return
    }
    Text("On shift since ${shift.startedAt ?: "—"}".replace("since —", "since the start"))
}

@Composable
private fun Cash(cash: RiderApi.Cash?) {
    if (cash == null) {
        Text("No cash position yet.")
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Collected: ${taka(cash.collectedPaisa)}")
        Text("Owed to Undal: ${taka(cash.owedPaisa)}")
        Text("Settled: ${taka(cash.settledPaisa)}")
    }
}

/**
 * Paisa to the way a rider says it, without decimals.
 *
 * `Money.groupBdt` does the full Bengali grouping; this is the arithmetic-only form until the app
 * has a locale-aware reader for it, and it is integer division, so it can only ever round down — the
 * same rule the settlement uses.
 */
private fun taka(paisa: Long): String = "৳" + (paisa / 100) + "." + (paisa % 100).toString().padStart(2, '0')
