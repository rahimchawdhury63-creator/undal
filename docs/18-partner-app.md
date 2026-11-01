<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 18 — Partner App

> `com.undal.partner` · 54 screens · Android only, by design. Logo:
> `brand/undal-partner-logo.jpg`. This is a tool that runs for twelve hours a day on a cheap
> tablet propped next to a hot stove, operated by someone with flour on their hands who has four
> seconds to look at it. Every decision below follows from that sentence.

---

## 1. Operating assumptions

| Assumption | Consequence |
| --- | --- |
| The device is a ৳9 000 Android tablet, 2 GB RAM, Android 10 | `minSdk 24`, aggressive memory discipline, no heavy animation during order flow |
| It is plugged in and the screen is on all day | A keep-screen-on mode; dark theme available for night kitchens |
| It is 1–2 metres away | Order cards use 22–34 sp type; the accept target is 96 dp tall |
| It is touched with wet or greasy hands | No small targets, no long-press-only actions, no swipe-only destructive actions |
| Wi-Fi is unreliable | Full offline menu editing, an outbox, and a very loud offline banner |
| The operator is not technical | No jargon, no error codes shown without a plain sentence, no settings maze |
| Missing an order costs real money | The alarm ([`15`](15-wakeup-alarm-fcm.md)) is the most important feature in the app |

**iOS is not supported for partners.** The brief says so, and the reason is honest: the alarm
behaviour this app depends on cannot be replicated on iOS, where a killed app cannot be woken to
play looping audio. An iPhone-owning vendor uses the responsive website, which gives them
everything except the alarm — and they are told exactly that, in those words, before they sign up.

---

## 2. Screen inventory

| Group | Screens | |
| --- | --- | --- |
| Onboarding & KYC | 11 | Covered in [`23`](23-onboarding-kyc.md) |
| Auth | 5 | Login, device registration, session list, forgot, locked |
| Orders | 9 | Live board, order detail, QR screen, prep-time, reject reason, history, search, dispute, cancelled |
| Menu | 12 | Categories, items, item editor, options, availability, bulk actions, photos, import, preview, flash box, pricing, out-of-stock |
| Hours | 4 | Weekly schedule, special days, pause, holiday |
| Performance | 5 | Dashboard, rank explain, prep accuracy, ratings, reviews |
| Finance | 5 | Earnings, invoices, invoice detail, payout history, payout account |
| Settings | 8 | Profile, service area, device health, alarm test, notifications, staff accounts, language, legal |
| System | 5 | Offline, update, maintenance, suspended, error |
| **Total** | **54** | |

---

## 3. The live order board

The home screen, and the screen the app spends 95% of its life on.

```
╔═══════════════════════════════════════════════════════════════════╗
║  Rahman's Biriyani House          ● OPEN     🔊 ✓   📶 ✓   🔋 87% ║
║                                                                   ║
║  ┌─────────────┬─────────────┬─────────────┬──────────────────┐  ║
║  │  NEW  (1)   │ COOKING (3) │  READY (2)  │  HANDED OVER (4) │  ║
║  └─────────────┴─────────────┴─────────────┴──────────────────┘  ║
║                                                                   ║
║  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  ║
║  ┃ #7K2M9QX4                               🔴 0:47 to accept ┃  ║
║  ┃ 3 items · ৳549 · Shibganj · 3.8 km                        ┃  ║
║  ┃ ───────────────────────────────────────────────────────── ┃  ║
║  ┃ 1 × Kacchi Biriyani (Full)                                ┃  ║
║  ┃ 1 × Borhani            1 × Firni                          ┃  ║
║  ┃ 📝 "Kom jhal please"                                      ┃  ║
║  ┃ ───────────────────────────────────────────────────────── ┃  ║
║  ┃ Prep time:   −   [  25 min  ]   +        suggested 22     ┃  ║
║  ┃                                                            ┃  ║
║  ┃ ┌──────────────────────────┐  ┌────────────────────────┐  ┃  ║
║  ┃ │       ✗  REJECT          │  │     ✓  ACCEPT          │  ┃  ║
║  ┃ └──────────────────────────┘  └────────────────────────┘  ┃  ║
║  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  ║
║                                                                   ║
║  COOKING                                                          ║
║  ┌────────────────────┐ ┌────────────────────┐ ┌───────────────┐ ║
║  │ #3P8W1ZB6   8:12   │ │ #9Q4R7TC1  14:03   │ │ #2M6N8VD5 3:40│ ║
║  │ 2 items  ৳312      │ │ 5 items  ৳1,240    │ │ 1 item  ৳180  │ ║
║  │ [ MARK READY ]     │ │ [ MARK READY ]     │ │ [ MARK READY ]│ ║
║  └────────────────────┘ └────────────────────┘ └───────────────┘ ║
╚═══════════════════════════════════════════════════════════════════╝
```

| Decision | Rationale |
| --- | --- |
| Four columns on tablet, a single scrolling list below 600 dp | The columns *are* the workflow |
| A new order takes over the top of the board and cannot be scrolled past | Missing it is the failure mode |
| Both buttons are the same size | A reject button smaller than accept is a dark pattern; vendors notice and resent it |
| Countdown is red from the start | There is no calm phase of an unaccepted order |
| The status strip (🔊 📶 🔋) is permanent | Three facts the vendor must be able to check at a glance; tapping any opens its diagnostic |
| Cooking cards show elapsed, not remaining | Elapsed is a fact; remaining is a guess, and a wrong guess erodes trust in the whole board |
| At 80% of promised prep time, the card turns amber; past 100%, red | The kitchen's own early-warning system |

### 3.1 Accepting

One tap. No confirmation dialog — the alarm already demanded attention and a second confirmation is
one more thing between a busy kitchen and a confirmed order. The card animates into the COOKING
column over 320 ms, the alarm stops within 50 ms of the tap, and a short success tone plays.

### 3.2 Prep time

The brief's requirement, implemented as specified:

> *"the vendor will set preparation time by + and − like foodpanda... by default the AI should
> predict it from performance, average preparation time, order size and weather... maximum 200
> minutes."*

| Property | Value |
| --- | --- |
| Default | The Brain's suggestion ([`09 §9`](09-undal-brain-overview.md)), pre-filled |
| Step | 5 minutes below 60, 10 minutes above |
| Range | 5–200 minutes, hard-clamped |
| Suggestion shown | Always, next to the control: "suggested 22" |
| Accuracy feedback | After the order, the board shows "you said 25, it took 31" — the data that drives `prep_accuracy` ([`13 §6`](13-ranking-personalization.md)) |
| Busy-mode offset | A global "+10 min on everything" toggle for a rush, with an auto-expiry the vendor sets |

The suggestion is advisory, never enforced. A vendor who consistently beats or misses it sees the
pattern on their performance dashboard with the specific sentence that will help most:
*"You promise 20 minutes and average 31. Setting 30 would raise your ranking score more than any
other single change."*

### 3.3 Rejecting

A reason is required, from a fixed list with a free-text "other":

`OUT_OF_STOCK` (with item selection) · `TOO_BUSY` · `CLOSING_SOON` · `ITEM_UNAVAILABLE_TODAY` ·
`KITCHEN_PROBLEM` · `CANNOT_MAKE_THIS_VARIANT` · `OTHER`

Selecting `OUT_OF_STOCK` offers a one-tap *"Also mark these items unavailable"*, which is the
single most useful follow-up in the app: it prevents the next three identical orders.

Rejections affect `accept_rate`, which affects ranking. The vendor is told this once, clearly,
during onboarding, and the performance dashboard shows the current figure — never a surprise.

---

## 4. The QR handover

> *"the Rider will scan the QR code from the vendor's order screen with his phone camera."*

```
╔══════════════════════════════════════╗
║           #7K2M9QX4                  ║
║                                      ║
║        ████  ██  ████  ██            ║
║        ██  ████  ██  ████            ║
║        ████  ██████  ██              ║     200 dp, max brightness,
║        ██  ██  ██  ██████            ║     white background forced
║        ████████  ████  ██            ║
║                                      ║
║        Show this to the rider        ║
║                                      ║
║   🛵  Karim is 2 minutes away        ║
║                                      ║
║        Bag tag:  7                   ║
╚══════════════════════════════════════╝
```

| Property | Value |
| --- | --- |
| Payload | `UNDAL:v1:{orderCode}:{issuedAt}:{hmac}` — [`08`](08-api-contract.md) |
| Rotation | Re-rendered every 60 s with a fresh `issuedAt`; a screenshot stops working after 4 hours |
| Server checks | HMAC valid, order in `RIDER_ASSIGNED`, scanning rider is the assigned rider, rider within **150 m** of the vendor, `issuedAt` within 4 h |
| Brightness | Forced to maximum while displayed, restored on exit — a dim tablet in a bright kitchen cannot be scanned |
| Bag tag | A number shown here and on the rider's stop list, so a bundle's two bags cannot be swapped |
| Fallback | A 6-digit code below the QR, enterable by the rider if the camera fails. Same server checks, same geofence |
| Offline | The QR renders from locally cached data; the *scan* requires the rider to be online, and if they are not, the rider app queues the pickup confirmation in its outbox with a timestamp |

---

## 5. Menu management

The second-most-used area, and the one where offline support matters most — menu work happens in
quiet moments, which are often also the moments the Wi-Fi is being flaky.

| Capability | Detail |
| --- | --- |
| Categories | Create, rename, reorder (drag), hide, delete-with-move |
| Items | Name (en/bn), description, price, photo, category, prep contribution, tags, allergens |
| Option groups | Required/optional, single/multi, min/max selections, per-option price delta |
| Availability | Per-item toggle; **"out today"** auto-restores at the next opening time; "out until I say" persists |
| Bulk | Multi-select for price adjust (±%, ±৳), availability, category move, delete |
| Photos | CameraX capture with a framing guide, crop to 4:3, auto-enhance, upload to imgbb ([`26`](26-media-pipeline.md)) |
| Flash Box | Per-item or whole-menu 25% campaign, with a live preview of the vendor's own net per item |
| Preview | "See it as a customer does" — renders the real customer vendor page |
| Import | CSV with a template download, column mapping, a dry-run diff, and a single confirm. No partial imports |
| Offline | Everything above works offline; changes queue and show an "unsent" chip |

### 5.1 The item editor

```
┌─────────────────────────────────────────┐
│  ← Kacchi Biriyani (Full)        Save   │
├─────────────────────────────────────────┤
│  ┌─────────────┐                        │
│  │   [photo]   │  📷 Change    🗑 Remove │
│  └─────────────┘                        │
│                                         │
│  Name (English)                         │
│  ┌─────────────────────────────────┐    │
│  │ Kacchi Biriyani (Full)          │    │
│  └─────────────────────────────────┘    │
│  নাম (বাংলা)                            │
│  ┌─────────────────────────────────┐    │
│  │ কাচ্চি বিরিয়ানি (ফুল)            │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Price                      ৳ [ 320 ]   │
│  You receive ৳272.00 after 15%          │
│  commission. With the 3% rider bonus,   │
│  ৳262.40.                               │
│                                         │
│  Tags   🌿 Veg  🌶 Spicy  ☪ Halal       │
│         ❄ Temperature-critical          │
│         💧 Spill risk                   │
└─────────────────────────────────────────┘
```

The **net-receipt line under the price is mandatory**. A vendor setting a price should see what
they actually get, computed with the real commission arithmetic from
[`10 §9`](10-fare-engine-math.md), not discover it on an invoice three weeks later.

The temperature and spill tags feed the batching engine's constraint C2
([`12 §4`](12-batching-engine.md)) — the app explains this in one line: *"We won't bundle this
with a long second drop."*

---

## 6. Hours and availability

```
  MON   11:00 ─────────── 15:00    18:00 ─────── 23:00   ✓
  TUE   11:00 ─────────── 15:00    18:00 ─────── 23:00   ✓
  WED   11:00 ─────────── 15:00    18:00 ─────── 23:00   ✓
  THU   11:00 ─────────── 15:00    18:00 ─────── 23:00   ✓
  FRI   13:00 ─────────────────────────────────── 23:00  ✓
  SAT   11:00 ─────────── 15:00    18:00 ─────── 23:00   ✓
  SUN   closed                                           ✗
```

Up to 3 slots per day, dragged on a timeline or typed. Special days override the weekly pattern
(Eid, a wedding, a power cut). Timezone is fixed to `Asia/Dhaka` and shown, because a vendor
should never have to think about it.

### 6.1 Pause

A prominent, single-tap **PAUSE** with a duration: 15 / 30 / 60 minutes or "until I resume".
Paused vendors are hidden from ranking and a countdown shows on the board. The app nudges at
expiry: *"You've been paused 30 minutes. Reopen?"*

Pausing is strongly preferred over going offline, and the UI makes it the obvious choice, because
a paused vendor is a deliberate state with a return time while an absent one is
`UNREACHABLE` ([`14`](14-presence-and-heartbeat.md)).

---

## 7. Performance dashboard

```
  THIS WEEK                              vs last week
  ─────────────────────────────────────────────────────
  Orders              142                   ▲ 11%
  Net earnings        ৳48,320               ▲ 8%
  Average order       ৳340                  ▼ 3%
  Acceptance          96%                   ─
  Prep accuracy       0.61                  ▼ 0.04      ⚠
  Rating              4.5 ★ (88)            ▲ 0.1
  Median rank         11th of 43            ▼ 2

  ⚠  YOUR BIGGEST OPPORTUNITY
     You promise 20 minutes and average 31.
     Setting 30 minutes would improve your
     ranking more than anything else you
     could change this week.
     [ Set default prep to 30 min ]
```

One prioritised opportunity, with a button that performs the change. Not a wall of charts. The
dashboard computes which single change has the largest marginal effect on the vendor's rank score
and says so — this is the `rank-explain` endpoint ([`13 §12.1`](13-ranking-personalization.md))
turned into an action.

---

## 8. Finance

| Screen | Contents |
| --- | --- |
| Earnings | Daily and weekly totals, a running current-period figure, and the next payout date (Saturday) |
| Invoices | The list, with status `DRAFT` → `GENERATED` → `VERIFIED` → `PAID` |
| Invoice detail | Every line: order totals, 15% commission, 5% tax, 3% rider bonus, Flash Box deductions, small-order fee share, adjustments. Each expandable to the orders behind it |
| PDF | One tap to view or share the branded PDF from Cloudinary, < 1 MB |
| Payout account | bKash / Nagad / bank, with the account-change cooling-off period from [`24 §11`](24-finance-payouts-invoices.md) |
| History | Every past payout with its reference, date, and the admin who marked it paid |

Invoices are **never** generated by a cron ([`24 §4`](24-finance-payouts-invoices.md)). They are
produced by a deterministic event-triggered builder, and the same inputs always produce the same
bytes — a property the `ledger-closure` test asserts over 10 000 generated cases.

---

## 9. Device health

A dedicated screen, reachable from the permanent 🔊 indicator, because this app's usefulness is
exactly equal to its ability to make noise.

```
  DEVICE HEALTH                        Last checked 2 min ago

  ✓  Notifications allowed
  ✓  Alarm channel enabled
  ✓  Battery optimisation off
  ✓  Alarm volume 100%
  ✓  Autostart allowed  (Xiaomi)
  ✗  Do Not Disturb exception         [ Turn on ]
  ✓  Connected · 142 ms

  Last 7 days
     Alarms sent        38
     Alarms received    38      100%
     Average delay      1.2 s
     Missed orders       0

           [ SEND A TEST ALARM NOW ]
```

The test alarm is a real round trip through FCM ([`15 §7.2`](15-wakeup-alarm-fcm.md)). Vendors are
prompted to run it after any device change, OS update, or settings change, and the result is
recorded server-side.

---

## 10. Staff accounts

A restaurant is not one person. Up to 5 staff logins per vendor:

| Role | Can |
| --- | --- |
| Owner | Everything, including finance and staff management |
| Manager | Orders, menu, hours, performance. **No** finance, no payout account |
| Kitchen | Orders only — accept, prep time, mark ready, QR. Cannot see totals or customer phone numbers |

Kitchen accounts not seeing customer phone numbers is a privacy decision: the person plating
biriyani has no need for them, and the fewer devices that hold them the better.

Sessions are 12 hours ([`08`](08-api-contract.md)). An active session list shows every logged-in
device with its last activity, and any can be revoked.

---

## 11. Offline behaviour

| Area | Offline |
| --- | --- |
| Order board | Shows the last known state with a prominent red banner; **no new orders can arrive**, and the banner says so in those words |
| Accept / reject | Queued in the outbox and sent on reconnect — but the app warns that the order may have been auto-cancelled in the meantime, and the server's response is authoritative |
| Mark ready | Queued; timestamped locally so the real time is preserved |
| QR | Renders from cache |
| Menu editing | Fully offline, outbox-synced |
| Hours | Fully offline |
| Finance | Last cached values with their fetch time shown |

The offline banner is deliberately alarming. A vendor who does not realise they are offline is a
vendor who is about to miss orders, and a subtle grey chip is not enough.

---

## 12. Testing

| Test | Count |
| --- | --- |
| Screen states (loading/empty/error/content) | 216 |
| Order board interactions | 44 |
| Prep-time control (range, steps, clamping, suggestion) | 18 |
| QR generation, rotation, and the 6-digit fallback | 16 |
| Menu CRUD, offline queue, and conflict resolution | 62 |
| CSV import, including malformed files | 21 |
| Hours, overlaps, special days, DST non-issues | 24 |
| Finance arithmetic against the ledger fixtures | 30 |
| Device health detection on 9 simulated OEM states | 27 |
| Staff RBAC — every role × every action | 51 |
| Responsive, 50 widths | 54 screens |
| Alarm integration (Test Lab) | the matrix in [`15 §12`](15-wakeup-alarm-fcm.md) |

---

## 13. Reading on

Next: [`19-rider-app.md`](19-rider-app.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
