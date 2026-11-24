# Where the build actually is

_Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA._

This file exists because a status line in a chat is not a source of truth and a green badge is not a
claim. It records what runs, what is verified, and what is still missing, at the commit named at the
bottom. Update it whenever the answer changes; never let it drift from the checks it names.

## Verified green

| Area | Command | Result |
|---|---|---|
| `workers/core` tests | `node --experimental-strip-types --test test/*.test.ts` | 937 tests, 935 pass, 0 fail |
| `workers/core` types | `npx tsc --noEmit -p workers/core/tsconfig.json` | exit 0 |
| `packages/tokens` | `pnpm --filter @undal/tokens test` | 6/6 |
| `packages/i18n` | `pnpm --filter @undal/i18n test` | 15/15 |
| `packages/{contracts,money}` | `tsc --noEmit` | exit 0 |
| `web/storefront` types | `npx tsc --noEmit` in `web/storefront` | exit 0 |
| `web/storefront` tests | `node --experimental-strip-types --test test/*.test.ts` | 22 tests, 22 pass |
| `web/storefront` build | `pnpm --filter @undal/storefront build` | 17 pages prerendered |
| Storefront deploy gate | `node web/storefront/scripts/verify-prerender.mjs` | 17 pages, 124 KB JS gzipped, deployable |
| `web/admin` types | `npx tsc --noEmit` in `web/admin` | exit 0 |
| `web/admin` tests | `node --experimental-strip-types --test test/*.test.ts` | 11 tests, 11 pass |
| `web/admin` build | `pnpm --filter @undal/admin build` | 389 KB, 126 KB JS gzipped |
| Admin deploy gate | `node web/admin/scripts/verify-csp.mjs` | policy scoped to `/admin/*`, publishable |
| Repository guardrails | `python3 scripts/guardrails/run.py` | 31 rules, 0 errors, 0 warnings |

The audit register: `GET /v1/audit`, filtered by action, resource, actor class, severity and a
sequence cursor, returning each entry's before and after, its reason, its request id and the two
chain hashes that tie it to its neighbour. `web/admin` renders it as a register with the diff opening
under the table, one entry at a time. Nothing in it can be edited — the register is append-only, and
a console that could change it would make the chain decorative. The cursor is the sequence number,
not a timestamp: `occurred_at` is a `DATETIME(6)` that two rows in one transaction can share, and a
keyset over a column with ties skips rows.

The fleet surface: `GET /v1/riders` — filtered by onboarding status, shift state, zone and text,
keyset-paged, with the rider's cash balance joined onto the row rather than fetched per rider, and a
summary of who is online, who is locked and how much cash those rows are carrying. `web/admin` shows
it as a board with those four numbers above the table.

**A finding worth keeping:** there is no rider-detail route because the error registry has no
"rider not found" code. It has one for a missing order, offer, quote, zone, menu item and cash
declaration, but a rider read has until now only ever been a rider reading themselves. Adding a
188th code changes the contract `docs/06` fixes at 187, so the route waits for that decision instead
of borrowing `SHIFT_NOT_FOUND` and telling a support agent something false.

The vendor surface, end to end: `GET /v1/vendors` (filtered, keyset-paged), `GET /v1/vendors/{id}`,
`POST /v1/vendors/{id}/pause` and `POST /v1/vendors/{id}/resume`, each behind its own permission
(`vendor.list`, `vendor.read`, `vendor.pause`, `vendor.resume`) and each switch writing an audit row
with the state before and after. A pause must carry a reason and an end — at most one day — because
an indefinite pause is a suspension wearing the wrong name. `web/admin` reads and drives all four.

What the storefront does today, end to end and against the real API contract: browse by area,
category and sort; open a kitchen and build a cart with per-item steppers; sign in with a phone
number and password; quote a cart server-side; place an order; track it by its human code; read the
order history. Bengali and English throughout, integer paisa everywhere, `৳` and Bengali digits
available, Asia/Dhaka timestamps, dark theme from a second; token set, 44 px targets.

## Not built yet

- **Admin coverage** — `web/admin` ships the cash queue, the exception queue, the vendor list with
  pause/resume, the fleet board, the order board, the audit register and the dashboard. Zones,
  growth and system have no screens yet; their absence is visible, not simulated.
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

1. Zone coverage: `GET /v1/zones` for the operator (the table and its reader exist in
   `repositories/`; there is no admin list route), then growth (referrals, campaigns) and system
   (config flags, error registry) screens.
2. Run the prerender against a live `undal-core` (`wrangler dev`) so vendor, area and category
   pages exist, and assert one of them in a test.
3. Tests for `workers/realtime` (auth handshake, room broadcast, reconnect) and `workers/brain`
   (feature-vector purity, deterministic output), because neither has any.
4. The Android apps, in the order the corpus sets: customer, partner, rider — with the money and
   order-tracking logic extracted so it is unit-testable without an emulator.

## What this file does not say

It does not say the platform is production-ready. `docs/_plan/PRODUCTION-READINESS.md` rates it far
below that, and the list above is why. The gap is measured in months of team work, not in labels.

_Last verified: 2026-11-24, branch `arena/bbda8ff4-undal`._
