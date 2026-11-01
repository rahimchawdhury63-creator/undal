<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 39 — Risk Register and Truths

> Thirty-eight documents have described what Undal will do. This one describes what it cannot do,
> what will break, what costs money despite the brief saying everything must be free, and what
> was pasted into a chat window and must be rotated before anyone takes a real order.
>
> A specification that only contains good news is a specification that has not been checked.

---

## 1. The honesty rule

Every claim in this corpus is one of three things, and the difference is always marked:

| Kind | Marker | Example |
| --- | --- | --- |
| **Specified and testable** | Stated plainly with its test | "Offline detection p95 ≤ 2 000 ms", proven by a 1 000-loss latency test |
| **Estimated** | Labelled as an estimate with the basis | "~14 MB of data per rider shift", from a traffic model |
| **Unknowable until production** | Labelled as such | "Acceptance rate will likely settle near 0.76" — a simulator output, not a promise |

Nothing in this corpus claims to have been measured on real hardware with real users, because
none of it has. The simulator numbers are simulator numbers.

---

## 2. What is genuinely free, and what is not

### 2.1 Free, with room to spare

| Service | Free tier | Projected use at 500 orders/day | Headroom |
| --- | --- | --- | --- |
| Cloudflare Workers | 100 000 requests/day | ~42 000 | 2.4× |
| Cloudflare Pages | 500 builds/month, unlimited requests | ~120 builds | 4× |
| Cloudflare D1 | 5 M reads, 100 k writes/day | ~27 000 writes | 3.7× |
| Cloudflare KV | 100 k reads, 1 k writes/day | ~38 000 reads, ~400 writes | 2.5× |
| CockroachDB Cloud | 10 GiB storage, 50 M RU/month | ~1.4 GiB, ~31 M RU | 1.6× |
| imgbb | No published limit | ~800 uploads/day | Unknown |
| Cloudinary | 25 credits/month | ~6 credits | 4× |
| GitHub Actions | 2 000 minutes/month (private) | ~1 400 | 1.4× |
| Firebase FCM | Unlimited | — | — |
| OSRM demo server | Fair use | — | **See §3.2** |

### 2.2 **Not free: Durable Objects**

> **This is the single most important honest statement in this corpus, and it has been made in
> [`05 §4.2`](05-system-architecture.md) and is restated here deliberately.**

Durable Objects require the **Workers Paid plan at $5/month**. They are not available on the free
plan, and no amount of architecture avoids that.

Undal's real-time layer — presence hubs, atomic dispatch claims, SSE fan-out — is naturally a
Durable Objects design. So the platform ships **two implementations behind one interface**:

| Mode | `env.COORDINATION_MODE` | Claim latency p50 | Presence detection p95 | Cost |
| --- | --- | --- | --- | --- |
| Durable Objects | `durable-object` | 4 ms | 1.7 s | **$5/month** |
| CockroachDB locks | `cockroach` | 31 ms | 1.9 s | **Free** |

**The platform launches in `cockroach` mode and is fully functional.** Every acceptance criterion
in [`36`](36-acceptance-criteria.md), including the 2-second presence requirement, is met on the
free path. The entire test suite runs against both backends.

What the paid mode buys is 27 ms of dispatch claim latency and a cleaner SSE fan-out at scale. At
500 orders/day the difference is not perceptible. Somewhere above roughly 3 000 orders/day the
`dispatch_locks` table becomes a contention point and the $5 becomes the correct choice. That is
a decision to make with revenue, not before launch.

**No other part of Undal requires payment.** The brief's free-only constraint is met.

### 2.3 Costs that are not software

Worth stating because they are real and the brief does not mention them:

| Item | Approximate cost |
| --- | --- |
| Domain name | $10–15/year |
| Google Play developer account | **$25, one time** — required to distribute on Play at all |
| A self-hosted OSRM instance, if the demo server proves insufficient | $5–20/month for a small VPS |
| Phone numbers for support | Varies |

The Play account is unavoidable for Play distribution. Direct APK distribution is free and is how
riders and vendors will most likely be onboarded first.

---

## 3. Risk register

Severity × likelihood, with the mitigation and the honest residual.

### 3.1 R1 — Force-stop defeats the alarm · **Critical · Certain**

A user who opens Settings → Apps → Undal Partner → Force stop will receive **no FCM messages at
all** until they manually relaunch the app. This is an Android guarantee. There is no API, no
permission and no trick that bypasses it.

Worse: several OEMs common in Bangladesh — Xiaomi, Realme, Infinix, Oppo, Vivo — treat *swiping
the app from recents* as a force-stop under aggressive battery policies.

**Mitigation:** OEM-specific autostart coaching during onboarding with a verification step;
battery-optimisation exemption; a foreground service during active shifts; a device-health screen
with a live self-test; a 7-day re-check; three consecutive delivery failures remove the vendor or
rider from dispatch with an explanation.

**Residual: unavoidable.** Roughly 3% of alarms will not arrive, concentrated on specific OEMs.
The platform's answer is to detect it fast and route around it, not to pretend otherwise.
[`15 §1`](15-wakeup-alarm-fcm.md)

### 3.2 R2 — The public OSRM server · **High · Likely**

`router.project-osrm.org` is a demo service under fair use. It has no SLA, it rate-limits, and it
can disappear. Every distance, duration and route in Undal depends on it.

**Mitigation:** aggressive caching (route geometry by cell pair, 24 h); a haversine × learned
detour-factor fallback within the 400 ms fare budget; `OSRM_BASE_URL` is a secret, so pointing at
a self-hosted instance is a secret change and a redeploy, not a code change; the fallback is
tested as a first-class path, not an afterthought.

**Residual: moderate.** The fallback produces fares within about 8% of routed ones. Self-hosting
OSRM for Bangladesh needs roughly 4 GB of RAM, which is the $5–20/month in §2.3.

### 3.3 R3 — imgbb has no access control · **High · Certain**

An imgbb URL is public to anyone who has it. There are no signed URLs and no expiry.

**Mitigation:** the `MediaKind` enum routes all 15 sensitive kinds to Cloudinary with
`access_mode: authenticated`; `media-destination` CI fails if any call site passes a
non-literal kind; URLs are high-entropy; shift selfies carry a 30-day retention and settlement
selfies 90 days.

**Residual: accepted.** Shift and settlement selfies are on imgbb because Cloudinary's free
credits cannot absorb their volume. A leaked URL exposes one selfie — a real but bounded harm,
documented so the operator knows about it rather than discovering it. [`26 §2`](26-media-pipeline.md)

### 3.4 R4 — CockroachDB free-tier limits · **High · Likely at scale**

10 GiB and 50 M request units per month. At 500 orders/day the platform uses about 1.4 GiB and
31 M RU. At 2 000 orders/day it exceeds the RU limit.

**Mitigation:** every hot query is indexed and reviewed; `brain_traces` has a 7–90 day retention;
`order_state_events` is partitioned with cold partitions archived to R2; read-heavy admin
analytics run against materialised views refreshed on write, not on read.

**Residual: real.** Above roughly 1 500 orders/day the free tier ends. That is a success problem
and CockroachDB's paid tier starts around $25/month.

### 3.5 R5 — GitHub Actions minutes · **Medium · Likely**

The full matrix — 56 600 responsive renders, 275 001 differential vectors, three app builds,
Test Lab — does not fit in 2 000 minutes/month if it runs on every push.

**Mitigation:** tiered CI (guardrails 40 s on every push; the full suite on PRs to `main`; the
heavy matrices nightly); aggressive caching; the repository can be made public, which makes
Actions free entirely — and PASVL-1.0 makes the source public anyway.

**Residual: low.** Making the repository public resolves it, which the licence already implies.

### 3.6 R6 — Cash-only means cash risk · **High · Certain**

Riders carry cash. Cash gets lost, stolen, miscounted and occasionally stolen deliberately.

**Mitigation:** a ৳3 500 exposure cap; the blocking settlement screen; photographic and TrxID
evidence; a 30-minute review SLA; weekly liability capped at ৳300; a fraud-case workflow; the
cash gap tracked as a first-class metric.

**Residual: structural.** Cash-only is the brief's requirement and it is the right call for
Bangladesh. The platform manages the risk rather than eliminating it.

### 3.7 R7 — No OTP means weak account binding · **Medium · Certain**

Without phone verification, a phone number in the system is unverified. Someone can register with
someone else's number.

**Mitigation:** cash on delivery means no stored payment instrument to steal; an unverified number
only affects order contact; rider and vendor accounts go through NID-based KYC, which is far
stronger than an OTP; a duplicate NID is blocking; conduct and fraud workflows cover abuse.

**Residual: accepted by explicit instruction.** [`27 §2.3`](27-security-rbac-audit.md) tables the
consequences honestly. The friction removed is real and, for this market, probably worth it.

### 3.8 R8 — One-person operations · **High · Certain**

A platform with manual payout review, manual KYC, manual settlement approval and manual dispute
handling needs a human available most of the time. The 30-minute settlement SLA is a commitment
made to riders by a person, not a system.

**Mitigation:** the 2-hour auto-lift means a slow review never traps a rider; SLA breaches are
tracked as platform failures rather than hidden; the exception queue is prioritised so the most
urgent item is always first; bulk operations reduce per-item cost.

**Residual: real.** This is an operational truth, not a software problem. It bounds how fast the
platform can grow more than any technical limit in this document.

### 3.9 R9 — Pyodide cold starts · **Medium · Possible**

Python on Workers runs under Pyodide, whose cold start can reach 500 ms — beyond the 400 ms fare
budget.

**Mitigation:** every engine has a tested fallback inside its budget; the Brain is kept warm by
ordinary traffic; the hot path is pure arithmetic with no heavy imports; if cold starts prove
unacceptable, the fare and dispatch engines are small enough to port to TypeScript, with the
differential test guaranteeing identical results.

**Residual: low**, with a clear escape hatch.

### 3.10 R10 — Three deterministic engines are not magic · **Medium · Certain**

Undal's Brain is good arithmetic over well-chosen features. It is not a learned model and it will
not discover anything surprising. Its dispatch numbers come from a simulator built on assumptions
that may be wrong.

**Mitigation:** every decision is traced and replayable; the Brain Lab requires replaying any
weight change against 500 real decisions; the nightly benchmark fails on a >5% regression;
calibration is measured and reported.

**Residual: honest.** The engines will need tuning against reality. The infrastructure for that
tuning is the actual deliverable, and it is better than the initial weights.

### 3.11 R11 — Free tiers can change · **Medium · Possible**

Every service here can alter its terms. Cloudflare has changed Workers' limits before; imgbb
could introduce quotas tomorrow.

**Mitigation:** no provider-specific logic outside a thin adapter; media routing is one enum;
the database is standard PostgreSQL; routing is one HTTP interface; the only genuinely
hard-to-replace dependency is Cloudflare Workers itself.

**Residual: accepted.** Building on free tiers is the brief's constraint and this is its cost.

### 3.12 R12 — The 2-second presence guarantee depends on the network · **Medium · Likely**

p95 ≤ 2 000 ms is measured from the server's perspective. A phone on a congested 3G cell in a
basement kitchen may have a transport close that takes longer to observe.

**Mitigation:** the 750 ms heartbeat catches silent failures; the 1 500 ms grace prevents flap;
the vendor escalation ladder is 120 seconds, far longer than any plausible detection delay, so
detection jitter never causes a wrong auto-cancel.

**Residual: low.** The guarantee is about server-side detection and the ladder absorbs the
variance.

### 3.13 R13 — 283 screens is a lot of surface · **Medium · Certain**

Four thousand features across seven surfaces in twenty build responses will contain bugs. Some
will be in money.

**Mitigation:** 100% line and branch coverage on money and ledger code; 10 000-case closure
testing; 275 001 differential vectors; the empty-platform test; 56 600 responsive renders; zero
flaky tests tolerated.

**Residual: certain.** The question is not whether bugs ship but whether money bugs ship. The
coverage is concentrated where the damage is.

### 3.14 R14 — Credentials were pasted into a chat window · **Critical · Certain**

> **This is not hypothetical. It already happened, during the conversation that produced this
> corpus.**

The following were typed into a chat interface and must be treated as **compromised**:

| Credential | Action required **before launch** |
| --- | --- |
| CockroachDB connection string, including the password for user `undal` | **Rotate the password.** Cloud console → SQL Users → change password |
| The imgbb API key | **Revoke and reissue** |
| The bKash payout number | Not secret in the same way, but review who knows it; the payout number is the platform's highest fraud-risk identifier |
| Any Firebase service-account JSON, OAuth client secret, QR signing secret or admin password discussed | **Rotate every one** |

Chat transcripts are stored, may be logged, and may be used for training. A credential that has
been in one is public.

**Mitigation:** every credential in this corpus is referenced **only** by its secret name, never
by value; `secret-scan` fails the build on a committed credential; [`29 §8.1`](29-secrets-and-configuration.md)
carries this as a standing instruction.

**Residual: entirely in the developer's hands.** Rotate before the first real order.

### 3.15 R15 — Play Store policy for full-screen alarms · **Medium · Possible**

`USE_FULL_SCREEN_INTENT` is restricted on Android 14+ to calling, alarm and clock apps. Google
reviews the declaration.

**Mitigation:** the `specialUse` foreground-service justification and the full-screen-intent
declaration are written out verbatim in [`28 §6.3`](28-cicd-github-actions.md), framed around the
genuine case — a time-critical work alarm for a worker whose livelihood depends on hearing it.
Path B (a high-importance notification with a looping sound) is implemented and tested as a full
fallback if permission is refused.

**Residual: moderate.** Approval is not guaranteed. The product works without it, less well.

### 3.16 R16 — The documentation can be wrong · **Low · Certain**

This corpus contains hundreds of numbers computed by hand. [`24 §2.3`](24-finance-payouts-invoices.md)
already records one: the tax lines in doc 10's forty worked vectors and doc 06 §8.2 were drafted
with a taxable base that wrongly included the rider bonus.

**Mitigation:** the invariants in [`24 §2.3`](24-finance-payouts-invoices.md) are declared
authoritative over any printed figure anywhere else; `ledger-closure` is the arbiter;
[`35 §8`](35-execution-plan.md) tells the building agent exactly what to do on a contradiction —
recompute from the formulas, fix the document, report it.

**Residual: managed.** Documents drift; tests do not.

---

## 4. Scale thresholds

Where the architecture stops being appropriate, stated so nobody is surprised:

| Orders/day | What breaks first | Response |
| --- | --- | --- |
| 500 | Nothing | Launch configuration |
| 1 500 | CockroachDB RU | Paid tier, ~$25/month |
| 3 000 | `dispatch_locks` contention | Workers Paid, $5/month, switch to `durable-object` |
| 5 000 | Workers free requests | Workers Paid covers it |
| 10 000 | D1 writes; single-zone dispatch latency | D1 paid; shard dispatch by zone |
| 25 000 | Pre-rendering 20 000+ pages per build | Hybrid: pre-render the top pages, SSR the long tail |
| 50 000 | Manual payout review; one-person operations | A finance team, not a code change |

Every threshold except the last is a configuration change costing tens of dollars. The last one
is the real ceiling.

---

## 5. What Undal deliberately will not do

Restated from [`27 §8`](27-security-rbac-audit.md), because it belongs in the final document too:

| Not done | Why |
| --- | --- |
| Background location | A rider's location is tracked only during a shift, only while an order is live |
| Location history | Positions are deleted at shift end, not archived |
| Third-party analytics, SDKs or session recording | Zero third-party scripts anywhere |
| Selling or sharing data | Not a business model here |
| Advertising, CPC, sponsored placement or paid ranking | Structurally impossible by the anti-ad invariant |
| Advertising identifiers | Not collected |
| Contacts, microphone or SMS access | Not requested |
| Shadow profiles | No record of a non-user |
| Dark patterns in cancellation or deletion | Deleting an account takes one screen |
| Gamifying speed | No rider is rewarded for riding faster |
| Hiding fees | Every line expands into its derivation |

---

## 6. The five things most likely to go wrong first

Ranked by probability × pain, for the person who has to run this:

1. **A vendor force-stops the Partner app and misses orders.** Onboarding coaching is the
   defence and it will not be perfect. Watch the device-health dashboard daily for the first
   month.
2. **The OSRM demo server rate-limits during an evening peak.** The fallback works, fares drift
   about 8%, nobody notices immediately. Have a self-hosted instance ready before scaling.
3. **A rider's settlement sits unreviewed for two hours and auto-lifts.** The platform handles it
   correctly; it still means an unreviewed cash position. The 30-minute SLA is a human promise.
4. **The first payout run finds a reconciliation mismatch.** It is designed not to close until
   resolved, which is correct, and it will cost an evening the first time.
5. **A Bengali string overflows on a 320 px screen that was only checked in English.** The
   pseudolocale pass catches most of it, not all.

---

## 7. The closing truth

This corpus specifies a platform that one person can build, deploy and run from an Android tablet
using only free services, that handles real money with double-entry accounting, that wakes a
killed phone, that makes dispatch decisions it can explain, and that cannot be made to sell
search ranking.

It does not specify a platform that will work perfectly on day one. It specifies one whose
failures are visible, bounded, logged and recoverable — which, for a system that handles other
people's money and other people's dinners, is the more valuable property.

Build it in order. Test the money twice. Rotate the credentials.

---

## 8. Reading on

This is the end of the corpus. Return to [`00-INDEX.md`](00-INDEX.md), or to
[`35-execution-plan.md`](35-execution-plan.md) to begin.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
