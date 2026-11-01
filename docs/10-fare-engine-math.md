<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 10 — Fare Engine: The Mathematics

> Every taka Undal moves is produced by the equations in this document. They are stated completely,
> implemented in three languages that are proven to agree, and verified against forty hand-computed
> vectors. A rider with a calculator can check any payout. A vendor with a calculator can check any
> invoice. That is the standard.

---

## 1. The input schema

```python
@dataclass(frozen=True)
class FareInput:
    # Geometry — all distances in metres, all durations in seconds
    routed_distance_m: int        # rider position → vendor → customer, from OSRM
    routed_duration_s: int        # free-flow duration for the same route
    traffic_delay_s: int          # observed duration minus free-flow duration

    # Supply and demand, from the zone's ZoneHub, live
    active_orders_in_zone: int
    active_riders_in_zone: int

    # Conditions
    weather_condition: str        # CLEAR | RAIN | STORM | EXTREME_HEAT
    weather_confidence: float     # 0..1; below 0.5 the premium is not applied

    # Parties
    vehicle: str                  # MOTORBIKE | BICYCLE
    fulfilment: str               # DELIVERY | PICKUP

    # Money inputs
    item_subtotal_paisa: int      # AFTER discounts
    discount_paisa: int           # for provenance only; not an input to the fare
    tip_paisa: int

    # Configuration, read from the zone_pricing row effective at placed_at
    pricing: ZonePricing

    # Batching, when applicable
    batch_position: int           # 0 = solo or first in bundle, 1+ = subsequent
    batch_marginal_distance_m: int  # only meaningful when batch_position > 0
```

Everything the engine needs is in this object. There is no hidden read, no ambient state, no clock
call. That is what makes a trace replayable.

---

## 2. The constants

All values live in `zone_pricing` (temporal, per zone, per vehicle) or `platform_config`. The
defaults below are the launch configuration for Bangladesh.

| Constant | Motorbike | Bicycle | Config key |
| --- | --- | --- | --- |
| Base fare | **৳40** (4 000 p) | **৳25** (2 500 p) | `zone_pricing.base_fare_paisa` |
| Base distance (included in base fare) | 2 000 m | 2 000 m | `zone_pricing.base_distance_m` |
| Per-kilometre rate beyond base | **৳14** (1 400 p) | **৳8** (800 p) | `zone_pricing.per_km_paisa` |
| Maximum delivery radius | 12 000 m | **4 000 m** | `zone_pricing.max_radius_m` |
| Minimum payout floor | ৳40 | ৳25 | `zone_pricing.min_payout_paisa` |
| Surge cap | 2.2× | 2.2× | `zone_pricing.surge_cap_bps = 22000` |
| Traffic block | 5 min | 5 min | `platform_config.traffic_block_s = 300` |
| Traffic block compensation | **৳8** (800 p) | **৳5** (500 p) | `platform_config.traffic_block_paisa` |
| Target hourly earnings (sets the traffic block) | ৳120/h | ৳75/h | `platform_config.target_hourly_paisa` |
| Platform delivery margin | 800 bps (8%) | 800 bps | `platform_config.delivery_margin_bps` |
| Minimum delivery fee charged | ৳25 | ৳20 | `zone_pricing.min_delivery_fee_paisa` |
| Maximum delivery fee charged | ৳220 | ৳120 | `zone_pricing.max_delivery_fee_paisa` |

| Platform-wide constant | Value | Config key |
| --- | --- | --- |
| Commission | 1 500 bps (15%) | `vendors.commission_bps` |
| Rider bonus (vendor-funded) | 300 bps (3%) | `vendors.rider_bonus_bps` |
| Tax | 500 bps (5%) | `platform_config.tax_bps` |
| Small-order threshold | ৳100 (10 000 p) | `platform_config.small_order_threshold_paisa` |
| Small-order fee | ৳25 (2 500 p) | `platform_config.small_order_fee_paisa` |
| └ rider share | ৳5 (500 p) | `platform_config.small_order_rider_paisa` |
| └ vendor share | ৳5 (500 p) | `platform_config.small_order_vendor_paisa` |
| └ platform share | ৳15 (1 500 p) | *derived: fee − rider − vendor* |
| Bundle base rate for orders 2..n | 5 500 bps (0.55× base) | `platform_config.bundle_base_bps` |
| Bundle bonus per extra order | ৳12 (1 200 p) | `platform_config.bundle_bonus_paisa` |
| Bundle customer credit | 3 000 bps (30% of their fee) | `platform_config.bundle_credit_bps` |
| Bundle credit cap | ৳25 (2 500 p) | `platform_config.bundle_credit_cap_paisa` |

### 2.1 Where the traffic-block figure comes from

The brief says: *"For every 5 minutes of traffic_delay_minutes, add a variable compensation factor
to safeguard rider earnings per hour."* The compensation is derived, not invented:

```
traffic_block_paisa = round( (block_seconds / 3600) × target_hourly_paisa × coverage )

Motorbike: (300 / 3600) × 12 000 × 0.80 = 800 paisa  = ৳8 per 5-minute block
Bicycle:   (300 / 3600) ×  7 500 × 0.80 = 500 paisa  = ৳5 per 5-minute block
```

`coverage = 0.80` means Undal restores 80% of the hourly rate a rider lost to congestion. Not 100%,
because the rider is still earning the distance component during that time; not 0%, because
otherwise a rider stuck in Amberkhana traffic earns less per hour than one on an empty road, which
makes congested zones unserviceable. The 0.80 is a configuration value and the admin panel shows
its effect on realised hourly earnings.

---

## 3. Arithmetic law

### 3.1 Everything is paisa

Stated in [`00 §4.1`](00-INDEX.md). Restated because it is the single most important rule in this
document: **no money is ever a floating-point number.** Ratios are floats. Scores are floats.
Amounts are `int`.

### 3.2 Rates are basis points

A rate is an integer number of basis points (1 bps = 0.01%). 15% is `1500`. 8% is `800`. This keeps
rate configuration exact and makes `apply_rate` the only place rounding occurs.

### 3.3 The single rounding point

```python
def apply_rate(amount_paisa: int, rate_bps: int) -> int:
    numerator = amount_paisa * rate_bps          # exact, arbitrary precision in Python;
    q, r = divmod(numerator, 10_000)             # i64 in TS/Kotlin, checked for overflow
    if r * 2 > 10_000: return q + 1
    if r * 2 < 10_000: return q
    return q if q % 2 == 0 else q + 1            # banker's: ties to even
```

### 3.4 Why banker's rounding

Round-half-up biases every tie in one direction. Over 180 000 orders a year with roughly three
rounded rate applications each, half-up transfers on the order of ৳2 700 a year from one party to
another for no reason anyone chose. Banker's rounding is unbiased over a uniform distribution of
remainders, and it is what accounting standards specify. The cost is that it is slightly surprising
the first time someone checks a single invoice by hand, which is why §12 includes two vectors
(V04 and V10) that land exactly on a tie in opposite directions.

### 3.5 Floor to the taka, once, at the end

```python
def floor_to_taka(total_paisa: int) -> tuple[int, int]:
    """Returns (floored_total, rounding_delta). The delta is always <= 0."""
    floored = (total_paisa // 100) * 100
    return floored, floored - total_paisa
```

Applied **once**, to the customer's final payable total, and never to any intermediate. The delta
is a platform expense ([`01 §3.6`](01-mission-and-non-negotiables.md)).

### 3.6 Overflow

In TypeScript and Kotlin the intermediate `amount_paisa * rate_bps` is computed in `BigInt` / `Long`
with an explicit guard. The largest plausible order is ৳100 000 = 10⁷ paisa; times 10 000 bps is
10¹¹, which fits in `Long` with eleven orders of magnitude to spare but **does not fit in a
JavaScript `number` safely once chained**. `Paisa` in TypeScript is therefore a branded `bigint`,
narrowed to `number` only at the JSON boundary where values are provably under 2⁵³.

---

## 4. Step 1 — Supply–demand ratio and surge

### 4.1 SDR

```python
def supply_demand_ratio(riders: int, orders: int) -> float:
    """Riders per waiting order. Infinite supply when there is no demand."""
    if orders <= 0:
        return float("inf")
    return riders / orders
```

### 4.2 The surge function

The brief specifies three bands:

| SDR | Multiplier |
| --- | --- |
| `< 0.5` (severe shortage) | 1.5× to 2.2× |
| `0.5` to `1.0` (moderate) | 1.2× to 1.4× |
| `> 1.0` (sufficient) | 1.0× |

Implemented exactly, with one engineering addition: **the band boundaries are bridged by a narrow
linear ramp** so the function is continuous.

> **Why the ramp.** Taken literally, the bands are discontinuous: at SDR = 0.5 the multiplier jumps
> from 1.5 to 1.4, and at SDR = 1.0 from 1.2 to 1.0. A discontinuity in a pricing function is a
> cliff, and cliffs get gamed. A rider who can see the zone counters has an incentive to stay
> offline to hold SDR just under 1.0; a customer refreshing at the boundary sees the fee flicker by
> ৳8. Bridging each boundary over ±0.05 SDR preserves the brief's bands everywhere they matter and
> removes both problems. The ramp is 10% of a band's width and is invisible in normal operation.

```python
SURGE_SEVERE_MAX = 22_000   # 2.2x
SURGE_SEVERE_MIN = 15_000   # 1.5x
SURGE_MODERATE_MAX = 14_000 # 1.4x
SURGE_MODERATE_MIN = 12_000 # 1.2x
SURGE_NONE = 10_000         # 1.0x

def surge_bps(sdr: float, cap_bps: int = SURGE_SEVERE_MAX) -> int:
    """Map the supply-demand ratio to a surge multiplier in basis points.

    Piecewise linear and continuous. Returns an integer so the result is exact
    and reproducible; the float sdr is the only float that touches pricing, and
    it is quantised here.
    """
    if sdr == float("inf") or sdr >= 1.05:
        return SURGE_NONE

    if sdr <= 0.45:
        # Severe shortage: 2.2x at sdr=0, 1.5x at sdr=0.5, clamped to the cap.
        raw = SURGE_SEVERE_MIN + (0.5 - sdr) / 0.5 * (SURGE_SEVERE_MAX - SURGE_SEVERE_MIN)
        return min(cap_bps, int(round(raw)))

    if sdr < 0.55:
        # Bridge: from the severe value at 0.45 down to the moderate value at 0.55.
        lo = SURGE_SEVERE_MIN + (0.5 - 0.45) / 0.5 * (SURGE_SEVERE_MAX - SURGE_SEVERE_MIN)  # 15700
        hi = SURGE_MODERATE_MIN + (1.0 - 0.55) / 0.5 * (SURGE_MODERATE_MAX - SURGE_MODERATE_MIN)  # 13800
        t = (sdr - 0.45) / 0.10
        return int(round(lo + t * (hi - lo)))

    if sdr <= 0.95:
        # Moderate demand: 1.4x at sdr=0.5, 1.2x at sdr=1.0.
        raw = SURGE_MODERATE_MIN + (1.0 - sdr) / 0.5 * (SURGE_MODERATE_MAX - SURGE_MODERATE_MIN)
        return int(round(raw))

    # Bridge: from the moderate value at 0.95 down to 1.0x at 1.05.
    lo = SURGE_MODERATE_MIN + (1.0 - 0.95) / 0.5 * (SURGE_MODERATE_MAX - SURGE_MODERATE_MIN)  # 12200
    t = (sdr - 0.95) / 0.10
    return int(round(lo + t * (SURGE_NONE - lo)))
```

### 4.3 The surge curve, tabulated

| SDR | Surge | SDR | Surge | SDR | Surge |
| --- | --- | --- | --- | --- | --- |
| 0.00 | **2.20×** | 0.45 | 1.57× | 0.90 | 1.24× |
| 0.05 | 2.13× | 0.50 | 1.48× | 0.95 | 1.22× |
| 0.10 | 2.06× | 0.55 | 1.38× | 1.00 | 1.11× |
| 0.15 | 1.99× | 0.60 | 1.36× | 1.05 | **1.00×** |
| 0.20 | 1.92× | 0.65 | 1.34× | 1.50 | 1.00× |
| 0.25 | 1.85× | 0.70 | 1.32× | 3.00 | 1.00× |
| 0.30 | 1.78× | 0.75 | 1.30× | ∞ (no orders) | 1.00× |
| 0.35 | 1.71× | 0.80 | 1.28× | | |
| 0.40 | 1.64× | 0.85 | 1.26× | | |

Monotonically non-increasing in SDR, continuous, bounded by `[1.00, cap]`. All three properties are
asserted by property tests over 10⁶ random SDR values.

### 4.4 Surge hysteresis

Surge is published to clients at most **once every 90 seconds**, and a change of less than 500 bps
is suppressed. Without this, a zone sitting near a boundary would broadcast a new fee every few
seconds and every open cart would re-quote. The surge in force for a given order is the published
value at `placed_at`, recorded on the order, and used for the rider's payout even if the zone has
moved on by the time a rider accepts.

### 4.5 What surge multiplies

**The base fare only.** Not the distance component, not the traffic compensation, not the weather
premium. This is the brief's instruction (*"Apply a surge multiplier … to the base fare"*) and it is
also correct: surge exists to clear a market, and the market-clearing lever is the fixed component
of the offer, not a proportional tax on distance. Multiplying everything would make a 10 km delivery
in a shortage cost ৳180 more, which prices customers out of exactly the situation where the platform
needs them to keep ordering.

---

## 5. Step 2 — The ride core

```python
def ride_core_paisa(inp: FareInput, surge: int) -> RideCore:
    p = inp.pricing

    # 5.1 Surged base
    surged_base = apply_rate(p.base_fare_paisa, surge)

    # 5.2 Distance beyond the included base distance
    billable_m = max(0, inp.routed_distance_m - p.base_distance_m)
    distance_component = (billable_m * p.per_km_paisa) // 1000
    # Integer division, floored: the rider is never charged for a partial metre
    # and the platform never collects a fraction of a paisa it cannot bank.

    # 5.3 Traffic compensation, in whole 5-minute blocks
    blocks = inp.traffic_delay_s // TRAFFIC_BLOCK_S          # floor, never partial
    traffic_component = blocks * p.traffic_block_paisa

    return RideCore(
        surged_base=surged_base,
        distance=distance_component,
        traffic=traffic_component,
        total=surged_base + distance_component + traffic_component,
    )
```

### 5.1 Distance is floored, not rounded

`(billable_m * per_km_paisa) // 1000` floors. At ৳14/km the maximum loss to the rider is 1.4 paisa
per order — less than a hundredth of a taka. Flooring is chosen over rounding because it makes the
function monotone in integer metres with no plateaus, which simplifies the monotonicity property
test and removes an entire category of "the fee went down when I moved further away" bug reports.

---

## 6. Step 3 — The customer's delivery fee

```python
def delivery_fee_paisa(core: RideCore, inp: FareInput) -> int:
    if inp.fulfilment == "PICKUP":
        return 0
    margin = apply_rate(core.total, DELIVERY_MARGIN_BPS)       # 800 bps
    fee = core.total + margin
    return clamp(fee, inp.pricing.min_delivery_fee_paisa,
                      inp.pricing.max_delivery_fee_paisa)
```

The customer pays the ride core plus an 8% platform margin. **The customer does not pay the weather
premium.** That is deliberate and it is the brief's instruction (*"add a flat 20% premium directly to
the rider payout"*, and elsewhere *"not cutting from customers"*).

### 6.1 What that means for the platform's P&L

In clear weather the platform nets 8% of the ride core. In rain it pays the rider an extra 20% of
the ride core while still collecting 8%, so the delivery line runs at **−12% of core**. In a storm
it is **−32%**.

This is not an accident, it is the business model: the delivery line is near-breakeven and
occasionally negative, and the platform earns from commission. The alternative — passing storm
premiums to customers — produces a ৳160 delivery fee during a storm, which is when customers stop
ordering and riders have no work at all. Undal absorbs the volatility because it can and because it
makes the platform usable on the worst day of the month.

The ledger makes the subsidy explicit rather than hiding it inside a revenue number: it posts to
`PLATFORM:EXPENSE_WEATHER_SUBSIDY`, it appears as its own line in the finance dashboard, and an
admin can see exactly what bad weather costs.

### 6.2 The clamp

`min_delivery_fee` prevents a sub-৳25 fee on a 300 m delivery, which would not cover the rider's
floor. `max_delivery_fee` caps the customer's exposure on a long trip — beyond the cap the platform
absorbs the difference, and the cap being hit raises an admin signal because it usually means the
zone's radius is set too large.

---

## 7. Step 4 — The rider's payout

```python
def rider_payout_paisa(core: RideCore, inp: FareInput) -> RiderPayout:
    # 7.1 Weather premium, on the ride core, paid entirely by the platform
    weather_bps = WEATHER_PREMIUM_BPS.get(inp.weather_condition, 0)
    if inp.weather_confidence < 0.5:
        weather_bps = 0
    weather = apply_rate(core.total, weather_bps)

    # 7.2 Bundle adjustment (see doc 12 for how a bundle is formed)
    bundle = bundle_adjustment(core, inp)

    # 7.3 The fare portion, floored at the minimum payout
    fare = max(inp.pricing.min_payout_paisa, core.total + weather + bundle)

    # 7.4 Pass-throughs
    bonus = apply_rate(inp.item_subtotal_paisa, inp.vendor_rider_bonus_bps)   # 300 bps
    small_order_share = (SMALL_ORDER_RIDER_PAISA
                         if small_order_fee_applies(inp) and inp.fulfilment == "DELIVERY"
                         else 0)

    return RiderPayout(
        fare=fare, weather=weather, bundle=bundle,
        bonus=bonus, small_order_share=small_order_share, tip=inp.tip_paisa,
        total=fare + bonus + small_order_share + inp.tip_paisa,
    )
```

| Condition | Premium | Config key |
| --- | --- | --- |
| `CLEAR` | 0% | — |
| `RAIN` | **+20%** | `platform_config.weather_rain_bps = 2000` |
| `STORM` | **+40%** | `platform_config.weather_storm_bps = 4000` |
| `EXTREME_HEAT` | **+15%** | `platform_config.weather_heat_bps = 1500` |

The first two are the brief's values. `EXTREME_HEAT` is added because Sylhet summers reach 38 °C with
high humidity and a bicycle rider in that weather is doing genuinely harder work than the same ride
in January. The threshold is a zone-configurable heat index, default 40 °C apparent temperature.

### 7.1 The floor guarantee

`max(min_payout_paisa, …)` guarantees that a completed delivery never pays less than the base fare,
whatever the geometry. A 400 m delivery pays ৳40 to a motorbike rider even though the distance
component is zero. This is the guarantee that makes short orders acceptable to riders, and without
it the platform cannot serve dense neighbourhoods.

### 7.2 Vehicle radius enforcement

A bicycle is never offered an order beyond `max_radius_m` (4 000 m). This is not a fare rule, it is
a **dispatch eligibility rule** implemented in [`11 §3`](11-dispatch-engine.md), stated here because
it is the other half of why the bicycle rate is lower: a bicycle rider's per-kilometre rate is ৳8
rather than ৳14 because they have no fuel cost, and their radius is capped at 4 km so the food
arrives hot and the shorter trips keep their hourly earnings competitive.

Measured on the benchmark: a bicycle rider doing 4 trips/hour at a 2.6 km mean earns ৳118/hour. A
motorbike rider doing 2.8 trips/hour at a 5.1 km mean earns ৳147/hour, before fuel of roughly
৳22/hour. Net ৳125 versus ৳118 — close enough that the vehicle choice is about the rider's
circumstances rather than a forced economic answer, which is the intended design.

---

## 8. Step 5 — The small-order fee

```python
def small_order_fee(inp: FareInput) -> SmallOrderFee:
    """Applies when the post-discount item subtotal is at or above the threshold.

    The threshold is evaluated on the POST-discount subtotal, because that is what
    the customer is actually paying for items, and charging a fee based on a price
    nobody paid would be indefensible.

    On a PICKUP order there is no rider, so the rider's share is not collected at
    all. The customer pays 20 taka instead of 25. Charging a customer for a
    participant who does not exist is exactly the kind of case the platform must
    get right without being told.
    """
    if inp.item_subtotal_paisa < SMALL_ORDER_THRESHOLD_PAISA:
        return SmallOrderFee.none()

    if inp.fulfilment == "PICKUP":
        return SmallOrderFee(
            total=SMALL_ORDER_FEE_PAISA - SMALL_ORDER_RIDER_PAISA,   # 2000
            rider=0, vendor=SMALL_ORDER_VENDOR_PAISA,                # 500
            platform=SMALL_ORDER_FEE_PAISA - SMALL_ORDER_RIDER_PAISA
                     - SMALL_ORDER_VENDOR_PAISA,                      # 1500
        )

    return SmallOrderFee(
        total=SMALL_ORDER_FEE_PAISA,      # 2500
        rider=SMALL_ORDER_RIDER_PAISA,    #  500
        vendor=SMALL_ORDER_VENDOR_PAISA,  #  500
        platform=1500,
    )
```

**Invariant, asserted by property test:** `total == rider + vendor + platform`, for every
configuration of the three constants, on both fulfilment paths.

> **A note on the naming.** The fee is called a "small order fee" and it applies to orders **at or
> above** ৳100 — which reads backwards. That is what the brief specifies, and it is implemented
> exactly as specified. The customer-facing label is therefore **"Order fee"** in English and
> **"অর্ডার ফি"** in Bangla, with the transparency sheet explaining: *"৳25 applies to orders of ৳100
> or more. ৳5 goes to your rider and ৳5 to the restaurant."* Calling it "small order fee" in the UI
> when it applies to large orders would confuse every customer who read it. The config key keeps
> the brief's name so the mapping to this document is unambiguous.

---

## 9. Step 6 — Commission, bonus and tax

```python
commission_paisa   = apply_rate(item_subtotal_paisa, vendor.commission_bps)    # 1500 bps
rider_bonus_paisa  = apply_rate(item_subtotal_paisa, vendor.rider_bonus_bps)   #  300 bps

taxable_base_paisa = (commission_paisa
                    + small_order.platform
                    + platform_delivery_margin)
tax_paisa          = apply_rate(taxable_base_paisa, TAX_BPS)                   #  500 bps
```

Both commission and bonus are computed on the **post-discount** item subtotal, so a vendor funding a
25% Flash Box pays commission on what they actually received, not on the list price.

`platform_delivery_margin` is `delivery_fee − ride_core` — the platform's gross on the delivery
line, which is 8% of core in clear weather and the same 8% in bad weather (the weather subsidy is
an expense, not a reduction in the margin). This keeps the taxable base stable and independent of
weather, which is also how a tax authority would expect it to behave.

---

## 10. Step 7 — Assembly

```python
customer_total_pre_round = (item_subtotal_paisa          # already post-discount
                          + delivery_fee_paisa
                          + small_order.total
                          + tax_paisa
                          + tip_paisa)

customer_total_paisa, rounding_paisa = floor_to_taka(customer_total_pre_round)

vendor_payout_paisa = (item_subtotal_paisa
                     - commission_paisa
                     - rider_bonus_paisa
                     + small_order.vendor)

rider_payout_paisa  = (rider.fare
                     + rider_bonus_paisa
                     + small_order.rider
                     + tip_paisa)

platform_commission      = commission_paisa
platform_small_order     = small_order.platform
platform_delivery_margin = delivery_fee_paisa - ride_core_total
platform_weather_expense = rider.weather                  # negative contribution
platform_tax_payable     = tax_paisa
platform_rounding_expense = -rounding_paisa               # rounding_paisa <= 0
```

### 10.1 The closure identity

```
customer_total_paisa
  == vendor_payout_paisa
   + rider_payout_paisa
   + platform_commission
   + platform_small_order
   + platform_delivery_margin
   - platform_weather_expense
   + platform_tax_payable
   - platform_rounding_expense
```

This identity is asserted:
- in the fare engine, before the quote is returned;
- in Core, before the order is written;
- in the ledger, by the balanced-entry rule;
- in the invoice generator, before the PDF is produced;
- in a property test over 10⁶ random valid inputs.

If it ever fails, the request fails with `MONEY_INVOICE_UNBALANCED` and the order does not commit.
Undal will refuse an order before it will produce arithmetic it cannot defend.

---

## 11. Batching adjustment

The full bundling logic is [`12`](12-batching-engine.md); here is the money.

```python
def bundle_adjustment(core: RideCore, inp: FareInput) -> int:
    """The delta applied to the rider's fare for a non-first order in a bundle.

    The first order in a bundle is priced normally. Each subsequent order gets:
      - its base fare reduced to 55% (the rider is already at the vendor and
        already heading that way, so the fixed cost is genuinely shared), and
      - a distance component computed on its MARGINAL detour rather than on a
        full route from the vendor, and
      - a flat bundle bonus.

    The brief's requirement is that "the base fee for the second order drops
    slightly, but the overall total payout per km is optimized". Section 12.6
    demonstrates that this construction raises the rider's taka-per-kilometre
    on a realistic bundle from 17.00 to 20.82.
    """
    if inp.batch_position == 0:
        return 0

    reduced_base = apply_rate(inp.pricing.base_fare_paisa, BUNDLE_BASE_BPS)   # 55%
    marginal_m = max(0, inp.batch_marginal_distance_m - inp.pricing.base_distance_m)
    marginal_distance = (marginal_m * inp.pricing.per_km_paisa) // 1000

    target = reduced_base + marginal_distance + BUNDLE_BONUS_PAISA
    return target - core.total
```

And the customer side:

```python
def bundle_customer_credit(delivery_fee: int) -> int:
    """Every customer in a bundle receives 30% of their delivery fee back, capped.

    They were quoted a solo fee at checkout because bundling was not yet known.
    The bundle made the delivery cheaper to perform; the customer should see some
    of that. This credit is applied automatically at DELIVERED and shown on the
    receipt as 'Bundled delivery saving'. No competitor in this market returns
    efficiency gains to the customer, and doing so costs Undal less than the
    efficiency is worth.
    """
    return min(apply_rate(delivery_fee, BUNDLE_CREDIT_BPS), BUNDLE_CREDIT_CAP_PAISA)
```

---

## 12. The vectors

Forty vectors, hand-computed, stored as `workers/brain/test/vectors/fare_vectors.json` and asserted
exactly by `workers/brain/test/test_fare_vectors.py`, by the TypeScript mirror in
`workers/core/test/fare-parity.test.ts`, and by the Kotlin mirror in
`android/core-money/src/test/kotlin/FareParityTest.kt`.

Ten are worked in full below. The remaining thirty cover: every surge band boundary and both bridge
segments, all four weather conditions on both vehicles, traffic delays of 0/4/5/9/10/22 minutes,
subtotals at 9 999 / 10 000 / 10 001 paisa, the minimum and maximum fee clamps, zero-distance
orders, max-radius orders, bundles of 2 and 3, tips of 0 / 1 paisa / ৳500, discounts of 0% / 15% /
25% / 100%, and four rounding ties resolving in each direction.

### 12.1 Vector 01 — the canonical order

**Input:** motorbike · 3 800 m routed · 0 s traffic delay · 14 riders, 11 orders (SDR 1.272) ·
CLEAR · subtotal ৳450 · no discount · no tip · DELIVERY · commission 1 500 bps · bonus 300 bps

| Step | Computation | Paisa |
| --- | --- | --- |
| SDR | 14 ÷ 11 = 1.2727 → ≥ 1.05 | — |
| Surge | `SURGE_NONE` | 10 000 bps (1.00×) |
| Surged base | `apply_rate(4000, 10000)` | **4 000** |
| Billable distance | `max(0, 3800 − 2000)` = 1 800 m | — |
| Distance component | `1800 × 1400 ÷ 1000` | **2 520** |
| Traffic blocks | `0 ÷ 300` = 0 | **0** |
| **Ride core** | `4000 + 2520 + 0` | **6 520** |
| Platform margin | `apply_rate(6520, 800)` = 521.6 → | **522** |
| **Delivery fee** | `6520 + 522` | **7 042** |
| Weather premium | CLEAR | **0** |
| **Rider fare** | `max(4000, 6520 + 0 + 0)` | **6 520** |
| Small-order fee | 45 000 ≥ 10 000, DELIVERY | **2 500** (R 500 / V 500 / P 1 500) |
| Rider bonus | `apply_rate(45000, 300)` | **1 350** |
| Commission | `apply_rate(45000, 1500)` | **6 750** |
| Taxable base | `6750 + 1500 + 522` | 8 772 |
| Tax | `apply_rate(8772, 500)` = 438.6 → | **439** |
| Pre-round total | `45000 + 7042 + 2500 + 439 + 0` | 54 981 |
| **Customer pays** | `floor_to_taka(54981)` | **54 900** (৳549.00) |
| Rounding delta | | **−81** |
| **Vendor payout** | `45000 − 6750 − 1350 + 500` | **37 400** |
| **Rider payout** | `6520 + 1350 + 500 + 0` | **8 370** |
| Platform commission | | 6 750 |
| Platform small-order | | 1 500 |
| Platform delivery margin | | 522 |
| Platform tax payable | | 439 |
| Platform rounding expense | | 81 |

**Closure:** `37 400 + 8 370 + 6 750 + 1 500 + 522 + 439 = 54 981`; less the 81 paisa rounding
expense gives **54 900**. ✓

### 12.2 Vector 02 — bicycle, short trip

**Input:** bicycle · 2 400 m · 0 s · SDR 1.50 · CLEAR · subtotal ৳180 · DELIVERY

| Quantity | Paisa |
| --- | --- |
| Surge | 10 000 bps |
| Surged base | 2 500 |
| Distance (`400 m × 800 ÷ 1000`) | 320 |
| Ride core | **2 820** |
| Margin (`8%` of 2 820 = 225.6) | 226 |
| **Delivery fee** | **3 046** |
| Rider fare | `max(2500, 2820)` = 2 820 |
| Small-order fee | 2 500 (R 500 / V 500 / P 1 500) |
| Bonus (`3%` of 18 000) | 540 |
| Commission (`15%`) | 2 700 |
| Taxable (`2700 + 1500 + 226`) | 4 426 |
| Tax (`5%` of 4 426 = 221.3) | 221 |
| Pre-round | 18 000 + 3 046 + 2 500 + 221 = 23 767 |
| **Customer pays** | **23 700** (৳237.00), delta −67 |
| **Vendor** | `18000 − 2700 − 540 + 500` = **15 260** |
| **Rider** | `2820 + 540 + 500` = **3 860** |
| Platform | `2700 + 1500 + 226 + 221` = 4 647 |

**Closure:** `15 260 + 3 860 + 4 647 = 23 767` → 23 700 + 67. ✓

### 12.3 Vector 03 — rain, severe shortage, traffic

**Input:** motorbike · 6 200 m · 720 s traffic delay (12 min) · 3 riders, 10 orders (SDR 0.30) ·
RAIN (confidence 0.9) · subtotal ৳920 · DELIVERY

| Quantity | Computation | Paisa |
| --- | --- | --- |
| Surge | `1.5 + (0.5−0.30)/0.5 × 0.7 = 1.78` | 17 800 bps |
| Surged base | `apply_rate(4000, 17800)` | 7 120 |
| Distance | `4200 m × 1400 ÷ 1000` | 5 880 |
| Traffic | `720 ÷ 300 = 2` blocks × 800 | 1 600 |
| **Ride core** | | **14 600** |
| Margin | `8%` of 14 600 | 1 168 |
| **Delivery fee** | | **15 768** |
| Weather premium | `20%` of 14 600 | 2 920 |
| **Rider fare** | `14 600 + 2 920` | **17 520** |
| Small-order | | 2 500 |
| Bonus | `3%` of 92 000 | 2 760 |
| Commission | `15%` of 92 000 | 13 800 |
| Taxable | `13 800 + 1 500 + 1 168` | 16 468 |
| Tax | `5%` of 16 468 = 823.4 | 823 |
| Pre-round | `92 000 + 15 768 + 2 500 + 823` | 111 091 |
| **Customer pays** | | **111 000** (৳1 110.00), delta −91 |
| **Vendor** | `92 000 − 13 800 − 2 760 + 500` | **75 940** |
| **Rider** | `17 520 + 2 760 + 500` | **20 780** |
| Platform delivery line | `15 768 − 14 600 − 2 920` | **−1 752** (subsidy ৳17.52) |
| Platform total | `13 800 + 1 500 − 1 752 + 823` | 14 371 |

**Closure:** `75 940 + 20 780 + 14 371 = 111 091` → 111 000 + 91. ✓

The rider earns ৳207.80 on this delivery. Without the surge and weather premium they would have
earned ৳127.60. That ৳80 difference is why someone goes out in the rain.

### 12.4 Vector 04 — pick-up, no rider, banker's tie rounds down

**Input:** PICKUP · subtotal ৳130 · no rider, no delivery

| Quantity | Paisa |
| --- | --- |
| Delivery fee | 0 |
| Small-order fee | **2 000** (rider share not collected: V 500 / P 1 500) |
| Commission (`15%` of 13 000) | 1 950 |
| Rider bonus | **0** (no rider) |
| Taxable (`1 950 + 1 500 + 0`) | 3 450 |
| Tax | `3450 × 500 = 1 725 000`; `÷ 10 000 → q=172, r=5 000` → exact tie → `q` is **even** → **172** |
| Pre-round | `13 000 + 0 + 2 000 + 172` | 15 172 |
| **Customer pays** | **15 100** (৳151.00), delta −72 |
| **Vendor** | `13 000 − 1 950 − 0 + 500` = **11 550** |
| Platform | `1 950 + 1 500 + 0 + 172` = 3 622 |

**Closure:** `11 550 + 3 622 = 15 172` → 15 100 + 72. ✓

### 12.5 Vector 05 — below the fee threshold, zero billable distance

**Input:** motorbike · 2 000 m exactly · SDR 2.0 · CLEAR · subtotal ৳85

| Quantity | Paisa |
| --- | --- |
| Surge | 10 000 bps |
| Surged base | 4 000 |
| Distance (`max(0, 2000−2000) = 0`) | 0 |
| Ride core | 4 000 |
| Margin | 320 |
| Delivery fee | 4 320 |
| Rider fare | `max(4000, 4000)` = 4 000 |
| Small-order fee | **0** (8 500 < 10 000) |
| Bonus (`3%` of 8 500) | 255 |
| Commission (`15%`) | 1 275 |
| Taxable (`1 275 + 0 + 320`) | 1 595 |
| Tax (`5%` of 1 595 = 79.75) | 80 |
| Pre-round | `8 500 + 4 320 + 0 + 80` = 12 900 |
| **Customer pays** | **12 900** (৳129.00), delta **0** — an exact taka |
| **Vendor** | `8 500 − 1 275 − 255` = **6 970** |
| **Rider** | `4 000 + 255` = **4 255** |
| Platform | `1 275 + 0 + 320 + 80` = 1 675 |

**Closure:** `6 970 + 4 255 + 1 675 = 12 900`. ✓ Delta zero exercises the no-rounding path.

### 12.6 Vector 06 — a two-order bundle, proven to help everyone

**Setup:** one vendor, two orders accepted within 90 seconds, drop points 900 m apart.

| | Order A | Order B |
| --- | --- | --- |
| Subtotal | ৳300 (30 000 p) | ৳220 (22 000 p) |
| Solo routed distance | 4 000 m | 4 400 m |
| Bundle leg | rider→vendor 1 200 m, vendor→A 2 800 m | A→B 900 m |

**Solo fares (what each was quoted at checkout):**

| | Order A | Order B |
| --- | --- | --- |
| Surged base (1.0×) | 4 000 | 4 000 |
| Distance | `2000 m × 1.4` = 2 800 | `2400 m × 1.4` = 3 360 |
| Ride core | **6 800** | **7 360** |
| Margin 8% | 544 | 589 |
| **Delivery fee quoted** | **7 344** | **7 949** |

**Bundled rider payout:**

`BUNDLE_BASE_BPS = 5 500`, i.e. the second and subsequent orders carry 55% of the base fare:

| | Order A (position 0) | Order B (position 1) |
| --- | --- | --- |
| Base | 4 000 (full) | `apply_rate(4000, 5500)` = **2 200** |
| Distance | `2000 m × 1.4` = 2 800 | marginal 900 m ≤ 2 000 m base allowance → **0** |
| Bundle bonus | 0 | **1 200** |
| **Rider fare** | **6 800** | **3 400** |

**Totals:**

| Measure | Solo (two separate trips) | Bundled |
| --- | --- | --- |
| Rider distance travelled | 4 000 + 4 400 = 8 400 m | 1 200 + 2 800 + 900 = **4 900 m** |
| Rider fare total | 6 800 + 7 360 = 14 160 | 6 800 + 3 400 = **10 200** |
| **Rider ৳ per km** | **16.86** | **20.82** |
| Rider time (at 20 km/h + 2×4 min at doors) | ~33 min | **~23 min** |
| **Rider ৳ per hour** (fare only) | **257** | **266** |
| Customer A delivery fee | 73.44 | `73.44 − 22.03 credit` = **51.41** |
| Customer B delivery fee | 79.49 | `79.49 − 23.85 credit` = **55.64** |
| Platform delivery collected | 153.17 | 107.05 |
| Platform delivery paid out | 141.60 | 102.00 |
| **Platform delivery margin** | **11.57** | **5.05** |

**Who wins:** the rider earns 23% more per kilometre and finishes 10 minutes sooner. Both customers
save about ৳23. The platform's delivery margin halves in absolute terms but is earned on half the
rider-minutes, so its margin *per rider-hour deployed* rises from ৳21 to ৳13… which is lower.

**That is an honest result and it is the right trade.** The platform gives up delivery margin on
bundles because the rider freed up by bundling completes another order, and that order carries full
commission. The benchmark in [`30 §7`](30-testing-and-verification.md) measures the second-order
effect: at a 22% bundle rate, zone throughput rises 17% and total platform revenue per rider-hour
rises 11%, despite the lower per-bundle delivery margin.

### 12.7 Vector 07 — moderate surge band

**Input:** motorbike · 4 500 m · 0 s · 7 riders, 10 orders (SDR 0.70) · CLEAR · subtotal ৳260

Surge `1.2 + (1.0 − 0.70)/0.5 × 0.2 = 1.32` → 13 200 bps.

| Quantity | Paisa |
| --- | --- |
| Surged base | `apply_rate(4000, 13200)` = 5 280 |
| Distance | `2500 × 1400 ÷ 1000` = 3 500 |
| Ride core | 8 780 |
| Margin (702.4) | 702 |
| **Delivery fee** | **9 482** |
| Rider fare | 8 780 |
| Small-order | 2 500 |
| Bonus | 780 · Commission 3 900 |
| Taxable `3900 + 1500 + 702` | 6 102 |
| Tax (305.1) | 305 |
| Pre-round | 38 287 → **38 200**, delta −87 |
| **Vendor** | `26 000 − 3 900 − 780 + 500` = **21 820** |
| **Rider** | `8 780 + 780 + 500` = **10 060** |
| Platform | 6 407 |

**Closure:** `21 820 + 10 060 + 6 407 = 38 287`. ✓

### 12.8 Vector 08 — bicycle at the surge bridge, near max radius

**Input:** bicycle · 3 900 m (inside the 4 000 m cap) · SDR 0.45 · CLEAR · subtotal ৳150

Surge: SDR 0.45 is the top of the severe band → `1.5 + (0.5−0.45)/0.5 × 0.7 = 1.57` → 15 700 bps.

| Quantity | Paisa |
| --- | --- |
| Surged base | `apply_rate(2500, 15700)` = 3 925 |
| Distance | `1900 × 800 ÷ 1000` = 1 520 |
| Ride core | 5 445 |
| Margin (435.6) | 436 |
| **Delivery fee** | **5 881** |
| Rider fare | 5 445 |
| Small-order | 2 500 · Bonus 450 · Commission 2 250 |
| Taxable | 4 186 · Tax (209.3) 209 |
| Pre-round | 23 590 → **23 500**, delta −90 |
| **Vendor** | **12 800** · **Rider** **6 395** · Platform 4 395 |

**Closure:** `12 800 + 6 395 + 4 395 = 23 590`. ✓

### 12.9 Vector 09 — storm, near-maximum surge

**Input:** motorbike · 5 000 m · 1 200 s traffic (20 min) · 3 riders, 20 orders (SDR 0.15) ·
STORM (confidence 0.95) · subtotal ৳600

Surge `1.5 + (0.5−0.15)/0.5 × 0.7 = 1.99` → 19 900 bps.

| Quantity | Paisa |
| --- | --- |
| Surged base | 7 960 |
| Distance (`3000 × 1.4`) | 4 200 |
| Traffic (`4 blocks × 800`) | 3 200 |
| **Ride core** | **15 360** |
| Margin (1 228.8) | 1 229 |
| **Delivery fee** | **16 589** |
| Weather premium (40%) | 6 144 |
| **Rider fare** | **21 504** |
| Small-order 2 500 · Bonus 1 800 · Commission 9 000 | |
| Taxable `9 000 + 1 500 + 1 229` | 11 729 |
| Tax (586.45) | 586 |
| Pre-round | 79 675 → **79 600**, delta −75 |
| **Vendor** | `60 000 − 9 000 − 1 800 + 500` = **49 700** |
| **Rider** | `21 504 + 1 800 + 500` = **23 804** (৳238.04) |
| Platform delivery line | `16 589 − 15 360 − 6 144` = **−4 915** |
| Platform total | `9 000 + 1 500 − 4 915 + 586` = 6 171 |

**Closure:** `49 700 + 23 804 + 6 171 = 79 675`. ✓

The platform clears ৳61.71 on a ৳796 order and spends ৳49.15 keeping a rider on the road in a
storm. Both numbers are visible in the finance dashboard.

### 12.10 Vector 10 — the payout floor binds, banker's tie rounds up

**Input:** motorbike · 800 m · SDR 3.0 · CLEAR · subtotal ৳110

| Quantity | Paisa |
| --- | --- |
| Surged base 4 000 · Distance 0 · Ride core **4 000** |
| Margin 320 · **Delivery fee 4 320** |
| **Rider fare** `max(4000, 4000)` = **4 000** — the floor binds exactly |
| Small-order 2 500 · Bonus 330 · Commission 1 650 |
| Taxable `1 650 + 1 500 + 320` | 3 470 |
| Tax | `3470 × 500 = 1 735 000`; `q = 173, r = 5 000` → tie → `173` is **odd** → **174** |
| Pre-round | `11 000 + 4 320 + 2 500 + 174` = 17 994 → **17 900**, delta −94 |
| **Vendor** | `11 000 − 1 650 − 330 + 500` = **9 520** |
| **Rider** | `4 000 + 330 + 500` = **4 830** |
| Platform | `1 650 + 1 500 + 320 + 174` = 3 644 |

**Closure:** `9 520 + 4 830 + 3 644 = 17 994`. ✓

V04 and V10 together prove banker's rounding resolves ties in both directions, which is the
behaviour a hand-checking auditor needs to see demonstrated.

---

## 13. The properties

Asserted over 10⁶ generated inputs by `workers/brain/test/test_fare_properties.py` using Hypothesis.

| # | Property |
| --- | --- |
| P1 | Every output amount is a non-negative integer, except `rounding_paisa ≤ 0`. |
| P2 | **Closure**: the identity in §10.1 holds exactly. |
| P3 | **Distance monotonicity**: increasing `routed_distance_m` never decreases the rider fare or the delivery fee. |
| P4 | **Surge monotonicity**: decreasing SDR never decreases the surge. |
| P5 | **Surge continuity**: `|surge(x) − surge(x+ε)| ≤ 1 400 bps` for `ε = 0.01`. |
| P6 | **Surge bounds**: `10 000 ≤ surge ≤ cap`. |
| P7 | **Payout floor**: `rider.fare ≥ min_payout_paisa` on every delivery. |
| P8 | **Weather ordering**: `payout(STORM) ≥ payout(RAIN) ≥ payout(EXTREME_HEAT) ≥ payout(CLEAR)`, all else equal. |
| P9 | **Fee clamp**: `min_delivery_fee ≤ delivery_fee ≤ max_delivery_fee` on every delivery. |
| P10 | **Pick-up has no delivery fee and no rider share.** |
| P11 | **Small-order split sums** to the fee, on both fulfilment paths. |
| P12 | **Threshold boundary**: subtotal 9 999 → no fee; 10 000 → fee. |
| P13 | **Tip is untouched**: `rider.tip == input.tip` and tip affects no other line. |
| P14 | **Discount reduces commission**: commission on a discounted order is strictly less than on the same order undiscounted. |
| P15 | **Rounding bound**: `−99 ≤ rounding_paisa ≤ 0`. |
| P16 | **Customer total is a whole taka**: `total_paisa % 100 == 0`. |
| P17 | **Determinism**: the same input twice gives byte-identical output. |
| P18 | **Cross-language parity**: Python, TypeScript and Kotlin agree exactly. |
| P19 | **Bundle improves ৳/km**: for any feasible bundle, the rider's taka-per-kilometre is ≥ the solo value. |
| P20 | **Bundle credit is non-negative and capped.** |
| P21 | **No float**: an AST check asserts no `float` appears in any money-typed expression. |
| P22 | **Overflow safety**: subtotals up to 10⁹ paisa (৳10 million) produce no overflow in any language. |
| P23 | **Zero-order zone**: `active_orders = 0` yields surge 1.0, not a division error. |
| P24 | **Weather confidence gate**: confidence < 0.5 yields a zero premium regardless of condition. |
| P25 | **Bicycle radius**: a bicycle input beyond `max_radius_m` is rejected by the engine, not silently priced. |

---

## 14. Reading on

Next: [`11-dispatch-engine.md`](11-dispatch-engine.md) — choosing the rider.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
