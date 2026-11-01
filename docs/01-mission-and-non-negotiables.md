<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 01 — Mission and Non-Negotiables

---

## 1. What Undal is

**Undal — Food & Groceries** is an on-demand, real-time, cash-on-delivery, multi-vendor food delivery
and pick-up platform for Bangladesh.

It connects four kinds of people:

| Actor | What they do | Surface |
| --- | --- | --- |
| **Customer** | Browses nearby vendors, orders food or groceries, pays the rider in cash on arrival, or collects the order themselves | Android app, web storefront |
| **Partner** | A restaurant, home kitchen, cloud kitchen or grocery store that receives orders, sets a preparation time, cooks, and hands the bag to a rider | Android app |
| **Rider** | A motorbike or bicycle courier who collects the order, delivers it, takes the cash, and settles that cash at end of shift | Android app |
| **Admin** | The Undal operations team: onboarding, dispatch supervision, finance, disputes, zones, and the command map | Web panel |

The name is the bird in the logo — a small, cheerful courier with a bindle over its shoulder. The
customer mark is the bird with a cap. The partner mark gives it a chef's hat and a wisp of steam. The
rider mark puts it on wheels with a helmet and speed lines. One character, three roles. That is the
whole brand idea, and every screen should feel like it belongs to that bird.

---

## 2. What Undal is for

Bangladesh's food-delivery market is dominated by platforms that monetise visibility. A restaurant
that pays more appears higher. A restaurant that cannot afford to pay disappears. Customers pay for
that auction twice: once in inflated menu prices, once in worse recommendations.

**Undal does not sell position.** There is no advertising product, no cost-per-click, no sponsored
placement, no "boost". Ranking is earned, entirely, through a ten-stage algorithm built from
proximity, measured performance, and the individual customer's own history. A new home kitchen with
genuinely fast preparation and genuinely good ratings will out-rank a chain that has been coasting.
This is the product's central ethical commitment and
[`13-ranking-personalization.md §2`](13-ranking-personalization.md) makes it structurally impossible
to violate: there is no column in the schema that money could be written into to change rank order.

The second commitment is to the riders. Rider payouts in this market are frequently opaque. Undal's
fare engine is published in full in [`10-fare-engine-math.md`](10-fare-engine-math.md), every rider
sees the breakdown of every single delivery before accepting it, and the weekly invoice reproduces
the arithmetic line by line. A rider can check Undal's maths with a calculator and it will agree,
every time, to the paisa.

The third commitment is to run all of this on **zero infrastructure spend**. Not as a stunt — as a
design discipline. A platform that costs nothing to run can survive its first year without
investors, which means it can keep the first two commitments.

---

## 3. The complete money model

Every number below is normative. [`10-fare-engine-math.md`](10-fare-engine-math.md) turns them into
formulas and test vectors; this section is the plain-language source of truth.

### 3.1 What the customer pays

| Line | Rule |
| --- | --- |
| **Item subtotal** | Sum of menu prices × quantities, plus selected modifiers. Menu prices are vendor-set and are the same for delivery and pick-up. |
| **Delivery fee** | Computed by the fare engine from distance, time, traffic, weather, and supply–demand. Zero for pick-up orders. |
| **Small-order fee** | **৳25, fixed**, applied when the **item subtotal is ৳100 or more** — see §3.2 for the exact reading of this rule. |
| **Tax** | **5%**, applied on the platform's taxable base. See §3.4. |
| **Discounts** | Promo codes, vendor campaigns, and the Undal Flash Box (§3.5), subtracted before tax on the discounted portion. |
| **Tips** | Optional, cash, 100% to the rider, never touched by commission or tax. |
| **Total payable in cash** | Subtotal + delivery fee + small-order fee + tax − discounts + tip. Rounded to the nearest ৳1 at the very last step, with the rounding delta absorbed by the platform (§3.6). |

### 3.2 The small-order fee, stated precisely

The brief says: *"the undal charge small order fee for the order above 100 taka, 25 taka fixed order
amount fee, the rider will get 5 taka from it and vendor get 5 taka also."*

Read literally and implemented literally:

```
IF item_subtotal_paisa >= 10_000 THEN
    small_order_fee_paisa = 2_500          -- ৳25 flat
    rider_share_paisa     =   500          -- ৳5 to the delivering rider
    vendor_share_paisa    =   500          -- ৳5 to the vendor
    platform_share_paisa  = 1_500          -- ৳15 retained by Undal
ELSE
    small_order_fee_paisa = 0
END IF
```

Three properties are enforced by test:

1. The three shares **sum exactly** to the fee. `500 + 500 + 1500 = 2500`. There is a property test
   that asserts this for every possible fee configuration.
2. The rider's ৳5 and the vendor's ৳5 are **additions to their payouts**, not deductions from the
   customer's other lines. They flow through the ledger as `SMALL_ORDER_FEE_RIDER_SHARE` and
   `SMALL_ORDER_FEE_VENDOR_SHARE` postings.
3. On a **pick-up** order there is no rider. The rider's ৳5 is **not** charged to the customer: the
   fee becomes ৳20, split ৳5 vendor / ৳15 platform. The customer must never be charged for a
   participant who does not exist. This is the kind of case the brief means by *"the undal will
   smartly cover all the possible cases"*.

The threshold is held in `platform_config.small_order_threshold_paisa` and is admin-editable with a
full audit trail, because a fixed constant in a source file is a constant the business cannot change
at 9 p.m. on a Friday.

### 3.3 What the vendor pays

| Line | Rule |
| --- | --- |
| **Commission** | **15%** of the item subtotal, after vendor-funded discounts, before tax. |
| **Monthly listing fee** | **None. Zero. Never.** There is no `subscription` table and no code path that could create one. |
| **Advertising** | Does not exist. See §4, rule 11. |
| **Rider bonus contribution** | **3%** of the order's item subtotal, funding the rider's per-order bonus (§3.7). Charged to the vendor, never to the customer. |
| **Campaign cost** | If the vendor opts into the Undal Flash Box (§3.5), the discount is vendor-funded. |
| **Small-order fee share** | The vendor **receives** ৳5 (§3.2). This is a credit, not a charge. |

Commission is configurable **per vendor** (`vendors.commission_bps`, default `1500` basis points) so
that negotiated rates, launch promotions, and category-specific economics are expressible without a
code change. The default is 15% and the admin UI shows a warning banner whenever a vendor is set
below 1000 bps or above 2500 bps.

### 3.4 Tax

**5%** is applied to the **platform's revenue base**, not to the customer's whole basket. The taxable
base is:

```
taxable_base = commission
             + platform_share_of_small_order_fee     (৳15 of the ৳25)
             + platform_delivery_margin              (the delivery fee minus the rider's payout)
```

**Pass-throughs are excluded**, because taxing money that merely moves through Undal would be both
wrong and expensive: the rider's ৳5 and the vendor's ৳5 of the small-order fee, the 3% rider bonus
the vendor funds and the rider receives in full, and tips are all outside the taxable base. The test
suite asserts this with a property: for any order, `tax_paisa` depends only on the three terms above.

VAT on the food itself is the vendor's own obligation under their BIN, and Undal records it on the
invoice as an informational line rather than collecting it. The tax rate lives in
`platform_config.tax_bps = 500` and is zone-overridable, because
[`21-admin-panel.md §6`](21-admin-panel.md) specifies multi-region support and a future second
country will not share Bangladesh's rate.

### 3.5 The Undal Flash Box

A vendor-funded campaign mechanic, equivalent in shape to the "mystery box" promotions customers
already recognise, but with the economics made explicit:

- The vendor opts in and chooses a discount depth: **15%, 20% or 25%** off the item subtotal.
- It is **vendor-funded in full**. Undal contributes nothing and takes commission on the
  *post-discount* subtotal, so the vendor is not taxed on revenue it did not receive.
- Budget caps: the vendor sets a daily budget in taka and a maximum number of redemptions. When
  either is exhausted the campaign auto-pauses, instantly, across every surface.
- A Flash Box can never be stacked with a platform promo code. The engine applies whichever is better
  for the customer and says so in the cart: *"Flash Box saved you more — promo code not applied."*

### 3.6 Rounding

The final customer total is rounded **down to the whole taka**, because riders carry cash and no one
in Bangladesh wants to hand over 37 paisa. Rounding down rather than to-nearest means the customer is
never charged a paisa more than the arithmetic produced — the rule is trivially explainable and
always in the customer's favour. The delta — at most 99 paisa — is posted to a
`PLATFORM:EXPENSE_ROUNDING` ledger account. It is never silently dropped, because a
silently dropped paisa is an invoice that does not balance, and
[`24-finance-payouts-invoices.md §3`](24-finance-payouts-invoices.md) refuses to emit an invoice that
does not balance to exactly zero.

Every other monetary quantity in the system — line items, fees, commissions, payouts — is computed in
exact paisa with **banker's rounding at the single point of division**, specified in
[`10 §3.4`](10-fare-engine-math.md).

### 3.7 What the rider earns

| Line | Rule |
| --- | --- |
| **Base fare** | ৳40 for motorbike, ৳25 for bicycle, covering the first 2 km. |
| **Distance** | **৳14/km (motorbike)**, **৳8/km (bicycle)**, applied to routed distance beyond 2 km. |
| **Surge** | 1.0× to 2.2× on the base, from the supply–demand ratio. |
| **Weather premium** | +20% in rain, +40% in storm, +15% in extreme heat. |
| **Traffic compensation** | A per-5-minute factor that protects taka-per-hour. |
| **Batch bonus** | A marginal multi-order bonus when two or more orders are bundled. |
| **Per-order bonus** | **3% of the order subtotal**, funded by the vendor, never by the customer. |
| **Small-order fee share** | ৳5 when the fee applies. |
| **Tip** | 100%, in cash, in the rider's hand. |
| **Penalties** | Only for defined, appealable events — see [`19-rider-app.md §14`](19-rider-app.md). |

The full algebra, including the exact surge bands, the traffic function, the batch adjustment, and
the floor guarantee that a rider never earns less than base fare for a completed delivery, is
[`10-fare-engine-math.md`](10-fare-engine-math.md). Forty worked vectors are in `10 §12`.

### 3.8 Settlement calendar

| Who | Invoice generated | Why that day |
| --- | --- | --- |
| **Riders** | **Friday** | Friday is the weekend in Bangladesh. Riders are paid on their day off. |
| **Vendors** | **Saturday** | The second weekend day, so vendor finance and rider finance never contend for the same admin attention. |

Payment rail, in order of Undal's preference: **bKash Send Money** (recommended), **Nagad**, **bank
transfer** where applicable. Cash-out charges on vendor and rider payouts are borne by Undal when
paying out, and by Undal when riders settle cash in (§3.9) — the rider never pays to give Undal its
own money.

Generation is **not a cron job**. [`24 §4`](24-finance-payouts-invoices.md) specifies a
request-triggered, idempotent, catch-up period engine that produces the identical result whether it
first runs at 00:01 Friday or 14:30 the following Tuesday.

### 3.9 Cash coming back

Riders collect cash all shift. At end of shift the Undal Rider app presents a settlement screen that
**cannot be dismissed**, accompanied by a soft recurring tick, until the rider has:

1. Taken a live selfie (front camera, liveness-gated) — uploaded to imgbb;
2. Entered the bKash **Transaction ID** of the Send Money to Undal's number;
3. Attached a screenshot of the bKash confirmation, if available — uploaded to imgbb;
4. Confirmed the sending number and the name on it;
5. Submitted.

Undal's bKash number comes from the `UNDAL_BKASH_PAYOUT_NUMBER` Actions secret and is never
hardcoded. Until an admin approves the submission, the rider cannot start another shift. The complete
specification, including the anti-fraud checks and the partial-settlement path, is
[`25-rider-cash-settlement.md`](25-rider-cash-settlement.md).

---

## 4. The forty non-negotiables

These are the rules the build cannot violate. Each one is enforced either by a CI job or by a
structural property of the design. The "Enforced by" column names the mechanism.

### Engineering discipline

| # | Rule | Enforced by |
| --- | --- | --- |
| 1 | **No CLI, no local machine.** Every build, test, migration and deploy runs in GitHub Actions and is startable from a browser. | No `Makefile`, no `scripts/deploy.sh`; every workflow has `workflow_dispatch` — job `no-local-tooling` |
| 2 | **No placeholders.** No `TODO`, `FIXME`, `XXX`, `NotImplementedError`, `throw new Error("unimplemented")`, or empty function body in shipped code. | Job `no-placeholders` greps the full tree excluding `**/test/**` |
| 3 | **No demo or seed data.** No fixture reaches a production code path. | Job `no-seed-data`; `scripts/check_no_seed.py` |
| 4 | **No secrets in the repository.** | Job `secret-scan` (gitleaks ruleset, plus a bespoke pattern list for TiDB URLs, imgbb keys, Cloudinary URLs and Firebase private keys) |
| 5 | **No file over 700 lines.** | Job `line-budget` |
| 6 | **Every exported symbol documented.** | Job `doc-coverage`, ≥ 98% required |
| 7 | **Money is integer paisa.** No float arithmetic in any money path. | Job `money-integrity`; AST-level check, not a regex |
| 8 | **Free tier only.** No dependency on a paid service. | Job `dependency-licence-and-cost` against an allowlist |
| 9 | **Deterministic builds.** Lockfiles committed; no floating version ranges. | Job `lockfile-drift` |
| 10 | **Green main.** `main` is never left failing; the build branch merges only on green. | Branch protection |

### Product promises

| # | Rule | Enforced by |
| --- | --- | --- |
| 11 | **No advertising, ever.** No sponsored placement, no CPC, no paid rank. | No schema column exists that can influence rank; job `anti-ad-invariant` asserts the ranking input vector contains no monetary field |
| 12 | **No monthly listing fee.** | No `subscriptions` table; job asserts absence |
| 13 | **Cash on delivery only** at launch; the ledger is gateway-ready but no gateway is wired. | [`24 §12`](24-finance-payouts-invoices.md) |
| 14 | **The customer is never charged for a cost that is not theirs.** Vendor-funded bonuses and rider bonuses never appear on a customer bill. | Job `customer-bill-purity` |
| 15 | **Every rider sees every taka before accepting.** The offer card shows the full breakdown. | [`19 §7`](19-rider-app.md); UI test |
| 16 | **Every invoice balances to exactly zero.** | Job `ledger-closure`; property test over generated weeks |
| 17 | **Empty means empty.** Zero vendors renders a designed empty state, not a spinner and not a crash. | [`33`](33-empty-state-doctrine.md); 44 empty-state screenshot tests |
| 18 | **No dark patterns.** No pre-ticked tips, no hidden fees, no fake urgency, no countdown that resets. | Design review checklist in [`36 §9`](36-acceptance-criteria.md) |
| 19 | **Bangla first-class.** Every string is translated; no English-only screen. | Job `i18n-completeness` at 100% |
| 20 | **Attribution preserved.** OSM credit on every map surface. | Job `osm-attribution` |

### Realtime and reliability

| # | Rule | Enforced by |
| --- | --- | --- |
| 21 | **An order reaches the partner in under 2 seconds**, measured from `POST /orders` acknowledgement to FCM dispatch. | Job `latency-budget` against the staging worker; p99 asserted |
| 22 | **Data-only FCM.** No `notification` key is ever sent in any payload to the Partner or Rider apps. | Job `fcm-payload-purity` inspects every call site |
| 23 | **The alarm loops until acknowledged**, on alarm stream, over Do Not Disturb where policy allows. | Instrumented Android test on an emulator with the app swiped away |
| 24 | **Offline is detected within 2 seconds** and the actor's state flips automatically. | [`14 §3`](14-presence-and-heartbeat.md); integration test |
| 25 | **An unreachable vendor auto-cancels the order after 2 minutes** with the reason recorded. | [`14 §7`](14-presence-and-heartbeat.md); integration test |
| 26 | **Rider location writes only on ≥100 m displacement** (with the cadence floor and ceiling in [`07 §4`](07-d1-live-tracking.md)). | Unit test over recorded GPS traces |
| 27 | **A rider's location row is erased within 5 seconds** of going offline or ending a shift. | Integration test |
| 28 | **No cron.** No scheduled Worker, no Actions `schedule:` trigger carrying business logic. | Job `no-cron` |
| 29 | **Every mutating endpoint is idempotent** under a client-supplied key. | Contract test over all 412 endpoints |
| 30 | **No polling where a push exists.** | Architecture review; [`05 §9`](05-system-architecture.md) |

### Experience

| # | Rule | Enforced by |
| --- | --- | --- |
| 31 | **Responsive 200 px → 3840 px**, 50 breakpoints, zero overflow, zero clipped text. | Job `responsive-matrix`, Playwright screenshots |
| 32 | **60 fps** on the command map with 500 live markers, and on every app list. | Job `perf-budget`; Macrobenchmark on Android |
| 33 | **First Contentful Paint under 1.5 s** on a simulated 3G connection for the storefront. | Job `lighthouse-budget`, score ≥ 95 on all four axes |
| 34 | **Crawlers receive full HTML**, never an empty shell. | Job `prerender-verify` fetches with a bot UA and asserts content |
| 35 | **Deep links open the app** when installed, the web page when not. | Android App Links verification test |
| 36 | **Every interactive element has a ≥48 dp touch target** and an accessible label. | Job `a11y` (axe-core + Compose semantics test) |
| 37 | **Contrast ratio ≥ 4.5:1** for text, ≥ 3:1 for UI, in both light and dark themes. | Job `a11y` |
| 38 | **No layout shift.** CLS < 0.02. | Job `lighthouse-budget` |
| 39 | **The apps work on Android 8.0 (API 26) and up.** | `minSdk 26`; CI builds and tests on API 26, 30, 34, 35 |
| 40 | **Every destructive action is reversible or confirmed**, and every admin action is in the audit log. | [`27 §7`](27-security-rbac-audit.md); job `audit-coverage` |

---

## 5. The technology, and why each piece

| Layer | Choice | Why this one |
| --- | --- | --- |
| Backend compute | **3 Cloudflare Workers** | 100 000 requests/day free, no cold start worth measuring, global edge, and `wrangler` runs inside Actions so the no-CLI rule survives |
| Worker 1 — `undal-core` | **TypeScript** | Identity, catalogue, orders, money, admin. Types protect the ledger. |
| Worker 2 — `undal-realtime` | **TypeScript** + Durable Objects | Presence, live location, SSE fan-out, FCM dispatch. Durable Objects give single-threaded consistency per zone, which is exactly what dispatch locking needs. |
| Worker 3 — `undal-brain` | **Python** (Workers Python runtime) | Fare, dispatch, batching, ranking, forecasting. Python's numeric ergonomics make the statistics readable, and readable statistics are auditable statistics. |
| Web hosting | **Cloudflare Pages** | Unlimited bandwidth on free, atomic deploys, preview per PR, and native Workers binding |
| System of record | **TiDB Cloud Starter (free, permanently)** | MySQL-compatible distributed SQL, pessimistic `REPEATABLE READ`, 5 GiB row storage and 50 M RU/month free, five instances per organisation. Chosen over CockroachDB Serverless because that tier expires and this one does not. |
| Geospatial | **Integer coordinates on the platform's 500 m cell grid** | TiDB has no spatial types, so points are `lat_e7`/`lon_e7` with an indexed `cell_id`, polygons are GeoJSON with integer bounding boxes, and exact geometry runs in the Worker. Proven equivalent by the `geo-parity` gate ([`06 §4.1`](06-data-model-tidb.md)) |
| Live tracking | **Cloudflare D1** | 5 M reads and 100 k writes per day free. Perfect for a high-churn, low-durability channel that is deliberately erased. |
| Images, public | **imgbb** | Unlimited, free, direct base64 upload, returns a permanent URL |
| Images, sensitive | **Cloudinary** | Free tier with private delivery, signed URLs, and PDF generation for invoices |
| Android | **Kotlin** (+ Java interop where a library demands it) | Jetpack Compose, coroutines, the modern Android platform |
| Android networking | **okcronet** (OkHttp API over Cronet) | HTTP/3 and QUIC with the OkHttp interface. Delivery Hero's engineers moved Foodpanda's apps onto exactly this approach after finding the Google bridge too closed to extend; the measured win is in connection setup and failure rate. See [`16 §5`](16-android-foundation.md). |
| Android local store | **Room** | Offline-first order and menu caches, and the outbox that survives a dead network |
| Maps and routing | **OpenStreetMap** tiles + **OSRM** | Free, open, and good in Bangladesh where commercial coverage is uneven |
| Map rendering | **MapLibre** (native on Android, GL JS on web) + **Leaflet** for the admin overlay layer | Vector where it helps, raster where it is cheaper, no API key, no quota |
| Web app | **React + Vite + TypeScript** | Fast builds on a constrained runner, and a prerender step that is a plain Node script rather than a framework |
| Push | **Firebase Cloud Messaging, HTTP v1** | Free at any volume Undal will reach; service-account OAuth, not the retired legacy server key |
| CI/CD | **GitHub Actions** | 2 000 free minutes/month on a private repo, unlimited on public. The entire control plane. |

### 5.1 What this costs per month

| Service | Free allowance | Projected use at 500 orders/day | Headroom |
| --- | --- | --- | --- |
| Workers | 100 000 req/day | ~62 000 req/day | 38% |
| Workers CPU | 10 ms/request | p99 ~7 ms | adequate |
| Pages | Unlimited bandwidth, 500 builds/month | ~90 builds/month | 82% |
| D1 reads | 5 M/day | ~1.1 M/day | 78% |
| D1 writes | 100 000/day | ~34 000/day | 66% |
| TiDB Starter | 5 GiB row, 50 M RU/month | ~1.4 GiB; **RU unmeasured** | Storage ~3.6×; RU **unknown**, see [`39 §3.4`](39-risk-register-and-truths.md) |
| FCM | Unlimited | ~4 500 messages/day | ∞ |
| imgbb | Unlimited | ~300 uploads/day | ∞ |
| Cloudinary | 25 credits/month | ~6 credits | 76% |
| GitHub Actions | 2 000 min/month | ~1 100 min | 45% |

**Total monthly spend: ৳0.** The arithmetic behind each row, and the mitigation for each ceiling, is
[`39-risk-register-and-truths.md §3`](39-risk-register-and-truths.md).

---

## 6. The order lifecycle, once, completely

Every document in this corpus refers back to these states. This is the canonical list.

```
                    ┌──────────┐
                    │  DRAFT   │  cart exists, not submitted
                    └─────┬────┘
                          │ customer confirms
                    ┌─────▼──────┐
                    │  PLACED    │  written to TiDB, FCM fired at the vendor
                    └─────┬──────┘
          ┌───────────────┼───────────────────┐
          │ vendor accepts│                   │ 2 min, no response, device unreachable
          │               │ vendor rejects    │
    ┌─────▼─────┐   ┌─────▼──────┐     ┌──────▼─────────────────┐
    │ ACCEPTED  │   │ REJECTED   │     │ AUTO_CANCELLED         │
    │ prep time │   │ (reason)   │     │ reason=VENDOR_UNREACH  │
    │ committed │   └────────────┘     └────────────────────────┘
    └─────┬─────┘
          │ Brain opens a dispatch cycle (may already be running in parallel)
    ┌─────▼──────────┐
    │ RIDER_SEARCH   │  offers cascading, 1..n riders, 25 s each
    └─────┬──────────┘
          │ a rider accepts
    ┌─────▼──────────┐
    │ RIDER_ASSIGNED │  customer + vendor now see the live rider channel
    └─────┬──────────┘
          │ rider arrives, scans the order QR on the vendor's screen
    ┌─────▼──────────┐
    │ PICKED_UP      │  (pick-up orders skip straight here when the customer collects)
    └─────┬──────────┘
          │ rider navigates; location channel streams
    ┌─────▼──────────┐
    │ ARRIVED        │  geofence hit within 80 m of the drop pin
    └─────┬──────────┘
          │ cash handed over, rider confirms
    ┌─────▼──────────┐
    │ DELIVERED      │  ledger postings written, ratings unlocked
    └─────┬──────────┘
          │ T+15 min with no dispute
    ┌─────▼──────────┐
    │ SETTLED        │  immutable; enters the payout period
    └────────────────┘

  Side transitions available from several states, each audited:
    CANCELLED_BY_CUSTOMER   (free before ACCEPTED; fee-bearing after)
    CANCELLED_BY_VENDOR     (reason required; affects vendor reliability score)
    CANCELLED_BY_ADMIN      (reason + cost attribution required)
    REASSIGNING             (rider dropped out; returns to RIDER_SEARCH)
    DISPUTED                (from DELIVERED; freezes settlement)
```

The full state machine, with the transition table, the guard conditions, the events emitted, and the
compensating ledger postings for every reversal, is in
[`06-data-model-tidb.md §7`](06-data-model-tidb.md) and
[`08-api-contract.md §6`](08-api-contract.md).

---

## 7. What "proven" means in this corpus

The brief asks, repeatedly, for a platform that is *proven* to be more advanced than its
competitors. That word is used carefully here. Undal claims superiority only where it can be
**measured**, and the measurement harness ships with the code.

| Claim | How it is proven | Where |
| --- | --- | --- |
| Dispatch beats nearest-rider | Replay 10 000 synthetic order-days through both policies; compare mean assignment time, mean rider idle ratio, mean customer wait, and batch rate | [`30 §7`](30-testing-and-verification.md) |
| Fares are correct | 40 hand-computed vectors plus property tests over 10⁶ random inputs asserting monotonicity, floor, ceiling and closure | [`10 §12`](10-fare-engine-math.md) |
| Invoices are correct | Generated-week property test asserting every ledger period sums to zero | [`24 §9`](24-finance-payouts-invoices.md) |
| The alarm fires with the app killed | Instrumented Android test: swipe app from recents, lock screen, send a real FCM data message from the test harness, assert audio focus acquired within 2 s | [`15 §11`](15-wakeup-alarm-fcm.md) |
| The UI does not break | 50 breakpoints × 283 screens of visual regression | [`30 §5`](30-testing-and-verification.md) |
| Tracking fits the free tier | Replay real GPS traces through the gating algorithm; assert writes/day under budget | [`07 §8`](07-d1-live-tracking.md) |

Claims that cannot be measured are not made. Where Android, or the free tier, or physics imposes a
limit, [`39-risk-register-and-truths.md`](39-risk-register-and-truths.md) states the limit plainly
rather than papering over it. A specification that promises the impossible produces software that
lies to its users, and this platform handles other people's cash.

---

## 8. Scope boundary for launch

**In scope for v1.0:**

Customer Android app · Partner Android app · Rider Android app · Web storefront with full ordering ·
Admin panel · Three Workers · TiDB schema · D1 tracking · Fare engine · Dispatch engine ·
Batching engine · Ranking engine · Wake-up alarm · Presence · KYC onboarding · Weekly invoicing ·
Cash settlement · Zone drawing · Command map · Promo and campaign engine · Ratings and reviews ·
Dispute desk · Audit log · RBAC · Bangla/English · SEO · Deep links · Signed APK and AAB from Actions

**Explicitly out of scope for v1.0** (and why, so the decision is not re-litigated):

| Out | Reason | Revisit when |
| --- | --- | --- |
| iOS native apps | Cost and the no-CLI constraint (iOS signing requires a Mac) | A Mac runner budget exists |
| Card and mobile-wallet checkout | COD-only launch; needs a merchant account | Volume justifies the compliance work |
| Scheduled / pre-orders | Home kitchens are on-demand by definition per the brief | Restaurant mix shifts |
| Multi-country | Single-currency, single-tax launch; the schema is multi-tenant ready | A second market is chosen |
| In-app chat | Phone calls are the norm in this market and cost nothing | Support volume demands it |
| Grocery inventory sync | Vendors manage stock manually at launch | A partner with a POS asks |

---

## 9. Reading on

Next: [`02-reference-analysis.md`](02-reference-analysis.md) — the teardown of the motion references
and the competitive screen inventory that the design system is derived from.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
