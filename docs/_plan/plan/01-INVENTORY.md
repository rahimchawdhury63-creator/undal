# 1. Repository-state inventory (measured in this checkout)

Every number below came from a command run against this working tree, on branch
`arena/bbda8ff4-undal`. Nothing here is quoted from a specification.

## 1.1 What runs green today

| Area | Command | Measured result |
|---|---|---|
| The gate | `node scripts/verify.mjs` | 24 steps, last full run 55.4 s |
| Worker tests | in gate | 974 tests, 972 pass, 0 fail |
| Worker types | `npx tsc --noEmit -p workers/core/tsconfig.json` | 0 errors |
| Admin tests | in gate | 15 tests |
| Storefront tests | in gate | 22 tests, 17 prerendered pages |
| SQL linter | in gate | 181 statements, 0 findings, 0 unparseable |
| Migration policy | `scripts/db/test_migration_policy.py` | 11 tests |
| Schema parity | in gate | 115 tables |
| API surface | `scripts/api-surface.mjs` | 68 routes, 32 writes, 32 of 416 permissions |
| Client calls | `scripts/check-client-calls.mjs` | 40 call sites, all routes |
| Operational SQL | `scripts/db/integration.py --self-check` | 20 queries + 9 fixture statements, 0 findings |
| Android routes | `scripts/gen-android-routes.mjs` | 58 public routes generated |
| Android build | Actions `android` | 5 jobs green: rider APK, vendor APK, shared modules, money parity, route drift |
| Money parity | Actions `money-parity` | 110 000 vectors × 5 fields, Kotlin = TypeScript |
| Guardrails | `scripts/guardrails/run.py` | 31 rules, 0 errors, 0 warnings |

## 1.2 What exists, by surface

**Backend (`workers/core`).** A single Cloudflare Worker with a declarative route table (68 routes),
middleware for rate limiting, body limits, authentication, permission checks, reason-required writes,
idempotency replay, unsafe-cash gating and common headers. 974 tests run through the handler layer.
Repositories under `workers/core/src/**` are hand-written SQL against TiDB.

**Database (`db/`).** Migrations 000–030, additive only, enforced by an 11-test policy. `expected.json`
holds 117 tables, 1 158 columns and 151 checks and is the authority the offline checkers use. Twenty
allowlisted operator queries in `db/queries/`; nine fixture statements in `scripts/db/seed_local.py`.

**Contracts and packages.** `packages/contracts` (187 error codes in 16 row groups), `packages/money`
(paisa arithmetic plus a 110 000-vector differential), `packages/i18n` (670 keys × 2 locales),
`packages/tokens` (design tokens, 6 tests).

**Web.** Storefront: 17 prerendered pages, 133 KB gzipped JS, deployed at `/`. Admin SPA: dashboard,
orders, cash, exceptions, vendors, fleet, audit, zones, growth, system, errors; 443 KB / 129 KB gz;
CSP scoped to `/admin/*` and verified.

**Android.** Two application modules that assemble (`rider` 8.9 MB debug APK, `vendor`) and two JVM
libraries that test (`shared/money`, `shared/api` with a generated 58-route table). Rider has sign-in,
offers, shift, cash and accept-an-offer; vendor has read, pause and resume.

## 1.3 What is missing

| Missing | Evidence |
|---|---|
| Customer Android app | no module under `android/app` |
| Vendor order intake | **no vendor-scoped order route exists** in the surface |
| Partner/rider web surfaces | not present; the console is operator-only |
| Ten operator domains | `analytics`, `brain`, `catalogue`, `dispatch`, `kyc`, `pricing`, `support` have **zero** permissions implemented |
| Realtime (SSE/presence) | routes exist in the table; no evidence of a running stream |
| FCM v1, D1 location ingestion | no worker, no queue, no code found |
| Sensitive media (KYC, selfies, invoices) | gated, per `PRODUCTION-READINESS.md`; not verified here |
| Payments beyond cash | deliberately absent; policy is cash-on-delivery at launch |
| Deployment | nothing is deployed; no database has been reachable in this session |

## 1.4 What is gated or partial, and must not be relabelled

- Cash financial writes are gated by `unsafeCashFinancialWrite` in the route table, and the gate is
  tested; removing it would be a safety regression, not progress.
- Audit append/verification is written and unit-tested but not proven serialised or versioned end to
  end; `AUDIT-V2-FORMAT.md` remains an open design item.
- `integration.py --run` has never executed: no `UNDAL_TEST_DATABASE_URL` has ever been set. **Not one
  SQL statement in this repository has returned a row.**
- No request has ever been served by the Worker from this checkout; the 974 tests call handlers.
- No Android app has ever been rendered on a device or emulator.

## 1.5 Documentation that is only a claim

`README.md`'s status table, `PRODUCTION-READINESS.md` (self-assessed ~3/10) and the acceptance matrix in
`docs/36` describe intent. Where they differ from the tables above, the tables win.
