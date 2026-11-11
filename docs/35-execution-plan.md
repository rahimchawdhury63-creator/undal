<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 35 — Execution Plan

> The building agent gets **2 planning responses** and **20 build responses**, each at maximum
> output length and each producing at least 10 000 lines of code. This document allocates that
> budget precisely: what goes in which response, in what order, and why that order and not
> another.

---

## 1. The ordering principle

Build in **dependency order, with the riskiest thing that could invalidate the design first**.

Three things could force a redesign if they turn out to be wrong, so each is proven early:

| Risk | Proven in | Why it must be early |
| --- | --- | --- |
| The data model cannot express the business | Response 3 | Everything else is built on it |
| The ledger cannot be made to close | Response 4 | If money is wrong, nothing else matters |
| The alarm does not actually wake a killed phone | Response 11 | The second-most-important requirement, and the one most dependent on OS behaviour |

Response 11 is as early as it can be, since the alarm needs the Android foundation beneath it.
If the device matrix shows the alarm is unreliable on a common device, there are nine responses
left in which to adapt.

---

## 2. Planning responses

### Response P1 — Read and decide

No code. Produce:

1. A confirmation of every constraint, restated so the developer can check nothing was
   misunderstood.
2. The complete file manifest: every file to be created, with its path, its purpose and its
   estimated line count. Roughly 2 400 entries.
3. The dependency graph between the twenty build responses.
4. Every decision this corpus leaves open, decided, with reasoning. There are 31 of them, listed
   in §7.
5. The risks the agent sees that this corpus does not already record.

### Response P2 — The skeleton

Still no business logic. Produce:

1. Every configuration file: `settings.gradle.kts`, `libs.versions.toml`, the six convention
   plugins, `package.json`, `pnpm-workspace.yaml`, `turbo.json`, every `tsconfig.json`, every
   `wrangler.toml`, `vite.config.ts` × 2.
2. All 23 workflow files, complete and runnable.
3. All 28 guardrail scripts with their failing fixtures.
4. `.env.example`, complete.
5. `.gitignore`, the PR template, the issue templates.
6. The empty module structure: every Gradle module declared, every package directory created with
   its `package-info` or equivalent.

At the end of P2 the repository builds, CI is green, and it does nothing. That is the correct
state to start from, because every subsequent response lands in a repository that already
enforces its own rules.

---

## 3. The twenty build responses

| # | Title | Produces | Depends on |
| --- | --- | --- | --- |
| **B1** | Contracts and money | `packages/contracts` (all 412 endpoints as Zod), `packages/money`, `packages/tokens`, `packages/i18n` skeleton, the three-language `applyRate` with its differential test | P2 |
| **B2** | Database schema | All 12 migrations, `db/expected.json`, the D1 migration, the schema verifier, the allowlisted query set | P2 |
| **B3** | Core worker foundation | Router, middleware, envelope, errors (all 184), auth (Argon2id/JWT/TOTP/sessions), RBAC (412 keys), audit with the hash chain, idempotency, rate limiting | B1, B2 |
| **B4** | Ledger and money domain | `ledger_*` repositories, `postEntry` with the closure assertion, every posting set from [`24 §3`](24-finance-payouts-invoices.md), the 10 000-case property test | B3 |
| **B5** | Brain: fare engine | The complete algebra from [`10`](10-fare-engine-math.md), the surge curve, all 40 worked vectors as tests, the 25 properties | B1 |
| **B6** | Core domain: orders | The state machine, order lifecycle, pricing integration, quote-then-reprice, snapshots, `order_state_events` | B3, B4, B5 |
| **B7** | Brain: dispatch and batch | 14 factors, scoring, wave sizing, the cascade, feasibility proofs, permutation search, the benchmark harness | B5, B6 |
| **B8** | Realtime worker | ZoneHub, OrderHub, RiderPin, both Coordinator implementations, presence with the 2-second guarantee, SSE fan-out, the escalation ladder | B3, B6 |
| **B9** | FCM and D1 tracking | Token minting, payload builders with purity enforcement, the sender, D1 ring buffer, position ingestion, anti-spoof, erasure | B8 |
| **B10** | Android foundation | All 14 `core` modules: design system (64 components, 118 icons, 44 illustrations), Okronet, Room, DataStore, realtime client, location, media, maps, notification scaffolding | P2, B1 |
| **B11** | **The alarm** | `UndalMessagingService`, `AlarmLauncher` with all three paths, `AlarmService`, `AlarmPlayer`, the full-screen activity, channels, device health, OEM coaching, the self-test, the Test Lab matrix | B9, B10 |
| **B12** | Rider app | All 61 screens, shift lifecycle, offers, active delivery, QR scan, navigation handoff, earnings, performance, safety | B10, B11 |
| **B13** | Cash settlement | The blocking screen with all four escape constraints, the tick, submission, the admin review queue, every ledger path | B4, B12 |
| **B14** | Partner app | All 54 screens, the order board, prep time, QR display, menu management with the offline outbox, hours, performance, finance, staff RBAC | B10, B11 |
| **B15** | Brain: ranking and forecast | The 10 stages, the anti-ad invariant, the synonym table, MMR diversity, cold start, item recommendation, the demand surface, prep prediction | B5, B6 |
| **B16** | Customer app | All 68 screens, browse, vendor page, cart, checkout, tracking, history, disputes, account, taste profile | B10, B15 |
| **B17** | Web storefront | Every route, full ordering parity, the pre-render pipeline, SEO, structured data, sitemaps, App Links, the partner and rider web consoles | B1, B15 |
| **B18** | Finance and invoicing | The period-boundary trigger, deterministic invoice generation, the PDF builder, payout runs, the bKash export, reconciliation, cost attribution | B4, B13 |
| **B19** | Admin panel I | Shell, command palette, domains 1–5: identity/RBAC/audit, dispatch and fleet, geography and pricing, vendors and menu, finance | B17, B18 |
| **B20** | Admin panel II and the super map | Domains 6–9: order tower and exceptions, marketing, support, analytics and Brain insights. The full WebGL super map. Onboarding and KYC flows. Final integration | B19 |

---

## 4. Per-response requirements

Every build response must end with:

| Requirement | Detail |
| --- | --- |
| **Compiling code** | Nothing half-written. If a piece will not fit, it moves to the next response and is noted, rather than being stubbed |
| **No placeholders** | `no-placeholders` is in CI from P2 onward and will fail the build |
| **Tests** | Every unit of logic tested in the same response that creates it. Tests are not deferred |
| **Green CI** | Every guardrail passing |
| **A written summary** | What was built, what was deferred and why, what the next response needs |
| **≤ 700 lines per file** | Enforced |
| **Licence headers** | Enforced |

### 4.1 Deferral protocol

A build response that cannot fit its scope must:

1. Complete whole units, never partial ones.
2. State explicitly what moved and to where.
3. Leave no compilation error and no failing test.
4. Not stub. A missing feature is better than a lying one.

---

## 5. The critical path

```
P1 → P2 → B1 → B2 → B3 → B4 → B6 → B8 → B9 → B10 → B11 → B12 → B13 → B18 → B19 → B20
                       └→ B5 → B7 ────┘        └→ B14
                              └→ B15 → B16 → B17
```

B5 (fare) and B7 (dispatch) can be built in parallel with B3/B4 because they depend only on
contracts and money. B14 (partner) and B16 (customer) are independent of each other.

The longest chain is 16 responses, leaving 4 of slack across the 20 — which is the buffer for
scope that overruns.

---

## 6. Line-count allocation

Twenty responses at 10 000+ lines is 200 000+ lines minimum. The realistic distribution:

| Response | Lines | Notes |
| --- | --- | --- |
| B1 | 11 000 | Contracts are large and repetitive |
| B2 | 9 000 | SQL is dense |
| B3 | 13 000 | Auth and RBAC are big |
| B4 | 10 000 | Including 10 000 generated test cases, generated not written |
| B5 | 12 000 | 40 vectors × 3 languages |
| B6 | 13 000 | |
| B7 | 14 000 | 14 factors with tests, plus the benchmark |
| B8 | 12 000 | Two coordinator implementations |
| B9 | 11 000 | |
| B10 | 18 000 | The design system alone is 11 000 |
| B11 | 10 000 | |
| B12 | 19 000 | 61 screens |
| B13 | 8 000 | |
| B14 | 17 000 | 54 screens |
| B15 | 13 000 | |
| B16 | 21 000 | 68 screens |
| B17 | 19 000 | Two web apps |
| B18 | 12 000 | |
| B19 | 22 000 | 5 admin domains |
| B20 | 24 000 | 4 domains + the map + KYC |
| **Total** | **≈ 288 000** | |

Screens dominate, which is correct: 283 screens at an average of 280 lines across their
component files is 79 000 lines before tests.

---

## 7. Decisions left to the building agent

Thirty-one points this corpus deliberately does not fix, to be decided in **P1** with reasoning:

**Android (9):** Compose navigation library version strategy · whether to use Molecule for state
· the Room-to-domain mapping style · the exact `ImageVector` generation pipeline · Coil 3 disk
cache sizing · whether MapLibre or Leaflet-in-WebView for the rider's offline map · the Okronet
fork point versus `com.vk.knet:okcronet` · baseline-profile generation strategy · Hilt versus
manual DI for `core:testing`.

**Workers (7):** Hono middleware ordering details · the exact TiDB connection pooling
approach under Workers' request model · whether Pyodide or a pure-WASM Python for `brain` ·
KV versus Cache API for the feature store hot tier · the SSE heartbeat frame format · the service
binding error-propagation convention · the retry-budget algebra across nested service calls.

**Web (6):** React Router data mode versus a framework · the pre-render plugin (build versus
adopt) · CSS Modules versus vanilla-extract · the virtualisation library for admin grids · the
chart library · the service-worker framework or hand-rolled.

**Data (3):** ~~the UUID v7 generation source~~ — **closed by the TiDB migration**: TiDB has no `gen_random_uuid()` at all, so the application generates v7 in one place per language against a shared test vector ([`06 §1`](06-data-model-tidb.md) rule 2). Remaining:
[`00 §4.3`](00-INDEX.md) requires v7 — decide between a client-side generator and a SQL function,
and prove monotonicity under concurrency · whether `order_items` snapshots store the full item or
a delta · the `brain_traces` partitioning strategy · the materialised-view refresh approach for
`vendor_stats`. ~~The exact PostGIS index parameters~~ — **closed**: there is no spatial index, and the cell-grid constants are frozen in [`06 §4.1.1`](06-data-model-tidb.md).

**Process (4):** the Turborepo task graph · whether to adopt a changeset tool · the
screenshot-diff tolerance · the flaky-test quarantine mechanism.

Each decision must be recorded in `docs/_plan/DECISIONS.md` with the options considered and the reason,
so a later reader understands why.

---

## 8. What to do when this corpus is wrong

It will be wrong somewhere. Forty documents written ahead of implementation always are.

| Situation | Action |
| --- | --- |
| A stated number is arithmetically wrong | **The tests are the arbiter.** Recompute from the formulas, fix the document, note it in the response summary. [`24 §2.3`](24-finance-payouts-invoices.md) is the worked example of this |
| Two documents disagree | The more specific one wins: [`24`](24-finance-payouts-invoices.md) over [`10`](10-fare-engine-math.md) for postings; [`10`](10-fare-engine-math.md) over everything for fare formulas; [`06`](06-data-model-tidb.md) over everything for schema |
| A design cannot be implemented as specified | Implement the **intent**, document the deviation, and explain the constraint that forced it |
| A free-tier limit makes something impossible | Say so plainly, implement the best available alternative, and record it in [`39`](39-risk-register-and-truths.md) |
| A requirement conflicts with user safety or honesty | Safety and honesty win. Explain why in the response |
| Something is simply missing | Decide, implement, document |

**Never** silently diverge, never stub, and never claim something works that has not been tested.

---

## 9. Definition of done

The platform is done when every item below is true and demonstrable:

| # | Criterion |
| --- | --- |
| 1 | All 23 workflows run green from the Actions tab |
| 2 | A fresh database migrates cleanly and `verify-schema` passes |
| 3 | The **empty-platform test** passes: 283 screens on a zero-row database |
| 4 | Signed `.apk` and `.aab` exist for all three apps and install on a real device |
| 5 | The alarm fires on the full Test Lab matrix, with force-stop asserted as non-delivery |
| 6 | 2 147 admin features are registered, each with a passing test |
| 7 | Every money property (25) and every ledger closure case (10 000) passes |
| 8 | The three-language differential test passes on 275 001 vectors |
| 9 | Offline detection p95 ≤ 2 000 ms on both coordinator backends |
| 10 | Every pre-rendered route serves real content with JavaScript disabled |
| 11 | App Links open the installed app for all 14 claimed paths |
| 12 | 56 600 responsive renders with zero overflow |
| 13 | Lighthouse ≥ 95 on every public route |
| 14 | Zero serious or critical accessibility violations |
| 15 | All 31 guardrails pass, each with a fixture proving it can fail |
| 16 | `.env.example` covers every secret and config key |
| 17 | Every file ≤ 700 lines, every file carries the licence header |
| 18 | A real order can be placed, dispatched, picked up, delivered, settled and invoiced end to end |

Item 18 is the only one that matters to a user, and it is last because the other seventeen are
what make it trustworthy.

---

## 10. Schedule: original target and current planning range

### Original response-based target (historical, not a current forecast)

The original plan assumed the twenty build responses could be produced in sequence, with review
between responses:

| Phase | Responses | Elapsed |
| --- | --- | --- |
| Planning | P1–P2 | Day 1 |
| Foundations | B1–B5 | Days 2–4 |
| Backend | B6–B9 | Days 5–7 |
| Android | B10–B14 | Days 8–12 |
| Intelligence and clients | B15–B17 | Days 13–16 |
| Admin and finance | B18–B20 | Days 17–20 |
| Integration, device testing, first zone setup | — | Days 21–28 |

This four-week schedule is an original idealized response sequence, not a measured delivery rate or
a promise. It assumed the planned applications, integration and verification could be completed in
those responses and seven days of follow-through. The repository state does not support that
assumption: significant planned applications are absent, several response gates remain open or
unverified, and production integration and operational evidence have not been established. Do not
use the 28-day figure as the current estimate.

### Revised provisional estimate (remaining full-production scope)

As of 2026-11-01, the rough planning range from the current repository state to a defensible,
full-production launch is **12–24 months for an experienced 6–10 person cross-functional team**, or
**3–5+ years for one full-time developer**. This is a provisional planning estimate, not a measured
velocity, delivery commitment, or guarantee. It assumes the scope remains broadly comparable to this
plan, sustained staffing, timely provider and legal decisions, and access to isolated staging,
representative devices and test integrations. Scope changes, staffing, staging discoveries, security
findings and external approvals may materially extend it. Re-estimate after an isolated TiDB
integration/recovery exercise and a current application-scope inventory.

This estimate covers remaining implementation **and** production evidence, including the blockers
listed in [`PRODUCTION-READINESS.md`](_plan/PRODUCTION-READINESS.md): atomic financial
and audit writes; serialized, versioned audit persistence and historical review; isolated TiDB,
migration-recovery and schema validation; customer, rider, partner and admin applications; secure
private media; provider/ledger reconciliation; security, end-to-end, device and load testing;
backup/restore, monitoring and operational readiness; and legal, privacy, provider and licensing
approvals. A limited, explicitly bounded pilot might be possible earlier, but it would not mean the
full platform is production-ready.

The current provisional platform-wide progress rating is **about 3/10**. It is a qualitative scope
assessment, not a test-health score or a completion percentage; the evidence and caveats are tracked
in the production-readiness register linked above.

---

## 11. Reading on

Next: [`36-acceptance-criteria.md`](36-acceptance-criteria.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
