<div align="center">

<img src="brand/undal-customer-logo.jpg" width="180" alt="Undal" />

# Undal — Food & Groceries

**On-demand, real-time, cash-on-delivery, multi-vendor food delivery and pick-up platform.**
Built for Bangladesh. Built on a 100% free tier. Built to be measured against Foodpanda and Uber Eats.

`Android (Customer · Partner · Rider)` · `React + Vite Web` · `Cloudflare Workers` · `TiDB Cloud` · `Cloudflare D1` · `OSM + OSRM` · `FCM v1`

[![License: PASVL-1.0](https://img.shields.io/badge/License-PASVL--1.0-0F4435.svg)](LICENSE)
[![Deployment: LOSDA required](https://img.shields.io/badge/Deployment-LOSDA%20required-D70F64.svg)](LICENSE)

</div>

---

## What is in this repository right now

This repository contains the specification and partially implemented backend, database, shared money
and Android money components. The customer, partner and rider applications and the web/admin apps
are not yet present. **Undal is not production-ready.** See the [production readiness register](docs/_plan/PRODUCTION-READINESS.md)
for known blockers, safeguards and required launch evidence. The architecture below describes the
intended platform, not a claim that every component has been delivered or deployed.

| Path | What it is |
| --- | --- |
| [`PROMPT.md`](PROMPT.md) | **The kickoff block.** Paste this into an AI coding agent to start the build. |
| [`docs/`](docs/) | 40 specification documents. Everything from fare mathematics to Gradle signing. |
| [`docs/00-INDEX.md`](docs/00-INDEX.md) | Reading order, document dependency graph, and what each file answers. |
| [`brand/`](brand/) | The four official logos, in the exact files the apps and web must consume. |
| [`assets/audio/`](assets/audio/) | `undal_order_alert_loop.wav` — the 8.000 s seamless alarm loop. |
| [`assets/reference/`](assets/reference/) | The two motion-design reference videos that define Undal's animation language. |

## The platform in one diagram

```
                       ┌──────────────────────────── Customers ────────────────────────────┐
                       │  Android app (Kotlin)        Web storefront (React+Vite, prerendered) │
                       └───────────────┬───────────────────────────────┬───────────────────┘
                                       │                               │
   Partners ──────┐                    │     HTTP/3 (okcronet)         │  fetch / SSE
   Android app    │                    ▼                               ▼
   (Kotlin)       └──────────►  ┌──────────────────────────────────────────────────┐
                                │  undal-core        (Worker 1, TypeScript)        │
   Riders ────────────────────► │  identity · catalog · orders · payments · admin  │
   Android app                  └───────┬──────────────────────────┬───────────────┘
   (Kotlin)                             │                          │
                                        │                          │
   Admin ─────────┐                     ▼                          ▼
   React+Vite SPA │        ┌────────────────────────┐   ┌────────────────────────────┐
                  └──────► │ undal-realtime (W2, TS)│   │ undal-brain (W3, Python)   │
                           │ presence · live loc.   │   │ fare · dispatch · ranking  │
                           │ SSE fan-out · FCM v1   │   │ batching · forecasting     │
                           └────────┬───────────────┘   └─────────────┬──────────────┘
                                    │                                 │
              ┌─────────────────────┴───────┐              ┌──────────┴───────────┐
              ▼                             ▼              ▼                      ▼
   ┌───────────────────┐        ┌────────────────────┐  ┌──────────────┐  ┌──────────────┐
   │ Cloudflare D1     │        │ Durable Objects    │  │ TiDB Cloud   │  │ OSRM (OSM)   │
   │ rider live track  │        │ zone hubs, locks   │  │ system of    │  │ routing      │
   │ (ephemeral)       │        │ SSE hubs           │  │ record       │  │ matrix       │
   └───────────────────┘        └────────────────────┘  └──────────────┘  └──────────────┘

   Media:  imgbb (public images, unlimited)  ·  Cloudinary (KYC documents, invoices — private)
   Wake-up: Firebase Cloud Messaging HTTP v1, data-only, high priority, service-account auth
   CI/CD:  GitHub Actions only. No local CLI. No manual deploy. Signed .apk and .aab from Actions.
```

## The ten things that make Undal different

1. **Undal Brain** — a deterministic, self-tuning decision engine written from scratch. No external AI
   API, no third-party model, no inference bill. It prices every delivery, assigns every rider, batches
   every pair of orders, ranks every vendor, and explains every decision it makes in a replayable trace.
   See [`docs/09-undal-brain-overview.md`](docs/09-undal-brain-overview.md).
2. **A wake-up stack that is honest about Android.** Data-only FCM, high priority, full-screen intent,
   foreground service, alarm-stream looping audio, wake locks, exact-alarm watchdog, OEM autostart
   coaching, and a transparent statement of the one case Android genuinely forbids.
   See [`docs/15-wakeup-alarm-fcm.md`](docs/15-wakeup-alarm-fcm.md).
3. **No advertising. Ever.** Vendors cannot buy position. Ranking is earned through a 10-stage
   performance-and-proximity algorithm. See [`docs/13-ranking-personalization.md`](docs/13-ranking-personalization.md).
4. **Invoices that cannot be wrong.** Integer-paisa arithmetic, a closed-ledger invariant, property-based
   tests, and a reconciliation gate that refuses to emit a PDF that does not balance to zero.
   See [`docs/24-finance-payouts-invoices.md`](docs/24-finance-payouts-invoices.md).
5. **A rider-tracking channel that costs almost nothing.** Device-side 100 m displacement gating,
   adaptive cadence, delta encoding, D1 as a ring buffer, and immediate erasure at shift end.
   See [`docs/07-d1-live-tracking.md`](docs/07-d1-live-tracking.md).
6. **A full-screen command map** showing every rider, vendor and live order on one OSM canvas with
   bespoke SVG markers and a deep-dive inspector. See [`docs/22-admin-super-map.md`](docs/22-admin-super-map.md).
7. **Cash discipline for COD.** End-of-shift settlement lock, selfie proof, bKash TrxID capture,
   and an un-dismissible screen until the admin clears it. See [`docs/25-rider-cash-settlement.md`](docs/25-rider-cash-settlement.md).
8. **Zero seeded data.** The platform boots empty and says so, beautifully, in Bangla and English.
   See [`docs/33-empty-state-doctrine.md`](docs/33-empty-state-doctrine.md).
9. **Browser-only operations.** Every migration, deploy, index, release, keystore and APK comes out of
   GitHub Actions. The maintainer works from an Android tablet.
   See [`docs/28-cicd-github-actions.md`](docs/28-cicd-github-actions.md).
10. **Every file under 700 lines, every line documented.** Enforced by CI, not by good intentions.

## Quick start for a human

1. Read [`docs/01-mission-and-non-negotiables.md`](docs/01-mission-and-non-negotiables.md) (15 minutes).
2. Create the accounts in [`docs/29-secrets-and-configuration.md`](docs/29-secrets-and-configuration.md)
   and paste the secrets into **Settings → Secrets and variables → Actions**.
3. Open [`PROMPT.md`](PROMPT.md), copy the fenced block, and give it to your coding agent.
4. Watch the Actions tab. The first green run deploys three Workers, one Pages site, and the schema.

## Quick start for an AI agent

> Read [`PROMPT.md`](PROMPT.md). It tells you exactly what to read, in what order, and what to build
> in each of the 22 responses. Do not start writing code before response 3.

## Status

| Component | State |
| --- | --- |
| Specification corpus | ✅ Complete — 40 documents, 142,000 words · system of record is TiDB Cloud Starter |
| Secret and config register | ✅ [`.env.example`](.env.example) — 44 secrets, 147 config keys |
| Brand assets | ✅ In repository |
| Alert audio | ✅ `undal_order_alert_loop.wav`, 8.000 s, 44.1 kHz mono |
| Workers, apps, web, admin | ⏳ Not yet built — this is what `PROMPT.md` commissions |

## License

Undal is released under the **Public Availability with Source Code Visibility License (PASVL-1.0)**.
The source is public and readable. **Deployment requires a Letter of Software Deployment Approval
(LOSDA).** See [`LICENSE`](LICENSE) and the canonical text at
<https://github.com/bsdc-info-bd/PASVL_LOSDA>.

```
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
```

---

<div align="center">
<sub><b>Undal</b> — the proud of Bangladesh.</sub>
</div>
