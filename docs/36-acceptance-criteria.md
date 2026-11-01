<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 36 — Acceptance Criteria

> Every requirement in the brief, restated as a checkable assertion with the test that proves it.
> This is the document the developer reads to decide whether the work is done. Nothing here is
> subjective.

---

## 1. How to read this

| Column | Meaning |
| --- | --- |
| **ID** | Stable identifier, referenced by test names |
| **Criterion** | A statement that is either true or false |
| **Proof** | The test, job or workflow that establishes it |

A criterion with no proof is not a criterion; it is a hope. Every row has one.

---

## 2. Platform and stack (A1–A14)

| ID | Criterion | Proof |
| --- | --- | --- |
| A1 | Exactly three Cloudflare Workers are deployed: `undal-core` (TS), `undal-realtime` (TS), `undal-brain` (Python) | `deploy-workers.yml` health checks |
| A2 | The website and admin panel are hosted on Cloudflare Pages | `deploy-web.yml`, `deploy-admin.yml` |
| A3 | TiDB Cloud Starter (free) is the only relational store, and its integer geospatial layer returns results identical to the geometry it replaced | `verify-schema.yml` · `no-postgres-dialect` · `geo-parity` |
| A4 | Cloudflare D1 holds **only** rider real-time location data | `d1-scope` test: D1 contains exactly 2 tables |
| A5 | All public images are on imgbb | `media-destination` CI job |
| A6 | All sensitive documents are on Cloudinary with `access_mode: authenticated` | Same job + a 401 test on raw URLs |
| A7 | Three Android apps exist with the correct package names and the supplied logos | `android-release.yml` artifacts |
| A8 | Networking uses Okronet (OkHttp API over Cronet) with HTTP/3 | `http3-negotiation` instrumented test |
| A9 | Routing uses OSM data via OSRM | `osrm-integration` test; no other routing provider is imported |
| A10 | Maps use Leaflet (web) and MapLibre Native (Android), with permanent OSM attribution | `osm-attribution` CI job |
| A11 | Room is the Android local database | Module dependency assertion |
| A12 | Web is React + Vite + TypeScript | Build config assertion |
| A13 | FCM uses the v1 API with service-account auth; no legacy server key exists anywhere | `fcm-payload-purity` CI job |
| A14 | **No paid service is required to run the platform** | `dependency-licence-and-cost` CI job |

---

## 3. Ordering (A15–A32)

| ID | Criterion | Proof |
| --- | --- | --- |
| A15 | A customer can browse every vendor and menu without an account | E2E `guest-browse` |
| A16 | Authentication is required only at checkout | E2E `checkout-requires-auth` |
| A17 | Registration is three steps and resumes after an app kill at any step | 44 resume tests |
| A18 | **No OTP and no email verification exists in any code path** | Repo grep + `auth-no-otp` test |
| A19 | Google sign-in appears only when both OAuth secrets are configured | `feature-flag-google` test |
| A20 | A quote is valid 5 minutes; the server re-prices at placement and returns a diff on mismatch | `quote-reprice` tests (12) |
| A21 | The customer total is always a whole number of taka | Property P2 |
| A22 | The customer is never rounded up | Property P3 |
| A23 | Every fee line has an `explain{}` block showing its derivation | `fee-explain-completeness` (all 7 line types) |
| A24 | Cash on delivery is the only payment method; no payment selector exists | UI assertion + repo grep for payment SDKs |
| A25 | Order states follow the specified machine; illegal transitions are rejected | 100% transition coverage |
| A26 | Pickup orders have zero delivery fee and a ৳20 small-order fee | Vector V04 |
| A27 | A customer can switch to pickup from the no-rider-found path with a full fee refund | E2E `no-rider-pickup-switch` |
| A28 | Tips go entirely to the rider; no commission or tax touches them | Property P12 |
| A29 | Order tracking shows an interpolated rider marker and an explicit staleness state | 19 interpolation tests |
| A30 | A bundled customer is told they are in a bundle and their position in it | Property B8 |
| A31 | Disputes can be raised on any past order with structured evidence | E2E `dispute-flow` |
| A32 | An account can be deleted, removing personal data within 24 hours | `account-deletion` tests (9) |

---

## 4. The alarm (A33–A44)

| ID | Criterion | Proof |
| --- | --- | --- |
| A33 | Every push is **data-only**; no `notification` key exists in any payload | `fcm-payload-purity` |
| A34 | Every CRITICAL message carries `android.priority: "high"` | Same |
| A35 | The alarm fires with the app in the foreground | Test Lab |
| A36 | The alarm fires with the app backgrounded | Test Lab |
| A37 | The alarm fires with the screen locked and the device in Doze | Test Lab with `force-idle` |
| A38 | The alarm fires after the app is swiped from recents on stock Android | Test Lab |
| A39 | **The alarm does not fire after a Settings force-stop, and a test asserts this** | Test Lab `force-stop-asserts-no-delivery` |
| A40 | The alarm loops continuously at maximum alarm volume until answered or the ceiling | `AlarmPlayer` tests (18) |
| A41 | The alarm turns the screen on and shows the order on the lock screen | Instrumented `full-screen-intent` |
| A42 | Audio begins at t=0, never gated on an animation | `alarm-audio-timing` test |
| A43 | A live self-test is available and its result is recorded server-side | 7 tests |
| A44 | A device that fails delivery three times is excluded from dispatch and told why | Dispatch filter 14 tests |

---

## 5. Dispatch and the Brain (A45–A60)

| ID | Criterion | Proof |
| --- | --- | --- |
| A45 | **No external or third-party AI API is called anywhere** | Repo grep for every known AI provider domain + `dependency-licence-and-cost` |
| A46 | Dispatch scoring is deterministic | Property D1 |
| A47 | All 14 hard filters exclude exactly what they should | 14 tests |
| A48 | Exactly one rider can claim an offer under any concurrency | Property D3, including a 50-way race |
| A49 | A rejection requires a reason and is only unblocked when another rider exists | 20 rejection tests |
| A50 | The expansion ladder runs all six steps before any cancellation | Property D10 |
| A51 | Bicycles are never dispatched beyond 4 km | Property D7 |
| A52 | Batching never pushes an order past its promised `eta_max` | Property B1 |
| A53 | A bundle's ৳/km for the rider is never lower than solo | Property P19 |
| A54 | **No monetary field is reachable from `RankInput`** | `anti-ad-invariant` CI job |
| A55 | Personalisation never exceeds 0.22 of the blended rank score | Property R3 |
| A56 | New vendors receive a decaying cold-start boost that reaches zero | Property R4 |
| A57 | A deleted-and-recreated vendor does not regain the boost | Property R5 |
| A58 | Every Brain engine has a tested fallback inside its latency budget | 6 fallback tests |
| A59 | Every Brain decision writes a complete trace | Property D12 |
| A60 | The dispatch benchmark beats nearest-rider on all 8 metrics | `city_sim` nightly |

---

## 6. Fare and money (A61–A76)

| ID | Criterion | Proof |
| --- | --- | --- |
| A61 | Motorbike base rate is ৳14/km, bicycle ৳8/km | Constants test |
| A62 | A 3% order bonus is paid by the vendor to the rider | Vector tests |
| A63 | 15% commission, 5% tax, no listing fee, **no ads or CPC anywhere** | Constants + `anti-ad-invariant` |
| A64 | The small-order fee is ৳25 above a ৳100 post-discount subtotal, split ৳5 rider / ৳5 vendor / ৳15 platform | Vector V04 + property |
| A65 | Surge follows the specified bands, is continuous, and never exceeds 2.2× | Property P7 + a server-side ceiling test |
| A66 | Rain adds 20%, storm 40%, **paid by the platform, never charged to the customer** | Vectors V03, V09 + `customer-bill-purity` |
| A67 | Traffic delay is compensated per 5 minutes | Vector tests |
| A68 | **No float appears in any money path** | `money-integrity` AST check |
| A69 | `applyRate` is identical in Python, TypeScript and Kotlin | 110 000 differential vectors |
| A70 | Every ledger posting set sums to zero | Property P1, 10 000 cases |
| A71 | A rider's displayed offer payout can only increase after acceptance | Property P23 |
| A72 | `rider_payout ≥ min_payout` always | Property P4 |
| A73 | The delivery fee is monotonic in distance | Property P6 |
| A74 | The taxable base is the platform's fee revenue only | [`24 §2.3`](24-finance-payouts-invoices.md) invariant test |
| A75 | The rider bonus never appears as a platform expense on an ordinary order | Same |
| A76 | Every customer-facing total is reproducible from the stored snapshot | `receipt-reproducibility` (200 cases) |

---

## 7. Payouts and invoices (A77–A90)

| ID | Criterion | Proof |
| --- | --- | --- |
| A77 | **No cron exists anywhere in the application** | `no-cron` CI job |
| A78 | Invoices are generated by a period-boundary check on ordinary requests | 14 trigger tests |
| A79 | Regenerating an invoice produces an identical `content_hash` | 1 000 determinism cases |
| A80 | A closed period cannot be modified | 9 trigger tests |
| A81 | Riders are paid Friday, vendors Saturday | Period configuration tests |
| A82 | Payouts require admin `VERIFIED` then `PAID`, with step-up TOTP on `PAID` | 22 lifecycle tests |
| A83 | The bKash export includes the cash-out charge so the recipient gets the full amount | 11 export tests |
| A84 | Invoice PDFs are branded, chart-bearing, and **under 1 MB** | 24 PDF tests |
| A85 | PDFs are hosted on Cloudinary and delivered by signed URL | Media tests |
| A86 | A rider with outstanding cash cannot have an invoice marked `VERIFIED` | 12 tests |
| A87 | A payout-account change holds payouts for 72 hours | 8 tests |
| A88 | A payout run cannot close with unresolved reconciliation | 18 tests |
| A89 | Cost attribution follows the published table | 13 tests |
| A90 | Rider liability for losses is capped at ৳300/week | Attribution tests |

---

## 8. Cash settlement (A91–A99)

| ID | Criterion | Proof |
| --- | --- | --- |
| A91 | The settlement screen blocks going online until admin approval | 19 scope tests |
| A92 | **It never blocks SOS or the phone's dialler** | 6 tests |
| A93 | It never appears while an order is active | Trigger tests |
| A94 | A tick sounds every 4 seconds and stops on typing and permanently on submit | 9 tests |
| A95 | The rider sends the settlement plus the cash-out charge and is reimbursed, netting zero cost | 10 arithmetic tests |
| A96 | A TrxID can never be reused | Uniqueness test across full history |
| A97 | **The block auto-lifts if review exceeds 2 hours** | 4 tests |
| A98 | Every "I can't settle" path lifts the block | 16 tests |
| A99 | Every settlement path closes the ledger | 12 tests |

---

## 9. Presence and tracking (A100–A110)

| ID | Criterion | Proof |
| --- | --- | --- |
| A100 | **Offline detection p95 ≤ 2 000 ms** on both coordinator backends | 1 000-loss latency test |
| A101 | A reconnect within 1 500 ms produces no state change | 9 flap tests |
| A102 | A vendor unreachable for 2 minutes after an order triggers auto-cancel with the exact reason | 22 ladder tests |
| A103 | An acceptance at any ladder step halts it | Property S9 |
| A104 | The auto-cancel records a complete evidence block | 7 tests |
| A105 | The D1 channel opens on shift start or order accept | 16 coupling tests |
| A106 | The D1 channel is erased on every shift-ending path | Property S3 |
| A107 | **No position exists for an off-shift rider** | Property S4 |
| A108 | Positions are sent only on ≥ 100 m displacement or a state change | Cadence tests |
| A109 | D1 writes per delivery ≤ 54 | Property S10 |
| A110 | `ACCESS_BACKGROUND_LOCATION` is never requested | Manifest assertion |

---

## 10. Vendors and riders (A111–A126)

| ID | Criterion | Proof |
| --- | --- | --- |
| A111 | Prep time is set with +/− controls, defaulting to the Brain's prediction, max 200 minutes | 18 tests |
| A112 | The rider sees every order detail before accepting | Offer card snapshot tests |
| A113 | Pickup requires scanning the vendor's QR within 150 m | 22 QR tests |
| A114 | The QR rotates every 60 s and expires after 4 h | QR tests |
| A115 | Navigation hands off to Google Maps in one tap, with fallbacks | 11 tests |
| A116 | A shift cannot start without a verified selfie | 18 selfie tests |
| A117 | Bicycles are locked to a 3–4 km radius, motorbikes 4–10+ km | Dispatch filter tests |
| A118 | Vendors and riders are Android-only; iOS users are told so and routed to the web | Web console tests |
| A119 | Onboarding covers all four tracks with every specified field | 184 validation tests |
| A120 | 118 cuisine categories exist with search across both scripts | 48 search tests |
| A121 | The location step uses an OSM map with pin, search and current location | 9 tests |
| A122 | The 4h/day, 5 days/week commitment is tracked and shown, not enforced as a lockout | Shift tests |
| A123 | A duplicate NID blocks registration | 16 duplicate tests |
| A124 | An expired licence blocks a motorbike rider from going online | 12 expiry tests |
| A125 | Partial rejection resumes at exactly the failed fields | 14 tests |
| A126 | A sandbox order lets a vendor rehearse their first alarm | 7 tests |

---

## 11. Admin panel (A127–A140)

| ID | Criterion | Proof |
| --- | --- | --- |
| A127 | **2 147 features are registered, each with a passing test** | `feature-register` CI job |
| A128 | All 9 domains are implemented | Route coverage |
| A129 | RBAC covers 412 keys across 7 system roles | 2 884 matrix assertions |
| A130 | Every mutation writes an audit row | `audit-coverage` CI job |
| A131 | The audit log is WORM with a verified hash chain | 15 tests |
| A132 | 23 sensitive actions require step-up TOTP | 23 tests |
| A133 | Impersonation is read-only and cannot write | 11 tests |
| A134 | Admins draw zone polygons on an OSM map with 12 templates | 24 editor tests |
| A135 | **A full-screen OSM super map shows all active riders, vendors and customers** | Map tests |
| A136 | Markers are unique bespoke SVGs with distinct states | 34 marker tests |
| A137 | Tapping a marker opens a deep-detail panel with orders, route and contact | 28 panel tests |
| A138 | The map holds 60 fps with 1 000 markers | Performance test |
| A139 | 22 exception triggers fire on their conditions and only those | 22 tests |
| A140 | The Brain Lab requires a replay before any weight change is saved | 9 tests |

---

## 12. Web and SEO (A141–A150)

| ID | Criterion | Proof |
| --- | --- | --- |
| A141 | Every pre-rendered route serves real content with JavaScript disabled | `prerender-verify` |
| A142 | The domain is configurable via an Actions secret | Build configuration test |
| A143 | App Links open the installed app for all 14 claimed paths | 28 tests |
| A144 | `assetlinks.json` matches the release keystore fingerprint | Post-deploy CI check |
| A145 | Unclaimed paths open the browser | 5 tests |
| A146 | Structured data validates for every page type | Schema validation |
| A147 | Lighthouse ≥ 95 in all four categories on every public route | `lighthouse-budget` |
| A148 | The website supports complete ordering, including for iOS users | 48 E2E journeys |
| A149 | Sitemaps are complete with real `lastmod` values | 5 tests |
| A150 | Social cards render correctly on WhatsApp and Facebook | Scraper validation |

---

## 13. UI, UX and quality (A151–A166)

| ID | Criterion | Proof |
| --- | --- | --- |
| A151 | **Zero structural break from 200 px to 3 840 px** | 56 600 responsive renders |
| A152 | 50 widths are tested per screen in both themes and both languages | `responsive-matrix` |
| A153 | No fixed pixel width above 64 outside the allowlist | `no-fixed-width` |
| A154 | Every touch target is ≥ 48 dp (44 px on web) | Responsive matrix assertion |
| A155 | Animation never drives a layout property (3 documented exemptions) | `no-layout-animation` |
| A156 | `prefers-reduced-motion` is honoured on every animated surface | 44 tests |
| A157 | Zero serious or critical accessibility violations | `a11y` |
| A158 | All 44 empty states render correctly in both themes and languages | 176 tests |
| A159 | **The empty-platform test passes: 283 screens on a zero-row database** | `empty-platform` |
| A160 | No placeholder, lorem ipsum, TODO or fake data exists in shipped code | `no-placeholders` |
| A161 | No seed or demo business data exists in any migration | `no-seed-data` |
| A162 | Every string exists in both English and Bengali | `i18n-completeness` |
| A163 | Bengali typography uses the 1.07× optical multiplier and correct line breaking | 18 tests |
| A164 | Currency uses lakh/crore grouping | 5 000 value tests |
| A165 | Cold start ≤ 1 400 ms on a Redmi Note 10 | Macrobenchmark |
| A166 | Every file is ≤ 700 lines | `line-budget` |

---

## 14. Process and operations (A167–A178)

| ID | Criterion | Proof |
| --- | --- | --- |
| A167 | **Every operation is possible from a browser; no local tooling is required** | `no-local-tooling` |
| A168 | 23 workflows exist and run green | Actions |
| A169 | The release keystore is generated by Actions and never stored as an artifact | `generate-keystore.yml` |
| A170 | Signed `.apk` and `.aab` are produced for all three apps and are downloadable | `android-release.yml` |
| A171 | Migrations are forward-only, online-safe and idempotent | 12 migration tests |
| A172 | Schema drift is detected | `verify-schema.yml` |
| A173 | All 44 secrets are documented in `.env.example` | `env-example-complete` |
| A174 | No secret appears in any built artifact | Artifact scan |
| A175 | Every file carries the PASVL licence header | `license-headers` |
| A176 | All 30 guardrails pass, each with a fixture proving it can fail | 60 fixtures |
| A177 | A deploy failure rolls back automatically | Rollback test |
| A178 | Every documented feature has a code reference and every public module has a doc comment | `doc-coverage` |

---

## 15. The end-to-end criterion (A179)

| ID | Criterion | Proof |
| --- | --- | --- |
| **A179** | **A real order can be placed, accepted, dispatched, bundled, picked up with a QR scan, tracked live, delivered with cash collected, settled, invoiced and paid — end to end, on real infrastructure, with correct money at every step** | The `full-lifecycle` E2E journey, run nightly against the preview environment, asserting 41 intermediate states and a ledger that closes to zero |

This is the one that matters. The other 178 exist so that this one can be trusted.

---

## 16. Reading on

Next: [`37-feature-register.md`](37-feature-register.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
