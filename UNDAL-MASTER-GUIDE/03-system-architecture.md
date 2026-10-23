# 03 · System Architecture (free-tier, production-grade)

## 3.1 The whole machine

```
┌─ CUSTOMER (Android/Web) ─┐  ┌─ PARTNER (Android) ─┐  ┌─ RIDER (Android) ─┐  ┌─ ADMIN (Web) ─┐
│ Flutter app / React web  │  │ Flutter + Kotlin    │  │ Flutter + Kotlin  │  │ React web     │
└───────┬──────────────────┘  └──────┬──────────────┘  └──────┬────────────┘  └────┬──────────┘
        │ HTTPS (Supabase JWT)       │ FCM data-only ⬇        │ FCM ⬇ / GPS ⬆      │ JWT + TOTP
        ▼                            ▼                        ▼                    ▼
┌──────────────────────────────── CLOUDFLARE EDGE ─────────────────────────────────┐
│ Pages: undal-web · undal-admin      WAF · rate-limit rules · cache (public GETs)    │
│ Worker-1 API GATEWAY      (catalog, cart, orders write-path, vouchers, img proxy)  │
│ Worker-2 REALTIME-DISPATCH (assignment, fare, presence, FCM sender, RTDB writer)   │
│ Worker-3 ADMIN-OPS         (KYC, zones, invoices/cron, moderation, settings, PDF)  │
└──────┬──────────────────┬──────────────────────┬───────────────────┬───────────────┘
       ▼                  ▼                      ▼                   ▼
  SUPABASE            FIREBASE               IMGBB              OSM ECOSYSTEM
  Postgres (truth)    RTDB (ephemeral)       public images      tiles (render)
  Auth (JWT/OAuth)    FCM (wake-ups)         (via W1 proxy)     Nominatim (geocode)
  Storage (private)                                              OSRM (routes/ETA)
  SQL RPC + RLS                                                  Open-Meteo (weather)
```

**Data-ownership law:** anything that must survive, be audited, searched, or paid on lives in **Postgres**.
RTDB holds only *ephemeral* mirrors (live locations, presence pings, active-order chat fan-out, offer countdowns)
that can be rebuilt from Postgres + fresh telemetry. If RTDB burned down, Undal loses minutes of live dots — never money.

## 3.2 Request lifecycles (the 6 flows that must never break)

1. **Browse:** Client → (Pages edge cache / Worker-1 cached catalog) → Postgres read RPCs (`get_home_feed`, `get_vendor_menu`).
   Anonymous browsing allowed; prices public; ordering requires auth.
2. **Place order:** Client → Worker-1 `POST /v1/orders` → Postgres transaction (recompute prices from DB, lock voucher,
   insert order + items + money snapshot + first `order_events`) → enqueue dispatch job → Worker-2 notifies vendor
   (FCM data-only + RTDB node) → customer receives RTDB status stream URL. Target p95 ≤ 1.5 s to “order confirmed”.
3. **Vendor accept (+prep):** Partner app → Worker-1 transition endpoint → state-machine guard (Postgres) → Worker-2 runs
   assignment scoring → FCM offer to best rider → offer lifecycle in RTDB with server timestamps.
4. **Deliver:** Rider step transitions (state-machine guarded) → GPS breadcrumbs → RTDB (`live/{orderId}`) throttled →
   customer/vendor maps subscribe *only while order active* → delivered → money finalised in Postgres → RTDB nodes TTL-deleted.
5. **Chat:** send → Postgres insert (truth) → Worker-2 mirrors to RTDB room for active order + FCM silent nudge to other party.
6. **Settle:** Cron (Fri/Sat) → Worker-3 aggregates delivered orders → invoice rows + line items (immutable) → Admin review states
   `GENERATED → VERIFIED → PAID` → PDF render → payout proof upload (private bucket).

## 3.3 Why 3 Workers (and their hard boundaries)

| Worker | Owns | Must never do | Free-tier note |
|---|---|---|---|
| **W1 `undal-api`** | Public catalog reads, cart validation, order placement, vouchers, reviews write, ImgBB proxy, signed-URL minting | Send FCM; run cron | Heavily cacheable GETs; 100k req/day free |
| **W2 `undal-realtime`** | Dispatch/assignment, fare engine, presence ingest, FCM (HTTP v1, service-account JWT), RTDB writes (REST + JWT), weather cache, ETA calibration | Touch invoices/KYC | Keep payloads tiny; every endpoint idempotent with `job_id` |
| **W3 `undal-admin`** | Admin APIs, KYC queues, zone CRUD, settings, invoices + Cron Triggers, PDF, audit exports, provider toggles | Be callable without admin JWT + permission check | Separate secret set; IP-allowlist optional via Cloudflare Access (free ≤50 users) |

Shared code lives in `packages/shared-ts` (types, money utils, error codes) — bundled into each Worker at deploy.
Inter-Worker calls use **service bindings** (free, no public hop) with an internal HMAC header.

## 3.4 Free-tier budget ledger (design ceilings — verify at build time in Plan Response 1)

| Service | Free limit (design assumption) | Undal budget strategy |
|---|---|---|
| Supabase DB | 500 MB Postgres | Lean rows, JSONB only for snapshots, monthly partition mindset for `order_events`/telemetry rollups, no images in DB |
| Supabase Storage | 1 GB | Private docs compressed ≤400 KB each; public images never stored here (ImgBB) |
| Supabase Auth | 50k MAU | Fine for v1 cities rollout |
| Supabase bandwidth | 5 GB/mo | Catalog via Worker cache; images via ImgBB CDN |
| Firebase RTDB Spark | 1 GB stored, 10 GB/mo download, **100 simultaneous conns** | File `06` economy: tiny nodes, TTL deletes, active-order-only subscriptions |
| FCM | Free (no quota) | Data-only, collapse-keys, TTLs per type |
| Cloudflare Workers | 100k req/day (free) | Cache-first catalog; batch presence; alert at 70% via Admin health |
| Cloudflare Pages | 500 builds/mo, unmetered static | SSG nightly + on-demand; assets immutable-hashed |
| GitHub Actions | 2,000 min/mo private (public repo = free std. runners) | Path-filtered workflows; cache Flutter/pub/npm; **recommend public repo** for unlimited minutes (secrets stay secret) |
| ImgBB | Free uploads (32 MB/file) | Client compresses to ≤1600 px WebP/JPEG ≤800 KB before proxy upload |
| Nominatim/OSRM public | Fair-use (~1 req/s) | Worker-side cache (geocode forever-cache by rounded coords; routes 60 s by OD pair); fallback straight-line × road-factor |
| Open-Meteo | Free, no key | Per-zone 15-min cache in W2 (KV-free: in-memory + Postgres `weather_cache` row) |

**Scale honesty:** this design comfortably serves launch scale (single-digit zones, hundreds of daily orders).
File `06` §9 + file `26` define the *paid-upgrade tripwires* (e.g., sustained >70 RTDB conns → shard/upgrade)
so growth is a planned decision, never a 3 a.m. outage.

## 3.5 Cross-cutting principles

- **Idempotency everywhere money/state moves:** `Idempotency-Key` header + DB unique constraints; safe retries on BD networks.
- **Optimistic UI, pessimistic server:** clients render instantly, server verdicts reconcile (cart, accept, delivered).
- **Event ledger:** `order_events` + `audit_logs` are append-only (revoke UPDATE/DELETE) — disputes are settled by replay.
- **Config over code:** every business constant in `platform_settings` (Admin-editable, versioned, audit-logged).
- **Observability on free rails:** structured Worker logs → Admin Health page (error rates, queue depths, quota gauges);
  client crash capture via self-hosted endpoint → Postgres `client_errors` (no paid Sentry).
- **Time discipline:** server time (Postgres `now()`) is truth; all money periods computed in `Asia/Dhaka`; clients display local.
