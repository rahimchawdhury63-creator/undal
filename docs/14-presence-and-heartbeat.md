<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 14 — Presence and Heartbeat

> The brief: *"if an vendor or Rider went offline or not connected to the internet the platform
> should know in 2 seconds and update their state and alert them to check-in again"* and *"if the
> vendor device is not reachable the order should be cancelled after 2 minutes with reason."*
> Two seconds is a hard number. This document shows how it is achieved with no cron, no polling
> worker, and no paid infrastructure.

---

## 1. Why two seconds is hard

The obvious design — a worker that wakes every second and checks who has not reported in — is
forbidden twice over: by the no-cron rule and by Cloudflare's free tier, which has no always-on
compute at all. Even if it were allowed, it would mean scanning every vendor and rider every
second, which is both expensive and pointless, since almost nothing changes.

The solution inverts the question. Instead of asking *"who is late?"* on a timer, Undal makes
**each connection responsible for its own death notice**, and gives every participant a
self-executing deadline.

Three mechanisms, layered:

| Layer | Detects | Latency | Cost |
| --- | --- | --- | --- |
| **A. Transport close** | App killed, network dropped, device slept, tab closed | **< 200 ms** | Zero — it is a TCP/WebSocket event |
| **B. Heartbeat deadline** | Device alive but network silently broken (captive portal, dead zone, frozen app) | **≤ 2 000 ms** | One timer per connected device |
| **C. Action probe** | Device claims to be present but is not responding to real work | 0–8 s | Only on an actual order |

Layer A does the overwhelming majority of the work and costs nothing. Layer B exists because
TCP does not always notice a broken network, particularly on mobile. Layer C is the final
guarantee that the brief's auto-cancel rule rests on.

---

## 2. Layer A — Transport close

Every partner and rider app holds **one** long-lived connection to `undal-realtime` whenever it is
in the foreground or running its foreground service:

```
wss://realtime.{domain}/v1/presence?role=PARTNER&v=1
Authorization: Bearer …          (sent in the subprotocol header)
```

The connection is accepted by the zone's `ZoneHub` Durable Object (or, on the free-tier
coordinator, registered in `presence_sessions` with the Worker holding the socket). Cloudflare
delivers a `close` event to the DO the instant the socket drops — a process kill, an airplane-mode
toggle, a swipe-away, a lost tower — and the handler runs immediately:

```ts
// workers/realtime/src/hubs/ZoneHub.ts  (excerpt)
async webSocketClose(ws: WebSocket, code: number, reason: string, clean: boolean) {
  const s = this.sessions.get(ws);
  if (!s) return;
  this.sessions.delete(ws);

  // A clean close with code 4001 means "I am going offline deliberately" —
  // the user pressed the switch. Anything else is a loss of presence.
  const deliberate = clean && code === CLOSE_GOING_OFFLINE;

  await this.markAbsent(s, {
    reason: deliberate ? "USER_OFFLINE" : "TRANSPORT_CLOSED",
    code, detectedAt: Date.now(),
    // A short grace ONLY for involuntary closes, because mobile networks
    // hand off between towers and a 1.5s blip should not take a vendor
    // offline mid-service. A deliberate close takes effect instantly.
    graceMs: deliberate ? 0 : RECONNECT_GRACE_MS,   // 1500
  });
}
```

### 2.1 The reconnect grace

`RECONNECT_GRACE_MS = 1500`. If the same `(actor_id, device_id)` reconnects within the grace
window, the absence is cancelled and nothing is published — no state flap, no spurious alert, no
noise in the audit log. This is what makes the system usable on a real mobile network.

With grace, the worst-case detection is `200 ms + 1 500 ms + 100 ms = 1.8 s`, inside the
two-second requirement. The third term is the database (D91): publishing an absence on the free
path costs two store operations — the row that marks the device gone and the read that proves it —
and a budget that ignored them would be promising a number the store cannot keep.

### 2.2 Why the grace is not longer

A longer grace would reduce flapping further, but it would eat the budget. 1 500 ms is the measured
95th percentile of a tower handoff reconnect on a 4G network in Sylhet with the reconnect strategy
in §5. It is a tuned value in `platform_config.presence_grace_ms`, range-limited to `[0, 1700]` so
no operator can accidentally break the two-second contract. The range's top is derived rather than
chosen: 2 000 ms minus the transport's 200 ms estimate minus the database's 100 ms allowance (D91),
and at 1 700 ms the worst case is exactly 2 000 ms.

---

## 3. Layer B — The heartbeat deadline

A silently broken network keeps the socket "open" from Cloudflare's perspective while nothing can
actually traverse it. The defence is a deadline that the *server* owns.

### 3.1 The contract

| Party | Obligation |
| --- | --- |
| **Client** | Send `{"t":"hb","s":<seq>}` every **750 ms** while connected |
| **Server** | On each `hb`, reply `{"t":"hb_ack","s":<seq>,"now":<epochMs>}` and reset the deadline alarm to `now + 2 000 ms` |
| **Server** | If the alarm fires, the device is absent — publish immediately |
| **Client** | If three consecutive `hb_ack`s are missed (2 250 ms), tear down the socket and reconnect rather than waiting |

A 750 ms interval against a 2 000 ms deadline tolerates **two** consecutive lost heartbeats before
declaring absence. One lost packet is routine; two in a row is a real problem.

### 3.2 Durable Object alarms

```ts
async handleHeartbeat(ws: WebSocket, msg: HeartbeatMsg) {
  const s = this.sessions.get(ws)!;
  s.lastHb = Date.now();
  s.seq = msg.s;
  ws.send(JSON.stringify({ t: "hb_ack", s: msg.s, now: s.lastHb }));

  // One alarm per DO, always set to the EARLIEST deadline among all sessions.
  // When it fires we sweep only the expired ones — O(expired), not O(sessions).
  await this.scheduleNextDeadline();
}

async alarm() {
  const now = Date.now();
  const expired = [...this.sessions.values()].filter(s => now - s.lastHb > HB_DEADLINE_MS);
  for (const s of expired) {
    await this.markAbsent(s, { reason: "HEARTBEAT_TIMEOUT", detectedAt: now, graceMs: 0 });
    try { s.ws.close(4408, "heartbeat timeout"); } catch { /* already gone */ }
    this.sessions.delete(s.ws);
  }
  await this.scheduleNextDeadline();
}
```

This is **not** a cron job and the distinction is not semantic. A cron runs on a schedule
regardless of state; a DO alarm is a one-shot timer set to a specific instant, derived from a
specific connection's specific deadline, cancelled when that connection speaks. With no connected
devices there is no alarm and the DO is evicted from memory entirely. The `no-cron` CI job
([`30`](30-testing-and-verification.md)) allows `storage.setAlarm` and forbids
`[triggers] crons` in any `wrangler.toml`.

### 3.3 On the free-tier coordinator

Without Durable Objects, `undal-realtime` keeps the WebSocket inside the Worker invocation and the
deadline inside a plain `setTimeout`. The Worker lives as long as the socket does, which is exactly
what is needed. Absence is written to `presence_sessions` in TiDB and published through the SSE
fan-out path.

A beat is a frame; a row write is a stamp, and they are not the same event (D89). The `sql` backend
writes the device's row at most once per 15 s of beating, so 38 400 beats over an eight-hour shift cost
1 921 writes rather than 76 800 store operations — and a stamped row is read as alive for
`presenceWindowMs` (the stamp interval plus the heartbeat deadline), not for the two seconds a
per-beat row would allow. The two-second deadline itself is unchanged: it is enforced by the process
holding the socket, and expiry is an explicit `markAbsent`, never a row silently missing from a list.

The measured difference: p50 detection 1.7 s (DO) versus 1.9 s (free). Both inside two seconds.
Both are implemented, both are tested, and `COORDINATION_MODE` selects between them
([`05 §4.2`](05-system-architecture.md)).

### 3.4 Heartbeat cost

| | Per device | 50 riders + 40 vendors |
| --- | --- | --- |
| Messages/s | 1.33 | 120 |
| Bytes/s (payload) | 38 | 3.4 KB |
| Messages/day (12 h active) | 57 600 | 5.2 M |

WebSocket messages are **not** billed as Worker requests on Cloudflare; only the initial upgrade
is. The DO wall-clock time is the real cost, and it is dominated by the connection duration rather
than the message count. On the free-tier path there are no DOs and the cost is a long-running
Worker invocation, also unbilled per-message.

---

## 4. Layer C — The action probe and the two-minute cancel

The brief's hardest presence rule:

> *"if an vendor device is not reachable then the order should be cancelled after 2 minutes with
> the reason 'vendor device was unreachable'."*

### 4.1 The escalation ladder

An order reaches `PLACED` and the vendor must accept it.

| T | Action | Vendor `open_state` |
| --- | --- | --- |
| 0 s | Order published to the vendor's socket; **data-only FCM** sent in parallel, always, even if the socket looks healthy — belt and braces ([`15`](15-wakeup-alarm-fcm.md)) | unchanged |
| 0 s | The looping alarm starts on the partner device | |
| 8 s | No `order.seen` ack → **probe**: a `ping_required` frame demanding a reply within 2 s | unchanged |
| 10 s | No probe reply → `UNREACHABLE`. The vendor is **hidden from ranking** ([`13 §4`](13-ranking-personalization.md)), a second FCM is sent, and the customer is told *"Confirming with the restaurant…"* | **`UNREACHABLE`** |
| 25 s | Third FCM, with `collapse_key` set so it replaces rather than stacks | |
| 45 s | The vendor's **backup contact** (a second device or phone number captured at onboarding) is alerted by FCM and, where configured, by a voice-call webhook | |
| 60 s | Admin exception raised: `VENDOR_UNREACHABLE`, severity HIGH, order pinned on the command map | |
| 90 s | The customer is offered an **early out**: *"The restaurant hasn't confirmed yet. Cancel now, or keep waiting?"* | |
| **120 s** | **Auto-cancel.** `AUTO_CANCELLED`, reason code `VENDOR_DEVICE_UNREACHABLE`, customer-facing text *"The restaurant's device was unreachable."* | stays `UNREACHABLE` |

At every step, a single `order.seen` or `order.accept` from the vendor **stops the whole ladder**
and restores `open_state` to its prior value.

The implementation is `VendorAlarm` (`workers/realtime/src/hubs/vendor-alarm.ts`) — one Durable
Object per order, one alarm armed at the next unfired rung, and the ladder's record in that room's
storage rather than in an isolate's memory (D84). The terminal rung is a request to `undal-core`
(`POST /internal/orders/auto-cancel`), because the order's state is core's to write; a room with no
sender refuses to begin rather than keeping a ladder it cannot ring, and a room with no canceller
records that it could not cancel instead of claiming it did.

### 4.2 The cancellation

```ts
async autoCancelUnreachable(orderId: string) {
  // Idempotent: a vendor accepting at 119.8s must win, and this must become
  // a no-op rather than a second cancellation.
  const o = await core.orders.getForUpdate(orderId);
  if (o.state !== "PLACED") return { skipped: true, state: o.state };

  await core.orders.transition(orderId, "AUTO_CANCELLED", {
    reasonCode: "VENDOR_DEVICE_UNREACHABLE",
    reasonText: {
      en: "The restaurant's device was unreachable.",
      bn: "রেস্টুরেন্টের ডিভাইসে সংযোগ পাওয়া যায়নি।",
    },
    actor: "SYSTEM",
    evidence: {                 // everything an appeal would need
      lastSeenAt: o.vendorLastSeenAt,
      socketState: "CLOSED",
      fcmAttempts: 3,
      fcmMessageIds: [...],
      probesSent: 4,
      probeRepliesReceived: 0,
      backupContactAlertedAt: …,
      ladder: [ /* every step with its timestamp */ ],
    },
  });

  await vendors.recordUnreachableIncident(o.vendorId, orderId);
  await notifications.customerCancelled(o, { credit: 5000, apology: true });
  await notifications.vendorMissedOrder(o.vendorId, o);
  await exceptions.resolve("VENDOR_UNREACHABLE", orderId, "AUTO_CANCELLED");
}
```

Nothing was charged — the platform is cash-on-delivery — so there is no refund to process. The
customer receives a **৳50 credit** and a genuine apology. The cost is borne by the platform.

The `evidence` block is the part that makes this defensible. A vendor who disputes the
cancellation is shown exactly when their device was last seen, how many notifications were sent,
and the message IDs — which they can verify independently in their own Firebase console if they
wish.

### 4.3 Consequences for the vendor

| Incidents in 7 days | Consequence |
| --- | --- |
| 1 | Nothing. Devices fail. An informational note in the partner app explaining what happened |
| 2 | An in-app guide: battery optimisation, autostart, keeping the tablet charged, the backup contact |
| 3 | `accept_rate` penalty applied; the vendor appears lower in ranking as a natural consequence |
| 4 | Vendor auto-set to `PAUSED` with a required acknowledgement before reopening |
| 5+ | Admin review, with the incident evidence attached |

No fines. No arbitrary deactivation. The consequence is a ranking consequence, which is honest:
a restaurant that cannot be reached is genuinely a worse choice for a customer, and the ranking
should say so.

---

## 5. Client-side reconnection

```kotlin
/**
 * Reconnect with full jitter exponential backoff, floored low because presence
 * is the whole point: a partner tablet that takes 30 seconds to reconnect is a
 * partner tablet that misses an order.
 *
 * delay = random(0, min(cap, base * 2^attempt))
 *
 * base 300ms, cap 8000ms. Full jitter (not "equal jitter") because a tower
 * coming back up reconnects every device in the cell at once, and we must not
 * create a synchronised stampede against our own Durable Object.
 */
class PresenceReconnectPolicy {
    private var attempt = 0
    fun nextDelayMs(): Long {
        val ceiling = min(CAP_MS, BASE_MS shl attempt.coerceAtMost(5))
        attempt++
        return Random.nextLong(0, ceiling + 1)
    }
    fun onConnected() { attempt = 0 }
}
```

Reconnect attempts continue indefinitely while the app believes it should be online. Android's
`ConnectivityManager.NetworkCallback` short-circuits the backoff: when a usable network appears,
the next attempt fires immediately regardless of the timer.

### 5.1 What the user sees

| Connection state | Partner app | Rider app |
| --- | --- | --- |
| Connected | Nothing — silence is the correct UI for "working" | A 4 px green bar under the status bar |
| Reconnecting < 3 s | Nothing. Transient blips must not generate anxiety | Bar turns amber |
| Reconnecting 3–15 s | A slim amber bar: *"Reconnecting…"* | Amber bar + *"Reconnecting…"* |
| Disconnected > 15 s | **Full-width red banner**: *"You are offline — you will not receive orders"* + a Retry button | Red banner, and the rider's own alarm sounds a single soft tone at 15 s |
| Offline, deliberate | Neutral grey: *"You are offline. Tap to go online."* | Same |

The 15-second rider tone exists because a rider whose phone has silently lost data has no reason
to look at it. One soft tone is enough to make them glance.

---

## 6. The re-check-in alert

> *"update their state and alert them to check-in again"*

When presence is lost involuntarily, the actor is alerted through the only channel that still
works — FCM, which traverses Google's own persistent connection and frequently survives situations
that kill an app's own socket.

| Actor | Payload | Alarm |
| --- | --- | --- |
| Vendor, no active orders | `type=PRESENCE_LOST`, `severity=NORMAL` | Single chime, standard notification |
| Vendor, orders in flight | `type=PRESENCE_LOST`, `severity=CRITICAL`, `orderCount=n` | **Full looping alarm** — identical to a new order, because an unaccepted order going cold is as urgent as a new one |
| Rider, idle on shift | `type=PRESENCE_LOST`, `severity=NORMAL` | Single chime |
| Rider, carrying an order | `type=PRESENCE_LOST`, `severity=CRITICAL` | Looping alarm. Their customer is waiting and the tracking map has gone dark |

Tapping the notification opens a **check-in screen**, not the home screen:

```
        ⚠  You went offline
        We lost connection at 14:32 — 1 minute ago.

        You had 2 orders in progress.

        ┌───────────────────────────────┐
        │     CHECK IN AND CONTINUE     │
        └───────────────────────────────┘

        Trouble? Check Wi-Fi, mobile data,
        and that Undal is allowed to run
        in the background.          [ Guide ]
```

Check-in re-establishes the socket, replays missed events from the server's per-actor event log
(kept 15 minutes), and returns the actor to their prior state. Nothing is lost.

---

## 7. Rider presence specifics

Rider presence is coupled to the shift state machine and to D1 tracking:

| Event | Presence | Shift | D1 channel |
| --- | --- | --- | --- |
| Shift start (selfie verified) | Connect | `ONLINE` | **Opened** |
| Order accepted | — | `ON_ORDER` | stays open, cadence increases |
| Order delivered | — | `ONLINE` | cadence relaxes |
| Presence lost, idle | Absent | `ONLINE_UNREACHABLE` after grace | **Erased** |
| Presence lost, carrying | Absent | `ON_ORDER_UNREACHABLE` | **Erased**; customer map shows last known + a staleness notice |
| Presence restored within 60 s | Present | restored | Reopened, re-seeded from the client's buffered positions |
| Presence lost > 60 s while carrying | Absent | `REASSIGNING` triggered ([`11 §10`](11-dispatch-engine.md)) | stays erased |
| Deliberate offline | Absent | `OFFLINE` | **Erased** |
| End of shift | Absent | `CASH_PENDING` → `CASH_LOCKED` | **Erased** |

The D1 erasure on presence loss is not an optimisation — it is the privacy rule from
[`07 §9`](07-d1-live-tracking.md). A rider who is not on shift has no location stored anywhere in
the system, and "not reachable" is treated as "not on shift" for that purpose. The 60-second
restoration window re-seeds from the client's own buffer, so a brief dropout does not lose the
trail.

---

## 8. Admin visibility

The command centre ([`22`](22-admin-super-map.md)) renders presence directly:

| Marker state | Meaning |
| --- | --- |
| Solid, gently pulsing | Connected, heartbeat healthy |
| Solid with an amber ring | Reconnecting (within grace) |
| Hollow with a grey ring | Absent < 5 min, last known position |
| Hollow, desaturated, no position | Absent > 5 min |
| Red pulsing ring | Absent **and** carrying an order — the highest-priority state on the map |

A presence panel lists every absence in the last 24 hours with duration, cause, and whether an
order was affected, filterable by actor. Three presence losses by the same vendor in a week
auto-creates a support task.

---

## 9. Worked timeline

Partner tablet at Rahman's Biriyani House. Wi-Fi router loses power at **14:31:00.000**.

| Time | Event |
| --- | --- |
| 14:31:00.000 | Router dies |
| 14:31:00.180 | TCP RST reaches Cloudflare; `webSocketClose(code=1006, clean=false)` |
| 14:31:00.182 | `markAbsent` with `graceMs=1500`; a 1 500 ms DO alarm is set |
| 14:31:01.682 | Alarm fires; no reconnect; **absence published** |
| | → `vendors.open_state = 'UNREACHABLE'`, hidden from ranking |
| | → `PRESENCE_LOST` FCM, severity NORMAL (no active orders) |
| | → admin map marker goes hollow |
| | **Detection latency: 1.682 s** |
| 14:31:40 | A customer attempts to order; the vendor is not in the list at all; no failed order is created |
| 14:33:12 | The tablet's LTE fallback connects |
| 14:33:12.４ | Socket re-established, `check-in` accepted, state restored to `OPEN`, vendor visible again |
| | Total invisibility: 1 m 31 s. Orders lost: 0. Auto-cancellations: 0 |

Had an order been placed at 14:31:30, the ladder in §4.1 would have run and the order would have
been auto-cancelled at 14:33:30 — except that the vendor reconnected at 14:33:12 and would have
received the pending order with 18 seconds to spare, with the alarm sounding.

---

## 10. Testing

| Test | Count | Asserts |
| --- | --- | --- |
| Transport close | 14 | Clean vs unclean, with and without grace, reconnect inside and outside the window |
| Heartbeat deadline | 18 | One missed beat tolerated, two tolerated, three fatal; clock-skew tolerance |
| Detection latency | 1 | **p95 ≤ 2 000 ms** over 1 000 simulated losses, on both coordinator backends — this is the brief's number and it is a build-failing assertion |
| Flap suppression | 9 | 20 reconnects in 30 s produce at most 1 absence publication |
| Escalation ladder | 22 | Every step at its exact time; acceptance at any point halts it |
| Auto-cancel idempotency | 7 | Accept at 119.9 s wins; double-fire is a no-op; the evidence block is complete |
| Reconnect backoff | 11 | Jitter distribution; no stampede with 200 simultaneous reconnects |
| Rider coupling | 16 | Every row of §7, including D1 erasure and re-seeding |
| Event replay | 8 | Nothing is lost across a 14-minute absence; the 15-minute log boundary is correct |
| No-cron | 1 CI job | No `[triggers] crons` in any `wrangler.toml`; `setAlarm` permitted |

---

## 11. Reading on

Next: [`15-wakeup-alarm-fcm.md`](15-wakeup-alarm-fcm.md) — the loudest, most important, and most
honestly-bounded feature in the platform.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
