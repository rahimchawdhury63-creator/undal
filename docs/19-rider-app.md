<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 19 — Rider App

> `com.undal.rider` · 61 screens · Android only. Logo: `brand/undal-rider-logo.jpg`. Used
> one-handed, in traffic, in rain, on a phone with 23% battery, by someone whose income depends on
> it. It must be legible in sunlight, operable with a thumb, and it must never lie about money.

---

## 1. Operating assumptions

| Assumption | Consequence |
| --- | --- |
| One hand, often gloved, often wet | 56 dp minimum targets, 72 dp for primary actions, slide-to-confirm for anything irreversible |
| Bright sunlight | A high-contrast daylight theme with 7:1 ratios, auto-switching on ambient light |
| Battery anxiety | A 14%-per-8-hour budget ([`16 §10`](16-android-foundation.md)); a visible battery-saving mode |
| Data cost matters | ~14 MB per 8-hour shift including map tiles; the number is shown in settings |
| Income depends on clarity | Every payout figure is broken down before acceptance and never changes afterwards |
| Riding while using it is dangerous | Navigation hands off to a maps app; the app itself does nothing that requires reading while moving |

---

## 2. Screen inventory

| Group | Screens | |
| --- | --- | --- |
| Onboarding & KYC | 13 | [`23`](23-onboarding-kyc.md) |
| Auth | 5 | |
| Shift | 7 | Pre-shift, selfie, zone select, active, break, end, summary |
| Offers | 4 | Offer card, bundle offer, reject reason, no-alternative |
| Active delivery | 11 | To-vendor, at-vendor, QR scan, picked-up, to-customer, arrived, handover, cash, delivered, bundle stops, problem |
| Earnings | 6 | Today, week, breakdown, invoice list, invoice detail, payout account |
| **Cash settlement** | 6 | [`25`](25-rider-cash-settlement.md) — the blocking screen and its flow |
| Performance | 4 | Score, acceptance, ratings, tips |
| Settings | 8 | Profile, vehicle, documents, device health, notifications, language, data usage, legal |
| System | 7 | Offline, update, maintenance, suspended, GPS-required, battery-warning, error |
| **Total** | **61** | |

---

## 3. Shift start

> *"when a Rider start his shift he should verify himself with a selfie."*

```
  ┌───────────────────────────────────────┐
  │          Ready to start?              │
  │                                       │
  │   Zone     Sylhet Central        ▾    │
  │   Vehicle  Honda · DHA-LA-12-3456     │
  │                                       │
  │   ✓  Location on                      │
  │   ✓  Notifications on                 │
  │   ✓  Battery 87%                      │
  │   ✓  Alarm tested 2 days ago          │
  │   ✓  No cash outstanding              │
  │                                       │
  │   ┌─────────────────────────────┐     │
  │   │      TAKE SELFIE & START    │     │
  │   └─────────────────────────────┘     │
  └───────────────────────────────────────┘
```

### 3.1 The selfie check

| Property | Value |
| --- | --- |
| Camera | Front, CameraX, with an oval guide |
| On-device checks | A face is present (ML Kit, bundled), eyes open, the face fills 25–70% of the frame, not too dark, not blurred (Laplacian variance above a threshold) |
| Liveness | A randomly chosen prompt — turn left, turn right, blink — verified on-device. Not a full anti-spoofing system, and the documentation says so; it stops a casual photo-of-a-photo, not a determined attacker |
| Upload | **imgbb**, per the brief ([`26`](26-media-pipeline.md)); the URL is stored on `rider_shifts.selfie_url` |
| Verification | Automatic acceptance on the on-device checks; a sampled 10% plus all first-shifts go to admin review. Failing review ends the shift and raises a case |
| Retention | 30 days, then deleted |
| Failure | Three failed attempts → a manual-review path, not a lockout. A rider who cannot start a shift because of a camera heuristic is a rider who cannot eat |

### 3.2 What starting a shift does

1. `rider_shifts` row opened, `shift_state = ONLINE`.
2. The foreground service starts, with a persistent notification showing today's earnings.
3. The **D1 location channel opens** ([`07`](07-d1-live-tracking.md)).
4. The presence WebSocket connects ([`14`](14-presence-and-heartbeat.md)).
5. Zone map tiles are pre-cached if on Wi-Fi.
6. The rider becomes a dispatch candidate.

The brief's minimum commitment — **4 hours a day, 5 days a week** — is tracked and shown as
progress, not enforced as a lockout. Falling below it for two consecutive weeks triggers a
conversation, not a suspension.

---

## 4. The offer

The most important 25 seconds in the app. Arrives as a full-screen alarm
([`15 §5`](15-wakeup-alarm-fcm.md)) even on a locked phone.

```
╔═══════════════════════════════════════════════╗
║  NEW ORDER                         ◷ 0:22     ║
╠═══════════════════════════════════════════════╣
║  YOU EARN                                     ║
║                                               ║
║            ৳ 83.70                            ║
║                                               ║
║  Delivery fare                        ৳65.20  ║
║  Order bonus (3%)                     ৳13.50  ║
║  Small-order fee share                 ৳5.00  ║
║  ─────────────────────────────────────────── ║
║  3.8 km  ·  ~18 min  ·  ৳22.03/km             ║
╠═══════════════════════════════════════════════╣
║  🏪  Rahman's Biriyani House                  ║
║      Zindabazar  ·  420 m  ·  ready in 7 min  ║
║                                               ║
║  📍  Shibganj, House 42, 3rd floor            ║
║      3.8 km from the restaurant               ║
║                                               ║
║  💵  Collect ৳549.00 in cash                  ║
║      You're carrying ৳1,240 of ৳3,500         ║
║                                               ║
║  📦  3 items  ·  no special handling          ║
╠═══════════════════════════════════════════════╣
║  [ map preview: you → vendor → customer ]     ║
╠═══════════════════════════════════════════════╣
║      ◀━━━━━━━ SLIDE TO ACCEPT ━━━━━━━▶        ║
║                 Can't take it?                ║
╚═══════════════════════════════════════════════╝
```

> *"the rider should see the full details of the order before accept and reject."*

Everything is on this one card: the money broken down line by line, both addresses, the distance,
the time, the per-kilometre rate, the cash to collect, the rider's current cash load, the item
count, and any special handling. Nothing is revealed only after accepting.

**The payout shown here is binding.** Once accepted, the fare cannot decrease. It can only
increase — a tip, a recovery bonus, a traffic-delay payment. This is a hard guarantee, asserted by
property P23 in [`10 §13`](10-fare-engine-math.md), and it is the foundation of the rider's trust
in every other number the app shows.

### 4.1 Rejecting

[`11 §9`](11-dispatch-engine.md) specifies the logic. In the UI:

- If another rider is available: the reason sheet opens immediately. Ten reasons, each one tap, no
  typing except for "Other".
- If nobody else is available: the no-alternative sheet, the 10-second countdown, and a dignified
  exit that carries no penalty.

---

## 5. Active delivery

A stop-based interface, identical in structure whether there is one order or three.

```
╔═══════════════════════════════════════════════╗
║  [ map: route leg highlighted ]               ║
║  © OpenStreetMap contributors                 ║
╠═══════════════════════════════════════════════╣
║  ●  Rahman's Biriyani House                   ║
║     Zindabazar · 420 m · ready 14:22          ║
║     📞 Call restaurant                        ║
║                                               ║
║     ┌───────────────────────────────────┐     ║
║     │   🧭  NAVIGATE                    │     ║
║     └───────────────────────────────────┘     ║
║     ┌───────────────────────────────────┐     ║
║     │   📷  SCAN QR TO PICK UP          │     ║
║     └───────────────────────────────────┘     ║
║                                               ║
║  ○  Shibganj, House 42                        ║
║     3.8 km · collect ৳549.00                  ║
╠═══════════════════════════════════════════════╣
║  Something wrong?                             ║
╚═══════════════════════════════════════════════╝
```

### 5.1 Navigation handoff

> *"one-tap Google Maps app handoff routing rider → vendor → customer."*

```kotlin
/**
 * Hand off one leg at a time. A multi-waypoint URL is tempting but it is
 * fragile: different Maps versions handle the waypoint syntax differently,
 * and a rider mid-ride cannot debug a broken deep link.
 *
 * Preference order: Google Maps turn-by-turn → any installed navigation app
 * via the geo: intent → the in-app MapLibre route as a last resort.
 */
fun navigateTo(ctx: Context, dest: LatLng, label: String) {
    val gmaps = Uri.parse("google.navigation:q=${dest.lat},${dest.lon}&mode=d")
    val i = Intent(Intent.ACTION_VIEW, gmaps).setPackage("com.google.android.apps.maps")
    if (i.resolveActivity(ctx.packageManager) != null) { ctx.startActivity(i); return }

    val geo = Uri.parse("geo:${dest.lat},${dest.lon}?q=${dest.lat},${dest.lon}(${Uri.encode(label)})")
    val g = Intent(Intent.ACTION_VIEW, geo)
    if (g.resolveActivity(ctx.packageManager) != null) { ctx.startActivity(g); return }

    InAppNavigation.start(ctx, dest)      // MapLibre + the cached OSRM polyline
}
```

`mode=b` (bicycling) for bicycle riders where the device supports it.

When the rider returns from Maps, the app is exactly where they left it, with the next action
ready. Android's back behaviour from Maps is not reliable, so the app also posts a persistent
notification with a "Back to Undal" action.

### 5.2 Pickup

The QR scan ([`18 §4`](18-partner-app.md)). Camera opens directly on the scan screen, torch
toggle available, and the frame guide is large. A successful scan vibrates, plays a short tone,
and advances the stop list with a 240 ms transition.

Server-side checks on scan: HMAC, order state, assigned rider, and **within 150 m of the vendor**.
A rider who scans a screenshot from home gets a clear refusal: *"You need to be at the restaurant
to pick this up."*

The 6-digit fallback code is available behind a "Camera not working?" link.

### 5.3 Delivery

```
╔═══════════════════════════════════════════════╗
║  ARRIVED AT                                   ║
║  Shibganj, House 42, 3rd floor                ║
║  Landmark: beside the blue mosque             ║
║  📞 Call customer     💬 Message              ║
╠═══════════════════════════════════════════════╣
║  COLLECT                                      ║
║                                               ║
║           ৳ 549.00                            ║
║                                               ║
║  Customer pays with   [ ৳500 ] [ ৳1000 ]      ║
║                       [ Exact ] [ Other ]     ║
║                                               ║
║  Give change:  ৳451.00                        ║
╠═══════════════════════════════════════════════╣
║      ◀━━━━━━ SLIDE TO COMPLETE ━━━━━━▶        ║
╚═══════════════════════════════════════════════╝
```

The change calculator is a small thing that saves a real argument at a door at 10 pm. Tapping a
denomination shows the change immediately in large type.

Sliding to complete:
1. Marks `DELIVERED` with a timestamp and the final position.
2. Adds the order total to `cash_in_hand_paisa`.
3. Credits the rider's earnings ledger.
4. Plays a short satisfying confirmation and shows the running day total.
5. Returns to the offers screen, or to the next stop in a bundle.

Offline, all five happen locally and queue in the outbox with the true timestamp. The rider is
never blocked from completing a delivery by a network failure — that would be the app failing at
its one job.

### 5.4 "Something wrong?"

| Problem | Flow |
| --- | --- |
| Customer not answering | A 5-minute guided timer: call, message, wait, call again. Then admin contact. Then, with admin approval, return-to-vendor with full fare paid |
| Wrong address | Map correction; the customer is messaged; the corrected position is proposed to the customer's address book |
| Order not ready | Logged. Beyond 10 minutes past promised, traffic-style wait compensation accrues and the vendor's `prep_accuracy` is affected |
| Items missing | Photo + note; the vendor is notified before the rider leaves |
| Accident / unsafe | A single large button that immediately alerts admin with position, pauses the shift, and shows emergency numbers |
| Vehicle breakdown | Alerts admin, triggers reassignment, pays for the completed legs |

---

## 6. Earnings

```
  TODAY                                   Thu 1 Nov
  ─────────────────────────────────────────────────
         ৳ 1,284.50
         11 deliveries · 6h 20m · ৳202/hr

  Delivery fares                         ৳  972.00
  Order bonuses (3%)                     ৳  183.50
  Small-order fee shares                 ৳   45.00
  Tips                                   ৳   84.00
  Weather premium                        ৳    0.00
  ─────────────────────────────────────────────────
  Penalties                              ৳    0.00

  Cash in hand                           ৳ 2,140.00
  ████████████░░░░░░░░  61% of ৳3,500

  Next payout: Friday 7 Nov  ·  ৳4,820 so far
```

Every figure is traceable to individual orders by tapping. The per-hour number uses **active shift
time**, not elapsed wall-clock, and the app says which.

Weekly invoices appear here as PDFs ([`24`](24-finance-payouts-invoices.md)), paid every
**Friday**.

---

## 7. Performance

```
  YOUR SCORE                                  0.78
  ████████████████░░░░

  Acceptance        0.84   ▲   Top 20% in your zone
  Completion        0.96   ─
  On-time           0.91   ▲
  Rating            4.8 ★ (203)   ─
  Cash accuracy     1.00   ─

  WHAT THIS AFFECTS
  Your score is one of fourteen things that
  decide who gets an order. The others include
  how close you are, whether you'd arrive when
  the food is ready, and how much work you've
  already had today — that last one works in
  your favour when you've had a quiet morning.

  [ How dispatch works ]
```

Riders are told how dispatch works, in plain language, with a link to a readable summary of
[`11`](11-dispatch-engine.md). A scoring system nobody understands is a scoring system nobody
trusts, and distrust in dispatch is the fastest way to lose a fleet.

The `fairness` factor is explained explicitly because it is counter-intuitive and because it is
good news: a quiet morning improves your position.

---

## 8. Break and end of shift

| Action | Effect |
| --- | --- |
| **Break** | 15/30/60 min or open-ended. No offers; presence stays connected; **the D1 channel stays open** so an in-progress order remains trackable; shift time pauses |
| **Resume** | Immediate |
| **End shift** | Blocked while any order is active. Opens the shift summary, then — if cash is outstanding — the **blocking cash settlement screen** ([`25`](25-rider-cash-settlement.md)) |

```
  SHIFT SUMMARY                     14:02 – 20:22

  6h 20m online  ·  11 deliveries  ·  48.2 km
  ৳1,284.50 earned  ·  ৳202/hour

  ✓ Best day this week
  ✓ 100% on-time

  Cash to settle                        ৳2,140.00

  ┌─────────────────────────────────────────┐
  │           SETTLE CASH & FINISH          │
  └─────────────────────────────────────────┘
```

---

## 9. Battery and data

```
  BATTERY THIS SHIFT        11%  over 6h 20m
    Location                  4.2%
    Screen                    3.8%
    Network                   1.9%
    Maps                      1.1%

  DATA THIS SHIFT           11.4 MB
    Map tiles                 6.8 MB  (cached: 42 MB saved)
    Location updates          1.2 MB
    Orders and images         2.9 MB
    Heartbeat                 0.5 MB

  [ Battery saver ]  Fewer map redraws, dimmer
                     map style, location every
                     45s instead of 25s while
                     carrying. Offers are
                     unaffected.
```

Publishing these numbers is unusual and deliberate. Riders universally believe delivery apps drain
their batteries; showing the actual breakdown — and offering a real saver mode that explicitly
does not touch offer delivery — converts a grievance into a setting.

---

## 10. Safety

| Feature | Behaviour |
| --- | --- |
| **SOS** | A persistent entry in the active-delivery overflow and on the shift screen. One tap: admin alerted with live position, shift paused, local emergency numbers shown, and a 30-second countdown before an optional automatic call |
| Night mode | After sunset the app switches to the dark map style, raises contrast, and shortens the location interval slightly for better trail accuracy |
| Unsafe area | The `AREA_UNSAFE` rejection reason creates a permanent per-rider exclusion for that cell, no questions asked ([`11 §9.2`](11-dispatch-engine.md)) |
| Speed warning | Sustained speed above 60 km/h shows a single non-modal warning and logs it. No gamification of speed exists anywhere in the app |
| Masked calling | Where configured; otherwise the privacy screen says plainly that numbers are visible to each other |
| Fatigue | After 10 continuous hours the app suggests a break; after 13 it requires one. Nobody should be dispatched into a fourteenth hour |

---

## 11. Offline

| Capability | Offline |
| --- | --- |
| Receive an offer | **No.** An offer requires a live connection and the app says so |
| Navigate | **Yes** — cached tiles and the stored OSRM polyline |
| Scan QR | Queued; the geofence is checked against the device's own position and re-verified on sync |
| Mark delivered | **Yes**, queued with the true timestamp |
| Collect cash | Yes; recorded locally and reconciled on sync |
| See earnings | Yes, from cache, with the fetch time shown |
| Settle cash | **No** — it needs the server. The blocking screen explains and retries automatically |
| End shift | Yes, locally; the settlement screen appears when connectivity returns and remains blocking |

---

## 12. Testing

| Test | Count |
| --- | --- |
| Screen states | 244 |
| Offer card arithmetic against all 40 fare vectors | 40 |
| Offer timing, expiry, withdrawal, and race-loss | 26 |
| Reject flows, all 10 reasons, both branches | 31 |
| Stop list, sequencing, bundle ordering | 29 |
| QR scan, geofence, fallback code, offline queue | 22 |
| Cash arithmetic, change calculator, limits | 34 |
| Selfie checks on a 200-image fixture set | 18 |
| Shift lifecycle, D1 open/erase coupling | 24 |
| Battery macrobenchmark, 8-hour simulated shift | 1 |
| Offline matrix, every row of §11 | 13 |
| Responsive, 50 widths | 61 screens |
| Sunlight-legibility contrast assertions | 61 screens |

---

## 13. Reading on

Next: [`20-web-storefront.md`](20-web-storefront.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
