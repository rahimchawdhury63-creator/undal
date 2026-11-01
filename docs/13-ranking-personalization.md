<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 13 — Ranking and Personalisation

> The brief: *"Smart Vendor Ranking & Personalization — 10-stage pipeline (geo-filter, performance
> scoring, personalization, diversity, cold-start)"* and, separately and absolutely:
> *"no ads, no CPC, never charge customers for promotion."* This document specifies a ranking
> system in which **money cannot buy position**, and the mechanism that makes that enforceable
> rather than merely promised.

---

## 1. The anti-advertising invariant

Most food platforms rank by a blend of relevance and *how much the restaurant paid*. Undal does
not, and the prohibition is enforced in three independent layers:

### Layer 1 — the type system

```python
@dataclass(frozen=True)
class RankInput:
    """The ONLY data the ranking engine may see.

    There is no field here from which a monetary amount can be derived. Not
    commission rate, not order value, not promotional budget, not a 'partner
    tier'. `flash_box_active` is a boolean — it says a discount exists, not
    how large it is and not what the vendor paid, and it is used to surface
    a genuine customer benefit, not to sell placement.
    """
    vendor_id: str
    distance_m: int
    eta_minutes: int
    is_open: bool
    opens_in_minutes: int | None
    accept_rate_wilson: float
    prep_accuracy: float
    cancel_rate_wilson: float
    rating_wilson: float
    rating_count: int
    cuisine_tags: tuple[str, ...]
    price_band: int                 # 1-4, a BAND not an amount
    item_match_score: float
    customer_order_count: int
    customer_last_order_days: int | None
    cuisine_affinity: float
    time_of_day_affinity: float
    zone_popularity: float
    new_vendor_days: int | None
    flash_box_active: bool
    has_photo_coverage: float
    veg_options: bool
    halal_certified: bool
```

### Layer 2 — CI enforcement

The `anti-ad-invariant` job fails the build if any field name in `RankInput`, or any key in a
ranking feature dictionary, matches:

```
/paisa|price_paisa|fee|bid|spend|budget|sponsor|promote|boost|rank_fee|placement|featured_paid|cpc|cpm/i
```

It also AST-walks `workers/brain/src/rank/` and fails on any import from the money, ledger, or
commission modules. A ranking engine that cannot *import* the price of anything cannot sell
position.

### Layer 3 — the explanation

Every ranked vendor carries a `rankReason` in the API response
([`08`](08-api-contract.md)), and `GET /v1/partner/rank-explain` renders a vendor's own position
back to them with the full factor breakdown. If placement were purchasable, the explanation would
have to say so — and it has no field in which to say it.

> **The only ways to rank higher on Undal are: be closer, be faster, be more accurate, be better
> rated, and cook food this customer likes.** There is no sixth way. There is no sales team to
> call.

---

## 2. The ten stages

```
    Customer opens the app at (lat, lon)
                 │
   ┌─────────────▼──────────────┐
 1 │ GEO-FILTER                 │  Which vendors can physically serve this point?
   └─────────────┬──────────────┘
   ┌─────────────▼──────────────┐
 2 │ AVAILABILITY               │  Open now, opening soon, or closed?
   └─────────────┬──────────────┘
   ┌─────────────▼──────────────┐
 3 │ QUERY MATCH                │  Search text, cuisine filter, dietary filter
   └─────────────┬──────────────┘
   ┌─────────────▼──────────────┐
 4 │ PERFORMANCE SCORE          │  Objective operational quality
   └─────────────┬──────────────┘
   ┌─────────────▼──────────────┐
 5 │ PROXIMITY SCORE            │  Distance and ETA, non-linear
   └─────────────┬──────────────┘
   ┌─────────────▼──────────────┐
 6 │ PERSONALISATION            │  This customer's history and affinities
   └─────────────┬──────────────┘
   ┌─────────────▼──────────────┐
 7 │ CONTEXT                    │  Hour, day, weather, local events
   └─────────────┬──────────────┘
   ┌─────────────▼──────────────┐
 8 │ COLD-START BOOST           │  Give new and data-poor vendors a fair chance
   └─────────────┬──────────────┘
   ┌─────────────▼──────────────┐
 9 │ DIVERSITY RE-RANK          │  Break up cuisine monocultures
   └─────────────┬──────────────┘
   ┌─────────────▼──────────────┐
10 │ EXPLAIN + EMIT             │  Attach a reason to every row; trace it
   └────────────────────────────┘
```

Total CPU at 200 candidate vendors: **p50 3.9 ms, p99 5.8 ms** ([`09 §10`](09-undal-brain-overview.md)).

---

## 3. Stage 1 — Geo-filter

```sql
-- Vendors whose service polygon contains the customer AND which are inside
-- the customer's active delivery zone. PostGIS does the work; the GIST index
-- on vendors.service_area makes it a sub-10ms query at city scale.
SELECT v.id, v.name, v.cuisine_tags, v.price_band,
       ST_Distance(v.location::geography, $1::geography)::int AS straight_m
  FROM vendors v
 WHERE v.status = 'APPROVED'
   AND v.zone_id = $2
   AND ST_Contains(v.service_area, $1::geometry)
   AND ST_DWithin(v.location::geography, $1::geography, v.max_delivery_m)
 ORDER BY straight_m
 LIMIT 300;
```

Two conditions, not one: the vendor's own `service_area` polygon **and** the platform's zone. A
vendor may draw a service area smaller than the zone (a home kitchen that only serves its own
neighbourhood) but never larger.

Straight-line distance is multiplied by the learned zone detour factor to give a routing estimate;
true OSRM distances are fetched only for the top 40 after stage 9, because 300 route calls per
app-open is neither free nor fast.

**If stage 1 returns zero rows**, ranking stops and the empty state
`NO_VENDORS_IN_ZONE` or `OUTSIDE_DELIVERY_RADIUS` is returned
([`33`](33-empty-state-doctrine.md)). This is a normal, expected, well-designed outcome — not an
error.

---

## 4. Stage 2 — Availability

| State | Treatment |
| --- | --- |
| `OPEN` | Full ranking |
| `BUSY` (vendor-set, prep times extended) | Ranked, with an "extra busy" chip and the longer ETA |
| `OPENING_SOON` (within 90 min) | Ranked in a separate section below open vendors, with "Opens at 17:00" and pre-order where enabled |
| `CLOSED` | Shown only in a collapsed "Closed now" section at the very bottom, never mixed into the main list |
| `UNREACHABLE` ([`14`](14-presence-and-heartbeat.md)) | **Hidden entirely.** A vendor whose device is unreachable cannot accept an order; showing them produces a guaranteed failure |
| `PAUSED` (vendor-initiated) | Hidden, with the vendor's own set return time respected |

The `UNREACHABLE` rule is one of the highest-value lines in this document. Every order sent to an
unreachable vendor becomes a 2-minute wait followed by an auto-cancellation and an angry customer.
Hiding them costs a few impressions and prevents every one of those failures.

---

## 5. Stage 3 — Query match

When the customer has typed something or applied filters:

| Signal | Weight within `item_match_score` |
| --- | --- |
| Exact vendor-name match | 1.00 |
| Vendor-name prefix match | 0.85 |
| Vendor-name trigram similarity ≥ 0.4 | 0.40–0.70 scaled |
| Exact menu-item name match | 0.90 |
| Menu-item trigram / synonym match | 0.30–0.65 |
| Cuisine tag match | 0.55 |
| Dietary tag match (veg / halal) | gate, not score — a filter removes rather than demotes |

Search runs over a **trigram index** on `vendors.name_normalised` and `menu_items.name_normalised`,
plus a hand-curated synonym table that is essential for Bangladesh:

| Typed | Also matches |
| --- | --- |
| `biriyani` | biryani, birani, biriani, বিরিয়ানি |
| `kacchi` | kachchi, kacchi biriyani, কাচ্চি |
| `tehari` | tehri, techari, তেহারি |
| `cha` / `tea` | chaa, চা, dudh cha, malai cha |
| `singara` | samosa, সিঙ্গারা |
| `morog polao` | murag pulao, মোরগ পোলাও |
| `fuchka` | phuchka, panipuri, ফুচকা |
| `halim` | haleem, হালিম |

The synonym table ships with **340 entries** covering Bengali/English transliteration variance, and
it is editable in the admin panel because new spellings appear constantly. Matching is
Unicode-normalised (NFC) and diacritic-insensitive, and Bengali script queries match
transliterated names and vice versa.

---

## 6. Stage 4 — Performance score

```python
def performance_score(v: RankInput) -> float:
    """Objective operational quality. Every input is Wilson-bounded, so a
    vendor with 3 perfect orders does not outrank one with 300 excellent ones.
    """
    return (
        0.34 * v.rating_wilson
      + 0.24 * v.prep_accuracy        # |actual - promised| converted to [0,1]
      + 0.22 * v.accept_rate_wilson
      + 0.12 * (1.0 - v.cancel_rate_wilson)
      + 0.08 * v.has_photo_coverage   # fraction of menu items with a real photo
    )
```

`prep_accuracy` is the term vendors can most directly improve, and it is weighted second-highest
deliberately: a vendor who says 20 minutes and means it is worth more to the platform than one who
says 10 and takes 25.

```python
def prep_accuracy(samples: list[tuple[int, int]]) -> float:
    """EWMA over |promised - actual| in seconds, mapped so that:
       0 s error → 1.00 | 300 s → 0.50 | 600 s → 0.25 | 900 s+ → ~0.12
    Under-promising (being early) is penalised at HALF the rate of being late,
    because early food is a minor inconvenience and late food is the product
    failing.
    """
    if not samples:
        return 0.70                               # neutral prior for new vendors
    err = ewma([abs(a - p) if a > p else abs(a - p) * 0.5
                for p, a in samples], half_life_h=168)
    return 1.0 / (1.0 + err / 300.0)
```

### 6.1 Photo coverage

A vendor whose dishes have real photographs converts far better and generates fewer "this isn't
what I expected" disputes. The 8% weight is a nudge, not a wall, and the partner app surfaces it
directly: *"Add photos to 6 more items to improve where you appear."* That sentence is allowed
because it is true and the action is free.

---

## 7. Stage 5 — Proximity

```python
def proximity_score(distance_m: int, eta_minutes: int, zone_median_m: float) -> float:
    """Non-linear in both. The difference between 500 m and 900 m matters a lot;
    the difference between 4.0 km and 4.4 km barely matters at all.
    """
    d = 1.0 / (1.0 + (distance_m / max(zone_median_m, 600.0)) ** 1.4)
    e = max(0.0, 1.0 - max(0, eta_minutes - 15) / 45.0)   # 15 min free, 60 min → 0
    return 0.55 * d + 0.45 * e
```

ETA carries nearly as much weight as distance because a 1.2 km vendor with a 45-minute prep time is
further away, in the only sense the customer cares about, than a 3 km vendor with a 12-minute one.

---

## 8. Stage 6 — Personalisation

Four signals, all derived from the customer's own order history, all stored in
`customer_features`, all visible to the customer and all deletable by them (§13).

| Signal | Definition |
| --- | --- |
| `reorder_affinity` | `min(1, orders_from_vendor / 5)`, decayed with a 90-day half-life |
| `cuisine_affinity` | Cosine similarity between the customer's cuisine distribution and the vendor's tags |
| `price_band_fit` | 1.0 at the customer's modal band, 0.6 one band away, 0.25 two away |
| `time_of_day_affinity` | Has this customer ordered from this vendor, or this cuisine, at this hour-of-week before? |

```python
def personalisation_score(v: RankInput) -> float:
    if v.customer_order_count == 0 and v.cuisine_affinity == 0.0:
        return 0.50                       # strict neutral for a brand-new customer
    return (0.40 * reorder_affinity(v)
          + 0.30 * v.cuisine_affinity
          + 0.18 * price_band_fit(v)
          + 0.12 * v.time_of_day_affinity)
```

### 8.1 The filter-bubble cap

Personalisation is capped at **0.22 of the final blended score**. A customer who has ordered
biriyani eleven times should see biriyani high — and should still see the new Thai place that
opened on their street. Without the cap, personalisation converges on a list of five restaurants
and the platform stops being a marketplace.

### 8.2 Cold start for customers

A customer with no orders gets a strict 0.50 on every personalisation signal, so stages 4, 5, 7 and
8 decide everything. Their first list is: nearby, well-rated, fast, and diverse. That is the right
first impression and it requires no data at all.

---

## 9. Stage 7 — Context

| Context | Effect |
| --- | --- |
| **Hour of day** | Breakfast (06–10) boosts `breakfast`, `bakery`, `tea`; late night (22–02) boosts `fast_food`, `biriyani`, 24h vendors. Learned per zone from actual order distributions, not hard-coded |
| **Day of week** | Friday lunch boosts traditional/biriyani in Bangladesh — again learned, not assumed |
| **Weather** | Rain boosts `soup`, `tea`, `hot`, demotes `ice_cream`; heat inverts it. Uses the same weather signal as the fare engine |
| **Ramadan** | Iftar-window boosts `iftar`, `haleem`, `jilapi`, `fried`; the hijri calendar ships as a static table through 2035 |
| **Zone popularity** | What is being ordered *right now* within 2 km, 15-minute window — the "what's hot nearby" signal, capped at 0.08 so it cannot create a runaway |

Each produces a multiplier in `[0.85, 1.25]` applied to the relevant vendors' blended score. The
combined context multiplier is clamped to `[0.80, 1.30]`.

---

## 10. Stage 8 — Cold start

A new vendor with no orders has no `rating_wilson`, no `prep_accuracy`, no `accept_rate`. Scored
naively, they would rank last forever — an unwinnable position, and a marketplace that cannot
onboard supply is dead.

```python
def cold_start_boost(v: RankInput) -> float:
    """A decaying, capped, time-and-volume-limited boost.

    It is NOT a purchasable feature, it is NOT extendable, and it does not
    apply to a vendor who re-registers to reset their stats — the ledger of
    vendor statistics is keyed to the owner's NID hash, so a deleted and
    recreated vendor inherits its own history.
    """
    if v.new_vendor_days is None or v.new_vendor_days > 21:
        return 0.0
    if v.rating_count >= 25:
        return 0.0                              # has enough data now; stand on it
    day_decay    = 1.0 - (v.new_vendor_days / 21.0)
    volume_decay = 1.0 - (v.rating_count / 25.0)
    return 0.14 * min(day_decay, volume_decay)
```

Maximum boost 0.14, decaying to zero over 21 days or 25 rated orders, whichever comes first. A new
vendor appears around position 4–8 in a list of 60 on day one, which is enough to get their first
orders and not enough to displace a genuinely excellent incumbent.

Vendors are told exactly this during onboarding, in these words: *"For your first three weeks you
get a visibility boost. Use it — the fastest way to keep your position after it ends is accurate
prep times and real photos."*

---

## 11. Stage 9 — Diversity re-rank

Raw scoring produces monocultures: the top 10 all serving biriyani because biriyani is popular and
Undal's own popularity signals are self-reinforcing.

Undal applies **Maximal Marginal Relevance** over the top 40:

```python
def diversify(ranked: list[Scored], lam: float = 0.78, window: int = 40) -> list[Scored]:
    """MMR: repeatedly pick the vendor maximising
         lam * score - (1 - lam) * max_similarity_to_already_picked

    Similarity = Jaccard over cuisine tags, plus 0.3 if the price bands match,
    plus 0.2 if both are within 300 m of each other (geographic clustering is
    its own kind of sameness).
    """
    pool, out = list(ranked[:window]), []
    while pool:
        best, best_val = None, -1e9
        for c in pool:
            sim = max((similarity(c, s) for s in out), default=0.0)
            val = lam * c.score - (1 - lam) * sim
            if val > best_val:
                best, best_val = c, val
        out.append(best); pool.remove(best)
    return out + ranked[window:]
```

Additional hard rules applied after MMR:
- No more than **3 of the same cuisine** in the top 10.
- No more than **2 vendors with the same owner** in the top 20.
- At least **1 vendor with `new_vendor_days ≤ 21`** in the top 12, if one exists and scores above
  0.40 — a structural guarantee that new supply is discoverable.
- At least **2 price bands** represented in the top 8.

---

## 12. Stage 10 — Explain

Every row returns a `rankReason`:

```jsonc
{
  "vendorId": "…",
  "position": 3,
  "score": 0.7412,
  "rankReason": {
    "headline": "Fast, close, and you've ordered here twice",
    "factors": [
      { "label": "1.2 km away",            "contribution": 0.191, "kind": "PROXIMITY" },
      { "label": "4.6★ from 212 orders",   "contribution": 0.168, "kind": "RATING" },
      { "label": "Ready in about 18 min",  "contribution": 0.142, "kind": "SPEED" },
      { "label": "You've ordered here 2×", "contribution": 0.098, "kind": "HISTORY" },
      { "label": "Accurate prep times",    "contribution": 0.087, "kind": "RELIABILITY" }
    ],
    "notFactors": ["Vendors cannot pay to appear higher on Undal."]
  }
}
```

That last line ships in the API payload and is rendered in the UI behind the "Why am I seeing
this?" affordance. It is a product claim that the type system makes true.

### 12.1 What vendors see

`GET /v1/partner/rank-explain` returns the vendor's own median position over the last 7 days, the
factor breakdown, and a ranked list of **actionable** improvements:

```
Your average position in Zindabazar: 11th of 43

  What's helping you              What's holding you back
  ───────────────────────         ──────────────────────────────────
  ✓ 4.5★ from 88 orders           ✗ Prep accuracy 0.61
  ✓ 96% acceptance                  You promise 20 min, you average 31.
  ✓ 0.9 km median distance          Setting 30 min would raise your score
                                    more than any other single change.

                                  ✗ Photo coverage 42%
                                    31 of your 53 items have no photo.
```

No upsell, no "boost your listing" button, because there is nothing to sell. The only path is
operational improvement, and the panel tells them precisely which improvement is worth the most.

---

## 13. Customer control

| Control | Location | Effect |
| --- | --- | --- |
| **Sort override** | List header | Recommended · Nearest · Fastest · Top rated · Price band. Overriding replaces stages 4–9 with the chosen single criterion |
| **"Why this order?"** | List header ⓘ | Opens the explanation sheet |
| **"Show me something new"** | List header | One-tap mode that zeroes personalisation and doubles diversity for that session |
| **Taste profile** | Settings | Shows the derived cuisine distribution in plain language — *"You order a lot of Bengali, Chinese and bakery"* — with a per-cuisine delete |
| **Clear personalisation** | Settings | Wipes `customer_features` immediately. Ranking reverts to the cold-start path on the next request |
| **Dietary defaults** | Settings | Veg-only / halal-only as persistent **filters**, not weights |

The taste profile being legible in ordinary language is a deliberate choice. A customer who can
read what the system believes about them, and delete it in one tap, is in a fundamentally different
relationship with the platform than one who cannot.

---

## 14. The blend

```python
FINAL = clamp01(
    0.30 * performance
  + 0.26 * proximity
  + 0.22 * personalisation        # hard cap, §8.1
  + 0.14 * query_match            # 0 when no query, weights redistributed pro-rata
  + 0.08 * zone_popularity
) * context_multiplier + cold_start_boost
```

When there is no search query the 0.14 is redistributed across performance, proximity and
personalisation in their existing proportions, preserving the personalisation cap.

All eleven numbers live in `platform_config.rank_weights`, versioned and audited like every other
weight ([`09 §4`](09-undal-brain-overview.md)).

---

## 15. Item-level recommendation

Within a vendor, and on the home screen's "For you" rail:

| Surface | Method |
| --- | --- |
| **"Order again"** | The customer's own past items, most recent first, dropping anything unavailable |
| **"Popular here"** | Item order count over 14 days, Wilson-bounded, excluding items the customer has already bought |
| **"Goes well with"** | Item-item co-occurrence within completed orders, lifted over the base rate, minimum support 20 co-orders |
| **"Try something new"** | Items from the customer's affinity cuisines at vendors they have not used |

Co-occurrence is computed from `order_items` by a request-triggered incremental update ([`09 §8`](09-undal-brain-overview.md)) — no cron, no batch job. The item-item matrix is stored sparsely in
`item_affinities` and capped at the top 12 partners per item, which keeps it small enough to live
in KV.

**No sponsored items. No paid placement inside a menu. Ever.** The `anti-ad-invariant` job covers
these code paths too.

---

## 16. Testing

| Test | Count | Asserts |
| --- | --- | --- |
| `anti-ad-invariant` | 1 CI job | No money-derived field reachable from `RankInput`; no money-module import in `rank/` |
| Stage unit tests | 68 | Each stage in isolation, including empty input |
| Wilson bounds | 12 | 1/1 → 0.21, 18/20 → 0.70, 180/200 → 0.85 |
| Cold start | 16 | Decay over days and volume; no boost for a re-registered owner (NID-hash keyed) |
| Diversity | 14 | The 3-cuisine, 2-owner, 1-new, 2-band rules hold on adversarial inputs |
| Personalisation cap | 6 | The 0.22 ceiling is never exceeded, including with the context multiplier |
| Synonym search | 48 | Every entry in the Bengali/English table, both directions, both scripts |
| Determinism | 1 | Same input → identical order, 10⁵ times |
| Explanation integrity | 9 | Factor contributions sum to the score ±0.001; the top factor is genuinely the largest |
| Empty states | 6 | Each of the six kinds returns the right code and copy |
| Deletion | 4 | Clearing personalisation takes effect on the very next request and leaves no residue in KV |

---

## 17. Reading on

Next: [`14-presence-and-heartbeat.md`](14-presence-and-heartbeat.md) — knowing within two seconds
that a vendor has gone dark.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
