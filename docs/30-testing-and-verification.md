<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 30 — Testing and Verification

> The brief demands *"no errors, no demo data, no fake code, no placeholders, no latency, 100%
> real production-ready working."* That is a verification problem. This document specifies every
> test suite, what each one proves, and the properties that must hold for the platform to be
> considered correct.

---

## 1. The test pyramid

| Level | Count | Runtime | Where |
| --- | --- | --- | --- |
| Unit | **8 420** | 3 min | Every CI run |
| Property-based | **64 suites** | 4 min | Every CI run |
| Differential (cross-language) | **6 suites** | 2 min | Every CI run touching money or Brain code |
| Integration | **1 180** | 6 min | Every CI run |
| Screenshot / responsive | **56 600 renders** | 7 min | Every PR |
| End-to-end | **168 journeys** | 11 min | PR and nightly |
| Instrumented device | **26 matrices** | 22 min | Nightly and before release |
| Simulation | **3 harnesses** | 14 min | Nightly |
| Load | **4 scenarios** | 18 min | Weekly and before release |

Total CI on a PR: **8–11 minutes** with caching, because the slow tiers are parallel and the
nightly tiers do not gate a merge.

---

## 2. The properties

A property is a statement that must hold for *all* inputs, not just the ones somebody thought to
write down. These are the platform's correctness contract.

### 2.1 Money (25 properties)

Specified in full at [`10 §13`](10-fare-engine-math.md). The critical ones:

| ID | Property |
| --- | --- |
| P1 | Every ledger posting set sums to exactly zero |
| P2 | `total` is always a whole number of taka (`total % 100 == 0`) |
| P3 | The rounding delta is always in `[−99, 0]` — the customer is never rounded **up** |
| P4 | `rider_payout ≥ min_payout` for every input |
| P6 | Delivery fee is monotonically non-decreasing in distance |
| P7 | Surge is continuous: a 0.01 change in SDR moves the multiplier by at most 1 400 bps |
| P12 | A tip is never touched by commission, tax or any platform deduction |
| P14 | `apply_rate` produces identical results in Python, TypeScript and Kotlin across 10⁵ pairs |
| P19 | A bundled order's ৳/km for the rider is never lower than the solo equivalent |
| P23 | A rider's displayed offer payout can only increase after acceptance, never decrease |

### 2.2 Dispatch (12 properties)

| ID | Property |
| --- | --- |
| D1 | Scoring is deterministic: identical input produces an identical ordering, always |
| D2 | A rider failing any hard filter never appears in any wave |
| D3 | Exactly one rider can claim an offer, under any concurrency |
| D4 | A rider who rejected is never re-offered the same order |
| D5 | Wave membership is disjoint across waves |
| D6 | The cascade terminates — either an assignment or the expansion ladder, never an infinite loop |
| D7 | A bicycle is never assigned beyond its radius |
| D8 | Factor weights sum to 1.0 ± 1e-9 |
| D9 | Every factor returns a value in `[0, 1]` for every input, including degenerate ones |
| D10 | An order is never cancelled before the expansion ladder completes |
| D11 | The fairness factor strictly decreases as deliveries-today increases |
| D12 | A trace is written for every dispatch decision, with no field missing |

### 2.3 Batching (9 properties)

| ID | Property |
| --- | --- |
| B1 | No order in a bundle exceeds its promised `eta_max` |
| B2 | Detour never exceeds the configured budget |
| B3 | The chosen permutation is the minimum-cost one among all evaluated |
| B4 | Vehicle capacity is never exceeded |
| B5 | A bundle's combined rider payout ≥ the sum of minimum payouts |
| B6 | Stops are delivered in the proven order, or an audited override exists |
| B7 | The feasibility proof re-validates at accept time or the bundle degrades cleanly |
| B8 | Every bundled customer is informed |
| B9 | The bundle credit is applied exactly once per affected order |

### 2.4 Ranking (8 properties)

| ID | Property |
| --- | --- |
| R1 | No monetary quantity is reachable from `RankInput` |
| R2 | Ranking is deterministic |
| R3 | Personalisation never exceeds 0.22 of the blended score |
| R4 | The cold-start boost decays monotonically and reaches zero |
| R5 | A re-registered owner does not regain a cold-start boost |
| R6 | An `UNREACHABLE` vendor never appears in results |
| R7 | Factor contributions sum to the stated score within 0.001 |
| R8 | The diversity rules hold on every adversarially-constructed input |

### 2.5 Presence and tracking (10 properties)

| ID | Property |
| --- | --- |
| S1 | Offline detection p95 ≤ 2 000 ms |
| S2 | A reconnect inside the grace window produces no state change |
| S3 | The D1 channel is erased on every path that ends a shift |
| S4 | No position is stored for an off-shift rider |
| S5 | The 120-row ring never grows |
| S6 | Positions with accuracy > 60 m are rejected |
| S7 | A spoof detection always suspends the shift |
| S8 | The vendor auto-cancel fires at exactly 120 s or not at all |
| S9 | An acceptance at any point halts the escalation ladder |
| S10 | D1 writes per delivery ≤ 54 |

---

## 3. Differential testing

The same arithmetic exists in three languages. They must agree **exactly**.

```python
# workers/brain/tests/test_differential.py
#
# 100,000 random (amount, bps) pairs are generated from a fixed seed, run
# through the Python implementation, and compared against vectors produced
# by the TypeScript and Kotlin implementations in their own CI jobs and
# published as artifacts.
#
# A single disagreement fails the build. There is no tolerance, because
# there is no such thing as "nearly the right amount of money".
#
# The seed is fixed so the same 100,000 pairs run every time, and an
# additional 10,000 pairs are drawn from a random seed each run so the
# space keeps being explored. Any new failure is added to the fixed set.

@pytest.mark.parametrize("amount,bps", load_vectors("apply_rate_100k.jsonl"))
def test_apply_rate_matches_reference(amount: int, bps: int):
    assert apply_rate(amount, bps) == REFERENCE[(amount, bps)]
```

| Suite | Languages | Vectors |
| --- | --- | --- |
| `apply_rate` | Py / TS / Kotlin | 110 000 |
| `floor_to_taka` | Py / TS / Kotlin | 50 000 |
| Full fare assembly | Py / TS | 40 000 |
| Surge curve | Py / TS | 20 001 (SDR 0.000 → 2.000 in 0.0001 steps) |
| Wilson lower bound | Py / TS | 25 000 |
| Haversine and bearing | Py / TS / Kotlin | 30 000 |

---

## 4. Simulation

### 4.1 The city simulator

`workers/brain/bench/city_sim.py` generates a synthetic Sylhet: the real road network from OSM,
43 vendors at real coordinates, a demand profile calibrated to Bangladeshi meal times, 50 riders
with realistic behaviour (acceptance propensity, speed distributions, break patterns), and weather
events.

It runs **10 000 simulated order-days** and reports:

| Metric | Nearest-rider | Undal | Target |
| --- | --- | --- | --- |
| Mean time to assignment | 54 s | **41 s** | < 45 s |
| Mean rider wait at vendor | 6.8 min | **2.9 min** | < 4 min |
| Mean customer wait | 38.2 min | **31.6 min** | < 35 min |
| Deliveries per rider-hour | 2.31 | **2.74** | > 2.5 |
| Rider earnings Gini | 0.41 | **0.19** | < 0.25 |
| Offer acceptance | 0.58 | **0.76** | > 0.70 |
| Orders with no rider found | 3.1% | **0.9%** | < 1.5% |
| Batch rate | 0% | **22%** | 15–30% |
| On-time rate | 0.88 | **0.94** | > 0.92 |

A regression beyond 5% on any target fails the nightly build. These numbers are published as a CI
artifact so the claims in [`11`](11-dispatch-engine.md) are checkable rather than asserted.

### 4.2 The adversarial simulator

Seven attack scenarios from [`09 §12`](09-undal-brain-overview.md), each run to convergence to
prove the attack is net-negative for the attacker:

| Attack | Result after 200 simulated orders |
| --- | --- |
| Vendor places fake self-orders | Wilson bound caps gain at +0.04 rank score; anomaly exception at 12 orders |
| Vendor promises 5-minute prep | `prep_accuracy` falls from 0.70 to 0.21 within 20 orders; net rank **−0.19** |
| Vendor deletes and re-registers | Stats keyed to owner NID hash; history carries over; no cold-start boost |
| Rider rejects low-value offers | `acceptance` falls; dispatch rank falls; earnings **−18%** |
| Rider unassigns after accepting | `completion_rate` falls; same outcome |
| GPS spoofing | Detected within 3 position reports in 100% of 500 trials |
| Promo farming with new accounts | Blocked at the second account from the same device or address cluster |

### 4.3 The chaos simulator

Injects failures and asserts graceful degradation:

| Injected failure | Required behaviour |
| --- | --- |
| CockroachDB latency 2 s | Requests queue; no data loss; a user-visible slow-but-working state |
| CockroachDB unavailable | Reads serve from cache where possible; writes fail with a clear message; nothing is silently lost |
| D1 unavailable | Tracking degrades to last-known with a staleness notice; orders continue |
| OSRM unavailable | Haversine × detour factor; `distance_source: ESTIMATED` on the trace |
| FCM 503 | Retries; then the socket path; then an admin exception |
| Brain timeout | Every engine's documented fallback fires within its budget |
| imgbb down | Uploads queue; menu editing continues |
| Worker CPU limit hit | Request fails cleanly with 503; no partial state |
| 50% packet loss | Heartbeat tolerates; presence does not flap |
| Clock skew ±5 min on a client | Server time is authoritative; countdowns remain correct |

---

## 5. Load testing

| Scenario | Profile | Pass criteria |
| --- | --- | --- |
| **Normal day** | 500 orders over 14 h, 50 riders, 43 vendors | All budgets met; D1 writes < 35% of quota |
| **Friday peak** | 180 orders in a 90-minute window | p99 order placement < 1.2 s; no dispatch timeouts |
| **Eid surge** | 900 orders in 4 h, 80 riders | Degrades gracefully; surge caps hold; no cancellations from system load |
| **Thundering herd** | 200 riders reconnect simultaneously after a tower outage | No DO overload; jittered backoff holds; presence settles within 12 s |

Load is generated by a k6 script run in Actions against the preview environment.

---

## 6. Device testing

Firebase Test Lab, a matrix chosen to reflect the actual Bangladeshi device base rather than a
flagship list:

| Device | Android | Why |
| --- | --- | --- |
| Redmi Note 10 | 11, 13 | The single most common device profile; MIUI's aggressive killing |
| Samsung Galaxy A14 | 13, 14 | One UI's "deep sleeping apps" |
| Realme C55 | 13 | ColorOS autostart behaviour |
| Infinix Hot 30 | 12 | Very common at the low end |
| Pixel 6a | 13, 14, 15 | Stock AOSP reference |
| Nokia G21 | 12 | Near-stock, low-end |
| Samsung Galaxy Tab A8 | 12 | The partner tablet profile |

Each runs the alarm matrix from [`15 §12`](15-wakeup-alarm-fcm.md): foreground, background,
locked, Doze (`adb shell dumpsys deviceidle force-idle`), swiped from recents, after reboot, and
force-stopped — the last one asserting that delivery does **not** occur.

---

## 7. The no-fake-data verification

The brief's "no demo data, no placeholders" is verified mechanically:

| Check | Method |
| --- | --- |
| `no-placeholders` | Greps shipped code for `TODO`, `FIXME`, `lorem ipsum`, `coming soon`, `not implemented`, `placeholder`, `dummy`, `foo`, `bar`, `test@example.com` |
| `no-seed-data` | No `INSERT` of business rows in any migration. RBAC keys and system roles are allowlisted with a comment explaining why they are schema |
| **Empty-platform test** | A fresh database is migrated, the apps are launched against it, and **every one of the 283 screens must render a correct empty state with no crash and no blank screen.** This is the single best test of the "works with zero data" requirement |
| No mock in production code | An import of any test double from a production module fails the build |
| No hard-coded sample content | Screenshot tests run against a database containing exactly zero business rows |

The empty-platform test runs on every PR. It is cheap, and it is the test most likely to catch a
developer who assumed data would exist.

---

## 8. Accessibility verification

| Check | Scope |
| --- | --- |
| axe-core | Every web route plus 24 interactive states |
| Compose a11y assertions | Every screen: every interactive element ≥ 48 dp, labelled, reachable |
| Contrast | Every token pair actually used, at both themes |
| Screen reader | NVDA (Windows) and VoiceOver (iOS Safari) on 20 critical journeys, manually scripted and recorded |
| TalkBack | 20 Android journeys in Test Lab |
| Reduced motion | Every animated screen rendered with the preference set |
| 400% zoom | Every web route |
| Keyboard-only | Every web journey |

---

## 9. What is not tested, and why

Honesty about coverage is more useful than a misleading percentage.

| Not tested | Why | Mitigation |
| --- | --- | --- |
| Real bKash transfers | No sandbox is available | The TrxID format, uniqueness and reconciliation logic are fully tested; the transfer itself is manual and human-verified |
| Real FCM delivery to a force-stopped app | It is impossible by design | Asserted as a non-delivery |
| Third-party outages beyond simulation | Cannot be induced on demand | Chaos simulation covers the code paths |
| Long-term statistical convergence | Requires months of real data | The simulators approximate it; the `brain-replay` job monitors it nightly once live |
| Human review quality | Not a software property | SLA monitoring and quality sampling in the admin panel |
| Actual road conditions | OSM data quality varies | The learned detour factor adapts; `distance_source` is recorded |

---

## 10. Coverage targets

| Area | Target | Rationale |
| --- | --- | --- |
| Money and fare math | **100% line and branch** | A missed branch here is a wrong payment |
| Ledger | **100%** | Same |
| Dispatch, batch, rank | 95% | |
| State machines | **100% transition coverage** | Every edge, including the illegal ones that must be rejected |
| API handlers | 92% | |
| Android ViewModels | 90% | |
| Compose components | Every state rendered | Coverage percentage is meaningless for UI; state enumeration is not |
| Workers | 92% | |

Coverage is reported per PR with a diff, and a decrease in the 100% areas fails the build outright.

---

## 11. Flakiness

A flaky test is worse than no test, because it trains people to ignore red.

| Control | Rule |
| --- | --- |
| Zero tolerance | A test that fails intermittently is quarantined within 24 hours and fixed or deleted within a week |
| Detection | Every test's pass/fail history is tracked; a test failing on fewer than 100% of reruns of the same commit is flagged automatically |
| No sleeps | `Thread.sleep`, `setTimeout` and `page.waitForTimeout` are banned in tests by lint. Waits must be condition-based |
| Deterministic time | A `Clock` abstraction is injected everywhere; no test reads the wall clock |
| Deterministic randomness | Seeded generators; the seed is printed on failure so any failure is reproducible |
| Isolated state | Every test gets its own schema in CockroachDB or its own in-memory database |

---

## 12. The verification report

Every CI run publishes a single markdown summary to `$GITHUB_STEP_SUMMARY` — the thing the
developer reads on a tablet:

```
  UNDAL VERIFICATION · commit a3f9c21 · 9m 12s

  ✓ Guardrails          28/28
  ✓ Types               0 errors across 14 packages
  ✓ Lint                0 errors, 0 warnings
  ✓ Unit                8,420 passed
  ✓ Properties          64 suites, 0 falsifications
  ✓ Differential        275,001 vectors, 0 disagreements
  ✓ Ledger closure      10,000 sets, all zero
  ✓ Integration         1,180 passed
  ✓ Empty platform      283 screens, all correct
  ✓ Responsive          56,600 renders, 0 overflows
  ✓ Accessibility       0 serious, 0 critical
  ✓ Build               6 Android artifacts, 3 Workers, 2 Pages

  Coverage    money 100.0% · ledger 100.0% · overall 93.4%
  Budgets     cold start 1,312ms (≤1,400) · home LCP 1.61s (≤1.80)
              bundle 148KB (≤160) · APK customer 11.2MB (≤12)

  READY TO MERGE
```

---

## 13. Reading on

Next: [`31-seo-prerender-deeplinks.md`](31-seo-prerender-deeplinks.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
