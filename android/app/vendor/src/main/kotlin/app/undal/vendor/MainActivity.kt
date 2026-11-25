/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

package app.undal.vendor

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val API_BASE = "https://api.undal.app"

/**
 * The kitchen's one screen: is it open, and can it stop.
 *
 * Pause is the safety valve of the whole marketplace — a kitchen that cannot stop taking orders it
 * cannot cook turns into cancellations, angry customers and refunds. It is therefore the first
 * feature, not the coffee-machine feature it looks like.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme { Surface(modifier = Modifier.fillMaxSize()) { KitchenScreen() } }
        }
    }
}

@Composable
private fun KitchenScreen() {
    val api = remember { VendorApi(API_BASE) }
    val scope = rememberCoroutineScope()
    // Sign-in for the kitchen is the next screen; until it exists every call is the guest path and
    // the Worker will refuse the writes, which the app shows honestly instead of hiding.
    val token: String? = null
    val vendorId = remember { "" }
    var state by remember { mutableStateOf("—") }
    var reason by remember { mutableStateOf("") }
    var failure by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun run(action: suspend () -> Unit) {
        busy = true
        failure = null
        scope.launch {
            withContext(Dispatchers.IO) {
                try {
                    action()
                    withContext(Dispatchers.Main) { state = "OPEN" }
                } catch (error: Exception) {
                    withContext(Dispatchers.Main) { failure = error.message ?: "NETWORK" }
                }
            }
            busy = false
        }
    }

    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Undal Kitchen", style = MaterialTheme.typography.headlineSmall)
        Text("Kitchen: ${if (vendorId.isEmpty()) "not linked yet" else vendorId}")
        Text("Status: $state")
        failure?.let { Text("Could not do that: $it", color = MaterialTheme.colorScheme.error) }
        OutlinedTextField(
            value = reason,
            onValueChange = { reason = it },
            label = { Text("Why are you pausing?") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedButton(
            enabled = !busy && vendorId.isNotEmpty() && reason.isNotBlank(),
            onClick = { run { api.pause(vendorId, reason, token).also { state = "PAUSED" } } },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Pause orders") }
        Button(
            enabled = !busy && vendorId.isNotEmpty(),
            onClick = { run { api.resume(vendorId, token).also { state = "OPEN" } } },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Resume orders") }
    }
}
