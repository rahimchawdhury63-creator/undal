# 07 — Two analysis turns, thirty build turns, and release acceptance

## A. Execution protocol and progress ledger

This is a **32-response plan**: two understanding/design responses and thirty planned implementation responses. Each response ends with real evidence and stops for **Continue**. The current deliverable is this prompt/specification bundle, not the execution of these stages.

The future agent must use actual repository files and tools, not merely narrate code it would write. Work in bounded vertical slices, keep hand-maintained files ≤500 lines, preserve existing work and references, and update `docs/progress.md` after each stage. Temporary scaffolding may exist during development but is not a completed feature or releasable placeholder; never expose inert navigation as production functionality.

Progress records include stage/response number; requirement/feature IDs; completed behavior; files changed; migrations/config/policy changes; actual test commands/results; evidence paths; unexecuted checks; dependency/free-tier impact; approved deviations; release blockers; and exact next stage. Record `not-run`/`blocked_external` when the necessary provider/device/approval is unavailable. Never turn a test plan into a passed-test claim.

Thirty implementation turns are a planning budget, not a correctness guarantee. Repair a failed critical gate before building dependent behavior, document any slip, and preserve a truthful backlog if the budget is insufficient. Do not invent completion or sacrifice tests to fit a fixed response count.

## B. Understanding and design stages

### ANALYSIS-01 — Response 01: product understanding and reference review

Inspect repository guidance, branch state, all supplied images and inventory. Produce `docs/understanding.md`, journey maps, glossary, initial feature catalogue, screenshot-to-screen map, scope/exclusion register, uncertainty register, required policy decisions and risk register. Explain the food-only/grocery conflict, home-kitchen pickup restriction, no-ads/COD boundaries, free limits, Android force-stop, the approved private-R2 replacement for unsafe SVG/database storage, R2 billing/authorization limits, tax/bonus ambiguity and browser-only setup boundary.

Acceptance: all 130 files accounted for, six duplicate pairs identified, black/low-resolution/marketing references marked honestly, no source PII copied, no unsupported competitor-internals claims, no application implementation begun. Use the existing analysis as a starting point but inspect originals where needed rather than asserting unperformed review.

### ANALYSIS-02 — Response 02: contracts, architecture, and testable plan

Produce architecture decision records; data ownership; exact three-Worker topology and SQLite DO scheduler; schema/index/RLS design; order/offer/cash/invoice state machines; normalized money/fare contracts and golden fixtures; RTDB paths/rules/indexes; OAuth/session/MFA design; secret/R2-binding map; private-object authorization and partial-failure lifecycle; threat model; notification/device feasibility matrix; free-capacity calculator; CI/signing/domain strategy; acceptance traceability; and ordered build plan.

Acceptance: unresolved legal/provider/device items are explicit blockers; rate/base/rounding and COD pickup accounting are defined; no cron-free magic, fourth Worker, public private-doc storage, fake phone verification, paid dependency, unlimited-free claim or untestable “AI” label. The plan identifies recovery for a SQL-commit/DO-nudge failure and actual free quotas needing verification.

## C. Thirty implementation stages

Each row represents one planned implementation response. Tests listed here are required work, **not already executed results**.

| Stage / response | Implemented slice and artifacts | Required acceptance/evidence before marking complete |
| --- | --- | --- |
| BUILD-01 / 03 | Monorepo/workspace, pinned compatible toolchains, strict analyzers, contracts/unit libraries, shared visual tokens, five client shells/three Worker entrypoints, isolated test infrastructure and baseline Actions validation. | Clean reproducible builds/type/lint checks; CI runs without production secrets; generated-source exclusions documented; no demo business seeds, committed secrets or oversized maintained files. Shells are WIP, not completed features. |
| BUILD-02 / 04 | Supabase base migrations, identities, permission/membership model, profiles, audit/event foundation and RLS/grants. | Migration up/repeat checks; role matrix negative tests; writable metadata cannot grant roles; service RPC authorization and cross-tenant constraints tested. |
| BUILD-03 / 05 | PostGIS zones/eligibility, polygon validation/templates, policy-version storage, protected zone APIs and initial admin map/editor workflow. | Boundary/overlap/hole/invalid polygon tests; no degrees-as-km pricing; scope/MFA guards; version change impact and out-of-zone handling tested. |
| BUILD-04 / 06 | Secure public imgbb upload adapter, private Cloudflare R2 Standard evidence storage, Supabase file metadata/RLS, existing-Worker R2 gateway, vendor/rider application drafts/document requirements and reviewer workflow. | Byte/type/size/auth/rate/byte-reservation tests; raw r2.dev/custom-domain exposure disabled; cross-tenant/role-revoked/anonymous R2 gateway reads denied; no SVG/private-public leak; local R2 adapter tests separate from live-provider tests; incomplete/expired docs/review access/partial-upload cleanup tests. |
| BUILD-05 / 07 | Real Supabase auth across apps/web, Google adapter, ten disabled-but-real provider integrations/config registry, phone-alias decision, MFA/session/recovery and one-time admin bootstrap. | Login/reset/logout/revocation and AAL2 tests; missing SMTP/provider credentials explicitly blocked; no fake phone verification or privileged role on signup. |
| BUILD-06 / 08 | Partner business profile/hours/staff and complete menu/category/variant/modifier/bundle CRUD with availability and image ownership. | Tenant/staff permissions; contradictory modifiers; out-of-stock bundle; historical snapshot safety; schedule/overnight/exception validation; public/private address tests. |
| BUILD-07 / 09 | Customer web discovery/vendor/menu screens, real taxonomy/search/filters/favorites and initial static-public prerender. | Actual SQL-backed queries; real empty state; no-JS vendor content; safe pagination; query/filter results match data; food-only/no-ad layout and accessibility checks. |
| BUILD-08 / 10 | Customer Android discovery/vendor/item/address/location journeys using the same contracts and original bilingual design. | Widget/integration tests, permission denial/manual pin, zone validation, text scaling and offline/stale presentation; no fake location/menu fallback. |
| BUILD-09 / 11 | Multi-cart/single-vendor checkout model, item pricing/modifiers, promotions/funding reservations, expiring quote API and checkout UI. | SQL/TS/Dart golden values agree; stale quote/menu/budget rejected; repeated cart mutation correct; discounts counted once; no arbitrary client total. |
| BUILD-10 / 12 | Balanced ledger/accounting core, approved policy readiness, immutable price/event snapshots, COD custody accounts and reversal/allocation functions. | Property tests for balance/rounding/refund limits; delivery and vendor-retained pickup vectors reconcile; unresolved tax classification blocks live configuration. |
| BUILD-11 / 13 | Transactional order placement/idempotency, inventory/promotion reservations, lifecycle/event APIs, cancellation rules and customer order timeline/history. | Concurrent checkout/retry/stock/accept-cancel tests; one committed order/key; persistent 120s vendor deadline; no delivered-history erasure by dispute. |
| BUILD-12 / 14 | SQL outbox consumers, Firebase Auth bridge, RTDB projections/rules/indexes, native/web subscription lifecycle, SQLite DO clock/deadline/retry/recovery infrastructure. | Emulator deny tests; monotonic projection versions; lost nudge/consumer crash/duplicate event/retry exhaustion recovery; private roots denied; no fourth Worker/cron. |
| BUILD-13 / 15 | Native partner/rider data-only FCM service, channels, token registry, readiness UX, permitted bounded looping alerts, receipt/dedup/expiry and service lifecycle. | Payload contains no notification object; unit/emulator tests plus available physical-device results; actual priority/deprioritization handling; force-stop and unavailable-device checks labelled honestly. |
| BUILD-14 / 16 | Partner live queue, acknowledgement versus acceptance, preparation suggestions/+/-/1–200-minute controls, ready state, offline pause/re-check-in and rejection/support. | Two simultaneous orders, stale alert, closed hours, duplicate acceptance and delay updates; 120s timeout reason correctness; prep bounds enforced server-side. |
| BUILD-15 / 17 | Rider application completion, approved shift/readiness, Android location lifecycle, vehicle/cash/zone eligibility, availability states and operational UI. | Permission/reboot/off-shift tests; no background tracking off shift; stale location/cash cap removes eligibility; native service declarations and privacy disclosure reviewed. |
| BUILD-16 / 18 | Permitted route/geocode adapters/cache, vehicle profiles, exact fare engine/supply/weather/traffic policy and customer fee separation. | All fare vectors/boundaries/no-rider cases pass; no double 0–2km charge; route outage/unknown weather blocks unavailable quote; actual provider free terms/limits recorded. |
| BUILD-17 / 19 | Bounded rider candidate selection, explainable dispatch score, SQL offer reservation/accept/reject/expire/revoke and rider offer UI. | Two-rider acceptance race has one winner; reasoned safe decline always possible; stale assignments revoked; guaranteed fare immutable; pre-acceptance PII minimized. |
| BUILD-18 / 20 | Two-order batch feasibility/stop sequencing, consent, guarantee/allocation, detour/deadline enforcement and unbatch/reassign exceptions. | Same/near/far customers, unequal prep, cancellation, cash/vehicle cap, extra pickup and later add-on tests; no common-leg double pay or silent reduction of accepted earnings. |
| BUILD-19 / 21 | Secure vendor QR, rider camera redemption, restaurant customer-pickup handover, delivery confirmation and COD collection effects. | Wrong rider/order/expiry/replay/reassignment/cancel race tests; pickup vendor retained cash correctly accounted; unauthorized completion impossible; cash not inferred from QR alone. |
| BUILD-20 / 22 | End-to-end live tracking, presence leases, reconnect/re-check-in, admission/tab coordination, freshness/status UI and deadline reconciliation. | Offline/partition/recents/dead battery scenarios; 2s suspect versus lease expiry distinct; customer sees only own order; quota mode changes do not fake new GPS. |
| BUILD-21 / 23 | Durable scoped chat/read/typing, support cases, private dispute evidence and customer-unavailable/incident workflows. | Membership expiry/cross-order access denied; duplicate messages deduped; unread/history pagination works; support access audited; private attachments never imgbb. |
| BUILD-22 / 24 | Rider cash-due screen, sender/reference/selfie/proof submission, manual remittance review, cash exposure/shortfall/dispute handling. | Submission ≠ receipt verification; duplicate/forged reference, partial amount, rejected evidence and appeal tested; emergency/current-order/support access stays available. |
| BUILD-23 / 25 | Friday/Saturday no-cron settlement alarms, period closing/catch-up, immutable invoices, branded Bangla/English PDF pipeline, private R2 invoice objects and authenticated Worker downloads. | Duplicate/missed alarm/outage/cutoff/late event tests; one invoice/party/period; PDFs match canonical poisha totals and shape fonts correctly; failures remain visible. |
| BUILD-24 / 26 | Admin finance verification/payment approval, manual transfer references/fees, payout account change review, credit notes and audited support refunds. | Maker/checker/AAL2/paid-race tests; actual payment remains manual; no auto paid from screenshot; statutory liability separation; vendor pickup net receivable reconciled. |
| BUILD-25 / 27 | Verified reviews/replies/moderation/appeals, ten-stage organic ranking, opt-in Flash/full-menu promotions, consent/frequency-capped reminders and relevant reorder. | No paid rank/CPC; sample-size fairness; fake/duplicate review prevention; privacy-safe personalization; campaign budget/expiry/funding and reminder opt-out tested. |
| BUILD-26 / 28 | Full admin order/fleet/support/onboarding/analytics/config/recovery workspaces and partner/rider operational reporting. | Every visible metric sourced/defined; real empty heatmaps; scoped exports; safe manual interventions; no dead destinations or arbitrary privileged overrides. Catalogue actual features without count inflation. |
| BUILD-27 / 29 | Full responsive/accessibility/i18n polish, public route publication, no-JS SEO/404/canonical/sitemap, App Links/downloads and domain migration support. | Representative widths/large text/keyboard/readers; no private prerender; installed/uninstalled link tests; correct default-origin CORS; real certificate assetlinks checks. |
| BUILD-28 / 30 | Adversarial security review, quota/capacity/load tests, chaos/reconciliation, backup restore, mobile battery/network resilience and final gap remediation. | No open critical issues; measured limits and degradation; actual Worker CPU/DO/request/SQL/R2 storage-and-operation budgets; no loss/duplication of financial effects after outages; physical-test blockers explicit. |
| BUILD-29 / 31 | Hardened browser-only provisioning/deploy/recovery workflows, persistent signing bootstrap/restore, three signed APK/AAB releases, provenance and operator documentation. | No local owner commands; protected secrets and stable keys verified; clean install/update/signature/bundle checks; default/custom-domain smoke; artifacts downloadable with controlled retention. |
| BUILD-30 / 32 | Full cross-client regression, requirements/evidence reconciliation, controlled operational pilot where authorized, incident drill and final go/no-go report. | All critical gates below pass or platform is explicitly not launch-ready; no missing setup/device/legal check disguised as passed; publish tested capacity/support matrix and truthful remaining backlog. |

## D. Requirements-to-evidence matrix

Maintain a machine-checkable/markdown traceability matrix with requirement ID, risk/priority, implementation paths, migration/policy version, unit/integration/E2E/security/device tests, environment/date, evidence artifact and status. Cross-platform duplicates point to shared business tests plus platform UX tests; they do not inflate feature counts.

Minimum critical test families:

| Family | Required invariants/scenarios |
| --- | --- |
| AUTH/RBAC | JWT signature/audience/expiry; forged metadata role; cross-vendor/customer/zone access; admin MFA bypass; phone alias enumeration; revoked connected session; disabled OAuth enforcement. |
| CATALOG/CART | Variant/modifier constraints; bundle stock; menu deletion after purchase; safe reorder; stale price/quote; one-vendor checkout; eligibility/availability filters actually work. |
| ORDER/CONCURRENCY | Duplicate tap/key; transaction rollback; simultaneous accept/cancel/timeout; expired vendor ack; stock/campaign race; no assignment on unaccepted order. |
| REALTIME | Default-deny rules; bounded path/query; no broad root read; monotonic versions; reconnect/tab overlap; stale projection; missing outbox nudge; consumer/alarm retries. |
| ANDROID | Data-only schema; token refresh/logout; foreground/background/OS reclaim/recents/locked/Doze; actual priority; muted/denied; force-stop negative case; multiple pending orders and expiry. |
| DISPATCH/FARE | Zero orders/riders; SDR boundaries; included kilometres; traffic steps; weather/heat unknown; route failure; freshness; concurrent rider accept; safe decline; batch precedence/detour/guarantee. |
| HANDOVER/CASH | QR forgery/replay/wrong rider/cancel; pickup without rider; exact COD; duplicate collection; private remittance evidence; submitted vs verified; cash-due support/safety access. |
| FINANCE | All signed journals balance; integer precision; remainder allocation; vendor/platform discount attribution; statutory liability; pickup cash offset; no duplicate payout; partial refunds/credit notes/late cutoff. |
| INVOICE/PDF | Friday/Saturday Dhaka boundaries; DST-independent timezone logic; duplicate/missed alarm/catch-up; watermark consistency; font shaping; pages/totals/hash; access denied to another party. |
| PRIVACY/MEDIA | Credential never bundled/logged; SVG/active file rejected; private R2 r2.dev/custom-domain denial; Worker object permissions for GET/HEAD/Range/delete; revoked role blocked; any optional presigned bearer expiry/reuse limitations documented; upload/quota reservations; SQL/R2 failure cleanup; URL/SSRF injection; retention and backup privacy. |
| WEB/SEO | No-JS public content, correct 404/canonical/metadata, no private index/cache, keyboard/focus, bilingual critical copy, 200px constrained fallback and realistic device reflow. |
| OPS/RELEASE | No paid service assumptions; account-wide quota arithmetic; alarm/outbox safe mode; encrypted restore; stable signing key/update; wrong cert rejected; browser-only setup; no untrusted PR secret access. |

Use deterministic isolated fixtures, emulator projects and fake clocks for repeatability. They are legitimate test tools, not production demo data. Never write synthetic actors/orders/funds into live production to fill UI. Real-provider and manual-transfer tests require explicit authorization and consented real evidence.

## E. Quality gates and measurable SLOs

### Gate 1 — Product and policy completeness

Approved food/COD/no-ads scope; correct vendor-type modes; all in-scope user journeys mapped; no inert buttons or undisclosed paid dependencies. Legal/finance decisions, identity/retention obligations, payout-provider terms and safety policies are approved/versioned. Unresolved 5%/3% classification blocks financial launch.

### Gate 2 — Financial correctness

All critical ledger/property/concurrency tests pass. Every posted journal balances; SQL/TS/Dart vectors match exact poisha; vendor-retained pickup cash reconciles; promotions are attributed once; guaranteed rider earnings are preserved; invoice periods/late adjustments are deterministic; no duplicate verified remittance or payout; PDF amounts equal immutable source data. “100% accurate” is limited to tested invariants, not all future real-world fraud/accounting events.

### Gate 3 — Security and privacy

RLS/RTDB/API/private-R2 gateway negative tests pass; admin AAL2 and scopes enforced; no committed/bundled credentials; private evidence stays private in R2 with both raw public paths disabled; Supabase RLS is not misrepresented as R2 authorization; QR replay blocked; revoked users lose access; critical/high findings resolved or explicitly evaluated under an approved policy. Tamper-evident logs are not mislabelled WORM; no absolute security claim.

### Gate 4 — Android capability evidence

Record actual results for supported Android/OEM/network states, notification/audio permissions, service lifecycle, killed-process versus force-stop and off-shift tracking. Unsupported states are disclosed in onboarding/operations. Lack of hardware cannot become a “passed” device check; operator launch decisions identify the tested device fleet.

### Gate 5 — Performance and free-tier envelope

Choose numeric SLOs in Analysis 2 and validate at the declared geography/load/network/provider setup. Suggested **targets to evaluate**, not guarantees: API p95 ≤1s for ordinary non-upload operations; commit→projection p95 ≤2s under healthy nudge processing; healthy supported-device push receipt p95 ≤5s; live tracking cadence about 5s with p95 displayed age ≤15s. Revise honestly if measurements/provider limits cannot support them and explain business consequences.

Measure latency components separately, with p50/p95/p99, sample count, warm/cold conditions, test data size and CPU/quotas. Two-second suspect UI, lease-based authoritative eligibility and the 120-second order deadline are different metrics. Test degraded/exhausted quotas—including concurrent R2 uploads, byte reservations and Class A/Class B consumption—and demonstrate safe refusal/degradation instead of claims of unlimited zero-latency capacity. Verify R2 Standard-only configuration, account subscription setup and the absence of any unapproved billable storage feature; do not claim quota alerts are a hard provider spending cap.

### Gate 6 — Recovery and operations

SQL commit without nudge, RTDB outage, FCM failure, alarm retry exhaustion, invoice cutoff outage, routing quota loss, key rotation and encrypted backup restore have tested recovery paths. No duplicate financial effects or assignment corruption. The owner can perform setup/release/recovery from a browser and knows which tasks require human legal/MFA/permission/payment approval.

### Gate 7 — Web, release, and documentation

Responsive and accessible interfaces work for the declared widths/devices/locales. Indexed routes have real no-JS HTML; private data never prerendered/cached. Three release APKs and three AABs have stable verified signing identities and checksums. App Links work in tested supported conditions with web fallback. Full secrets/config/domain/signing/recovery guides and a factual feature catalogue exist.

## F. Evidence layout and final report

Suggested evidence paths: `docs/evidence/automated/`, `docs/evidence/security/`, `docs/evidence/finance/`, `docs/evidence/performance/`, `docs/evidence/android/`, `docs/evidence/deploy/`, plus private external artifact references for sensitive material. Commit only small redacted summaries/configuration-safe hashes, not customer data, KYC, keys, production dumps or huge build artifacts.

The final report states: implemented and excluded scope; exact deployed/package/schema/policy versions; actual provider plan verification dates; approved finance rules; test counts/results; physical-device matrix and not-run checks; SLO measurements; supported free-capacity envelope/headroom; open risks/blockers; operator runbook links; artifact download locations/checksums; backup/signing recovery status; and an explicit **GO / LIMITED PILOT / NO-GO** conclusion.

Say “production-ready for the tested configuration, supported device states, approved policies and stated capacity” only after all critical gates pass. Never state “world's best,” “every possible case covered,” “every line manually tested,” “unlimited free,” or “always instant even force-stopped” as an achieved fact.
