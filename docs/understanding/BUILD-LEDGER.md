# UNDAL — Master Build Ledger (`BUILD-LEDGER.md` · Version 1.0)

> **Single Living Progress Ledger (`File 27 §Rules`)**  
> **Repository:** `rahimchawdhury63-creator/undal` · **Branch:** `arena/f81366de-undal`  
> **Last Updated:** `2026-10-23` · **Current Completed Milestone:** **`Plan Response 1 — COMPLETE`**  
> **Next Scheduled Milestone:** **`Plan Response 2`** (awaiting Founder `"continue"`)

---

## 1. Global Coverage Scoreboard

| Workstream | Canonical Target | Completed | In Progress / Queued | Verification Artifact |
|---|---:|---:|---:|---|
| **Master Guide Files Read (`00–28` + `App A–N`)** | 43 | **43 (100%)** | 0 | Restated across `docs/understanding/01..03` |
| **Customer Reference Screenshots (`App 41 + Web 24`)** | 65 | **65 (100%)** | 0 | [`01-customer-surface-analysis.md`](./01-customer-surface-analysis.md) + `01a..01c` |
| **Partner + Rider Screenshots (`Partner 63 + Rider 44`)** | 107 | 0 | **107 (`Plan Response 2`)** | Queued for `04-partner-rider-analysis.md` |
| **Architecture ADRs (`D-01..D-24` + Builder ADRs)** | 24 + 4 | **28 (100%)** | Expand as needed | `docs/adr/ADR-0001..0004` |
| **Golden Math Vectors Verified (`M-1..M-8`, `F-1..F-6`)** | 14 | **14 formula-verified** | Code tests in Build `2, 5, 13` | [`02-architecture-understanding.md §3.3`](./02-architecture-understanding.md) |
| **Postgres Tables + RLS Policies (`Appendix B`)** | 45 | 0 (no product code yet) | Final DDL spec `Plan 2` → SQL `Build 1–4` | `supabase/migrations/` |
| **Cloudflare Worker Endpoints (`W1 + W2 + W3`)** | 111 routes (`73` groups) | 0 (no product code yet) | Final OpenAPI/spec `Plan 2` → `Build 6–10` | `workers/{api,realtime,admin}/` |
| **Frontend Screens (`App 40+37+29 + Web 24+33`)** | 163 | 0 (no product code yet) | `Build 12–28` | `apps/*` |
| **Super Admin Capabilities (`Appendix C`)** | 132 P0 | 0 (no product code yet) | Final registry `Plan 2` → `Build 25–28` | `apps/admin_web/` + `workers/admin/` |
| **Automated CI Gates & Self-Tests** | Active from Response 1 | **100% Passing** | Expanded every response | `.github/workflows/ci.yml` + `infra/scripts/` |

---

## 2. Standing Scope & Law Verification (`D-01` → `D-24`)

- [x] **`D-01` Food-Only (`RESTAURANT`, `HOME_KITCHEN`, `CLOUD_KITCHEN`)** — All grocery/shop tabs & tables permanently excluded.
- [x] **`D-02` 100% Free-Tier Architecture** — Verified `2026-10-23` across all vendors (confirmed Firebase Storage Blaze trap avoided!).
- [x] **`D-03` Server-Proxied ImgBB Only** — `IMGBB_API_KEY` forbidden in clients/repo; historical shared key treated as burned.
- [x] **`D-04` 3 Android Apps + 2 Web Apps (`SSG Customer Web` + `Super Admin Web`)** — Monorepo skeleton wired for all 5 surfaces.
- [x] **`D-05` 100% Free Open-Source Geospatial + Commercial-Clean Weather** — OSM + Nominatim + OSRM + MET Norway/Open-Meteo adapter.
- [x] **`D-06` Cash on Delivery Only in v1** — Zero online payment gateway integrations; bKash/bank reference IDs only for weekly settlement.
- [x] **`D-07` Friday / Saturday Configurable Weekly Settlement** — Account Cron slots 2 & 3 dedicated (`5 18 * * 4`, `5 18 * * 5`).
- [x] **`D-08` VAT-Inclusive Menu Pricing (`5/105` extraction)** — Top-added checkout VAT explicitly banned (`AP-7`).
- [x] **`D-09` Auth (`Email + Phone + Google` active; FB/Apple/GitHub settings-gated)** — Planned for `Build 3 & 13`.
- [x] **`D-10` Mandatory Super Admin TOTP 2FA + Step-Up Re-Auth** — Planned for `Build 10 & 25`.
- [x] **`D-11..D-15` Flash Box + Zero Ads + No Wallet/Sub + 3 KYC Tracks + `240px→4K` Responsive** — Locked across all specs.
- [x] **`D-16..D-24` Native Data-Only FCM Alarm + Dynamic Fare + Batching + `rank_v1` + EN/বাংলা + QR + Solo-Rider Guard + Mode Control** — Locked across all specs.

---

## 3. 32-Response Execution Tracker (`File 27`)

| # | Phase / Response Title | Key Repo Deliverables | Status | CI / Test Evidence |
|---:|---|---|:-:|---|
| **P1** | **Plan 1 — Understand the World** | `01-customer-surface-analysis.md` (+`01a..c`), `02-architecture-understanding.md`, `ADR-0001..0004`, `03-risk-register.md`, `BUILD-LEDGER.md` v1, monorepo skeleton, `ci.yml` + `verify-gates.mjs` | **DONE ✓** | `node --test` + GitHub Actions `ci.yml` green |
| **P2** | **Plan 2 — Operators & Final Contracts** | Inspect all **107** `PARTNER_APP (63) + RIDER_APP (44)` images → `04-partner-rider-analysis.md`, `05-data-model-final.md`, `06-api-contract-final.md`, `07-admin-registry-final.md`, design tokens (`File 25`), keystore/bootstrap workflows | **NEXT** | Awaiting `"continue"` |
| **B01** | **Build 1 — DB Core, RBAC, Geo, Settings, Taxonomies** | Migrations: `profiles`, `roles`, `permissions`, `audit_log`, `delivery_zones` (Sylhet seed), `platform_settings` (62 keys), `cuisine_taxonomy` (117 EN/BN), `i18n_strings`, `error_codes` | Pending | — |
| **B02** | **Build 2 — DB Catalogue, Carts, Orders, Ledger, Math** | Migrations: `vendors`, `menu_*`, `carts`, `orders`, `ledger_entries`, `invoices`, `cash_gate_state`, `price_order()`, `M-1..M-8` SQL tests | Pending | — |
| **B03** | **Build 3 — DB Dispatch, Ranking, KYC, Reviews, RLS** | Migrations: `order_offers`, `batches`, `rider_presence`, `vendor_rank_features`, `get_home_feed()`, `kyc_*`, `reviews`, `disputes`, 100% RLS + pgTAP | Pending | — |
| **B04** | **Build 4 — Realistic Non-Demo Sylhet Seed & CI DB Harness** | Real Sylhet road/zone polygons, realistic optional seed suite (`undal-cdo6` style dishes), `db-test` CI job | Pending | — |
| **B05** | **Build 5 — `packages/shared_ts` Core Math & Schemas** | Rational BigInt money & fare engines (`M-1..M-8`, `F-1..F-6` + 10K property fuzz), Zod schemas, error codes | Pending | — |
| **B06** | **Build 6 — `W1 undal-api` Part 1 (Auth, Catalogue, Cart, Media, Tiles)** | Hono + WebCrypto JWT + rate limit + ImgBB proxy + OSM tile cache + SEO manifest + cart validation | Pending | — |
| **B07** | **Build 7 — `W1 undal-api` Part 2 (Orders, QR, Chat, Reviews, Disputes)** | Order creation (`Idempotency-Key`), transitions, HMAC QR tokens, reviews, disputes, signed private URLs | Pending | — |
| **B08** | **Build 8 — `W2 undal-realtime` Part 1 (Leases, Custom Tokens, FCM)** | 100-conn RTDB lease broker, RS256 Firebase token minter, `buildDataOnlyFcmMessage()` (`ALM-01`), RTDB rules | Pending | — |
| **B09** | **Build 9 — `W2 undal-realtime` Part 2 (`ZoneDispatchDO`, Surge, Batching)** | SQLite DO `30s/120s/180s` alarms, assignment scorer, batch builder (`DSP-01..04`), weather/OSRM/Nominatim proxies | Pending | — |
| **B10** | **Build 10 — `W3 undal-admin` Part 1 (Auth+TOTP, KYC, Ops, Menus)** | Step-up TOTP verification, audit writer, KYC review + signed URLs, menu moderation, order ops | Pending | — |
| **B11** | **Build 11 — `W3 undal-admin` Part 2 (Invoices, Cash Gate, Campaigns, Health)** | Friday/Saturday invoice generator + PDF archiver (`ADR-0002`), cash gate engine (`CSH-01/02`), campaigns, health gauges | Pending | — |
| **B12** | **Build 12 — `packages/undal_core` (Flutter Shared Foundation)** | Theme tokens, `Baloo Da 2`/`Hind Siliguri`, EN/BN l10n, Dart money/fare engines (`M-1..8, F-1..6`), offline outbox, OSM map widgets | Pending | — |
| **B13** | **Build 13 — Native Kotlin Alarm & Readiness Engine** | `UndalFcmService`, `UndalAlarmService` (`STREAM_ALARM` + `FullScreenIntent`), OEM checklist, sibling `.wav` synthesis | Pending | — |
| **B14** | **Build 14 — `customer_app` Part 1 (Onboarding, Auth, Home, Search, Pickup Map)** | Screens `c-01..c-12` (`flutter_map`, filters, 3-scope search, empty recovery states) | Pending | — |
| **B15** | **Build 15 — `customer_app` Part 2 (Storefront, Variants/Bundles, Cart, Checkout)** | Screens `c-13..c-21` (1-tap `+`, live item CTA total, 3-step COD checkout, zero upsell modals) | Pending | — |
| **B16** | **Build 16 — `customer_app` Part 3 (Live Tracking, Chat, Orders, Account)** | Screens `c-22..c-40` (RTDB + HTTP poll fallback, batch pill, reviews, addresses, rewards, profile) | Pending | — |
| **B17** | **Build 17 — `partner_app` Part 1 (Auth, Restaurant/Home/Cloud KYC, Readiness)** | Screens `p-01..p-07` (3 distinct KYC tracks `KYC-01`, outlet setup, alarm self-test) | Pending | — |
| **B18** | **Build 18 — `partner_app` Part 2 (Order Console, Full-Screen Alert, QR Handover)** | Screens `p-08..p-16` (ringing accept/reject, prep timer, pickup QR display, outbox `OFF-01`) | Pending | — |
| **B19** | **Build 19 — `partner_app` Part 3 (Menu Studio, Promos, Earnings, Invoices, Staff)** | Screens `p-17..p-37` (duplicate guard `AP-9`, Flash Box opt-in, weekly invoices + `TrxID` submit) | Pending | — |
| **B20** | **Build 20 — `rider_app` Part 1 (Auth, Vehicle+Age KYC, Shift Home, Readiness)** | Screens `r-01..r-08` (NID age ≥18 hard check `KYC-02`, bicycle vs motorbike track, cash gate banner) | Pending | — |
| **B21** | **Build 21 — `rider_app` Part 2 (Offer Ring, Transparent Fare, Active Delivery)** | Screens `r-09..r-18` (`"Why this fare?"` sheet, solo-rider guard `DSP-02`, QR scanner `QR-01/02`, batch route) | Pending | — |
| **B22** | **Build 22 — `rider_app` Part 3 (Unreachable Protocol, Earnings, Cash Gate)** | Screens `r-19..r-29` (`120s` call+GPS proof, daily cash remittance `TrxID`, shift history & invoices) | Pending | — |
| **B23** | **Build 23 — `customer_web` Part 1 (Design Shell, Home, Zone/Cuisine SEO, Map)** | Pages `w-01..w-07`, responsive `240px→4K` (`WEB-02`), split-pane Leaflet pickup map | Pending | — |
| **B24** | **Build 24 — `customer_web` Part 2 (Storefront, Cart, COD Checkout, Tracking, SSG)** | Pages `w-08..w-24` + `scripts/prerender.mjs` (`WEB-01` raw `curl` HTML + `JSON-LD` + `sitemap.xml`) | Pending | — |
| **B25** | **Build 25 — `admin_web` Part 1 (Shell, TOTP 2FA, Dashboard, People/KYC, Partners)** | Domains `1–3` (`a-01..a-12`), permission command palette, KYC side-by-side reviewer | Pending | — |
| **B26** | **Build 26 — `admin_web` Part 2 (Menu Moderation, Dispatch Live Ops, Zones/Surge)** | Domains `4–6` (`a-13..a-21`), Leaflet polygon editor, live dispatch console, fare simulator | Pending | — |
| **B27** | **Build 27 — `admin_web` Part 3 (Finance/Invoices/Cash Gate, Growth, Content)** | Domains `7–8` (`a-22..a-28`), `TrxID` reconciliation queue, Flash Box manager, review moderation | Pending | — |
| **B28** | **Build 28 — `admin_web` Part 4 (System Health, Settings, RBAC, Audit, Kill Switches)** | Domain `9` (`a-29..a-33`), free-tier quota gauges, 62 settings UI, emergency zone/platform switches | Pending | — |
| **B29** | **Build 29 — Full Deployment Pipelines, APK Signing & Founder Tablet Runbooks** | `.github/workflows/deploy-*.yml`, `release-*.yml`, complete `docs/runbooks/01..20`, `assetlinks.json` | Pending | — |
| **B30** | **Build 30 — Full E2E Simulation, Security Audit, Performance Proof & Launch Gate** | 30-order E2E simulation (`RT-01`), RLS penetration suite (`SEC-01`), APK secret scan (`SEC-02`), final sign-off | Pending | — |
