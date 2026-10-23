# 08 · The 3 Cloudflare Workers (backend brains)

Stack per Worker: TypeScript, `wrangler` config in repo, tiny router (Hono or hand-rolled — builder chooses **one** and
documents in ADR; bundle discipline ≤1 MB), zod-style validation, shared package `packages/shared_ts`.
Full endpoint catalogue: **Appendix E**. Every endpoint: auth → validate → authorize → idempotency → work → audit → typed response.

## 8.1 W1 `undal-api` — commerce gateway

- **Catalog (cache-first):** home feed, vendor page, menu, search — `Cache-Control` + edge cache keyed by zone+mode+page,
  stale-while-revalidate 30 s; cache-bust on vendor/menu writes via purge tags (or versioned keys on free plan).
- **Cart & checkout:** server cart CRUD, `validate_cart` reprice, voucher apply/release, place-order (calls Postgres
  `place_order` RPC in one transaction; then service-binding call to W2 `dispatch/order-placed`). Rate-limit: order placement
  5/min/user + Turnstile (free) on auth-adjacent abuse paths.
- **Transitions:** all order state changes (vendor accept/reject, ready, rider arrived/picked/delivered, customer cancel windows)
  → single `transition_order` RPC; W1 then notifies W2 for fan-out. Clients **never** PATCH status directly via Supabase.
- **Images:** `POST /v1/images/public` (auth, role-checked, mime/size sniff, re-encode guidance) → ImgBB proxy (file `15`);
  `POST /v1/images/private-url` mints Supabase signed upload/download URLs for KYC/proofs after ownership checks.
- **Reviews/favourites/addresses/notifications inbox/support tickets:** thin validated CRUD over Postgres with RLS double-check.

## 8.2 W2 `undal-realtime` — dispatch & wake-up engine

- **Presence ingest:** `POST /v1/presence/ping` (vendor/rider heartbeats batched by clients) → upsert
  `presence_live` (Postgres, unlogged table) + RTDB mirror throttled; staleness computed on read (D-05 thresholds from settings).
- **Assignment:** candidate query (zone + vehicle radius + session + not-stale + capacity) → score (file `12`) → create
  `order_offers` row → RTDB room update + FCM `rider_offer` → expiry scheduler (Durable-Object-free design: offer expiry
  evaluated by 15-second Cron Trigger sweep + on any related read — document the sweep; DOs are paid-adjacent complexity in v1… 
  *note: if free DO allowance is confirmed at build time, ADR may adopt one Alarm-DO per zone*).
- **Fare engine:** pure function module (file `11`) + zone SDR snapshot (counts from `presence_live` + open orders),
  weather via Open-Meteo cache, OSRM distance with straight-line fallback (`×1.35` road factor, zone-tuned).
- **FCM sender + RTDB writer:** as file `07` §5 / file `06` §4 (custom-token minting for clients: `POST /v1/realtime/token`).
- **Geo utilities:** geocode/reverse proxy w/ cache, zone resolution (point-in-polygon over cached zone set),
  ETA calibration readouts for Admin.

## 8.3 W3 `undal-admin` — operations, money, governance

- **Admin APIs:** every Appendix-C capability grouped: dashboard KPIs, dispatch board actions (reassign/unassign/cancel with
  reason + audit), vendor/rider KYC queues, menu moderation, zones CRUD (polygon validation: ≥3 pts, no self-intersect — app-side check),
  campaigns/vouchers, reviews moderation, support desk, settings (incl. auth-provider toggles D-09), roles/permissions, audit search/export CSV.
- **Invoices & cron:** `0 0 5 ? * FRI/SAT Asia/Dhaka` equivalents via Cron Triggers (UTC expressions documented with DST note —
  BD has no DST; Fri 00:05 Dhaka = Thu 18:05 UTC) → `generate_invoices` RPC → PDF job (HTML→PDF via headless render in Worker?
  **v1 pattern:** invoice PDF generated in Admin browser (print stylesheet + `window.print`) **and** server-side via
  `pdf-lib` in W3 for stored copies — builder validates byte-size/latency in Plan 1, picks one primary, documents ADR).
  Payout state transitions `GENERATED→VERIFIED→PAID` (dual-control: verifier ≠ payer for amounts > threshold — Admin setting).
- **Nightly jobs:** aggregates rollup, telemetry prune, RTDB orphan sweep (REST), trending searches, KPI snapshots,
  free-tier quota gauges → Admin Health (Workers requests est., RTDB conns est., Supabase size via SQL `pg_database_size`).
- **Webhooks (internal):** `rebuild-web` (trigger Pages deploy hook for SEO freshness on vendor changes, debounced 15 min).

## 8.4 Cross-Worker contracts

Service bindings W1→W2, W1/W2→W3-log; HMAC-signed internal headers (`X-Undal-Internal`); shared `request_id` propagation;
all DB access via Supabase PostgREST/RPC with service-role key (Worker secret) **or** direct Postgres via Hyperdrive-free
pattern — v1: PostgREST + RPC only (simpler, RLS-aware with user JWT forwarding where appropriate: user-scoped calls forward
the caller's Supabase JWT so RLS applies; system calls use service role + explicit checks in RPC).

## 8.5 Limits, errors, resilience

Per-route rate limits table in Appendix E; global body cap 256 KB (images 8 MB route-only); timeouts: OSRM/Nominatim 2.5 s
→ fallback; FCM 4 s → logged retry; Postgres 5 s → 503 typed. Circuit-breaker settings per downstream in `platform_settings`.
Health: `GET /healthz` public shallow; `GET /v1/admin/health/deep` (W3) checks DB/RTDB/FCM/ImgBB/OSRM with cached results.
