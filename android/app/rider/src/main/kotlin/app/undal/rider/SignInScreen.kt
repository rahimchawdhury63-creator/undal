/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

package app.undal.rider

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import app.undal.rider.auth.AuthApi
import app.undal.rider.auth.TokenStore
import app.undal.rider.auth.Tokens
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Phone and password, and nothing else.
 *
 * A rider signing in is usually standing next to a motorcycle with a helmet under one arm: two
 * fields, one button, and the platform's own error code shown as-is so support can act on it.
 */
@Composable
fun SignInScreen(
    api: AuthApi,
    store: TokenStore,
    fingerprint: String,
    onSignedIn: (Tokens) -> Unit,
) {
    var phone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Sign in", style = MaterialTheme.typography.headlineSmall)
        OutlinedTextField(
            value = phone,
            onValueChange = { phone = it },
            label = { Text("Phone") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        failure?.let { code -> Text("Could not sign in: $code", color = MaterialTheme.colorScheme.error) }
        Button(
            enabled = !busy && phone.isNotBlank() && password.isNotBlank(),
            onClick = {
                busy = true
                failure = null
                scope.launch {
                    withContext(Dispatchers.IO) {
                        try {
                            val tokens = api.login(phone, password, fingerprint)
                            store.save(tokens)
                            withContext(Dispatchers.Main) { onSignedIn(tokens) }
                        } catch (error: Exception) {
                            withContext(Dispatchers.Main) { failure = error.message ?: "NETWORK" }
                        }
                    }
                    busy = false
                }
            },
        ) { Text("Sign in") }
        if (busy) CircularProgressIndicator()
    }
}
