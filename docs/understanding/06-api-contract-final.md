# 06 · Final API, Realtime & FCM Contract (`Appendix E` & `Appendix G` Frozen)

> **Plan Response 2 Frozen Wire Contract** · Drives **`Build Responses 6–11`** (`workers/api`, `workers/realtime`, `workers/admin`) and customer-commerce integration in **Build Response 13**
> **Global Wire Laws:**
> 1. **Standard JSON Envelope:** Success → `{"data": ..., "request_id": "req_..."}` · Error → `{"error": {"code": "ORDER_STATE_ILLEGAL", "message_en": "...", "message_bn": "...", "details": ...}, "request_id": "req_..."}`.
> 2. **Money Format on Wire:** 100% integer **poisha** (`*_poisha: number`), validated by shared Zod schemas in `packages/shared_ts`.
> 3. **Idempotency:** Every state-mutating POST/PATCH/DELETE on carts, orders, offers, sessions, remittances, invoices, and penalties **requires `Idempotency-Key: <uuid>`** (`24h` replay cache in `idempotency_keys`).
> 4. **Zero Client Secret Exposure (`D-03`):** `IMGBB_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `INTERNAL_HMAC_SECRET`, and `UNDAL_BKASH_NUMBER` never leave Workers.
> 5. **Public Media (`ADR-0006 v2`):** every avatar, vendor/menu image, banner, and review photo must use ImgBB; SQL constraints and W1 response sanitizers reject/strip all other public-provider URLs.

---

## 1. `W1 undal-api` — Public, Customer, Partner & Rider Core API (`Build Responses 6–7`)

| Build | Method | Path | Auth Scope | Rate Limit / Idempotency | Cache / Notes |
|---:|---|---|---|---|---|
| **B06** | `GET` | `/healthz` | `public` | `120/min/ip` | Returns Worker SHA, region, shallow DB ping |
| **B06** | `GET` | `/v1/config/public` | `anon` | `120/min/ip` | Min supported app versions, auth flags, maintenance banner EN/BN (`Cache-Control: max-age=60`) |
| **B06** | `GET` | `/v1/zones/resolve` | `anon` | `60/min/ip` | `?lat=&lng=` → active zone verdict + nearest zone suggestion if outside |
| **B06/B13** | `GET` | `/v1/home/feed` | `anon \| customer` | `60/min/ip` | `?zone_id=&mode=delivery\|pickup&cuisine=&sort=&cursor=` (`rank_v1`, `s-maxage=30` for anon); vendor/banner URLs are ImgBB-only |
| **B06/B13** | `GET` | `/v1/vendors/{slug}` | `anon` | `120/min/ip` | Storefront header, hours, busy buffer, promos, distance; ImgBB-only logo/cover (`HOME_KITCHEN` exact address redacted!) |
| **B06/B13** | `GET` | `/v1/vendors/{slug}/menu` | `anon` | `120/min/ip` | Public categories, current item orderability, variants/options/bundle choices, coarse vendor profile and weekly hours; no private labels/address; customer image URLs are ImgBB-only |
| **B06/B13** | `GET` | `/v1/vendors/{slug}/reviews` | `anon` | `60/min/ip` | Cursor-paginated visible, moderated verified-buyer reviews + kitchen replies; reviewer identity is excluded and only ImgBB photo URLs render |
| **B06** | `GET` | `/v1/search` | `anon` | `60/min/ip` | `?q=&zone_id=&scope=all\|dishes\|vendors` (Banglish synonym expansion + trigram match) |
| **B06** | `GET` | `/v1/seo/sitemap-data` | `public` | `12/min/ip` | Active zones, cuisines, and approved vendor slugs for SSG prerender + `sitemap.xml` |
| **B06** | `POST` | `/v1/images/public` | `vendor \| customer \| admin` | `30/day/vendor` | Magic-byte verified `JPEG/PNG/WebP <= 5MB` + Edge JPEG/PNG EXIF/GPS strip → **Unlimited Free ImgBB** (`D-03` + `ADR-0006` — **100% of public & platform images**) |
| **B06** | `POST` | `/v1/images/private-upload-url` | `authenticated` | `20/min/user` | Mints `authenticated` / secure-preset ticket strictly on **Cloudinary Private Vault** (**ONLY sensitive compliance media**: `kyc`, `remittance`, `selfie`, `dispute`, `chat`, `invoice_pdf`; `0` Supabase Storage bytes) |
| **B06** | `POST` | `/v1/images/private-view-url` | `owner \| admin-perm` | `20/min/user` | Mints `120s` SHA-256 `s--XXXXXXXX--` signed Cloudinary URL **and writes mandatory `audit_logs` entry** |
| **B06** | `POST` | `/v1/devices/token` | `authenticated` | `10/min/user` | Registers FCM token + `oem_brand` + `alarm_ready` flag in `device_tokens` |
| **B06** | `GET` | `/v1/notifications` | `authenticated` | `60/min/user` | Cursor-paginated bilingual inbox (`PATCH /v1/notifications/read` marks read) |
| **B07** | `GET/POST/PATCH/DELETE` | `/v1/addresses` (`/{id}`) | `customer` | `30/min/user` | Resolves `zone_id` on save; enforces single default address |
| **B07** | `POST` | `/v1/favourites/{vendorId}` | `customer` | `30/min/user` | Idempotent toggle `{is_favourite: boolean}` |
| **B07** | `GET/POST` | `/v1/cart` | `customer` | `30/min + Idem` | Fetches active cart or switches kitchen (`confirm_clear=true` guards `CART_VENDOR_CONFLICT`) |
| **B07** | `PATCH` | `/v1/cart/items` | `customer` | `60/min + Idem` | Adds/updates/removes item + variants/options/bundle choices |
| **B07/B13** | `POST` | `/v1/cart/validate` | `customer` | `30/min/user` | Service-role-only `quote_customer_cart()` → current modifiers/promos, audited zone distance-tier fee + platform setting, integer-poisha waterfall/COD ceiling; client fee fields are ignored |
| **B07** | `POST/DELETE` | `/v1/cart/voucher` | `customer` | `10/min/user` | Validates & attaches/removes promo voucher |
| **B07/B13** | `POST` | `/v1/orders` | `customer` | `5/min + Idem` | Atomic COD `place_order()` recomputes modifiers/discounts, zone fee and platform setting; optional integer `expected_cod_poisha` mismatch returns `CART_STALE`; client fees are ignored → signed HMAC dispatch to `W2` |
| **B07** | `GET` | `/v1/orders` & `/v1/orders/{code}` | `authenticated` | `60/min/user` | Role-scoped order list & full order detail (poisha waterfall + monotonic `order_events`) |
| **B07** | `GET` | `/v1/orders/{code}/live` | `participant` | `30/min/user` | Seamless HTTP polling fallback (`ETag` supported) when RTDB lease is closed or cap reached |
| **B07** | `POST` | `/v1/orders/{id}/accept` | `vendor` | `30/min + Idem` | Commits `prep_minutes` (`15/25/35`), cancels alarm loop, triggers `W2` early rider dispatch |
| **B07** | `POST` | `/v1/orders/{id}/reject` | `vendor` | `30/min + Idem` | Records structured `cancel_reason_key`; optional 1-tap snooze of out-of-stock item |
| **B07** | `POST` | `/v1/orders/{id}/ready` | `vendor` | `30/min + Idem` | Marks `READY_FOR_PICKUP`; sends high-priority notice to assigned rider / pickup customer |
| **B07** | `POST` | `/v1/orders/{id}/arrived-vendor` | `rider` | `30/min + Idem` | GPS geofence check (`<= 150m` from vendor pin); starts kitchen wait-pay clock |
| **B07** | `POST` | `/v1/orders/{id}/pickup-verify` | `rider \| customer` | `20/min + Idem` | Validates HMAC QR payload (or audited 4-digit fallback) → transitions to `PICKED_UP` / `DELIVERED` |
| **B07** | `POST` | `/v1/orders/{id}/picked-up` | `rider` | `20/min + Idem` | Records optional anonymous `pickup_feedback_rating` & `pickup_feedback_tags` (`ADR-0005`) |
| **B07** | `POST` | `/v1/orders/{id}/arrived-customer` | `rider` | `20/min + Idem` | GPS check near customer pin; starts `120s` unreachable protection clock |
| **B07** | `POST` | `/v1/orders/{id}/delivered` | `rider` | `20/min + Idem` | Confirms COD collected → writes append-only `ledger_entries` waterfall + checks Cash Gate ceiling |
| **B07** | `POST` | `/v1/orders/{id}/failed-delivery` | `rider` | `10/min + Idem` | Verifies `>= 2` call logs + `>= 120s` GPS dwell + private doorstep photo proof (`File 22 §22.5`) |
| **B07** | `POST` | `/v1/orders/{id}/cancel` | `customer \| vendor` | `10/min + Idem` | Window-guarded cancellation (`customer` free cancel only prior to `VENDOR_ACCEPTED`) |
| **B07** | `POST` | `/v1/orders/{id}/review` & `/v1/reviews/{id}/reply` | `participant / vendor` | `10/min + Idem` | Verified order rating + tags + photos; polite vendor reply |
| **B07** | `GET/POST` | `/v1/chats/{orderId}/messages` | `participant` | `60/min/user` | Text + private chat photo key + quick chips (`c_r`, `c_v`, `r_v`) |
| **B07** | `GET/POST` | `/v1/support/threads` (`/{id}/messages`) | `authenticated` | `10/min + Idem` | Opens ticket / dispute pre-linked to `order_id` (`p-16` / `c-29` / `r-28`) |
| **B07** | `PATCH/POST` | `/v1/partner/*` (store status, hours, menu CRUD, KYC, invoices) & `/v1/rider/*` (KYC, remittances, earnings) | `vendor \| rider` | `30/min + Idem` | Complete self-service mutations backing `p-03..p-37` & `r-02..r-25` |

---

## 2. `W2 undal-realtime` — Dispatch DO, RTDB Lease Broker & Data-Only FCM (`Build Responses 8–9`)

| Build | Method | Path | Auth Scope | Purpose & Free-Tier Protection |
|---:|---|---|---|---|
| **B08** | `GET` | `/healthz` | `public` | Health + active DO count + RTDB lease gauge (`x / 85` active leases) |
| **B08** | `POST` | `/v1/presence/ping` | `vendor \| rider` | Batched heartbeat (`15s` active delivery, `45s` idle online) → updates `presence_live` + active RTDB room |
| **B08** | `POST` | `/v1/riders/session/start` | `rider` (`Idem`) | Verifies KYC `approved`, age `>= 18`, valid licence (if motorbike), selfie uploaded, and **Cash Gate clear** (`CASH_GATE_ACTIVE` `403` if blocked) |
| **B08** | `POST` | `/v1/riders/session/end` | `rider` (`Idem`) | Ends online session cleanly; surfaces COD Cash Remittance card if balance `> 0` |
| **B08** | `POST` | `/v1/dispatch/order-placed` | `INTERNAL_HMAC` | Wakes per-zone `ZoneDispatchDO` (`SQLite`-backed Durable Object): fires immediate vendor alarm + computes `F-1..F-6` rider fare & batch plan |
| **B08** | `POST` | `/v1/offers/{id}/accept` | `rider` (`Idem`) | Atomic SQLite DO lock (`first writer wins`, `OFFER_EXPIRED` `410` to races) → assigns rider + emits RTDB room update |
| **B08** | `POST` | `/v1/offers/{id}/reject` | `rider` (`Idem`) | Enforces `D-23` Solo-Rider Guard (`OFFER_NOT_REJECTABLE` `409` → escalates to Dispatch Tower if `solo_rider == true`); cascades to next scored rider |
| **B08** | `GET` | `/v1/zone/{id}/sdr` | `rider \| admin` | Returns cached `60s` zone Supply/Demand Ratio, weather state, and H3 hotspot polygons for Rider heatmap (`r-07`) |
| **B08** | `POST` | `/v1/geo/geocode` · `/v1/geo/reverse` · `/v1/geo/route` | `authenticated` | Proxies **Nominatim** (`<= 1 req/s` queue + identifiable `User-Agent` + Postgres `geocode_cache` `30d`) & **OSRM** (`5m` route cache + Haversine×road-factor fallback) |
| **B09** | `POST` | `/v1/realtime/token` | `participant \| admin` | Mints short-lived (`15m`) RS256 Firebase Custom Token **ONLY when live RTDB lease slot `< 85/100`**, returning `{mode: "rtdb", token, dbPath}` or `{mode: "poll", pollIntervalMs: 5000}` cleanly (`RSK-01`!) |
| **B09** | `POST` | `/v1/alerts/test` | `vendor \| rider \| admin` | Dispatches live high-priority **data-only FCM** `ALARM_SELF_TEST` payload to verify native Kotlin `STREAM_ALARM` audio & full-screen wake (`p-07` / `r-06`) |
| **B09** | `GET` | `/v1/cashgate/config` | `rider` (KYC approved) | Returns receiving `UNDAL_BKASH_NUMBER` / `UNDAL_NAGAD_NUMBER` from Worker secret store (`never hardcoded in APK!`) |

### Mandatory Data-Only FCM Payload Contract (`File 07` — Enforced by Static Gate & Unit Test)
```json
{
  "message": {
    "token": "<device_fcm_token>",
    "android": { "priority": "high", "ttl": "90s" },
    "data": {
      "undal_event": "ORDER_RING",
      "order_id": "uuid",
      "public_code": "UD-SYL-261023-0155",
      "amount_poisha": "43780",
      "expires_epoch_ms": "1792761090000",
      "hmac": "<sha256>"
    }
  }
}
```
> **HARD BAN (`Gate 5`):** Top-level `"notification"` and `"android.notification"` keys are **100% forbidden** because Android suppresses `onMessageReceived()` when backgrounded if `"notification"` is present!

---

## 3. `W3 undal-admin` — Super Admin API, RBAC, Step-Up TOTP & Settlement Crons (`Build Responses 10–11`)

Every `/v1/admin/*` route runs the **4-gate middleware pipeline**:
`Supabase JWT Verify → profiles.role == 'admin' & totp_enrolled_at != null → RBAC permission check (C1..C132) → Step-Up TOTP header X-Undal-Step-Up (5-min window for money/role/kill-switch writes) → Automatic audit_logs before/after diff write`.

| Build | Route Family | Permissions Required | Step-Up TOTP | Capabilities Backed |
|---:|---|---|:---:|---|
| **B10** | `POST /v1/admin/auth/step-up` · `GET/POST/PATCH /v1/admin/users` · `GET/POST/PATCH /v1/admin/roles` · `GET/DELETE /v1/admin/sessions` | `1.admin_users`, `1.roles_matrix`, `1.sessions` | **YES** (writes) | `C1–C9` |
| **B10** | `GET /v1/admin/audit` · `POST /v1/admin/audit/export` · `GET/PATCH /v1/admin/settings` · `POST /v1/admin/settings/rollback` · `POST /v1/admin/kill-switches` · `GET /v1/admin/health/deep` · `GET/PATCH /v1/admin/errors` | `1.audit_logs`, `1.platform_settings`, `1.kill_switches`, `1.health` | **YES** (settings & kill switches) | `C10–C21` |
| **B10** | `GET /v1/admin/dispatch/board` · `GET /v1/admin/dispatch/map` · `POST /v1/admin/orders/{id}/{assign\|reassign\|unassign\|cancel\|force-complete\|eta}` · `POST /v1/admin/riders/{id}/end-session` · `POST /v1/admin/batches/{id}/break` | `2.live_map`, `2.order_tower`, `2.interventions`, `2.fleet`, `2.batching`, `2.sla` | **YES** (`force-complete`, `cancel`) | `C22–C40` |
| **B10** | `GET/POST/PATCH /v1/admin/zones` · `PATCH /v1/admin/zones/{id}/fees` · `PATCH /v1/admin/fare-config` · `POST /v1/admin/fare/simulate` | `3.zones`, `3.delivery_fees`, `3.fare_engine`, `3.radii` | **YES** (pricing updates) | `C41–C54` |
| **B10** | `GET /v1/admin/kyc/queue` · `POST /v1/admin/kyc/{type}/{id}/decide` · `GET/PATCH /v1/admin/vendors/{id}` · `POST /v1/admin/vendors/{id}/{pause\|suspend}` · `GET/POST /v1/admin/menu/moderation` · `CRUD /v1/admin/taxonomy` · `GET /v1/admin/catalog/search` | `4.pipeline`, `4.vendor_360`, `4.menu_moderation`, `4.catalog` | **YES** (`suspend`, payout edit) | `C55–C70` |
| **B11** | `GET /v1/admin/invoices` · `POST /v1/admin/invoices/generate` · `POST /v1/admin/invoices/{id}/verify` · `POST /v1/admin/invoices/{id}/pay` · `GET /v1/admin/invoices/{id}/pdf` · `GET/POST /v1/admin/remittances` · `POST /v1/admin/adjustments` · `GET /v1/admin/ledger` · `GET /v1/admin/finance/reports/{kind}` | `5.invoices`, `5.remittances`, `5.adjustments`, `5.ledger`, `5.reports` | **YES** (`verify`, `pay`, `adjustments`) | `C71–C89` |
| **B11** | `GET /v1/admin/orders/search` · `GET /v1/admin/orders/{id}/360` · `GET/PATCH /v1/admin/exceptions` · `POST /v1/admin/orders/{id}/modify` | `6.order_360`, `6.exceptions`, `6.modify`, `6.search` | **YES** (goodwill voucher) | `C90–C101` |
| **B11** | `CRUD /v1/admin/campaigns` (incl. `Flash Box`) · `CRUD /v1/admin/vouchers` · `CRUD /v1/admin/banners` · `PATCH /v1/admin/referrals` · `POST /v1/admin/nudges/{draft\|approve\|send}` | `7.flash_box`, `7.campaigns`, `7.vouchers`, `7.banners`, `7.referrals`, `7.nudges` | **YES** (`nudges/send`, budget > cap) | `C102–C113` |
| **B11** | `GET/PATCH /v1/admin/support/threads` · `GET /v1/admin/chats/live` · `POST /v1/admin/disputes/{id}/resolve` · `POST /v1/admin/reviews/{id}/moderate` · `GET/POST /v1/admin/customers/{id}` | `8.inbox`, `8.live_chats`, `8.disputes`, `8.reviews`, `8.customer_360` | **YES** (`suspend`, money resolution) | `C114–C124` |
| **B11** | `GET /v1/admin/dashboard/kpis` · `GET /v1/admin/bi/{executive\|funnels\|cohorts\|demand\|quality}` · `CRUD /v1/admin/bi/saved-reports` | `9.executive`, `9.funnels`, `9.cohorts`, `9.demand`, `9.reports`, `9.quality` | No (read/export audited) | `C125–C132` |

**5 Cloudflare Cron Triggers (`Account Quota = 5/5`, Zero Waste):**
1. `*/5 * * * *` (`W2`): Prune stale `presence_live`, sweep orphan RTDB rooms, refresh active zone weather cache (`api.met.no` primary / `Open-Meteo` fallback).
2. `5 18 * * 4` (`Fri 00:05 Asia/Dhaka`, `W3`): Generate weekly **Rider Settlement Invoices** (`UNIQUE(period_start, 'rider', rider_id)`).
3. `5 18 * * 5` (`Sat 00:05 Asia/Dhaka`, `W3`): Generate weekly **Partner Settlement Invoices** (`UNIQUE(period_start, 'vendor', vendor_id)`).
4. `30 20 * * *` (`02:30 Asia/Dhaka`, `W3`): Prune ephemeral logs/caches (`>30d`), refresh `rank_v1` Bayesian priors, flag expiring licences (`30d/7d/0d`).
5. `0 * * * *` (`Hourly`, `W3`): Deep free-tier quota telemetry snapshot (DB MB, Storage MB, RTDB bytes, Worker requests).
