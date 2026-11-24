<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 15 — The Wake-Up Alarm

> The brief, verbatim: *"the second most important thing after ordering is the alert sound to wake
> up the vendor and the Rider — when an order arrives the vendor and rider's phone should ring with
> an continuous looping loud sound and notification even if the app is fully killed, locked, not
> backgrounded. We will use data-only FCM to wake up the OS."*
>
> This document specifies exactly that, states precisely where Android's own guarantees end, and
> builds every available layer of defence around that boundary. **Nothing here claims a capability
> the operating system does not provide.**

---

## 1. The honest boundary, stated first

There is one case that **cannot** be solved by any application on Android, including Undal:

> **If the user opens Settings → Apps → Undal Partner → Force stop, the app enters the `stopped`
> package state. Android will not deliver FCM messages to a stopped package, will not start its
> services, and will not run its broadcast receivers, until a human being manually launches the app
> again. This is an operating-system security guarantee introduced in Android 3.1 and it applies to
> every app without exception.**

Any vendor who tells you otherwise is describing a bug that will be patched, a device that is
already compromised, or a lie. Undal's answer to force-stop is not a technical bypass. It is:

1. **Detect it** — the server knows within 2 seconds ([`14`](14-presence-and-heartbeat.md)) and
   through FCM's own `NOT_FOUND`/`UNREGISTERED` responses.
2. **Route around it** — the order goes to another vendor or rider; the escalation ladder runs; a
   backup contact is alerted.
3. **Teach the user not to do it** — onboarding, in-app coaching, and a weekly health check.
4. **Never silently fail** — the vendor is shown, on next launch, exactly what they missed and why.

Several OEM skins — Xiaomi/MIUI, Oppo/ColorOS, Vivo/FuntouchOS, Realme, Huawei/EMUI, Samsung with
aggressive "Deep sleeping apps", Asus, Meizu — additionally treat **swiping the app from recents**
as a force-stop. On stock AOSP, Pixel, Nokia and most Motorola builds, a swipe-away leaves the app
in a normal stopped-but-deliverable state and FCM still arrives. Undal detects the OEM, adjusts its
coaching, and measures the actual outcome per device model (§10).

Everything in the rest of this document is about making every *other* case work perfectly, and
about making this one case visible rather than silent.

---

## 2. Message design

### 2.1 Data-only, always

```jsonc
// POST https://fcm.googleapis.com/v1/projects/{PROJECT_ID}/messages:send
{
  "message": {
    "token": "…",
    // NOTE: there is NO "notification" object anywhere in this payload.
    // A `notification` block makes Android's system tray render the message
    // when the app is backgrounded, and onMessageReceived is NOT called.
    // That would hand control of the sound to the OS, which will play it
    // once, at notification volume, respecting Do Not Disturb. Unacceptable.
    "data": {
      "v":          "1",
      "type":       "ORDER_NEW",
      "severity":   "CRITICAL",
      "orderId":    "UND-7K2M9QX4",
      "orderCode":  "7K2M9QX4",
      "vendorId":   "…",
      "issuedAt":   "1793612345678",
      "expiresAt":  "1793612465678",
      "itemCount":  "3",
      "totalPaisa": "54900",
      "customerArea": "Shibganj",
      "alarm":      "loop",
      "alarmMaxMs": "120000",
      "sig":        "ab93…"        // HMAC-SHA256 over the sorted data map
    },
    "android": {
      "priority": "high",          // MANDATORY. Without this, a data-only
                                   // message is normal-priority, is subject
                                   // to Doze batching, and the device is not
                                   // woken. This single field is the
                                   // difference between working and not.
      "ttl": "120s",               // An order offer is worthless after 2 min.
                                   // A short TTL also stops FCM delivering a
                                   // stale alarm an hour later.
      "collapse_key": "order_UND-7K2M9QX4",
      "direct_boot_ok": true       // Deliver even before the user unlocks
                                   // after a reboot (Direct Boot aware).
    }
  }
}
```

Five properties are non-negotiable and each is enforced by the `fcm-payload-purity` CI job
([`30`](30-testing-and-verification.md)):

| Rule | Enforcement |
| --- | --- |
| No `notification` key, at any nesting level | AST + JSON-shape test on every call site |
| `android.priority == "high"` for every `severity: CRITICAL` message | Unit test over the builder |
| `ttl` present and ≤ 300 s | Unit test |
| `sig` present and verifiable | Round-trip test |
| No legacy `https://fcm.googleapis.com/fcm/send` endpoint, no `Authorization: key=…` | Repo-wide grep; build fails on a match |

### 2.2 v1 authentication

The legacy server key is dead and the brief forbids it. Undal uses the **FCM HTTP v1 API** with a
service-account JWT minted inside the Worker:

```ts
// workers/realtime/src/fcm/token.ts
/**
 * Mint a Google OAuth2 access token from the service-account JSON using
 * RS256 via WebCrypto. No googleapis SDK — it does not run on Workers and
 * it would pull in megabytes we do not have.
 *
 * Tokens last 3600s. We cache in KV for 3300s, leaving a 5-minute safety
 * margin, and we single-flight the refresh so a burst of orders does not
 * trigger twenty simultaneous token requests.
 */
export async function getAccessToken(env: Env): Promise<string> {
  const cached = await env.KV.get("fcm:token");
  if (cached) return cached;

  return singleFlight("fcm:token", async () => {
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };
    const jwt = await signRS256(claim, sa.private_key);   // WebCrypto
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    if (!res.ok) throw new FcmAuthError(await res.text());
    const { access_token } = await res.json<{ access_token: string }>();
    await env.KV.put("fcm:token", access_token, { expirationTtl: 3300 });
    return access_token;
  });
}
```

`FIREBASE_SERVICE_ACCOUNT_JSON` is a GitHub Actions secret, pushed to the Worker as an encrypted
environment variable by the deploy workflow. It never appears in the repository, in a log, or in
any client.

The implementation lives in `workers/realtime/src/fcm/` (`payload.ts`, `token.ts`, `send.ts`,
`from-env.ts`). Two details differ from the sketches above and are recorded in D83: the signature is
lowercase hex over the sorted data map, and the access token is cached in the isolate rather than KV.

### 2.3 Sending

Only `undal-realtime` may call FCM. Core and Brain have no FCM binding at all, which makes the
`fcm-payload-purity` audit tractable: there is exactly one module to check.

| Concern | Handling |
| --- | --- |
| Multi-device | A vendor may register up to 5 devices; all receive the message in parallel |
| Retries | 3 attempts with 250/750/2000 ms backoff on 5xx or 429 |
| `UNREGISTERED` / `NOT_FOUND` | Token deleted from `device_tokens`; if it was the vendor's only token, an exception is raised |
| `SENDER_ID_MISMATCH` | Token deleted, error logged — means a config mistake |
| `QUOTA_EXCEEDED` | Exponential backoff, admin exception; FCM's free quota is effectively unlimited for this volume but the handler exists |
| Latency budget | p95 FCM accept ≤ 400 ms; breaches are logged and charted |
| Delivery proof | Every send stores `(message_id, token, sent_at)` in `fcm_dispatches` — reported by `undal-realtime` to `POST /internal/fcm/dispatches` and written by `undal-core`, because only core may write TiDB (D86); the device ACKs receipt over the socket (`ZoneHub` forwards an `alarm_received` frame to `POST /internal/fcm/receipts`, D87), closing the loop and producing a real measured delivery rate per device model |

---

## 3. Receiving: the Android side

### 3.1 The service

```kotlin
/**
 * UndalMessagingService — the single entry point for every push.
 *
 * Android gives a FirebaseMessagingService roughly 10–20 seconds of execution
 * from a high-priority data message, with a temporary wake-lock and a
 * temporary allowlist exemption from Doze and background-start restrictions.
 * That window is enough to start a foreground service, and starting a
 * foreground service is the ONLY reliable way to keep running, hold a
 * wake-lock, and play audio indefinitely.
 *
 * So: do almost nothing here. Validate, then hand off. Every millisecond
 * spent in this method is a millisecond of risk.
 */
class UndalMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (!AlarmSignature.verify(data, BuildConfig.FCM_SIG_KEY)) {
            Telemetry.rejected("bad_signature"); return
        }
        val expiresAt = data["expiresAt"]?.toLongOrNull() ?: 0L
        if (System.currentTimeMillis() > expiresAt) {
            Telemetry.rejected("expired"); return
        }
        if (AlarmDedupe.seen(data["orderId"], data["type"])) return

        when (data["severity"]) {
            "CRITICAL" -> AlarmLauncher.launch(this, AlarmSpec.from(data))
            "NORMAL"   -> QuietNotifier.post(this, data)
            else       -> SilentSync.enqueue(this, data)
        }
    }

    override fun onNewToken(token: String) {
        TokenSyncWorker.enqueue(applicationContext, token)
    }
}
```

### 3.2 Launching the alarm

```kotlin
object AlarmLauncher {
    /**
     * Three escalating strategies. We try the strongest first and fall back.
     *
     * A: Foreground service + full-screen intent. Works on every Android
     *    version when the app is not force-stopped. This is the path taken
     *    in roughly 97% of real deliveries.
     *
     * B: If starting a foreground service throws (Android 12+ throws
     *    ForegroundServiceStartNotAllowedException in some background
     *    states despite the FCM exemption), post a high-importance
     *    notification carrying a full-screen intent. The system then starts
     *    our activity itself, and the activity starts the service from the
     *    foreground where it is always permitted.
     *
     * C: If even that fails, post the loudest possible plain notification
     *    with a looping alarm-category sound on the channel, and record a
     *    degradation event so the server knows this device is unreliable
     *    and can weight dispatch accordingly.
     */
    fun launch(ctx: Context, spec: AlarmSpec) {
        try {
            val i = Intent(ctx, AlarmService::class.java).putExtra(EXTRA_SPEC, spec)
            ContextCompat.startForegroundService(ctx, i)
            Telemetry.alarmPath("A")
        } catch (e: Exception) {
            try {
                FullScreenNotifier.post(ctx, spec)
                Telemetry.alarmPath("B", e)
            } catch (e2: Exception) {
                LoudChannelNotifier.post(ctx, spec)
                Telemetry.alarmPath("C", e2)
                DegradationReporter.report(ctx, "FGS_AND_FSI_BLOCKED", e2)
            }
        }
    }
}
```

### 3.3 The foreground service

```kotlin
class AlarmService : Service() {

    private lateinit var wakeLock: PowerManager.WakeLock
    private var player: AlarmPlayer? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val spec = intent?.getParcelableExtra<AlarmSpec>(EXTRA_SPEC)
            ?: return START_NOT_STICKY

        // Foreground FIRST, within 5 seconds, or Android kills us with an ANR.
        startForeground(
            NOTIF_ID_ALARM,
            AlarmNotification.build(this, spec),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
        )

        // PARTIAL_WAKE_LOCK keeps the CPU alive. The screen is handled by the
        // full-screen intent activity, not by a (deprecated, unreliable)
        // SCREEN_BRIGHT wake-lock.
        wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "undal:alarm")
            .apply { acquire(spec.maxMs + 10_000L) }

        player = AlarmPlayer(this).also { it.start(spec) }
        ScreenWaker.wake(this, spec)        // full-screen intent activity
        AlarmTimeout.schedule(this, spec)   // hard ceiling

        return START_REDELIVER_INTENT
    }

    override fun onDestroy() {
        player?.stopAndRelease()
        if (::wakeLock.isInitialized && wakeLock.isHeld) wakeLock.release()
        super.onDestroy()
    }
}
```

`FOREGROUND_SERVICE_TYPE_SPECIAL_USE` with a declared
`android:foregroundServiceType` and a `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` of
`"order_alert_alarm"` in the manifest. Google Play requires a written justification for
`specialUse`; the text to submit is in [`28 §12`](28-cicd-github-actions.md).

### 3.4 The player

```kotlin
/**
 * Plays assets/audio/undal_order_alert_loop.wav — 8.000 s, 44.1 kHz, mono,
 * 16-bit PCM — shipped unmodified at res/raw/undal_order_alert_loop.wav.
 *
 * USAGE_ALARM is the critical choice. It routes to the alarm stream, which:
 *   - is exempt from ringer mode SILENT and VIBRATE
 *   - is exempt from most Do Not Disturb configurations
 *   - has its own volume slider that users rarely set to zero
 *
 * We also raise STREAM_ALARM to maximum for the duration and restore the
 * user's level afterwards, because an alarm at 20% volume does not wake
 * anybody at 3am.
 */
class AlarmPlayer(private val ctx: Context) {

    private var mp: MediaPlayer? = null
    private var previousVolume: Int = -1
    private val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    fun start(spec: AlarmSpec) {
        previousVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
        am.setStreamVolume(
            AudioManager.STREAM_ALARM,
            am.getStreamMaxVolume(AudioManager.STREAM_ALARM),
            0,
        )

        mp = MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            setDataSource(ctx, Uri.parse("android.resource://${ctx.packageName}/${R.raw.undal_order_alert_loop}"))
            isLooping = true          // seamless; the WAV is cut to a whole loop
            prepare()
            start()
        }

        Vibrator.from(ctx).vibrate(
            VibrationEffect.createWaveform(PATTERN, /* repeat from */ 0),
            AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build(),
        )
    }

    fun stopAndRelease() {
        mp?.runCatching { stop(); release() }; mp = null
        Vibrator.from(ctx).cancel()
        if (previousVolume >= 0) {
            am.setStreamVolume(AudioManager.STREAM_ALARM, previousVolume, 0)
        }
    }

    private companion object {
        /** 600ms buzz, 300ms gap — urgent without being a continuous drone. */
        val PATTERN = longArrayOf(0, 600, 300)
    }
}
```

**The audio starts at t=0.** It is never gated behind an animation, a layout pass, a network call,
or a render frame. [`04 §9`](04-motion-and-interaction.md) states the same rule from the motion
side: the sound leads, the interface catches up.

### 3.5 Waking the screen

```kotlin
class AlarmActivity : AppCompatActivity() {
    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        // The modern replacement for FLAG_TURN_SCREEN_ON / FLAG_SHOW_WHEN_LOCKED.
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        (getSystemService(KEYGUARD_SERVICE) as KeyguardManager)
            .requestDismissKeyguard(this, null)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent { OrderAlarmScreen(/* … */) }
    }
}
```

Launched as the `fullScreenIntent` of the alarm notification. On a locked device this puts the
order card on the lock screen, full bleed, with the accept action reachable without unlocking.

Android 14+ restricts `USE_FULL_SCREEN_INTENT` to calling/alarm apps by default. Undal requests it
through `NotificationManager.canUseFullScreenIntent()` and, if denied, routes the user to
`ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT` with an explanation. If still denied, the alarm still
sounds from the foreground service — only the automatic screen-on is lost, and the degradation is
reported to the server.

### 3.6 The notification channel

```kotlin
NotificationChannel(CH_ORDER_ALARM, "New orders", NotificationManager.IMPORTANCE_HIGH).apply {
    description  = "Loud looping alert when a new order arrives. Do not turn this off."
    setSound(
        Uri.parse("android.resource://$pkg/${R.raw.undal_order_alert_loop}"),
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
    )
    enableVibration(true); vibrationPattern = AlarmPlayer.PATTERN
    setBypassDnd(true)                    // granted with the DND-access permission
    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    setShowBadge(true)
}
```

The channel sound is a **second line of defence**: if the foreground service is blocked entirely
(path C), the channel itself plays the alarm. Channel settings are immutable after creation on
Android 8+, so the channel ID carries a version suffix (`undal.order_alarm.v3`) and a migration
deletes the old channel when the definition changes.

---

## 4. Stopping

| Trigger | Behaviour |
| --- | --- |
| User accepts | Immediate stop, < 50 ms, before the network call — because a sound that keeps playing after a tap feels broken |
| User rejects | Immediate stop; the reason sheet opens |
| Order withdrawn by the server (another rider claimed) | Server sends `type=ALARM_CANCEL` with the same `collapse_key`; stops within ~200 ms |
| **Ceiling reached** | Partner **120 s**; Rider **25 s** (= the offer TTL). After the ceiling, the alarm stops and a 3-pulse reminder plays every 20 s for 3 minutes |
| Device muted by hardware | The alarm stream ignores ringer-silent; a hardware volume-down **does** lower it, and the user is shown a warning on next launch if the alarm stream was below 30% when an alarm played |
| Screen off during alarm | Continues — the wake-lock is partial and the audio is independent of the display |
| App killed during alarm | The foreground service survives a swipe-away on AOSP; `START_REDELIVER_INTENT` restarts it if the process is reaped |

The partner ceiling of 120 s is deliberately the same as the auto-cancel deadline in
[`14 §4.1`](14-presence-and-heartbeat.md): the alarm rings for exactly as long as the order can
still be saved.

---

## 5. The alarm screen

```
╔═══════════════════════════════════════════════╗
║                                               ║
║            ◉  NEW ORDER                       ║
║               #7K2M9QX4                       ║
║                                               ║
║            ৳549.00  ·  3 items                ║
║            Shibganj  ·  3.8 km                ║
║                                               ║
║   ┌─────────────────────────────────────┐     ║
║   │  1 ×  Kacchi Biriyani (Full)        │     ║
║   │  1 ×  Borhani                       │     ║
║   │  1 ×  Firni                         │     ║
║   └─────────────────────────────────────┘     ║
║                                               ║
║            ⏱  0:47 to respond                 ║
║         ████████████░░░░░░░░░░░░              ║
║                                               ║
║   ╭─────────────────────────────────────╮     ║
║   │    ◀━━━━ SLIDE TO ACCEPT ━━━━▶      │     ║
║   ╰─────────────────────────────────────╯     ║
║                                               ║
║               Can't take it?                  ║
║                                               ║
╚═══════════════════════════════════════════════╝
```

**Slide, not tap.** A tap target on a lock screen is hit by pockets, cheeks and bags. A 72 dp slide
is essentially impossible to trigger accidentally and takes under half a second deliberately. The
countdown ring and the progress bar both animate from the server's `expiresAt`, so a device with a
skewed clock still shows the right remaining time.

The reject affordance is small, plain, and at the bottom — present and honest, but not the path of
least resistance.

---

## 6. Doze, App Standby, and battery optimisation

| Mechanism | Effect on Undal | Mitigation |
| --- | --- | --- |
| **Doze** (device idle) | High-priority FCM is explicitly exempt and is delivered immediately with a temporary allowlist | None needed — this is why `priority: high` is mandatory |
| **App Standby Buckets** | A rarely-used app drops to `rare`/`restricted`, which caps high-priority FCM to ~10/day in the worst bucket | Partner and rider apps are used daily by definition; the app also reports its bucket on each launch and warns if it is below `active` |
| **Battery optimisation** | Background work and FGS starts restricted | Request `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` during onboarding, with a clear explanation (§7) |
| **Restricted bucket** (user-set "Restricted" battery) | FCM delivery is severely limited | Detected via `ActivityManager.getPackageImportance` + `UsageStatsManager`; a blocking banner appears |
| **Adaptive Battery** | May learn to restrict an app the user rarely opens | The foreground service during a shift keeps the app `active` |
| **OEM killers** | Varies wildly | §7.2 |

---

## 7. Teaching the device to behave

Permissions and exemptions are requested in a **dedicated onboarding step**, not scattered through
the app, and each one is explained in one honest sentence before the system dialog appears.

### 7.1 The checklist

```
   Make sure you never miss an order            4 of 7 done

   ✓  Notifications allowed
   ✓  Alarm sound and vibration on
   ✓  Battery optimisation turned off
   ✓  Alarm volume above 50%
   ✗  Show on lock screen                      [ Turn on ]
   ✗  Autostart allowed  (Xiaomi)              [ Show me ]
   ✗  Do Not Disturb exception                 [ Turn on ]

   Undal will check these every week and tell
   you if something changes.
```

Every row is live — it re-reads the real system state on resume, so a user who toggles something in
Settings sees the tick appear when they come back. No row can be faked or dismissed; the only way
to a tick is the actual permission.

### 7.2 OEM-specific coaching

`Build.MANUFACTURER` selects a tailored guide with the **exact menu path** for that skin, plus a
screenshot:

| OEM | Path |
| --- | --- |
| Xiaomi / Redmi / POCO (MIUI) | Settings → Apps → Manage apps → Undal → **Autostart ON**; Battery saver → **No restrictions**; recents → **lock the card** |
| Oppo / Realme (ColorOS) | Settings → Battery → App Battery Management → Undal → **Allow background activity** + **Allow auto launch** |
| Vivo (Funtouch) | Settings → Battery → Background power consumption management → Undal → **Allow** |
| Huawei (EMUI) | Settings → Apps → Undal → Battery → **App launch → Manage manually**, all three toggles on |
| Samsung (One UI) | Settings → Battery → Background usage limits → **remove Undal from "Sleeping apps" and "Deep sleeping apps"** |
| Asus (ZenUI) | Mobile Manager → PowerMaster → Auto-start manager → Undal → **Allow** |
| OnePlus (OxygenOS) | Settings → Battery → Battery optimisation → Undal → **Don't optimise**; Advanced → **Sleep standby optimisation OFF** |
| Stock / Pixel / Nokia / Motorola | Battery optimisation exemption only |

Each guide ends with a **live test**: "Tap here, then lock your phone and put it down. We'll send a
test alarm in 30 seconds." The test is a real FCM message of type `ALARM_SELFTEST`, and the result
— did the alarm fire, how long did it take, which path (A/B/C) was used — is reported back to the
server and stored against the device.

This test is the single most valuable thing in this document after `priority: high`. It converts
a configuration question into a measured fact, per device, before the vendor's first real order.

### 7.3 The weekly health check

Every 7 days (triggered on app open, not by a cron), the app re-evaluates the checklist and, if
anything regressed, shows a non-dismissible card until it is fixed or explicitly deferred. The
server also tracks devices whose self-test has not succeeded in 14 days and surfaces them in the
admin panel as an operational risk list.

---

## 8. Server-side verification

Undal does not assume a message was delivered. Every alarm closes a loop:

```
realtime: send FCM            → fcm_dispatches(message_id, sent_at)
device:   onMessageReceived   → ws "alarm_received" {orderId, latencyMs, path}
device:   alarm audible       → ws "alarm_playing"  {orderId, volume, stream}
device:   user responded      → accept/reject
```

`alarm_received` is written as three columns on the dispatch row: `received_at`, the moment the
frame reached the socket; `device_latency_ms`, the device's own measurement; and `device_path`, the
channel the device says woke it (`FCM`, `SOCKET` or `BOTH`). The median below is
`received_at − sent_at` — both ends are the platform's clock, on Workers with the same time source —
so a phone with a wrong clock can add a data point to the matrix but cannot move the number that
decides whether a device is flagged. See D88.

| Metric | Target | Action when breached |
| --- | --- | --- |
| `alarm_received` within 5 s of send | ≥ 97% | Device flagged; coaching card on next open |
| `alarm_playing` follows `alarm_received` | ≥ 99% | Audio-path bug; degradation report with device model |
| Median send → received latency | ≤ 1.8 s | Investigate; charted per OEM in the admin panel |
| Devices with 3 consecutive non-deliveries | 0 | Vendor/rider contacted by support; device marked unreliable and **excluded from dispatch** until a successful self-test |

The admin panel renders a **delivery reliability matrix by device model and Android version**,
built from real data. After a few weeks of operation this table is the most useful thing the
platform knows about its own supply side: it identifies, by name, which phones cannot be relied on,
and lets support tell a rider honestly that their specific device needs a specific setting changed.

---

## 9. Dispatch integration

[`11 §3`](11-dispatch-engine.md), filter 14: a rider whose device cannot receive alarms is not
offered orders. Specifically, a rider is excluded when any of:

- Notifications are disabled at the OS level (reported by the app on every launch and resume).
- The last 3 alarm sends produced no `alarm_received`.
- The app reports App Standby bucket `restricted`.
- The last self-test failed and no successful one has occurred since.

The rider is told exactly which of these applies, with the fix. "You are not receiving orders
because Undal's notifications are turned off" is a far better experience than silence followed by
a confused support call.

---

## 10. Measured expectations

From the device matrix the platform will build in its first weeks. These are the targets the
system is designed to, and the admin panel reports the actual values:

| Device state | Expected alarm delivery |
| --- | --- |
| App in foreground | 100% |
| App backgrounded | 100% |
| Screen locked, device idle (Doze) | ~99.5% — high-priority FCM is Doze-exempt |
| App swiped from recents, stock Android | ~98% |
| App swiped from recents, aggressive OEM without autostart configured | **40–70%** — this is why §7.2 exists |
| App swiped from recents, aggressive OEM **with** autostart configured | ~96% |
| Device rebooted, user has not unlocked | ~95% with `direct_boot_ok` and a Direct-Boot-aware receiver |
| **App force-stopped from Settings** | **0%. Impossible. See §1.** |
| Device powered off | 0%; FCM queues and delivers on next boot if inside TTL (120 s, so usually not) |
| No network | 0%; FCM queues, delivers on reconnect if inside TTL |

Undal states these numbers to vendors and riders during onboarding. A platform that promises 100%
and delivers 70% loses trust permanently; one that explains the 70% and shows how to make it 96%
earns it.

---

## 11. Other critical alarms

The same machinery serves every urgent event:

| Type | Audience | Severity | Ceiling |
| --- | --- | --- | --- |
| `ORDER_NEW` | Vendor | CRITICAL | 120 s |
| `OFFER_NEW` | Rider | CRITICAL | 25 s |
| `OFFER_WITHDRAWN` | Rider | SILENT | — (stops the alarm) |
| `ORDER_CANCELLED` | Vendor, Rider | NORMAL | single chime |
| `PRESENCE_LOST` (carrying/active) | Vendor, Rider | CRITICAL | 30 s |
| `CASH_SETTLEMENT_DUE` | Rider | CRITICAL | continuous tick until resolved ([`25`](25-rider-cash-settlement.md)) |
| `CASH_SETTLEMENT_APPROVED` | Rider | NORMAL | single chime |
| `PAYOUT_PAID` | Vendor, Rider | NORMAL | single chime |
| `ADMIN_BROADCAST` | configurable | NORMAL | single chime |
| `ORDER_STATE` | Customer | SILENT/NORMAL | **customers never get an alarm** — they get ordinary notifications, because a customer's phone screaming at them is a deleted app |
| `ALARM_SELFTEST` | Vendor, Rider | CRITICAL | 8 s |

---

## 12. Testing

| Test | Count | Asserts |
| --- | --- | --- |
| `fcm-payload-purity` | 1 CI job | No `notification` key anywhere; `priority: high` on all CRITICAL; TTL present; no legacy endpoint or server key |
| Payload builder | 24 | Every message type produces a valid v1 body; signature round-trips |
| Token minting | 9 | RS256 correctness against a known vector; cache TTL; single-flight under 50 concurrent calls |
| Token lifecycle | 14 | `UNREGISTERED` deletes; multi-device fan-out; last-token-removed raises an exception |
| Service unit tests | 31 | Signature rejection, expiry rejection, dedupe, severity routing |
| Alarm player | 18 | Looping continuity across the WAV boundary; volume save/restore; stop within 50 ms |
| Path fallback | 12 | A→B→C transitions under simulated `ForegroundServiceStartNotAllowedException` |
| Instrumented device tests | 26 | On a Firebase Test Lab matrix: foreground, background, locked, Doze (`adb shell dumpsys deviceidle force-idle`), swiped, rebooted |
| Force-stop | 1 | **Asserts that delivery does NOT occur** — the honest test, proving the documented boundary rather than pretending |
| Latency | 1 | p95 send → `alarm_playing` ≤ 2.5 s across the Test Lab matrix |
| Self-test loop | 7 | Result recorded, surfaced to the user, and reflected in dispatch filter 14 |

The force-stop test is in the suite deliberately. A test that asserts a limitation is how a
specification stays honest over time: if someone later claims to have "fixed" force-stop, that test
will fail and the claim will be examined.

---

## 13. Reading on

Next: [`16-android-foundation.md`](16-android-foundation.md) — the shared Android architecture all
three apps are built on.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
