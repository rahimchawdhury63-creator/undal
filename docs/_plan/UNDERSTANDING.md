<!--
  Undal — Response 1: what the corpus actually specifies
  Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
  SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# Understanding — what I am building, stated back in the corpus's own terms

This is Response 1 of 22: planning only, no application code. It is my restatement of the
binding shape of Undal — the actors, the order lifecycle, the money to the paisa, Undal Brain's
five engines, the wake-up alarm stack, D1's tracking economics, and the free-tier budget — with
every claim pointing at the `docs/` section that owns it. Where this document and a numbered
document disagree, the numbered document wins. Where two numbered documents disagree, §9 below
records the conflict, the reading I will build to, and why.

**Authority order I will use when the corpus collides** (from [`35 §8`](../35-execution-plan.md),
extended by the migration's own rule in [`_plan/TIDB-MIGRATION.md`](TIDB-MIGRATION.md) §1):

1. **Tests** are the final arbiter. A test that contradicts a document means the document is
   wrong, and the document gets fixed.
2. **`06`** for schema and persistence; **`10`** for fare arithmetic; **`24`** for ledger
   postings and invoice lifecycle; **`16`** for Android mechanics; **`05`** for runtime topology.
3. **`PROMPT.md`'s absolute rules** — no CLI, no placeholders, no seed data, no secrets in code,
   ≤ 700 lines, doc comments, integer paisa, free tier only, 200→3840 px, Bangla + English —
   outrank every document, because they are the reason the corpus exists.

---

## 1. The five actors

Undal has exactly five actors, and every permission, state transition and ledger posting names one
of them. The actor list is fixed in [`06 §7.2`](../06-data-model-tidb.md) (`actor_type` CHECK) and
used identically in audit ([`27 §4.1`](../27-security-rbac-audit.md)) and in the API envelope
([`08`](../08-api-contract.md)).

| Actor | Who they are | Money relationship | Auth | Surface |
| --- | --- | --- | --- | --- |
| **CUSTOMER** | Orders food. Browses without an account; authenticates only at checkout ([`17 §3.1`](../17-customer-app.md)) | Pays cash on delivery. Owes nothing after `DELIVERED` | Access 15 min, refresh 30 d sliding ([`27 §2.3`](../27-security-rbac-audit.md)) | Android `com.undal.customer` (68 screens) + the web storefront, which is a complete ordering experience for iOS ([`20 §1`](../20-web-storefront.md)) |
| **VENDOR** (partner) | Restaurant or home/cloud kitchen. Accepts, cooks, hands over via QR | Receives `subtotal − commission − rider_bonus + small_order.vendor`. Paid Saturday | Access 15 min, refresh 12 h, device-bound, 5 devices | Android `com.undal.partner` (54 screens, Android-only by design) + `/partner` web console without the alarm ([`20 §8.1`](../20-web-storefront.md)) |
| **RIDER** | Motorbike or bicycle. Accepts offers, scans QR, collects cash | Receives `fare + bonus + small_order.rider + tip`. Paid Friday. Holds Undal's cash until settled | Access 15 min, refresh 12 h, **one device only** — two devices is a fraud signal | Android `com.undal.rider` (61 screens) + `/rider` console with shift start deliberately disabled ([`20 §8.2`](../20-web-storefront.md)) |
| **ADMIN** | Operations, finance, support, KYC, analytics | No money of their own; every money action is audited and most need step-up TOTP | TOTP mandatory, access 10 min, refresh 4 h absolute / 30 min idle | The admin SPA: 9 domains, 2 147 features ([`21 §1`](../21-admin-panel.md)), the super map ([`22`](../22-admin-super-map.md)) |
| **SYSTEM** | The three Workers, the DOs, the Brain, the schedulers-that-are-not-crons | Books postings, applies fees, cancels, settles | Service bindings and secrets only | `undal-core`, `undal-realtime`, `undal-brain` ([`05 §2`](../05-system-architecture.md)) |

Four consequences that shape everything downstream:

- **`undal-core` is the sole relational writer** ([`34 §3.1`](../34-repository-layout.md)).
  `realtime` and `brain` reach TiDB only through service bindings into `core`. One place composes
  transactions, asserts ledger closure and writes audit — and after the migration, one place
  enforces the CHECK constraints TiDB Starter will not ([`06 §1.2`](../06-data-model-tidb.md)).
- **A rider has exactly one device.** Refresh-token family reuse invalidates the family
  ([`27 §2.3`](../27-security-rbac-audit.md)).
- **Vendors and riders are Android-only, and told so in those words** before they sign up
  ([`18 §1`](../18-partner-app.md), [`20 §8.1`](../20-web-storefront.md)).
- **"No OTP, no email verification" is a code-path rule, not a policy** — there is no branch that
  can send either ([`17 §3.2`](../17-customer-app.md), [`27 §2.2`](../27-security-rbac-audit.md),
  criterion A18).

---

## 2. The order lifecycle, completely

The machine is specified once, in [`06 §7.3`](../06-data-model-tidb.md), implemented in
`workers/core/src/domain/order/state-machine.ts`, and covered to **100% transition coverage**
including the illegal edges ([`30 §10`](../30-testing-and-verification.md)).

### 2.1 States (16)

`DRAFT` · `PLACED` · `ACCEPTED` · `REJECTED` · `RIDER_SEARCH` · `RIDER_ASSIGNED` · `PICKED_UP` ·
`ARRIVED` · `DELIVERED` · `SETTLED` · `AUTO_CANCELLED` · `CANCELLED_BY_CUSTOMER` ·
`CANCELLED_BY_VENDOR` · `CANCELLED_BY_ADMIN` · `REASSIGNING` · `DISPUTED`
(`orders.state` CHECK, [`06 §7`](../06-data-model-tidb.md)).

```
                         ┌──────────────┐
                         │    DRAFT     │  cart + quote + address, server-priced
                         └──────┬───────┘
                                │ customer, guards §2.2
                         ┌──────▼───────┐   reject (reason)     ┌──────────┐
                         │    PLACED    ├──────────────────────▶│ REJECTED │
                         └──┬────┬──────┘   auto-cancel @120 s   └──────────┘
        cancel (free) ◀─────┘    │ accept (prep 300–12 000 s)
                                │
                         ┌──────▼───────┐        PICKUP: skips every rider state
                         │   ACCEPTED   ├──────────────────────────────────┐
                         └──┬───────────┘                                  │
             DELIVERY       │                                              │
                    ┌───────▼────────┐                                     │
                    │  RIDER_SEARCH  │◀──────────────┐                     │
                    └───────┬────────┘               │                     │
                            │ claim (atomic, one)    │ REASSIGNING         │
                    ┌───────▼────────┐               │                     │
                    │ RIDER_ASSIGNED ├───────────────┘                     │
                    └───────┬────────┘                                     │
                            │ QR scan ≤150 m, HMAC, ≤4 h                   │
                    ┌───────▼────────┐            ┌─────────────────────── ▼┐
                    │   PICKED_UP    │            │       PICKED_UP          │
                    └───┬────────┬───┘            └───────────┬─────────────┘
                        │        │                            │
          admin dispute │        │ ≤80 m of drop              │ (pickup hands over)
                        │  ┌─────▼──────┐                     │
                        │  │  ARRIVED   │                     │
                        │  └─────┬──────┘                     │
                        │        │ cash recorded              │
                        │  ┌─────▼──────┐◀────────────────────┘
                        └─▶│ DELIVERED  │
                ┌──────────┤            │
                │          └─────┬──────┘
        ┌───────▼──────┐         │ 15 min, no dispute
        │   DISPUTED   ├────────▶│
        └──────────────┘   admin │
                         ┌───────▼──────┐
                         │   SETTLED    │  immutable; eligible for invoice
                         └──────────────┘
```

### 2.2 Every legal transition, with its guard

| From | To | Actor | Guard |
| --- | --- | --- | --- |
| `DRAFT` | `PLACED` | Customer | Cart non-empty · vendor `APPROVED` and `open_state IN ('OPEN','BUSY')` · every item available · address inside an `ACTIVE` zone · customer not banned · quote present |
| `PLACED` | `ACCEPTED` | Vendor | `prep_time_s` in `[300, 12000]` (5–200 min) · vendor owns the order |
| `PLACED` | `REJECTED` | Vendor | `reason_code` from the fixed vocabulary |
| `PLACED` | `AUTO_CANCELLED` | System | 120 s elapsed and the vendor was `UNREACHABLE` ([`14 §4.1`](../14-presence-and-heartbeat.md)) |
| `PLACED` | `CANCELLED_BY_CUSTOMER` | Customer | Always, no fee |
| `ACCEPTED` | `RIDER_SEARCH` | System | `fulfilment = 'DELIVERY'`; dispatch opens |
| `ACCEPTED` | `PICKED_UP` | Customer/vendor | `fulfilment = 'PICKUP'`; QR scanned at the counter |
| `ACCEPTED` | `CANCELLED_BY_CUSTOMER` | Customer | Fee applies after 60 s |
| `ACCEPTED` | `CANCELLED_BY_VENDOR` | Vendor | `reason_code`; damages reliability score |
| `RIDER_SEARCH` | `RIDER_ASSIGNED` | System | Exactly one rider claimed ([`11 §7.3`](../11-dispatch-engine.md)) |
| `RIDER_SEARCH` | `CANCELLED_BY_ADMIN` | Admin | Cascade exhausted; admin decides |
| `RIDER_ASSIGNED` | `PICKED_UP` | Rider | QR HMAC valid, order state correct, assigned rider, **within 150 m**, `issuedAt` ≤ 4 h |
| `RIDER_ASSIGNED` | `REASSIGNING` | Rider/Admin/System | Rider cancelled, dropped offline, or force-unassigned |
| `REASSIGNING` | `RIDER_SEARCH` | System | Always |
| `PICKED_UP` | `ARRIVED` | Rider/System | Within **80 m** of the drop point, or manual |
| `PICKED_UP` | `DISPUTED` | Admin | Exception raised |
| `ARRIVED` | `DELIVERED` | Rider | `cash_collected_paisa` recorded and equal to `total_paisa`, or a variance reason given |
| `DELIVERED` | `SETTLED` | System | 15 min elapsed, no dispute |
| `DELIVERED` | `DISPUTED` | Customer/Admin | Within 24 h |
| `DISPUTED` | `SETTLED` | Admin | Resolution with cost attribution |
| any live | `CANCELLED_BY_ADMIN` | Admin | `reason_code` + cost attribution |

`DRAFT → PLACED` is the only transition that prices anything; every later state reads the frozen
snapshot ([`06 §7.1`](../06-data-model-tidb.md)). Illegal transitions are rejected in the
evaluator, not in the UI, and are covered by the same 100% edge coverage.

### 2.3 The clocks that drive the machine

| Clock | Value | Owner |
| --- | --- | --- |
| Vendor accept window | **120 s**, ladder at 8/10/25/45/60/90/120 s | [`14 §4.1`](../14-presence-and-heartbeat.md) |
| Rider offer TTL | **25 s** (bundle offers may be shorter) | [`11 §7.1`](../11-dispatch-engine.md) |
| Dispatch waves | 5 waves, TTL 25/25/22/20/20 s, sized to 90% predicted acceptance, fallback at **T+112 s** | [`11 §7`](../11-dispatch-engine.md) |
| Expansion ladder | 112 / 140 / 175 / 215 / 300 / **480 s** — step 5 asks the customer, step 6 auto-cancels with ৳50 credit and vendor compensation paid by the platform | [`11 §11`](../11-dispatch-engine.md) |
| `PICKED_UP → ARRIVED` | 80 m geofence | [`06 §7.3`](../06-data-model-tidb.md) |
| `DELIVERED → SETTLED` | **15 min**, or an admin decision if disputed | [`06 §7.3`](../06-data-model-tidb.md) |
| Quote validity | 5 min, then `409 QUOTE_MISMATCH` with a diff sheet | [`08`](../08-api-contract.md), [`17 §6.4`](../17-customer-app.md) |

### 2.4 Every transition does four things

1. Appends to `order_state_events` — append-only, `(order_id, seq)` unique, `metadata` never null,
   and CI asserts no `UPDATE`/`DELETE` targets the table ([`06 §7.2`](../06-data-model-tidb.md)).
2. Materialises `orders.state`, with a replay test asserting the last event equals the row.
3. Emits an SSE event to the order hub — one of **46** registered events ([`08`](../08-api-contract.md)).
4. May emit FCM: always for `ORDER_NEW` and `OFFER_NEW`, never an alarm for a customer
   ([`15 §11`](../15-wakeup-alarm-fcm.md)).

Post-commit side effects run in `ctx.waitUntil` and land in `effect_dead_letters` when they fail
([`05 §6`](../05-system-architecture.md)) — the order is never rolled back because a push failed.

---

## 3. The money model, to the paisa

### 3.1 Arithmetic law

- **Every amount is an integer number of paisa.** BIGINT in TiDB; `_paisa` suffix is load-bearing
  and `money-integrity` keys off it ([`06 §1`](../06-data-model-tidb.md), [`34 §9`](../34-repository-layout.md)).
  The literal `INT8` is banned: MySQL parses it as 4-byte `INT(8)`, capping at 2 147 483 647
  paisa = **৳21 474 836** ([`_plan/TIDB-MIGRATION.md`](TIDB-MIGRATION.md) §4.1).
- **Every rate is integer basis points.** 15% is `1500`, 8% is `800`, 2.2× is `22000`.
- **One rounding point.** `apply_rate(amount_paisa, rate_bps)` multiplies in integers and applies
  **banker's rounding** (ties-to-even), byte-identical in Python, TypeScript and Kotlin, proven by
  a 110 000-vector differential test ([`10 §3.3`](../10-fare-engine-math.md), [`30 §3`](../30-testing-and-verification.md)).
  Half-up was rejected because it systematically favours the platform.
- **Floor to the taka, once, at the very end.** `total % 100 == 0` always; the delta is in
  `[−99, 0]` — the customer is **never rounded up** (P2, P3). The platform books the difference to
  `PLATFORM:EXPENSE_ROUNDING`.
- **Tips are untouchable.** No commission, bonus or tax ever applies to a tip (P12).

### 3.2 Fare assembly — seven steps, launch configuration

Constants: base ৳40 motorbike / ৳25 bicycle; 2 000 m included; ৳14 / ৳8 per km beyond;
radius 12 000 m / **4 000 m**; min payout ৳40 / ৳25; surge cap 2.2×; margin 800 bps; fee clamp
**৳25–৳220** motorbike, **৳20–৳120** bicycle; traffic block 300 s compensating ৳8 / ৳5
([`10 §2`](../10-fare-engine-math.md)).

```
① SDR        = riders_available ÷ orders_waiting            → surge bps (≤ 22000), hysteresis 90 s
② ride_core  = apply_rate(base, surge) + (billable_m × per_km ÷ 1000) + traffic_blocks
③ fee        = clamp(ride_core + apply_rate(ride_core, 800), min_fee, max_fee)
④ rider fare = max(min_payout, ride_core + weather + bundle)
                 weather = apply_rate(ride_core, RAIN 2000 | STORM 4000 | EXTREME_HEAT 1500), 0 if confidence < 0.5
⑤ small order= 0 below ৳100 post-discount subtotal; else ৳25 = ৳5 rider + ৳5 vendor + ৳15 platform
                 on PICKUP: ৳20 = ৳5 vendor + ৳15 platform (no rider exists to pay)
⑥ commission = apply_rate(subtotal, 1500)   bonus = apply_rate(subtotal, 300)   [vendor-funded]
   taxable   = commission + small_order.platform + platform_delivery_margin    ← no rider bonus
   tax       = apply_rate(taxable, 500)
⑦ total     = floor_to_taka(subtotal + fee + small_order.total + tax + tip)
```

Three rules inside those steps that are easy to get wrong and are tested directly:

- **Distance is floored, not rounded**, before any fare arithmetic ([`10 §5.1`](../10-fare-engine-math.md)).
- **`platform_delivery_margin = fee − ride_core`** and weather is an *expense*, never a reduction of
  the margin — so the tax base does not move with the weather ([`10 §9`](../10-fare-engine-math.md),
  [`24 §2.3`](../24-finance-payouts-invoices.md)).
- **The "small order fee" applies at or above ৳100**, which reads backwards because the brief says
  so; the customer-facing label is therefore "Order fee" / "অর্ডার ফি" and the transparency sheet
  explains who gets what ([`10 §8`](../10-fare-engine-math.md)).

### 3.3 Vector 01, counted

Motorbike · 3 800 m · no traffic · SDR 1.272 → surge 1.00× · CLEAR · subtotal ৳450 · no discount ·
no tip ([`10 §12.1`](../10-fare-engine-math.md)):

| Line | Paisa |
| --- | --- |
| Surged base | 4 000 |
| Distance: `1800 × 1400 ÷ 1000` | 2 520 |
| **Ride core** | **6 520** |
| Margin `apply_rate(6520, 800)` = 521.6 → 522 | **Delivery fee 7 042** |
| Small-order fee (45 000 ≥ 10 000, DELIVERY) | 2 500 |
| Rider bonus `apply_rate(45000, 300)` | 1 350 |
| Commission `apply_rate(45000, 1500)` | 6 750 |
| Taxable base `6750 + 1500 + 522` | 8 772 |
| Tax `apply_rate(8772, 500)` = 438.6 → 439 | 439 |
| Pre-round total | 54 981 |
| **Customer pays cash** `floor_to_taka` | **54 900** (delta −81) |
| **Vendor payout** `45000 − 6750 − 1350 + 500` | **37 400** |
| **Rider payout** `6520 + 1350 + 500` | **8 370** |

### 3.4 The ledger is double-entry, or it is a bug

14 account types ([`24 §1.1`](../24-finance-payouts-invoices.md)); every entry's postings sum to
**exactly zero**, asserted in `postEntry()` before commit, again at invoice generation, and by a
10 000-case closure property test — plus a `LEDGER_IMBALANCE` exception at CRITICAL
([`24 §1`](../24-finance-payouts-invoices.md), [`06 §8.1`](../06-data-model-tidb.md)).

Vector 01's posting set ([`06 §8.2`](../06-data-model-tidb.md)):

| Account | Paisa |
| --- | --- |
| `RIDER:{id}:CASH_IN_HAND` | +54 900 |
| `VENDOR:{id}:PAYABLE` | −37 400 |
| `RIDER:{id}:PAYABLE` | −8 370 |
| `PLATFORM:REVENUE_COMMISSION` | −6 750 |
| `PLATFORM:REVENUE_SMALL_ORDER` | −1 500 |
| `PLATFORM:REVENUE_DELIVERY` | −522 |
| `PLATFORM:TAX_PAYABLE` | −439 |
| `PLATFORM:EXPENSE_ROUNDING` | +81 |
| **Sum** | **0** ✓ |

Cash is a *liability the rider is carrying*, not revenue: `RIDER_CASH:{id}` grows with each
collected order and is capped at **৳3 500**, after which dispatch filters the rider out
([`11 §8`](../11-dispatch-engine.md)). Settlement moves it to the platform's bank.

### 3.5 Invoices, payouts, and the parts that are deliberately not automatic

- Invoice is a **pure function of the ledger** for a closed period: same inputs → same
  `content_hash`, byte-identical PDF ([`24 §4.3`](../24-finance-payouts-invoices.md)).
- Lifecycle `DRAFT → GENERATED → VERIFIED → PAID`; `PAID` requires step-up TOTP and a reference;
  a rider with outstanding cash cannot be `VERIFIED` (A86).
- **No cron.** Period boundaries are detected on ordinary requests, and generation is guarded by a
  `generation_locks` row claimed with one conditional `UPDATE` ([`24 §4.1`](../24-finance-payouts-invoices.md),
  [`_plan/TIDB-MIGRATION.md`](TIDB-MIGRATION.md) §7.3).
- Riders paid **Friday**, vendors **Saturday**, Asia/Dhaka weeks; the bKash export includes the
  cash-out charge so the recipient receives the full amount (A83).
- **Cash settlement is a blocking screen**, never a nag: selfie + bKash TrxID + screenshot +
  number + name, unreachable-by-design except for SOS and the dialler, and it **auto-lifts after
  2 hours** of unreviewed waiting; all four "I can't settle" paths lift it ([`25`](../25-rider-cash-settlement.md), A91–A99).
- Rider liability for losses is capped at **৳300/week** (A90).

---

## 4. Undal Brain — five deterministic engines, no LLM, no external AI

[`09 §2`](../09-undal-brain-overview.md). Python on Workers (Pyodide), stateless, 400 ms budget,
every engine with a tested fallback. `dependency-licence-and-cost` and a repo grep prove no
third-party AI API is called (A45).

| Engine | Question | Load-bearing numbers |
| --- | --- | --- |
| **Fare** | What does the customer pay, what does the rider earn? | §3 above; 40 hand-computed vectors, 25 properties ([`10`](../10-fare-engine-math.md)) |
| **Dispatch** | Which rider, in what order, in which wave? | 14 hard filters, 14 weighted factors summing to 1.000, waves sized to 90% acceptance, 6-step expansion ladder ([`11`](../11-dispatch-engine.md)) |
| **Batch** | Can two or three orders ride together? | detour budget 420 s (210 s for temperature-critical), constraints C1–C10, permutation search ≤ 6, `batch_score ≥ 0.45`, proof re-validated at accept ([`12`](../12-batching-engine.md)) |
| **Rank** | In what order does this customer see vendors? | 10 stages, blend 0.30 performance / 0.26 proximity / 0.22 personalisation / 0.14 query / 0.08 zone popularity, MMR diversity, cold start ≤ 0.14 decaying over 21 days or 25 rated orders ([`13`](../13-ranking-personalization.md)) |
| **Forecast** | How much demand is coming, where, and how long will this kitchen take? | 2-hour demand surface on the 500 m cell grid; prep prediction from performance, order size and weather; hijri table through 2035 ([`09 §9`](../09-undal-brain-overview.md), [`32 §5.2`](../32-localization-and-currency.md)) |

Laws that hold across all five ([`09 §3`](../09-undal-brain-overview.md)):

- **Integer money only.** Ratios may be float; amounts never. `apply_rate` is the one conversion.
- **Every score is in `[0,1]`** and weights sum to 1.0 ± 1e-9, so a trace can show
  `contribution = weight × value` as a bar.
- **Every weight is config in `platform_config`**, versioned and audited; the Brain Lab refuses a
  weight change unless a replay over the last 500 real decisions has been shown (A140).
- **Every decision has a fallback inside its budget**, and the fallback is tested (A58).
- **The anti-ad invariant**: `RankInput` has no monetary field, and `anti-ad-invariant` fails the
  build if one appears. Sponsored placement is structurally impossible, not merely absent
  ([`13 §1`](../13-ranking-personalization.md), A54).
- **Every decision writes a trace** with no missing field (D12), replayable by `brain-replay`.

Dispatch notes that decide the shape of the realtime layer: the claim is **atomic** — one
conditional `UPDATE` on free-tier `sql` mode, a Durable Object method on paid mode — and both
implementations pass the same 34-case suite including a 50-way race (D3). A rider who rejects is
never re-offered the same order (D4); re-offering is only possible through the *expansion ladder*,
which is an audited, logged escalation.

---

## 5. The wake-up alarm stack, and the one case Android forbids

This is the second most important thing in the product after ordering ([`15`](../15-wakeup-alarm-fcm.md)),
and the document opens by conceding the boundary (§1).

### 5.1 The forbidden case, stated first

> **Settings → Apps → Undal Partner → Force stop** puts the package into Android's `stopped` state.
> FCM will not be delivered, services will not start, receivers will not run, until a human
> launches the app again. This is an OS guarantee from Android 3.1; no permission, foreground
> service, `direct_boot` receiver or Play policy overrides it.

Undal's answer is four-part and honest: **detect** within 2 s (presence) and via FCM `NOT_FOUND` /
`UNREGISTERED`; **route around** (another vendor, the ladder, the backup contact); **teach** (OEM
coaching, device health, weekly re-check); **never silently fail** (the vendor sees exactly what
they missed). The test suite asserts the non-delivery (A39) and §10 publishes the actual
percentages: 0% after force-stop, 40–70% after a swipe on an aggressive OEM without autostart,
~96% with it.

OEMs that treat *swipe from recents* as a force-stop: Xiaomi/MIUI, Oppo/ColorOS, Vivo/FuntouchOS,
Realme, Huawei/EMUI, aggressive Samsung "deep sleeping apps", Asus, Meizu ([`15 §1`](../15-wakeup-alarm-fcm.md)).

### 5.2 Layers, in the order they fire

| # | Layer | Mechanism |
| --- | --- | --- |
| 1 | **Data-only FCM**, always, in parallel with the socket | No `notification` key **ever** — that hands sound to the OS, at notification volume, respecting DND ([`15 §2.1`](../15-wakeup-alarm-fcm.md)) |
| 2 | **v1 auth** | RS256 JWT signed with the service-account key, cached 3 300 s; no legacy server key exists (A13) |
| 3 | **Payload signature** | HMAC `sig` over the data map with `FCM_SIG_KEY`; bad or expired payloads are dropped before anything starts |
| 4 | **`FirebaseMessagingService`** | Validates, dedupes, and hands off inside the ~10–20 s high-priority window; does nothing else ([`15 §3.1`](../15-wakeup-alarm-fcm.md)) |
| 5 | **Path A** | Foreground service (`specialUse` type, justified in `android/PLAY_DECLARATIONS.md`) + full-screen intent; ~97% of real deliveries |
| 6 | **Path B** | If FGS start throws (Android 12+ background restrictions), post a high-importance notification carrying the full-screen intent; the system starts the activity, which starts the service from the foreground |
| 7 | **Path C** | Loudest plain notification on an alarm-category channel, and a `DEGRADATION` event so dispatch can weight the device |
| 8 | **Audio** | `assets/audio/undal_order_alert_loop.wav` shipped **unmodified**; `USAGE_ALARM` stream, looping, volume forced to max and restored; vibration 600 ms on / 300 ms off; **audio starts at t=0**, never gated on animation (A42) |
| 9 | **Screen** | `setShowWhenLocked` + `setTurnScreenOn` + keyguard dismissal; full-screen intent puts the order on the lock screen with accept reachable; Android 14+ `USE_FULL_SCREEN_INTENT` handled via `canUseFullScreenIntent()` with a documented degradation |
| 10 | **Ceilings** | `ORDER_NEW` **120 s**, `OFFER_NEW` **25 s**, `PRESENCE_LOST` 30 s, `ALARM_SELFTEST` 8 s, `CASH_SETTLEMENT_DUE` a persistent tick; any accept/seen stops the sound within 50 ms ([`15 §11`](../15-wakeup-alarm-fcm.md)) |
| 11 | **Server verification** | Alarm delivery is verified server-side, not assumed; three consecutive failures remove a vendor or rider from dispatch and say why (A44) |

### 5.3 Presence is a separate, harder guarantee

Three layers ([`14 §1`](../14-presence-and-heartbeat.md)): **A** transport close (< 200 ms, free);
**B** heartbeat — client sends every **750 ms**, server resets a **2 000 ms** deadline alarm, three
missed acks make the client tear down; **C** an action probe on a real order. A 1 500 ms grace
window, tuned to Sylhet's tower handoffs and clamped to `[0, 1800]` in config, prevents flapping;
worst-case detection is 1.7 s. **p95 ≤ 2 000 ms is build-failing** (A100), and it must hold on
*both* coordinator backends.

The vendor ladder that ends in `AUTO_CANCELLED` with `VENDOR_DEVICE_UNREACHABLE` at 120 s carries a
full **evidence block** — last seen, socket state, FCM ids, probe counts, backup-contact time, every
ladder step — because that is what an appeal and an operator decision both need (A104).

---

## 6. D1 tracking economics

D1 is not a database here; it is a **deliberately forgettable channel**, and only for rider
location (A4: exactly two tables). [`07`](../07-d1-live-tracking.md):

| Fact | Value |
| --- | --- |
| Free tier | **100 000 writes/day**, 5 M reads/day |
| Naive design | 40 riders × 8 h ÷ 5 s = **230 400 writes/day** — 2.3× over |
| The rule | Gate on **≥ 100 m displacement**, never on time (brief, non-negotiable 26) |
| Result at 40 riders | 4.4 moving hours × 3 600 ÷ 20 s = 792 writes/rider/shift → **31 680/day** |
| Adaptive cadence | 150 m / 300 s ceiling idle → 100 m on an order → **60 m** within 1 km of the drop → **40 m** within 200 m; floors 20 s → 5 s; break 600 s; low battery widens everything ×1.5 / ×2.5 ([`07 §3.3`](../07-d1-live-tracking.md)) |
| Per delivery | **54 writes** (12 accept→vendor, 4 waiting, 16 to 1 km, 13 last km, 5 final 200 m, 4 at door), asserted by property S10 |
| Daily totals | 500 orders/day → **32 100 writes (32.1%)**; breaking point ≈ **1 650 orders/day** |
| Storage | ring buffer `rider_positions` capped at **120 rows** (seq mod 120) ≈ 864 KB at 100 riders; `rider_current` one row per online rider |
| Encoding | delta: **410 B** vs 2 900 B raw per batch ([`07 §4.2`](../07-d1-live-tracking.md)) |
| Plausibility | accuracy > 60 m rejected (S6); mocks rejected **and the shift suspended** (S7); speed/teleport/route checks |
| Erasure | every shift-ending path erases the rider's rows within 5 s: end shift, going offline, presence loss (S3, S4) |
| Reads | customer tracking **never** queries D1 — positions arrive over SSE pushed by the same write path; admin map polls only as a reconciliation backstop |
| CI | 12 real anonymised GPS traces replay through the gate; `writesPerDelivery < 70`, `writesPerIdleHour < 45`, and the 54-write budget is asserted, not estimated ([`07 §8.4`](../07-d1-live-tracking.md)) |

The consequence for the build: the **device-side gate is the product**, not an optimisation. If the
gate leaks, the platform loses live tracking for everyone, and the fallback (loosen idle ceiling
+15%, raise base to 120 m +18%) is documented but is a retreat.

---

## 7. The free-tier budget, per service, with the honest exception

At 500 orders/day, from [`39 §2.1`](../39-risk-register-and-truths.md) and [`01 §5.1`](../01-mission-and-non-negotiables.md):

| Service | Free allowance | Projected use | Headroom |
| --- | --- | --- | --- |
| Cloudflare Workers | 100 000 req/day, 10 ms CPU | ~42 000 req/day (01 §5.1 says ~62 000; see §9) | 2.4–1.6× |
| Cloudflare Pages | 500 builds/month, unlimited requests | ~90–120 builds | ~4× |
| Cloudflare D1 | 100 000 writes, 5 M reads/day | ~32 000 writes, ~1.1 M reads | 3.1× writes |
| Cloudflare KV | 100 k reads, 1 k writes/day | ~38 000 reads, ~400 writes | 2.5× |
| TiDB Cloud Starter | **5 GiB row** + 5 GiB columnar, **50 M RU/month**, 5 instances | ~1.4 GiB storage; **RU unmeasured** | storage ~3.6 years runway; **RU unknown, deliberately** |
| imgbb | No published limit | ~300–800 uploads/day | unknown |
| Cloudinary | 25 credits/month | ~6 credits | 4× |
| GitHub Actions | 2 000 min/month private, free on public | ~1 100–1 400 | 1.4× (public repo removes it) |
| Firebase FCM | Unlimited | ~4 500 messages/day | ∞ |
| OSRM demo / OSM tiles | Fair use | — | **risk R2**, self-host if it rate-limits |

**The exception, stated as loudly as the corpus states it ([`39 §2.2`](../39-risk-register-and-truths.md),
[`05 §4.2`](../05-system-architecture.md)):** Durable Objects require the Workers **Paid** plan at
$5/month. Undal therefore ships **two implementations behind one 14-method `Coordinator`
interface** and launches on the free `sql` mode — one conditional `UPDATE` against
`dispatch_locks` with lease expiry, estimated 10–20 ms p50 with Smart Placement, 60–80 ms without.
Every acceptance criterion, including p95 presence ≤ 2 s, must hold on the free path. The paid mode
buys latency, not features.

**Costs that are real and not free:** domain $10–15/year, Google Play account **$25 once**, an
OSRM VPS $5–20/month if the demo server proves insufficient. Nothing else.

**Two readings I will not paper over:** TiDB RU consumption is *withdrawn pending measurement*, not
converted from CockroachDB's units; and storage runway is **~3.6 years**, not the twenty the corpus
once claimed — the tightest constraint in the platform's free-tier budget.

---

## 8. What the build must never get wrong (the cross-cutting rules)

| Rule | Where it bites | Gate |
| --- | --- | --- |
| No CLI, no local commands; everything from Actions, `workflow_dispatch` on all 23 workflows | Every deploy, the keystore, migrations, releases | `no-local-tooling` (A167) |
| No placeholders, no TODO, no mocks in production paths | Every file | `no-placeholders`, `no-seed-data` (A160, A161) |
| Empty means empty: the platform boots with **zero business rows** and 283 screens render correct empty states | Launch day | `empty-platform` (A159) |
| No secret in code, ever; 45 secrets, 11 mandatory, `.env.example` committed | Every build | `secret-scan`, `env-example-complete` (A173, A174) |
| ≤ 700 lines per file (warn at 600), every exported symbol documented | Every file | `line-budget`, `doc-coverage` (A166, A178) |
| Integer paisa only; no float in a money path | Fare, ledger, invoices | `money-integrity` (A68) |
| 200 px → 3 840 px, 50 widths, 2 themes, 2 languages, zero overflow | Every screen | `responsive-matrix` (A151, A152) |
| Bangla + English 100%, ৳, Asia/Dhaka, lakh/crore grouping, no hardcoded strings | Every string | `i18n-completeness` (A162, A164) |
| TiDB dialect only: no `ON CONFLICT`/`RETURNING`/`ILIKE`/`::`/arrays/partial indexes/`INT8`/`gen_random_uuid` | All SQL | `no-postgres-dialect` |
| CHECKs are declarations, not enforcement — generated validators + parity + nightly sweep | All writes | `check-constraint-parity`, `SCHEMA_INVARIANT_VIOLATED` |
| Geometry is integers and ray-casts, proven equivalent | Zones, service areas, radius search | `geo-parity` |

---

## 9. Corpus contradictions I found, and how I will resolve them

Each is a real disagreement between two documents, or an arithmetic error inside one. Per the corpus's own rule
([`35 §8`](../35-execution-plan.md)) I take the more specific document, keep the behaviour that is
correct for a cash business, and record the decision in `docs/_plan/DECISIONS.md` — then, where the
corpus is wrong, fix the corpus in the same commit.

| # | Conflict | Reading I will build to |
| --- | --- | --- |
| 1 | `06` §2 header says **96 tables**; the migration adds three (`cell_zone`, `audit_verifications`, `generation_locks`) and the DDL body implies **99** | 99, and fix the header. The migration is the later statement ([`_plan/TIDB-MIGRATION.md`](TIDB-MIGRATION.md) §8.4) |
| 2 | [`21 §3.3`](../21-admin-panel.md) still says the audit table is protected by a **`BEFORE UPDATE OR DELETE` trigger**; [`27 §4.2`](../27-security-rbac-audit.md) states plainly that the trigger is impossible on TiDB and is gone | Grants + SHA-256 chain + `audit_verifications`; the 21 §3.3 sentence gets corrected. A CI job attempts the forbidden write and requires MySQL error 1142 |
| 3 | [`11 §7.3`](../11-dispatch-engine.md) says `sql` mode claims with **`SELECT … FOR UPDATE` inside a serializable transaction**; [`05 §4.2`](../05-system-architecture.md) says one conditional `UPDATE`, `REPEATABLE READ` | `05 §4.2`: single conditional `UPDATE`, `affected_rows = 1`. TiDB has no `SERIALIZABLE`, and `11` predates the migration |
| 4 | [`24 §2.1`](../24-finance-payouts-invoices.md)'s worked example (taxable 7 272, tax 364, total **52 400**) omits the small-order fee; [`10 §12.1`](../10-fare-engine-math.md) and [`06 §8.2`](../06-data-model-tidb.md) agree on base 8 772, tax 439, total **54 900** | 54 900. `10` owns fare arithmetic, `06` owns the posting set, and the closure identity proves it. Correct `24 §2.1–2.2`; the vectors are the arbiter |
| 5 | [`01`](../01-mission-and-non-negotiables.md) non-negotiable 39 says **`minSdk 26`** and tests API 26/30/34/35; [`16 §3.1`](../16-android-foundation.md) and [`18 §1`](../18-partner-app.md) say **`minSdk 24`** | `minSdk 26`. The non-negotiable names its own enforcement and its own test matrix; 16's argument ("below 24 both collapse") is satisfied by 26. Cost: Android 7.x devices are excluded — a small, shrinking share of the Bangladeshi base |
| 6 | Secrets count: A173 says 44, [`37 §6`](../37-feature-register.md) and [`29 §3`](../29-secrets-and-configuration.md) say **43 (11 mandatory)** | 43 / 11; `env-example-complete` is the arbiter |
| 7 | Guardrails: A176 says **31**; [`_plan/TIDB-MIGRATION.md`](TIDB-MIGRATION.md) §8.4 says 28 → **30** | 31 (A176 + `35` #15), i.e. the migration's two additions land inside the current count; `38`/`37` registers follow the CI job's own list |
| 8 | [`21 §13`](../21-admin-panel.md) puts the admin on a **separate Pages project at `admin.{domain}`**; the operator's brief specifies **one Pages project** holding both the pre-rendered storefront and the admin SPA; A2 names two deploy workflows | One Pages project, two build outputs — storefront at `/`, admin SPA at `/admin/*` — with a **path-scoped CSP and `_headers`** that keeps the admin's stricter policy, and Access scoped to `/admin/*`. Two workflows feed one project. Recorded as a deliberate, visible deviation in `DECISIONS.md` |
| 9 | [`09 §3`](../09-undal-brain-overview.md) names the money module `workers/brain/src/mathx/paisa.py`; [`34 §3`](../34-repository-layout.md) lays the Brain out as `src/lib/` | `34` governs layout → `workers/brain/src/lib/paisa.py`; `09`'s prose path gets corrected. Behaviour identical |
| 10 | [`07 §3.3`](../07-d1-live-tracking.md) cadence floors and [`01`](../01-mission-and-non-negotiables.md)'s "only ≥ 100 m" read as a conflict at first glance | Not a conflict: 100 m is the base gate, and the cadence *tightens* it near the drop and relaxes the **time** ceiling when stationary. Never loosens the displacement gate; the 54-write budget is the proof |
| 11 | Occupancy of acceptance criteria: A3 was rewritten for TiDB by the migration, and `geo-parity` is its proof; the count stays **179** | 179, A3 = TiDB + `geo-parity`, A176 guardrails = 31 |
| 12 | `assets/reference/*.mp4` are 22.0 s (720×540, 60 fps) and 15.37 s (720×1280, 60 fps); [`04`](../04-motion-and-interaction.md) is the normative motion spec | `04` governs every duration and curve; the videos are mood references — ref A warm card UI with a floating cart capsule and in-place stepper morph, ref B glassy liquid surfaces and an image-led scroll. No motion value is taken from a video |
| 13 | The screen inventories do not add up: [`17 §2`](../17-customer-app.md)'s groups sum to **78** but its total says 68; [`18 §2`](../18-partner-app.md) sums to 64, total 54; [`19 §2`](../19-rider-app.md) sums to 71, total 61 — and [`37 §6`](../37-feature-register.md) registers **283** screens against those 183. Three numbers, none equal | `docs/features/screens.json`, generated from the real route inventory, is the register and the only count that means anything (A159). The 283 figure stands until the register proves otherwise; empty-platform enumerates the register, never an arithmetic total, and the §2 tables are corrected in the response that builds each app (R14, R16, R18). **No screen is invented to reach a number** |

---

## 10. The numbers the build will be measured against

One line per invariant, because these are what "done" means and what every CI gate asserts
([`37 §6`](../37-feature-register.md), [`36`](../36-acceptance-criteria.md)):

412 endpoints · 412 permission keys · 7 system roles · 283 screens (68 customer + 54 partner +
61 rider) · 2 147 admin features · 4 055 platform features · 184 error codes · 46 SSE events ·
94 reason codes · 44 empty states · 22 exception triggers · 118 cuisines · 147 config keys ·
45 secrets (11 mandatory) · 23 workflows · 31 guardrails (each with a failing fixture) ·
64 property suites · 40 fare vectors · 179 acceptance criteria · 50 breakpoints · 3 Workers ·
1 Pages project · 3 Android apps · 99 tables.

Budgets that are build-failing, not aspirational: cold start ≤ 1 400 ms on a Redmi Note 10;
APK ≤ 12/20/24 MB; home LCP ≤ 1.8 s and CLS ≤ 0.02; Lighthouse ≥ 95 on all four axes; bundle
≤ 160 KB gzip; presence p95 ≤ 2 000 ms; D1 ≤ 54 writes per delivery; money and ledger at **100%
line and branch coverage**.

---

## 11. What comes next

Response 2 is `docs/_plan/BUILD-PLAN.md`: the file-by-file manifest for all 20 build responses, the
module boundaries (including the `app → feature → core` rule and `undal-core` as sole writer), the
dependency order from the empty repo to the last Android feature module, and the exact CI gate that
must be green at the end of each response. Responses 3–22 then build it in that order, each one
ending green, each one stopping for "continue".

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
*SPDX-License-Identifier: LicenseRef-PASVL-1.0*
