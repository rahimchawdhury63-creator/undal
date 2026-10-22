# 03 — System architecture, real-time design, and capacity

## A. Deployment topology: exactly three Worker scripts

```text
Customer Flutter / Partner Flutter / Rider Flutter
Customer React+Vite Pages / Admin React+Vite Pages
        | HTTPS / verified Supabase identity
        +--> undal-commerce       : customer/vendor commerce and public media API
        +--> undal-realtime       : dispatch, RTDB bridge, FCM, coordination/alarms
        +--> undal-admin-ops      : scoped admin, finance, review and operations API
                 | service bindings / narrow trusted calls
                 +--> Supabase Postgres + Auth + private-file metadata
                 +--> private Cloudflare R2 Standard buckets (Worker bindings)
                 +--> Firebase RTDB + Firebase Auth bridge + FCM HTTP v1
                 +--> imgbb public media / approved map-routing adapters
                 +--> GitHub Actions API for approved build/release/PDF jobs
```

Two Pages projects serve static assets. No Pages Functions are silently deployed. Durable Object classes are defined inside an existing Worker script and bound with SQLite-backed storage; they coordinate alarms/leases, not a replacement business database. Private Cloudflare R2 Standard storage is explicitly approved; bind its buckets only to the existing Workers that need access. No extra paid queue, database, hosted AI, analytics replica, image proxy subscription, SMS service, or invisible fourth backend. R2 enrollment/usage billing must be disclosed and kept within verified included allowances; do not claim an automatic provider-enforced zero-spend cap.

Suggested monorepo: `apps/customer-web`, `apps/admin-web`, `apps/customer-android`, `apps/partner-android`, `apps/rider-android`, `packages/contracts`, `packages/web-ui`, `packages/domain-ts`, `packages/flutter-core`, `packages/flutter-ui`, `packages/android-alerts`, `workers/commerce`, `workers/realtime`, `workers/admin-ops`, `supabase/migrations`, `firebase`, `config`, `scripts`, `tests`, and `docs`. Use domain-owned modules, not giant screen/service files. Dart/TypeScript/Kotlin share generated schemas and golden vectors where appropriate, not incompatible source imports or floating-point money copies.

### Worker responsibilities

| Worker | Responsibilities and boundaries |
| --- | --- |
| `undal-commerce` | Public catalog/zone/menu/search queries; customer identity-aware profile/cart/quote/order APIs; vendor-scoped application/menu/order APIs; authenticated public-image upload. Uses user JWT/RLS where practical and narrowly authorized transactional RPCs for critical mutations. |
| `undal-realtime` | Firebase custom-token bridge; notification registration; durable chat API; dispatch candidate/offer coordination; RTDB projections; FCM send/receipt processing; bounded telemetry/control-plane endpoints; outbox processing; SQLite DO deadline/clock classes. Does not grant business truth to FCM or direct RTDB writes. |
| `undal-admin-ops` | AAL2/MFA-enforced resource-scoped admin; KYC/private evidence; zone/policy/configuration changes; support; remittance verification; invoice verification/payment approval; audit/reporting/recovery; controlled Actions triggers. Never exposes service keys or a general SQL/remote-fetch console. |

Services verify internal-call identity, actor scope, operation schema, request version and replay/idempotency where needed. Service bindings are preferable to publicly callable “internal” routes with a guessable header. CORS/host rules are browser controls, not authorization.

## B. Authoritative ownership and transaction boundaries

| Data | System of record | Live/cache projection |
| --- | --- | --- |
| Accounts, roles, memberships, approvals, zones, menus, policies | Supabase | Public catalog caches and selected RTDB participant/role facts |
| Orders, accepted quotes, assignments, handovers, cash, ledger, invoices | Supabase | RTDB order/offer views with aggregate versions |
| Current GPS, typing, short-lived presence | Firebase RTDB, explicitly untrusted device observations | Only minimized current position/availability; selected operational samples may be retained in SQL under policy |
| Chat message text, membership history, support case | Supabase durable rows | Bounded recent message delivery/read/typing nodes in RTDB |
| Public vendor/menu images | imgbb URL/provenance recorded in Supabase | Browser/CDN cache subject to provider terms |
| KYC/selfies/payment proof/private chat/dispute files/invoice PDFs | Private Cloudflare R2 Standard object bytes; Supabase owns metadata, authorization, retention and audit | Authenticated Worker upload/streaming downloads; no public bucket URLs or RTDB file bodies |
| Alarm/deadline coordination | Supabase deadline/job records are recoverable truth | SQLite Durable Object schedule/lease state and next alarm |

### Private R2 media contract

- **Storage split:** imgbb hosts only approved public media. Private R2 hosts all sensitive images/documents and invoice PDFs; Supabase stores file IDs, opaque object keys/bucket references, owner/vendor/order/case associations, classification, verified MIME/size/checksum, upload status, retention/legal hold, deletion state and access audit. Never put private file bytes/base64/SVG wrappers in PostgreSQL or RTDB.
- **Private buckets:** use separate Standard-storage evidence/invoice buckets with both managed `r2.dev` and direct public bucket custom domains disabled. Do not make a bucket public to support an `<img>` tag or confuse an unguessable filename with authorization. A customer-facing authenticated Worker origin is not a public bucket domain.
- **Existing Workers only:** use native R2 bindings and a shared private-media authorization module in the three existing scripts. Bind a bucket only where its operations are required. Verify Supabase JWT and current object/application/order/case ownership or resource-scoped staff membership on every upload, GET, HEAD, Range request and deletion. Staff review/export requires appropriate MFA; an applicant may upload/read their own permitted evidence without gaining staff status.
- **RLS boundary:** Supabase RLS protects metadata only; it does not authorize R2 objects. R2 bindings have server-level object access, so Workers must enforce every object permission independently of a guessed path or client-provided role. Do not assume Supabase `storage.objects` policies apply, and do not replace this design with Supabase Storage.
- **Upload transaction:** first persist an authorized intent and reserve a bounded byte/operation budget; choose the object ID/key server-side. Stream size-limited supported bytes through a Worker, validate actual content/type/dimensions/checksum under the documented codec/CPU limits, then finalize ready metadata idempotently. Unvalidated/staged objects are never downloadable. Reconcile failures and retries; SQL metadata and R2 writes are not atomic.
- **Download:** fetch by file ID, resolve the real R2 key only after current authorization, stream through the Worker with `Cache-Control: private, no-store` and safe MIME/disposition headers. No shared CDN/Cache API/service-worker caching, permanent public URL, raw credential, or access token in query strings. Native clients and web authenticated fetch/blob rendering must handle private media without bypassing the gateway.
- **Presigned URLs:** not the default for identity/payment files. If explicitly approved, scope to a single object/method and very short expiry; treat as transferable, reusable bearer access until expiry. Role revocation or logout does not inherently invalidate an issued R2 S3 URL. Do not promise single use or instant revocation; require separate risk/tests and never expose S3 keys to clients.
- **Lifecycle:** delete/deny in authoritative metadata first, then enqueue idempotent R2 deletion and orphan/staged-object cleanup through the existing outbox/alarms. Audit retrieval/deletion, enforce retention/legal hold and test delete/retry/restore races. Authorized users can retain downloaded copies; revocation cannot recall bytes already delivered.
- **Free budget:** account for aggregate Standard GB-month storage across buckets, monthly Class A writes/lists/multipart operations, Class B reads/heads, retries/cleanup/PDF uploads and the additional Worker requests/CPU. Verify R2 account subscription/checkout and included usage before enablement. Reserve headroom, limit each upload and refuse new uploads before the allocated budget; alerts alone are not spending caps. Never auto-upgrade storage class or fall back to public imgbb for private evidence.

Place an order in one database transaction: validate actor/idempotency; lock relevant quote/menu/promotion availability; recompute price; confirm eligibility/readiness/capacity policy; create immutable order/line/address/policy snapshots; reserve stock/promotion entitlement where applicable; create deadline and domain event/outbox rows; return the committed order and server clock.

Post-commit, nudge the coordinator through a service binding. SQL commit and DO scheduling are not atomic. A persisted outbox plus a bounded, continuously re-armed operations-clock alarm recovers a crash between commit and nudge. Recover pending work at deployment startup/bootstrap, on admin recovery, and on relevant API reads/mutations. Do not promise that `waitUntil`, an in-memory timer, or one outgoing fetch is a durable queue.

Each command takes an idempotency key and expected aggregate version where appropriate. Each outbox event has unique event ID, aggregate ID/version, schema version, created/available time, attempt count, processing lease, next attempt, last classified error and delivered-side effects. Claim rows with bounded transactional locks/`SKIP LOCKED`; reclaim expired leases. Consumers are idempotent and project only newer versions. FCM delivery is at-least-once/best-effort transport; once-only ledger effects come from database uniqueness and transaction rules.

## C. PostgreSQL schema and integrity requirements

Design migrations, constraints, RLS, indexes, transactional functions and migration tests for at least these domains:

- Identity/permissions: profiles, role definitions, permissions, scoped memberships, vendor staff, admin scopes, auth-provider readiness, session/device records and consent/policy acceptance.
- Geography: regions, service zones, valid versioned polygons, service-mode eligibility, zone closures, vendor coordinates, address records and geospatial search projections. Use PostGIS GiST indexes and geodesic distance; do not calculate kilometres as Euclidean degrees.
- Applications: vendor/rider applications, review events, required-document definitions, private file metadata, document validity, payout account versions, vehicle records and approval/suspension reasons.
- Vendor/catalog: vendors, owner membership, vendor type, public/private profile separation, weekly/exception hours, food taxonomy, menu categories, items, variants, option groups/options, bundle components, availability, image references and published catalog revisions.
- Commerce: carts/lines, quotes/price snapshots, orders/lines/selections, address/contact snapshots, transitions/events, inventory reservations, promotion eligibility/redemptions, handover tokens, cancellation reasons, fulfillment proof and disputes.
- Logistics: rider operational state, vehicle capability, availability leases, offers/reservations, unique active assignments, batch membership/stop sequence, routing-cache metadata, dispatch decisions and preparation estimates.
- Money: ledger accounts/journals/entries, cash custody/collections, remittance submissions/reviews, settlement periods, invoices/lines, adjustments/credit notes, payment approvals/transfers/fees and reconciliation results.
- Communication/operations: chat threads/participants/messages, read cursors, notification intents/tokens/attempts/acks, support cases, reviews/replies/moderation, outbox/dead-letter records, jobs/deadlines, feature/policy versions, quotas and audit checkpoints.

Use composite foreign keys/constraints to prevent an order line, modifier, employee, document or assignment crossing vendor/order scope. Enforce valid coordinate ranges, integer nonnegative money where required, safe quantity/range bounds, immutable accepted snapshots and legal transition conditions. Use uniqueness for checkout keys, accepted offer/active order assignment, handover redemption, remittance references under the correct provider scope, invoice period/party and journal event keys.

Persist money as `bigint` poisha, rates as basis points, distances as integer metres and duration as integer seconds. JSON transports use documented decimal strings when values may exceed JavaScript's safe integer range; do not silently cast bigints to float. Use server timestamps and typed ISO UTC transport; localize only for display/cutoffs.

Define RLS policy tests for each actor/table/action, including negative cross-tenant cases. Use the caller's validated Supabase JWT for ordinary scoped operations. Privileged functions fix `search_path`, revoke inappropriate execution, validate real actor identity and permissions, and cannot accept a client-supplied actor/role as authority. Service credentials bypass RLS and therefore require even narrower endpoint/RPC validation and auditing, not less.

Index by actual query plans: vendor/zone availability, menu ownership/order, customer order history, order state/deadline/zone, live assignments, offer expiry, ledger account/period, invoice party/period, outbox available/lease time, chat thread/sequence and review vendor/time. Test `EXPLAIN` plans on isolated realistic fixtures, bound pagination, avoid unindexed offset scans, and document p95 SQL time and lock behavior.

## D. Order and independent state machines

Canonical order flow: `placed → vendor_accepted → preparing → ready → picked_up → delivered`, with `cancelled` only through approved pre/post-pickup exception policy. A picked-up order can require incident resolution; never erase the physical event. Customer pickup uses its own handover authorization and no rider assignment. Clarify whether `vendor_accepted` and `preparing` are separate observable stages or one transaction/event pair.

Separate machines: offer (`created/offered/accepted/rejected/expired/revoked`); assignment (`reserved/active/picked_up/completed/released`); dispute (`open/under_review/resolved/appealed`); cash custody (`not_due/collected/remittance_submitted/verified/shortfall/disputed`); invoice (`generated/verified/paid`, with rejected/replaced/credit-note handling); application review; vendor operational readiness; rider shift state. Enforce transitions server-side and include actor, event, previous/next version, reason and policy reference.

Handle concurrency explicitly: two devices accepting one order; accept racing cancellation/deadline; two riders accepting one offer; scan racing reassignment; stock toggled during checkout; campaign budget exhaustion; app retry after timeout; late delivery/cash event after invoice cutoff; duplicate payment approval. SQL constraints and compare-and-set transitions decide winners, not UI arrival order.

## E. RTDB structure and Firebase authentication bridge

Use versioned, bounded paths. Example logical layout, refined after rule tests:

```text
/v1/access/orders/{orderId}/{uid}             # trusted membership/capabilities
/v1/access/vendors/{vendorId}/{uid}           # trusted scoped operator membership
/v1/access/riders/{riderId}/{uid}             # trusted rider/device scope
/v1/orderViews/{orderId}                      # minimal status/ETA/version; no private full order
/v1/vendorQueues/{vendorId}/{orderId}         # bounded active order summaries
/v1/riderOffers/{riderId}/{offerId}           # short-lived offer projection
/v1/tracking/{orderId}/current                # minimized current assigned-rider fix only
/v1/presence/{principalId}/{deviceSessionId}  # device observation/lease hint
/v1/chat/{threadId}/messages/{messageId}      # bounded recent durable-message projection
/v1/chat/{threadId}/receipts/{uid}            # own receipt cursor
/v1/chat/{threadId}/typing/{uid}              # tiny ephemeral hint
```

Never subscribe to `/v1`, all users, every rider, all vendors or all chat history. Security rules are not filters: an unauthorized wide read must fail. Supply `.indexOn` for ordered queries, enforce limits where RTDB rules support them, validate shapes/types/child counts and deny unspecified writes. Store private documents, full phone/address details, financial ledgers and auth secrets elsewhere.

Bridge: Worker validates Supabase JWT signature/issuer/audience/expiry and approved membership; mint a Firebase custom token for the same stable UID with minimal claims; client exchanges it through Firebase Auth; RTDB rules authorize against trusted membership paths and scoped claims. Custom tokens are not REST database access tokens. Role changes and logout require participant removal/revocation, token lifecycle handling and tests for already-connected sessions. Privileged Firebase REST calls obtain legitimate service-account OAuth access tokens, not an invented admin secret from the client configuration.

Authoritative order/offer/participant projections are backend-written. Permit direct client writes only to explicitly approved own presence/typing/read cursors and narrow assigned-rider tracking nodes, with rule-enforced ownership, active assignment, validity and bounded structure. GPS remains a device claim: validate timestamp/accuracy/sequence, reject impossible/unreasonable transitions in trusted consumers, and never derive pay or delivery proof solely from raw coordinates.

Choose telemetry ingestion by measured budget: direct RTDB scoped tracking avoids a Worker request for every fix; a lower-frequency control-plane validation/sample can update dispatch eligibility. If all telemetry is routed through a Worker, count every upload against request/CPU budgets. Explain the security tradeoff rather than pretending direct client coordinates are verified location evidence.

Messages are persisted through the chat API before durable acceptance, then projected through outbox. Typing is ephemeral. Client message IDs prevent retries creating duplicates. Use monotonic message sequence/version, bounded last-N queries, SQL history pagination, unread cursors, expiry/cleanup and participant revocation after the agreed order/support grace period.

## F. Presence, deadlines, alarms, and recovery

Device connectivity and business availability are different. Use observed RTDB connection/disconnection, `onDisconnect` where supported, last server heartbeat, device session lease, approval/hours/zone/capacity and explicit check-in. A two-second missed observation can show `suspect`; server eligibility uses a documented lease window and uncertainty policy. Do not run a two-second Worker heartbeat per vendor/rider and call it free at arbitrary scale.

Persist each vendor acknowledgement deadline as `placed_at + 120s`. Alarm processing and every relevant order command/read check the deadline transactionally. The cancellation reason distinguishes no device receipt from device receipt but no vendor acceptance. If accepted before expiry, a late alarm must not cancel it. Unknown/unreachable orders must not enter dispatch as accepted.

Use one small `OperationsClock` Durable Object and bounded per-active-zone/dispatch objects only where needed. Store a deadline/job queue in SQLite with unique IDs; set the one alarm to the earliest due job. Batch bounded due work, persist attempts, re-arm before/after processing safely and recover from duplicate invocation. Use persisted retry/backoff with jitter and an explicit strategy beyond the documented finite automatic retries. Avoid an indefinitely alive isolate, `setInterval`, unpaid external keepalive or cron expression.

The operations clock periodically reconciles pending SQL outbox/deadline rows at a budgeted maximum interval, even if a post-commit nudge was lost. Account for these wake-ups and database reads. Weekly invoice calendar jobs schedule the next Friday/Saturday Dhaka cutoff after completing/recovering the previous one. Catch-up computes every missing period, not just “this week.” Alarms are at-least-once and may be delayed/fail at quota/provider exhaustion; API barriers and admin recovery remain necessary.

RTDB projection cleanup and access revocation are scheduled, idempotent jobs. Long-lived precise GPS and private chat histories must not grow without a policy. Retain the minimum operational summary in SQL; remove live nodes/participants on terminal state plus configured grace period. A cleanup failure is visible in diagnostics and subject to retry, not ignored.

## G. Capacity model and quota-driven degradation

Build an executable spreadsheet-equivalent capacity calculator with configuration, measured inputs, conservative headroom and projected daily/monthly consumption. All numeric RTDB/Supabase/R2/map/imgbb/Actions limits require current official/account verification; R2 free storage/operation allowances are account aggregates, not per-bucket gifts. The following are **planning scenarios, not a claimed tested capacity**:

- Suppose a verified RTDB connection allowance is 100 and headroom is 20. Twelve vendor devices, sixteen rider devices and four staff sessions leave `100 − 20 − 12 − 16 − 4 = 48` potential customer sessions before reconnect/tab overhead. This is not thousands of simultaneous tracking users and not a security-enforced provider connection guarantee.
- One active SDK app instance normally shares a connection across its listeners. Other tabs/devices/processes and reconnect overlap can add connections. Use a primary browser-tab coordinator/lease and `BroadcastChannel` where available, with safe fallback; do not claim it covers unrelated devices or hostile clients.
- RTDB downloads are approximately updates × actual encoded bytes × viewer fan-out plus initial snapshots/protocol/reconnect overhead. Sixteen riders over eight hours/day at a five-second interval yield 92,160 position updates/day. A 120-byte body and 1.5 average recipients is about 16.6MB/day of bodies before overhead; measure actual wire/download accounting rather than treating that estimate as a bill.
- Forty-eight clients polling every fifteen seconds for eight hours create 92,160 Worker requests/day before checkout, auth, chat, preflights, retries or administration. Fallback polling is not free magic. A sixty-second interval is 23,040 requests over those eight hours but is no longer five-second live tracking.
- The retrieved Workers Free baseline is 100,000 account requests/day and 10ms CPU/request. Include all scripts and any external HTTP invocations; account for additional DO requests/duration/rows separately. Put expensive PDF/image/routing work outside a 10ms Worker hot path unless measurements prove it fits.

Track at least: active connections and leases; RTDB download/storage/write volume; Worker requests/CPU/subrequests; DO requests/duration/rows/storage; SQL size/latency/locks; R2 Standard GB-month/byte reservations/Class A/Class B operations and gateway traffic; Supabase API egress; auth/email limits; imgbb operations; routing/geocoding/tiles; Pages builds/files; Actions minutes/artifacts. Metrics collection itself must fit the budget and avoid high-cardinality personal telemetry.

Use configurable warning/soft/hard thresholds, for example 60%/75%/85% as initial proposals, with tested behavior. Preserve payment/assignment/status consistency at every mode. Prioritize active-order clients and vendor/rider operations; suppress idle discovery listeners/typing/high-frequency analytics first; coalesce GPS and cache public queries; then use explicitly labelled bounded polling; finally pause new delivery admissions/offer only eligible pickup or waitlist where safe. Never accept an order with a knowingly unavailable fulfillment path merely to increase order counts.

Admission leases are best-effort application control, not a way to bypass the RTDB provider's limit. Authenticated clients can misbehave; rules/App Check/abuse monitoring/headroom and provider failure handling are still necessary. A Worker relay may reduce backend subscriptions but adds authorization/fan-out/recovery/duration/request costs and must be separately proven free; do not make it the default unsupported scaling claim.

## H. Mapping, media, website SEO, and domain strategy

Map rendering uses compliant OSM attribution and the selected tile provider's cache/offline/bulk-use rules. Public Nominatim/demo OSRM/tile infrastructure is not an unlimited production SLA. Prefer own-address/zone search for common queries, cache permitted geocoder/routing results, throttle and bound requests, and require a legal route source for delivery pricing/navigation. If the free route quota is exhausted, do not bill a fabricated route; pause route-dependent delivery quotes, preserve active-order support and offer eligible pickup honestly.

Perform public-image normalization primarily in supported client/native codecs; backend validates bounded bytes/format/dimensions and enforces purpose/auth/rate limits. Do not assume heavy universal image conversion fits Workers Free CPU. Reject unsupported/active SVG inputs. Private evidence and invoice PDFs use private Cloudflare R2 through authenticated existing Workers, with metadata-only records in Supabase. Media retries and abandoned uploads need idempotent metadata/cleanup and provider-compliant deletion handling.

Prerender real public home/city/cuisine/vendor/help/legal content at build time; hydrate current interactive state. Gate initial public listing on successful publication of the approved vendor's static route/catalog revision. Batch content-rebuild triggers to remain within Actions/Pages budgets; do not rebuild three Android apps for every menu edit. Document freshness and always re-quote current prices at checkout.

Use generated per-route HTML, valid canonicals, localized `hreflang`, bounded sitemap indexes, truthful structured data, proper 404 content/status and no-JS tests. Do not apply a global SPA-200 rewrite to arbitrary public slugs. Explicit private app routes may use an app shell with `noindex` and no private prerendered data. A dynamic HTML fallback is permitted only inside one of the three Workers after CPU/domain/routing verification; it is not a hidden fourth backend.

Default deployment must work on two `pages.dev` sites and configured `workers.dev` API origins without assuming ownership of those zones. Production can use explicit HTTPS API origins with strict CORS, or custom-domain same-origin Worker routes when the owner controls DNS. Development uses relative `/api` requests through the Vite proxy to a backend bound to `0.0.0.0`; browser code must never call sandbox localhost. Do not depend on cross-site third-party cookies for baseline admin authentication.

## I. Resilience and observability

Use structured redacted logs with correlation/event/order IDs, not private payload dumps. Define health as dependency/capability/readiness/freshness, not simply HTTP 200. Expose bounded admin diagnostics for outbox lag, alarm lag, stale projections, FCM attempt versus device ack, assignment conflicts, invoice mismatches and quota safe mode.

No free-service uptime SLA is assumed. Document Supabase inactivity/pausing, provider outages, network partitions, free quota exhaustion and account suspension behavior. Provide browser-only backup/restore with encryption and restore evidence; backups/artifacts also consume finite storage and cannot leak KYC/financial records from a public repository.

Rollback must preserve migrations and old-client compatibility. Use expand/migrate/contract changes, versioned events/RTDB/API contracts, staged rule publication, health checks and forward-fix plans. Never automatically roll back a schema in a way that deletes real orders, ledger entries or accepted assignments.
