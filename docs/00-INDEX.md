<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 00 — Index, Reading Order, and How to Use This Corpus

This directory is the **complete specification of Undal**. It is written to be executed, not admired.
Every number in it is a number the implementation must produce. Every table is a table the database
must contain. Every rule is a rule continuous integration must enforce.

---

## 1. How to read this

There are three audiences and three routes.

### 1.1 Route A — the AI agent building the platform

Read **all forty documents, in numerical order, before writing a single line of code.** Then write
the two planning documents described in [`PROMPT.md`](../PROMPT.md) and only then begin. The
execution plan in [`35-execution-plan.md`](35-execution-plan.md) tells you what to build in each of
the twenty build responses.

Do not read selectively. The corpus is densely cross-referenced; the fare engine in `10` depends on
the zone model in `06`, which depends on the geofencing rules in `21`, which depend on the routing
contract in `05`. Reading out of order produces subtly wrong software.

### 1.2 Route B — the operator (the human who runs Undal)

Read in this order, and skip the rest until you need it:

1. [`01-mission-and-non-negotiables.md`](01-mission-and-non-negotiables.md) — what Undal is and will never be
2. [`29-secrets-and-configuration.md`](29-secrets-and-configuration.md) — accounts to create, secrets to set
3. [`23-onboarding-kyc.md`](23-onboarding-kyc.md) — how vendors and riders join
4. [`24-finance-payouts-invoices.md`](24-finance-payouts-invoices.md) — how money moves on Friday and Saturday
5. [`25-rider-cash-settlement.md`](25-rider-cash-settlement.md) — how cash comes back
6. [`21-admin-panel.md`](21-admin-panel.md) — the control surface you will live in
7. [`28-cicd-github-actions.md`](28-cicd-github-actions.md) — the buttons in the Actions tab

### 1.3 Route C — the auditor or the curious

Start with [`39-risk-register-and-truths.md`](39-risk-register-and-truths.md). It is the document
that says, plainly, what this architecture cannot do, where the free tier bites, and which promises
are engineering guarantees versus best-effort. Then read `27`, `10`, `24`, and `15`.

---

## 2. The forty documents

### Group A — Foundation (what and why)

| # | Document | Answers |
| --- | --- | --- |
| 01 | [Mission and Non-Negotiables](01-mission-and-non-negotiables.md) | What is Undal? What are the 40 rules that cannot be broken? What is the business model to the paisa? |
| 02 | [Reference Analysis](02-reference-analysis.md) | Frame-by-frame analysis of the two motion references; a full teardown of Foodpanda's and Uber Eats' screen inventory, interaction patterns, and what Undal takes, improves, or rejects. |
| 03 | [Brand and Design System](03-brand-and-design-system.md) | The exact palette, type scale, spacing grid, radii, elevation, iconography, the 50 breakpoints, and the component catalogue. |
| 04 | [Motion and Interaction](04-motion-and-interaction.md) | Every animation in the platform with its spring constants, durations, curves, and the Compose / CSS implementation of each. |

### Group B — Architecture (how it is wired)

| # | Document | Answers |
| --- | --- | --- |
| 05 | [System Architecture](05-system-architecture.md) | Three Workers, their boundaries, Durable Objects, the request lifecycle, the failure model, the free-tier budget. |
| 06 | [Data Model — TiDB](06-data-model-tidb.md) | Every table, column, type, constraint, index, and the complete DDL with the integer-coordinate geospatial layer. |
| 07 | [D1 Live Tracking](07-d1-live-tracking.md) | The ephemeral rider location channel: 100 m gating, adaptive cadence, ring buffer, erasure, and the write-budget arithmetic. |
| 08 | [API Contract](08-api-contract.md) | Every endpoint across all three Workers: method, path, auth, request schema, response schema, error codes, idempotency, rate limits. |

### Group C — The Undal Brain (the decision engine)

| # | Document | Answers |
| --- | --- | --- |
| 09 | [Undal Brain — Overview](09-undal-brain-overview.md) | The four engines, the shared feature store, online learning without a model server, determinism, explainability, and the replay harness. |
| 10 | [Fare Engine — Mathematics](10-fare-engine-math.md) | The complete fare and payout algebra, every coefficient, 40 worked test vectors, and the integer-paisa rounding law. |
| 11 | [Dispatch Engine](11-dispatch-engine.md) | Candidate generation, the 14-factor scoring function, offer cascades, rejection handling, reassignment, and the no-rider fallback. |
| 12 | [Batching Engine](12-batching-engine.md) | Bundle detection, detour budgets, the feasibility proof, stacked-order UX, and the payout adjustment. |
| 13 | [Ranking and Personalisation](13-ranking-personalization.md) | The ten-stage ranking pipeline, the personalisation vector, anti-advertising guarantees, and the re-engagement reminder engine. |

### Group D — Realtime (the hard part)

| # | Document | Answers |
| --- | --- | --- |
| 14 | [Presence and Heartbeat](14-presence-and-heartbeat.md) | The two-second offline detection, the grace ladder, auto-pause, the unreachable-vendor auto-cancel, and reconnection. |
| 15 | [Wake-Up Alarm and FCM](15-wakeup-alarm-fcm.md) | Data-only FCM v1, the alarm stack, the foreground service, the looping audio, the watchdog, OEM coaching, and an honest statement of Android's limits. |

### Group E — Clients (what people touch)

| # | Document | Answers |
| --- | --- | --- |
| 16 | [Android Foundation](16-android-foundation.md) | Module graph, okcronet HTTP/3, Room, WorkManager, DI, the design-system library, and the shared core. |
| 17 | [Customer App](17-customer-app.md) | All 68 screens, every state, every interaction, every animation. |
| 18 | [Partner App](18-partner-app.md) | All 54 screens, the order console, the prep-time dial, menu management, and the dashboard. |
| 19 | [Rider App](19-rider-app.md) | All 61 screens, shift lifecycle, selfie verification, the offer card, QR pickup, navigation hand-off, and the cash lock. |
| 20 | [Web Storefront](20-web-storefront.md) | React + Vite + TypeScript, the prerender pipeline, ordering on the web, and parity with the app. |
| 21 | [Admin Panel](21-admin-panel.md) | Nine domains, the module map, RBAC surfaces, and the operating procedures. |
| 22 | [Admin Super Map](22-admin-super-map.md) | The full-screen command map: marker system, SVG vocabulary, clustering, the inspector, and 60 fps at scale. |

### Group F — Operations (running a real business)

| # | Document | Answers |
| --- | --- | --- |
| 23 | [Onboarding and KYC](23-onboarding-kyc.md) | Restaurant, home kitchen, motorbike rider, and bicycle rider checklists as executable state machines. |
| 24 | [Finance, Payouts and Invoices](24-finance-payouts-invoices.md) | The ledger, the closed-sum invariant, Friday and Saturday runs without cron, and the branded PDF under 1 MB. |
| 25 | [Rider Cash Settlement](25-rider-cash-settlement.md) | The end-of-shift lock screen, the tick sound, selfie and TrxID capture, and admin clearance. |
| 26 | [Media Pipeline](26-media-pipeline.md) | imgbb for public images, Cloudinary for documents and invoices, the signing model, and the client upload contract. |
| 27 | [Security, RBAC and Audit](27-security-rbac-audit.md) | Tokens, sessions, TOTP, the permission matrix, the immutable audit log, and the threat model. |

### Group G — Delivery (getting it live from a tablet)

| # | Document | Answers |
| --- | --- | --- |
| 28 | [CI/CD with GitHub Actions](28-cicd-github-actions.md) | Every workflow file, the keystore ceremony, signed APK and AAB, migrations, deploys, and the release flow. |
| 29 | [Secrets and Configuration](29-secrets-and-configuration.md) | Every secret name, how to obtain it, how to rotate it, and the complete `.env.example`. |
| 30 | [Testing and Verification](30-testing-and-verification.md) | Unit, property, invariant, golden, routing, responsive, benchmark, and the definition of "proven". |
| 31 | [SEO, Prerender and Deep Links](31-seo-prerender-deeplinks.md) | Dynamic head, prerendering, structured data, sitemaps, App Links, and domain portability. |
| 32 | [Localisation and Currency](32-localization-and-currency.md) | Bangla and English, ৳ formatting, Bengali numerals, Asia/Dhaka, and the string-extraction gate. |
| 33 | [Empty-State Doctrine](33-empty-state-doctrine.md) | How a platform with zero vendors behaves, and the 44 empty states that make that beautiful. |

### Group H — Meta (navigating the build)

| # | Document | Answers |
| --- | --- | --- |
| 34 | [Repository Layout](34-repository-layout.md) | Every directory, every package, the 700-line rule, and the naming conventions. |
| 35 | [Execution Plan](35-execution-plan.md) | The twenty build responses, what each delivers, and the CI gate each must leave green. |
| 36 | [Acceptance Criteria](36-acceptance-criteria.md) | The checklist that decides whether Undal is done. |
| 37 | [Feature Register](37-feature-register.md) | The counted register of implemented capabilities across all surfaces. |
| 38 | [Glossary](38-glossary.md) | Every term, acronym, and Bangla word used in this corpus. |
| 39 | [Risk Register and Honest Truths](39-risk-register-and-truths.md) | What can go wrong, what the free tier forbids, and which promises are guarantees versus best-effort. |

---

## 3. Dependency graph

Read top to bottom; an arrow means "the lower document assumes the upper one".

```
                        01 Mission
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   02 Reference        05 Architecture     29 Secrets
        │                   │                   │
        ▼                   ├──────┬──────┬─────┴─────┐
   03 Design System         ▼      ▼      ▼           ▼
        │              06 TiDB     07 D1 08 API  28 CI/CD
        ▼                   │      │      │           │
   04 Motion                └──┬───┴──┬───┘           │
        │                      ▼      ▼               │
        │                 09 Brain  14 Presence       │
        │                      │      │               │
        │          ┌───────┬───┴──┬───┘               │
        │          ▼       ▼      ▼                   │
        │      10 Fare 11 Dispatch 12 Batch           │
        │          │       │      │                   │
        │          └───┬───┴──────┘   13 Ranking      │
        │              ▼                  │           │
        │         15 Wake-up ◄────────────┘           │
        │              │                              │
        └──────┬───────┴──────┬───────────┬───────────┘
               ▼              ▼           ▼
          16 Android     20 Web      21 Admin
               │              │           │
      ┌────┬───┴───┬────┐     │           ▼
      ▼    ▼       ▼    │     │      22 Super Map
    17 Cust 18 Part 19 Rider  │
      └────┴───┬───┴──────────┘
               ▼
    23 KYC · 24 Finance · 25 Cash · 26 Media · 27 Security
               │
               ▼
    30 Testing · 31 SEO · 32 L10n · 33 Empty · 34 Layout
               │
               ▼
      35 Execution → 36 Acceptance → 37 Register
                             │
                             ▼
                     39 Risk and Truths
```

---

## 4. Conventions used throughout this corpus

| Convention | Meaning |
| --- | --- |
| **MUST** | A hard requirement. CI enforces it or a reviewer rejects the change. |
| **MUST NOT** | A prohibition. Violating it is a build failure. |
| **SHOULD** | Strong default. Deviating requires a note in `docs/_plan/DECISIONS.md`. |
| **MAY** | Genuine latitude. |
| `§n.m` | Section *n.m* of the document currently being read. |
| `doc 07 §4` | Section 4 of document `07-d1-live-tracking.md`. |
| ৳ | Bangladeshi Taka. Always rendered with the ৳ sign, never "BDT" in user-facing copy. |
| **paisa** | 1/100 of a taka. **All money in code and database is an integer count of paisa.** |
| `TABLE.column` | A CockroachDB column, e.g. `orders.subtotal_paisa`. |
| **Actor** | One of: Customer, Partner, Rider, Admin, System. |
| **Surface** | One of: Customer App, Partner App, Rider App, Web Storefront, Admin Panel. |

### 4.1 The paisa rule, stated once so it is never ambiguous

> Every monetary quantity in Undal — prices, fees, commissions, taxes, discounts, payouts, penalties,
> bonuses, wallet balances, invoice lines, and totals — is stored, transported, computed, and compared
> as a **signed 64-bit integer count of paisa**. Floating-point arithmetic on money is forbidden in
> every language in this repository. Presentation layers divide by 100 exactly once, at the final
> render step, and never feed the result back into a calculation.

Rationale, enforcement, rounding law, and the test vectors live in
[`10-fare-engine-math.md §3`](10-fare-engine-math.md).

### 4.2 Time

All timestamps are stored as `TIMESTAMPTZ` in UTC. All user-facing times render in **Asia/Dhaka
(UTC+06:00, no daylight saving)**. The payout week boundary is defined in Asia/Dhaka, not UTC — this
matters, and [`24-finance-payouts-invoices.md §4`](24-finance-payouts-invoices.md) handles it
explicitly.

### 4.3 Identifiers

| Entity | ID shape | Example |
| --- | --- | --- |
| Internal primary keys | `UUID v7` (time-ordered, index-friendly) | `0193f2a1-...` |
| Human-visible order code | `UND-` + base32 Crockford, 8 chars, checksummed | `UND-7K2M9QX4` |
| Invoice number | `UND/{V\|R}/{YYYY}/{WW}/{seq}` | `UND/V/2026/44/00017` |
| Vendor slug | kebab-case, unique per zone | `the-burger-junction-sylhet` |

UUID v7 is chosen over v4 because CockroachDB range-splits on primary key, and time-ordered keys keep
recent-order scans in a small number of ranges. The hotspot risk this normally creates is mitigated by
the zone-sharded secondary indexes described in [`06-data-model-tidb.md §12`](06-data-model-tidb.md).

---

## 5. What is deliberately **not** in this corpus

| Absent | Why |
| --- | --- |
| Online card payments | Undal is cash-on-delivery only at launch. The ledger is built so that adding a gateway later is additive, not a rewrite — see [`24 §12`](24-finance-payouts-invoices.md). |
| iOS applications | Explicit product decision. iOS users order through the prerendered web storefront, which is a first-class surface, not a fallback. See [`20`](20-web-storefront.md). |
| SMS or email OTP | Free tier. Accounts are secured by password plus device binding plus session integrity; see [`27 §3`](27-security-rbac-audit.md) for how this is made safe without OTP. |
| A machine-learning model server | The Brain is deterministic online statistics, not a neural network. It needs no GPU, no inference host, and no monthly bill. See [`09 §2`](09-undal-brain-overview.md). |
| Kubernetes, Docker, Terraform | There is no server to orchestrate. Workers and Pages are the runtime; GitHub Actions is the control plane. |
| Any paid SaaS | Hard constraint. [`39 §3`](39-risk-register-and-truths.md) lists every free-tier ceiling and the headroom at projected volume. |

---

## 6. Corpus statistics

| Metric | Value |
| --- | --- |
| Documents | 40 |
| Named database tables specified | 96 |
| API endpoints specified | 412 |
| Screens specified across five surfaces | 283 |
| Fare test vectors | 40 |
| GitHub Actions workflows specified | 23 |
| Responsive breakpoints enforced | 50 |
| Empty states designed | 44 |
| Registered features | see [`37-feature-register.md`](37-feature-register.md) |

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
