<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 16 — Android Foundation

> Three apps — Customer, Partner, Rider — share one Gradle build, one design system, one network
> stack, one database layer and one set of conventions. This document specifies that shared
> foundation. Docs [`17`](17-customer-app.md), [`18`](18-partner-app.md) and
> [`19`](19-rider-app.md) specify what is unique to each.

---

## 1. Module graph

```
android/
├── settings.gradle.kts
├── gradle/libs.versions.toml          ← one version catalogue, no scattered versions
├── build-logic/                       ← convention plugins (composite build)
│   └── convention/src/main/kotlin/
│       ├── undal.android.application.gradle.kts
│       ├── undal.android.library.gradle.kts
│       ├── undal.android.compose.gradle.kts
│       ├── undal.android.hilt.gradle.kts
│       ├── undal.android.room.gradle.kts
│       └── undal.jvm.library.gradle.kts
│
├── core/
│   ├── common/        Result, dispatchers, Clock, Logger, extensions
│   ├── money/         Paisa value class, UndalMoney formatter, Bengali numerals
│   ├── model/         Pure Kotlin domain types (no Android imports)
│   ├── designsystem/  Tokens, theme, 60+ Compose components, motion specs
│   ├── network/       Okronet stack, interceptors, envelope, error mapping
│   ├── database/      Room base, converters, encryption
│   ├── datastore/     Preferences and session storage
│   ├── realtime/      WebSocket presence + SSE client
│   ├── location/      Fused location, permissions, displacement filter
│   ├── media/         Camera capture, compression, imgbb/Cloudinary upload
│   ├── notification/  FCM service, alarm engine, channels, device health
│   ├── maps/          MapLibre Native wrapper, OSM style, markers, polylines
│   ├── analytics/     First-party event log (no third-party SDK)
│   └── testing/       Fakes, fixtures, Compose test rules
│
├── feature/           ~70 feature modules, each one screen-group
│   ├── auth-login/  auth-register/  auth-location/  …
│   ├── customer-home/  customer-vendor/  customer-cart/  …
│   ├── partner-orders/  partner-menu/  partner-hours/  …
│   └── rider-shift/  rider-offer/  rider-active/  rider-cash/  …
│
└── app/
    ├── customer/      com.undal.customer
    ├── partner/       com.undal.partner
    └── rider/         com.undal.rider
```

**Dependency rule, enforced by a Gradle task:** `app → feature → core`. A feature module may never
depend on another feature module. Shared behaviour moves down into `core`. The
`:checkModuleGraph` task fails the build on a violation, which is what keeps a 70-module project
from turning into a ball of mud.

---

## 2. Why three apps and not one

| Reason | Detail |
| --- | --- |
| **Install size** | The customer app has no camera-QR, no alarm service, no cash flow, no MapLibre offline tiles. 11 MB vs 24 MB |
| **Permissions** | A customer app asking for camera and foreground-service-special-use looks alarming on the Play listing |
| **Play policy** | The `specialUse` foreground service needs a justification that only makes sense for partner/rider |
| **Audience** | Three completely different users with three different mental models |
| **Risk** | A crash in the rider alarm path must never be able to take down customer ordering |

They share ~62% of their code by line count through the `core` modules, so the cost of three
binaries is a build-matrix entry, not three codebases.

---

## 3. Technology choices

| Concern | Choice | Why |
| --- | --- | --- |
| Language | **Kotlin** (+ Java where the brief's "Kotlin and Java" matters: `core/network` Okronet bridge and `core/notification` alarm service expose Java-compatible APIs and contain Java sources) | The brief specifies Kotlin and Java |
| UI | **Jetpack Compose** + Material 3, heavily re-themed | Animation and responsive layout are first-class; [`04`](04-motion-and-interaction.md) is far cheaper in Compose |
| DI | **Hilt** | Standard, compile-time verified |
| Async | **Coroutines + Flow** | |
| Navigation | **Navigation-Compose** with type-safe routes | |
| Local DB | **Room** | The brief specifies it |
| Preferences | **DataStore (Proto)** | |
| HTTP | **Okronet** (OkHttp API over Cronet) | §5; the brief specifies it |
| JSON | **kotlinx.serialization** | No reflection, works with R8 |
| Images | **Coil 3** | Compose-native, small |
| Maps | **MapLibre Native** | §8; the brief specifies it alongside Leaflet for web |
| Camera | **CameraX** | |
| QR | **ML Kit barcode scanning** (bundled model, no network) | Offline, no API key |
| Crypto | **Tink** + `EncryptedSharedPreferences` | |
| Testing | JUnit5, Turbine, Compose UI Test, Robolectric, MockK | |

### 3.1 Targets

| | Value |
| --- | --- |
| `minSdk` | **24** (Android 7.0) — covers the Bangladeshi device base; below this, FCM reliability and Compose performance both collapse |
| `targetSdk` / `compileSdk` | **36** |
| JVM target | 17 |
| ABI splits | `arm64-v8a`, `armeabi-v7a` (the second still matters here) |
| Languages | `en`, `bn` |

---

## 4. The money type

Money bugs are the most expensive class of bug in this system, so money is not an `Int`.

```kotlin
/**
 * Paisa — the only monetary type in the Android codebase.
 *
 * A value class over Long: zero allocation at runtime, total type safety at
 * compile time. You cannot add Paisa to a distance, you cannot pass a taka
 * figure where paisa is expected, and there is no constructor from Double.
 *
 * Arithmetic that is NOT provided, deliberately:
 *   - division by another Paisa (meaningless)
 *   - any operation with Float or Double (the entire point)
 *   - percentage helpers (use applyRate, which mirrors the server's rounding
 *     exactly — see docs/10)
 */
@JvmInline
value class Paisa(val raw: Long) : Comparable<Paisa> {

    operator fun plus(o: Paisa) = Paisa(Math.addExact(raw, o.raw))
    operator fun minus(o: Paisa) = Paisa(Math.subtractExact(raw, o.raw))
    operator fun times(n: Int)   = Paisa(Math.multiplyExact(raw, n.toLong()))
    operator fun unaryMinus()    = Paisa(-raw)
    override fun compareTo(other: Paisa) = raw.compareTo(other.raw)

    val isZero get() = raw == 0L
    val isNegative get() = raw < 0L

    companion object {
        val ZERO = Paisa(0)
        fun ofTaka(taka: Int) = Paisa(taka * 100L)
        /** Parses "549.00" or "549" — used ONLY for test fixtures and admin input. */
        fun parse(s: String): Paisa { /* … strict, throws on anything else … */ }
    }
}

/**
 * The single rounding function. Byte-for-byte identical to the Python in
 * workers/brain and the TypeScript in workers/core. Banker's rounding
 * (ties-to-even), integer-only, asserted by a 100,000-pair differential test
 * that runs in CI across all three languages.
 */
fun applyRate(amount: Paisa, bps: Int): Paisa {
    require(bps >= 0) { "negative bps" }
    val product = Math.multiplyExact(amount.raw, bps.toLong())
    val q = product / 10_000
    val r = product % 10_000
    return Paisa(
        when {
            r * 2 > 10_000 -> q + 1
            r * 2 < 10_000 -> q
            q % 2 == 0L    -> q          // exact tie → round to even
            else           -> q + 1
        }
    )
}
```

### 4.1 Rendering

```kotlin
@Composable
fun UndalMoney(
    amount: Paisa,
    style: MoneyStyle = MoneyStyle.Body,
    showSign: Boolean = false,
    animate: Boolean = false,
)
```

The **only** way money reaches a screen. It owns the ৳ symbol and its spacing, the thousands
separators (Bangladeshi lakh/crore grouping: `1,23,456.00`), tabular figures, the colour of a
negative, and the digit-rolling animation from [`04 §6`](04-motion-and-interaction.md). A lint rule
fails the build on any `Text(` whose content contains `"৳"`.

Bengali locale renders Bengali numerals (`৫৪৯.০০`) when the user's language is `bn` *and* their
"numerals" preference is Bengali — a real preference, because many Bangladeshi users prefer Latin
digits for money even while reading Bengali text.

---

## 5. Networking: the Okronet stack

### 5.1 The decision

The brief specifies **Okronet** — an OkHttp-compatible client backed by Cronet, giving HTTP/3 and
QUIC. The relevant engineering context, from Delivery Hero's published experience: Google's
`cronet-okhttp` transport bypasses OkHttp's core, losing its cache, retry and network
interceptors; and Cronet's engine initialisation can cost **~800 ms at P90**, which on a cold start
eats the entire 0-RTT advantage.

Undal's implementation follows the same conclusion they reached:

```kotlin
/**
 * UndalHttpClient — OkHttp's API, Cronet's transport, with the engine
 * initialised off the critical path.
 *
 * Cronet's engine build is expensive. We start it in Application.onCreate on
 * Dispatchers.IO, in parallel with Room's open and DataStore's first read,
 * and we hold it behind a Deferred. The first network call suspends on that
 * Deferred; by the time the user has finished reading the splash screen it
 * is almost always already resolved.
 *
 * If it has NOT resolved within 1200ms when a request is made — slow device,
 * cold filesystem — we fall back to plain OkHttp over HTTP/2 for that
 * request and swap to Cronet when it becomes ready. A fast HTTP/2 request
 * beats a slow HTTP/3 one.
 */
@Singleton
class UndalHttpClient @Inject constructor(
    @ApplicationContext ctx: Context,
    private val scope: CoroutineScope,
    private val interceptors: UndalInterceptors,
) {
    private val cronetEngine: Deferred<CronetEngine> = scope.async(Dispatchers.IO, LAZY) {
        CronetEngine.Builder(ctx)
            .enableHttp2(true)
            .enableQuic(true)
            .enableBrotli(true)
            .addQuicHint(BuildConfig.API_HOST, 443, 443)
            .setStoragePath(ctx.cacheDir.resolve("cronet").apply { mkdirs() }.absolutePath)
            .enableHttpCache(CronetEngine.Builder.HTTP_CACHE_DISK, 8L * 1024 * 1024)
            .build()
    }

    fun warmUp() { scope.launch { cronetEngine.await() } }      // called from onCreate

    suspend fun client(): OkHttpClient =
        withTimeoutOrNull(1_200) { cronetClient(cronetEngine.await()) } ?: fallbackClient
}
```

**`addQuicHint`** matters: without it the first connection to the API host negotiates HTTP/2 and
only upgrades on a later visit. With the hint, QUIC is attempted immediately.

### 5.2 Interceptors

In order:

| # | Interceptor | Responsibility |
| --- | --- | --- |
| 1 | `HeaderInterceptor` | `X-Undal-App`, `X-Undal-App-Version`, `X-Undal-Device`, `Accept-Language`, `User-Agent` |
| 2 | `AuthInterceptor` | Bearer token; single-flight refresh on 401; one retry |
| 3 | `IdempotencyInterceptor` | Generates and persists an `Idempotency-Key` for every mutating request, surviving process death so a retry after a crash is still idempotent |
| 4 | `EnvelopeInterceptor` | Unwraps `{ok, data, error, meta}`; converts `ok:false` into a typed `UndalError` |
| 5 | `RetryInterceptor` | 3 attempts, full jitter, **only** on idempotent methods or requests carrying an idempotency key; never on 4xx except 429 |
| 6 | `OfflineInterceptor` | When there is no network, fails fast with `NoNetwork` rather than waiting for a timeout |
| 7 | `LoggingInterceptor` | Debug builds only; redacts `Authorization`, phone numbers, and anything matching the secret patterns |
| 8 | `TimingInterceptor` | Records DNS/connect/TLS/TTFB into the first-party analytics log |

### 5.3 Timeouts

| Request class | Connect | Read | Overall |
| --- | --- | --- | --- |
| Interactive (tap → response) | 4 s | 8 s | 10 s |
| Background sync | 8 s | 20 s | 30 s |
| Media upload | 10 s | 60 s | 120 s |
| Presence WebSocket | 5 s | — (ping-driven) | — |

---

## 6. Offline and Room

Every screen renders from Room first and from the network second. The app is usable on a
Bangladeshi mobile network, which means it is usable on an intermittent one.

```kotlin
/**
 * The single data-flow shape used by every repository in all three apps.
 *
 * Emits cached data immediately (if any), then refreshes, then emits again.
 * The UI shows content with a subtle refreshing indicator rather than a
 * spinner over an empty screen — a spinner over data you already have is a
 * self-inflicted wound.
 */
inline fun <T, R> networkBoundResource(
    crossinline query: () -> Flow<T>,
    crossinline fetch: suspend () -> R,
    crossinline saveFetch: suspend (R) -> Unit,
    crossinline shouldFetch: (T) -> Boolean = { true },
): Flow<Resource<T>> = flow {
    val first = query().first()
    if (shouldFetch(first)) {
        emit(Resource.Loading(first))
        try {
            saveFetch(fetch())
            emitAll(query().map { Resource.Success(it) })
        } catch (t: Throwable) {
            emitAll(query().map { Resource.Error(t.toUndalError(), it) })
        }
    } else {
        emitAll(query().map { Resource.Success(it) })
    }
}
```

### 6.1 What is cached, and for how long

| Data | App | Policy |
| --- | --- | --- |
| Vendor list | Customer | 5 min; shown stale with a "refreshing" chip |
| Vendor menu | Customer | 30 min; shown stale with the last-updated time |
| Cart | Customer | Indefinite, local-first; the cart survives a reinstall via the server copy |
| Order history | Customer | Indefinite; the last 50 orders |
| Active order | All | Live; never served stale without a visible staleness notice |
| Menu (own) | Partner | Indefinite; **edits queue offline** and sync on reconnect |
| Today's orders | Partner | Live |
| Offer | Rider | Never cached — an offer is only valid live |
| Active delivery | Rider | Indefinite while active, including the route polyline, so a rider in a dead zone can still navigate |
| Earnings | Rider | 10 min |

### 6.2 The outbox

Mutations made offline go into an `outbox` table and are replayed in order on reconnect, each with
its persisted idempotency key. The UI shows an "will send when you're back online" chip on the
affected object. Partner menu edits and rider delivery confirmations are the two cases that matter
most, and both are fully offline-capable.

### 6.3 Encryption

Room databases in Partner and Rider are encrypted with SQLCipher, keyed from the Android Keystore,
because those databases contain customer addresses and phone numbers. The customer app's database
is not encrypted (it contains only the user's own data, already protected by the device lock) but
the session token is, in `EncryptedSharedPreferences`.

---

## 7. The design system module

`core:designsystem` is the single source of visual truth and it contains **no feature logic**.

| Contents | Count |
| --- | --- |
| Colour tokens (light + dark) | 94 |
| Type styles | 18 |
| Spacing / radius / elevation tokens | 31 |
| Motion specs (durations, springs, easings) | 22 |
| Components | 64 |
| Icons (custom, as `ImageVector`) | 118 |
| Illustrations (empty states, errors) | 44 |

Tokens are generated from `design/tokens.json` by a Gradle task, the same JSON that generates the
web CSS variables ([`20`](20-web-storefront.md)). A single file changes both platforms, and the
`token-purity` CI job fails on any hard-coded colour, dimension or duration literal in a feature
module.

### 7.1 Responsive foundation

```kotlin
/**
 * Undal supports 200dp to 3840dp with no structural break. On Android the
 * practical floor is a 200dp-wide split-screen window on a small phone, and
 * the ceiling is a desktop-mode Samsung DeX window. Both are real.
 */
enum class UndalWidth { XXS, XS, SM, MD, LG, XL, XXL }

@Composable
fun rememberUndalWidth(): UndalWidth {
    val dp = LocalConfiguration.current.screenWidthDp
    return when {
        dp < 320  -> UndalWidth.XXS      // 200-319: single column, icons only, no side padding
        dp < 384  -> UndalWidth.XS
        dp < 600  -> UndalWidth.SM       // the common phone
        dp < 840  -> UndalWidth.MD       // large phone landscape, small tablet
        dp < 1024 -> UndalWidth.LG       // tablet — the partner's primary device
        dp < 1280 -> UndalWidth.XL
        else      -> UndalWidth.XXL      // DeX, Chromebook
    }
}
```

**No composable in the codebase may use a fixed `width` in dp** except for icons, avatars and
deliberate square media. The `no-fixed-width` lint rule enforces it. Layouts use `fillMaxWidth`,
`weight`, `BoxWithConstraints` and `FlowRow`.

---

## 8. Maps

MapLibre Native, with OSM raster tiles from a configurable tile host and a vector style when one is
available.

| Concern | Decision |
| --- | --- |
| Attribution | **"© OpenStreetMap contributors"** is permanently visible on every map, non-dismissible, legible against both light and dark styles. The `osm-attribution` CI job greps every map composable for the attribution component |
| Tiles | `TILE_BASE_URL` from config; a self-hosted or community tile server. Tiles cached to disk, 64 MB cap, LRU |
| Offline | The rider app pre-downloads its zone's tiles at zoom 12–16 on first shift start over Wi-Fi (~18 MB for Sylhet) |
| Markers | SVG-sourced `ImageVector`s rendered to bitmaps once and reused; never a `Canvas` redraw per frame |
| Rider animation | Position interpolated over `max(250 ms, actual update interval)`, with bearing eased separately. [`04`](04-motion-and-interaction.md) |
| Route line | The OSRM polyline, decoded once, drawn as a `LineLayer` with a travelled/remaining split |
| Performance budget | 60 fps with 150 markers on a 2019 mid-range device; enforced by a macrobenchmark |

---

## 9. Permissions

Every permission is requested **in context**, immediately before the feature that needs it, with a
one-sentence rationale shown first.

| Permission | App | When | If denied |
| --- | --- | --- | --- |
| `POST_NOTIFICATIONS` | All | Onboarding, step 5 | Customer: degraded but usable. Partner/Rider: **blocking** — the app explains it cannot function and offers the settings deep link |
| `ACCESS_FINE_LOCATION` | All | Address setup / shift start | Customer: manual address entry works perfectly. Rider: **blocking** |
| `ACCESS_COARSE_LOCATION` | All | Fallback | Accepted with a note that delivery estimates will be rougher |
| **`ACCESS_BACKGROUND_LOCATION`** | **None** | **Never requested** | Undal tracks riders only during an active foreground-service shift. [`07 §12`](07-d1-live-tracking.md) |
| `CAMERA` | Partner, Rider | QR scan / selfie | Blocking for that action only |
| `FOREGROUND_SERVICE` + `_SPECIAL_USE` | Partner, Rider | Manifest | — |
| `FOREGROUND_SERVICE_LOCATION` | Rider | Manifest | — |
| `USE_FULL_SCREEN_INTENT` | Partner, Rider | Onboarding | Alarm still sounds; screen does not turn on; degradation reported |
| `SCHEDULE_EXACT_ALARM` | Partner, Rider | Onboarding | Used only for the alarm re-pulse ceiling; graceful fallback to inexact |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Partner, Rider | Onboarding | Coaching card persists |
| `VIBRATE`, `WAKE_LOCK`, `INTERNET` | All | Manifest | — |

Not requesting `ACCESS_BACKGROUND_LOCATION` is a significant choice. It costs nothing (the
foreground service covers every real need), it removes the hardest Play Store review in mobile,
and it means Undal genuinely cannot track a rider who is off shift.

---

## 10. Performance budgets

Measured by macrobenchmark on a Redmi Note 10 (Snapdragon 678, 4 GB) — a realistic mid-range
Bangladeshi device, not a flagship.

| Metric | Budget |
| --- | --- |
| Cold start to first frame | ≤ 1 400 ms |
| Cold start to interactive home | ≤ 2 200 ms |
| Warm start | ≤ 600 ms |
| Frame p99 (jank) | ≤ 16.6 ms; < 1% janky frames |
| Scroll a 60-vendor list | 0 dropped frames |
| APK size, customer | ≤ 12 MB |
| APK size, partner | ≤ 20 MB |
| APK size, rider | ≤ 24 MB |
| Memory, steady state | ≤ 180 MB |
| Battery, 8 h rider shift | ≤ 14% of a 5 000 mAh battery |

Baseline Profiles are generated in CI for all three apps. Startup is measured on every PR and a
regression over 8% fails the build (`perf-budget`).

The battery figure is the one riders care about most and it drives real decisions: the location
cadence ladder in [`07 §5`](07-d1-live-tracking.md), the 750 ms heartbeat rather than 250 ms, and
map tile caching rather than re-fetching.

---

## 11. Error handling

```kotlin
sealed interface UndalError {
    data class Network(val cause: Throwable) : UndalError
    data class Timeout(val afterMs: Long) : UndalError
    data class Api(val code: String, val message: Localised, val field: String?) : UndalError
    data class Auth(val reason: AuthFailure) : UndalError
    data class Validation(val fields: Map<String, Localised>) : UndalError
    data object Offline : UndalError
    data class Unknown(val cause: Throwable) : UndalError
}
```

Every error reaching a screen must produce: **what happened**, **why**, and **what to do next** —
in the user's language, from the server's localised message where one exists and from a local
table otherwise. The 187 server error codes ([`08`](08-api-contract.md)) each have a Bengali and
English string in `core:common`, and the `i18n-completeness` CI job fails if any code is missing
either.

A raw exception message, a stack trace, or the string "Something went wrong" never reaches a user.
The last of those is specifically banned by a lint rule, because it is the single most useless
sentence in software.

---

## 12. Testing

| Layer | Tool | Coverage target |
| --- | --- | --- |
| Pure Kotlin (`core:model`, `core:money`) | JUnit5 | **100%** on money and fare math |
| Repositories | JUnit5 + Turbine + fake API | 90% |
| ViewModels | JUnit5 + Turbine | 90% |
| Compose components | Compose UI Test + Robolectric | Every component, every state |
| Screens | Compose UI Test | Every screen in loading / empty / error / content |
| Responsive | Screenshot test at **50 widths** × light/dark × en/bn | Every screen; zero overflow, zero clipping |
| Accessibility | Compose a11y assertions | Every interactive element ≥ 48 dp, labelled, 4.5:1 contrast |
| Integration | Instrumented, against a local Worker | The 12 critical journeys |
| Alarm | Firebase Test Lab | The matrix in [`15 §12`](15-wakeup-alarm-fcm.md) |
| Performance | Macrobenchmark | §10 |

### 12.1 The responsive matrix

The `responsive-matrix` job renders every screen at 50 widths from 200 dp to 3840 dp and asserts:
no horizontal scroll, no clipped text, no overlapping elements, every touch target ≥ 48 dp, and no
element narrower than its content. 283 screens × 50 widths × 2 themes × 2 languages is 56 600
screenshots; they are rendered by Robolectric at a few hundred per second and only diffs are
uploaded as artifacts.

---

## 13. The 700-line rule

The brief requires every file to be at most 700 lines. In Compose this is a genuine constraint and
it is met by a consistent decomposition:

```
feature/customer-vendor/src/main/kotlin/com/undal/feature/vendor/
├── VendorScreen.kt            ← route, scaffold, state hoisting      (~180)
├── VendorViewModel.kt         ← state machine, intents               (~240)
├── VendorUiState.kt           ← sealed state + reducers              (~120)
├── components/
│   ├── VendorHeader.kt        ← collapsing header + parallax         (~210)
│   ├── VendorInfoRow.kt                                              (~90)
│   ├── MenuCategoryTabs.kt    ← sticky tabs + scroll sync            (~260)
│   ├── MenuItemCard.kt                                               (~190)
│   ├── MenuItemSheet.kt       ← options, quantity, add               (~320)
│   ├── VendorClosedBanner.kt                                         (~110)
│   └── VendorEmptyMenu.kt                                            (~80)
└── nav/VendorNavigation.kt                                           (~60)
```

The `line-budget` CI job fails on any file over 700 lines and **warns at 600**, which is the number
that actually keeps files small. The warning threshold is where the discipline lives.

---

## 14. Reading on

Next: [`17-customer-app.md`](17-customer-app.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
