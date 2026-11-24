# Where the build actually is

_Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA._

This file exists because a status line in a chat is not a source of truth and a green badge is not a
claim. It records what runs, what is verified, and what is still missing, at the commit named at the
bottom. Update it whenever the answer changes; never let it drift from the checks it names.

## Verified green

| Area | Command | Result |
|---|---|---|
| `workers/core` tests | `node --experimental-strip-types --test test/*.test.ts` | 896 tests, 894 pass, 0 fail |
| `workers/core` types | `npx tsc --noEmit -p workers/core/tsconfig.json` | exit 0 |
| `packages/tokens` | `pnpm --filter @undal/tokens test` | 6/6 |
| `packages/i18n` | `pnpm --filter @undal/i18n test` | 15/15 |
| `packages/{contracts,money}` | `tsc --noEmit` | exit 0 |
| `web/storefront` types | `npx tsc --noEmit` in `web/storefront` | exit 0 |
| `web/storefront` tests | `node --experimental-strip-types --test test/*.test.ts` | 22 tests, 22 pass |
| `web/storefront` build | `pnpm --filter @undal/storefront build` | 17 pages prerendered |
| Deploy gate | `node web/storefront/scripts/verify-prerender.mjs` | 17 pages, 124 KB JS gzipped, deployable |
| Repository guardrails | `python3 scripts/guardrails/run.py` | 31 rules, 0 errors, 0 warnings |

What the storefront does today, end to end and against the real API contract: browse by area,
category and sort; open a kitchen and build a cart with per-item steppers; sign in with a phone
number and password; quote a cart server-side; place an order; track it by its human code; read the
order history. Bengali and English throughout, integer paisa everywhere, `৳` and Bengali digits
available, Asia/Dhaka timestamps, dark theme from a second; token set, 44 px targets.

## Not built yet

- **`web/admin`** — the admin SPA does not exist. `deploy-admin.yml` therefore has nothing to
  build, and `scripts/verify-csp.mjs` (which it references) does not exist either. The partner and
  rider browser consoles are honest doorways that send people to the Android apps.
- **Android** — `android/shared/money` is the only module. Customer, partner and rider apps are not
  written. No JDK exists in the build sandbox, so anything written there cannot be compiled here.
- **`workers/realtime` and `workers/brain`** — present, not exercised by any test that runs in CI.
- **Prerendering with data** — `prerender.mjs` reads `/v1/public/sitemap-data` and writes a page per
  vendor, area and category. In this sandbox there is no API, so it writes the 17 data-free pages.
  That path has never run against a live catalogue.

## Known limitations stated in the interface

Honesty is a feature here, so each of these is visible to the customer rather than hidden in a
ticket:

- Web delivery needs the browser's Geolocation API; there is no address lookup in the free-tier
  budget. Refusing permission offers pickup instead of a dead end.
- Order tracking shows the platform's confirmed state, refreshed by polling. Live rider position
  and chat are in the Android app.
- The refresh token is kept in `sessionStorage` because the API returns it in the body; the corpus
  wants it in an `HttpOnly` cookie, and that endpoint does not exist yet.

## The next four things, in order

1. `web/admin`: sign-in, today's orders board, vendor pause/resume, payout summary, with
   `scripts/verify-csp.mjs` checking the `/admin/*` path-scoped policy the deploy workflow expects.
2. Run the prerender against a live `undal-core` (`wrangler dev`) so vendor, area and category
   pages exist, and assert one of them in a test.
3. Tests for `workers/realtime` (auth handshake, room broadcast, reconnect) and `workers/brain`
   (feature-vector purity, deterministic output), because neither has any.
4. The Android apps, in the order the corpus sets: customer, partner, rider — with the money and
   order-tracking logic extracted so it is unit-testable without an emulator.

## What this file does not say

It does not say the platform is production-ready. `docs/_plan/PRODUCTION-READINESS.md` rates it far
below that, and the list above is why. The gap is measured in months of team work, not in labels.

_Last verified: 2026-11-24, commit `d4f7429`, branch `arena/bbda8ff4-undal`._
