# 08 — Feasibility decisions, approval gates, and sources

This annex is normative. Treat external limits and policy restrictions as engineering inputs, not obstacles to be hidden with optimistic wording. A specification can require rigorous evidence; it cannot itself prove a platform that has not been built.

## A. Decision register

| ID | Requested ambition or conflict | Required interpretation |
| --- | --- | --- |
| F01 | “Food and groceries” versus emphatic food-only requirement | Launch is food from restaurants/home/cloud kitchens only. Use food-delivery/pickup branding. Exclude retail/grocery flows even when visible in references. |
| F02 | Restaurant pickup versus home-chef checklist prohibiting pickup | Restaurant delivery/pickup are supported. Home and cloud kitchens default to on-demand delivery only; configure eligibility by vendor type. |
| F03 | “All Foodpanda/Uber Eats features” | Build the explicitly catalogued, lawful, in-scope equivalents. Screenshots do not reveal every workflow, backend, algorithm, or contractual policy. No unqualified parity claim. |
| F04 | “World first,” “world's smartest,” “proven best” | Aspirational positioning only. Compare observable functionality using disclosed criteria; do not invent competitor benchmark numbers or superiority evidence. |
| F05 | “100% secure,” “non-breakable,” “zero errors” | Threat modeling, least privilege, repeatable tests, scoped audits, incident response, and measured residual risk. No absolute security guarantee. |
| F06 | “No latency,” immediate delivery | Define and measure end-to-end stages. Connectivity, provider queues, OS scheduling, and human response add latency. Display trustworthy freshness and retry states. |
| F07 | Unlimited users/orders using free RTDB | Optimize within finite connection, bandwidth, storage, and request budgets. Enforce conservative admission and active-order prioritization. Publish a supported load envelope. |
| F08 | Three Workers multiply capacity | Workers Free request limits are account-wide. Include all three scripts, retries, preflight requests, control APIs, health checks, and any dynamic routes in the same budget. |
| F09 | No cron, but precise weekly invoices and two-minute deadlines | Bind SQLite Durable Objects to an existing Worker; use persisted alarms and idempotent processing. No cron jobs are required, but there is an explicit time-trigger mechanism. Catch-up-only mode is a documented degraded alternative, not punctual scheduling. |
| F10 | Two-second globally correct offline detection | Two seconds can mark a local/observed suspect state. Use leases, heartbeat timestamps, disconnection hints, re-check-in, and server-evaluated eligibility. No guarantee of detecting every partition in two seconds. |
| F11 | Data-only FCM must always wake a completely killed app | Distinguish ordinary process death, recents removal, force-stop, device shutdown, Doze, restricted background, no Play services, denied notifications, and no network. Implement supported behavior; disclose unsupported states. |
| F12 | Unlimited looping sound/full-screen alert | Only while actionable, permissioned, and OS/policy-compliant. Never impersonate incoming calls/alarms, override user DND, or promise locked-screen UI control. Stop on expiry, cancellation, logout, reassignment, or acknowledgement. |
| F13 | Sensitive image → SVG → database | Replace with owner-approved private Cloudflare R2 Standard objects, validated uploads, authenticated existing-Worker access and retention/audit. Supabase stores metadata with RLS only; RLS does not protect R2 objects. No SVG/database-blob/public imgbb/Supabase Storage fallback for sensitive files. |
| F14 | “imgbb is unlimited/free” | Use imgbb for public images as requested, but verify actual terms, file limits, API rate behavior, deletion mechanisms, and retention. No contractual unlimited-availability claim. |
| F15 | 3% rider bonus taken from a 5% “tax” | Block until finance/legal identifies the deduction. A statutory tax liability stays payable to the appropriate authority. A lawful non-tax levy may fund a bonus, but must be named, contracted, and accounted for as such. |
| F16 | Phone/password authentication without phone OTP | Email is the recoverable identity; a phone number may be an explicitly unverified login alias under a secure server-side design. Never fake verified phone ownership or invent synthetic email identities. |
| F17 | SAML/Okta/read replicas/WORM/Stripe in generic enterprise wish list | Not baseline requirements when paid or contradictory. Use free Supabase-supported auth/MFA, bounded SQL analytics, tamper-evident logs, manual COD settlements, and truthful capability flags. |
| F18 | Rider rejection only if another rider exists | Riders can always decline unsafe/unwanted work. Track reasons fairly; offer reassignment/manual handling. Availability pressure does not justify blocking a safety action. |
| F19 | Full customer phone/address before any offer acceptance | Pre-acceptance shows relevant items/logistics, approximate zones, route estimate, and guaranteed payout. Exact personal contact/address is released only to the current authorized assignee. |
| F20 | Unpaid cash screen cannot ever be removed | Block new shifts/offers when appropriate, not emergency/support/dispute access or completion of an existing delivery. Submission is not proof of cleared funds; distinguish submitted, verified, and rejected. |
| F21 | Every line manually tested by the agent | Test behavior/invariants with automated suites; record manual checks honestly. Hardware, real transfers, legal review, and production credentials may require external evidence. Never claim an emulator substitutes for every physical-device lifecycle test. |
| F22 | “Every line commented,” huge codebase, 500-line files | Document intent/contracts/invariants without repetitive comments. Keep hand-maintained files ≤500 lines; exclude generated dependencies explicitly. Maintainability, not code volume, is the goal. |
| F23 | Fully usable at 50px width | Functional reflow/accessibility at realistic widths, including a constrained 200px fallback. At 50px preserve a truthful minimal fallback; do not promise full operational usability. |
| F24 | Everything provisioned without human interaction | Automate all supported deployments from Actions. Account creation, terms, ownership checks, OAuth consent, MFA, device permissions, legal decisions, and manual payment approvals remain browser-based human tasks. |
| F25 | Automatically create keys and publish working Play apps for free | Actions can create persistent signing keys and build APK/AAB artifacts. Store enrollment, verification, publication review, and any enrollment fee are separate and not silently funded or simulated. |
| F26 | All website links always open Android app | Verified App Links work only for configured/verified supported hosts/paths, installed applications, and OS/user/browser policy. Preserve web fallback and exclude admin/private operational links. |
| F27 | OSM supplies real-time traffic/weather and unlimited routing | OSM supplies map data. Routing, geocoding, tiles, traffic, and weather have separate implementations, quotas, licenses, or absence. Never fabricate traffic/weather inputs. |
| F28 | All functionality finished in thirty implementation turns | Thirty is a structured delivery target, not evidence of completeness. Preserve gates/backlog and request additional authorization if necessary rather than marking unfinished modules complete. |
| F29 | Private R2 must remain completely free and automatically secure | R2 Standard has included storage/operation allowances, not unlimited free usage or a guaranteed zero-spend cap. Verify subscription/checkout/account billing prerequisites, configure conservative account-wide budgets and refuse over-budget uploads. Buckets stay private with r2.dev/direct public custom domains disabled; Worker authorization is mandatory. R2 bindings fit inside the existing three Workers. |

## B. Decisions requiring explicit owner approval before live financial operations

1. Whether the proposed 5% is a statutory tax, tax on platform commission, vendor operating levy, withholding, or something else; its legal authority, calculation base, invoice labeling, recipient, and remittance process.
2. Whether the 3% rider bonus is calculated on eligible discounted food subtotal, rider fare, or another base; who funds it; whether customer pickup earns any rider bonus (default: no rider, no bonus).
3. Commission/levy treatment of vendor-funded and platform-funded discounts, packaging, tips, cancelled orders, partial refunds, and late complaints.
4. Customer delivery-fee matrix, minimum order, maximum radius, maximum order value, rider cash-exposure cap, and when a quoted loss/subsidy is allowed.
5. Vehicle-specific base fares, five-minute traffic-compensation amounts, route/time model, weather and surge caps, rounding rules, batch bonuses, and safety closure thresholds.
6. Vendor invoice cutoff on Saturday and rider cutoff on Friday, operational payment review windows, holiday handling, manual transfer reference requirements, and bKash/Nagad cash-out reimbursement rates.
7. Acceptance of no phone OTP and the resulting alias/abuse/recovery risk; mandatory reachable email and manual KYC requirements.
8. Permitted collection of identity, selfie, location, bank/mobile-wallet, and private home-kitchen data; retention periods; support appeal process; data-subject rights.
9. Whether a personal bKash account is permitted for the intended business cash flow; applicable provider terms and Bangladesh legal/accounting requirements. Do not infer permission merely because a number can receive Send Money.
10. Whether verified current free quotas, including R2 Standard storage/Class A/Class B operations across buckets, are sufficient for the chosen live service area. Approving a launch target does not increase provider capacity.
11. Owner-approved R2 account/subscription checkout and any payment-detail requirement in the current account; conservative allocated budgets, data residency/retention and acceptable operational behavior when private uploads must be refused. This approval does not authorize paid upgrades or guarantee that all account-level overage billing is technically impossible.

Do not solicit credentials in chat. The future implementation should expose a policy-readiness checklist and fail closed for finance-sensitive launch switches until the required approved policy versions exist.

## C. Source-verification discipline

Record every provider check in `docs/provider-capabilities.md`: service, official source, retrieved date, relevant plan/account region, verified limits, account-console evidence, code/config dependency, and what happens if the capability is absent. Do not use training-memory prices as a deployment contract. Link to official sources rather than unsourced blog claims.

### Source material actually retrieved for this prompt

On **2026-10-22**, official repository source files were read through GitHub. The following observations describe those retrieved documents, not a promise that the future deployment account has identical entitlements:

| Official source | Relevant retrieved observation |
| --- | --- |
| [Cloudflare Workers limits](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers/platform/limits.mdx) | Free allowance documented as 100,000 account requests/day, 10ms Worker CPU/request, 128MB memory, and 50 subrequests/request. Daily reset is 00:00 UTC. Source blob: `aa5d6a78ec7a6365641a725aa85fdd68e1745930`. |
| [Durable Object plan note](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/partials/durable-objects/do-plans-note.mdx) | SQLite-backed Durable Objects are documented as available on Workers Free. Do not accidentally provision the incompatible legacy KV-backed storage model. Source blob: `9777834265d0d06d828dcc36bc9775b374e79a1c`. |
| [Durable Object pricing tables](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/partials/durable-objects/durable-objects-pricing.mdx) | Free plan documented as 100,000 DO requests/day, 13,000 GB-s/day, 5 million SQLite rows read/day, 100,000 rows written/day, and 5GB total storage. Alarm invocations count as requests; setting an alarm counts as a row write. Source blob: `7df9ae62c4fccccec1be49f4cde83a171d190edf`. |
| [Durable Object pricing behavior](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/durable-objects/platform/pricing.mdx) | Operations fail when a Free allowance is exceeded; a free allocation is not an unlimited queue. Source blob: `f5eb4747bc11e10f7b31ac5b5e6230693c203607`. |
| [Durable Object alarms](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/durable-objects/api/alarms.mdx) | At-least-once handlers, one scheduled alarm/object, automatic exponential retries starting at two seconds with up to six retries; persistent schedules can multiplex deadlines and need explicit recovery after retry exhaustion. Source blob: `4d576fbe8cd6cb30a00f310491558a913f3db095`. |
| [Cloudflare Pages limits](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/pages/platform/limits.mdx) | Free plan documented as 500 builds/month and 20,000 files/site. Check whether the selected direct-upload workflow consumes the same build counters; do not conflate Pages builds with Actions minutes. Source blob: `83df7ffefb18aba220b42dc3988e884edf39ae10`. |
| [Firebase Android messaging service source](https://github.com/firebase/firebase-android-sdk/blob/main/firebase-messaging/src/main/java/com/google/firebase/messaging/FirebaseMessagingService.java) | Service callbacks may run while an application is backgrounded/not open. This is not an assertion that callbacks bypass force-stop or all OS restrictions. Source blob: `bb1aba5cdc870715889960b76d6b48719fe3bc94`. |
| [Firebase Android messaging quickstart](https://github.com/firebase/quickstart-android/blob/master/messaging/README.md) | Useful integration sample; its sample notification behavior is not proof of data-only looping-alert reliability. Source blob: `528207b18711aa9ec64e555f57ee232e63a60d04`. |

The R2 storage revision was checked against these additional official sources on **2026-10-22**:

| Official R2 source | Relevant retrieved observation |
| --- | --- |
| [R2 pricing](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/r2/pricing.mdx) | Included usage documented as 10 GB-month storage/month, 1 million Class A and 10 million Class B operations/month for Standard storage only; egress is free, but storage/operation overages are billable. Infrequent Access is not covered by the free tier. Source blob: `37ba5595cc062ec0a435b4f6957f25d698da9e76`. |
| [R2 account setup](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/r2/get-started/index.mdx) | A Cloudflare account with an R2 subscription is required; setup directs the owner through a checkout flow. Free included monthly usage is not the same as no subscription/billing setup. Verify actual account/payment requirements in the browser. Source blob: `f23578ee0cbb2f0bf623974e7901896f8414fc2a`. |
| [R2 public buckets](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/r2/buckets/public-buckets.mdx) | Buckets default private; enabling a custom domain and managed r2.dev access are independent exposure paths. Both must remain disabled for Undal private evidence. Source blob: `2127271a28585271f5dec20ea548707657950c2c`. |
| [R2 Workers API](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/r2/api/workers/workers-api-reference.mdx) | Native bucket bindings allow existing Workers to operate on R2 without distributing S3 keys to clients. Application authorization is the Worker's responsibility. Source blob: `91ebf1ea206a8897626efa01ff79abca684197c1`. |
| [R2 presigned URLs](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/r2/api/s3/presigned-urls.mdx) | Anyone holding a URL can use the scoped operation repeatedly until expiry; URLs are bearer tokens, not instant role-revocation or single-use enforcement. Presigned URLs use the S3 API domain, not arbitrary custom domains. Source blob: `cbed22bb3dcbe2cf0f0ff699d5bf9ebab5211f15`. |

These are document blob fingerprints, not dependency versions or claims of a complete provider audit. Do not add their scratch downloads or API credentials to the repository.

### Official sources the implementation must check at build/deploy time

The sources below are a verification reading list. Their current plan details were **not** independently retrieved during this prompt's preparation; do not label their limits checked merely because a URL is present.

- [Firebase RTDB limits](https://firebase.google.com/docs/database/usage/limits), [billing/usage](https://firebase.google.com/docs/database/usage/billing), [security rules](https://firebase.google.com/docs/database/security), and [presence](https://firebase.google.com/docs/database/web/offline-capabilities).
- [FCM Android receive behavior](https://firebase.google.com/docs/cloud-messaging/android/receive), [message priority](https://firebase.google.com/docs/cloud-messaging/android/message-priority), [message lifetime](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan), and current delivery/reporting semantics.
- [Android background foreground-service start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [notification permission](https://developer.android.com/develop/ui/views/notifications/notification-permission), and [verified App Links](https://developer.android.com/training/app-links).
- [Supabase pricing](https://supabase.com/pricing), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [MFA](https://supabase.com/docs/guides/auth/auth-mfa), [auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), [email delivery](https://supabase.com/docs/guides/auth/auth-smtp), and Management API capabilities. Private-file bytes are intentionally stored in R2; Supabase RLS governs file metadata, not R2 object access.
- [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/), [Nominatim public usage policy](https://operations.osmfoundation.org/policies/nominatim/), [OSM attribution](https://www.openstreetmap.org/copyright), and the selected route/geocoder provider's official free-plan terms.
- [imgbb API](https://api.imgbb.com/), provider terms, and deletion/privacy/retention behavior.
- [GitHub Actions billing/usage](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [encrypted secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions), [Secrets REST API](https://docs.github.com/en/rest/actions/secrets), and current artifact retention/access behavior.
- Flutter stable/Android support matrices, current Google Play target API policy, signing guidance, foreground-service declarations, and any required store policy disclosures.

If the execution environment restricts outbound hosts, use permitted official GitHub mirrors where available and mark other facts unverified until accessible. Do not work around network restrictions or claim inaccessible sources were read.

## D. Comparative evidence and launch language

Create a comparison matrix only for documented user-facing capabilities: discovery, modifiers, COD, pickup, partner queue, dispatch, tracking, chat, cash reconciliation, localization, accessibility, privacy, and free-tier capacity. Each comparison needs a dated source or direct observation, scope, and limitations. Reference screenshots alone cannot establish competing platforms' current full feature set or performance.

“Proven” means a particular invariant or measured result is backed by a reproducible test/evidence artifact. It does not mean all possible conditions were tested. State residual risks, free-service availability limitations, external account blockers, and the tested Android/device/network matrix before any production-readiness claim.
