<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 11 — Dispatch Engine

> Choosing which rider gets an order is the decision that determines whether food arrives hot,
> whether riders earn a living, and whether the platform can serve a neighbourhood at all. This is
> how Undal makes it: deterministically, in six milliseconds, with fourteen factors, and with a
> written reason for every choice.

---

## 1. The objective

Dispatch is a constrained optimisation with four competing goals:

| Goal | Measured by | Why it conflicts |
| --- | --- | --- |
| **Food arrives hot and on time** | Time from `ready_at` to `delivered_at` | Wants the nearest rider, always |
| **Riders earn consistently** | Variance of earnings per rider per hour | Wants work spread evenly, not concentrated on whoever is closest |
| **Offers get accepted quickly** | Time from `RIDER_SEARCH` to `RIDER_ASSIGNED` | Wants the rider most likely to say yes, who is not always the nearest |
| **The zone stays covered** | Riders available in each cell | Wants to avoid pulling every rider into one corner |

A naive "nearest available rider" policy optimises only the first. It produces a platform where
three riders near the market get 60% of the work, the rest log off, and coverage collapses at the
edges. Undal's scoring function balances all four, and the benchmark in
[`30 §7`](30-testing-and-verification.md) shows the measured result.

---

## 2. The dispatch cycle

```
Order reaches ACCEPTED (or PLACED, for the pre-warm)
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ 1. CANDIDATE GENERATION        (Core → ZoneHub → D1)      │
│    Who is eligible at all? Hard filters only.             │
└───────────────────┬───────────────────────────────────────┘
                    ▼
┌───────────────────────────────────────────────────────────┐
│ 2. ENRICHMENT                  (Core → KV + OSRM table)   │
│    Positions, features, and an OSRM distance-matrix call  │
│    giving true travel time from each candidate to the     │
│    vendor. One call, N destinations.                      │
└───────────────────┬───────────────────────────────────────┘
                    ▼
┌───────────────────────────────────────────────────────────┐
│ 3. BATCH EVALUATION            (Brain /brain/batch)       │
│    Can this order join an existing bundle? Doc 12.        │
└───────────────────┬───────────────────────────────────────┘
                    ▼
┌───────────────────────────────────────────────────────────┐
│ 4. SCORING                     (Brain /brain/dispatch)    │
│    14 factors, each in [0,1], weighted, summed, ranked.   │
└───────────────────┬───────────────────────────────────────┘
                    ▼
┌───────────────────────────────────────────────────────────┐
│ 5. WAVE SIZING                 (Brain, acceptance model)  │
│    How many riders per wave, how long each wave lasts.    │
└───────────────────┬───────────────────────────────────────┘
                    ▼
┌───────────────────────────────────────────────────────────┐
│ 6. CASCADE                     (OrderHub, DO alarms)      │
│    Fire wave 1 → wait → wave 2 → wait → …                 │
│    First valid claim wins, atomically.                    │
└───────────────────┬───────────────────────────────────────┘
                    ▼
            Assigned, or fallback (§11)
```

Steps 1–5 complete in under 400 ms end to end, of which the Brain's share is ~6 ms. The rest is
OSRM and the database.

### 2.1 The pre-warm

Steps 1, 2 and 4 are run **speculatively when the order is placed**, before the vendor has accepted.
The result is cached in `OrderHub` for 180 seconds. When the vendor accepts, the cascade can begin
immediately rather than after a fresh 400 ms round trip.

The scores are recomputed if the cache is older than 60 seconds or if the zone's rider set has
changed by more than 20%, because a stale candidate list is worse than a slow one. In practice about
78% of accepts hit a warm cache, and the median `ACCEPTED → offer delivered` is **310 ms**.

---

## 3. Candidate generation — the hard filters

A rider is a candidate only if **all** of these are true. These are binary gates, not scores: a
rider who fails any one of them is not ranked at all.

| # | Filter | Rationale |
| --- | --- | --- |
| 1 | `riders.status = 'APPROVED'` | KYC complete |
| 2 | `shift_state IN ('ONLINE', 'ON_ORDER')` | On shift |
| 3 | A `rider_shifts` row is open with `selfie_verified = true` | The shift-start identity check passed |
| 4 | Last position in D1 is newer than `stale_after` | We know where they are |
| 5 | Not in `CASH_LOCKED` | Cash settlement is outstanding — see [`25`](25-rider-cash-settlement.md) |
| 6 | No active suspension | |
| 7 | Shift zone matches the order's zone, **or** the rider is within 1 500 m of the zone boundary | Edge-of-zone riders are useful and excluding them creates dead corners |
| 8 | **Vehicle radius**: `routed_distance ≤ max_radius_m` for their vehicle (bicycle 4 000 m, motorbike 12 000 m) | [`10 §7.2`](10-fare-engine-math.md) |
| 9 | Current load `< max_concurrent` (1 for bicycle, 3 for motorbike) | A bicycle rider cannot carry three bags of hot food |
| 10 | If already on an order: the new order must pass the batch feasibility proof ([`12 §5`](12-batching-engine.md)) | |
| 11 | `cash_in_hand_paisa + order.total_paisa ≤ cash_limit_paisa` (default ৳3 500) | Cash-risk cap; see §8 |
| 12 | Not offered this order already in a previous wave with a rejection | No re-offering after an explicit no |
| 13 | Not in a **rejection cooldown** for this vendor (§9) | |
| 14 | Device reports `notifications_allowed = true` | A rider who cannot receive the alarm cannot take the order; they are told why, prominently, in the app |

Filter 14 deserves a note. A rider with notifications disabled is invisible to dispatch, which looks
like a bug from their side. The rider app therefore shows a **blocking banner** — not a dismissible
toast — saying "You will not receive orders until notifications are enabled", with a one-tap deep
link to the system settings page. [`15 §9`](15-wakeup-alarm-fcm.md) covers the full coaching flow.

### 3.1 When there are no candidates

If filters 1–14 eliminate everyone, dispatch does **not** immediately fail. It enters the expansion
ladder in §11.

---

## 4. Enrichment

### 4.1 The OSRM table call

One request, `N` sources (the candidate riders) and 1 destination (the vendor):

```
GET {OSRM_BASE_URL}/table/v1/driving/{lon1},{lat1};{lon2},{lat2};…?sources=0;1;…&destinations={vendorIdx}&annotations=duration,distance
```

This is the single most valuable external call in the dispatch path, because true travel time is
profoundly different from straight-line distance in a city with rivers and one-way streets. A rider
400 m away across the Surma is 14 minutes away.

**Budget and caching:** one call per dispatch cycle, ~500 orders/day = 500 calls/day plus retries.
Results are cached in KV for 90 seconds keyed by `(roundedVendorPoint, sortedRoundedRiderPoints)`,
giving a ~35% hit rate during busy periods when the same riders are candidates for consecutive
orders.

**Fallback:** if OSRM times out at 600 ms, the engine uses `haversine × zone.detour_factor` and sets
`distance_source = "ESTIMATED"` on the trace. The learned detour factor ([`09 §7.3`](09-undal-brain-overview.md))
makes this accurate to within about 14% in Sylhet Central, which is good enough to rank — and
ranking is all this call is for.

### 4.2 Bicycle routing

Bicycles get `/table/v1/cycling/` when the OSRM instance has a cycling profile, falling back to
`driving` with a 1.35× duration multiplier. The multiplier is itself an EWMA learned from actual
bicycle-rider travel times, so it converges on the truth for the specific city.

---

## 5. The fourteen factors

Every factor returns a value in `[0, 1]` where **1 is better**. The weights sum to 1.0 and live in
`platform_config.dispatch_weights`, versioned, audited, and editable from the admin panel's Brain
Lab.

| # | Factor | Definition | Default weight |
| --- | --- | --- | --- |
| 1 | `proximity` | `1 / (1 + d/k)` where `d` is routed metres to the vendor and `k` is the zone's median pickup distance (≈1 100 m) | **0.170** |
| 2 | `eta_fit` | How well the rider's arrival at the vendor matches `ready_at`. Peaks at 1.0 when they arrive 0–120 s before ready; decays either side. | **0.150** |
| 3 | `acceptance` | The rider's Wilson-bounded acceptance rate, further conditioned by the logistic propensity model ([`09 §7.4`](09-undal-brain-overview.md)) for *this specific offer* | **0.130** |
| 4 | `reliability` | `0.6 × completion_rate + 0.4 × on_time_rate`, both Wilson-bounded | **0.110** |
| 5 | `fairness` | Rises with the rider's idle time and falls with their deliveries-today relative to the zone median | **0.095** |
| 6 | `rating` | Wilson lower bound of (4★ or 5★) ÷ total | **0.070** |
| 7 | `vendor_familiarity` | `min(1, deliveries_from_this_vendor / 8)` — a rider who knows the kitchen's back entrance is faster | **0.055** |
| 8 | `area_familiarity` | `min(1, deliveries_into_this_cell / 12)` — matters enormously for finding an unmarked door | **0.055** |
| 9 | `batch_fit` | 0 if this is not a batch candidate; otherwise the bundle's feasibility score from [`12`](12-batching-engine.md) | **0.050** |
| 10 | `load_balance` | Falls as the rider's concurrent orders approach their maximum | **0.045** |
| 11 | `cash_headroom` | `1 − (cash_in_hand + order_total) / cash_limit` | **0.030** |
| 12 | `zone_coverage` | Penalises pulling the last rider out of an under-covered cell, using the demand forecast | **0.025** |
| 13 | `freshness` | Falls as the rider's position fix ages, so a rider last seen 4 minutes ago ranks below an equivalent one seen 10 seconds ago | **0.010** |
| 14 | `vehicle_fit` | Suitability of the vehicle for this order: trip length, item count, whether the order includes a large or hot-soup item that a bicycle handles badly | **0.010** |

**Sum: 1.000.**

### 5.1 Why `eta_fit` is not just "sooner is better"

A rider who arrives at the kitchen 12 minutes before the food is ready is **worse** than one who
arrives 1 minute before: they wait, unpaid, blocking themselves from other work, and they crowd the
vendor's counter. A rider who arrives 6 minutes late is worse still — the food sits and cools.

```python
def eta_fit(arrival_s: int, ready_s: int) -> float:
    """1.0 when the rider arrives in the sweet spot just before the food is ready.

    The asymmetry is deliberate: arriving early costs the rider time, arriving
    late costs the customer a cold meal, and the second is worse. The decay
    constant on the late side is therefore half the early side's.
    """
    slack = ready_s - arrival_s           # positive = early
    if 0 <= slack <= 120:
        return 1.0
    if slack > 120:
        return max(0.0, 1.0 - (slack - 120) / 900.0)    # 15 min early → 0
    return max(0.0, 1.0 - (-slack) / 420.0)             # 7 min late → 0
```

This single factor is the largest contributor to Undal's measured advantage over nearest-rider. In
the benchmark it reduces mean rider wait-at-vendor from 6.8 to 2.9 minutes, which directly converts
into more deliveries per rider-hour.

### 5.2 Why `fairness` exists

```python
def fairness(idle_s: int, deliveries_today: int, zone_median_today: float) -> float:
    """Spread work. A rider who has been waiting 20 minutes should outrank an
    equivalent rider who just finished a job, and a rider who has done 3 jobs
    should outrank one who has done 11.

    Without this factor, dispatch concentrates: the riders who happen to live
    near the busiest vendors take most of the work, everyone else earns too
    little to stay on the platform, coverage shrinks, and the concentration gets
    worse. It is a positive-feedback failure mode and the only defence is to
    pay an explicit cost for it in the objective function.
    """
    idle_term = min(1.0, idle_s / 1200.0)                  # saturates at 20 min
    if zone_median_today <= 0:
        load_term = 1.0
    else:
        ratio = deliveries_today / zone_median_today
        load_term = max(0.0, min(1.0, 1.5 - 0.5 * ratio))  # 1.0 at 0 jobs, 0.0 at 3x median
    return 0.55 * idle_term + 0.45 * load_term
```

The benchmark measures the effect: fairness weight at 0 gives a Gini coefficient of 0.41 on rider
earnings; at the default 0.095 it is **0.19**, with a cost of 38 seconds in mean assignment time.
That trade is worth making and the admin panel shows both numbers so the operator can judge.

### 5.3 The scoring loop

```python
def score_candidates(order: OrderCtx, cands: list[Candidate],
                     w: Weights, zone: ZoneFeatures) -> list[Scored]:
    """One pass, no allocation inside the loop, fully deterministic.

    Ties are broken by (1) higher acceptance, (2) lower rider_id lexicographically.
    The second tiebreak is arbitrary but it must exist and must be stable, or the
    replay test cannot assert equality.
    """
    out: list[Scored] = []
    for c in cands:
        f = (
            proximity(c.routed_m, zone.median_pickup_m),
            eta_fit(c.eta_to_vendor_s, order.ready_in_s),
            acceptance(c, order, zone),
            reliability(c),
            fairness(c.idle_s, c.deliveries_today, zone.median_deliveries_today),
            rating(c),
            vendor_familiarity(c, order.vendor_id),
            area_familiarity(c, order.drop_cell),
            batch_fit(c, order),
            load_balance(c),
            cash_headroom(c, order.total_paisa),
            zone_coverage(c, zone),
            freshness(c.fix_age_s),
            vehicle_fit(c.vehicle, order),
        )
        total = (f[0]*w.proximity + f[1]*w.eta_fit + f[2]*w.acceptance
               + f[3]*w.reliability + f[4]*w.fairness + f[5]*w.rating
               + f[6]*w.vendor_fam + f[7]*w.area_fam + f[8]*w.batch_fit
               + f[9]*w.load_balance + f[10]*w.cash + f[11]*w.coverage
               + f[12]*w.freshness + f[13]*w.vehicle_fit)
        out.append(Scored(c.rider_id, total, f))
    out.sort(key=lambda s: (-s.total, -s.factors[2], s.rider_id))
    return out
```

---

## 6. A worked dispatch

Order `UND-7K2M9QX4`, Vector 01 from [`10 §12.1`](10-fare-engine-math.md). Vendor ready in 9
minutes. Five candidates survive the hard filters.

| Rider | Vehicle | Routed to vendor | ETA | Accept | Complete | On-time | Rating | Idle | Jobs today | Vendor fam. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A** | Motorbike | 420 m | 95 s | 0.71 | 0.94 | 0.88 | 0.82 | 40 s | 9 | 11 |
| **B** | Motorbike | 820 m | 165 s | 0.84 | 0.96 | 0.91 | 0.79 | 412 s | 4 | 7 |
| **C** | Bicycle | 610 m | 220 s | 0.66 | 0.90 | 0.84 | 0.88 | 95 s | 6 | 2 |
| **D** | Motorbike | 1 950 m | 390 s | 0.79 | 0.92 | 0.86 | 0.74 | 1 310 s | 1 | 0 |
| **E** | Motorbike | 2 800 m | 520 s | 0.58 | 0.88 | 0.79 | 0.69 | 22 s | 12 | 3 |

Zone median pickup distance 1 100 m; zone median deliveries today 6; order is 3 800 m, so **C is
eliminated by filter 8** (bicycle max radius 4 000 m applies to the total trip; 3 800 m is inside
it, so C survives — but `vehicle_fit` will penalise it for a 3.8 km trip near the cap).

| Factor (weight) | A | B | D | E | C |
| --- | --- | --- | --- | --- | --- |
| proximity (.170) | 0.724 | 0.573 | 0.360 | 0.282 | 0.643 |
| eta_fit (.150) | **0.629** | **0.806** | 0.920 | **1.000** | 0.898 |
| acceptance (.130) | 0.710 | 0.840 | 0.790 | 0.580 | 0.660 |
| reliability (.110) | 0.916 | 0.940 | 0.896 | 0.844 | 0.876 |
| fairness (.095) | 0.206 | **0.639** | **0.925** | 0.010 | 0.343 |
| rating (.070) | 0.820 | 0.790 | 0.740 | 0.690 | 0.880 |
| vendor_fam (.055) | 1.000 | 0.875 | 0.000 | 0.375 | 0.250 |
| area_fam (.055) | 0.583 | 0.750 | 0.250 | 0.417 | 0.333 |
| batch_fit (.050) | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| load_balance (.045) | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| cash_headroom (.030) | 0.843 | 0.912 | 0.971 | 0.604 | 0.889 |
| zone_coverage (.025) | 1.000 | 1.000 | 0.800 | 1.000 | 1.000 |
| freshness (.010) | 1.000 | 1.000 | 0.933 | 1.000 | 1.000 |
| vehicle_fit (.010) | 1.000 | 1.000 | 1.000 | 1.000 | **0.300** |
| **Weighted total** | **0.6620** | **0.7444** | 0.6554 | 0.5557 | 0.6269 |

**Rank: B, A, D, C, E.**

Rider **A** is nearest by 400 m and knows the vendor best — and still loses. Why: A would arrive
**95 seconds** into a 540-second preparation, waiting over seven minutes at the counter
(`eta_fit` 0.629), A has already done 9 jobs against a zone median of 6 (`fairness` 0.206), and A's
acceptance rate is the second-lowest in the set.

Rider **B** arrives 165 s in — still early, but less wastefully — has the best acceptance and
reliability in the set, and has done 4 jobs against a median of 6.

This is the entire argument for the engine in one table. Nearest-rider would pick A, A would wait
seven minutes, and B would sit idle for another twelve. The trace stores exactly this table, and
the admin panel renders it as a stacked bar chart when anybody asks why.

---

## 7. Wave sizing

Offering to one rider at a time is slow. Offering to everyone at once wastes the alarm, annoys
riders who lose the race, and degrades acceptance rates over time.

Undal sizes each wave from the **predicted acceptance probability** of the candidates in it.

```python
def size_waves(scored: list[Scored], p_accept: list[float],
               target: float = 0.90) -> list[list[str]]:
    """Choose wave membership so that each wave has at least `target` probability
    of producing at least one acceptance, assuming independence.

    P(no acceptance in wave) = prod(1 - p_i)
    Add riders to the wave until that falls below (1 - target).

    Independence is an approximation — riders in the same wave see the same
    offer and are influenced by the same payout — but it is a conservative one
    in the direction that matters: correlated refusals make waves slightly too
    small, which costs a little time and never over-offers.
    """
    waves, i = [], 0
    while i < len(scored) and len(waves) < MAX_WAVES:
        wave, p_none = [], 1.0
        while i < len(scored) and p_none > (1.0 - target) and len(wave) < MAX_WAVE_SIZE:
            wave.append(scored[i].rider_id)
            p_none *= (1.0 - p_accept[i])
            i += 1
        waves.append(wave)
    return waves
```

`MAX_WAVES = 5`, `MAX_WAVE_SIZE = 8`.

### 7.1 Wave timing

| Wave | Offer TTL | Starts at |
| --- | --- | --- |
| 1 | 25 s | T+0 |
| 2 | 25 s | T+25 s |
| 3 | 22 s | T+50 s |
| 4 | 20 s | T+72 s |
| 5 | 20 s | T+92 s |
| Fallback (§11) | — | T+112 s |

A wave ends early the moment any rider in it claims. The 25-second TTL is the brief's figure and it
is right: long enough to read the offer card properly, short enough that a distracted rider does not
hold the order hostage.

### 7.2 Worked example

Continuing §6, the propensity model predicts:
`p(B) = 0.72`, `p(A) = 0.54`, `p(D) = 0.61`, `p(C) = 0.44`, `p(E) = 0.31`.

- Wave 1: add B → `p_none = 0.28`. Still above 0.10. Add A → `p_none = 0.129`. Still above. Add
  D → `p_none = 0.050`. Below 0.10, stop. **Wave 1 = [B, A, D]**, 95% chance of an acceptance.
- Wave 2: **[C, E]**, `p_none = 0.386`, 61% — the best that remains.

Three riders' phones go off at T+0. The first to accept wins; the other two get an `offer.withdrawn`
event and their alarm stops immediately, within about 200 ms of the claim. Losing a race must never
feel like a malfunction, so the withdrawn card animates away with the message *"Taken by another
rider — you're back in the queue"* rather than vanishing.

### 7.3 The atomic claim

```ts
// workers/realtime/src/coordination/DurableObjectCoordinator.ts
async claimOffer(orderId: string, riderId: string): Promise<ClaimResult> {
  // Inside a Durable Object: single-threaded, so this whole method is the lock.
  const state = await this.state.storage.get<DispatchState>(`dispatch:${orderId}`);
  if (!state)                       return { ok: false, code: "OFFER_EXPIRED" };
  if (state.claimedBy)              return { ok: false, code: "OFFER_CLAIMED",
                                             claimedBy: state.claimedBy };
  if (!state.currentWave.includes(riderId))
                                    return { ok: false, code: "OFFER_NOT_YOURS" };
  if (Date.now() > state.waveExpiresAt)
                                    return { ok: false, code: "OFFER_EXPIRED" };

  state.claimedBy = riderId;
  state.claimedAt = Date.now();
  await this.state.storage.put(`dispatch:${orderId}`, state);
  await this.state.storage.deleteAlarm();
  return { ok: true };
}
```

On the free-tier `CockroachCoordinator` the same semantics come from a `dispatch_locks` row with
`SELECT … FOR UPDATE` inside the serializable transaction that writes the assignment. Both
implementations pass the identical 34-case concurrency test suite, including a 50-way simultaneous
claim that must produce exactly one winner.

---

## 8. Cash risk

A rider carrying ৳3 500 of collected cash is carrying a meaningful amount of money through a city at
night. Undal caps it:

| Rule | Value |
| --- | --- |
| Default cash limit | ৳3 500 (350 000 paisa) |
| Per-rider override | Admin-settable, 1 000–10 000 paisa range enforced |
| Hard filter | An order that would exceed the limit is not offered (filter 11) |
| Soft factor | `cash_headroom` (factor 11) de-prioritises riders approaching the limit before they hit it |
| At 85% of limit | The rider app shows a prompt: *"You're carrying ৳2 975. Settle now to keep receiving orders."* with a one-tap mid-shift settlement |
| At 100% | The rider stops receiving offers and the app explains why, with the settlement action front and centre |

Mid-shift settlement is the same flow as end-of-shift ([`25`](25-rider-cash-settlement.md)) but
non-blocking: the rider stays online and resumes receiving offers as soon as the submission is
recorded, with admin verification happening afterwards.

---

## 9. Rejection handling

### 9.1 The brief's rule

> *"the rider will accept or reject … if the Rider reject the Rider need to input the reason and
> only reject if any nearby riders are available."*

Implemented exactly:

```
Rider taps Reject
  │
  ├─ Does another eligible, un-offered candidate exist for this order?
  │     │
  │     ├─ YES → Show the reason sheet. Record the rejection. Withdraw the
  │     │        offer. Advance the cascade.
  │     │
  │     └─ NO  → Show the no-alternative sheet:
  │              "You're the only rider who can take this order right now.
  │               The customer has been waiting 1m 40s."
  │              [ Take it ]   [ I really can't ]
  │                               │
  │                               └─ A 10-second countdown, then a second
  │                                  confirmation. On confirm: the rejection
  │                                  is recorded with reason NO_ALTERNATIVE_FORCED,
  │                                  the order goes to the admin fallback (§11),
  │                                  and the rider is NOT penalised — because
  │                                  penalising someone for a genuine inability
  │                                  is how a platform loses riders.
```

The soft block is honest about the situation and gives the rider a dignified way out. It is not a
dark pattern: the "I really can't" path is always available, is never hidden, and carries no
penalty.

### 9.2 Reason codes

| Code | Label (EN / BN) | Penalty | Cooldown |
| --- | --- | --- | --- |
| `TOO_FAR` | Too far / অনেক দূরে | none | 0 |
| `PAYOUT_LOW` | Payout too low / আয় কম | none | 0 |
| `VENDOR_SLOW` | This restaurant keeps me waiting / এই রেস্টুরেন্ট দেরি করায় | none | **45 min for this vendor** |
| `VEHICLE_ISSUE` | Vehicle problem / গাড়ির সমস্যা | none | auto-offline after confirmation |
| `TAKING_BREAK` | I'm stopping soon / বিরতি নিচ্ছি | none | auto-break |
| `AREA_UNSAFE` | I don't go to this area / এই এলাকায় যাই না | none | **permanent for this cell**, admin-reviewable |
| `ORDER_TOO_LARGE` | Too big for my vehicle / আমার গাড়িতে ধরবে না | none | 0; feeds `vehicle_fit` |
| `CASH_LIMIT` | Carrying too much cash / বেশি ক্যাশ আছে | none | prompts settlement |
| `NO_ALTERNATIVE_FORCED` | (system) | none | 0 |
| `OTHER` | Something else / অন্য কিছু | none | 0; free text required, reviewed weekly |

**No rejection reason carries a direct penalty.** The consequence is indirect and statistical: a
rider who rejects a lot has a lower `acceptance` factor, which lowers their dispatch rank. That is
a feedback loop, not a punishment, and it is explained to riders in exactly those words during
onboarding.

The `AREA_UNSAFE` reason is treated with respect. It creates a permanent per-rider exclusion for
that grid cell, no questions asked, and it feeds an admin report — if several riders flag the same
cell, that is operational intelligence worth having.

### 9.3 Expiry versus rejection

An **expired** offer (the rider did nothing) counts against `acceptance` at **half weight** of an
explicit rejection. Rationale: the rider may have been riding, in a lift, or on a call. An explicit
rejection is information; silence is ambiguous, and ambiguity should not be punished at full
strength.

Three consecutive expiries trigger an app-side check: is the alarm actually working? The app runs
its own FCM self-test ([`15 §10`](15-wakeup-alarm-fcm.md)) and surfaces a diagnostic if something is
wrong, because three missed offers usually means a broken notification path rather than a lazy
rider.

---

## 10. Reassignment

A rider who has accepted can drop the order. It happens — a puncture, an accident, a family
emergency.

| Trigger | Penalty | Behaviour |
| --- | --- | --- |
| Rider unassigns **before pickup**, with a reason | None for the first per week; thereafter a `completion_rate` hit | Order → `REASSIGNING` → `RIDER_SEARCH` at wave 1, with the dropped rider excluded |
| Rider unassigns **after pickup** | Admin-handled; the food is in their possession | Order → `DISPUTED`; admin arranges collection or refund; cost attribution recorded |
| Rider goes offline / app killed while assigned | Presence engine detects in 2 s; 60-second grace for a reconnect | After grace: `REASSIGNING`, `completion_rate` hit, customer told honestly |
| Rider stationary > 10 min with no progress | Exception raised to admin | Admin can call, reassign, or leave it |
| Admin force-reassigns | None to the rider unless admin marks fault | Full audit entry with reason |

On reassignment the new rider's offer carries a **+৳15 recovery bonus** funded by the platform,
because a re-dispatched order is already late and needs to be attractive. The bonus is visible on
the offer card and labelled *"Recovery bonus — this order needs rescuing."*

---

## 11. When nobody takes it

The cascade exhausted at T+112 s with no acceptance. Undal does **not** simply cancel.

### The expansion ladder

| Step | At | Action |
| --- | --- | --- |
| 1 | T+112 s | **Re-score with relaxed filters**: raise the bicycle radius by 20%, raise the cash cap by 20%, include riders up to 3 000 m outside the zone boundary. |
| 2 | T+140 s | **Payout boost**: +20% on the rider fare, platform-funded, shown on the card as *"Boosted — nobody has taken this yet."* Re-offer wave 1. |
| 3 | T+175 s | **Second boost**: +40%. Offer to every eligible rider in the zone simultaneously, including those currently on an order who have batch capacity. |
| 4 | T+215 s | **Raise an admin exception** of kind `NO_RIDER_AVAILABLE`, severity HIGH, with the order on the command map, flashing. An admin can manually assign anyone, including a rider from a neighbouring zone. |
| 5 | T+300 s | **Ask the customer.** A push and an in-app sheet: *"We're having trouble finding a rider. Would you like to wait, switch to pick-up, or cancel for a full refund?"* Switching to pick-up refunds the entire delivery fee and gives a ৳30 apology credit. |
| 6 | T+480 s | **Auto-cancel** if the customer has not responded and no rider has accepted. Full refund (nothing was charged — it is COD), a ৳50 credit, and a genuine apology. The vendor is compensated for wasted preparation from the platform's own account, **not** from the customer and **not** from the rider. |

Step 5 is the one that matters most. A customer who is told what is happening and given choices is
not an angry customer. A customer who waits 40 minutes and then gets "cancelled" is gone forever.

Every step of the ladder is recorded on the order's state event log and on the trace, so the
weekly operations review can see how often each step fires — which is the clearest possible signal
about whether a zone is under-supplied.

---

## 12. Testing

| Test | Count | Asserts |
| --- | --- | --- |
| Factor unit tests | 84 | Each factor's curve at boundary and interior points |
| Scoring determinism | 1 | Same input → byte-identical score and order, 10⁵ times |
| Tie-break stability | 1 | Identical riders always order by `rider_id` |
| Hard-filter completeness | 14 | Each filter excludes exactly what it should and nothing more |
| Wave sizing | 22 | Including the degenerate cases: 1 candidate, 0 candidates, all `p = 0`, all `p = 1` |
| Concurrency | 34 | Including a 50-way simultaneous claim producing exactly one winner, on both coordinator implementations |
| Cascade timing | 18 | Alarms fire at the right offsets; early termination on claim; no double-fire |
| Rejection paths | 20 | Every reason code, the no-alternative flow, cooldowns |
| Reassignment | 14 | Every trigger in §10 |
| Expansion ladder | 12 | Each step fires at the right time and does the right thing |
| **Benchmark** | 10 000 simulated order-days | Undal's policy beats nearest-rider on four metrics — [`30 §7`](30-testing-and-verification.md) |

### 12.1 What the benchmark reports

| Metric | Nearest-rider | Undal dispatch | Change |
| --- | --- | --- | --- |
| Mean time to assignment | 54 s | **41 s** | −24% |
| Mean rider wait at vendor | 6.8 min | **2.9 min** | −57% |
| Mean customer wait (accept → delivered) | 38.2 min | **31.6 min** | −17% |
| Deliveries per rider-hour | 2.31 | **2.74** | +19% |
| Rider earnings Gini | 0.41 | **0.19** | −54% |
| Offer acceptance rate | 0.58 | **0.76** | +31% |
| Orders with no rider found | 3.1% | **0.9%** | −71% |
| Batch rate | 0% | **22%** | — |

These figures are produced by `workers/brain/bench/dispatch_bench.py` from a synthetic generator
calibrated to Sylhet's road network, vendor distribution and demand profile. They are regenerated
on every change to the dispatch engine and published as a CI artifact, so the claim is checkable
rather than asserted.

---

## 13. Reading on

Next: [`12-batching-engine.md`](12-batching-engine.md) — carrying two orders at once.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
