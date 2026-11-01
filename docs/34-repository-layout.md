<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 34 — Repository Layout

> One repository, five deployable artifacts, roughly 2 400 source files, every one of them at most
> 700 lines. This document is the map the building agent follows.

---

## 1. Top level

```
undal/
├── .github/
│   ├── workflows/              23 workflows — docs/28
│   ├── actions/                 6 composite actions
│   ├── scripts/                guardrail implementations
│   ├── ISSUE_TEMPLATE/
│   └── pull_request_template.md
│
├── android/                    3 apps, 14 core modules, ~70 feature modules
├── workers/                    core (TS) · realtime (TS) · brain (Python)
├── web/                        storefront (React) · admin (React)
├── packages/                   shared TS: contracts, money, tokens, i18n
├── db/                         migrations, expected schema, allowlisted queries
├── design/                     tokens.json, icons, illustrations
├── docs/                       this corpus — 40 documents
├── brand/                      the three app logos (provided)
├── assets/                     alert audio, motion references
│
├── .env.example                every secret and config key — docs/29
├── package.json                workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── LICENSE                     PASVL-1.0
├── PROMPT.md                   the kickoff prompt
└── README.md
```

**pnpm workspaces + Turborepo.** pnpm because its content-addressed store keeps a monorepo with
five JavaScript packages installable in under 20 seconds in CI; Turborepo because task-level
caching turns a full rebuild into a 50-second one.

---

## 2. `android/`

```
android/
├── settings.gradle.kts
├── gradle/libs.versions.toml           one version catalogue
├── build-logic/convention/             6 convention plugins
│
├── core/
│   ├── common/          Result, Clock, dispatchers, extensions          ~1,100 lines
│   ├── money/           Paisa, applyRate, UndalMoney, grouping          ~900
│   ├── model/           pure domain types, no Android imports           ~2,400
│   ├── designsystem/    tokens, theme, 64 components, motion            ~11,000
│   ├── network/         Okronet, 8 interceptors, envelope, errors       ~3,200
│   ├── database/        Room base, converters, SQLCipher                ~2,100
│   ├── datastore/       proto preferences, session                      ~800
│   ├── realtime/        presence socket, SSE                            ~1,600
│   ├── location/        fused provider, displacement filter             ~1,400
│   ├── media/           CameraX, compression, upload                    ~2,000
│   ├── notification/    FCM service, alarm engine, channels, health     ~2,800
│   ├── maps/            MapLibre wrapper, markers, polylines            ~2,600
│   ├── analytics/       first-party event log                           ~700
│   └── testing/         fakes, fixtures, Compose rules                  ~1,900
│
├── feature/
│   ├── auth-*            (4 modules)
│   ├── location-*        (3)
│   ├── customer-*        (18)
│   ├── partner-*         (16)
│   ├── rider-*           (19)
│   └── shared-*          (6)   settings, legal, help, device-health, offline, update
│
└── app/
    ├── customer/         manifest, Application, nav graph, icons        ~1,400
    ├── partner/                                                          ~1,600
    └── rider/                                                            ~1,800
```

### 2.1 A feature module

Every one has the same shape, which is what makes 70 of them navigable:

```
feature/customer-vendor/
├── build.gradle.kts
└── src/
    ├── main/kotlin/com/undal/feature/vendor/
    │   ├── VendorScreen.kt           route + scaffold + state hoisting
    │   ├── VendorViewModel.kt        intents, state machine
    │   ├── VendorUiState.kt          sealed state, reducers
    │   ├── components/               ≤ 10 files, each one visual concern
    │   ├── domain/                   use cases, if the feature needs any
    │   └── nav/VendorNavigation.kt   route definition + arguments
    ├── test/                         ViewModel + reducer tests
    └── androidTest/                  Compose UI tests
```

**Dependency rule:** `app → feature → core`, never `feature → feature`. Enforced by the
`:checkModuleGraph` Gradle task, which fails the build on a violation.

---

## 3. `workers/`

```
workers/
├── core/                                      TypeScript · Hono
│   ├── wrangler.toml
│   └── src/
│       ├── index.ts                   router, middleware chain
│       ├── routes/                    46 route modules, one per resource group
│       ├── domain/
│       │   ├── order/                 state machine, pricing, lifecycle
│       │   ├── vendor/  rider/  customer/
│       │   ├── ledger/                postEntry, closure assertion
│       │   ├── invoice/               builder, PDF, numbering
│       │   └── dispatch/              orchestration (scoring lives in brain)
│       ├── db/                        queries, transactions, repos
│       ├── media/                     imgbb + Cloudinary clients
│       ├── auth/                      Argon2id, JWT, TOTP, sessions
│       ├── bindings/                  service bindings to realtime and brain
│       └── lib/                       money, time, ids, validation
│
├── realtime/                                  TypeScript · DOs
│   ├── wrangler.toml
│   └── src/
│       ├── index.ts
│       ├── hubs/                      ZoneHub, OrderHub, RiderPin
│       ├── coordination/              DurableObjectCoordinator | TiDBCoorhCoordinator
│       ├── presence/                  heartbeat, deadlines, escalation
│       ├── fcm/                       token minting, payload builders, sender
│       ├── d1/                        position writes, ring buffer, erasure
│       └── sse/                       fan-out, resumption
│
└── brain/                                     Python · Pyodide
    ├── wrangler.toml
    └── src/
        ├── main.py                    dispatch to engines
        ├── fare/                      the algebra from docs/10
        ├── dispatch/                  14 factors, scoring, waves
        ├── batch/                     feasibility, permutations, scoring
        ├── rank/                      the 10 stages
        ├── forecast/                  demand surface, prep prediction
        ├── features/                  feature store access, calibration
        ├── trace/                     trace emission
        └── lib/                       money (mirrors TS/Kotlin), stats, geo
```

### 3.1 Why `undal-core` is the sole database writer

Every write goes through one service, which means: one place where transactions are composed, one
place where the ledger closure assertion lives, one place to audit, and no possibility of two
services racing on the same row with different assumptions. `realtime` and `brain` reach the
database only through service bindings into `core`.

---

## 4. `web/`

```
web/
├── storefront/
│   ├── vite.config.ts            including the pre-render plugin
│   ├── public/_routes.json       keeps static assets off the Pages Function
│   └── src/
│       ├── routes/               file-per-route, loaders + components
│       ├── components/           ~120 components
│       ├── features/             cart, checkout, tracking, account
│       ├── lib/                  api client, query config, formatters
│       ├── styles/               CSS modules + generated tokens
│       └── prerender/            route manifest generation, HTML emission
│
└── admin/
    ├── vite.config.ts
    └── src/
        ├── routes/               9 domains, lazily loaded
        ├── components/           ~180, including 60+ data grids
        ├── map/                  the super map — docs/22
        ├── features/             per-domain logic
        └── lib/
```

---

## 5. `packages/`

```
packages/
├── contracts/      Zod schemas + generated TS types for all 412 endpoints.
│                   The single source of truth for request and response shapes;
│                   the web clients import it directly, and a Gradle task
│                   generates matching Kotlin data classes from the same file.
├── money/          applyRate, floorToTaka, Paisa — the TypeScript side of the
│                   three-language differential test.
├── tokens/         Generated from design/tokens.json into CSS custom
│                   properties, a TS object, and Kotlin.
├── i18n/           Message catalogues, en and bn, shared by both web apps.
└── config/         Shared tsconfig, eslint and prettier configurations.
```

`packages/contracts` being the single definition of every endpoint is what keeps three clients and
two servers in agreement. A change to a response shape breaks compilation everywhere it matters,
immediately.

---

## 6. `db/`

```
db/
├── migrations/
│   ├── 001_identity.sql            users, sessions, devices, RBAC schema
│   ├── 002_geography.sql           zones, polygons, cells
│   ├── 003_vendors.sql
│   ├── 004_menu.sql
│   ├── 005_riders.sql
│   ├── 006_orders.sql
│   ├── 007_dispatch.sql
│   ├── 008_ledger.sql
│   ├── 009_invoices.sql
│   ├── 010_support.sql
│   ├── 011_brain.sql               features, traces, config
│   └── 012_constraints_deferred.sql
├── d1/
│   └── 001_positions.sql
├── expected.json                   the schema verify-schema.yml compares against
└── queries/                        allowlisted read-only queries for db-query.yml
```

Forward-only. Every migration is online-safe (nullable add, batched backfill, then constrain) and
the validator rejects a blocking statement.

---

## 7. `design/`

```
design/
├── tokens.json             the single source: 94 colours, 18 type styles,
│                           31 spacing/radius/elevation, 22 motion specs
├── icons/                  118 SVGs → ImageVector + React components
├── illustrations/          44 empty-state SVGs, light and dark
├── markers/                34 map marker SVGs — docs/22
└── pdf/                    invoice layout definitions
```

A Gradle task and a Vite plugin both read `tokens.json`. Changing a colour changes both platforms
in one commit, and `token-purity` makes sure nobody bypasses it.

---

## 8. File size discipline

The brief's ≤ 700-line rule, applied to roughly 2 400 files.

| Area | Typical file | Hard cap |
| --- | --- | --- |
| Compose screen | 150–250 | 700 |
| Compose component | 80–200 | 700 |
| ViewModel | 180–320 | 700 |
| Worker route module | 120–280 | 700 |
| Domain service | 200–400 | 700 |
| Python engine module | 150–350 | 700 |
| SQL migration | 100–400 | 700 |
| Test file | up to 700 | 700 |

`line-budget` fails above 700 and **warns above 600**. The warning is where the discipline
actually lives: a file that trips the warning gets split while splitting is still easy.

### 8.1 How to split

| Pressure | Split by |
| --- | --- |
| A screen with many sections | One file per section component |
| A ViewModel with many intents | Extract use cases into `domain/` |
| A route module with many endpoints | One module per resource, not per domain |
| A long state machine | A transition table in data, a small evaluator in code |
| A test file | One file per behaviour group |
| A long constant table | A dedicated `*Constants.kt` or a JSON resource |

---

## 9. Naming

| Kind | Convention | Example |
| --- | --- | --- |
| Kotlin file | PascalCase matching the primary declaration | `VendorScreen.kt` |
| Kotlin package | lowercase, no underscores | `com.undal.feature.vendor` |
| TS file | kebab-case | `order-state-machine.ts` |
| TS type | PascalCase | `OrderStateTransition` |
| Python module | snake_case | `dispatch_scoring.py` |
| SQL | snake_case; tables plural, columns singular | `order_items.item_snapshot` |
| Money column | always `_paisa` | `total_paisa` |
| Timestamp column | always `_at` | `delivered_at` |
| Boolean column | `is_` / `has_` | `is_available` |
| Enum value | SCREAMING_SNAKE | `RIDER_ASSIGNED` |
| Permission key | `domain.resource.action` | `finance.payout.mark_paid` |
| Feature ID | `D{domain}-{seq}` | `D5-0137` |
| Error code | SCREAMING_SNAKE | `QUOTE_MISMATCH` |
| Test name | `should_X_when_Y` | `should_reject_offer_when_rider_cash_limit_exceeded` |

The `_paisa` suffix is load-bearing: `money-integrity` keys off it to find every monetary column
and assert it is an `INT8` touched only by integer arithmetic.

---

## 10. Every file's header

```kotlin
/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */
```

Comment syntax varies by language; the two lines do not. `license-headers` fails the build on a
file without them.

---

## 11. Commit and PR conventions

| Convention | Rule |
| --- | --- |
| Commit subject | Imperative, ≤ 72 characters, no type prefix |
| Commit body | What changed and **why**, wrapped at 80 |
| Footer | The two PASVL lines on every commit |
| Branch | `feat/`, `fix/`, `docs/`, `chore/` + a short slug |
| PR title | What a release note would say |
| PR body | The template: what, why, how tested, screenshots for UI, migration notes |
| Squash | Required; `main` keeps a linear history |

---

## 12. What is deliberately absent

| Absent | Why |
| --- | --- |
| `docker-compose.yml` | There is no local development ([`28 §1`](28-cicd-github-actions.md)) |
| `Makefile` | Same |
| `.nvmrc` | Node version lives in the workflows |
| A `scripts/` directory of developer helpers | Anything worth running is a workflow |
| `node_modules`, `build/`, `.gradle/` | Ignored |
| Any `*.keystore`, `*.jks`, `*.p12` | Ignored, and `secret-scan` fails on one |
| `google-services.json` | Generated at build time from secrets |
| Seed or fixture business data | Forbidden by the brief and by `no-seed-data` |
| A `TODO.md` | Work lives in issues |

---

## 13. `.gitignore`

```gitignore
# Build output
build/ .gradle/ local.properties .cxx/
node_modules/ dist/ .turbo/ .vite/ .wrangler/
__pycache__/ *.pyc .pytest_cache/ .ruff_cache/

# Secrets and signing — never, under any circumstance
*.jks *.keystore *.p12 *.pem *.key
google-services.json
.env .env.local .env.*.local
!.env.example

# Generated
packages/tokens/dist/
packages/contracts/generated/
android/**/generated/
web/*/public/sitemap*.xml
web/*/public/.well-known/assetlinks.json

# Artifacts
*.apk *.aab *.log coverage/ test-results/ playwright-report/

# Editors
.idea/ .vscode/ *.iml .DS_Store
```

`!.env.example` is deliberate: the example file **must** be committed, since it is the register of
everything the platform needs.

---

## 14. Reading on

Next: [`35-execution-plan.md`](35-execution-plan.md) — the order in which all of this gets built.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
