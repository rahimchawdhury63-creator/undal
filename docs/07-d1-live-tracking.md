<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 07 — D1 Live Tracking

> A rider's position must feel live to the customer, the vendor and the admin — and it must cost
> nothing. Those two requirements are in direct tension, and this document resolves it with
> device-side gating, adaptive cadence, client-side interpolation, and a database that is
> deliberately forgettable.

---

## 1. The problem, stated numerically

Cloudflare D1's free tier allows **100 000 writes per day** and **5 million reads per day**.

A naive implementation writes the rider's GPS position every 5 seconds while on shift. With 40
riders working 8-hour shifts:

```
40 riders × 8 h × 3600 s ÷ 5 s = 230 400 writes/day
```

That is 2.3× over budget with forty riders. At a hundred riders it is 576 000 — nearly six times
over. The naive design does not survive contact with a real city.

The brief's instruction is precise and correct: *"THE RIDER DEVICE AUTOMATICALLY CHEK FOR THE RIDER
MOVEMENT WHEN THE RIDER IS MOVED AT LEAST 100 METERS THE DB AND WORKER WILL UPDATE"*. That single
rule — **gate on displacement, not on time** — is what makes the whole thing fit.

### 1.1 What 100 m displacement gating actually costs

A motorbike rider in Sylhet traffic averages **18 km/h** over a shift including stops. 100 m at
18 km/h is one write every **20 seconds** while moving. Riders move roughly 55% of a shift (the rest
is waiting at vendors, waiting at doors, and breaks):

```
8 h × 0.55 = 4.4 h moving
4.4 h × 3600 s ÷ 20 s = 792 writes per rider per shift
```

With 40 riders: **31 680 writes/day**. With 100 riders: **79 200/day**. Both fit, with the second
leaving 21% headroom. The full budget arithmetic, including the cadence floor and ceiling, is §8.

---

## 2. The schema

One table. Deliberately tiny.

```sql
-- workers/realtime/migrations/d1/001_tracking.sql
CREATE TABLE IF NOT EXISTS rider_positions (
    rider_id        TEXT    NOT NULL,
    seq             INTEGER NOT NULL,
    lat             REAL    NOT NULL,
    lon             REAL    NOT NULL,
    accuracy_m      INTEGER NOT NULL,
    bearing_deg     INTEGER,
    speed_mps       REAL,
    battery_pct     INTEGER,
    is_moving       INTEGER NOT NULL DEFAULT 1,
    order_id        TEXT,
    recorded_at     INTEGER NOT NULL,   -- device clock, epoch ms
    received_at     INTEGER NOT NULL,   -- edge clock, epoch ms
    PRIMARY KEY (rider_id, seq)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_positions_recent
    ON rider_positions (rider_id, seq DESC);

-- The single-row-per-rider current state, read by the map.
CREATE TABLE IF NOT EXISTS rider_current (
    rider_id        TEXT    PRIMARY KEY,
    shift_id        TEXT    NOT NULL,
    zone_id         TEXT    NOT NULL,
    vehicle         TEXT    NOT NULL,
    lat             REAL    NOT NULL,
    lon             REAL    NOT NULL,
    bearing_deg     INTEGER,
    speed_mps       REAL,
    accuracy_m      INTEGER NOT NULL,
    state           TEXT    NOT NULL,   -- ONLINE | ON_ORDER | BREAK
    active_order_id TEXT,
    batch_size      INTEGER NOT NULL DEFAULT 0,
    battery_pct     INTEGER,
    updated_at      INTEGER NOT NULL,
    stale_after     INTEGER NOT NULL    -- updated_at + the current cadence ceiling × 2
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_current_zone ON rider_current (zone_id, state);
```

### 2.1 Why two tables

`rider_current` is what the map reads — one row per online rider, so the admin map's query is
`SELECT * FROM rider_current WHERE zone_id IN (...)` and returns at most a few hundred rows.

`rider_positions` is the short trail, used for:
- drawing the last 2 minutes of the rider's path on the customer's tracking screen,
- computing bearing when the device does not supply it,
- the "rider stationary for > 10 minutes" exception detector,
- post-delivery distance verification against the fare's routed distance.

A position row is ~72 bytes. A rider's trail is capped at **120 rows** (§5), so the table's steady
state with 100 riders is 100 × 120 × 72 ≈ **864 KB**. D1's free tier allows 5 GB. The table never
grows, because of §5 and §6.

### 2.2 Why `WITHOUT ROWID`

SQLite's default table has a hidden rowid and the primary key becomes a secondary index — two
B-trees, two writes. `WITHOUT ROWID` stores the row in the primary key's B-tree directly. For a
table whose entire access pattern is "by `rider_id`, newest first", this halves the write cost and
removes an index lookup from every read. On a write-budgeted system that is not a micro-optimisation,
it is the difference between fitting and not.

---

## 3. The device-side gate

This is where the saving happens. The rider's phone decides whether a position is worth sending.

### 3.1 Location acquisition

```kotlin
// android/rider/src/main/kotlin/bd/undal/rider/location/LocationEngine.kt
//
// FusedLocationProviderClient with a request tuned for delivery work, not for
// navigation. We want frequent *candidates* so the displacement gate has fresh
// data to reject; we do not want the radio awake more than necessary.
private val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 4_000L)
    .setMinUpdateIntervalMillis(2_000L)
    .setMinUpdateDistanceMeters(0f)       // gating is ours, not the framework's
    .setWaitForAccurateLocation(false)
    .setMaxUpdateDelayMillis(8_000L)      // allows the OS to batch and save power
    .build()
```

`setMinUpdateDistanceMeters` is deliberately **0**. Delegating the gate to the framework sounds
appealing but is wrong: the framework's distance filter is implemented differently across OEMs, it
does not know about our cadence floor or ceiling, and it gives us no candidate positions to compute
speed and bearing from during the gap.

### 3.2 The gate

```kotlin
/**
 * Decides whether a freshly-acquired fix is worth a network write.
 *
 * The rules, in priority order:
 *   1. Reject fixes with accuracy worse than 60 m outright — they would move the
 *      marker without the rider moving, which is worse than no update.
 *   2. Force a write if the cadence CEILING has elapsed (the map must never look
 *      frozen even for a stationary rider).
 *   3. Suppress a write if the cadence FLOOR has not elapsed (protects the budget
 *      against GPS jitter and against a rider on a highway).
 *   4. Otherwise, write if displacement from the last SENT position is >= 100 m,
 *      or if the bearing has changed by more than 45 degrees (a turn is
 *      informative even within 100 m), or if the order state changed.
 */
fun shouldSend(fix: Fix, last: SentFix?, now: Long, cadence: Cadence): Decision {
    if (fix.accuracyM > ACCURACY_REJECT_M) return Decision.Drop(Reason.POOR_ACCURACY)
    if (last == null)                       return Decision.Send(Reason.FIRST_FIX)

    val elapsed = now - last.sentAt
    if (elapsed >= cadence.ceilingMs)       return Decision.Send(Reason.CEILING)
    if (elapsed <  cadence.floorMs)         return Decision.Drop(Reason.FLOOR)

    val moved = haversineMeters(last.lat, last.lon, fix.lat, fix.lon)
    if (moved >= cadence.displacementM)     return Decision.Send(Reason.DISPLACEMENT)

    val turned = angularDelta(last.bearing, fix.bearing)
    if (moved >= 30 && turned >= 45f)       return Decision.Send(Reason.TURN)

    if (fix.orderStateChanged)              return Decision.Send(Reason.STATE_CHANGE)

    return Decision.Drop(Reason.STATIONARY)
}
```

Every `Decision` is counted in a local Room table so the rider's own diagnostics screen — and the
admin panel's tracking-health report — can show exactly how many fixes were taken and how many were
sent. A rider whose send ratio is anomalous (spoofing, broken GPS, a hacked build) is visible.

### 3.3 Adaptive cadence

The floor, ceiling and displacement threshold are not constants. They adapt to what the rider is
doing, because a rider idling at home needs a different cadence from one carrying hot food to a
customer who is watching the map.

| Rider state | Displacement | Floor | Ceiling | Rationale |
| --- | --- | --- | --- | --- |
| `ONLINE`, no order, stationary | 150 m | 20 s | **300 s** | Nobody is watching. Five-minute heartbeat is enough for the admin map and for dispatch eligibility. |
| `ONLINE`, no order, moving | 150 m | 15 s | 120 s | Repositioning between zones. |
| `ON_ORDER`, heading to vendor | 100 m | 10 s | 60 s | The vendor wants to know when to start plating. |
| `ON_ORDER`, carrying, > 1 km from drop | 100 m | 8 s | 45 s | Customer is watching. |
| `ON_ORDER`, carrying, ≤ 1 km from drop | **60 m** | 6 s | 25 s | The last kilometre is where perceived accuracy matters most. |
| `ON_ORDER`, within 200 m of drop | **40 m** | 5 s | 15 s | "He's at the gate." |
| `BREAK` | — | — | **600 s** | One ping per ten minutes to prove the device is alive. |
| Battery < 15% | ×1.5 all thresholds | ×1.5 | ×1.5 | Finishing the shift matters more than marker smoothness. |
| Battery < 8% | ×2.5 | ×2.5 | ×2.5 | Survival mode; the UI tells the rider why. |

The cadence profile is pushed from the server in the shift-start response and updated via SSE when
the order state changes, so tuning does not require an app release.

### 3.4 Why the last kilometre gets a tighter gate

The budget arithmetic in §8 shows that tightening to 40 m within 200 m of the drop costs
approximately **4 extra writes per delivery**. At 500 orders/day that is 2 000 writes — 2% of the
daily budget — in exchange for the single most-watched moment of the entire customer experience.
That is the best trade in the document.

---

## 4. The upload path

### 4.1 Batched, compact, and tolerant of a dead network

Positions are not sent one HTTP request at a time. They are queued in Room and flushed:

- immediately when the queue holds a `Send(Reason.STATE_CHANGE)` or the rider is within 200 m of a
  drop,
- otherwise when the queue holds 3 positions or 25 seconds have passed, whichever comes first.

A flush is one `POST /rt/location/batch` carrying up to 12 positions. Typical flush: 2 positions,
~180 bytes of body after delta encoding.

### 4.2 Delta encoding

The first position in a batch is absolute. The rest are deltas in units of 1e-6 degrees (~0.11 m)
and milliseconds, which fit in small integers and compress well:

```jsonc
{
  "shiftId": "…",
  "base": { "lat": 24.894215, "lon": 91.868912, "t": 1762000123456 },
  "d": [
    [ 412, -238, 14200, 18, 42, 97 ],   // dLat, dLon, dt, accuracy, bearing, speed×10
    [ 390, -201, 13980, 16, 44, 101 ]
  ],
  "state": "ON_ORDER",
  "orderId": "…",
  "battery": 68
}
```

A 12-position batch is 410 bytes versus 2 900 bytes unencoded. On a rider's prepaid data plan over
an 8-hour shift this is the difference between ~2.3 MB and ~16 MB per day. Riders notice.

### 4.3 Offline buffering

Positions recorded while the network is unavailable are retained in Room with their original
`recorded_at`. On reconnection they are uploaded as a backfill batch flagged `"backfill": true`.
The Worker writes them to `rider_positions` but **does not** update `rider_current` from a stale
backfill — the marker jumps to the newest position only, and the trail fills in behind it. A marker
that rewinds is worse than a marker that was briefly absent.

Buffer cap: 400 positions (~45 minutes of dense movement). Beyond that the oldest are dropped, with
a counter so the diagnostics screen can say so.

### 4.4 The Worker handler

```ts
// workers/realtime/src/routes/location-batch.ts  (abridged; the real file is 210 lines)
//
// One D1 batch per request. D1 counts a batch of N statements as N writes against
// the daily quota, so the only thing that saves budget is sending fewer rows —
// which is the device's job, not ours. What we save here is *round trips*.
export async function postLocationBatch(c: Context<Env>) {
  const body = LocationBatchSchema.parse(await c.req.json());
  const rider = c.get("rider");

  const positions = decodeDeltas(body);              // pure, tested with 60 vectors
  const accepted = positions.filter(p => isPlausible(p, rider.lastKnown));

  const stmts = accepted.map(p =>
    c.env.TRACKING.prepare(
      `INSERT OR REPLACE INTO rider_positions
         (rider_id, seq, lat, lon, accuracy_m, bearing_deg, speed_mps,
          battery_pct, is_moving, order_id, recorded_at, received_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(/* … */)
  );

  const newest = accepted.at(-1);
  if (newest && !body.backfill) {
    stmts.push(upsertCurrent(c.env, rider, newest));
    stmts.push(pruneTrail(c.env, rider.id));         // see §5
  }

  await c.env.TRACKING.batch(stmts);

  // Fan out to anyone watching: the customer, the vendor, the admin map.
  c.executionCtx.waitUntil(broadcastPosition(c.env, rider, newest));

  return ok({ accepted: accepted.length, nextCadence: cadenceFor(rider) });
}
```

### 4.5 Plausibility checks

`isPlausible()` rejects positions that cannot be real, which is both a data-quality measure and the
anti-spoofing layer:

| Check | Threshold | Action |
| --- | --- | --- |
| Implied speed from the previous accepted fix | > 40 m/s (144 km/h) for a motorbike, > 15 m/s for a bicycle | Reject, increment `teleport_count` |
| Accuracy | > 60 m | Reject |
| Timestamp in the future | > 30 s ahead of edge clock | Reject, flag device clock skew |
| Timestamp older than the newest accepted | any | Reject unless `backfill` |
| Position outside the zone's bounding box inflated by 20 km | — | Reject, raise an admin exception |
| `mock location` flag set by the OS | — | Reject the whole batch, suspend the shift, raise a `CRITICAL` exception |

A rider accumulating `teleport_count` is surfaced in the admin panel. Three distinct shifts with
teleports triggers a manual review. Mock-location detection is immediate and automatic.

---

## 5. The ring buffer

`rider_positions` must never grow. The trail is capped at **120 rows per rider** by making `seq` a
modular counter:

```ts
const seq = (previousSeq + 1) % TRAIL_CAPACITY;   // TRAIL_CAPACITY = 120
```

With `INSERT OR REPLACE` and the primary key `(rider_id, seq)`, writing position 121 overwrites
position 1. There is no `DELETE`, no vacuum, no growth, and the row count is bounded at
`online_riders × 120` by construction rather than by a cleanup job that might not run.

Reading the trail in order requires reassembling around the wrap point:

```sql
SELECT * FROM rider_positions
WHERE rider_id = ?1
ORDER BY recorded_at DESC
LIMIT 40;
```

Ordering by `recorded_at` rather than `seq` sidesteps the wrap entirely. The index on
`(rider_id, seq DESC)` is used for the prune check; this query does a small scan of at most 120 rows
in a single B-tree page range, which is sub-millisecond.

**120 was chosen** because at the tightest cadence (5 s floor) it covers 10 minutes, and at a
typical 20 s cadence it covers 40 minutes — longer than any single delivery leg.

---

## 6. Erasure

The brief is explicit: *"THE SYSTEM IMIDIETLY ERASE THE RIDER REAL TIME LOCATION DATA FROM THE D1"*
when the rider goes offline or ends their shift.

### 6.1 The erasure triggers

| Trigger | Latency target | Mechanism |
| --- | --- | --- |
| Rider taps **End shift** | < 1 s | Synchronous in the `POST /rt/shift/end` handler, before the response |
| Rider taps **Go offline** | < 1 s | Same |
| Presence engine declares the rider offline (no heartbeat) | < 5 s | `ZoneHub` alarm fires the erase |
| Admin force-ends a shift | < 1 s | Synchronous |
| App uninstalled / token invalid | next zone sweep, < 60 s | `ZoneHub`'s 60 s housekeeping alarm |

```sql
-- Both statements in one D1 batch. Two writes, once per shift. Negligible.
DELETE FROM rider_positions WHERE rider_id = ?1;
DELETE FROM rider_current   WHERE rider_id = ?1;
```

### 6.2 What survives, and where

Erasure removes the **live channel**, not the business record. What is retained in CockroachDB:

| Retained | Table | Why |
| --- | --- | --- |
| Shift start and end points | `rider_shifts.start_point`, `end_point` | Payout verification, zone analytics |
| Total shift distance | `rider_shifts.distance_m` | Accumulated on the device and confirmed server-side |
| Pickup and delivery points per order | `orders.pickup_point`, `delivery_point` | Already on the order |
| Delivery proof location | `order_proofs.point` | Dispute resolution |

What is **not** retained anywhere: the breadcrumb trail. Undal does not keep a history of where its
riders were minute by minute. That is a deliberate privacy position, it is stated in the rider
privacy notice in plain Bangla, and it has the convenient property of also being the cheapest
option.

---

## 7. Client-side interpolation — making sparse data feel live

A position every 20 seconds, rendered literally, is a marker that teleports. This is the single
biggest perceived-quality difference between a cheap tracking screen and an expensive one, and it is
solved entirely on the client at zero infrastructure cost.

### 7.1 The algorithm

```
On receiving position P_new at time T_new, with the previous P_old at T_old:

1.  If a route polyline exists for the current leg (it does, from the fare quote's
    OSRM response, cached on the client), SNAP both P_old and P_new to the polyline,
    yielding arc-length offsets s_old and s_new.

2.  If snapping fails (rider is off-route by > 80 m), fall back to a straight line
    and simultaneously request a fresh route, because the rider has genuinely
    deviated.

3.  Animate the marker along the polyline from s_old to s_new over a duration of
          D = clamp(T_new - T_old, 1200 ms, 8000 ms)
    using the critically-damped spring `motion.spring.map` (doc 04 §2.1).

4.  While animating, continuously set the marker's bearing to the polyline's
    tangent, interpolated by shortest arc.

5.  If the animation completes and no new position has arrived, DEAD-RECKON:
    continue advancing along the polyline at the last known speed, decaying the
    speed by 12% per second, for at most 6 seconds. Then stop and begin the
    staleness treatment (§7.2).

6.  If a new position arrives that is more than 60 m from the predicted point,
    do not snap instantly — re-path and ease over 400 ms.
```

Snapping to the route is what makes the difference. A marker interpolated in a straight line cuts
corners and drives through buildings. A marker interpolated along the actual road looks like a
vehicle.

### 7.2 Staleness, honestly

When no position has arrived for longer than `stale_after`, the UI must say so rather than lie:

| Age | Treatment |
| --- | --- |
| < ceiling | Normal. Marker moves, live pulse active. |
| ceiling → 2× ceiling | Marker desaturates to 60%, pulse stops, a small clock badge appears. |
| 2× ceiling → 3 min | Marker greys fully. Customer sees "Locating your rider…". Admin sees "Last seen 2m 10s ago". |
| > 3 min | Marker shows a question-mark badge. The admin exception tower raises `RIDER_SIGNAL_LOST`. Customer is told "We've lost signal from your rider — your order is still on the way" and given the call button prominently. |

Note the customer-facing copy never implies the order is lost. The rider is almost always fine and
in a lift or a dead zone; the message should reduce anxiety, not manufacture it.

---

## 8. The write budget, proven

### 8.1 Per-delivery write count

A typical 3.8 km motorbike delivery:

| Leg | Distance | Avg speed | Cadence | Writes |
| --- | --- | --- | --- | --- |
| Accept → vendor | 1 200 m | 20 km/h | 100 m | 12 |
| At vendor (waiting) | 0 | 0 | 60 s ceiling | 4 |
| Vendor → within 1 km of drop | 1 600 m | 22 km/h | 100 m | 16 |
| Last 1 km → 200 m | 800 m | 18 km/h | 60 m | 13 |
| Final 200 m | 200 m | 10 km/h | 40 m | 5 |
| At door | 0 | 0 | 15 s ceiling | 4 |
| **Per delivery** | **3 800 m** | | | **54** |

Plus 2 writes for shift start and 2 for erasure, amortised.

### 8.2 Daily totals

| Scenario | Orders/day | Deliveries per rider | Riders | Idle writes | Delivery writes | **Total/day** | % of 100 000 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Launch | 60 | 6 | 10 | 1 100 | 3 240 | **4 340** | 4.3% |
| Growing | 200 | 8 | 25 | 2 600 | 10 800 | **13 400** | 13.4% |
| **Target** | **500** | **10** | **50** | **5 100** | **27 000** | **32 100** | **32.1%** |
| Stress | 1 200 | 12 | 100 | 9 800 | 64 800 | **74 600** | 74.6% |
| Breaking point | ~1 650 | 12 | 138 | 13 500 | 89 100 | **102 600** | **over** |

**Undal fits comfortably to approximately 1 600 orders/day on D1's free tier.** Beyond that the
options, in order of preference, are documented in [`39 §3.4`](39-risk-register-and-truths.md):
loosen the idle ceiling (buys ~15%), raise the base displacement to 120 m (buys ~18%), or pay $5 for
Workers Paid which raises D1 to 50 M writes/day and removes the ceiling entirely for years.

### 8.3 Read budget

The admin command map is the heavy reader. It polls `rider_current` per zone every 3 seconds while
open:

```
1 admin × 8 h × 1200 polls/h = 9 600 reads/day
```

Each poll is one query returning N rows, counted by D1 as **rows read**, so with 50 riders it is
50 rows × 9 600 = 480 000 row-reads/day. Against 5 M that is 9.6%. With four concurrent admin
sessions it is 38%. Acceptable, and reduced further by:

- The map subscribes to SSE and only polls as a 30-second reconciliation safety net when SSE is
  healthy, cutting polls by 90%.
- Customer tracking screens never query D1 directly; they receive positions over SSE pushed by the
  same `broadcastPosition` that already ran on the write path. **Zero additional reads.**

### 8.4 The verification test

`workers/realtime/test/budget.test.ts` replays **12 real GPS traces** (anonymised, recorded on
Sylhet delivery routes, stored as fixtures under `test/` where they are allowed) through the gating
algorithm and asserts:

```
expect(writesPerDelivery).toBeLessThan(70);
expect(writesPerIdleHour).toBeLessThan(45);
expect(simulate({ orders: 500, riders: 50 }).dailyWrites).toBeLessThan(40_000);
```

This test is the proof behind non-negotiable 26. If a cadence change pushes the budget over, CI
fails before the change can ship.

---

## 9. Fan-out: who sees a position and how

```
                    Device sends batch
                            │
                            ▼
              ┌─────────────────────────────┐
              │ undal-realtime              │
              │  POST /rt/location/batch    │
              │  ├─ write D1                │
              │  └─ broadcastPosition()     │
              └──────────────┬──────────────┘
                             │
        ┌────────────────────┼─────────────────────┐
        ▼                    ▼                     ▼
┌───────────────┐   ┌─────────────────┐   ┌──────────────────┐
│ OrderHub DO   │   │ ZoneHub DO      │   │ (nothing else)   │
│ for the rider's│  │ for the rider's │   │ A rider with no  │
│ active order  │   │ zone            │   │ order and no     │
└───────┬───────┘   └────────┬────────┘   │ admin watching   │
        │                    │             │ costs 1 D1 write│
        ▼                    ▼             │ and nothing more│
  SSE to customer      SSE to admin        └──────────────────┘
  SSE to vendor        command map
```

Channel authorisation:

| Channel | Who may subscribe | Enforced by |
| --- | --- | --- |
| `order:{code}:rider` | The order's customer, the order's vendor, any admin with `order.view` | `OrderHub` checks the session against the order |
| `zone:{id}:riders` | Admins with `fleet.view` scoped to that zone | `ZoneHub` checks RBAC + `zone_scope` |
| `rider:{id}:self` | The rider themselves | Session identity |

A customer can see the rider assigned to **their** order and nothing else. The subscription is torn
down automatically when the order reaches `DELIVERED`. There is no endpoint, anywhere, that returns
the position of a rider who is not currently delivering to the caller.

---

## 10. Privacy

| Principle | Implementation |
| --- | --- |
| Collect only while working | Location is captured only between shift start and shift end. The foreground service notification says so, with the elapsed time. |
| Erase immediately | §6. |
| Never retain a trail | §6.2. |
| Never expose to a third party | No analytics SDK, no ad SDK, no crash reporter receiving location. |
| Show the rider what is collected | The rider app has a "What Undal knows about my location" screen showing the current row, the trail length, and a live counter of today's uploads. No other platform shows this. |
| Rider can see who is watching | When a customer opens the tracking screen, the rider's app shows a subtle "customer is watching" indicator. It is honest and it also, usefully, encourages good driving. |
| Consent is explicit and revocable | Going offline revokes it. There is no background location permission request outside an active shift. |

Android permissions requested: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, and
`FOREGROUND_SERVICE_LOCATION`. **`ACCESS_BACKGROUND_LOCATION` is deliberately not requested.** The
foreground service covers the entire shift, which is the only time location is needed, and avoiding
the background permission avoids both the Play Store review burden and a genuine privacy overreach.

---

## 11. Failure modes

| Failure | Detection | Behaviour |
| --- | --- | --- |
| D1 write fails | Error response | Position stays in the Room queue and retries with backoff. `rider_current` keeps the previous value, so the marker goes stale honestly rather than disappearing. |
| D1 read fails on the map | Error | Map keeps the last rendered positions and shows a connection banner. Markers get the staleness treatment. |
| Device clock is wrong | `recorded_at` vs `received_at` skew > 30 s | The Worker rewrites `recorded_at` to `received_at` minus the batch's internal deltas, and flags the device. |
| GPS drifts while stationary | Displacement gate | Suppressed by the 100 m gate; the jitter never reaches the network. This is the gate's unglamorous main job. |
| Rider enters a tunnel or lift | No fix for 45 s | Dead reckoning for 6 s, then staleness (§7.2). |
| Rider force-stops the app | No heartbeat | Presence engine declares offline in 2 s, erasure in < 5 s, order enters `REASSIGNING` if one was active. |
| Two devices logged in as the same rider | Session device binding | Second login revokes the first; the first receives a `SESSION_REVOKED` SSE and logs out. Positions from the revoked session are rejected. |
| Rider spoofs location | Mock-location flag, implausible speed | Batch rejected, shift suspended, `CRITICAL` exception, manual review before reinstatement. |

---

## 12. Reading on

Next: [`08-api-contract.md`](08-api-contract.md) — every endpoint.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
