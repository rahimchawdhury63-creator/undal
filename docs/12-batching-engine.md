<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 12 — Batching Engine

> The brief's scenario: *"an vendor receives 2 orders at same time and the preparation time is
> similar and the locations of the customers if similar or not maybe an Rider receives both orders
> if the Rider accept it's will be an bundle pick-up."* This document turns that into an algorithm
> with a feasibility proof, a detour budget, and a guarantee that no customer's food gets cold so
> that another customer's can be delivered.

---

## 1. The rule that governs everything here

> **A bundle is only formed if every order in it is delivered no later than it would have been
> delivered alone, plus a bounded, declared tolerance.**

Batching that makes one customer wait so the platform can save a rider-trip is theft of that
customer's time. Undal's detour budget (§4) makes the trade explicit, bounded, and auditable: the
second customer may wait up to **7 minutes** longer than their solo projection, and only if their
food is in an insulated bag and the order contains no item tagged `TEMPERATURE_CRITICAL`.

If the budget cannot be met, the bundle is not formed. There is no override, not even for an admin,
because an admin under pressure during a rush is exactly who would override it.

---

## 2. When batching is considered

Three trigger points, each cheap:

| Trigger | When | Cost |
| --- | --- | --- |
| **Same-vendor co-arrival** | A new order reaches `ACCEPTED` at a vendor that already has an unassigned or recently-assigned order | One `/brain/batch` call, ~2 ms |
| **In-flight append** | A rider is `ON_ORDER` heading to a vendor, and a new order appears at that same vendor | Evaluated as part of normal dispatch scoring, factor 9 |
| **Cluster append** | A rider is carrying order X and a new order Y appears whose pickup is within 400 m of the rider's current position and whose drop is within the detour budget | Evaluated in dispatch |

The first is the brief's scenario and the most common. The third is the most valuable in dense
areas and the hardest to get right.

**Not considered:** cross-vendor pickups more than 400 m apart, orders whose combined item count
exceeds the vehicle's capacity, and anything involving a bicycle beyond a 2-stop bundle.

---

## 3. Vehicle capacity

| Vehicle | Max concurrent orders | Max total items | Max bundle span |
| --- | --- | --- | --- |
| Motorbike | **3** | 24 | 6 000 m total route |
| Bicycle | **2** | 10 | 3 000 m total route |

A bicycle may bundle, but only two orders, only from the same vendor, and only when both drops are
within 1 200 m of each other. A bicycle rider balancing three bags of curry is not a system that
works; the capacity numbers come from what a standard delivery box actually holds.

Capacity is also constrained by **item tags**: an order containing an item tagged
`TEMPERATURE_CRITICAL` (ice cream, falooda, cold drinks in a hot month) or `SPILL_RISK` (soup,
borhani, open-top containers) reduces the effective capacity by one and tightens the detour budget
by half. Vendors set these tags per item, and the tags are also used for packaging guidance.

---

## 4. The detour budget

The core constraint. For a candidate bundle `[A, B]` where A is delivered first:

```
solo_eta(X)     = ready_at(X) + travel(vendor → drop_X)
bundle_eta(A)   = ready_at(latest in bundle) + travel(vendor → drop_A)
bundle_eta(B)   = bundle_eta(A) + handover_time + travel(drop_A → drop_B)

detour(A) = bundle_eta(A) − solo_eta(A)
detour(B) = bundle_eta(B) − solo_eta(B)
```

The bundle is **feasible** only if all of the following hold:

| # | Constraint | Default |
| --- | --- | --- |
| C1 | `detour(X) ≤ max_detour_s` for every order X | **420 s (7 min)** |
| C2 | `detour(X) ≤ max_detour_s / 2` if X contains a `TEMPERATURE_CRITICAL` or `SPILL_RISK` item | 210 s |
| C3 | `bundle_eta(X) ≤ promised_eta_max(X)` for every X — **the promise made to the customer at checkout is never broken** | hard |
| C4 | `|ready_at(A) − ready_at(B)| ≤ ready_window_s` | **360 s (6 min)** |
| C5 | `travel(drop_A → drop_B) ≤ max_leg_m` | 2 000 m motorbike, 1 200 m bicycle |
| C6 | Total route ≤ the vehicle's max bundle span | §3 |
| C7 | Total items ≤ the vehicle's capacity | §3 |
| C8 | The rider's cash headroom covers both order totals | [`11 §8`](11-dispatch-engine.md) |
| C9 | Neither order is already in `REASSIGNING` or `DISPUTED` | hard |
| C10 | Combined, the bundle's rider payout is ≥ the sum of the two minimum payouts | hard |

C3 is the one that makes the whole thing defensible. The customer was given an ETA range at
checkout; the bundle may use the slack inside that range and may not exceed it. If bundling would
push past `eta_max`, the bundle is infeasible no matter how efficient it is.

### 4.1 `handover_time`

The time a rider spends at a door: finding the building, climbing stairs, waiting, taking cash,
making change. Learned per grid cell as an EWMA of observed `arrived_at → delivered_at`, defaulting
to **165 s** and clamped to `[90, 420]`. Urban flats with lifts converge low; walk-up buildings and
gated compounds converge high. Getting this number right is the difference between a bundle that
works and a bundle that runs 5 minutes late every time.

### 4.2 Ordering within the bundle

For a 2-order bundle there are two permutations; for 3 there are six. The engine evaluates **all**
of them (at most 6) and picks the one that minimises:

```
cost(permutation) = Σ detour(X)² + λ × total_route_m
```

The **squared** detour is deliberate: it penalises one customer waiting 7 minutes far more than two
customers waiting 3 minutes each. Fairness between customers matters more than the raw sum.
`λ = 0.004` per metre, calibrated so that a 500 m route saving is worth about 22 seconds of total
squared detour.

Brute-forcing 6 permutations is 6 route lookups. With the OSRM table call already made for the
dispatch cycle, the inter-drop distances come from the same matrix at no extra cost.

---

## 5. The feasibility proof

Every bundle carries a machine-checkable proof, stored on `order_batches.feasibility_proof`:

```jsonc
{
  "permutation": ["UND-7K2M9QX4", "UND-3P8W1ZB6"],
  "readyAt": { "UND-7K2M9QX4": "…T14:22:10Z", "UND-3P8W1ZB6": "…T14:23:40Z" },
  "readyWindowS": 90,
  "handoverS": 172,
  "legs": [
    { "from": "RIDER", "to": "VENDOR",       "m": 1200, "s": 198 },
    { "from": "VENDOR", "to": "DROP_A",      "m": 2800, "s": 462 },
    { "from": "DROP_A", "to": "DROP_B",      "m":  900, "s": 161 }
  ],
  "soloEta":   { "UND-7K2M9QX4": "…T14:30:52Z", "UND-3P8W1ZB6": "…T14:33:18Z" },
  "bundleEta": { "UND-7K2M9QX4": "…T14:31:22Z", "UND-3P8W1ZB6": "…T14:36:15Z" },
  "detourS":   { "UND-7K2M9QX4": 30,            "UND-3P8W1ZB6": 177 },
  "promisedEtaMax": { "UND-7K2M9QX4": "…T14:44:00Z", "UND-3P8W1ZB6": "…T14:47:00Z" },
  "constraints": { "C1": true, "C2": "n/a", "C3": true, "C4": true, "C5": true,
                   "C6": true, "C7": true, "C8": true, "C9": true, "C10": true },
  "feasible": true,
  "costScore": 31_641
}
```

The proof is re-validated at the moment the rider accepts, because the world may have moved in the
25 seconds since the offer was made. If it no longer holds, the second order is silently removed
from the offer and dispatched separately — the rider sees a single-order card, not an error.

---

## 6. The batch score

Feasibility is binary. Among feasible bundles, the engine picks the best by:

```python
def batch_score(b: BundleCandidate, zone: ZoneFeatures) -> float:
    """How much better is this bundle than running the orders separately?

    All five terms are in [0,1] and the weights sum to 1. The result feeds
    dispatch factor 9 (`batch_fit`) and decides between competing bundles.
    """
    # 1. Distance saved, normalised against the solo total
    efficiency = (b.solo_total_m - b.bundle_total_m) / max(b.solo_total_m, 1)

    # 2. How little the customers are inconvenienced
    detour_quality = 1.0 - (max(b.detour_s.values()) / MAX_DETOUR_S)

    # 3. How well the ready times line up — a 20 s gap is better than a 5 min gap
    ready_sync = 1.0 - (b.ready_window_s / READY_WINDOW_MAX_S)

    # 4. Has this rider handled bundles well before?
    rider_fit = b.rider.batch_success_rate

    # 5. Does the zone need the capacity freed right now?
    pressure = min(1.0, zone.active_orders / max(zone.active_riders, 1) / 2.0)

    return (0.32 * efficiency + 0.26 * detour_quality + 0.18 * ready_sync
          + 0.14 * rider_fit + 0.10 * pressure)
```

A bundle is only offered when `batch_score ≥ 0.45`. Below that, the saving does not justify the
added complexity and risk.

### 6.1 Worked example

Using the Vector 06 bundle from [`10 §12.6`](10-fare-engine-math.md):

| Term | Value | Computation |
| --- | --- | --- |
| `efficiency` | 0.417 | `(8400 − 4900) / 8400` |
| `detour_quality` | 0.579 | `1 − 177/420` |
| `ready_sync` | 0.750 | `1 − 90/360` |
| `rider_fit` | 0.880 | rider's historical batch success |
| `pressure` | 0.393 | 11 orders, 14 riders |
| **Score** | **0.566** | above the 0.45 threshold → offered |

---

## 7. The rider's experience

A bundle offer is one card, not two. Getting this UI right is what makes riders accept bundles.

```
┌─────────────────────────────────────────────────┐
│  ⚡ BUNDLE  ·  2 orders  ·  same restaurant      │
│                                        ◷ 0:22   │
│─────────────────────────────────────────────────│
│  PICK UP                                        │
│  🏪  Rahman's Biriyani House                    │
│      Zindabazar · 1.2 km · ready in 4 min       │
│      Both orders ready together                 │
│─────────────────────────────────────────────────│
│  DROP 1 ──────────────────────── 2.8 km         │
│  📍  Shibganj, House 42, 3rd floor              │
│      UND-7K2M9QX4 · 3 items · ৳549 cash         │
│                                                 │
│  DROP 2 ──────────────────────── 0.9 km more    │
│  📍  Shibganj, Lane 7, Flat B2                  │
│      UND-3P8W1ZB6 · 2 items · ৳312 cash         │
│─────────────────────────────────────────────────│
│  [ map preview with the 3-leg route drawn ]     │
│─────────────────────────────────────────────────│
│  YOU EARN                                       │
│  Order 1 fare                            ৳68.00 │
│  Order 2 fare                            ৳22.00 │
│  Bundle bonus                            ৳12.00 │
│  Order bonuses (3%)                      ৳15.60 │
│  Order fee share (2 × ৳5)                ৳10.00 │
│  ─────────────────────────────────────────────  │
│  TOTAL                                  ৳127.60 │
│  4.9 km  ·  ~23 min  ·  ৳20.82/km  ·  ৳333/hr   │
│                                                 │
│  Solo, these two would pay ৳141.60 over 8.4 km  │
│  and take ~33 min. This is ৳4/km better.        │
│─────────────────────────────────────────────────│
│       ◀━━━━━━━ SLIDE TO ACCEPT BOTH ━━━━━━━▶    │
│              Decline          Take only one     │
└─────────────────────────────────────────────────┘
```

The comparison line is the persuasion, and it is honest arithmetic rather than a marketing claim.
It shows total payout going *down* (৳127.60 vs ৳141.60) and per-kilometre and per-hour going *up*.
Riders are not fooled by a bigger headline number; they care about the rate.

### 7.1 "Take only one"

Always available. The rider gets order 1 (the one with the shorter detour impact), and order 2
returns to the cascade immediately at wave 1. No penalty, no cooldown, and the trace records that
the bundle was offered and partially declined so the batch model learns which bundles riders
actually want.

### 7.2 During the delivery

The rider's active-order screen becomes a **stop list**:

```
  ●  Rahman's Biriyani House          PICK UP BOTH
  │     [ Scan QR — order 1 ]  ✓
  │     [ Scan QR — order 2 ]
  │
  ●  Shibganj, House 42               DROP 1 · 2.8 km
  │     3 items · collect ৳549
  │
  ○  Shibganj, Lane 7                 DROP 2 · 0.9 km
        2 items · collect ৳312
```

Rules:
- **Both QRs must be scanned at the vendor.** The order cannot move to `PICKED_UP` with one bag.
- Stops are **strictly sequential**. The app will not let a rider mark drop 2 before drop 1,
  because out-of-order delivery is how the wrong bag reaches the wrong door. The admin can override
  with a reason if a customer is genuinely unreachable.
- Each stop shows **only that customer's** items and cash amount, to reduce mis-handovers.
- The bag colour/number assigned at pickup is displayed at the drop. Undal provides numbered bag
  tags to partners; the order QR encodes the tag number.
- Navigation hands off one leg at a time, not the whole route, because turn-by-turn to a waypoint
  chain is unreliable across maps apps.

### 7.3 If a bundle goes wrong

| Situation | Behaviour |
| --- | --- |
| Customer 1 unreachable | A 5-minute timer with escalating prompts; then the rider proceeds to drop 2 and returns, with the detour compensated at ৳25 and the order flagged for admin |
| Drop 1 takes far longer than `handover_time` | At `handover + 240 s`, customer 2 is proactively messaged: *"Your rider is finishing another delivery nearby and will reach you in about 6 minutes."* Honest, pre-emptive, and it prevents the complaint |
| Rider's vehicle fails mid-bundle | Both orders → `DISPUTED`; admin dispatches a recovery rider; original rider paid for completed legs |
| Order 2 is cancelled after pickup | Rider completes order 1, returns order 2 to the vendor, is paid in full for both legs, and the cancellation cost is attributed per [`24 §8`](24-finance-payouts-invoices.md) |

---

## 8. The customer's experience

Customers are **told** they are in a bundle. Concealing it would be the kind of small dishonesty
that erodes trust when discovered — and it is discovered, because the map shows the rider going
somewhere else first.

The tracking screen shows:

```
  🛵  Karim is delivering 2 orders on this trip
      Yours is stop 2 of 2 · arriving 14:36–14:41
      You saved ৳23.85 on delivery because of this
```

Three facts, stated plainly: that it is a bundle, where they are in it, and that it saved them
money. The map draws the rider's full route including the first drop, so nothing about the rider's
movement is surprising.

For stop 1 the message is simply *"Karim is on the way — you're first."*

### 8.1 The bundle credit

[`10 §11`](10-fare-engine-math.md). 30% of the delivery fee, capped at ৳25, applied automatically at
`DELIVERED` and itemised on the receipt as **"Bundled delivery saving"**. The customer did not ask
for it and is not asked to opt in; it simply appears.

---

## 9. The vendor's experience

The partner app shows bundled orders grouped with a shared ribbon:

```
┌──── ⚡ ONE RIDER · 2 ORDERS ────────────────┐
│  UND-7K2M9QX4   3 items   ready 14:22  [QR] │
│  UND-3P8W1ZB6   2 items   ready 14:24  [QR] │
│  🛵 Karim arriving ~14:26                    │
└──────────────────────────────────────────────┘
```

Operationally this matters: the kitchen knows to stage both bags together, and it knows the
earliest useful completion time is when the *later* of the two is ready. The app also shows the
suggestion *"Both orders leave together — no rush on #7K2M if #3P8W needs another 2 minutes."*

---

## 10. Three-order bundles

Permitted for motorbikes only, and only when all three orders come from the **same vendor** and all
three drops fall inside a 1 500 m-diameter circle. The permutation search is 6 cases; constraints
C1–C10 apply to all three; the detour budget is tightened to **300 s** for the last drop because
compounding risk is real.

In the benchmark, 3-order bundles occur on 2.8% of orders and have a 94% on-time rate versus 97%
for 2-order bundles and 96% for solo. The 3% gap is the reason for the tighter budget, and the
engine will not form a 3-bundle when the zone's `handover_time` EWMA is above 240 s.

---

## 11. What batching is not allowed to do

| Prohibited | Why |
| --- | --- |
| Make a customer wait beyond their promised `eta_max` | C3 |
| Bundle orders from different vendors more than 400 m apart | The second pickup becomes a third unpredictable wait |
| Bundle when either order has a `TEMPERATURE_CRITICAL` item and the detour exceeds 210 s | The food is the product |
| Bundle a bicycle beyond 2 orders | Physical capacity |
| Reduce a rider's total payout below the sum of minimum payouts | C10 |
| Be forced on a rider | "Take only one" is always present |
| Be hidden from a customer | §8 |
| Be used to avoid hiring riders during a sustained shortage | The admin dashboard shows bundle rate against supply ratio and flags a zone where bundling is masking under-supply for more than 3 consecutive days |

The last row is a governance control rather than a technical one, and it exists because batching is
exactly the lever a platform reaches for when it should be recruiting.

---

## 12. Testing

| Test | Count | Asserts |
| --- | --- | --- |
| Constraint unit tests | 40 | C1–C10, each at boundary and just-past-boundary |
| Permutation search | 16 | All orderings evaluated; the minimum-cost one chosen; ties broken stably |
| Detour arithmetic | 28 | Against hand-computed timelines |
| Proof validity | 10 | A proof that validates at offer time and fails at accept time causes a clean downgrade to a single order |
| Capacity | 14 | Vehicle limits, item limits, tag-based reductions |
| Payout | 12 | The Vector 06 arithmetic and 11 variants; `৳/km` never decreases (property P19) |
| Sequential stops | 9 | Out-of-order delivery is blocked; admin override is audited |
| Customer messaging | 6 | Stop position, ETA, and credit are correct on every path |
| Failure paths | 11 | Every row of §7.3 |
| **Simulation** | 10 000 order-days | Bundle rate, on-time rate, and the throughput effect in [`11 §12.1`](11-dispatch-engine.md) |

---

## 13. Reading on

Next: [`13-ranking-personalization.md`](13-ranking-personalization.md) — what the customer sees first.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
