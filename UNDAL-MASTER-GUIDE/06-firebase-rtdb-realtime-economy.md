# 06 · Firebase RTDB — The Realtime Economy (Spark-plan survival design)

Spark reality: **100 simultaneous connections**, 1 GB stored, 10 GB/month download. A naive “everyone subscribes to
everything” design dies at ~33 concurrent orders. Undal's economy makes connections a *leased resource tied to active work*.

## 6.1 What lives in RTDB (ephemeral only — Postgres remains truth)

```
o/{orderId}/            ← active-order room (created at placement, deleted ≤1 h after terminal state)
  s: "preparing"        status mirror (string, tiny)
  eta: 1729...          ETA epoch seconds
  v: {la,ln}  c:{la,ln} vendor/customer pins (rounded 5 dp ≈ 1 m)
  loc:{la,ln,h,sp,ts}   rider live point (heading, speed, server ts)
  chat/{msgId}:{f,t,b,ts,k}   fan-out copy (body ≤500 chars; media = private-bucket ref only)
  offer:{riderId, exp}  current offer + expiry
p/v/{vendorId}:{on:1,ts}      vendor presence heartbeat (only while Partner app foregrounded/online-shift)
p/r/{riderId}:{on,la,ln,ts,z} rider presence (only while in session)
inbox/{profileId}/last:{...}  lightweight “something changed, refetch” ping target (single node overwrite)
```

Keys are single letters, numbers rounded, no pretty JSON — every byte is download quota. No order items, no prices,
no PII beyond display names needed mid-order, **no history** (chat persists to Postgres at send-time; RTDB copy is transport).

## 6.2 Connection lease rules (the “ultra-smart” system, specified)

| Actor | Subscribes when | Detaches when | Conns |
|---|---|---|---|
| Customer | Order active **and** tracking/chat screen open (or app foregrounded with active order) | Terminal state, or app backgrounded >60 s (FCM nudges cover background) | 1/order |
| Vendor | Any active order exists for outlet, or Live-Orders tab open while online | No active orders + tab closed (FCM wakes for new) | 1/outlet-device |
| Rider | In session (presence + own offer node) + active delivery room | Session end / delivery complete | 1–2 |
| Admin | Dispatch board open (aggregated via W2 snapshot polling every 5 s for fleets; direct RTDB only for single-order focus) | Board closed | ≤2/operator |

Budget math (launch): 30 concurrent active orders ≈ 30 customers + ~18 vendors + ~22 riders + 2 admin ≈ **72 conns** worst-case
foreground — inside Spark with headroom; typical (many backgrounded) ≈ 35. **Overflow behaviour (never crash):** connection
failures degrade to 5-second W1 polling of `GET /v1/orders/{id}/live` (same payload shape) — UI identical, freshness 5 s.

## 6.3 Write throttling (protecting 10 GB/mo + battery)

- Rider GPS: emit on **25 m displacement OR 4 s** (whichever first) while on-delivery; 60 s heartbeat while idle-in-session;
  dead-reckoning interpolation on customer map (smooth dot, fewer points). Batch 3 points when network flaps (local queue).
- Presence: vendor/rider heartbeat 10 s foreground (single tiny node overwrite); W2 marks stale >25 s (D-05).
- Status/ETA: write-on-change only; ETA recomputed server-side at most every 15 s per order.
- Estimated usage at 300 orders/day, avg 25 min tracked: ≈ 300 × 375 pts × ~90 B ≈ **10 MB/day up**, downloads ×3 viewers ≈ **0.9 GB/mo** ✓.

## 6.4 Security rules (`firebase/database.rules.json`, deployed by Actions)

Custom-claims-free model: RTDB auth via **Firebase custom tokens minted by W2** from the caller's Supabase JWT
(uid = profile id, claims: `role`, `vendor_id?`, `rider_id?`). Rules: `o/{id}` readable/writable only by that order's
customer/vendor/rider (IDs mirrored in room meta at creation by W2 service account); presence writable only by self;
`.validate` caps (lat/lng ranges, string lengths, ts = server time). Default deny. Rules unit-tested with the RTDB
emulator in CI (file `26`). Service-account writes (W2 REST) bypass rules — W2 is the only RTDB *creator* of rooms.

## 6.5 Lifecycle & cleanup

Room created by W2 on order placement → terminal state triggers `closed_at`; W3 cron (hourly) deletes rooms closed >1 h,
presence nodes stale >10 min. Storage stays near-zero; download quota spent only on live value. A “realtime kill-switch”
setting (`realtime_mode: rtdb|polling`) lets Admin degrade gracefully during any Firebase incident — orders never stop.

## 6.6 Offline & conflict behaviour (apps)

Flutter RTDB listeners with disk persistence OFF for rooms (stale live data is worse than none) + explicit `last_sync_at`
UI chip (“Live · updated 2 s ago” / “Reconnecting…”). Actions taken offline (partner accept, rider arrived) queue in a
local outbox with idempotency keys; on reconnect W1 replays in order; server rejects impossible transitions with a
human explanation shown to the actor (never silent drop) — see file `22` §7.
