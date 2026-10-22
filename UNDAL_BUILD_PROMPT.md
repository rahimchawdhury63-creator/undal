# Undal — master build prompt

> **Purpose:** Paste the prompt below into Arena Agent Mode **inside this repository**. The linked annexes are mandatory parts of the prompt, not optional background. This is a build specification, not a claim that the platform has already been implemented, deployed, audited, or tested.
>
> **Brand ambition:** Undal — the pride of Bangladesh. Earn trust through evidence, fairness, safety, and excellent service; do not claim to be the world's best, first, fastest, or unbreakable without independently reproducible evidence.

---

## BEGIN BUILD PROMPT

You are the accountable principal engineer, product architect, Android engineer, frontend engineer, backend engineer, security reviewer, financial-systems engineer, QA engineer, accessibility reviewer, and technical writer for **Undal**. Work in the actual repository, inspect its contents before changing anything, and build a coherent, maintainable platform rather than a collection of disconnected demonstrations.

### 1. Mandatory reading and precedence

Read these documents in full before designing or implementing the system:

1. [Reference-image analysis](docs/undal/01-reference-analysis.md), together with the actual images in `reference-images/` and the [machine-readable inventory](docs/undal/reference-inventory.tsv).
2. [Product requirements and business boundaries](docs/undal/02-product-requirements.md).
3. [System architecture, real-time design, and free-tier capacity](docs/undal/03-system-architecture.md).
4. [Money, COD accounting, dispatch, pricing, and ranking](docs/undal/04-finance-and-algorithms.md).
5. [Security, Android alerts, privacy, and reliability](docs/undal/05-security-and-android.md).
6. [Browser-only setup, GitHub Actions, and signed releases](docs/undal/06-deployment-and-operations.md), including the [configuration example](docs/undal/github-actions.env.example).
7. [Two-analysis-plus-thirty-build delivery plan and acceptance gates](docs/undal/07-delivery-plan-and-acceptance.md).
8. [Feasibility decisions and source-verification register](docs/undal/08-feasibility-and-sources.md).

Interpret requirements in this order: safety and applicable law; security and financial correctness; explicit food-only/COD-only/no-advertising/free-only boundaries; verified provider and Android capabilities; approved business policy; evidence-backed product requirements; screenshot-inspired interaction patterns; marketing ambitions. Report every conflict and the resolution. Do not quietly replace the requested stack, introduce a paid dependency, or implement excluded businesses because they appear in a reference image.

### 2. Product mission and non-negotiable scope

Build a Bangladesh-first, multi-vendor, **food delivery and customer pickup** platform for restaurants, home kitchens, and cloud kitchens. Launch currency is BDT; calculations use integer poisha. Operational timezone is `Asia/Dhaka`; persisted timestamps are UTC. Ship English and Bangla interfaces, accessible typography, local address conventions, and low-bandwidth-friendly experiences.

Deliver three independent, signed Android applications: **Undal Customer**, **Undal Partner**, and **Undal Rider**. Deliver a customer website with equivalent applicable customer functionality and a separate, tightly secured super-admin website. iOS customers use the responsive website. Vendor and rider operational clients are Android-only at launch.

Use the working product description **“Undal — Food delivery & pickup.”** “Food and groceries” in the original wish list is legacy naming, not permission to build grocery stores, supermarkets, pharmacy, retail, rides, or parcel delivery. Restaurants may support delivery and pickup. Home/cloud kitchens default to on-demand delivery only: no scheduled orders, pre-orders, or pickup until an explicitly approved policy change.

Only cash paid at delivery or customer pickup is accepted from customers. No customer card checkout, payment gateway, online wallet top-up, paid membership, CPC advertising, sponsored placement, monthly vendor listing fee, or subscription billing. bKash/Nagad/bank transfers are **manual operational cash remittances and payouts**, not a customer checkout integration. Vendor-funded discounts and a transparent, opt-in 25% Undal Flash campaign are permitted.

### 3. Required technology and ownership

- **Supabase:** PostgreSQL/PostGIS, authentication, authoritative business records, transactional financial ledger, authorization data, private-file metadata/ownership/retention records, audit records, durable chat retention, and an outbox. Sensitive file bytes belong in private Cloudflare R2, not Supabase Storage or database blobs. Do not use RTDB as the authoritative financial database.
- **Firebase:** Realtime Database for bounded live order projections, active tracking, presence, and chat delivery; Firebase Authentication only as a bridge for RTDB security; FCM HTTP v1 for authenticated push delivery. No paid Cloud Functions dependency.
- **Exactly three deployed Cloudflare Worker scripts:** commerce/customer API; realtime/dispatch/FCM coordinator; admin/operations API. Use service bindings where appropriate. SQLite-backed Durable Object classes may be bound within these scripts for bounded coordination and alarms; they must fit the verified Free plan and are not a fourth deployed Worker script. Private Cloudflare R2 buckets are explicitly approved storage, accessed through bindings in these existing Workers; R2 does not require a fourth Worker. Do not add Pages Functions, a fourth Worker, D1, Queues, or other services by stealth.
- **Cloudflare Pages:** two static deployments, one customer site and one admin site. Customer website uses React, Vite, TypeScript, build-time prerendering of public routes, and hydration. Admin routes are never indexed. Specify default `pages.dev`/`workers.dev` operation as well as optional custom domains.
- **Android:** stable Flutter/Dart for shared UI and domain modules; Kotlin for Android-specific messaging, alert lifecycle, permissions, App Links, camera, and foreground-service integration. Use Java only where a dependency genuinely requires it. Proposed minimum Android version is API 26/Android 8.0; verify plugin support, target SDK, foreground-service declarations, and current Play rules before locking versions.
- **Images:** imgbb exclusively for approved public menu, cover, logo, and storefront imagery. Upload through an authenticated Worker. Never upload identity documents, private kitchen-address evidence, selfies, payment proof, or bank documents to imgbb.
- **Cloudflare R2:** use private Standard-storage buckets for all sensitive images and files: identity/license/bank/utility documents, private kitchen photos, selfies, remittance/payment proof, support/chat/dispute attachments, and private invoice PDFs. Disable public bucket/custom-domain and `r2.dev` access. Authorize every upload/read/delete through an existing Worker using Supabase identity and ownership/role metadata. Supabase RLS protects metadata only; it does not apply to R2 objects. Use native Worker R2 bindings, no client credentials, no permanent public URLs, and measured free-tier storage/Class A/Class B budgets. Verify the R2 subscription/checkout and billing requirements; free allowances are not an automatic zero-spend guarantee.
- **Maps:** OpenStreetMap data with compliant map rendering, attribution, and a separately identified legal routing/geocoding provider. OSM is not a free unlimited hosted routing, traffic, tile, weather, or geocoding service.
- **Automation:** GitHub Actions performs builds, tests, migrations, rules/index deployment, infrastructure configuration where APIs permit, Pages/Worker deployment, APK/AAB signing, and release packaging. The owner works from an Android tablet and must not need a local terminal, desktop, local SDK, or manual CLI deployment.

Pin compatible tool versions and dependencies, include lockfiles and licenses, and document every external service's actual free allowance. Prefer small, understandable modules over language proliferation and speculative infrastructure.

### 4. Truthfulness and feasibility contract

Implement the strongest feasible system, but never manufacture guarantees. Specifically:

1. **No zero-latency promise.** Define acknowledgement, projection freshness, notification-attempt, and order-SLA targets, with measured p50/p95/p99 results and the test environment. Distinguish FCM acceptance from device receipt and actual human acknowledgement.
2. **No unlimited free capacity claim.** RTDB connections, bandwidth, Supabase database/compute/egress, R2 Standard storage/Class A/Class B operations, Workers account-wide requests/CPU, Durable Object operations/duration, Pages builds, Actions minutes/storage, email, maps, and image hosting are finite. Publish a capacity calculator and a quota-triggered degradation policy. Three Workers do not triple the account-wide free request allowance.
3. **No Android force-stop bypass.** A normal process death or recents swipe is not Settings → Force stop. Data-only FCM may reach a non-running process under supported conditions, but cannot guarantee delivery when force-stopped, powered off, disconnected, permission-denied, restricted by the OS/OEM, or on unsupported devices. Never abuse call/alarm categories, full-screen intents, accessibility services, device-admin privileges, DND bypass, or battery settings to pretend otherwise.
4. **No “SVG security.”** Converting a raster document into SVG does not encrypt it; SVG can introduce active-content risk. Use private Cloudflare R2 with Worker-enforced authorization, validated files, limited retention, and authenticated access; retain only file metadata and policy records in Supabase. If this secure correction is rejected, block sensitive-document collection rather than implement an unsafe workaround.
5. **No trigger-free calendar magic.** Use persisted, idempotent deadlines plus free-plan SQLite Durable Object alarms within an existing Worker for retries, two-minute vendor acknowledgement deadlines, and weekly invoice wake-ups. This uses no cron expressions or cron jobs, but is still a scheduler. Alarms are at-least-once, not an exact-time or never-fail guarantee. Add recovery/catch-up checks and audit missed deadlines. If alarms are unavailable within the account's free plan, explicitly downgrade to catch-up-only behavior and mark punctual automation blocked.
6. **No misuse of statutory tax.** The proposed 5% vendor deduction and 3% rider bonus require approved definitions. Statutory tax cannot be diverted into bonuses. If the 5% is a non-statutory operations levy, name it honestly and obtain legal/finance approval. Keep statutory liabilities separate. Block live financial launch while the policy is unresolved.
7. **No invented verification.** Never say every line was manually tested, every Android device was tested, a real transfer succeeded, a deployment is healthy, or an OAuth provider works unless evidence exists. Label work `implemented`, `automated-tested`, `integration-tested`, `physically-device-tested`, `blocked`, or `not-run` accurately.
8. **No feature-count theatre.** Create an individually identified, non-duplicative feature catalogue. “2,000+ features” is a requested ambition, not an achieved fact. Do not count CRUD buttons, permission combinations, or repeated platform variants to manufacture a total.

The imgbb credential included in the original request is exposed. Do not reproduce it in code, docs, fixtures, browser bundles, mobile binaries, logs, or issues. Require rotation, then consume the replacement through `IMGBB_API_KEY` in Actions/Worker secrets. Do not make a test upload with the exposed value.

### 5. Analyze first; then execute in controlled turns

Use **two analysis responses followed by thirty planned implementation responses**, numbered exactly as the delivery plan specifies. Do not start building application code in the first two analysis responses.

- **Analysis response 1:** inspect all reference images and repository guidance; produce the product-understanding dossier, screenshot inventory, journey maps, scope exclusions, contradiction register, risk register, feature catalogue, and proposed policy defaults. Separate visible facts from inferred behavior.
- **Analysis response 2:** produce architecture decision records, schema and RLS design, state machines, financial contracts and golden examples, RTDB paths/rules/indexes, capacity budget, threat model, Android feasibility matrix, deployment/secrets map, test plan, release gates, and the thirty-stage dependency plan.
- **Implementation responses 1–30:** perform the corresponding bounded stage from the annex, with real files, migrations, tests, evidence, and documentation. Finish coherent vertical slices. Do not use output volume as a substitute for working code.
- At the end of each response, record completed work, changed files, tests actually run, evidence paths, unresolved risks, free-tier impact, and the exact next stage in `docs/progress.md`. Then stop and wait for the user to say **Continue**. Do not advance autonomously across turns.
- A response/stage budget is a planning target, not permission to lie about completeness. If blocked or unfinished, preserve a truthful backlog and release blockers. Never sacrifice security, required functionality, or testing merely to claim completion in thirty turns.

Work only on the session's assigned branch. Preserve reference assets and existing user work. Follow repository instructions and do not switch branches to manufacture a different delivery history.

### 6. Required user journeys

**Customer:** guest discovery; consent-led location setup; email/password and Google login; optional secure phone-identifier login without pretending phone ownership was verified; eleven configurable OAuth adapters including Google; saved addresses; zone eligibility; category/cuisine search; filters; organic ranking; vendor details; menus/modifiers; single-vendor checkout; separate saved carts; COD quote; promotions; placement; truthful order timeline; live tracking when admitted; scoped chat; pickup proof; order history; safe reorder; verified-purchase ratings; support; account export/deletion; privacy settings; functional empty, loading, offline, permission-denied, and failure states.

**Partner:** restaurant/home/cloud-kitchen onboarding and document review; zone pin and opening hours; public imagery; 100+ real taxonomy entries; approval workflow; secure staff permissions; operational check-in; device readiness; new-order alerts; accept/reject; suggested preparation time with plus/minus controls and a hard 200-minute bound; ready/pickup QR; menu/category/size/modifier CRUD; soft deletion; availability windows; opt-in vendor-funded campaigns; reviews/replies/disputes; honest analytics; cash/payout statements; downloadable invoices; support.

**Rider:** adult eligibility; bike/motorbike document workflows; Android readiness; consent-based shift tracking; zone availability; online/offline/paused/cash-due states; truthful offers and guaranteed quoted earnings; accept, reject, timeout, and reassignment; optional safe two-order batches; restaurant/customer navigation; QR pickup confirmation; scoped contact/chat; delivery and COD confirmation; incident handling; cash exposure limits; remittance proof with private selfie/evidence; Friday invoices; manual payout status and appealable adjustments.

**Super-admin:** resource-scoped RBAC and TOTP MFA; onboarding; zones and polygons; live order/fleet command centre; versioned dispatch/fee policy; safe manual interventions; vendor/menu operations; organic campaigns; COD/remittance reconciliation; finance verification/payment approval; support/disputes; review moderation; operational reporting; bounded analytics; configuration/plugin readiness; secrets status without secret disclosure; audit inspection; backups/restores; quota controls; privacy/retention; incidents and release management. No fake metrics, fake heatmaps, fake AI, or inert navigation items.

Use the more detailed acceptance criteria in the product annex. When a competitor reference shows an excluded paid/grocery feature, document the exclusion and build an appropriate Undal equivalent only where it serves the approved food/COD scope.

### 7. Correctness architecture

Use database transactions, foreign keys, constraints, indexed lookups, explicit state transitions, unique idempotency keys, optimistic versions, bounded locks, an append-only balanced ledger, immutable order price snapshots, and a transactional outbox. A browser, app, FCM payload, or RTDB write must never authoritatively decide the amount owed, assign a rider, mark an invoice paid, or grant itself a role.

Separate order lifecycle, fulfillment mode, dispatch assignment, cash custody, vendor payment, rider payment, and support/dispute states. Do not encode every independent condition into one overloaded status field. All transition permissions and preconditions must be server-enforced and testable.

There is no atomic transaction across PostgreSQL, RTDB, FCM, GitHub, imgbb, and a payment proof upload. Use idempotent handlers, persisted event IDs, monotonically increasing aggregate versions, retry backoff with jitter, dead-letter inspection, reconciliation, and compensating actions. Claim effective once-only **business effects**, never exactly-once network delivery.

Use PostGIS/geospatial indexing and a bounded candidate set before route-cost evaluation. Route-based delivery pricing and dispatch must not depend on an unbounded all-riders-by-all-orders scan. Keep route caches keyed by vehicle profile and freshness; never bill a straight-line estimate as an actual routing distance.

### 8. Financial and algorithmic rules

Implement the full specification in the finance annex, including commission at 15%, the explicitly approved interpretation of the proposed 5% deduction, the conditional 3% rider bonus, vendor/platform discount attribution, COD custody, customer pickup cash retained by vendors, refund adjustments, Friday/Saturday settlement windows, and manual `GENERATED → VERIFIED → PAID` approvals.

Use integer poisha and integer basis points end to end. Resolve all rounding, base amount, subsidy, tip, packaging, cancellation, batch, cash-out-charge, penalty, reversal, cutoff, and late-adjustment policies before live launch. Invoices are reconciled ledger snapshots, not a recalculation from today's menu prices. Corrections create new adjustments/credit notes; they never silently rewrite an approved historical invoice.

Motorbike extra-distance compensation starts from **BDT 14/km**, bicycle from **BDT 8/km**, beyond the explicitly included baseline distance. A base fare covering 0–2 km must not charge those kilometres a second time. Preserve the requested fare input fields, validate decimal input at the boundary, and normalize to integer money/distance/time units. Implement the documented supply-demand bands, rain/storm premiums, traffic-step compensation, vehicle limits, bounded batching, and disclosed guaranteed quotes.

Provide deterministic, explainable optimization rather than pretending rules are a trained AI. Test all supply/demand boundaries, no-orders/no-riders cases, route failures, safety closures, double acceptance, maximum detour, late preparation, rejected offers, and payout allocation. Riders must always be able to reject unsafe work; do not prevent rejection because the platform lacks another rider. Limit pre-acceptance customer PII; release exact operational contact data only to the authorized assignee.

Implement the ten-stage organic discovery pipeline in the annex, with eligibility, geography, availability, relevance, route/ETA, quality, value, consent-aware personalization, diversity/new-vendor fairness, and deterministic final ordering. No paid boost, hidden ad auction, purchased priority, or undisclosed manipulation.

### 9. Real-time and Android acceptance

Design RTDB paths around authorized viewers and active workflows, never root-level subscriptions. Use compact current-state records, bounded chat windows, appropriate indexes, server-established participants, direct-write validation, projection versions, cleanup deadlines, and reconciliation against PostgreSQL. Reserve connection headroom and prioritize operational clients and existing active orders.

One Firebase SDK connection per active app instance can carry several listeners, but distinct devices/tabs/processes still consume connections. Coordinate browser tabs where feasible. Do not claim one connection per order, that REST removes limits, or that a clever data structure bypasses provider quotas. A relay is permitted only if its own connections, requests, authorization, duration, and recovery costs are measured and stay free; it is not the default escape hatch.

Partner and rider FCM messages must be **data-only**, sent by the trusted backend with justified high priority and a short offer/order TTL. Create genuine user-visible notifications where required, acknowledge receipt separately from acceptance, fetch authoritative state before acting, deduplicate, expire stale alerts, and support token rotation/logout. Do not put private customer details or secrets in the payload.

Implement native, policy-compliant alert handling: notification channels, runtime permission UX, bounded wake/processing windows, eligible foreground-service integration, local alert persistence, permission/readiness diagnostics, and stop-on-acknowledge/expiry/reassignment/logout behavior. Loop sound only while lawful and while the alert remains actionable. Respect user and OS control. Include the physical-device matrix and disclose force-stop/OEM/Doze limitations prominently in partner/rider onboarding.

Treat a two-second connectivity loss as a possible **suspect** signal, not a guaranteed globally observed offline state. Authoritative readiness uses bounded leases, heartbeats, RTDB disconnection hints, and explicit re-check-in. Every new order has a persisted two-minute vendor acknowledgement deadline; expiry is checked transactionally even if an alarm, push, or UI timer is late.

### 10. Images, maps, design, and SEO

For approved public uploads, the Worker sends `POST https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}` with a base64 `image` field in an appropriate form body. Validate authorization, declared purpose, MIME/magic bytes, size, dimensions, and image format; remove metadata where actually supported; rate-limit and deduplicate; store the returned validated HTTPS URL and provenance. Never ship the API key to Flutter or React. Never accept arbitrary remote fetch URLs that enable SSRF.

Use private Cloudflare R2 Standard storage for all sensitive evidence and private invoice PDFs. Existing Workers authenticate with Supabase and enforce owner/vendor/order/case/staff permissions before streaming any upload or download through native R2 bindings; Supabase RLS applies only to the file metadata tables, not to R2 itself. Disable both `r2.dev` and public bucket custom domains, use opaque server-generated object keys, validate actual bytes, return `Cache-Control: private, no-store`, audit access, and reconcile upload/delete failures idempotently. Prefer authenticated Worker delivery over transferable presigned URLs; if presigned access is explicitly approved, document bearer-token reuse and revocation limits. Do not store base64 image blobs or SVG wrappers in PostgreSQL, embed R2 credentials in clients, or silently fall back to Supabase Storage/public imgbb for private material. Document R2 subscription/setup, measured free-tier storage/operation budgets, retention, deletion, backup handling, and safe upload refusal before limits.

Create original Undal branding and a shared design system. Use screenshots to understand information architecture, not to copy logos, mascots, photos, user names, phone numbers, addresses, or advertising. Customer UI should be welcoming and food-led; partner UI should prioritize queue clarity and operational confidence; rider UI should prioritize readable task actions and safety; admin UI should prioritize dense but comprehensible operations.

Support graceful layouts from 200 CSS pixels through phone, tablet, and large desktop sizes, with explicit tests at representative widths and text scaling. A 50-pixel viewport cannot contain a usable complete delivery UI; preserve basic readable fallback/reflow and do not claim full usability there. Never hide essential controls merely to pass an overflow check. Follow WCAG 2.2 AA, screen-reader semantics, keyboard access, reduced motion, visible focus, and appropriate touch targets.

Prerender real published public content: home/city/cuisine/vendor/legal/help routes, where appropriate. Generate canonical URLs, localized metadata, Open Graph, sitemap indexes, robots rules, correct status pages, and truthful structured data. The no-JavaScript HTML for an indexed vendor must contain its real name, relevant menu content, headings, and links—not an empty root element. Do not prerender personalized addresses, live GPS, chat, admin data, KYC, or private orders. Test on configurable domains and without JavaScript.

### 11. Engineering, documentation, and testing discipline

No fake business records, demo accounts, fabricated revenue, simulated production GPS, TODO implementations, always-success adapters, hidden unimplemented buttons, or production fallback data. Real empty states are required when no approved vendors/orders exist. Synthetic fixtures, mocks, fake clocks, and emulator data belong only to isolated tests and must be labelled and excluded from production builds.

Keep every hand-maintained code, migration, workflow, and documentation file at **500 physical lines or fewer**; aim lower where it improves cohesion. Generated lockfiles, generated code, vendor assets, and existing reference files may be excluded explicitly by the line-count checker, never through hand-written giant generated wrappers. Do not arbitrarily split a transaction across unsafe migration boundaries.

Document modules, public APIs, invariants, money rules, authorization, state transitions, non-obvious algorithms, failure behavior, and operational recovery. Do not add a useless comment to every obvious line or target hundreds of thousands of lines. Favor cohesive modules, strict TypeScript, Dart analysis, Kotlin linting, meaningful errors, typed contracts, parameterized SQL, reproducible builds, and compatible schema evolution.

Test at several levels: pure functions; property-based financial and dispatch tests; database constraints and concurrency; RLS/RTDB negative tests; emulator integration; API contracts; Flutter widget/integration tests; Android lifecycle/device tests; web end-to-end and accessibility; prerender/no-JS checks; load/quota simulation; chaos/recovery; CI/deployment smoke; backup restore; signed artifact verification. Never use real identities or production customer data in test fixtures.

Required negative cases include cross-tenant reads, expired assignments, QR replay, forged roles, duplicate payments, unverified remittances, simultaneous offer acceptance, duplicate checkout submission, order cancellation races, stale push/RTDB events, token revocation, quote expiry, routing outage, storage exhaustion, disconnected clients, and depleted free quotas.

### 12. Delivery and production-readiness evidence

Supply a browser-only setup guide with every required account-console step, secret, variable, environment, callback URL, Firebase rule/index deployment, domain/CORS/App Link setting, signing backup step, rollback action, and recovery workflow. One-time human account creation, legal acceptance, OAuth consent, MFA enrollment, payment review, and device permission approval cannot honestly be automated away.

Use protected Actions environments, minimal permissions, pinned actions, secret redaction, authenticated deployment, schema/rules preflight, staging smoke tests, backward-compatible releases, and manual production approval. Untrusted pull requests must not receive production secrets. No developer needs to run a local command.

Generate persistent release signing material once through a protected bootstrap workflow, store it securely, and back it up encrypted. Never regenerate signing keys each release or expose them as public artifacts. Producing APK/AAB files is not equivalent to Play Store publication. Respect upload-key versus Play App Signing certificate differences and any external store enrollment cost.

Produce signed release APK and AAB artifacts for all three apps, checksums, versions, certificate fingerprints, SBOM/license information, and controlled downloads. Configure verified Android App Links for owned supported domains, preserve normal web navigation, and include a safe no-app fallback. Do not promise the OS will open the app for every browser click or domain without verification and user consent.

The final release report must link evidence for every critical requirement, list unresolved findings and external setup blockers, state measured free-tier capacity, distinguish manual from automated checks, and provide a precise go/no-go recommendation. Use **“production-ready for the tested configuration and stated capacity”** only after all critical gates pass. Otherwise say exactly what is incomplete.

### 13. Response format for every stage

1. Stage identifier and concrete objective.
2. Understanding/decisions, including changed assumptions.
3. Files actually created or changed and the working behavior they implement.
4. Tests actually executed, exact commands/results, and evidence locations.
5. Security, financial, privacy, Android, and free-tier impact.
6. Known gaps, not-run checks, and release blockers.
7. Updated `docs/progress.md`, feature catalogue, and requirements-to-test matrix.
8. The next bounded stage; then **stop and wait for Continue**.

Begin with **Analysis response 1 only**. Inspect the repository and all references, write the understanding documents, and do not implement application code yet.

## END BUILD PROMPT
