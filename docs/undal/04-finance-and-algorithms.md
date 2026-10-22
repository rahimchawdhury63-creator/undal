# 04 — Financial contracts, COD accounting, and explainable algorithms

## A. Financial launch gate and units

The requested 15% commission is a clear business rate. The proposed 5% “tax” and the 3% bonus funded from it are **not** a complete lawful financial policy. Obtain owner/finance/legal approval of the rate bases, legal classification, recipients, invoice labels and funding before enabling live orders. Do not invent Bangladesh tax advice or label an operations charge as statutory tax.

Two lawful accounting branches must be distinguished: (1) a genuine statutory deduction, credited to a tax/withholding liability and never spent as platform income; (2) a lawful, contracted non-statutory operations levy, credited to its proper income/reserve accounts, from which an approved rider bonus may be funded. If a statutory tax exists, the rider bonus needs separate approved funding. Until resolved, financial workflows can be tested in isolated fixtures but live financial launch is blocked.

All examples below are **specification/test vectors**, not production seed orders, approved legal policy, a real business transaction, or evidence that payout software already exists.

- Money: signed integer poisha; `BDT 1.00 = 100` poisha. Rates: integer basis points, `10000 = 100%`. Distances: integer metres. Durations: integer seconds. Currency is explicit in every quote/journal/invoice.
- Parse external decimals with bounded decimal/lossless logic; reject NaN, infinity, scientific/oversized inputs where inappropriate, excessive precision and out-of-range values. Never compute commission or fare with binary floating-point arithmetic.
- Positive rounding: `round_half_up(n / d) = floor((n + d/2) / d)` for the specified even denominators. Signed adjustments use the symmetric approved rule; reversals reference and negate original allocated amounts rather than recomputing history.
- Compute order-level amounts once and distribute to lines/stops using a deterministic largest-remainder allocation, with stable ID tie-breaks. Allocations must sum exactly to the source total. Document where policy requires line-level rather than order-level tax rounding.
- Enforce zero-sum posted journals by currency through transactional posting functions/deferred integrity checks and restricted table privileges. A cross-row balance cannot be guaranteed by a naive per-row `CHECK` alone.

## B. Versioned order economics

Recommended proposed base, requiring approval:

```text
G  = gross food lines including priced variants/modifiers/bundles
Dv = vendor-funded food discounts, including an eligible 25% Flash discount
Dp = platform-funded food discounts
E  = G - Dv                         # eligible food subtotal; never negative
F  = E - Dp                        # customer food amount; never negative
C  = round_half_up(E * 1500 / 10000) # 15% commission
L  = round_half_up(E *  500 / 10000) # proposed 5% deduction; classification required
B  = round_half_up(E *  300 / 10000) # proposed rider bonus, delivery only, if approved
V  = E - C - L + approved_vendor_adjustments
COD = F + approved_packaging + customer_delivery_fee + approved_cash_tip
      + any separately lawful/disclosed customer charge
```

`Dp` is a platform expense/subsidy and does not reduce vendor entitlement a second time. `Dv` reduces `G` once; never deduct it again from `E`. Packaging defaults to zero unless an approved vendor-owned charge and its commission/tax base are defined. No automatic customer platform fee is assumed. Tips default disabled until cash custody/settlement is implemented; direct cash tips already retained by a rider must not also become a platform payout liability.

The 3% bonus in this proposed policy is 3% of `E`, not 3% of rider fare. If the owner intends another base, publish a new explicit version and update every test/example. It must not be silently added to customer fees. A pickup order has no assigned rider and no rider bonus.

Snapshot original food prices, modifiers, discounts/funders, fee components, legal tax/levy classification, rate bases, rounding mode, route/provider metadata, distances, vehicle, relevant policy versions, quote expiry and accepted payable amounts. Recalculate neither old receipts nor invoices from mutable menu/campaign/rider-location data.

Promotions need campaign funding ownership, accepted terms, dates in authoritative time, eligibility/minimums, redemption/budget caps, stack rules, cancellation behavior and reservation/release semantics. Default non-stacking unless explicitly supported. A Flash countdown is display only; eligibility and price are server-enforced.

## C. COD custody and balanced-ledger examples

Use dedicated ledger accounts for vendor food payable, rider earnings payable, rider cash receivable, vendor-retained pickup cash clearing/receivable, platform cash/bank/mobile-wallet clearing, commission income, non-tax levy income or statutory liability, delivery revenue, platform promotion expense, fulfillment expense, rider bonus expense, cash-out fee expense, refunds, approved penalties and suspense/shortfalls. Do not conflate platform profit, cash in a rider's pocket and unpaid earnings.

### Vector FIN-01 — Delivery with a lawful non-tax levy, for arithmetic testing only

Assume gross food BDT 1,000; vendor Flash discount 25% = 250; platform food discount 50; customer delivery fee 50; no packaging/tip. Then `E=750`, `F=700`, `C=112.50`, `L=37.50`, proposed `B=22.50`, vendor entitlement `V=600`, customer COD `750`. The rider fare vector in section F yields total rider earnings `148.98` including the bonus.

Illustrative posted journals, shown in **BDT for readability** but stored as integer poisha:

| Event | Debits | Credits |
| --- | --- | --- |
| Delivery/cash collection recognized | Rider cash receivable 750; platform promotion expense 50 | Vendor food payable 750; delivery revenue 50 |
| Vendor commission/levy assessed | Vendor food payable 150 | Commission income 112.50; non-tax levy income 37.50 |
| Rider earnings earned | Fulfillment expense 126.48; rider bonus expense 22.50 | Rider earnings payable 148.98 |
| Actual rider remittance verified | Platform cash 750 | Rider cash receivable 750 |
| Actual vendor transfer paid | Vendor food payable 600 | Platform cash 600 |
| Actual rider transfer paid | Rider earnings payable 148.98 | Platform cash 148.98 |

Every journal balances. Remaining platform cash is `750 − 600 − 148.98 = 1.02` before payout fees/other costs; no minimum-profit claim follows. If `L` were statutory tax, that amount would remain a liability and this example would require additional platform funding; the statutory 37.50 cannot be consumed to make the bonus affordable.

### Vector FIN-02 — Restaurant pickup with vendor-retained cash

Use the same food/discount/commission/levy assumptions, but no delivery fee or rider. Customer pays **700** to the restaurant; vendor economic entitlement is **600**. Vendor retained more cash than it is entitled to, so the net statement is **BDT 100 due from vendor**, not a BDT 600 payout in addition to the cash already retained.

Initial journal: debit vendor-retained cash clearing 700 and platform promotion expense 50; credit vendor food payable 750. Assess commission/levy as above, leaving vendor payable 600. Offset payable against cash clearing with an auditable clearing entry; the remaining vendor receivable is 100. Verified vendor remittance clears that receivable. A negative net payable is labelled an amount due, not sent as a negative transfer.

### Vector FIN-03 — Retry and reversal invariants

Submitting delivery/cash confirmation twice posts one event journal. Marking a remittance “submitted” posts no bank-receipt verification. A duplicate webhook/API retry cannot mark two invoices paid. A partial food refund references original item allocations; sum of all refunds cannot exceed the eligible original component, and each reversal/credit note balances. A cash shortage creates an explicit reviewed discrepancy, not an unexplained subtraction from earnings.

Cash collection requires an authorized assignment/order transition and explicit amount. A QR scan proves an authorized pickup-token redemption, not that cash was actually transferred. Selfies/screenshots/transaction IDs are evidence for review, not automatic proof that a mobile-wallet transfer settled.

## D. Friday/Saturday invoices and manual payment approvals

Operational timezone is `Asia/Dhaka`. Proposed cutoff is local 00:00:00: rider periods `[previous Friday 00:00, current Friday 00:00)`; vendor periods `[previous Saturday 00:00, current Saturday 00:00)`. Store UTC boundaries and timezone/policy versions. These are proposed cutoffs; separate cutoff, review deadline and actual Friday/Saturday payment time explicitly. Off days/holidays do not silently shift the contractual payment day.

Persist settlement periods and use SQLite DO alarms in an existing Worker for Friday/Saturday wake-ups—no cron expression, GitHub scheduled workflow, pg_cron or in-memory timer. Re-arm the next alarm, retry recoverably, and run `ensure_due_periods` on administrative finance access and relevant recovery paths. A test must advance an isolated clock across each cutoff and outage, then prove exactly one invoice per party/currency/period/policy revision.

Closing a period requires a consistent ledger watermark and reconciliation of eligible order/cash/adjustment events. Use bounded per-party jobs and transactional locks/uniqueness. Late financial events after a closed cutoff post a referenced adjustment in the next permissible accounting period or an explicit credit note, not a silent mutation of a verified invoice. If a period is unbalanced or ambiguous, mark it blocked with diagnostic entries; never force a matching total.

Invoice content: Undal identity/branding; correct statement/tax label; vendor/rider legal/business details under access control; invoice ID/revision and period; order references/count; gross food; vendor/platform-funded discounts distinguished; commission and approved deduction; packaging/tip treatment; pickup cash retained; delivery earnings components; bonus; approved adjustments/penalties; verified offsets; net payable or amount due; fee reimbursement; status and actual payment reference. Riders' cash custody summary is separate from their earnings statement.

State flow: `GENERATED → VERIFIED → PAID`, with independently recorded reviewers, timestamps, reason and evidence. Verification checks reconciliation, account details and policy; paid requires actual manual transfer reference/confirmation. Use maker/checker separation for sensitive amounts, no self-approved transfer where policy requires two people, and optimistic versions to prevent concurrent approvals. Errors after payment create a reversal/correction record with appropriate authority, never delete history.

bKash Send Money plus cash-out reimbursement, Nagad and bank are manual supported payout methods, with bKash recommended by business policy only where lawful. Configure actual provider fee model, effective date and who bears it. If a fee is levied on withdrawal principal, reimbursement may be `N + fee(N)`; if levied on transferred gross, a gross-up may be needed. Do not substitute a guessed provider rate or always add a percentage without defining the actual model. Record payout-fee expense separately. Rider remittance does not impose a customer/rider cash-out surcharge unless the approved policy explicitly says so; the requested default is no rider cash-out charge for remitting collected COD.

PDFs must render the immutable verified invoice data, not independently recompute totals. Use original branded layout, readable line-item tables, totals, status, page numbers, reference hash/verification mechanism and licensed embedded Bangla/English fonts with actual shaping tests. Heavy PDF/font rendering may run in a protected, quota-budgeted Actions job and store output in a private Cloudflare R2 Standard invoice bucket with Supabase metadata and authenticated Worker download authorization; never assume a multi-page browser renderer fits a 10ms Worker. Expose genuine PDF generation state and authorized download; no fake Download button. Retrying PDF generation must not create another financial invoice.

## E. Rider-fare input contract and exact policy

Preserve these requested field names in the internal fare contract: `base_fare`, `travel_distance_km`, `traffic_delay_minutes`, `active_orders_in_zone`, `active_riders_in_zone`, `weather_condition`. Their logical input types are decimal, decimal, decimal, nonnegative integer, nonnegative integer and enum `clear|rain|storm|extreme_heat`. Accept legacy numeric JSON only with bounded lossless normalization; prefer decimal-string transport for money. Add vehicle profile, eligible food subtotal/bonus, route evidence, snapshot time, zone and policy version.

Trusted backend configuration/observations supply fares, weather, route and counts. Customers/riders cannot choose an advantageous base fare, storm flag, distance or supply count. Count fresh approved **unengaged** riders and eligible unassigned orders in the same versioned zone snapshot. Return all units, component amounts, source freshness, guarantee/expiry and policy version.

### Supply-demand bands

Let `O=active_orders_in_zone`, `R=active_riders_in_zone`. Avoid float division using cross-multiplication. Proposed deterministic interpolation within the user's bands:

```text
O = 0              : no dispatch demand; no division or offer; diagnostic surge = 10000
O > 0, 2R < O      : surge_bps = 22000 - floor(14000 * R / O)   # [1.5x, 2.2x]
O > 0, 2R >= O,
       R <= O      : surge_bps = 16000 - floor( 4000 * R / O)   # [1.2x, 1.4x]
O > 0, R > O       : surge_bps = 10000                        # 1.0x
```

At `R=0,O>0`, quoted scarcity multiplier is 2.2 but there is no eligible rider to receive an offer. Exact `SDR=0.5` is moderate (1.4); exact `SDR=1` is moderate (1.2); above 1 is 1.0. This policy has explicit tier discontinuities; test and disclose them. Hysteresis/smoothing may change only through an approved version and must remain within the required bands. Never reprice an accepted rider guarantee downward as counts change.

### Distance, weather, traffic and total

```text
included_m = 2000                                    # base fare covers 0–2km
extra_m = max(0, total_route_m - included_m)          # rider → vendor → customer
rate_minor_per_km = 1400 for motorbike; 800 for bicycle
base_surged = round_half_up(base_minor * surge_bps / 10000)
distance_pay = round_half_up(extra_m * rate_minor_per_km / 1000)
traffic_steps = floor(traffic_delay_seconds / 300)
traffic_pay = traffic_steps * approved_vehicle_traffic_step_minor
core = base_surged + distance_pay + traffic_pay
weather_bps = 10000 clear; 12000 rain; 14000 storm
weather_adjusted_core = round_half_up(core * weather_bps / 10000)
rider_pay = weather_adjusted_core + approved_order_bonus + approved_batch_bonus
            + separately_approved_adjustments
```

`extreme_heat` has no specified premium in the original rules: require an approved policy; do not invent one. Safety closures may override offer creation even when weather premium exists. Never pay a storm premium as justification for dispatching into unsafe conditions.

Traffic is delay above free-flow time, not total travel duration. Configure a real, justified source or explicitly label an approved estimate; OSM alone is not a traffic feed. Five-minute step amount, base fares, heat policy and weather source are mandatory approved inputs. No silent zero/default creates an apparently production-configured fare engine.

Separate customer delivery charges from rider earnings. Customer fees normally use vendor→customer service distance and a disclosed quote policy, not the arbitrary extra approach distance of the eventual rider. A changed rider cannot silently increase customer COD. Define who funds the gap when rider earnings exceed delivery revenue.

Vehicle policy: bicycle service radius is a configured approved value within the requested approximately 3–4km envelope, with food-time/capacity limits; motorbike supports longer permitted routes, with an explicit upper cap and zone eligibility. Do not interpret “10+km” as unlimited food delivery. Use real vehicle routing profiles, not a car route relabelled bicycle.

## F. Fare golden vectors

Test-fixture traffic-step compensation below is **BDT 5 per five minutes**, motorbike base **BDT 30**, and bicycle base **BDT 20**. These are deliberate test values, not automatic live business defaults.

| ID | Inputs | Required result |
| --- | --- | --- |
| FARE-01 | Motorbike; 5km total route; 10min delay; O=10/R=3; rain; eligible E=750; approved 3% E bonus | Surge 1.78; surged base 53.40; extra-distance 42; traffic 10; core 105.40; rain-adjusted core 126.48; bonus 22.50; total **148.98**. |
| FARE-02 | Bicycle; 3.5km; 4min delay; O=10/R=12; clear; bonus=0 for component test | Base 20; extra-distance 12; traffic 0; no surge/premium; total **32.00**. |
| FARE-03 | Motorbike; 2km; 5min delay; O=10/R=11; storm; bonus=0 | Base 30; distance 0; traffic 5; core 35; storm-adjusted **49.00**. |
| FARE-04 | Same motorbike base; O=10 with R=0,5,10,11 | Multipliers **2.20, 1.40, 1.20, 1.00** respectively; R=0 creates no offer. |
| FARE-05 | Route below/equal/one metre above 2km | Included kilometres are never charged twice; extra-metre rounding follows the exact poisha rule. |
| FARE-06 | Delay 299,300,599,600 seconds | Traffic steps **0,1,1,2** respectively. |
| FARE-07 | O=0/R=0 and O=0/R>0 | No division, NaN, infinity or offer; documented no-demand result. |
| FARE-08 | Missing route, unsupported weather/source, negative values, expired policy | Reject/unavailable quote with reason, never invented fallback pricing. |

Cross-language golden fixtures must agree exactly between SQL, TypeScript and Dart representations. Property tests check nonnegative allowed components, stable rounding, distance monotonicity within a fixed policy/snapshot, no bonus double count, allocations summing exactly and no payout changes after acceptance except permitted upward adjustments or reviewed corrections.

## G. Dispatch, preparation, and safe batching

Use an explainable hybrid: indexed geographic filtering → feasibility constraints → bounded route-cost evaluation → deterministic score → transactional offer reservation → acknowledgement/expiry → accepted assignment → monitored progression. This is an engineered optimization heuristic, not a claim of trained AI or global mathematical optimality.

1. Exclude unapproved/suspended/out-of-zone riders, unsupported vehicles, stale/untrusted locations, expired shifts/documents, exhausted COD capacity, unsafe zones, conflicting offers/assignments and riders unable to meet food/route constraints.
2. Use PostGIS/grid/geohash to select a bounded candidate set; choose grid parameters from actual density tests. Avoid an O(all riders × all orders) scan. A proposed initial candidate cap is 20 before route evaluation; tune transparently within routing quotas.
3. Estimate vendor readiness from recent robust preparation history, item mix/quantity, active kitchen queue, declared capacity, route arrival and known constraints. Use documented median/EWMA/quantile fallback for sparse data, not invented ML confidence. Vendor can set 1–200 minutes with audited updates.
4. Score feasible riders using route-to-pickup time, readiness alignment, route-to-customer time, completion/reliability with sample-size correction, idle fairness, cash exposure, capacity/vehicle fit, supported weather safety and batch detour. Publish normalized features/weights and decision reasons to authorized operators.
5. Reserve atomically in SQL using row locks/version checks and uniqueness. DOs reduce coordination contention but SQL constraints remain the final arbiter. One acceptance wins; other offers revoke. Never allocate based only on RTDB presence or a client accept screen.
6. Use short configurable offer TTLs, attempt budgets, backoff, decline reasons, late-response handling and manual-dispatch escalation. The rider may always decline. No available rider triggers an honest delay/cancellation/support policy, not forced acceptance.
7. Initial batching supports at most two compatible orders, from the same vendor or an explicitly permitted tight pickup cluster. Check each pickup's readiness, bag/vehicle capacity, COD cap, food deadline, promised ETA, customer route proximity and maximum extra time/distance.
8. Enumerate the bounded pickup-before-dropoff sequences (for two independent pickup/dropoff pairs, at most six valid precedence-respecting permutations; merge a shared pickup where appropriate). Evaluate real route/time and preparation waits for each; choose the feasible lowest policy cost with stable tie-breaks. Geographic similarity alone is not enough.
9. Disclose both orders, stop order, route/detour and total guarantee. A later add-on needs consent and cannot reduce previously accepted pay. A second base-fare discount is permitted only in a pre-disclosed approved batch policy; marginal bonus and guaranteed minimum remain explicit.
10. Allocate shared route pay and bonuses deterministically without paying a common leg twice or losing an order's promised bonus. Use exact remainder allocation; sum of per-order allocations equals the displayed batch guarantee. Changes after cancellation/unbatching create versioned guarantees/adjustments.
11. Re-evaluate on vendor delay, offer rejection, customer cancellation, reassignment, route closure, location staleness and app restart. Do not silently reroute a picked-up order to another rider without a documented physical-transfer workflow.
12. Keep decision traces with candidate exclusions, route source/freshness, score/policy version, chosen reservation and outcome. Minimize retained location/PII; traces are scoped operational evidence, not a public rider leaderboard.

## H. Ten-stage organic ranking and reminders

1. **Trust/eligibility:** approved food vendor, valid policy, no safety/compliance block; hard exclusion.
2. **Geography/mode:** supported customer zone, delivery/pickup eligibility, vehicle/radius constraints; hard exclusion.
3. **Availability/capacity:** hours/exceptions, fresh operational lease, pause/overload and actual menu availability; hard exclusion.
4. **Query/cuisine relevance:** bilingual indexed text, taxonomy, user-selected filters, real matching items.
5. **Logistics:** real route/ETA/preparation range and reliable serviceability; no fabricated “fastest” badge.
6. **Quality/reliability:** Bayesian/sample-size-adjusted verified reviews, completion/accuracy/preparation metrics; distinguish statistically weak/new-vendor data from poor performance.
7. **Transparent value:** real eligible food/fee value and discounts; no commission-based placement, CPC or purchased rank.
8. **Consent-aware preference:** explicit favorites and permitted past-food preferences; guest/cold-start fallback; no sensitive-attribute inference or sale of customer profile data.
9. **Diversity/fair exposure:** bounded cuisine/vendor repetition and controlled new-vendor exploration using a documented policy/seed; hard eligibility can never be bypassed for exploration.
10. **Deterministic final ranking:** normalize approved features, apply versioned weights and diversity constraints, use stable tie-breaks/pagination and produce authorized explanations. Cache keys include relevant zone/query/policy/locale and personalization scope; never leak a user's profile through shared cache.

Example weight proposals are not universal truth; evaluate them on isolated labelled fixtures and later consented real operational metrics. Record relevance, service reliability, fairness/exposure and latency rather than claiming superiority over competitors. Reminders use completed-order eligibility, cooldown, marketing consent, quiet hours, frequency caps and easy opt-out; never manipulate ratings or nag users into positive reviews.
