<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 38 — Glossary

> Every term this corpus uses with a specific meaning, defined once. When a document uses one of
> these words, it means exactly this and nothing looser.

---

## A

**`apply_rate(amount, bps)`** — The single rounding function in the platform. Integer-only,
banker's rounding (ties-to-even). Implemented byte-identically in Python, TypeScript and Kotlin
and verified by a 110 000-vector differential test. [`10 §3`](10-fare-engine-math.md)

**Anti-ad invariant** — The CI-enforced property that no monetary quantity is reachable from
`RankInput`, making it structurally impossible for a vendor to pay for position.
[`13 §1`](13-ranking-personalization.md)

**App Link** — An Android-verified HTTPS deep link that opens the app rather than the browser,
authenticated by `/.well-known/assetlinks.json`. [`31 §9`](31-seo-prerender-deeplinks.md)

**Audit chain** — The SHA-256 hash chain over `audit_log` rows that makes tampering detectable.
[`27 §4.2`](27-security-rbac-audit.md)

---

## B

**Batch / bundle** — Two or three orders carried on one trip. Formed only when a detour budget
proves no customer waits past their promised ETA. [`12`](12-batching-engine.md)

**bps** — Basis points. One hundredth of a percent. Every rate in the platform is an integer
number of bps: 15% commission is `1500`.

**Brain** — Undal's own decision system: five deterministic engines over one feature store. Not a
large language model and not an external API. [`09`](09-undal-brain-overview.md)

**Brain Lab** — The admin surface for editing engine weights, which requires a replay against
real recent decisions before a change can be saved. [`21 §4`](21-admin-panel.md)

---

## C

**Cash in hand** — `RIDER_CASH:{id}`, the live ledger figure for money a rider has collected and
not yet settled. Capped at ৳3 500 by default. [`11 §8`](11-dispatch-engine.md)

**`CASH_LOCKED`** — The shift state in which a rider cannot go online until an admin approves
their settlement. [`25`](25-rider-cash-settlement.md)

**Cell** — A 500 m grid square, the unit of demand forecasting and area familiarity.

**Closure** — The property that every ledger posting set sums to exactly zero. Asserted before
commit, at invoice generation, and by a 10 000-case property test.
[`24 §1`](24-finance-payouts-invoices.md)

**Cold start** — The decaying visibility boost given to a vendor for 21 days or 25 rated orders.
Not purchasable, not extendable, and not regained by re-registering.
[`13 §10`](13-ranking-personalization.md)

**Content hash** — The SHA-256 of an invoice's canonical representation. Regenerating an invoice
must reproduce it exactly. [`24 §4.3`](24-finance-payouts-invoices.md)

**Coordinator** — The abstraction over atomic dispatch claims, with two implemented backends:
`durable-object` (paid, 4 ms) and `sql` (free, 10–80 ms estimated — see [`39 §2.2`](39-risk-register-and-truths.md)).
[`05 §4.2`](05-system-architecture.md)

---

## D

**D1** — Cloudflare's SQLite service, used in Undal for **rider real-time location only**.
[`07`](07-d1-live-tracking.md)

**Data-only message** — An FCM payload containing no `notification` key, so the app's own code
runs and controls the alarm rather than the OS rendering a tray notification.
[`15 §2.1`](15-wakeup-alarm-fcm.md)

**Detour budget** — The maximum extra time a bundled customer may wait: 420 s normally, 210 s for
temperature-critical items. [`12 §4`](12-batching-engine.md)

**Detour factor** — The learned per-zone ratio of routed distance to straight-line distance.
About 1.31 in Sylhet.

**Dispatch cascade** — The sequence of offer waves sent to ranked riders, first valid claim
winning. [`11 §7`](11-dispatch-engine.md)

**Durable Object (DO)** — A Cloudflare primitive giving single-threaded consistency at a named
location. Requires the paid Workers plan, hence the dual-backend design.

---

## E

**Empty state** — A designed screen shown when there is nothing to show. Never an error, always
specific, always actionable. Forty-four of them. [`33`](33-empty-state-doctrine.md)

**`eta_fit`** — The dispatch factor that peaks when a rider would arrive 0–120 s before the food
is ready, and decays asymmetrically either side. [`11 §5.1`](11-dispatch-engine.md)

**EWMA** — Exponentially weighted moving average. Undal uses **time-based** half-lives (72 h for
speeds, 168 h for prep, 336 h for detour, 504 h for demand) rather than sample counts, so a
vendor's old behaviour decays even if they are quiet.

**Exception** — An automatically raised operational alert with a severity, an SLA and an owner.
Twenty-two triggers. [`21 §8.1`](21-admin-panel.md)

**Expansion ladder** — The six escalating steps taken when no rider accepts an order, ending in a
cancellation only after 480 seconds. [`11 §11`](11-dispatch-engine.md)

---

## F

**Fairness factor** — The dispatch term that favours idle riders and riders with fewer deliveries
today. It costs 38 seconds of mean assignment time and halves the earnings Gini.
[`11 §5.2`](11-dispatch-engine.md)

**FCM v1** — Firebase Cloud Messaging's current HTTP API, authenticated by a service-account JWT.
The legacy server key is absent from the platform entirely.

**Feasibility proof** — The machine-checkable JSON record proving a bundle satisfies constraints
C1–C10, re-validated at accept time. [`12 §5`](12-batching-engine.md)

**Flash Box** — A vendor-funded 25% discount campaign. A discount, not an advertising slot.

**`floor_to_taka`** — The single rounding of the customer's total down to a whole taka. The delta
(always in `[−99, 0]`) is absorbed by `PLATFORM:EXPENSE_ROUNDING`.

---

## G

**Geofence** — The 150 m radius around a vendor inside which a pickup QR scan is accepted.

**Gini coefficient** — The inequality measure used to report rider earnings distribution. 0.41
under nearest-rider dispatch; 0.19 under Undal's.

**Guardrail** — One of the 28 named CI jobs that enforce a rule from this corpus. Each ships with
a fixture proving it can fail. [`28 §3.1`](28-cicd-github-actions.md)

---

## H

**Handover time** — The learned per-cell time a rider spends at a door. Default 165 s, clamped to
`[90, 420]`.

**Heartbeat** — The 750 ms client ping against a 2 000 ms server deadline that detects a silently
broken network. [`14 §3`](14-presence-and-heartbeat.md)

---

## I

**Idempotency key** — A client-generated token making a mutating request safe to retry. Persisted
across process death so a retry after a crash is still idempotent.

**imgbb** — The free image host used for **everything public**. It has no access control, which is
exactly why nothing private may go there. [`26`](26-media-pipeline.md)

---

## L

**Lakh / crore** — South Asian digit grouping. 100 000 is written `1,00,000` and 10 000 000 is
`1,00,00,000`. Implemented in-platform rather than relying on the device's ICU version.
[`32 §4.2`](32-localization-and-currency.md)

**Landmark** — A mandatory address field. In Bangladesh it is how a courier actually finds a
door.

**LOSDA** — Letter of Software Deployment Approval. Required by PASVL-1.0 before deploying this
source.

---

## M

**MMR** — Maximal Marginal Relevance, the diversity re-ranking that stops the top ten being ten
biriyani restaurants. [`13 §11`](13-ranking-personalization.md)

**MediaKind** — The enum that determines an upload's destination. There is no API to choose a
destination directly. [`26 §1`](26-media-pipeline.md)

---

## O

**Okronet** — An OkHttp-API-compatible HTTP client backed by Cronet, giving HTTP/3 and QUIC. Its
engine initialisation is moved off the critical path because an ~800 ms P90 engine build would
eat the entire 0-RTT advantage. [`16 §5`](16-android-foundation.md)

**OSRM** — Open Source Routing Machine, used over OSM data for all distance, duration and route
geometry.

---

## P

**Paisa** — One hundredth of a taka, and the **only** monetary unit in the system. Stored as
`INT8`, carried in a Kotlin value class, never a float, never a decimal.

**PASVL-1.0** — Public Availability with Source Code Visibility License. The source is public;
deployment requires a LOSDA. SPDX: `LicenseRef-PASVL-1.0`.

**Posting** — One line of a double-entry ledger transaction. Debit positive, credit negative.

**Presence** — Whether a vendor or rider device is currently reachable. Detected within 2 seconds
without cron or polling. [`14`](14-presence-and-heartbeat.md)

**Prep accuracy** — A vendor's EWMA over `|promised − actual|` prep time, mapped to `[0, 1]`.
Being late is penalised at twice the rate of being early.

**Pre-warm** — Running dispatch candidate generation and scoring speculatively at `PLACED`, before
vendor acceptance, so an accept produces an offer in ~310 ms.

---

## Q

**QR handover** — The pickup confirmation: the rider scans a rotating HMAC-signed code on the
vendor's screen, within 150 m, within 4 hours. [`18 §4`](18-partner-app.md)

**Quote** — A five-minute price commitment. The server re-prices at placement and returns a diff
on mismatch rather than silently re-charging.

---

## R

**`RankInput`** — The frozen dataclass defining everything the ranking engine may see. It has no
monetary field, and CI fails if one appears.

**Reason code** — A controlled-vocabulary justification required for 94 sensitive actions, so
reasons can be analysed rather than just read.

**Ride core** — The pre-margin delivery cost: surged base, plus distance beyond the included
2 000 m, plus traffic compensation. Every other delivery figure derives from it.

---

## S

**SDR** — Supply-Demand Ratio: `active_riders / active_orders` in a zone. The surge input. Below
0.5 means riders are scarce.

**Shift** — A rider's working session, opened by a verified selfie and closed by cash settlement.
The only period during which any location is stored.

**Small-order fee** — ৳25 on orders above ৳100 post-discount (৳20 on pickup), split ৳5 rider,
৳5 vendor, ৳15 platform.

**Staleness ladder** — The four-step degradation of a rider marker as its position fix ages, so a
stale position is never presented as live. [`07 §11`](07-d1-live-tracking.md)

**Step-up auth** — Fresh TOTP required within 5 minutes for 23 sensitive admin actions.

**Surge** — A multiplier on the **base fare only**, derived from SDR through a continuous curve
with ±0.05 linear ramps bridging the brief's bands so the function cannot be gamed at a cliff.
Capped at 2.2× server-side. [`10 §4`](10-fare-engine-math.md)

---

## T

**Taxable base** — `commission + platform_delivery_margin + small_order_platform`, and nothing
else. The 5% tax is levied on the platform's own fee revenue, not on the vendor's sales.
[`24 §2.3`](24-finance-payouts-invoices.md)

**Trace** — The complete JSON record of a single Brain decision: inputs, weights, intermediate
values and outcome. Retained 7–90 days by engine and replayable.

**Trial balance** — The sum of every posting across the ledger. It must be zero. A non-zero
result raises a CRITICAL exception.

**TrxID** — A bKash transaction identifier. Unique across the entire settlement history; a reused
one is rejected immediately.

---

## U

**`UNREACHABLE`** — The vendor state entered 10 seconds after an unacknowledged order. An
unreachable vendor is hidden from ranking, because every order sent to one becomes a guaranteed
failure. [`14 §4.1`](14-presence-and-heartbeat.md)

---

## W

**Wave** — A group of riders offered an order simultaneously, sized so the group has a ≥ 90%
chance of producing at least one acceptance. [`11 §7`](11-dispatch-engine.md)

**Weather premium** — 20% (rain), 40% (storm) or 15% (extreme heat) of ride core, paid to the
rider **by the platform**. The customer's bill is never affected. Gated off when weather
confidence is below 0.5.

**Wilson lower bound** — The confidence-adjusted rate used for every ranking and dispatch rate
feature, so 1-of-1 scores 0.21 rather than 1.00.

**WORM** — Write Once, Read Many. The audit log's property, enforced by a trigger, by database
grants, and by a hash chain.

---

## Bengali and Bangladeshi terms

| Term | Meaning |
| --- | --- |
| **৳ / টাকা (taka)** | The currency. 1 taka = 100 paisa |
| **bKash / বিকাশ** | The dominant mobile financial service; Undal's primary payout and settlement rail |
| **Nagad / নগদ** | A second mobile financial service |
| **NID** | National Identity Document. 10, 13 or 17 digits |
| **Mohalla / মহল্লা** | Neighbourhood. The `area` field in an address |
| **Upazila / উপজেলা** | Sub-district. Used as a zone-template boundary |
| **Kacchi / কাচ্চি** | Slow-cooked mutton biriyani; the single most-ordered dish category in the region |
| **Tehari / তেহারি** | Beef rice dish |
| **Morog polao / মোরগ পোলাও** | Chicken pulao |
| **Borhani / বোরহানি** | A spiced yoghurt drink served with biriyani |
| **Iftar / ইফতার** | The evening meal breaking the Ramadan fast; a major demand spike |
| **Pohela Boishakh / পহেলা বৈশাখ** | Bengali New Year |
| **Satkora / সাতকরা** | A Sylheti citrus used in curries; a regional speciality tag |
| **Shutki / শুঁটকি** | Dried fish; a regional speciality tag |
| **Fuchka / ফুচকা** | Street snack, also written phuchka or panipuri |

---

## Conventions used throughout this corpus

| Convention | Meaning |
| --- | --- |
| **must** | A requirement. Its absence is a defect |
| **never** | A prohibition enforced by a test or a CI job |
| Money in tables | Paisa when a column says paisa, taka with the ৳ symbol otherwise |
| `code font` | A literal identifier in the codebase |
| **Bold** in a table | The decisive value in that row |
| A section reference like [`10 §12.1`](10-fare-engine-math.md) | Document 10, section 12.1 |
| A count given as a specific number | Taken from a machine-checked register ([`37 §6`](37-feature-register.md)) |

---

## Reading on

Next: [`39-risk-register-and-truths.md`](39-risk-register-and-truths.md) — the last document, and
the most honest one.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
