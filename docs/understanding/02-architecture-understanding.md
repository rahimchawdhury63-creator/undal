# 02 · Architecture Understanding — Guide Files 03–15 Restated & Verified

> **Owner:** Builder AI (`Plan Response 1`) · **Governing Guide Files:** `03`–`15`, `23`, `Appendices B, E, F, G, M`  
> **Scope:** Independent restatement of Undal's end-to-end architecture in builder-authored diagrams, state machines, exact rational-integer poisha math proofs across all 14 golden vectors, and **18 cross-file ambiguity resolutions (`AMB-01..AMB-18`)**.  
> **Companion ADRs:** [`ADR-0001`](../adr/ADR-0001-worker-router-and-validation.md) · [`ADR-0002`](../adr/ADR-0002-invoice-pdf-dual-strategy.md) · [`ADR-0003`](../adr/ADR-0003-dispatch-timers-do-plus-cron.md) · [`ADR-0004`](../adr/ADR-0004-customer-web-ssg-prerender.md)

---

## 1. Builder's System Topology & Trust Boundaries (`Files 03, 04, 08, 09`)

```
╔══════════════════════ UNTRUSTED CLIENT SURFACES (Public Keys ONLY: Supabase URL + Anon Key) ══════════════════════╗
║  [Customer App APK]   [Partner App APK]   [Rider App APK]   [Customer Web (CF Pages)]   [Admin Web (CF Pages)]    ║
║   Flutter + Kotlin     Flutter + Kotlin    Flutter + Kotlin    React + Vite SSG SEO       React + Vite + TOTP     ║
╚═════════╤═════════════════════╤═══════════════════╤══════════════════════╤═══════════════════════════╤════════════╝
          │ Direct Reads/Auth   │ Lease-Gated WS    │ Signed Public API    │ Dispatch & Leases         │ Admin API
          │ (RLS + Anon Key)    │ (≤100 Spark Cap!) │ (JWT + Rate Limit)   │ (DO Alarms + Cron)        │ (TOTP+RBAC)
          ▼                     ▼                   ▼                      ▼                           ▼
┌───────────────────┐ ┌───────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐ ┌─────────────────────┐
│ SUPABASE FREE     │ │ FIREBASE SPARK    │ │ W1: undal-api    │ │ W2: undal-realtime       │ │ W3: undal-admin     │
│ • Postgres (45t)  │ │ • RTDB:           │ │ • Cart/Order TX  │ │ • ZoneDispatchDO (SQLite)│ │ • 9 Admin Domains   │
│   RLS on 100%     │ │   o/{orderId}     │ │ • QR Issue/Check │ │ • Assignment + Batching  │ │ • KYC Review/ Vault │
│   PostGIS + trgm  │ │   p/{zoneId}/{id} │ │ • ImgBB Proxy    │ │ • RTDB Custom Token Mint │ │ • Weekly Invoices   │
│ • Auth (JWT/OAuth)│ │   chat/{orderId}  │ │ • OSM Tile Cache │ │ • FCM v1 Data-Only Send  │ │ • Cash Gate Engine  │
│ • 4 Private       │ │   lease_meta      │ │ • Review/Dispute │ │ • Surge + Weather + OSRM │ │ • Rank Rebuild      │
│   Storage Buckets │ │ • FCM HTTP v1     │ │ • Invoice PDF URL│ │ • Nominatim Cache Proxy  │ │ • Audit + Emergency │
└─────────▲─────────┘ └─────────▲─────────┘ └────────┬─────────┘ └────────────┬─────────────┘ └──────────┬──────────┘
          │                     │                    │                        │                          │
          └─────────────────────┴────────────────────┴────────────────────────┴──────────────────────────┘
                                       SERVER-TO-SERVER PRIVILEGED PLANE
            (SUPABASE_SERVICE_ROLE_KEY · FIREBASE_SERVICE_ACCOUNT_JSON · IMGBB_API_KEY · QR_SIGNING_SECRET)
                                                      │
          ┌─────────────────────┬─────────────────────┼─────────────────────┬─────────────────────┐
          ▼                     ▼                     ▼                     ▼                     ▼
   [ImgBB Free API]      [OSM Tile CDN]       [Nominatim Public]     [OSRM Public Router]   [Weather Upstream]
  Public food photos    30d CF Edge Cache     1 req/s + Postgres     1 req/s + zone-pair   MET Norway / Open-Meteo
   (EXIF stripped)      (Undal User-Agent)       30d cache              cache + fallback    10m zone cache + UI
```

### Core Architectural Invariants (Never Violated)
1. **Single Ledger of Truth (`D-02`):** Supabase Postgres owns every durable record. Deleting the entire Firebase RTDB tree loses zero money, zero orders, zero menus, and zero accounts — only active location dots re-hydrate from Postgres.
2. **Zero Client Write Trust (`File 05, 09`):** Clients read public catalogue & self rows via RLS, **never** directly mutating money columns, role grants, KYC verdicts, ledger entries, or cross-actor state transitions.
3. **Zero Secrets Outside Vault (`D-03, File 09`):** `IMGBB_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `QR_SIGNING_SECRET`, `ADMIN_TOTP_PEPPER`, and Android keystore secrets live **exclusively** in Cloudflare Worker Secrets and GitHub Actions Secrets — never in repo files, APKs, or browser bundles.

---

## 2. State & Storage Ownership Matrix (`Files 05, 06, 14, 15`)

| Data Class | Primary Store | Edge / Secondary Cache | TTL / Retention | Access Control |
|---|---|---|---|---|
| Accounts, RBAC, KYC, Audit, Ledger, Orders, Menus, Reviews | **Supabase Postgres** (45 tables, RLS 100%) | Feed/Menu GET cached on W1 CF Cache API (`15–30s`) | Permanent (`audit_log` immutable trigger) | Supabase JWT + RLS + `has_permission()` |
| Active Order Room (`o/{orderId}`) & Chat (`chat/{orderId}`) | **Firebase RTDB** (ephemeral) | Transcript persisted to Postgres `order_messages` | Deleted **15 min** after `DELIVERED` / `CANCELLED` | Custom Token (`role`, `activeOrderIds`) + RTDB rules |
| Rider Live Presence (`p/{zoneId}/{riderId}`) | **Firebase RTDB** (`120 B/rider`) | Mirrored snapshot in `rider_presence` table | `onDisconnect().remove()` + 60s stale sweep | Rider self-write (`uid == $riderId`); W2 admin read |
| Dispatch Offer Timers (`30s` / `120s` / `180s`) | **`ZoneDispatchDO` SQLite** (`W2`) | Backed by Postgres `order_offers` & `orders` | Cleared on terminal state (`ADR-0003`) | Internal binding inside `W2` only |
| Public Food, Menu, Banner, Review Photos | **ImgBB CDN** (`i.ibb.co`) | CDN cached globally | Permanent public URLs stored in `media_assets` | Uploaded strictly via `W1 /v1/media/public` |
| NID, Trade Licence, Rider Selfie, Dispute Evidence, Invoices | **Supabase Private Buckets** (`kyc-*`, `disputes-private`, `invoices-private`) | Never cached publicly (`Cache-Control: private, no-store`) | KYC archived 90d post-close; disputes 60d post-resolve | **Short-lived signed URLs (`≤ 300s`)** minted by W1/W3 + audit row |
| Map Tiles, Geocoding, Routes, Rain Surge | **Upstream Free APIs** | CF Cache (`30d` tiles) + Postgres `geocode_cache` (`30d`) + DO (`10m` weather) | Automatic eviction / TTL refresh | Proxied via W1/W2 with custom `User-Agent` |

---

## 3. Critical Engine Mechanics & Exact Golden-Vector Proofs (`Files 06, 07, 10–13, Appendix F`)

### 3.1 RTDB 100-Connection Lease State Machine (`File 06`)
```
Idle Surface (Home / Menu / Cart / Closed Kitchen / Offline Rider) ──► RTDB OFFLINE (`goOffline()` — 0 sockets!)
  └─► Active Work Triggered ──► `POST W2 /rt/lease/acquire`:
       • `< 85 active`  : Full lease (`ttl = 300s`, renew at `240s`, narrow custom claims)
       • `85–94 active` : Soft pressure — deny optional Admin live map; shorten Customer TTL
       • `≥ 95 active`  : Priority shed — Riders on delivery > Partners on active order > Online Riders retain WS;
                          Customers switch seamlessly to `GET W1 /v1/orders/:id/live-poll` (`5s` interval, `2s` edge cache)
```

### 3.2 Data-Only FCM + Native Kotlin Foreground Alarm Pipeline (`File 07`)
- **Sender invariant (`ALM-01`):** `buildDataOnlyFcmMessage()` structurally omits `notification` at both TypeScript compile time (`notification?: never`) and runtime assertion. Priority classes: **`P0`** (`ttl=60s`, full-screen ring), **`P1`** (`ttl=600s`, chime), **`P2`** (`ttl=3600s`, silent sync).
- **Receiver invariant (`ALM-02/03`):** Native Kotlin `UndalFcmService` dedups `(order_id, alert_id)`, takes a 45s `WakeLock`, starts `UndalAlarmService` looping `undal_order_alert_loop.wav` on `AudioAttributes.USAGE_ALARM` + `FullScreenIntent` (`OrderAlertActivity`), sends `POST /v1/alerts/ack`, and halts `< 2s` on `alert_cancel` when accepted/handled on another device.

### 3.3 Exact Rational-Integer Verification of ALL 14 Appendix F Golden Vectors
Executing the canonical formulas in Python (`ROUND_HALF_UP`) reproduced **every single value in `Appendix F` (`M-1..M-8` and `F-1..F-6`) to 0.00 poisha error** and uncovered **four subtle implementation laws** that SQL, TypeScript, and Dart MUST share identically:

1. **Rational Fraction Arithmetic Before Final `ROUND_HALF_UP` (`F-3`, `F-5`):**
   - In `F-3`, `SDR = 1 / 6` gives exact rational `surge = 1.5 + ((0.5 - 1/6) / 0.5) * 0.7 = 59/30 = 1.9666666...` (displayed rounded as `x1.967` in table headers): `(3000 + 5.5 × 1400) × (59/30) × 1.40 + 1200 = 30660.666... → 30661 poisha (৳306.61)`! Using truncated `1.967` would wrongly yield `30666` (+5p error!).
   - In `F-5`, **bicycle default `base_fare_poisha = 2500` (`৳25.00`), `per_km = 800` (`৳8.00/km`), `floor = 3000` (`৳30.00`)**, `SDR = 2/3 → surge = 4/3 = 1.333333...`, `extreme_heat = +10%`, `delay = 7m → 1 block = 400`: `(2500 + 1.7 × 800) × (4/3) × (11/10) + 400 = 6061.333... → 6061 poisha (৳60.61)`! And in `F-2` (`0.3 km`): `2500 + 240 = 2740 → max(3000, 2740) = 3000 poisha (৳30.00)`!
2. **Batch Discount Scope (`F-4`):** Position 2 applies `0.60` **strictly to `base_fare_poisha`**: `(0.60 × 3000 + 2.4 × 1400) × 1.675 × 1.20 + 800 = 5160 × 2.01 + 800 = 11171.60 → 11172 poisha (৳111.72)`.
3. **Platform Discount Reimbursement & Pickup Platform Fee (`M-3`, `M-4`, `M-7`):**
   - `commission = round_half_up(food_payable * commission_bps, 10000)` (`15%` = `1500 bps`), `vat_extracted = round_half_up(food_payable * 5, 105)`, `rider_bonus = round_half_up(food_payable * 300, 10000)`.
   - `vendor_net = food_payable - commission + discount_platform` (`M-3`: `30000 - 4500 + 5000 = 30500`; `M-7`: `24000 - 3600 + 11000 = 31400`).
   - `platform_fee = 0` on `pickup` (`M-4`: `COD = 22500`) and `500` (`৳5.00`) on `delivery` (`M-1..M-8`).

| ID | Key Inputs | Exact Computed Poisha Outputs (`100p = ৳1.00`) | Appendix F Target | Match |
|---|---|---|---:|:-:|
| **M-1** | `items=54100`, `discV=10820`, `deliv=0`, `plat=500` | `food=43280, tax=2061, comm=6492, bonus=1298, vNet=36788, COD=43780` | `৳437.80` | **✓** |
| **M-2** | `items=30000`, `deliv=6000`, `plat=500` | `food=30000, tax=1429, comm=4500, bonus=900, vNet=25500, COD=36500` | `৳365.00` | **✓** |
| **M-3** | `items=40000`, `discV=5000`, `discP=5000`, `deliv=2000`, `plat=500` | `food=30000, tax=1429, comm=4500, bonus=900, vNet=30500, COD=32500` | `৳325.00` | **✓** |
| **M-4** | `pickup`, `items=25000`, `discV=2500`, `deliv=0`, `plat=0` | `food=22500, tax=1071, comm=3375, bonus=675, vNet=19125, COD=22500` | `৳225.00` | **✓** |
| **M-5** | `items=270500`, `discV=54100`, `deliv=13000`, `plat=500` | `food=216400, tax=10305, comm=32460, bonus=6492, vNet=183940, COD=229900` | `৳2,299.00` | **✓** |
| **M-6** | `items=9900`, `deliv+small=5000`, `plat=500` | `food=9900, tax=471, comm=1485, bonus=297, vNet=8415, COD=15400` | `৳154.00` | **✓** |
| **M-7** | `items=35000`, `discP=11000`, `deliv=5000`, `plat=500` | `food=24000, tax=1143, comm=3600, bonus=720, vNet=31400, COD=29500` | `৳295.00` | **✓** |
| **M-8** | `items=18000`, `discV=1800`, `deliv=0 (promo)`, `plat=500` | `food=16200, tax=771, comm=2430, bonus=486, vNet=13770, COD=16700` | `৳167.00` | **✓** |
| **F-1** | `moto(3000,1400)`, `2.4km`, `SDR=3/8`, `rain`, `12m`, `b1` | `sub=6360, surge=67/40, weather=6/5, traffic=800 → 13584` | `৳135.84` | **✓** |
| **F-2** | `bike(2500,800,floor=3000)`, `0.3km`, `SDR≥1`, `clear`, `0m` | `raw=2740 → max(3000, 2740) = 3000` | `৳30.00` | **✓** |
| **F-3** | `moto(3000,1400)`, `5.5km`, `SDR=1/6`, `storm`, `16m`, `b1` | `sub=10700, surge=59/30, weather=7/5, traffic=1200 → 30661` | `৳306.61` | **✓** |
| **F-4** | `moto(3000×0.60,1400)`, `2.4km`, `SDR=3/8`, `rain`, `12m`, `b2` | `sub=5160, surge=67/40, weather=6/5, traffic=800 → 11172` | `৳111.72` | **✓** |
| **F-5** | `bike(2500,800)`, `1.7km`, `SDR=2/3`, `heat`, `7m`, `b1` | `sub=3860, surge=4/3, weather=11/10, traffic=400 → 6061` | `৳60.61` | **✓** |
| **F-6** | `moto(3000,1400)`, `9.5km`, `SDR≥1`, `clear`, `3m`, `b1` | `sub=16300, surge=1, weather=1, traffic=0 → 16300` | `৳163.00` | **✓** |

---

## 4. Complete Cross-File Ambiguity & Resolution Register (`AMB-01` → `AMB-18`)

| ID | Files Involved | Ambiguity / Nuance Identified | Deterministic Resolution Adopted |
|---|---|---|---|
| **AMB-01** | `11 §11.2` + `App F (F-3, F-5)` | Floating/truncated surge decimals (`1.967`, `1.333`) create 1–5 poisha drift across languages. | Implement pure **BigInt rational numerator/denominator arithmetic (`num / den` with single final `round_half_up`)** identically in SQL, TypeScript, and Dart (`0` poisha drift forever!). |
| **AMB-02** | `11 §11.1–11.2` + `App F (F-2, F-5)` | Exact bicycle vs motorbike seed defaults not tabulated in a single row. | Seed explicit zone defaults: **Motorbike** `base=3000, rate=1400, floor=4000`; **Bicycle** `base=2500, rate=800, floor=3000`, `included_km=2.0`, `traffic_block=400/5m`. |
| **AMB-03** | `08 §8.3` vs CF Workers Free | Workers Free caps Cron Triggers at **5 per account** and **1-minute min granularity**. | **`ADR-0003`:** Use **4 total Cron slots across account** + **`ZoneDispatchDO` SQLite `setAlarm()`** for exact millisecond `30s` / `120s` / `180s` timers. |
| **AMB-04** | `23 §23.7` vs CF 10ms CPU | Complex OpenType Bengali TTF layout can exceed 10 ms HTTP Worker CPU cap. | **`ADR-0002`:** Browser `Baloo Da 2 + Hind Siliguri` print stylesheet + PDF archival upload + `<2ms` server summary PDF generator in `W3`. |
| **AMB-05** | `19 §19.1` vs `WEB-01` | Headless Chrome prerender vs fast Node SSR prerender + new post-build vendors. | **`ADR-0004`:** Vite `entry-server` `renderToString()` static HTML generator + CF Pages dynamic `/r/[slug]` meta fallback. |
| **AMB-06** | `11 §11.6` vs Open-Meteo Terms | Open-Meteo Free Terms restrict commercial use without paid license; `api.met.no` is CC BY 4.0 commercial-free! | Build dual-provider weather adapter (`MET_NORWAY` commercial-free default + `OPEN_METEO` toggle + manual Admin weather override) behind 10-min zone cache (`RSK-09`). |
| **AMB-07** | `01c (#W12)` vs `05 §5.5` | Real live store `undal-cdo6` uses category-level rich descriptions. | Add `description_en text` and `description_bn text` to `menu_categories` in `05-data-model-final.md`. |
| **AMB-08** | `10 §10.2` vs `23 §23.2` | Physical COD cash flow between Customer, Rider, Partner, and Platform across Delivery vs Pickup. | **Explicit 4-leg double-entry accounting (`File 10 + 23`):** On **Delivery**, Rider collects `COD_COLLECT` from Customer (`rider cash_on_hand += COD_COLLECT - tip`, Rider retains `tip` immediately; Platform owes Vendor `vendor_net` & owes Rider `fare + 3% bonus`; Rider remits collected cash daily; Friday/Saturday settles net balance). On **Pick-up (`M-4`)**, Partner collects `COD_COLLECT` directly at counter (`vendor owes platform = commission + platform_fee - platform_discount`). Confirm operational preference with Founder in Question #1! |
| **AMB-09** | `10 §10.2` (`M-4`) Platform Fee | `M-4` sets `platform_fee = 0` on pickup (`500` on delivery). | Configure separate `fees.platform_fee_delivery_poisha = 500` and `fees.platform_fee_pickup_poisha = 0` in `platform_settings` (`Appendix M`). |
| **AMB-10** | `D-08` vs `#W20` Web Checkout | Reference added VAT on top (`+Tk 19`), whereas `D-08` specifies VAT-inclusive menu prices. | Strictly enforce `D-08`: menu prices include VAT; `vat_extracted = round_half_up(food_payable * 5, 105)` is informational only. |
| **AMB-11** | `13 §13.1` Stage 3 Prep Cap | `prep_minutes > 45` filter vs authentic Home Kitchens (`Farhanar Rannaghor` 75m in `#W23`). | Exempt `HOME_KITCHEN` when browsing Home Kitchens / Search / explicit `Show all` while preserving fast default feed cap (`rank.max_prep_minutes`). |
| **AMB-12** | `06 §6.4` Order Chat Safety | Preventing off-platform phone/payment solicitation in live chat without breaking UX. | Store clean transcripts in `order_messages` with soft pattern flagging for Admin dispute review + 15m RTDB purge. |
| **AMB-13** | `22 §22.2` Offline Counter QR | Brief indoor 4G drop at pickup counter scan. | HMAC-signed QR token verified online first, with signed local queue (`≤ 90s` replay window) + 4-digit fallback code logged in `audit_log`. |
| **AMB-14** | `09 §9.3` `FLAG_SECURE` Scope | `#09` showed global `FLAG_SECURE` breaks screenshot receipts. | Apply `FLAG_SECURE` **only** on password/TOTP/KYC-viewer screens; keep Order Receipts, TrxID screens, and Invoices screenshot-friendly! |
| **AMB-15** | `04` Shared Packages | Avoiding 10 fragmented micro-packages while sharing 100% logic. | Consolidate into `packages/shared_ts` (Workers + Web) and `packages/undal_core` (all 3 Flutter apps). |
| **AMB-16** | `21` Multi-Outlet Staff | One Partner account managing multiple outlets (`vendor_members`). | Outlet switcher in Partner App header/drawer with per-request `vendor_id` membership check. |
| **AMB-17** | `02` Image Count (`170` vs `172`) | `PARTNER_APP/` contains 63 images (`+2` extra captures). | Inspect all `63 + 44 = 107` images in `Plan Response 2` (`172 / 172 total`). |
| **AMB-18** | `24` Secret Hygiene | Sandbox `gh secret list` returns 403 (`integration scope`), plus burned historical ImgBB key (`D-03`). | Never hardcode any secret; validate secret presence gently in deploy workflows with human-readable tablet runbook hints (`Appendix K`). |
