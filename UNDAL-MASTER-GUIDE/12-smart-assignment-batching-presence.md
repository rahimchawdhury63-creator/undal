# 12 · Smart Assignment, Batching, Presence & Prep Intelligence (“the brain”)

## 12.1 Presence (who is really available — D-05)

Sources: Partner/Rider heartbeat 10 s (foreground in-session) → W2 → `presence_live(profile_id, kind, lat, lng, zone_id,
capacity, last_seen_at, app_state)`. Derived states: `LIVE` ≤25 s · `STALE` 25–60 s (no new offers, keep current work) ·
`OFFLINE` >60 s (vendor surface status `offline`, rider excluded). Vendor `operational_status` =
hours × pause × presence × suspension, computed centrally every 15 s sweep + on read; customer feed uses the same function
(a vendor who vanishes mid-service disappears from the feed within a minute — no ghost kitchens taking money).

## 12.2 Assignment scoring (single order → best rider)

Candidates: `LIVE`, in-session, zone match (or adjacent-zone bleed setting), vehicle-radius feasible, capacity free
(max concurrent: bicycle 2, motorbike 3 incl. batches — settings), cash-in-hand below zone ceiling, not in cash-gate block.
Score (0–100, weights in settings, defaults shown):

```
score = 34 × proximity        // 1 − min(1, eta_to_vendor / 12 min)   (ETA via OSRM/haversine+speed profile)
      + 22 × readiness_sync   // arrives 0–5 min before prep-ready = perfect; too-early/late decays (food heat law)
      + 16 × reliability      // completion_rate 30d × acceptance_health (rejections with valid reasons weighted less)
      + 10 × rating           // rider rating 90d normalised
      + 10 × fairness         // idle-time boost: longest-waiting capable rider drifts up (anti-starvation)
      +  8 × batch_fit        // already heading to same vendor/drop corridor (feeds §12.4)
      − penalties: recent failed delivery review hold, low battery reported, GPS accuracy poor
```

Offer cascade: best rider 30 s → next (excluding rejecters with reason logged) → after K=3 or 90 s, widen radius +10% fare
recompute (surge snapshot refreshes — rider sees updated fare) → after 4 min unassigned: Admin exception + customer honest
delay notice with cancel-free option. Assignment is *explainable*: top factors stored on the offer (Admin “why this rider?”).

## 12.3 Reject/target rules (D-23 implementation)

Reject button active only if ≥1 other candidate exists at offer time; else label “Request reassign” → dispatcher re-scores
with widened radius and, if truly alone, Admin live alert (rider never forced into an unsafe/impossible trip — reason chips:
vehicle issue, too far, personal emergency, area unsafe, other+text). Rejection rate feeds `reliability` softly
(valid emergency reasons excluded by Admin review tags).

## 12.4 Batch builder (founder's bundle-pickup case, generalised)

Trigger scan (on each vendor-accept + 20 s sweep): group unassigned/preparing orders by vendor-cluster (same vendor or ≤300 m),
ready-window overlap ≤8 min, pairwise drop detour ≤6 min (OSRM matrix, fallback haversine), total load ≤ bag, max 3 orders,
vehicle feasibility. Solve pickup→drop sequence by min total time with “no order rides >18 min post-pickup” heat constraint
(priority orders excluded). Present as one offer (file `11` §4 economics). If a member is cancelled mid-batch, re-sequence
survivors and notify — never orphan an order silently. Metrics: batch save-rate + on-time% in Admin; auto-disable batching
per zone if on-time% < threshold (self-protecting intelligence).

## 12.5 Smart prep-time default (vendor accept sheet, D-22)

```
suggested_prep = clamp(5, 200,
    vendor_item_prep_baseline (learned per item from history; cold-start = category priors)
  × kitchen_load_factor (open orders' Σprep_weight / capacity)
  + weather/zone stress adder (storm +5, peak-hour learned adder)
)
```
Vendor adjusts with −/+ (1-min steps, long-press ±5) + chips; >60 min needs reason chip. Committed prep drives rider
dispatch timing (don't send the rider to wait: dispatch so arrival ≈ ready −2 min) and customer ETA. Actual-vs-committed
error feeds vendor reliability + future suggestions (the system learns each kitchen — “AI-beating” = statistics done honestly).

## 12.6 ETA engine (customer-facing promise)

ETA = max(prep_ready_at, rider_arrive_vendor_at) + loaded_leg_time(traffic-calibrated speeds per zone/vehicle/hour —
calibration table updated nightly from completed trips) + handover buffer 2 min. Displayed as a range (±5). Recomputed on
every state change + 30 s tick while active; if ETA slips >10 min, proactive customer notification + support visibility
(exception rules file `20`). Pickup ETA = prep_ready_at only (+ “we'll notify when ready”).

## 12.7 Edge-case matrix (founder: “respond to every possible case” — v1 contract)

Vendor accepts then goes offline mid-prep → rider still dispatched at ready-time; vendor flagged; if unreachable at pickup
+rider confirms closed (photo) → cancel `VENDOR_CLOSED_AT_PICKUP`, rider paid to-vendor leg. · Rider app dies mid-delivery →
presence stale alerts Admin at 3 min silence with last location; customer sees “reconnecting” not fake motion; on rider
return, telemetry gap annotated. · Customer wrong pin → in-order “share corrected pin” (once, ≤500 m shift free; beyond =
Admin approval + fare adjust). · Rain surge mid-order → locked fare honoured (new offers only). · Two customers, one rider,
one cancels → batch re-sequence (§12.4). · Zone with zero riders → vendor accept sheet warns “no riders nearby — expect delay”
*before* committing prep. Each case has a test in Appendix F.
