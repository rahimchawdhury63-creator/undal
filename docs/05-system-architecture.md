<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 05 — System Architecture

---

## 1. The shape of the system

Undal is three Cloudflare Workers, one Pages project with two build targets, one distributed SQL
database, one edge SQL database, three Android applications, and a set of GitHub Actions workflows
that are the only control plane. There are no servers, no containers, no virtual machines, and
nothing that needs patching.

```
┌─────────────────────────────── CLIENTS ─────────────────────────────────────┐
│                                                                             │
│  Undal (customer)      Undal Partner        Undal Rider      Browser        │
│  Kotlin / Compose      Kotlin / Compose     Kotlin / Compose React + Vite   │
│  okcronet HTTP/3       okcronet HTTP/3      okcronet HTTP/3  fetch + SSE    │
│  Room cache            Room cache           Room cache       IndexedDB      │
│  FCM receiver          FCM alarm receiver   FCM alarm recv.  —              │
│                                                                             │
└───────────────┬─────────────────────────────────────────────┬───────────────┘
                │                                             │
                │  HTTPS / HTTP3 — api.undal.app              │  undal.app
                ▼                                             ▼
┌───────────────────────────────────────────┐   ┌─────────────────────────────┐
│  undal-core          (Worker, TypeScript) │   │  Cloudflare Pages           │
│  ───────────────────────────────────────  │   │  ─────────────────────────  │
│  /v1/auth      identity, sessions, device │   │  apps/web    storefront     │
│  /v1/catalog   vendors, menus, search     │   │              prerendered    │
│  /v1/orders    lifecycle, state machine   │   │  apps/admin  SPA            │
│  /v1/money     fees, ledger, invoices     │   │                             │
│  /v1/kyc       onboarding pipelines       │   │  _routes.json → /api/* goes │
│  /v1/admin     the whole back office      │   │  to undal-core via a Pages  │
│  /v1/media     imgbb + Cloudinary signing │   │  Function proxy             │
└──────┬──────────────────────┬─────────────┘   └─────────────────────────────┘
       │                      │
       │ service binding      │ service binding
       ▼                      ▼
┌──────────────────────────┐  ┌───────────────────────────────────────────────┐
│ undal-realtime (W, TS)   │  │ undal-brain            (Worker, Python)       │
│ ──────────────────────── │  │ ───────────────────────────────────────────── │
│ /rt/presence  heartbeats │  │ /brain/fare       quote a delivery            │
│ /rt/location  rider feed │  │ /brain/dispatch   rank candidate riders       │
│ /rt/stream    SSE out    │  │ /brain/batch      bundle feasibility          │
│ /rt/push      FCM v1     │  │ /brain/rank       vendor ordering             │
│                          │  │ /brain/forecast   demand surface              │
│ Durable Objects:         │  │ /brain/explain    decision trace replay       │
│   ZoneHub   (1 per zone) │  │                                               │
│   OrderHub  (1 per order)│  │ Stateless. Reads the feature store from KV    │
│   RiderPin  (1 per rider)│  │ and TiDB. Writes nothing but traces.          │
└────┬────────────┬────────┘  └────────────────┬──────────────────────────────┘
     │            │                            │
     ▼            ▼                            ▼
┌──────────┐ ┌─────────────┐  ┌────────────────────────┐  ┌───────────────────┐
│ D1       │ │ Workers KV  │  │ TiDB Cloud Starter     │  │ OSRM (public /    │
│ rider    │ │ feature     │  │ system of record       │  │ self-hostable)    │
│ live loc │ │ store, hot  │  │ 99 tables, integer geo │  │ route + table     │
│ ephemeral│ │ config      │  │ serializable           │  │ matrix            │
└──────────┘ └─────────────┘  └────────────────────────┘  └───────────────────┘

     ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────────────┐
     │ imgbb        │  │ Cloudinary    │  │ Firebase Cloud Messaging HTTP v1 │
     │ public images│  │ KYC + invoices│  │ data-only, high priority         │
     └──────────────┘  └───────────────┘  └──────────────────────────────────┘
```

---

## 2. Why three Workers and not one

A single Worker would be simpler. Three is correct, for four concrete reasons:

1. **Different runtimes.** `undal-brain` is Python because the fare, dispatch and ranking algebra is
   far more readable in Python, and readable algebra is auditable algebra. Cloudflare runs Python
   Workers on Pyodide, which is a separate runtime from the JavaScript one. They cannot share a
   script.

2. **Different CPU profiles.** `undal-realtime` handles short, frequent, latency-critical requests
   (a heartbeat is ~1.5 ms of CPU). `undal-brain` runs a 14-factor scoring pass over up to 60
   candidate riders and costs ~6 ms. Separating them means a slow Brain call can never add tail
   latency to a heartbeat, and the 10 ms free-tier CPU ceiling is budgeted per-Worker rather than
   shared.

3. **Different deploy cadence.** The Brain's coefficients get tuned weekly. Core's order state
   machine changes rarely and is the most dangerous thing in the system. They should not be able to
   break each other, and a Brain deploy should not require re-verifying the ledger.

4. **Different blast radius.** If the Brain fails, Undal degrades to a deterministic fallback
   (nearest-available-rider, base fare table) and keeps taking orders. If Realtime fails, orders
   still commit and clients fall back to polling. Only a Core failure stops the business. Three
   Workers make that degradation ladder expressible.

### 2.1 Worker boundaries — the rule

> **`undal-core` owns all writes to TiDB. No other Worker writes to it, ever.**

`undal-realtime` writes only to D1 and Durable Object storage. `undal-brain` writes nothing except
decision traces, and it writes those by calling back into Core. This single rule means:

- There is exactly one place to audit for ledger correctness.
- Transaction boundaries are never split across Workers.
- A Brain bug cannot corrupt money.

Inter-Worker calls use **service bindings**, not public HTTP. Service bindings are same-colo,
zero-latency, and not routable from the internet, so Core's admin endpoints are unreachable to
anything but the bound Workers even if someone guesses a path.

---

## 3. `undal-core` — the system of record

**Language:** TypeScript · **Runtime:** Cloudflare Workers (V8 isolates) · **Framework:** Hono

### 3.1 Module map

```
workers/core/src/
├── index.ts                      router mount, 60 lines
├── env.ts                        typed bindings, zero logic
├── middleware/
│   ├── auth.ts                   bearer verification, session lookup
│   ├── rbac.ts                   permission assertion
│   ├── idempotency.ts            key capture, replay, conflict detection
│   ├── rate-limit.ts             per-actor token bucket in KV
│   ├── audit.ts                  writes the immutable log entry
│   ├── error.ts                  the single error shape
│   └── request-id.ts             correlation id propagation
├── routes/
│   ├── auth/                     8 files
│   ├── catalog/                  11 files
│   ├── orders/                   14 files
│   ├── money/                    9 files
│   ├── kyc/                      7 files
│   ├── media/                    4 files
│   └── admin/                    38 files
├── domain/
│   ├── order/
│   │   ├── state-machine.ts      the transition table — the most important file
│   │   ├── guards.ts             can-transition predicates
│   │   ├── effects.ts            side effects per transition
│   │   └── codes.ts              UND- code generation and checksum
│   ├── money/
│   │   ├── paisa.ts              the Paisa branded type and its arithmetic
│   │   ├── ledger.ts             double-entry posting
│   │   ├── fees.ts               fee assembly from a Brain quote
│   │   └── invariants.ts         the closure assertions
│   ├── catalog/                  availability, modifiers, pricing
│   ├── identity/                 password hashing, sessions, devices
│   └── zone/                     polygon membership, zone resolution
├── db/
│   ├── client.ts                 TiDB over @tidbcloud/serverless (HTTP)
│   ├── tx.ts                     retry-on-serialization-failure wrapper
│   ├── queries/                  one file per aggregate, parameterised SQL
│   └── migrations/               numbered .sql, applied by Actions
└── lib/                          crypto, time, id, validation
```

No file exceeds 700 lines. `state-machine.ts` is the closest at 640, and it is deliberately one file
because splitting a state machine across files is how states get orphaned.

### 3.2 The request lifecycle

```
1.  Edge receives the request at the nearest Cloudflare colo
2.  request-id middleware assigns or propagates X-Undal-Request-Id
3.  rate-limit checks a token bucket keyed by actor (or IP when anonymous)
4.  auth verifies the bearer token:
       – decode the opaque session id
       – look it up in KV (hot path, ~1 ms) or TiDB (cold, ~45 ms est.)
       – verify device binding fingerprint
       – reject if revoked, expired, or bound to a different device
5.  rbac asserts the route's required permission against the session's role set
6.  idempotency: if the request is mutating and carries Idempotency-Key,
       – look up (actor, key) in KV
       – if present and the body hash matches, replay the stored response
       – if present and the body hash differs, 409 IDEMPOTENCY_CONFLICT
       – if absent, reserve the key with a 60 s lease
7.  Zod validates the body against the route schema
8.  The handler runs, inside a serializable transaction when it writes
9.  audit writes an entry if the route is marked auditable
10. idempotency stores the response under the key with a 24 h TTL
11. The response is shaped by the single envelope (§3.4)
```

Steps 3, 4, 5, 6 and 10 are **middleware, not handler code**. A route author cannot forget them,
because the router mounts them for whole route groups and a route without a declared permission
fails to compile (the permission is a required field of the route definition type).

### 3.3 Transactions and retries

**TiDB does not support `SERIALIZABLE`.** It runs **pessimistic transactions at `REPEATABLE READ`**,
and `READ UNCOMMITTED` and `SERIALIZABLE` are both unavailable. This document previously said
CockroachDB's serializable default was "the right isolation level for a ledger"; that sentence is no
longer true of the database Undal runs on, and the ledger's correctness now rests on explicit
locking rather than on the isolation level.

Pessimistic locking trades serialization failures for lock waits, so the retry ladder keeps its
shape and changes its error predicate: MySQL `1213` (deadlock) and `1205` (lock wait timeout)
replace Postgres `40001`.

```ts
// workers/core/src/db/tx.ts — the only place a transaction is opened.
export async function inTx<T>(env: Env, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const MAX = 5;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      return await run(env, fn);
    } catch (e) {
      if (!isRetryableLockError(e) || attempt === MAX - 1) throw e;   // 1213, 1205
      // Full jitter exponential backoff: 2^attempt * 10 ms, randomised.
      await sleep(Math.random() * (1 << attempt) * 10);
    }
  }
  throw new Error("unreachable");
}
```

Rules:
- **Transactions are short.** No external HTTP call — no imgbb, no FCM, no OSRM — happens inside one.
  Side effects are queued and fired after commit (§3.5).
- **Transactions are pure.** The function passed to `inTx` must be safe to run more than once. CI
  lints for `Date.now()`, `crypto.randomUUID()` and `Math.random()` inside a transaction body; they
  must be computed before it opens.
- **Every read-then-write on a contended row takes `SELECT ... FOR UPDATE`.** Under `SERIALIZABLE`
  this was the database's job. Under `REPEATABLE READ` it is the query's job, and omitting it is
  silent rather than loud — the transaction commits and the value is wrong.

Six places in the platform read a row and then write a value derived from it. Each takes an explicit
`FOR UPDATE`, and each has a 50-way concurrent property test:

| # | Site | What breaks without the lock |
| --- | --- | --- |
| 1 | Ledger balance read before posting | A posting computed from a stale balance; the ledger stops closing to zero |
| 2 | Rider cash-in-hand cap, ৳3,500 | Two concurrent cash orders both pass the cap and the rider exceeds it |
| 3 | Dispatch claim | Two riders accept one order — the exact failure §4.2 exists to prevent |
| 4 | Invoice period boundary | An order lands in two invoices, or in none |
| 5 | bKash TrxID uniqueness | One transaction ID credited twice |
| 6 | Idempotency key lease | A duplicated order from a retried request |

These are six of the 64 property suites, not six new ones. The suites gain concurrency; the count is
unchanged.

### 3.4 The response envelope

Every response from every endpoint of every Worker has exactly one of two shapes.

```jsonc
// Success
{
  "ok": true,
  "data": { /* route-specific */ },
  "meta": { "requestId": "...", "ts": "2026-11-01T08:23:17.482Z" }
}

// Failure
{
  "ok": false,
  "error": {
    "code": "ORDER_NOT_ACCEPTABLE",          // stable, machine-readable, never changes
    "message": "This order was already cancelled.", // human, English
    "messageBn": "এই অর্ডারটি আগেই বাতিল হয়েছে।",     // human, Bangla
    "field": null,                            // for validation errors
    "retryable": false,
    "details": {}                             // structured, route-specific
  },
  "meta": { "requestId": "...", "ts": "..." }
}
```

The `code` is the contract. Clients branch on `code`, never on `message`. The complete code
registry — 184 codes — is [`08 §11`](08-api-contract.md).

### 3.5 Post-commit effects

Side effects that must not run inside a transaction are queued in the transaction itself and
executed after commit via `ctx.waitUntil`:

```ts
const { order, effects } = await inTx(env, async (tx) => {
  const order = await transitionOrder(tx, orderId, "ACCEPTED", input);
  return { order, effects: collectEffects(order) };   // pure: returns descriptors
});

// After commit, outside the transaction, not blocking the response:
ctx.waitUntil(runEffects(env, effects));
return ok(order);
```

If an effect fails, it is retried from a Durable Object alarm with exponential backoff up to 6
attempts, and after that it is written to `effect_dead_letters` and raised in the admin panel's
exception tower. **An effect never silently disappears.**

Effect types: `FCM_PUSH`, `SSE_BROADCAST`, `BRAIN_DISPATCH_OPEN`, `LEDGER_POST`, `INVOICE_MARK_DIRTY`,
`MEDIA_PURGE`, `AUDIT_ENRICH`.

---

## 4. `undal-realtime` — presence, location, push

**Language:** TypeScript · **Runtime:** Workers + Durable Objects

This Worker exists because presence and live location are **stateful and hot**, and because Durable
Objects give single-threaded, strongly-consistent, in-memory state at the edge for free.

### 4.1 The three Durable Object classes

| Class | Instance granularity | Holds | Why a DO |
| --- | --- | --- | --- |
| **`ZoneHub`** | One per delivery zone | The set of online riders with last ping and coarse position; the set of online vendors; the queue of orders awaiting dispatch; the SSE subscriber list for admin | Dispatch must not double-assign a rider. A DO is single-threaded, so the lock is free — no distributed lock, no advisory lock, no race. |
| **`OrderHub`** | One per live order | The order's current state, the dispatch cascade cursor, the offer timers, the SSE subscribers (customer, vendor, admin) | Offer timeouts need a timer that survives request boundaries. DO alarms do exactly that. |
| **`RiderPin`** | One per rider, only while on shift | The rider's last position, heading, speed, the displacement accumulator, the write budget counter | The 100 m gate needs the previous position with zero read latency. |

A `ZoneHub` holds maybe 400 bytes per rider. A zone with 200 riders is 80 KB — comfortably inside a
DO's memory, and it hibernates when idle, costing nothing.

### 4.2 Why Durable Objects and not a database row

Dispatch is the one place where a race costs real money: two riders accepting the same order means
one of them drove for nothing. The options were:

| Option | Problem |
| --- | --- |
| An interactive `SELECT ... FOR UPDATE` transaction | Four HTTP round trips on the serverless driver — `BEGIN`, `SELECT`, `UPDATE`, `COMMIT` — and lock contention across the whole zone during a lunch rush |
| An advisory lock | `GET_LOCK()` is session-scoped and the HTTP driver has no durable session, so this is not merely slow, it is unavailable |
| Optimistic concurrency with a version column | Works, but the retry storm during a surge is exactly when you cannot afford it |
| **A single conditional `UPDATE`** | Atomic by itself. One round trip, no transaction, no lock to leak. |
| **A Durable Object per zone** | Single-threaded by construction. The "lock" is just the fact that only one request runs at a time. Zero round trips. |

**The move to TiDB made the free path simpler, not worse.** The first row is what this document used
to recommend against at "~25 ms"; over a stateless HTTP driver it would be far worse than that. But
a dispatch claim never needed a transaction:

```sql
UPDATE dispatch_locks
   SET holder_rider_id = ?, acquired_at = ?, expires_at = ?
 WHERE order_id = ?
   AND (holder_rider_id IS NULL OR expires_at < ?);
-- exactly one caller comes back with affected_rows = 1; everyone else gets 0
```

One statement, one round trip, atomic by construction, and nothing to leak if a Worker dies
mid-request because the lease expiry already covers that. Identical semantics to the rejected
design, strictly better mechanics. This is the one place in the migration where the free path got
*better*.

The DO is the right tool, and it is free on the Workers paid plan — but Undal is on free. **This is
the one architectural risk in the system and it is stated plainly in
[`39 §4`](39-risk-register-and-truths.md):** Durable Objects require the Workers Paid plan
($5/month). The specification therefore ships **two implementations** behind one interface:

```ts
// workers/realtime/src/coordination/Coordinator.ts
export interface Coordinator {
  claimOffer(orderId: string, riderId: string): Promise<ClaimResult>;
  openDispatch(orderId: string, zone: string): Promise<void>;
  // ... 14 methods
}
// Two implementations, selected by env.COORDINATION_MODE:
//   "durable-object"  → DurableObjectCoordinator   (preferred; needs Workers Paid)
//   "sql"             → TiDBCoordinator            (free; one conditional UPDATE
//                        against a dispatch_locks row with lease expiry)
```

The free-tier path is **fully implemented and fully tested**, not a stub. It is slower than a
Durable Object and it is correct. The platform launches on it and the operator flips one Actions
variable to upgrade. Pretending Durable Objects are free would have produced a spec that does not
deploy, which is worse than a spec that is honest about a $5 upgrade path.

**The 31 ms p50 figure this document used to publish is withdrawn.** It was measured against
CockroachDB in Mumbai with a four-round-trip claim. The claim is now one round trip, which pulls the
number down; the database is now in Singapore, roughly 1,200 km further from Dhaka, which pushes it
up. The two effects do not cancel in any way that can be asserted on paper. The replacement estimate
is **10–20 ms with Smart Placement enabled and 60–80 ms without**, and both will be measured on day
one and republished with their measurement date. Until then this corpus states a range and its
basis, not a figure.

### 4.3 SSE, not WebSockets

Live updates to browsers and apps use **Server-Sent Events**, not WebSockets.

| | SSE | WebSocket |
| --- | --- | --- |
| Direction needed | Server → client only. Clients push state via normal POSTs. | Bidirectional, which Undal does not need |
| Reconnection | Automatic, with `Last-Event-ID` replay built into the protocol | Hand-rolled |
| Proxy friendliness | Plain HTTP, works everywhere | Upgrade handshake, fails behind some corporate and mobile proxies |
| Worker cost | One streaming response; counts as one request | One request, but hibernation requires the paid plan to be free |
| HTTP/3 | Works over QUIC with okcronet | WebSocket over HTTP/3 is still patchy on Android |

The event stream is at `GET /rt/stream?channels=order:UND-7K2M9QX4,rider:abc`. Events carry a
monotonic id so a reconnect replays only what was missed. The full event catalogue — 46 event types
— is [`08 §9`](08-api-contract.md).

Android clients use SSE over okcronet while the app is foregrounded, and **FCM when it is not**.
There is exactly one source of truth for "what changed": the event, whether it arrives over SSE or
inside an FCM data payload. The payload shape is identical, so the client has one handler.

### 4.4 FCM dispatch

`undal-realtime` is the only component that talks to FCM. It:

1. Mints a Google OAuth2 access token from the service account JSON (`FIREBASE_SERVICE_ACCOUNT_JSON`
   secret) using RS256 JWT assertion, implemented with WebCrypto — no `googleapis` dependency.
2. Caches the token in KV for 50 minutes (tokens live 60).
3. Sends `POST https://fcm.googleapis.com/v1/projects/{project}/messages:send`.
4. Sends **data-only** payloads with `android.priority = "high"` and `android.ttl` tuned per message
   class.
5. Handles `UNREGISTERED` and `INVALID_ARGUMENT` by pruning the dead token from `device_tokens`.
6. Retries `UNAVAILABLE` and `INTERNAL` with backoff; anything else is terminal and logged.

Full specification, including the exact payload for every message class: [`15`](15-wakeup-alarm-fcm.md).

---

## 5. `undal-brain` — the decision engine

**Language:** Python · **Runtime:** Cloudflare Python Workers

Stateless. Every endpoint takes a fully-specified input, consults the feature store in KV, and
returns a decision plus a **trace**. No hidden state, no accumulated memory inside the Worker — which
means every decision is reproducible from its inputs, forever.

```
workers/brain/src/
├── entry.py                   router, 70 lines
├── fare/
│   ├── quote.py               the public entry: inputs → FareQuote
│   ├── distance.py            routed distance and duration from OSRM
│   ├── surge.py               SDR → multiplier, with the band table
│   ├── weather.py             condition → premium
│   ├── traffic.py             delay → compensation
│   ├── vehicle.py             per-vehicle rates and radius constraints
│   └── rounding.py            banker's rounding at the single division point
├── dispatch/
│   ├── candidates.py          who is even eligible
│   ├── score.py               the 14-factor function
│   ├── cascade.py             offer ordering and wave sizing
│   └── fallback.py            what to do when nobody is available
├── batch/
│   ├── detect.py              which pairs are candidates
│   ├── feasibility.py         the detour-budget proof
│   └── payout.py              the bundle payout adjustment
├── rank/
│   ├── pipeline.py            the ten stages
│   ├── stages/                one file per stage
│   └── personalise.py         the per-customer vector
├── forecast/
│   ├── demand.py              zone × hour demand surface
│   └── preptime.py            the vendor's suggested prep time
├── features/
│   ├── store.py               KV-backed feature reads, with a typed schema
│   └── windows.py             exponentially-weighted rolling statistics
├── explain/
│   └── trace.py               the decision trace format
└── mathx/
    ├── paisa.py               integer money, mirrored from TypeScript
    ├── geo.py                 haversine, bearing, bbox
    └── stats.py               EWMA, percentile, Wilson lower bound
```

The Brain is specified in detail in [`09`](09-undal-brain-overview.md) through
[`13`](13-ranking-personalization.md).

### 5.1 The Brain never blocks an order

A fare quote is on the critical path of checkout; a dispatch decision is on the critical path of
assignment. Both have a **hard 400 ms timeout** in Core, and both have a deterministic fallback:

| Brain call | Timeout | Fallback |
| --- | --- | --- |
| `/brain/fare` | 400 ms | The static fare table in `platform_config.fallback_fare_tiers` — a distance-banded lookup that is always within ±12% of the full engine. The customer is charged the fallback and the ledger records `fare_source = "FALLBACK"`. |
| `/brain/dispatch` | 400 ms | Nearest eligible rider by straight-line distance, breaking ties by acceptance rate. |
| `/brain/batch` | 250 ms | No batching. The order dispatches solo. |
| `/brain/rank` | 300 ms | Distance ascending, then rating descending. |
| `/brain/forecast` | — | Not on any critical path. |

Every fallback is exercised in CI by a test that blackholes the Brain binding, so the degraded path
is known to work rather than hoped to.

---

## 6. Data stores

### 6.1 TiDB Cloud Starter — the system of record

Everything durable. 99 tables. Pessimistic `REPEATABLE READ`. Integer-coordinate geospatial.

Connection from a Worker uses **`@tidbcloud/serverless`**, a fetch-API HTTP driver built for edge
runtimes. There is no TCP socket, no `cloudflare:sockets`, no wire-protocol driver and **no CA
certificate** — which removes a build-time secret, a paragraph of explanation about why a
long-lived pool in an isolate is a leak waiting to happen, and the 400-connection Starter limit as
a live concern. One fewer moving part in the hottest path in the system.

Two things about this driver must be stated plainly, because the ledger depends on them:

1. **Interactive transactions are experimental.** PingCAP documents them as not concurrency-safe,
   auto-rolled-back after 10 minutes idle, and rolled back outright if the gateway's TCP connection
   drops. For a ledger that is material. The response is to need them rarely: single-statement
   atomic operations wherever the semantics allow (§4.2 is the clearest example, where a
   four-statement transaction became one `UPDATE`), and batched multi-statement work where they do
   not. Ledger posting genuinely requires an interactive transaction, and that is where the residual
   risk sits. It is logged in [`39`](39-risk-register-and-truths.md) as R33 rather than left for
   someone to discover.
2. **There is no Mumbai region.** Starter runs in five AWS regions — `us-west-2`, `us-east-1`,
   `eu-central-1`, `ap-southeast-1` and `ap-northeast-1`. CockroachDB ran in `gcp-asia-south1`.
   **Singapore (`ap-southeast-1`) is the choice**, at roughly 2,900 km from Dhaka against Mumbai's
   1,700 km. Every latency figure in this document that includes a database round trip is therefore
   an estimate until it is measured against a live instance. See §9.

**Smart Placement is enabled on `undal-core`.** A Worker normally runs at the PoP that terminates
the request, so a Dhaka customer's request would run near Dhaka and every query would cross to
Singapore and back. Smart Placement relocates the Worker to run near its backend instead, paying
the long leg once per request rather than once per query. For a Worker that is database-heavy on
every path this is the difference between a budget that holds and one that does not, and it costs
nothing. Both configurations are measured on day one and both numbers are published.

Full schema: [`06`](06-data-model-tidb.md).

### 6.2 Cloudflare D1 — the live-location channel

One table, aggressively small, deliberately ephemeral. A rider's positions exist only while they are
on shift and are deleted within 5 seconds of them going offline.

Full specification, including the write-budget arithmetic that proves it fits in 100 000 writes/day:
[`07`](07-d1-live-tracking.md).

### 6.3 Workers KV — the feature store and hot config

| Namespace | Contents | TTL | Written by |
| --- | --- | --- | --- |
| `SESSIONS` | Session id → actor, role set, device fingerprint | session lifetime | Core |
| `IDEMPOTENCY` | (actor, key) → response hash + body | 24 h | Core |
| `RATELIMIT` | Bucket state | 60 s | Core |
| `FEATURES` | Rolling statistics per vendor, rider, zone, customer | 15 min – 7 d | Core, after each order |
| `CONFIG` | Platform config snapshot | until invalidated | Core, on admin edit |
| `FCMTOKEN` | The cached Google OAuth2 access token | 50 min | Realtime |
| `GEOCACHE` | Geocoding and OSRM route results, keyed by rounded coordinates | 24 h | Core, Brain |

KV is **eventually consistent** (up to ~60 s globally). Nothing that must be immediately correct
lives there. Sessions tolerate it because revocation also writes a tombstone that Core checks
against TiDB for any high-privilege action. Config tolerates it because a 60-second delay on
a commission-rate change is acceptable and the admin UI says so.

### 6.4 R2 — not used

Object storage is not needed. Public images go to imgbb, private documents and invoices to
Cloudinary. Adding R2 would mean adding a service with a free-tier egress ceiling for no benefit.

---

## 7. External services

| Service | Used for | Failure mode |
| --- | --- | --- |
| **imgbb** | All public user images: vendor covers, logos, dish photos, rider selfies | Upload fails → the client retries 3× with backoff, then stores the image in Room's outbox and uploads on next connectivity. The UI shows the local image immediately. |
| **Cloudinary** | KYC documents, invoices (private, signed delivery) | Upload fails → the onboarding step stays incomplete and is retried; no document is ever stored unencrypted elsewhere as a fallback |
| **FCM** | All push | Send fails → retried from a DO alarm; the in-app SSE path still delivers to foregrounded clients; the admin tower raises an exception if a `PLACED` order has had no FCM success within 10 s |
| **OSRM** | Routing, distance matrix | Timeout → Brain falls back to haversine × a per-zone detour factor (learned, default 1.32) and marks the quote `distance_source = "ESTIMATED"` |
| **Nominatim** | Geocoding during onboarding and address entry | Rate-limited; results cached 24 h in KV; manual map-pin entry always available as the primary path |
| **OSM tiles** | Map rendering | Tiles fail → MapLibre shows the last cached tiles and a muted grid; markers still render |

### 7.1 On OSRM and Nominatim

The public demo instances of both have usage policies that forbid heavy production use. Undal's
architecture respects this:

- **Every OSRM and Nominatim result is cached in KV**, keyed by coordinates rounded to 5 decimal
  places (~1.1 m) for routing and 4 places (~11 m) for geocoding. At steady state the cache hit rate
  on a city-scale deployment exceeds 80% because vendors are fixed points and customers cluster.
- **Geocoding is never on a hot path.** It runs during onboarding and address creation only.
- **The routing host is a secret** (`OSRM_BASE_URL`), so the operator can point it at their own
  instance — OSRM runs on a 2 GB VPS for a Bangladesh extract — without a code change. The
  documentation in [`29 §7`](29-secrets-and-configuration.md) explains how, and strongly recommends
  it before exceeding ~2 000 orders/day.
- **A hard client-side rate limit** of 1 request/second to Nominatim with a proper `User-Agent`
  identifying Undal and a contact address, per their policy.

---

## 8. Security boundaries

| Boundary | Control |
| --- | --- |
| Internet → Core | Bearer session tokens, device binding, rate limits, Zod validation, CORS allowlist |
| Internet → Realtime | Same, plus SSE channel authorisation per subscription |
| Internet → Brain | **None. Brain is not publicly routable.** Service binding only. |
| Core → TiDB | HTTPS to the serverless gateway, least-privilege SQL role, parameterised queries only |
| Realtime → D1 | Binding; D1 is not internet-reachable |
| Any Worker → FCM | Service-account OAuth2, token cached, scoped to `firebase.messaging` |
| Client → imgbb | **Via Core.** The imgbb key never reaches a client. Core proxies the upload. |
| Client → Cloudinary | Signed upload with a short-lived signature minted by Core, scoped to one folder and one public_id prefix |
| Admin → anything | TOTP-gated session, per-permission RBAC, every action audited |

The full threat model, the permission matrix, and the audit schema are
[`27`](27-security-rbac-audit.md).

---

## 9. Latency budget

Measured end to end, p95, from a mid-range Android phone on 4G in Sylhet.

> **Every budget below that contains a database round trip is now an estimate.** The system of
> record moved from Mumbai to Singapore, roughly 1,200 km further from Dhaka, and the driver changed
> from a TCP wire protocol to HTTP. These figures were measured against the old topology. They are
> retained as targets, each is re-measured against a live Starter instance in the first week, and
> each is republished with its measurement date. A budget that is quietly left standing after the
> thing it measured was replaced is not a budget, it is a decoration.
>
> The **catalogue list holds at 300 ms** rather than absorbing the extra distance, and it does so by
> caching rather than by moving the number: the per-zone vendor list joins the per-vendor menu in
> Workers KV on the same 60 s TTL, so the hot path does not reach the database at all. The
> cache-miss path is slower than 300 ms and is published separately rather than averaged away.

| Operation | Budget | Composition |
| --- | --- | --- |
| Cold app start to first content | 1 400 ms | 380 ms process + 220 ms Compose first frame + 340 ms cached catalogue render + 460 ms network refresh |
| Catalogue list | 300 ms | 40 ms edge + 120 ms KV-cached catalogue + 60 ms rank + 80 ms transfer |
| Vendor storefront | 260 ms | mostly cached; menu is KV-cached per vendor with a 60 s TTL |
| Add to cart | 0 ms | Local. Synced in the background. |
| Fare quote | 420 ms | 180 ms OSRM (or 0 on cache hit) + 90 ms Brain + 150 ms round trip |
| **Place order → ACK** | **550 ms** | 40 ms edge + 180 ms transaction + 90 ms fee assembly + 240 ms round trip |
| **Place order → vendor's phone makes noise** | **≤ 2 000 ms** | 550 ms ACK + 120 ms FCM send + 400–1 300 ms FCM delivery |
| Rider offer delivered | ≤ 2 000 ms | same path |
| Location ping → admin map update | ≤ 900 ms | 120 ms upload + 80 ms D1 write + 300 ms SSE fan-out + render |
| Presence change → state flip | ≤ 2 000 ms | see [`14 §3`](14-presence-and-heartbeat.md) |

### 9.1 How the 2-second alarm budget is defended

The dangerous component is FCM delivery, which Undal does not control. Three mitigations:

1. **FCM is fired before the HTTP response returns to the customer.** The effect queue runs in
   `waitUntil`, but the FCM effect specifically is awaited *in parallel* with the response
   serialisation, so the push leaves Cloudflare at roughly the same moment the customer's phone
   receives its ACK.
2. **A second channel.** Partner and rider apps hold an SSE connection whenever they are
   foregrounded. If the app is open, the order arrives over SSE in ~300 ms, and FCM is the redundant
   path rather than the primary one.
3. **A watchdog.** If an order is still `PLACED` 10 seconds after creation with no FCM success
   receipt, `OrderHub`'s alarm re-sends, and at 20 seconds the admin exception tower raises it. At
   120 seconds the auto-cancel path in [`14 §7`](14-presence-and-heartbeat.md) begins.

---

## 10. Failure and degradation ladder

| Failure | Detection | Behaviour | User sees |
| --- | --- | --- | --- |
| Brain unreachable | 400 ms timeout | Deterministic fallbacks (§5.1) | Nothing. Fares differ by ≤12%. |
| OSRM unreachable | 600 ms timeout | Haversine × learned detour factor | Nothing. ETA range widens. |
| D1 unreachable | Error on write | Positions buffer in `RiderPin` memory and flush on recovery; admin map shows "last seen 40 s ago" | Admin sees a staleness badge |
| TiDB unreachable | Connection error | **Orders stop.** Core returns `503 SERVICE_DEGRADED`. Clients show a designed outage state and retain carts locally. | "Undal is having trouble. Your cart is saved." |
| FCM unreachable | Non-2xx | Retry ladder; SSE still works for foregrounded apps; admin raises exception | Partner with app open sees the order normally |
| imgbb unreachable | Upload error | Image queues in the Room outbox; the UI shows the local file | "Photo will upload when you're back online" |
| Cloudinary unreachable | Upload error | KYC step stays pending; invoice generation defers and retries | "Document upload pending" |
| A Worker is rolled back | Health check in CI | Previous deployment is still live; Cloudflare deploys are atomic | Nothing |
| Rider's phone loses GPS | No fix for 45 s | Marker greys; ETA switches to time-based estimate; customer sees "locating rider" | Honest status, not a frozen marker |
| Vendor's phone dies | No heartbeat for 2 s | Auto-offline; new orders stop routing to them; existing `PLACED` order begins the 2-minute unreachable timer | Customer gets a cancel with a truthful reason and no charge |

---

## 11. Observability

No paid APM. Observability is built from what the free tier gives:

| Signal | Mechanism |
| --- | --- |
| **Structured logs** | Every Worker logs one JSON line per request: requestId, actor, route, status, duration, CPU time, and a `decision` field for Brain calls. Streamed to `wrangler tail` in a workflow, and the last 10 000 lines are retained in an `ops_logs` D1 table written by a sampling middleware (1% of successes, 100% of errors). |
| **Metrics** | Counters and histograms accumulated in a `MetricsHub` Durable Object (or a TiDB table on the free path), flushed to `ops_metrics` every 60 s. The admin panel renders them. |
| **Traces** | Each request carries `X-Undal-Request-Id`; Brain decisions store a full trace in `brain_traces` with a 14-day retention. Any order's dispatch can be replayed and explained. |
| **Errors** | Every unhandled error writes to `ops_errors` with a fingerprint (route + error class + top stack frame), deduplicated with a count, and surfaced in the admin exception tower. |
| **Uptime** | A GitHub Actions workflow hits `/health` on all three Workers every 10 minutes from the Actions scheduler — this is the **one** permitted `schedule:` trigger and it carries no business logic, which keeps non-negotiable 28 intact. |
| **SLOs** | Defined in [`30 §11`](30-testing-and-verification.md) with error budgets and the alerting rules in the admin panel. |

---

## 12. Environments

| Environment | Workers | Pages | Database | Purpose |
| --- | --- | --- | --- | --- |
| `preview` | `undal-core-preview` etc. | Pages preview per PR | A dedicated TiDB Starter instance, `undal-preview` | Every pull request gets a full stack |
| `staging` | `undal-core-staging` | `staging.undal.app` | A dedicated TiDB Starter instance, `undal-staging` | Integration and load tests; the latency budget is asserted here |
| `production` | `undal-core` | `undal.app` | `undal-production` | Real |

**This got better.** Under CockroachDB all three environments shared one free cluster and were
separated only by database name, so a runaway preview job could consume storage production needed.
TiDB Cloud Starter allows **five free instances per organisation**, so each environment gets its
own instance with its own 5 GiB quota, its own credentials and its own blast radius. Preview can no
longer starve production, and two instances remain spare.

Row counts in preview and staging are still capped by a CI job that truncates them after each run —
not because they threaten production any more, but because an instance that fills its own quota
stops accepting writes and a red pull request should mean a broken change, not a full disk.

Promotion is **a tag push**, performed from the browser via the GitHub Releases UI, which triggers
the production deploy workflow. See [`28 §9`](28-cicd-github-actions.md).

---

## 13. Reading on

Next: [`06-data-model-tidb.md`](06-data-model-tidb.md) — all 96 tables.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
