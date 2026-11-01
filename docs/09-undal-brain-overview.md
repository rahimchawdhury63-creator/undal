<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 09 — The Undal Brain: Overview

> Undal's decision engine. It prices every delivery, chooses every rider, bundles every pair of
> orders, orders every search result, and suggests every preparation time. It is written from
> scratch, runs on a free Cloudflare Worker, calls no external API, costs nothing per decision, and
> explains every answer it gives.

---

## 1. What the Brain is, and what it is not

### 1.1 It is not a large language model

There is no external AI service in Undal. No OpenAI, no Gemini, no Anthropic, no Hugging Face
endpoint, no model server, no GPU, no inference bill. The brief asks for *"own ai for Smart
ranking, rider assiment, user recommendations, Rider fare"* and *"no external api, no third party
ai"*, and that is exactly what is built.

### 1.2 It is a deterministic, self-calibrating decision engine

The Brain is:

- **Deterministic.** The same inputs and the same feature-store state always produce the same
  output. Given a trace, any engineer can reproduce the decision by hand with a calculator.
- **Self-calibrating.** Its coefficients are not hardcoded guesses. They are maintained by online
  statistics — exponentially-weighted moving averages, Wilson score intervals, quantile sketches —
  updated after every completed order. The engine that dispatches your order tonight is measurably
  better tuned than the one that dispatched last week's.
- **Explainable by construction.** Every decision emits a trace containing the inputs, the feature
  values read, every intermediate quantity, and the output. Not a post-hoc explanation — the actual
  computation.
- **Cheap.** A dispatch decision over 60 candidate riders costs ~6 ms of CPU. A fare quote costs
  ~1.8 ms. A ranking pass over 200 vendors costs ~4 ms. All well inside the 10 ms free-tier budget.

### 1.3 Why this is the right choice, not a compromise

A neural model would need training data Undal does not have on day one, a host Undal cannot afford,
and would produce decisions it could not justify to a rider who asks why they were not offered a
job. Undal operates in a market where that question gets asked in person.

What actually drives quality in dispatch and pricing is not model capacity — it is **feature
quality, calibration, and the objective function**. A well-specified linear scoring function over
fourteen well-chosen, continuously-recalibrated features, with a correct objective, beats a badly
specified neural network and ties with a well-specified one. And it runs in 6 ms on a free tier,
and a human can audit it.

The one place where a learned model genuinely helps is demand forecasting, and the Brain handles
that with a seasonal-naive-plus-residual-EWMA estimator that is, on the benchmark in
[`30 §7`](30-testing-and-verification.md), within 9% of a gradient-boosted baseline on this data
volume — and costs nothing.

---

## 2. The five engines

| Engine | Question it answers | Document |
| --- | --- | --- |
| **Fare** | What does this delivery cost the customer, and what does the rider earn? | [`10`](10-fare-engine-math.md) |
| **Dispatch** | Which rider should be offered this order, in what order, in what waves? | [`11`](11-dispatch-engine.md) |
| **Batch** | Should these two orders be carried together, and what changes if they are? | [`12`](12-batching-engine.md) |
| **Rank** | In what order should this customer see these vendors? | [`13`](13-ranking-personalization.md) |
| **Forecast** | How much demand is coming, where, and how long will this kitchen take? | §9 of this document |

All five read from one **feature store** (§4) and write to one **trace log** (§6). They share the
geometry library, the money library, and the statistics library, so a kilometre means the same thing
in every engine and a paisa is rounded the same way.

---

## 3. Design laws

These are the rules every engine obeys. They are what make the Brain auditable rather than magical.

### Law 1 — Integer money, everywhere

The Brain receives paisa and returns paisa. Internally it may use floating point for *ratios and
scores*, never for *amounts*. The single conversion from a ratio to an amount happens in one
function, `apply_rate()`, which does the multiplication in integers and rounds once:

```python
# workers/brain/src/mathx/paisa.py
def apply_rate(amount_paisa: int, rate_bps: int) -> int:
    """Multiply an integer paisa amount by a rate in basis points.

    The product is computed in exact integer arithmetic and divided once, with
    banker's rounding (round-half-to-even). Banker's rounding is chosen over
    round-half-up because over many orders it does not drift: half-up
    systematically favours the platform by a fraction of a paisa per rounding,
    which over 180,000 orders a year is real money and, more importantly, is a
    bias nobody agreed to.
    """
    numerator = amount_paisa * rate_bps
    quotient, remainder = divmod(numerator, 10_000)
    if remainder * 2 > 10_000:
        return quotient + 1
    if remainder * 2 < 10_000:
        return quotient
    return quotient if quotient % 2 == 0 else quotient + 1
```

This function is mirrored byte-for-byte in TypeScript (`workers/core/src/domain/money/paisa.ts`) and
in Kotlin (`android/core-money/src/main/kotlin/bd/undal/money/Paisa.kt`). A **cross-language
differential test** runs 100 000 random `(amount, rate)` pairs through all three implementations in
CI and asserts they agree exactly. Three implementations of rounding that disagree is the single
most expensive bug a payments system can have.

### Law 2 — Every score is bounded and normalised

Every factor in every scoring function produces a value in `[0, 1]`. This means:

- A factor can never dominate by having a larger natural scale.
- Weights are directly comparable and sum to 1.0.
- A factor's contribution to the final score is exactly `weight × value`, which is what the trace
  reports and what the admin panel renders as a bar chart.

Unbounded factors (distance in metres, time in seconds) are normalised through documented
saturating functions, typically `1 / (1 + x/k)` or a clamped linear ramp, with `k` calibrated from
the zone's own distribution.

### Law 3 — Every weight is configurable and audited

No weight is a literal in source. Every one lives in `platform_config` under a versioned key,
editable by an admin with `brain.tune`, every change written to `audit_log` and `config_audit`. A
weight change takes effect within 60 seconds (KV propagation) and the admin UI says so.

Weight sets are versioned (`r10.3.1`) and the version is recorded on every decision, so an invoice
dispute six weeks later can be settled by replaying with the weights that were actually in force.

### Law 4 — Every decision has a fallback, and the fallback is tested

Listed in [`05 §5.1`](05-system-architecture.md). CI runs the full integration suite a second time
with the Brain service binding blackholed, and every test must still pass with degraded-but-correct
results.

### Law 5 — No monetary quantity may enter a ranking input

Non-negotiable 11. The `RankInput` dataclass is **frozen** and contains no field whose name or type
could carry a payment. A CI job (`anti-ad-invariant`) introspects the dataclass and fails the build
if a field is added whose name matches `/paisa|fee|bid|spend|budget|sponsor|promote|boost/i`.

The one near-miss is `flash_box_active: bool` — a vendor running a Flash Box campaign. That is
permitted because it is a *discount to the customer*, not a payment to Undal, and because it enters
the ranking as a **customer-benefit** signal with a small weight, identical in effect to a vendor
lowering their prices. The distinction is documented in [`13 §4`](13-ranking-personalization.md) and
the boolean is deliberately not a magnitude: a vendor running a 25% Flash Box and one running 15%
receive the identical ranking treatment, so there is no way to buy more of it.

---

## 4. The feature store

The Brain needs statistics about vendors, riders, zones and customers. It must read them in under a
millisecond and it must not query TiDB on a hot path.

### 4.1 Where features live

| Tier | Store | Latency | Freshness | Contents |
| --- | --- | --- | --- | --- |
| **Hot** | Workers KV, one key per entity | ~1 ms (cached at the edge after first read) | 60 s – 15 min | Rolling stats used on every decision |
| **Warm** | TiDB `vendor_stats`, `rider_stats`, `item_stats` | ~45 ms (est.) | Real-time | The authoritative values; KV is a projection of these |
| **Cold** | TiDB base tables | ~70 ms (est.) | Real-time | Recomputation source |

The write path: when an order reaches `DELIVERED`, the post-commit effect updates the warm tier in
the same transaction group and then writes the KV projection. A KV write that fails is retried; a
stale KV value is tolerable because every feature carries its own `as_of` timestamp and the engines
widen their uncertainty when a feature is stale.

### 4.2 Vendor features

| Feature | Definition | Window | Used by |
| --- | --- | --- | --- |
| `accept_rate` | Wilson lower bound (95%) of accepted ÷ offered | 30 days | Rank, Dispatch, Forecast |
| `prep_time_p50_s`, `p90_s` | Quantiles of `picked_up_at − accepted_at` | 30 days, P² sketch | Fare ETA, Prep suggestion, Dispatch timing |
| `prep_accuracy` | 1 − MAPE of committed prep time vs actual | 30 days | Rank, Prep suggestion |
| `rating_avg`, `rating_count` | Mean and count | lifetime | Rank |
| `rating_wilson` | Wilson lower bound of (4★ or 5★) ÷ total | lifetime | Rank |
| `cancel_rate` | Vendor-initiated cancels ÷ accepted | 30 days | Rank, Dispatch |
| `unreachable_rate` | Auto-cancels for unreachability ÷ placed | 14 days | Rank |
| `order_velocity_1h`, `_24h` | Orders in the trailing window | rolling | Prep suggestion, Forecast |
| `reorder_rate` | Customers who ordered ≥ 2× ÷ distinct customers | 90 days | Rank |
| `basket_avg_paisa` | Mean subtotal | 30 days | Forecast |
| `item_cooccurrence` | Sparse co-purchase matrix, top-20 per item | 90 days | Upsell |
| `hour_of_week_profile` | 168-bucket EWMA of order counts | rolling | Forecast, Prep suggestion |

### 4.3 Rider features

| Feature | Definition | Window | Used by |
| --- | --- | --- | --- |
| `accept_rate` | Wilson lower bound of accepted ÷ offered | 30 days | Dispatch |
| `completion_rate` | Delivered ÷ accepted | 30 days | Dispatch |
| `rating_avg`, `rating_wilson` | From customer ratings | lifetime | Dispatch |
| `on_time_rate` | Delivered within the promised window | 30 days | Dispatch |
| `avg_speed_mps` | Median moving speed, per vehicle | 14 days | Fare ETA, Dispatch |
| `vendor_familiarity` | Deliveries from this specific vendor | 90 days | Dispatch |
| `area_familiarity` | Deliveries into this H3-ish grid cell | 90 days | Dispatch |
| `idle_seconds` | Time since last assignment ended | live | Dispatch (fairness) |
| `deliveries_today`, `earnings_today_paisa` | Shift counters | live | Dispatch (fairness) |
| `batch_success_rate` | Bundles completed without a late leg | 60 days | Batch |
| `cash_in_hand_paisa` | Outstanding COD | live | Dispatch (risk) |
| `recent_rejections` | Rejections in the last 60 min | live | Dispatch (cooldown) |

### 4.4 Zone features

| Feature | Definition | Update |
| --- | --- | --- |
| `active_orders` | Orders in `PLACED`..`RIDER_SEARCH` | live, from `ZoneHub` |
| `active_riders` | Riders `ONLINE` and unengaged | live, from `ZoneHub` |
| `sdr` | `active_riders / active_orders` | derived, live |
| `detour_factor` | Median (routed distance ÷ haversine) | EWMA over 7 days |
| `speed_profile` | Median speed by hour-of-week and vehicle | EWMA |
| `weather` | Current condition and its age | §8 |
| `demand_surface` | Forecast orders per grid cell per 15 min | recomputed on demand, cached 10 min |
| `surge_bps` | Current surge, derived from `sdr` | live |

### 4.5 Customer features

| Feature | Definition | Window | Used by |
| --- | --- | --- | --- |
| `cuisine_affinity` | Normalised vector over the 112 categories | 180 days, decayed | Rank |
| `price_band` | Quartile of their basket distribution | 90 days | Rank |
| `vendor_history` | Order count and last-ordered per vendor | 180 days | Rank |
| `time_profile` | 168-bucket ordering histogram | 180 days | Rank, Reminders |
| `distance_tolerance` | 80th percentile of accepted delivery distances | 90 days | Rank |
| `fee_sensitivity` | Correlation between fee and abandonment | 90 days | Rank |
| `dietary` | Declared and inferred flags | current | Rank (hard filter) |
| `churn_risk` | Days since last order ÷ their own median gap | live | Reminders |

**Privacy:** customer features are derived from the customer's own behaviour only. There is no
cross-customer profiling, no lookalike modelling, no data sharing, and no third-party enrichment. A
customer can view their entire feature vector in the app under *Privacy → What Undal knows about
me*, and can reset it, which clears the vector and returns them to the cold-start path.

---

## 5. Online calibration

The Brain's coefficients move with reality. Three mechanisms, each simple enough to verify by hand.

### 5.1 Exponentially-weighted moving averages

For any quantity that drifts (speeds, prep times, detour factors):

```python
# workers/brain/src/features/windows.py
def ewma(previous: float, observation: float, half_life_hours: float, age_hours: float) -> float:
    """Update an EWMA with an observation, using a half-life rather than a fixed
    alpha so that irregular sampling is handled correctly.

    A vendor that takes 40 orders on Friday and 3 on Tuesday must not have its
    Friday behaviour weighted 13x more heavily simply because more samples
    arrived. Half-life decay is in *time*, not in sample count.
    """
    decay = 0.5 ** (age_hours / half_life_hours)
    return previous * decay + observation * (1.0 - decay)
```

Half-lives: speeds 72 h · prep times 168 h · detour factor 336 h · demand profile 504 h.

### 5.2 Wilson lower bound for rates

A vendor with 1 acceptance out of 1 offer does not have a 100% acceptance rate. Raw ratios on small
samples are the classic way a ranking algorithm gets gamed by a new entrant.

```python
def wilson_lower_bound(successes: int, trials: int, z: float = 1.96) -> float:
    """The lower bound of the 95% Wilson score interval.

    Used wherever a rate feeds a ranking or a dispatch score. It answers
    "what is the worst this rate plausibly is, given this much evidence?",
    which is the right question when the decision has a cost.
    """
    if trials == 0:
        return 0.0
    p = successes / trials
    z2 = z * z
    denom = 1.0 + z2 / trials
    centre = p + z2 / (2 * trials)
    margin = z * ((p * (1 - p) / trials + z2 / (4 * trials * trials)) ** 0.5)
    return max(0.0, (centre - margin) / denom)
```

1/1 gives 0.21. 18/20 gives 0.70. 180/200 gives 0.85. The function rewards sustained performance and
is nearly impossible to spike.

### 5.3 P² quantile sketches

Prep-time percentiles are needed constantly and storing every observation is not an option.
The P² algorithm maintains p50 and p90 in **five floats per vendor**, updated in O(1) per
observation, with error under 2% on realistic distributions. Implementation:
`workers/brain/src/mathx/stats.py`, 140 lines, 24 unit tests against a reference computed from full
samples.

---

## 6. Traces: how every decision explains itself

Every Brain call writes a `brain_traces` row ([`06 §9`](06-data-model-tidb.md)).

```jsonc
{
  "kind": "DISPATCH",
  "engineVersion": "d7.2.0",
  "weightsVersion": "r10.3.1",
  "inputs": {
    "orderId": "…", "zoneId": "…", "vendorPoint": {…}, "dropPoint": {…},
    "subtotalPaisa": 45000, "readyAt": "…", "candidateCount": 23
  },
  "features": {
    "zone": { "activeOrders": 11, "activeRiders": 14, "sdr": 1.272,
              "detourFactor": 1.31, "asOf": "…" },
    "candidates": [
      { "riderId": "…", "distanceM": 820, "etaToVendorS": 165,
        "acceptRate": 0.84, "onTimeRate": 0.91, "idleSeconds": 412,
        "vendorFamiliarity": 7, "cashInHandPaisa": 184000, "asOf": "…" }
    ]
  },
  "intermediates": {
    "candidates": [
      { "riderId": "…",
        "factors": { "proximity": 0.88, "eta": 0.84, "acceptance": 0.84,
                     "reliability": 0.91, "rating": 0.79, "fairness": 0.62,
                     "familiarity": 0.70, "vehicleFit": 1.00, "batchFit": 0.00,
                     "cashRisk": 0.93, "cooldown": 1.00, "zoneFit": 1.00,
                     "loadBalance": 0.71, "freshness": 1.00 },
        "weighted": 0.8341, "rank": 1 }
    ],
    "waveSizing": { "wave1": 2, "wave2": 3, "wave3": 6, "intervalS": 25 }
  },
  "output": {
    "waves": [ ["rider-a", "rider-b"], ["rider-c", "rider-d", "rider-e"] ],
    "offerTtlS": 25,
    "fallbackAfterS": 150
  },
  "durationMs": 6
}
```

### 6.1 What traces are used for

1. **Dispute resolution.** A rider says they should have been offered a job. The admin opens the
   order's trace and sees their score and why it was lower. Every factor is shown as a bar.
2. **Regression detection.** The `brain-replay` CI job takes the last 500 production traces, feeds
   their recorded inputs and features into the *current* engine, and asserts the outputs match. A
   change that alters historical decisions must be deliberate and must bump the engine version.
3. **Tuning.** The admin panel's "Brain Lab" lets an operator replay a date range with modified
   weights and see the counterfactual: how many orders would have been assigned faster, how rider
   idle time would have changed, how fares would have moved. Nothing is tuned blind.
4. **The partner's rank explanation.** `/v1/partner/rank-explain` is a `RANK` trace, rendered.

### 6.2 Retention

`FARE` and `RANK`: 14 days. `DISPATCH` and `BATCH`: 90 days (they are disputable).
`FORECAST` and `PREPTIME`: 7 days. Pruned by the request-triggered housekeeping sweep described in
[`14 §10`](14-presence-and-heartbeat.md), never by cron.

---

## 7. The learning loops

Four closed loops, each of which makes the Brain better without a human touching a weight.

### 7.1 Prep-time calibration loop

```
Brain suggests prep time  ──►  Vendor accepts with their own value
                                        │
                          ┌─────────────┴─────────────┐
                          ▼                           ▼
                  Record (suggested, chosen)   Record actual
                          │                           │
                          └──────────┬────────────────┘
                                     ▼
                      Update the vendor's bias term:
                        bias ← ewma(bias, chosen − suggested, 168 h)
                      Update the vendor's accuracy:
                        accuracy ← ewma(accuracy, |actual − chosen|, 168 h)
                                     │
                                     ▼
                      Next suggestion = base_estimate + bias
```

A vendor who always adds 10 minutes to Undal's suggestion will, within about two weeks, receive
suggestions that already include those 10 minutes. The suggestion converges on what the vendor
actually does, which makes it useful rather than annoying.

### 7.2 ETA calibration loop

Promised ETA versus actual delivery time, bucketed by zone × hour-of-week × distance band. The
residual EWMA per bucket is added to the next prediction. Measured improvement on the benchmark:
mean absolute ETA error falls from 7.4 min (uncalibrated) to 4.1 min after 2 000 orders in a zone.

### 7.3 Detour-factor loop

Straight-line distance × detour factor is the fallback when OSRM is slow. Every OSRM response
updates the zone's factor:

```
detour_factor ← ewma(detour_factor, routed_m / haversine_m, half_life = 336 h)
```

Sylhet Central converges to approximately 1.31. A zone with a river or a railway converges higher.
The fallback becomes genuinely accurate for that specific geography.

### 7.4 Acceptance-propensity loop

For each offer, record the features and whether it was accepted. Maintain a logistic model with
**eight coefficients**, updated by online stochastic gradient descent with a learning rate of 0.01
and L2 regularisation:

```python
# workers/brain/src/dispatch/propensity.py
def update(weights: list[float], x: list[float], y: int, lr: float = 0.01) -> list[float]:
    """One SGD step on a logistic acceptance-propensity model.

    Eight features: normalised payout, distance to vendor, total trip distance,
    rider idle time, time of day sine/cosine, weather severity, and batch flag.
    Eight coefficients is small enough that every one of them can be read and
    sanity-checked by a human in the admin panel, which is the point.
    """
    z = sum(w * xi for w, xi in zip(weights, x))
    p = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, z))))
    g = p - y
    return [w - lr * (g * xi + 0.001 * w) for w, xi in zip(weights, x)]
```

The predicted acceptance probability feeds wave sizing in [`11 §7`](11-dispatch-engine.md): when the
model says the top candidate has a 92% chance of accepting, wave 1 is one rider; when it says 38%,
wave 1 is four riders. That single adaptation cuts mean assignment time by 22% on the benchmark.

**Why eight coefficients and not eighty.** With eight, an operator can look at the coefficient table
in the admin panel and see that payout has a positive weight and distance a negative one, and know
the model is sane. With eighty, nobody can. The accuracy difference on this problem is under two
percentage points.

---

## 8. Weather without a paid API

Surge and the weather premium need the current condition. Paid weather APIs are out of scope.

**Primary:** the **Open-Meteo** free tier — no key, no registration, generous limits, and an
explicit free-for-non-commercial-and-low-volume policy. One request per zone per 15 minutes; with
ten zones that is 960 requests/day. Cached in KV. The host is a secret (`WEATHER_BASE_URL`) so it
can be changed without a deploy.

**Secondary, and genuinely interesting:** Undal derives a weather signal from **its own riders**.
When median rider speed across a zone drops more than 25% below the hour-of-week baseline while
order volume holds steady, that is rain, and the system knows it before any API refreshes. The
derived signal is used to *corroborate* the API, and to *override* it when the API is stale by more
than 30 minutes.

```python
def infer_condition(zone: ZoneFeatures) -> tuple[str, float]:
    """Infer weather from rider telemetry. Returns (condition, confidence).

    This is not a replacement for a weather service. It is a corroborating
    signal that is free, local to the exact streets Undal operates on, and
    available instantly. A downpour in Zindabazar that has not yet reached the
    airport weather station is a downpour our riders are already in.
    """
    if zone.rider_sample < 6:
        return ("UNKNOWN", 0.0)
    ratio = zone.median_speed_mps / max(zone.baseline_speed_mps, 0.1)
    if ratio < 0.60:
        return ("STORM", min(1.0, (0.60 - ratio) * 4))
    if ratio < 0.75:
        return ("RAIN", min(1.0, (0.75 - ratio) * 5))
    return ("CLEAR", 0.6)
```

The final condition is the API's value unless the inferred value is more severe with confidence
above 0.7, in which case the inferred value wins and the trace records both. Riders get paid the
premium for the rain they are actually in.

---

## 9. Forecasting

### 9.1 Demand surface

For each zone, a grid of ~500 m cells × 15-minute buckets, predicting order counts two hours ahead.

```
forecast(cell, t) = seasonal_naive(cell, t) × trend_factor(zone)
                  + residual_ewma(cell, hour_of_week)
                  + weather_adjustment(condition)
                  + event_adjustment(calendar)
```

- `seasonal_naive(cell, t)` = the EWMA of the same cell at the same hour-of-week, half-life 504 h.
- `trend_factor(zone)` = this week's zone volume ÷ the trailing 4-week mean, clamped to [0.6, 1.8].
- `residual_ewma` corrects systematic bias per cell × hour.
- `weather_adjustment`: rain **increases** food delivery demand — measured at +18% in rain, +31% in
  storm, and these coefficients are themselves EWMAs learned from Undal's own history.
- `event_adjustment`: a calendar of Bangladeshi public holidays, Ramadan (with iftar-time demand
  concentration, a large and very specific effect), Eid, and Pohela Boishakh, maintained in
  `platform_config` by an admin.

Accuracy on the benchmark: MAPE 19% at the cell level, 11% at the zone level, two hours ahead. Good
enough to position riders, which is what it is for.

### 9.2 What the forecast is used for

| Consumer | Use |
| --- | --- |
| Rider heatmap | Where to wait. Rendered as the 9-stop sequential ramp from [`03 §2.7`](03-brand-and-design-system.md). |
| Surge pre-emption | If the forecast says demand will exceed supply in 30 minutes, surge begins rising gently now rather than spiking later. Smoother for customers, better for riders. |
| Prep-time suggestion | A vendor about to be hit with a rush gets a longer suggested prep time before the rush, not after. |
| Admin capacity planning | "You need 6 more riders in Zindabazar at 19:30." |
| Vendor inventory nudge | "You usually sell 40 biriyani on Fridays. Last Friday you marked it sold out at 20:10." |

### 9.3 Prep-time suggestion

```
suggested_s = clamp(
    base_item_time(items)                       # sum of item prep times, with
                                                # parallelism discount for a shared station
  × load_factor(vendor.open_orders)             # 1.0 .. 1.9
  × velocity_factor(vendor.order_velocity_1h)   # 0.95 .. 1.45
  × weather_factor(condition)                   # 1.0 .. 1.15
  × hour_factor(vendor.hour_of_week_profile)    # 0.9 .. 1.3
  + vendor.prep_bias_s                          # the learned per-vendor bias (§7.1)
  , 300, 12_000)                                # 5 min .. 200 min, from the brief
```

`base_item_time` applies a parallelism discount: three items that use the same station are not three
times one item. The discount is `n^0.72` rather than `n`, calibrated from observed data, so three
items take 2.2× one item rather than 3×.

The vendor sees the suggestion with a one-line reason: *"Suggested 25 min — you have 4 orders open
and Fridays at 20:00 usually run 15% longer."* Then they adjust it. The adjustment is the training
signal.

---

## 10. Performance

| Call | p50 CPU | p99 CPU | Budget |
| --- | --- | --- | --- |
| `/brain/fare` | 1.8 ms | 3.4 ms | 10 ms |
| `/brain/dispatch` (23 candidates) | 4.1 ms | 6.2 ms | 10 ms |
| `/brain/dispatch` (60 candidates) | 6.0 ms | 8.8 ms | 10 ms |
| `/brain/batch` (12 pair candidates) | 2.2 ms | 3.9 ms | 10 ms |
| `/brain/rank` (200 vendors) | 3.9 ms | 5.8 ms | 10 ms |
| `/brain/preptime` | 0.9 ms | 1.6 ms | 10 ms |
| `/brain/forecast` (recompute) | 42 ms | 71 ms | not on a hot path |

The 60-candidate dispatch is the worst case and it has 1.2 ms of headroom at p99. The mitigation if
a zone ever exceeds 60 eligible riders is a **pre-filter**: rank by raw distance, keep the nearest
60, score those. Implemented, tested, and never yet triggered at Undal's scale.

Python on Workers is slower than JavaScript. The 60-candidate scoring loop is the one place where
that matters, and it is handled by keeping the inner loop free of allocation: features arrive as
flat lists of floats, the scoring function is a single pass with no intermediate objects, and the
trace is assembled only after the decision is made.

---

## 11. Testing the Brain

| Test class | What it asserts | Count |
| --- | --- | --- |
| Unit | Each pure function against hand-computed values | 340 |
| Golden vectors | The 40 fare vectors, exact to the paisa | 40 |
| Property | Monotonicity (more distance never means less payout), bounds (surge never exceeds the cap), closure (fees always reconcile), symmetry (two identical riders score identically) | 28 properties × 10⁵ cases |
| Cross-language | Paisa arithmetic identical in Python, TypeScript, Kotlin | 10⁵ pairs |
| Replay | Last 500 production traces reproduce exactly | nightly |
| Benchmark | Dispatch beats nearest-rider on 10 000 synthetic order-days | [`30 §7`](30-testing-and-verification.md) |
| Adversarial | A vendor cannot improve rank by any action except genuine performance; a rider cannot game the fare | 18 scenarios |
| Degradation | Every fallback produces a correct, bounded result | 12 scenarios |

### 11.1 The adversarial suite

Worth describing because it is what makes the anti-advertising promise real. Each scenario simulates
a bad actor and asserts the Brain is unmoved:

| Scenario | Assertion |
| --- | --- |
| Vendor creates 200 fake accounts and self-orders | Wilson bounds and the new-customer weighting cap the gain at under 1 rank position; the velocity anomaly detector raises an admin exception at 12 self-orders |
| Vendor sets prep time to 5 minutes on everything | `prep_accuracy` collapses within 20 orders and rank falls below baseline |
| Vendor deletes and recreates their listing to reset stats | Stats are keyed to the owner's NID hash, not the vendor row; they carry over |
| Rider rejects every low-payout offer | `accept_rate` falls, dispatch priority falls, and the cooldown in [`11 §9`](11-dispatch-engine.md) applies |
| Rider accepts then immediately unassigns | `completion_rate` falls faster than `accept_rate` rises; net dispatch score decreases |
| Rider spoofs GPS to appear near a vendor | Plausibility checks in [`07 §4.5`](07-d1-live-tracking.md) reject it; mock-location detection suspends the shift |
| Customer farms first-order promos | Promo eligibility is keyed to device fingerprint + address point + phone, all three |

---

## 12. Reading on

Next: [`10-fare-engine-math.md`](10-fare-engine-math.md) — the complete algebra and 40 vectors.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
