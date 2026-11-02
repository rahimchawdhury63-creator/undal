<!--
  Undal — Response 2: the build plan
  Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
  SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# Build plan — every file, every boundary, every gate

This is the second and last planning response. It turns
[`35 §3`](../35-execution-plan.md) into a file-by-file manifest for the twenty build responses, fixes
the module boundaries that make 2 500 files navigable, states the dependency order, and names the
gate that must be green at the end of each response. Nothing here is built yet; the build starts at
Response 3.

Two numbers to hold onto: **≈ 292 000 lines**, **≈ 2 550 files**, and **one rule that outranks both**
— nothing is stubbed (`35 §4.1`).

---

## 0. How the 22 responses map onto the corpus's 20

`35` budgets **two planning responses (P1, P2) and twenty build responses (B1–B20)**. This session
has two planning responses (1 = `UNDERSTANDING.md`, 2 = this file), so the skeleton that `35` calls
P2 has to live inside the build sequence. It goes in the first build response, before any business
logic, because `35 §2` requires the repository to be enforcing its own rules from the first line of
feature code onward.

| Response | Corpus label | Title | Lines | Files |
| --- | --- | --- | --- | --- |
| 1 ✅ | P1 (part 1) | `UNDERSTANDING.md` | — | 1 |
| 2 ✅ | P1 (part 2) | This plan + `DECISIONS.md` | — | 2 |
| **3** | **P2 + B1** | Skeleton, guardrails, contracts, money | 15 000 | 300 |
| 4 | B2 | Database schema | 9 000 | 90 |
| 5 | B3 | Core worker foundation | 13 000 | 130 |
| 6 | B4 | Ledger and money domain | 10 000 | 60 |
| 7 | B5 | Brain: fare engine | 12 000 | 50 |
| 8 | B6 | Core domain: orders | 13 000 | 80 |
| 9 | B7 | Brain: dispatch and batch | 14 000 | 60 |
| 10 | B8 | Realtime worker | 12 000 | 70 |
| 11 | B9 | FCM and D1 tracking | 11 000 | 55 |
| 12 | B10 | Android foundation | 18 000 | 220 |
| 13 | B11 | The alarm | 10 000 | 55 |
| 14 | B12 | Rider app | 19 000 | 190 |
| 15 | B13 | Cash settlement | 8 000 | 50 |
| 16 | B14 | Partner app | 17 000 | 170 |
| 17 | B15 | Brain: ranking and forecast | 13 000 | 65 |
| 18 | B16 | Customer app | 21 000 | 210 |
| 19 | B17 | Web storefront | 19 000 | 190 |
| 20 | B18 | Finance and invoicing | 12 000 | 75 |
| 21 | B19 | Admin panel I | 22 000 | 230 |
| 22 | B20 | Admin panel II, super map, onboarding, integration | 24 000 | 250 |

Total: ≈ 292 000 lines (288 000 of build plus ≈ 4 000 of infrastructure), ≈ 2 550 files. Every file
≤ 700 lines, every file with the PASVL header, every exported symbol with a *why* comment.

---

## 1. Module boundaries

### 1.1 The five deployables and the four libraries

| Unit | Language | Owns | May not |
| --- | --- | --- | --- |
| `workers/core` | TypeScript, Hono | **The only writer to TiDB.** Orders, money, ledger, invoices, auth, RBAC, audit, media proxying, admin API | Import a DO class, call FCM, send SSE frames, or run Brain logic |
| `workers/realtime` | TypeScript, DOs | Presence, dispatch coordination, SSE fan-out, FCM, D1 positions | Open a TiDB connection, compute a fare, write an order state |
| `workers/brain` | Python (Pyodide) | Fare, dispatch, batch, rank, forecast — pure functions over a feature payload | Touch a database, do I/O, hold state, call any external service |
| `web/storefront` | React 19 + Vite | Public storefront, `/partner` and `/rider` consoles, pre-rendered HTML | Talk to TiDB/D1/KV directly; hold a secret; run without JS after pre-render |
| `web/admin` | React 19 + Vite | 9 domains, 2 147 features, super map | Ship a third-party script; use `dangerouslySetInnerHTML` |
| `packages/contracts` | TS + Zod | 412 endpoint schemas, 184 error codes, 46 SSE events, generated Kotlin models, `constraints.json` | Contain runtime env access or DOM |
| `packages/money` | TS | `applyRate`, `floorToTaka`, BDT grouping — the TS side of the three-language differential | Import anything from a Worker or a React app |
| `packages/tokens` | TS + generator | `design/tokens.json` → CSS custom properties, TS object, Kotlin | Hard-code a colour anywhere downstream |
| `packages/i18n` | ICU JSON | `en` and `bn` catalogues, pseudolocale | Contain a string literal in code |

### 1.2 Import rules, and what enforces each

| Rule | Enforced by |
| --- | --- |
| `app → feature → core`; never `feature → feature` | `:checkModuleGraph` Gradle task |
| `core:model` has no Android imports; `core:money` has no Android imports | same task |
| `undal-core` is the only module that imports the TiDB driver | `no-local-tooling` + a source-scan in `audit-coverage`'s sibling job |
| `brain` imports no network, no driver, no clock; time arrives as a parameter | `pytest` import-linter test + a `brain_purity` fixture |
| `realtime` never imports `core`'s domain modules — only its typed service-binding client | dependency-cruiser in `lint` |
| Rank code imports no money module | `anti-ad-invariant` |
| No feature module defines a colour, dp, duration or string literal | `token-purity`, `i18n-completeness` |
| Web apps import `packages/contracts`, never a hand-written response type | `tsc --noEmit` with strict `paths` |

### 1.3 What deliberately does not exist

No `docker-compose.yml`, no `Makefile`, no `.nvmrc`, no `scripts/` of developer helpers, no
`google-services.json`, no keystore, no seed file, no `TODO.md`, no mock service in a production
path, no cron handler (`34 §12`, [`01`](../01-mission-and-non-negotiables.md) rules 1–2, 28).

---

## 2. Dependency order

```
R3 ─┬─▶ R4 ─▶ R5 ─┬─▶ R6 ─▶ R8 ─▶ R10 ─▶ R11 ─▶ R12 ─▶ R13 ─▶ R14 ─▶ R15 ─▶ R20 ─▶ R21 ─▶ R22
    │             │        │             └────────────▶ R16 ─┘
    │             └─▶ R7 ──┴─▶ R9
    │                        └─▶ R17 ─▶ R18 ─▶ R19
    └──────────────────────────────────▶ R12
```

Longest chain: R3 → R4 → R5 → R6 → R8 → R10 → R11 → R12 → R13 → R14 → R15 → R20 → R21 → R22
(**14 responses**), leaving **6 of slack** across the 20 — better than `35 §5`'s four, because the
skeleton now shares a response with B1 instead of consuming one.

Three things are proven as early as they can be, because each could invalidate the design
(`35 §1`): the schema in R4, the ledger in R6, the alarm in R13.

---

## 3. Construction rules

1. **Every file** starts with the two PASVL SPDX lines in its language's comment syntax
   (`34 §10`); `license-headers` fails otherwise.
2. **Naming** follows `34 §9` exactly: kebab-case TS, snake_case Python, PascalCase Kotlin,
   `*_paisa` money columns, `*_at` timestamps, `is_`/`has_` booleans, `SCREAMING_SNAKE` enums and
   error codes, `should_X_when_Y` tests. A name that does not fit these rules is a design smell.
3. **Tests land in the response that creates the code**, in `test/` or `androidTest/` beside it.
   Never deferred (`35 §4`).
4. **Generated, not typed**: contracts → Kotlin models, tokens → theme, `06`'s CHECKs →
   `constraints.json` + validators, error registry → i18n keys, fare vectors → three test suites.
   The `build` job regenerates and fails on any diff, so generation cannot drift.
5. **≤ 700 lines, warn at 600.** A screen with many sections becomes one file per section; a
   ViewModel with many intents grows a `domain/` package; a route module is one resource, not one
   domain.
6. **Deferral protocol** (`35 §4.1`): whole units only, stated in the response summary, no stubs,
   no red build. A missing feature is better than a lying one.
7. **No placeholder ever reaches `main`**, including in this plan: every file named below is a file
   that will contain its real implementation.

---

## 4. The manifest, response by response

Notation: `path (lines)`; a brace group means one file per member; `+tests` means tests exist
beside it in the same response. Where a line names a group with a count — `routes/` 46 modules,
`factors/` 14 files, `feature/customer-*` 18 modules — those are the exact file count for that
group, and the individual filenames are fixed by §3.2's naming rules and by the section referenced
beside them. That is deliberate: a 2 550-row list would be one 2 550-line file, which this
repository forbids (`line-budget`). The group, its count and its naming rule together name every
file.

### R3 · Skeleton, contracts and money — P2 + B1 · 300 files · 15 000 lines

**Infrastructure (≈ 4 000 lines)**

- root: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `.gitignore`,
  `.env.example` (45 secrets + 148 config keys, 586 lines), `README.md`, `.editorconfig`
- `.github/workflows/` — the 23 from [`28 §2`](../28-cicd-github-actions.md): `ci`, `deploy-workers`,
  `deploy-web`, `deploy-admin`, `migrate`, `verify-schema`, `d1-migrate`, `android-debug`,
  `android-release`, `generate-keystore`, `android-test`, `android-instrumented`, `e2e`,
  `money-math`, `brain-replay`, `lighthouse`, `responsive-matrix`, `security-scan`,
  `rotate-secret`, `db-query`, `tail-logs`, `release`, `housekeeping` — all `workflow_dispatch`-able
- `.github/actions/` 6 composite actions: `setup-node`, `setup-java`, `setup-python`,
  `restore-gradle`, `wrangler-deploy`, `post-summary`
- `.github/scripts/` — **31 guardrail implementations** plus 63 fixtures (one must-fail per
  guardrail; `check-constraint-parity` gets three: missing, altered, clean)
- `.github/ISSUE_TEMPLATE/` 4 files, `pull_request_template.md`
- `packages/config/` — `tsconfig.base.json`, `eslint.config.mjs`, `prettier.config.mjs`,
  `ruff.toml`, `detekt.yml`, `.editorconfig`
- `android/` — `settings.gradle.kts`, `gradle/libs.versions.toml`, `build-logic/convention/` 6
  plugins (`undal.android.application`, `.library`, `.compose`, `.hilt`, `.room`, `undal.jvm.library`),
  and one empty-but-real `build.gradle.kts` + `package-info`/`README` per module (66 feature
  modules, 14 core modules, 3 apps) so `:checkModuleGraph` has something to check
- `workers/{core,realtime,brain}/` — `wrangler.toml` (bindings, `[observability]`, Smart Placement
  on core, **no `[triggers] crons`**), `package.json` / `pyproject.toml`, `tsconfig.json`
- `web/{storefront,admin}/` — `vite.config.ts`, `tsconfig.json`, `index.html`, `public/_routes.json`,
  `public/_headers` (path-scoped CSP: strict for `/admin/*`), `public/_redirects`
- `design/tokens.json` (94 colours, 18 type styles, 31 spacing/radius/elevation, 22 motion specs)

**B1 — contracts and money (≈ 11 000 lines)**

- `packages/contracts/src/` — `envelope.ts`, `errors/{codes.ts (184), registry.ts, localise.ts}`,
  `common/{paisa,ids,time,pagination,geo,phone,slug}.ts`, `endpoints/` **46 modules** (412
  endpoints, one module per resource group in [`08 §2`–§8](../08-api-contract.md)),
  `openapi.ts`, `sse/events.ts` (46 events), `index.ts` +tests
- `packages/money/src/` — `paisa.ts`, `apply-rate.ts` (banker's rounding), `floor-to-taka.ts`,
  `group-bdt.ts` (lakh/crore), `int-div.ts`, `vectors.ts`, `index.ts` +tests
- `packages/tokens/` — `generate.ts`, `css.ts`, `ts.ts`, `kotlin.ts`, `motion.ts`
- `packages/i18n/` — `catalogue.ts`, `icu.ts`, `pseudolocale.ts`, `locales/{en,bn}.json`
  (shell, navigation, all 184 error messages — screen strings land with their screens)
- `scripts/codegen/` — `kotlin-models.ts`, `openapi-dump.ts`, `i18n-keys.ts`
- `fixtures/money/apply_rate_100k.jsonl`, `floor_to_taka_50k.jsonl` (fixed seed + provenance note)

**Gate:** `ci.yml` green on an empty repository — `guardrails` 31/31 with fixtures, `typecheck`,
`lint`, `build`, `money-math` (TS against the fixed vectors only; the three-language test completes
at R12), `no-local-tooling` over every doc, every workflow dispatchable from the Actions tab.
**Done when:** the repo builds, CI is green, and it does nothing.

---

### R4 · Database schema — B2 · 90 files · 9 000 lines

- `db/migrations/` — `000_smoke.sql`, `001_identity`, `002_geography`, `003_vendors`,
  `004_menu`, `005_riders`, `006_orders`, `007_dispatch`, `008_ledger`, `009_invoices`,
  `010_support`, `011_brain`, `012_constraints_deferred` — 13 files, forward-only,
  statement-level idempotent, 99 tables, 53 CHECKs, generated columns replacing the 11 partial
  indexes, `lat_e7`/`lon_e7` + `cell_id`, `cell_zone`, `audit_verifications`, `generation_locks`
- `db/d1/001_positions.sql` — the two D1 tables, `WITHOUT ROWID`
- `scripts/db/` — `extract_constraints.py` → `packages/contracts/src/constraints.json` +
  `constraints/` validators (13 money + 40 others), `verify_schema.py` (reads
  `information_schema` **and** `TIDB_CHECK_CONSTRAINTS`), `migrate_runner.ts` (statement resume,
  checksum), `expected.py` → `db/expected.json`, `orphan_check.py`
- `db/queries/` — 20 allowlisted read-only SQL files for `db-query.yml`
- `packages/contracts/src/db/` — typed row models, `uuid.ts` (`uuidToBin`/`binToUuid`), `cell.ts`
  (`cellFor`, one of four implementations of the shared vector)
- `db/fixtures/` — schema fixtures only (never business rows)

**Gate:** `migrate.yml` applies to a fresh Starter instance twice (idempotency), `verify-schema`
green, `no-postgres-dialect`, `check-constraint-parity`, `geo-parity` (SQL generated-column vector +
the two Worker-side algorithms in TS), `no-seed-data`, `d1-migrate`.
**Done when:** a fresh database migrates cleanly, twice, and the schema matches `expected.json`
exactly.

---

### R5 · Core worker foundation — B3 · 130 files · 13 000 lines

- `workers/core/src/` — `index.ts`, `app.ts`, `middleware/{request-id,logging,envelope,body-limit,
  auth,rbac,step-up,idempotency,ratelimit,zone-scope}.ts`
- `routes/` — 46 resource modules (auth, customers, addresses, vendors, menu, items, quotes,
  orders, partner-*, rider-*, dispatch, ledger, invoices, payouts, cash, media, zones, pricing,
  promos, support, tickets, disputes, notifications, devices, sessions, admin-*, public-*)
- `auth/` — `argon2.ts` (WASM, m=19456/t=2/p=1), `jwt.ts` (EdDSA), `sessions.ts`,
  `refresh-rotation.ts` (family reuse detection), `totp.ts`, `password.ts` (10 000-entry list),
  `oauth-google.ts`, `device.ts`
- `rbac/` — `keys.ts` (412), `roles.ts` (7 system roles as schema, not seed), `guard.ts`,
  `scope.ts`, `step-up.ts`, `blast-radius.ts`
- `audit/` — `write.ts`, `chain.ts` (SHA-256 `prev_hash`), `verify.ts` (batched walk),
  `verifications.ts`, `export.ts`, `reasons.ts` (94)
- `db/` — `client.ts` (`@tidbcloud/serverless` over HTTP, `time_zone='+00:00'` pinned per
  connection), `transaction.ts` (1213/1205 retry, 5 attempts, full jitter), `for-update.ts`
  (the six sites), `repo.ts`, `time.ts`
- `ratelimit/` — `limits.ts` (38), `kv.ts`, `coordinated.ts`
- `lib/` — `redact.ts` (applied at the sink), `result.ts`, `ids.ts` (UUIDv7), `time.ts`,
  `validate.ts`, `csv.ts`
- `bindings/` — `realtime.ts`, `brain.ts` (typed clients, error-propagation convention)

**Gate:** `test-workers` on a real Starter instance; RBAC matrix **412 × 7 = 2 884** assertions;
`audit-coverage` (every mutating handler writes a row); idempotency contract test; 38 rate-limit
tests; log-redaction over 200 realistic lines; IDOR probes; injection fuzz; `secret-scan`.
**Done when:** a request can authenticate, authorise, audit itself and be rate-limited, with no
business domain implemented yet.

---

### R6 · Ledger and money domain — B4 · 60 files · 10 000 lines

> **Progress.** R6a (this response): `domain/ledger/` — `accounts`, `closure`, `post-entry`,
> `trial-balance`, `reverse`, `balance`, `repositories/{accounts,entries}`; `domain/money/rates.ts`
> and `postings/{order,adjustments,movements,index}` (15 builders covering every §3 row);
> `test/ledger.test.ts` + `test/postings.test.ts` + `test/generators/ledger.ts` (10 000 closure
> cases, 100 000-posting trial balance, reversal refusals, 20 hand-checked sets). Remaining for the
> R6 gate: the 34 golden vector files, money branch coverage to 100%, `LEDGER_IMBALANCE` route wiring.

- `domain/ledger/` — `accounts.ts` (14 types), `post-entry.ts` (closure assertion before commit),
  `closure.ts`, `trial-balance.ts`, `reverse.ts`, `balance.ts`, `repositories/*`
- `domain/money/postings/` — one module per entry type: `order-delivered`, `order-cancelled`,
  `refund-credit`, `tip`, `promo`, `weather-subsidy`, `rounding`, `bundle-credit`,
  `payout-paid`, `cash-settled`, `cash-writeoff`, `adjustment`, `loyalty`, `invoice-accrual`
- `domain/money/vectors/` — the posting sets from [`24 §3`](../24-finance-payouts-invoices.md) as
  golden files, including Vector 01 (54 900 / 37 400 / 8 370 / 6 750 / 1 500 / 522 / 439 / 81)
- tests: 10 000 generated closure cases (generator committed, not the cases), reversal invariants,
  trial balance over a 100 000-posting fixture

**Gate:** `ledger-closure` 10 000/10 000; money coverage **100% line and branch**; `LEDGER_IMBALANCE`
trigger test.
**Done when:** no entry can be written that does not sum to zero, by any path.

---

### R7 · Brain: fare engine — B5 · 50 files · 12 000 lines

> **Progress.** R7a (this response): `lib/paisa.py` (the Brain's own copy of the money law, with a
> parity test against the package the differential holds), `fare/constants.py` (every value of
> `10 §2`, with the traffic block *derived*), `fare/surge.py` (bands, bridges, hysteresis),
> `fare/ride_core.py`, `fare/delivery_fee.py`; `test/test_surge_curve.py` (20 001 sweep points,
> four properties, the documented table) and `test/test_fare_core.py` (vector 01 by hand, traffic
> blocking, clamps, paisa parity). Vector 01 reproduces to the paisa: core 6 520, fee 7 042,
> margin 522. Remaining for the R7 gate: `rider_payout`, `small_order`, `tax`, `assemble`,
> `explain`, `bundle`, `engine` + `main.py` dispatch, the 40 vectors, and the 25 money properties.
>
> **R7 gate met (second response).** `rider_payout`, `small_order`, `assemble` (closure asserted
> before a quote leaves the Brain), `explain` (codes and paisa, no prose), `engine` and the input
> validator are in; the 40 vectors are generated, committed and drift-checked in CI, with vector 01
> asserted by hand against `10 §12.1`; 25 properties run over 4 000 seeded cases; 62 Brain tests pass.
> D58 records why the delivery line closes on its residual; D59 records which vectors are the
> document's and which are pins.

- `workers/brain/src/` — `main.py` (engine dispatch, 400 ms budget), `lib/{paisa,geo,stats,time}.py`,
  `fare/{constants,surge,ride_core,delivery_fee,rider_payout,small_order,tax,assemble,explain,
  bundle,engine}.py`
- `fare/vectors/fare_vectors.json` — the **40** vectors; `test/test_fare_vectors.py`,
  `test/test_properties.py` (P1–P25 fare subset), `test/test_surge_curve.py` (20 001 points)
- `lib/paisa.py` — `apply_rate` mirroring TS byte-for-byte

**Gate:** `test-brain`; 40/40 vectors exact; 25 money properties; `money-math` Python ↔ TS
(110 000 `apply_rate`, 50 000 `floor_to_taka`, 20 001 surge); Brain purity test (no I/O, no clock).
**Done when:** a fare can be computed and explained to the paisa, in Python, and agree with TS on
every vector.

---

### R8 · Core domain: orders — B6 · 80 files · 13 000 lines

> **Progress.** R8a (this response): `domain/order/states.ts`, `guards.ts` (23 predicates over an
> explicit context), `state-machine.ts` (the `06 §7.3` table as data + the admin-cancel wildcard,
> with `TransitionRefused` carrying a real contract code), `lifecycle.ts` (effects, event rows and
> replay), `qr.ts` (rotating HMAC, 4 h window, 150 m geofence, six-digit fallback). 53 new tests:
> every edge for every actor, every illegal pair (200+ refused), guard failure codes, replay
> divergence, and the pickup proof including forgery and expiry. Remaining for the R8 gate:
> `snapshots`, `items`, `pickup`, `assignment`, `state-events`, `evidence`, `explain`, `effects`, the
> Core-side Brain call with its fallback, and `routes/{orders,quotes,cart}`.
>
> **R8b (this response).** `quote.ts` — a signed snapshot with a server-stamped five-minute expiry,
> canonical JSON for a stable signature, and a diff that reports every moved line rather than the
> first. `placement.ts` — signature, age, cart and money checked in that order, `DRAFT → PLACED`
> through the table, the full order row with fare provenance, and `cashDuePaisa` for COD.
> **168 core tests**; 16 new ones cover tampering, a foreign secret, expiry at five minutes and one
> millisecond, ingredient change, a quote reused at another vendor, and a banned customer.

- `domain/order/` — `state-machine.ts` (transition table as data + a small evaluator),
  `lifecycle.ts`, `guards.ts`, `snapshots.ts`, `items.ts`, `quote.ts` (5-minute quote, re-price,
  `409 QUOTE_MISMATCH` + diff), `placement.ts`, `pickup.ts`, `qr.ts` (HMAC payload, 60 s rotation,
  4 h window, 150 m geofence, 6-digit fallback), `assignment.ts`, `state-events.ts`,
  `evidence.ts`, `explain.ts`
- `domain/pricing/` — the core-side call into `undal-brain` with a deterministic local fallback
- `routes/{orders,quotes,cart}.ts`; `domain/order/effects.ts` (SSE + FCM intents queued via
  `waitUntil`, dead-lettered on failure)

**Gate:** **100% transition coverage** including illegal edges; snapshot immutability; quote
re-price diff (12 cases); QR HMAC/geofence/replay (22); `latency-budget` for quote and place.
**Done when:** an order can be placed, accepted, rejected and cancelled with every transition
logged, and a stale quote cannot silently charge a new price.

---

### R9 · Brain: dispatch and batch — B7 · 60 files · 14 000 lines

**R9d note.** `bench/world.py` (seeded city: riders, vendors, demand and the road factor),
`bench/city_sim.py` (two policies over the same days, the real filters/factors/waves, a queue that
waits rather than dropping orders), `bench/adversarial.py` (seven attacks with fixed seeds),
`bench/report.py` (nine gated metrics, Markdown and JSON artifacts) and `bench/brain_replay.py` (three
committed fixtures replayed exactly). The CI worker job now runs the benchmark and the replay harness,
and `brain-replay.yml` calls the harness that exists. `D76` records why the gate is the comparison and
not the printed targets, and why the report carries nine metrics where `11 §12.1` prints eight.

**R9c note.** `dispatch/cascade.py` (the waveform as data: offers, claims, the early advance when a
wave is unanimously rejected, and the fallback at T+112), `dispatch/expansion.py` (the six-rung ladder,
the step-1 relaxations as basis points, boosts floored to taka once), `dispatch/prewarm.py` (180 s TTL,
60 s age, 20% symmetric-difference drift, JSON round-trip for `OrderHub`) and `dispatch/explain.py`
(the `DISPATCH` trace, its retention table and a schema walk that names every missing path). 45 new
Python tests; `D3`–`D6`, `D10` and `D12` are asserted directly. The trace-key mismatch in `09 §6` is
recorded as `D75`.

**R9b note.** `batch/` — `constraints.py` (C1–C10 constants, capacity, detour budgets, handover clamp),
`feasibility.py` (the detour arithmetic, ten verdicts per ordering, `None` for a constraint that does
not apply), `permutations.py` (≤ 6 orderings, `Σ detour² + λ·metres`, stable tie-break), `score.py`
(the five weighted terms and the 0.45 floor) and `proof.py` (bundle proof JSON, re-validated at accept).
28 new Python tests, every constraint exercised at its boundary and just past it.

**R9a note.** `dispatch/factors.py` (the fourteen factors, `PRINTED_WEIGHTS`, `DEFAULT_WEIGHTS`
normalised to 1.0 ± 1e-9, Wilson lower bound), `dispatch/filters.py` (fourteen numbered vetoes with a
refusal reason per rider), `dispatch/scoring.py` (one deterministic pass, tie-break on acceptance then
rider id, weighted contributions for the admin panel) and `dispatch/waves.py` (`MAX_WAVES 5`,
`MAX_WAVE_SIZE 8`, 90% target, fallback at T+112 s). 31 new Python tests; the `11 §6` table discrepancy
is recorded in `DocumentDiscrepancyTests` rather than hidden (`D73`).

- `dispatch/` — `filters.py` (14), `factors/` 14 files (`distance`, `eta_fit`, `acceptance`,
  `fairness`, `cash_risk`, `vehicle_fit`, `zone_fit`, `battery`, `rating`, `on_time`,
  `load`, `recent_reject`, `area_familiarity`, `device_health`), `scoring.py`, `waves.py`
  (90% target, `MAX_WAVES 5`, `MAX_WAVE_SIZE 8`), `cascade.py`, `expansion.py` (6 steps),
  `prewarm.py` (180 s), `explain.py`
- `batch/` — `constraints.py` (C1–C10), `feasibility.py` (420 s / 210 s), `permutations.py`
  (≤ 6), `score.py` (≥ 0.45), `proof.py`
- `bench/` — `city_sim.py` (10 000 order-days, 8 metrics), `adversarial.py` (7 attacks),
  `report.py` → CI artifact

**Gate:** dispatch properties D1–D12, batch B1–B9; weights sum 1.0 ± 1e-9; every factor in `[0,1]`
on degenerate inputs; `city_sim` beats nearest-rider on all 8 metrics; `brain-replay` harness
runnable.
**Done when:** dispatch is deterministic, explainable, and provably better than nearest-rider on the
simulator.

**R9 gate — met.** `D1`–`D12` and `B1`–`B9` are asserted in `test_dispatch.py`, `test_batch.py` and
`test_cascade.py`; the weights sum to 1.0 ± 1e-9; every factor is in `[0, 1]` on degenerate inputs;
`city_sim` beats nearest-rider on all nine reported metrics over 15 000 order-days; and
`bench.brain_replay` reproduces its fixtures exactly. Filter 10 remains the conservative
`current_load == 0`: the batch proof is not yet consulted during candidate generation, which is the one
piece of R9 wiring that waits for in-flight bundle state from the realtime worker.

---

### R10 · Realtime worker — B8 · 70 files · 12 000 lines

- `hubs/{zone-hub,order-hub,rider-pin}.ts`; `coordination/{coordinator.ts (14 methods),
  durable-object.ts, tidb.ts, claim.ts, lease.ts}`; `presence/{heartbeat,deadline,grace,
  escalation,evidence,reaper}.ts`; `sse/{stream,fanout,resume,events}.ts`; `routes/{presence,
  stream,dispatch,claim}.ts`; `lib/{clock,envelope,log}.ts`

**Gate:** presence p95 ≤ 2 000 ms on the **free `sql` mode** (1 000-loss latency test); 1 500 ms
grace produces no state change; 22 ladder cases; SSE `Last-Event-ID` resumption; 34-case
concurrency suite with a 50-way claim producing exactly one winner, on both backends.
**Done when:** a vendor can go offline and the system knows in under two seconds, on the free path.

---

### R11 · FCM and D1 tracking — B9 · 55 files · 11 000 lines

- `fcm/` — `jwt.ts` (RS256, 3 300 s cache), `payloads/` 11 modules (one per message type),
  `purity.ts`, `sender.ts`, `tokens.ts`, `receipts.ts`
- `d1/` — `ingest.ts` (plausibility: accuracy ≤ 60 m, speed, teleport, bbox, `isMock`),
  `ring-buffer.ts` (seq mod 120), `current.ts`, `erasure.ts` (4 triggers), `delta.ts`,
  `cadence.ts` (the adaptive table), `budget.ts`

**Gate:** `fcm-payload-purity` (no `notification` key, `priority: high` on CRITICAL, no legacy
endpoint), `no-cron`; D1 replay over 12 real traces with `writesPerDelivery < 70` and the **54**
budget asserted; erasure on every shift-ending path; mock-location suspends the shift.
**Done when:** a position lands in D1 only when the rider moved 100 m, is erased at shift end, and a
push carries no `notification` key.

---

### R12 · Android foundation — B10 · 220 files · 18 000 lines

- `core/common`, `core/money` (Kotlin `Paisa` value class + `applyRate` + `UndalMoney`),
  `core/model`, `core/designsystem` (generated tokens, theme, **64 components**, **118 icons** as
  `ImageVector`, **44 illustrations**, motion specs), `core/network` (Okronet + 8 interceptors +
  envelope), `core/database` (Room + SQLCipher), `core/datastore`, `core/realtime`,
  `core/location` (displacement filter), `core/media`, `core/notification` (scaffolding),
  `core/maps` (MapLibre Native), `core/catalog`? — no: `core/analytics`, `core/testing`
- `app/{customer,partner,rider}` skeletons with Hilt graphs and nav hosts

**Gate:** **the three-language money differential completes here** (110 000 `apply_rate`,
50 000 `floor_to_taka`, 30 000 haversine — Kotlin ↔ TS ↔ Python, zero disagreements);
`:checkModuleGraph`; `token-purity`; `no-fixed-width`; `a11y` (48 dp, labels); Compose component
tests per state; Room migration tests; `perf-budget` cold start ≤ 1 400 ms.
**Done when:** the design system renders every component from tokens, and Kotlin agrees with Python
and TypeScript on every money vector.

---

### R13 · The alarm — B11 · 55 files · 10 000 lines

- `core/notification/` — `UndalMessagingService.kt`, `AlarmLauncher.kt` (paths A/B/C),
  `AlarmService.kt` (foreground, `specialUse`), `AlarmPlayer.kt` (`USAGE_ALARM`, max volume,
  restore), `AlarmActivity.kt` (show-when-locked, turn-screen-on), `Channels.kt`,
  `AlarmSignature.kt` (HMAC), `AlarmDedupe.kt`, `FullScreenNotifier.kt`,
  `LoudChannelNotifier.kt`, `DeviceHealth.kt`, `OemCoaching.kt`, `SelfTest.kt`,
  `DegradationReporter.kt`
- `res/raw/undal_order_alert_loop.wav` — **copied byte-identical** from `assets/audio/`, with a
  SHA-256 test asserting it
- `android/PLAY_DECLARATIONS.md` — the `specialUse` justification and full-screen-intent
  declaration, verbatim from `28 §6.3`

**Gate:** instrumented matrix on 7 devices × 6 states; audio starts at t = 0; 120 s partner / 25 s
rider / 8 s self-test ceilings; **force-stop asserted as non-delivery**; FGS type declared;
degradation reported server-side; WAV checksum.
**Done when:** a vendor's phone rings, loops and wakes the screen from a swiped-away state, and the
one case Android forbids is asserted rather than assumed.

---

### R14 · Rider app — B12 · 190 files · 19 000 lines

- `app/rider` + 19 `feature/rider-*` modules: `onboarding` (13 screens, shared with R22),
  `auth`, `shift` (7), `selfie`, `offer`, `bundle-offer`, `reject`, `active` (11), `qr`, `arrived`,
  `handover`, `cash` (6, wired in R15), `earnings` (6), `performance` (4), `settings` (8),
  `device-health`, `system` (7)

**Gate:** 244 screen states; offer card arithmetic against all 40 vectors; 26 offer-timing tests;
31 reject-flow tests; offline matrix (13); responsive 50 widths; sunlight-contrast assertions.
**Done when:** a rider can take a shift, accept an offer, scan a pickup and complete a delivery,
with every number on the offer card matching the fare engine.

---

### R15 · Cash settlement — B13 · 50 files · 8 000 lines

- `feature/rider-cash/` 6 screens + the blocking gate; `core/notification` tick (4 s, stops on
  typing, permanently on submit)
- `workers/core/domain/cash/{settlement,block,auto-lift,trxid,evidence}.ts`, `routes/cash.ts`
- admin review queue route + screen shell (the full finance UI is R21)

**Gate:** 19 scope tests (SOS and dialler never blocked, never during an active order); 2 h
auto-lift; TrxID uniqueness across all history; arithmetic including the cash-out charge; four
escape paths each lift the block; ledger closes on every settlement path.
**Done when:** a rider with outstanding cash cannot go online, and cannot be trapped by an
unreviewed queue.

---

### R16 · Partner app — B14 · 170 files · 17 000 lines

- `app/partner` + 16 `feature/partner-*`: `onboarding` (11), `auth`, `orders` (9: live board,
  detail, QR, prep, reject, history, search, dispute, cancelled), `menu` (12, offline outbox +
  CSV import), `hours` (4), `performance` (5), `finance` (5), `settings` (8), `system` (5)

**Gate:** 216 screen states; 44 board interactions; 18 prep-control cases (5–200 min, 5/10-min
steps, suggestion, clamping); 16 QR cases; 62 menu CRUD + offline conflict; 21 CSV (malformed
included); 51 staff-RBAC assertions; 27 device-health OEM states.
**Done when:** a kitchen can run a full lunch service on a ৳9 000 tablet, offline included.

---

### R17 · Brain: ranking and forecast — B15 · 65 files · 13 000 lines

- `rank/` — `stages/` 10 files, `mmr.py`, `diversity.py` (hard rules: 3 cuisine / 2 owner / 1 new /
  2 price bands), `cold_start.py` (≤ 0.14, 21 d / 25 orders, NID-keyed), `synonyms.json` (340),
  `explain.py`, `blend.py` (0.30 / 0.26 / 0.22 / 0.14 / 0.08)
- `forecast/` — `demand.py` (500 m cell surface), `prep.py`, `eta.py`, `weather.py`,
  `hijri.py` (through 2035), `holidays.py`
- `features/` — `store.py` (KV hot tier), `ewma.py` (time-based half-lives), `wilson.py`, `p2.py`
- `workers/core/routes/partner-rank-explain.ts`

**Gate:** rank properties R1–R8; `anti-ad-invariant` (no money field reachable from `RankInput`,
no money import in `rank/`); personalisation ≤ 0.22; cold-start decay to zero; diversity on
adversarial input; forecast MAPE harness.
**Done when:** ranking is deterministic, diverse, explainable per vendor, and structurally unable to
sell position.

---

### R18 · Customer app — B16 · 210 files · 21 000 lines

- `app/customer` + 18 `feature/customer-*`, 4 `feature/auth-*`, 3 `feature/location-*`,
  6 `feature/shared-*` — 68 screens total: onboarding 6, auth 9, location 7, home 8, search 5,
  vendor 7, cart 6, checkout 4, tracking 6, orders 5, account 9, system 6

**Gate:** every screen state; guest browse; checkout-only auth; quote-then-reprice diff; tracking
interpolation + staleness ladder (19); 44 empty states at 50 widths × 2 themes × 2 languages;
`a11y`; `perf-budget`; Android `responsive-matrix`.
**Done when:** the app feels better than the incumbent on a 4-year-old phone over 3G — measured,
not claimed: home renders from cache in < 300 ms, vendor list within 2.5 s.

---

### R19 · Web storefront — B17 · 190 files · 19 000 lines

- `web/storefront/src/` — `routes/` (23 route families from [`20 §3`](../20-web-storefront.md),
  each with loader + component + test), `components/` (~120), `features/{cart,checkout,tracking,
  account,consoles}`, `lib/{api,query,format,seo}`, `styles/` (generated tokens)
- `prerender/` — route manifest from `/v1/public/sitemap-data`, HTML emitter, `sitemaps/` 5 files,
  `robots.txt`, `assetlinks.json` from the keystore fingerprint, JSON-LD per page type
- `/partner` and `/rider` consoles (web parity minus the alarm, with the honest iOS screen)

**Gate:** `prerender-verify` (real content with JS off, `<main>` > 400 chars, a price on every
vendor page); `lighthouse-budget` ≥ 95 × 4; `a11y` axe on every route + 24 states;
`responsive-matrix` 50 widths; `osm-attribution`; bundle ≤ 160 KB gzip; 48 E2E journeys.
**Done when:** an iOS user can order end to end from a link, and a crawler with no JavaScript sees
the full menu.

---

### R20 · Finance and invoicing — B18 · 75 files · 12 000 lines

- `domain/invoice/` — `period.ts` (boundary check on ordinary requests), `generation-lock.ts`
  (conditional `UPDATE`), `builder.ts`, `numbering.ts` (gapless counter row), `hash.ts`,
  `pdf/{layout,fonts,charts,render}.ts` (`pdf-lib`, subsetted fonts, deterministic, < 1 MB)
- `domain/payout/` — `run.ts`, `bkash-export.ts`, `nagad.ts`, `bank.ts`, `reconciliation.ts`,
  `attribution.ts`, `cooling-off.ts` (72 h)
- `routes/{invoices,payouts,reconciliation}.ts`; `domain/reports/` the 34 finance queries

**Gate:** invoice determinism (1 000 cases → identical `content_hash`); PDF < 1 MB and branded;
`DRAFT → GENERATED → VERIFIED → PAID` with step-up on `PAID`; rider cash blocks `VERIFIED`;
reconciliation blocks run closure; cost attribution table; `no-cron`.
**Done when:** a week of cash orders turns into byte-identical invoices and a bKash file that pays
the right people the right amount.

---

### R21 · Admin panel I — B19 · 230 files · 22 000 lines

- `web/admin/src/` — shell, ⌘K palette (180 commands), health strip, exception badge
- domains 1–5: `identity-rbac-audit` (218 features), `dispatch-fleet` (263), `geo-pricing` (196),
  `vendors-menu` (284), `finance-cod` (312) — 1 273 features, each with its named test
- `components/` ~180 incl. 60+ data grids (TanStack Table + virtual), `charts/` (Recharts),
  `features/*/register.ts` entries (feature register starts here, completes at R22)

**Gate:** `feature-register` — every registered feature has a passing test, every route handler is
registered, every permission exists, every doc reference resolves; RBAC matrix at the UI layer;
`audit-coverage` for admin mutations; bulk-action preview matches executed effect.
**Done when:** an operator can run the platform from a browser — approve a vendor, move a zone
boundary, watch a payout run.

---

### R22 · Admin panel II, super map, onboarding, integration — B20 · 250 files · 24 000 lines

- domains 6–9: `order-tower-exceptions` (241), `growth` (174), `support` (198), `analytics-brain`
  (261) — completes **2 147**
- super map: MapLibre GL, 34 marker variants + sprite atlas, layers (10), panels (rider, vendor,
  order, bulk), replay scrubber, attribution
- onboarding and KYC: 4 tracks, 11 + 9 + 13 + 11 steps, review queue, sandbox order
- final integration: `e2e/full-lifecycle`, empty-platform test, release workflow, definition of done

**Gate:** `feature-register` 2 147/2 147; **empty-platform on every screen in the register** (283 unless
`docs/features/screens.json` proves a different number — see `UNDERSTANDING.md` §9 item 13, where the
corpus's screen arithmetic is shown not to add up; the register wins and the tables get corrected);
`full-lifecycle` E2E with 41 intermediate states and a ledger closing to zero; all 23 workflows
green; signed `.apk` + `.aab` for three apps; `assetlinks.json` matches the keystore; all 18
definition-of-done criteria in [`35 §9`](../35-execution-plan.md).
**Done when:** a real order goes from a customer's thumb in Sylhet to a settled ledger row, on real
infrastructure, with correct money at every step.

---

## 5. When each gate switches on

Guardrails exist from R3; they only become *load-bearing* when the code they check exists. This is
the schedule, and a response is not done until its row is green.

| Response | Gates that become meaningful |
| --- | --- |
| R3 | all 31 guardrails run; `typecheck`, `lint`, `build`, `no-local-tooling`, `license-headers`, `secret-scan`, `money-math` (TS leg) |
| R4 | `no-postgres-dialect`, `check-constraint-parity`, `geo-parity` (SQL), `no-seed-data`, `verify-schema`, migration idempotency |
| R5 | `audit-coverage`, `i18n-completeness` (errors), RBAC matrix, IDOR, redaction |
| R6 | `ledger-closure` 10 000, money coverage 100% |
| R7 | `money-math` Python leg, 40 fare vectors, 25 properties |
| R8 | 100% transition coverage, `latency-budget` (quote/place), `customer-bill-purity` |
| R9 | dispatch/batch properties, `city_sim` benchmark, `brain-replay` |
| R10 | presence p95 on `sql` mode, SSE resumption, 50-way claim |
| R11 | `fcm-payload-purity`, `no-cron`, D1 54-write budget |
| R12 | `money-math` complete (3 languages), `token-purity`, `no-fixed-width`, `a11y`, `perf-budget`, `:checkModuleGraph` |
| R13 | alarm matrix, audio-at-t0, force-stop non-delivery |
| R14 | rider screen states, offline matrix, Android `responsive-matrix` |
| R15 | cash-block scope, 2 h auto-lift, TrxID uniqueness |
| R16 | partner screen states, prep control, CSV, staff RBAC |
| R17 | `anti-ad-invariant`, rank properties, diversity |
| R18 | customer screen states, 44 empty states, tracking interpolation |
| R19 | `prerender-verify`, `lighthouse-budget`, `osm-attribution`, web `responsive-matrix`, axe |
| R20 | invoice determinism, PDF < 1 MB, payout lifecycle, reconciliation |
| R21 | `feature-register` (domains 1–5), UI RBAC, bulk previews |
| R22 | `feature-register` 2 147, empty-platform 283, `full-lifecycle`, release |

---

## 6. Risks this plan adds to `39`

Recorded here now, to be appended to [`39 §3`](../39-risk-register-and-truths.md) in the response
that first meets them.

- **R34 — Volume.** 20 responses × ~14 000 lines is the largest single risk to *completion*, not to
  correctness. Mitigation: six responses of slack on the critical path, and a deferral protocol that
  moves whole units rather than shipping stubs.
- **R35 — Generated-code drift.** Contracts → Kotlin, tokens → theme, CHECKs → validators, vectors
  → three suites. A generator that is not re-run silently diverges. Mitigation: the `build` job
  regenerates and fails on any diff; the three-language test would catch money drift anyway.
- **R36 — The admin shares the storefront's origin** (decision D34). Path-scoped CSP and an Access
  policy on `/admin/*` narrow it, but an XSS in the storefront is one origin removed from admin
  storage. Mitigation: admin access token in memory only, `HttpOnly` refresh cookie scoped to
  `/admin`, no `unsafe-inline` anywhere, and the admin build ships no storefront code.
- **R37 — Pyodide cold start** may exceed the 400 ms budget on a cold isolate (already R9 in `39`,
  now concretely scheduled): measured at R7, and if it fails, the fare engine is the first candidate
  for a TypeScript port with the differential test guaranteeing identical results.
- **R38 — OSRM demo-server rate limits** hit hardest during the evening peak, exactly when fares are
  computed most. Mitigation: cell-pair route cache (24 h), the haversine × detour fallback as a
  first-class tested path, and `distance_source` recorded on every trace.
- **R39 — Actions minutes.** The full matrix does not fit 2 000 minutes/month. Mitigation: tiered CI
  (guardrails ~40 s on every push, full suite on PRs, heavy matrices nightly), and a public
  repository, which the licence already implies.
- **R40 — 700-line cap vs 68-screen apps.** A screen that "needs" 900 lines is a screen with two
  responsibilities. Mitigation: one file per section component, `domain/` extraction, and the 600-
  line warning treated as a build failure by review policy even though CI only warns.

---

## 7. Definition of done, per response and overall

**Per response** (`35 §4`): compiles; no placeholders; tests written in the same response; every
guardrail green; a written summary of what was built, what moved and why; every file ≤ 700 lines
with its header.

**Overall** (`35 §9`, eighteen criteria): 23 workflows green; fresh migrate + `verify-schema`;
empty-platform 283 screens; signed APKs/AABs that install; alarm matrix with force-stop asserted;
2 147 features registered with passing tests; 25 money properties + 10 000 closure cases;
275 001 differential vectors; presence p95 ≤ 2 000 ms on both backends; pre-render verified with JS
off; 14 App Link paths; 56 600 responsive renders; Lighthouse ≥ 95; zero serious a11y violations;
31 guardrails each with a failing fixture; `.env.example` complete; ≤ 700 lines and headers
everywhere; and a real order placed, dispatched, picked up, delivered, settled and invoiced end to
end.

---

## 8. Decisions

`docs/_plan/DECISIONS.md` records D1–D35. Thirty-five entries, and the arithmetic matters because
[`35 §7`](../35-execution-plan.md) says 31: the migration closed two of those thirty-one outright,
leaving **29 open** (D1–D29), and this plan adds **three** the corpus leaves implicit but the build
cannot avoid — generated Kotlin models (D31), the QR key-rotation overlap (D32), error-text
ownership (D33). The last two entries are the deviations made visible in
`UNDERSTANDING.md` §9: one Pages project with a path-scoped CSP (D34) and `minSdk 26` (D35).
Every entry states the decision, what was rejected, and why — so a later reader can tell a choice
from an accident.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
*SPDX-License-Identifier: LicenseRef-PASVL-1.0*
