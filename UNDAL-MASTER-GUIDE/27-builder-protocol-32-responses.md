# 27 · Builder Protocol — 2 Plan + 30 Build Responses (how the AI constructs Undal)

**Contract:** maximum useful output per response; at the end of each response STOP and wait for the founder's `continue`.
No response may end with placeholder code “to be finished later” inside merged files — unfinished scope simply moves to
the next response's plan (tracked in `docs/understanding/BUILD-LEDGER.md`, updated every response).

## Plan Response 1 — “Understand the world” (no product code)
Read: this entire guide + open **every** image in `reference-images/CUSTOMER_APP` + `CUSTOMER_WEB_APP`.
Produce in repo: `docs/understanding/01-customer-surface-analysis.md` (per-image findings extending guide file `02`),
`02-architecture-understanding.md` (guide files 03–15 restated as builder's own diagrams/tables + every ambiguity found
with proposed resolution), `03-risk-register.md` (free-tier limits verified against current vendor docs with dates/links),
repo skeleton + CI skeleton + `BUILD-LEDGER.md` v1. End: summary + questions that truly block (max 7) + “Reply continue”.

## Plan Response 2 — “Understand the operators” (no product code beyond skeleton)
Open **every** image in `PARTNER_APP` + `RIDER_APP`. Produce: `04-partner-rider-analysis.md`, `05-data-model-final.md`
(Appendix B confirmed/extended as ready-to-code DDL outline), `06-api-contract-final.md` (Appendix E confirmed),
`07-admin-registry-final.md` (Appendix C P0/P1 confirmation), design-token implementation from file `25`,
workflow files for CI + keystore/bootstrap (dry-runnable). End: build order confirmation + “Reply continue”.

## Build Responses 1–30 (each: code + tests + docs + ledger update + CI evidence)

| # | Scope (Definition of Done abbreviated) |
|---|---|
| 1 | Monorepo, shared packages, design tokens, i18n EN/BN shells, CI gates live |
| 2 | Supabase migrations I: identity/profiles/RBAC/RLS + settings + taxonomy seed + pgTAP |
| 3 | Migrations II: vendors/menus/zones + public catalog views/RPCs + tests |
| 4 | Migrations III: carts/orders/events/offers/batches + money RPCs + golden vectors |
| 5 | Migrations IV: ledger/invoices/remittances/reviews/chat/support + invoice generator tests |
| 6 | Worker-1: catalog/search/feed (rank v1) + cache + image proxy/private-URL + tests |
| 7 | Worker-1: cart/voucher/place-order/transitions + idempotency + rate limits |
| 8 | Worker-2: presence + fare engine + assignment + batcher (pure cores + APIs, vector tests) |
| 9 | Worker-2: FCM sender + RTDB rooms/tokens/rules + dispatch cascade + emulator tests |
| 10 | Worker-3: admin auth/RBAC/settings/zones/KYC APIs + audit |
| 11 | Worker-3: invoices/cron/PDF-data/remittances/moderation/campaigns APIs |
| 12 | Customer app: shell, auth, onboarding, address/OSM pin, home feed |
| 13 | Customer app: search, vendor page, item sheet/bundles, favourites, reviews |
| 14 | Customer app: cart, vouchers, checkout (COD), place-order, confirmation |
| 15 | Customer app: live tracking (OSM+RTDB), chat, orders history, ratings, account/rewards |
| 16 | Partner app: applicant shell + restaurant & home-kitchen KYC wizards, docs vault |
| 17 | Partner app: alarm engine wiring (Kotlin), live orders, accept/prep, QR display, print |
| 18 | Partner app: menu studio complete (variants/options/bundles/availability) |
| 19 | Partner app: overview, growth/analytics, promotions/Flash Box, reviews, finance/invoices |
| 20 | Rider app: applicant KYC (A/B), session/pre-flight/selfie, alarm health |
| 21 | Rider app: offer full-screen (Kotlin), step-machine, QR scan, navigation intents, geo service |
| 22 | Rider app: earnings/invoices, cash gate + remittance submit, history/feedback |
| 23 | Customer web: SSG pipeline, home/vendor/cuisine/area pages, SEO/JSON-LD/sitemap |
| 24 | Customer web: cart/checkout/tracking/account parity, App Links, responsive+Lighthouse gates |
| 25 | Admin web: shell/RBAC, dashboard, dispatch board + live map, order tower/exceptions |
| 26 | Admin web: zones studio, pricing/fare settings + simulator, vendor/rider KYC pipelines |
| 27 | Admin web: finance centre (invoices verify/pay, remittances, ledger, exports, PDF render) |
| 28 | Admin web: campaigns/vouchers/banners, support/disputes/reviews moderation, BI reports |
| 29 | End-to-end hardening: full order saga across 5 surfaces, chaos fallbacks, device FCM matrix, load/perf passes, security checklist |
| 30 | Release factory: signed APK/AAB ×3 via Actions, Pages prod deploys, runbooks (founder tablet guides), beta launch checklist for Sylhet Sadar |

**Per-response ceremony:** (1) restate scope + guide files governing it; (2) implement; (3) run/extend tests — paste evidence;
(4) update ledger + docs (ADRs for any deviation, approved against guide decision log); (5) list founder actions if any
(secret paste, tap approve) in plain Bangla+English steps; (6) stop. If context runs low mid-response: finish the smallest
mergeable slice cleanly, ledger the remainder — **never** stub to pretend completeness.

## Deviation law
Guide decision log (D-01…D-24) outranks builder preference. A discovered impossibility → propose ADR + founder-visible
note in that response; silently diverging (e.g., swapping a stack piece, inventing a fee) is a build failure.
