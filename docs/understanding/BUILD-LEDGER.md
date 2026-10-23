# UNDAL — Master Build Ledger (`BUILD-LEDGER.md` · Version 2.5)

> **Single Living Progress Ledger (`UNDAL-MASTER-GUIDE/27-builder-protocol-32-responses.md`)**  
> **Repository:** `rahimchawdhury63-creator/undal` · **Branch:** `arena/f81366de-undal`  
> **Last Updated:** `2026-10-23` · **Current Completed Milestone:** **`Build Response 5 — COMPLETE (`16 / 16` DB Migrations + `ADR-0006` 100% Free Cloudinary)`**  
> **Next Scheduled Milestone:** **`Build Response 6`** (`W1 API Part 1 — auth/profile/addresses/catalog/search/Free Cloudinary unsigned+authenticated tickets & signed URLs + OSM tile cache`, awaiting Founder `"continue"`)

---

## 1. Global Coverage Scoreboard

| Workstream | Canonical Target | Completed | In Progress / Queued | Verification Artifact |
|---|---:|---:|---:|---|
| **Master Guide Files Read (`00–28` + `App A–N`)** | 43 | **43 (`100%`)** | 0 | Restated across `docs/understanding/01..07` |
| **Visual Reference Screenshot Audit (`All 4 Surfaces`)** | **172** | **172 (`100.0%`)** | 0 | `01-customer-*` (`65`) + `04-partner-rider-*` (`107`) |
| **Zero-Supabase-Storage Free Cloudinary Engine (`ADR-0006`)** | TS + Dart + SQL + Gate | **DONE ✓ (`Build 5`)** | Wired into `W1`/`W3` routes in `Build 6 & 10` | `ADR-0006`, `cloudinary.ts`, `cloudinary_url.dart`, `[NO-SUPABASE-STORAGE]` |
| **Shared TS & Flutter Packages (`@undal/shared-ts` + `undal_core`)** | 2 packages | **DONE ✓ (`Build 1 & 5`)** | Extended per response | `packages/shared_ts/`, `packages/undal_core/` |
| **Golden Math Parity (`M-1..M-8` + `F-1..F-6` + 10K Fuzz)** | **TS + Dart + SQL** | **TS + Dart + SQL `100%` ✓** | **0 poisha drift across all 3 engines + ledger!** | `03` & `04` `pgTAP` + `migrations-b04/b05.test.mjs` |
| **Postgres Migrations + `pgTAP` RLS Suite (`0001..0016`)** | **16 migrations / 50+ tables** | **`16 / 16` (`62` tables, `100.0%` DONE!) ✓** | **0 remaining migrations — DB engine 100% complete!** | `supabase/migrations/0001..0016`, **`107 / 107` `pg_prove` assertions** |
| **Order State Machine, Cash Gate, Ledger & Weekly Settlement** | 14 states + COD Float + Fri/Sat Invoices | **DONE ✓ (`Build 4–5`)** | Exposed via `W1`/`W2`/`W3` HTTP & Cron in `Build 6–11` | `record_order_delivered_ledger`, `sync_rider_cash_gate`, `generate_weekly_invoices` |
| **Super Admin Capabilities (`Appendix C`)** | 132 P0 | **All 62 DB tables + RLS + RPCs ready ✓** | **`Build 10–11, 25–28`** | [`07-admin-registry-final.md`](./07-admin-registry-final.md) |

---

## 2. Canonical 32-Response Execution Schedule (`File 27` Exact Order)

| Step | Canonical Title (`File 27`) | Repo Output | Status | Verification / CI Evidence |
|---|---|---|---|---|
| **Plan 1** | Understand the world & customer surfaces | `01..03`, `ADR-0001..0004`, skeleton, `ci.yml`, `verify-gates.mjs` | **DONE ✓** | GHA Run [`#39942499954`](https://github.com/rahimchawdhury63-creator/undal/actions/runs/39942499954) ✓ |
| **Plan 2** | Understand operators, final contracts, design tokens & bootstrap CI | `04..07` (+`04a..c`), `ADR-0005`, `tokens.ts`/`css`/`dart`, `keystore-generate.yml`, `bootstrap-admin.yml` | **DONE ✓** | GHA Run [`#39944956870`](https://github.com/rahimchawdhury63-creator/undal/actions/runs/39944956870) ✓ |
| **Build 1** | Monorepo + shared packages + design tokens + i18n framework | `@undal/shared-ts`, `package:undal_core`, all 8 worker/web/Flutter shells building & green | **DONE ✓** | GHA Run [`#39950731556`](https://github.com/rahimchawdhury63-creator/undal/actions/runs/39950731556) (`3/3` jobs green) ✓ |
| **Build 2** | Migrations I — auth/profiles/RBAC/audit/settings/taxonomy | `supabase/migrations/0001..0004` (`12` RLS-forced tables, `72` settings, `117` cuisines) + `30` `pgTAP` tests | **DONE ✓** | GHA Run [`#39952938406`](https://github.com/rahimchawdhury63-creator/undal/actions/runs/39952938406) (`4/4` jobs green) ✓ |
| **Build 3** | Migrations II — vendors, menus, variants, bundles, zones | `supabase/migrations/0005..0008` (`15` new RLS-forced tables = `27` cumulative, `Sylhet Sadar` + `Kulaura`, `HOME_KITCHEN` privacy, `rank_v1` RPCs) + `54` `pgTAP` tests | **DONE ✓** | GHA Run [`#39954932571`](https://github.com/rahimchawdhury63-creator/undal/actions/runs/39954932571) (`4/4` jobs green) ✓ |
| **Build 4** | Migrations III — carts, orders, events, offers, batches | `supabase/migrations/0009..0012` (`16` new RLS-forced tables = `43` cumulative, `UNLOGGED presence_live`, `price_order` `M-1..M-8` + 250 random baskets, `place_order`, QR handover) + `81` `pg_prove` assertions | **DONE ✓** | GHA Run [`#39958924561`](https://github.com/rahimchawdhury63-creator/undal/actions/runs/39958924561) (`4/4` jobs green) ✓ |
| **Build 5** | **Migrations IV (`16/16` Complete!) + `ADR-0006` Zero-Supabase-Storage Free Cloudinary** | `supabase/migrations/0013..0016` (**`19` new RLS-forced tables = `62 / 62` cumulative tables**, `0` Supabase Storage tables, ACID `DELIVERED -> ledger_entries` zero-drift conserved writer, `৳3,000` cycle / `৳5,000` bike COD ceiling gate + `TrxID` remittance auto-unlock, Fri/Sat dual-path idempotent `invoices` + `1.85%` bKash cash-out cover, verified-buyer `reviews` + auto rating sync, `24h` chat lock, Cloudinary EXIF-stripped `media_assets` registry, `prune_ephemeral_rows`, TS `cloudinary.ts` + Dart `cloudinary_url.dart` + CI `[NO-SUPABASE-STORAGE]` gate) | **DONE ✓** | **`107 / 107` `pg_prove` assertions + `9 / 9` `PGlite` suites + `164` files `0` violations** (`GHA Run verifying below`) |
| **Build 6** | **W1 API — auth/profile/catalog/search/Free Cloudinary media & signed URLs** | `workers/api` routes part 1 (`ADR-0006` unsigned preset descriptors, `authenticated` upload tickets, `s--XXXXXXXX--` signed URLs, catalog, Banglish search, OSM tile cache) | **NEXT** | Miniflare integration suite + `[NO-SUPABASE-STORAGE]` + secret-leak scan clean |
| **Build 7** | W1 API — cart/voucher/place-order/transitions/chat/reviews | `workers/api` routes part 2 | Queued | Full order happy-path + cancel matrix tests |
| **Build 8** | W2 Realtime — presence, fare engine, assignment, batcher | `workers/realtime` part 1 (`ZoneDispatchDO`) | Queued | **Appendix F fare vectors `F-1…F-6` pass in TS** |
| **Build 9** | W2 Realtime — FCM sender, RTDB rooms+tokens, cascade, cron | `workers/realtime` part 2 + `firebase/database.rules.json` | Queued | Firebase emulator **rules security suite** + data-only FCM test green |
| **Build 10** | W3 Admin — auth/RBAC/settings/zones/KYC/audit | `workers/admin` part 1 | Queued | RBAC matrix test (every role × every route) |
| **Build 11** | W3 Admin — invoices/remittances/moderation/campaigns/reports | `workers/admin` part 2 | Queued | Settlement cycle end-to-end test |
| **Build 12** | Customer App — shell, auth, address+map, home feed, search | `apps/customer_app` part 1 (`c-01..c-12`) | Queued | Widget tests + golden responsive screenshots |
| **Build 13** | Customer App — restaurant page, customiser, cart, checkout | `apps/customer_app` part 2 (`c-01..c-21`) | Queued | Flow test: browse → place COD order |
| **Build 14** | Customer App — live tracking, chat, pickup QR, history, account | `apps/customer_app` part 3 (`c-22..c-40`) | Queued | RTDB → polling fallback test; QR token test |
| **Build 15** | Customer App — Bangla pass, offline UX, accessibility, polish | `apps/customer_app` complete | Queued | Zero unlocalised strings; TalkBack/contrast audit |
| **Build 16** | Partner App — shell, auth, **3-track onboarding + document upload** | `apps/partner_app` part 1 (`p-01..p-05`) | Queued | All 3 tracks (`Restaurant/Home/Cloud`) + private bucket rules |
| **Build 17** | Partner App — **native Kotlin FCM alarm engine + readiness gate** | `apps/partner_app/android` + `p-06..p-07` | Queued | Full-screen intent + `STREAM_ALARM` loop + force-stop notice tested |
| **Build 18** | Partner App — live orders, prep timer, pickup QR, busy mode, chat | `apps/partner_app` part 3 (`p-08..p-16`, `p-25`) | Queued | Live order cycle test |
| **Build 19** | Partner App — menu CRUD, hours, finance/invoices, settings, Bangla | `apps/partner_app` complete (`p-17..p-37`) | Queued | Every `Appendix A` `p-*` screen verified |
| **Build 20** | Rider App — shell, auth, onboarding (bike/cycle), **native alarm engine** | `apps/rider_app` part 1 (`r-01..r-05` + Kotlin alarm) | Queued | Age `>= 18` gate + doc rules + alarm tests |
| **Build 21** | Rider App — session gate, online map, offer card, navigation, QR pickup | `apps/rider_app` part 2 (`r-06..r-13`) | Queued | Offer accept/reject + `D-23` solo-rider path tested |
| **Build 22** | Rider App — delivery flow, unreachable protocol, **cash gate**, earnings | `apps/rider_app` complete (`r-14..r-29`) | Queued | Every `r-*` screen; cash-gate end-to-end test |
| **Build 23** | Customer Web — shell, SSR/prerender pipeline, home, zone/cuisine pages | `apps/customer_web` part 1 (`w-01..w-07`) | Queued | **Raw `curl` / view-source contains full HTML + `JSON-LD`** |
| **Build 24** | Customer Web — restaurant page, cart, checkout, tracking, account, Bangla | `apps/customer_web` complete (`w-08..w-24`) | Queued | Lighthouse `>= 90 × 4`; mobile `240px–3840px` clean |
| **Build 25** | Admin Web — shell, TOTP, RBAC guard, Domains 1–2 (Gov, Dispatch) | `apps/admin_web` part 1 | Queued | Capabilities `C1–C40` tested |
| **Build 26** | Admin Web — Domains 3–4 (Zones/Fare + simulator, Vendor/Menu hub) | `apps/admin_web` part 2 | Queued | Capabilities `C41–C70` tested |
| **Build 27** | Admin Web — Domains 5–6 (Finance/Invoices/Remittances, Orders 360) | `apps/admin_web` part 3 | Queued | Capabilities `C71–C101` tested |
| **Build 28** | Admin Web — Domains 7–9 (Growth, Support, BI) + polish | `apps/admin_web` complete | Queued | Capabilities `C102–C132` — **`132 / 132` ticked** |
| **Build 29** | Cross-surface E2E + load + failure-injection + security audit | `tests/e2e`, `tests/security` | Queued | 3-surface live order in CI; zero high findings |
| **Build 30** | **GitHub Actions release factory** + runbooks + founder handoff | `.github/workflows/*`, `docs/runbooks/*` | Queued | Signed APKs built in Actions; all tablet runbooks verified |
