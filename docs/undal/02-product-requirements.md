# 02 — Product requirements and business boundaries

## A. Release scope, roles, and feature truth

Launch in approved Bangladesh service zones with BDT, English/Bangla, COD delivery, and cash-at-restaurant pickup. Initial operational country/currency are not a fabricated multi-country rollout. Store currency and policy versions in records so later expansion is possible without pretending other tax regimes are implemented.

Vendor types: `restaurant`, `home_kitchen`, `cloud_kitchen`. Restaurants may enable delivery and pickup independently. Home/cloud kitchens are delivery-only and on-demand at launch. All vendor types require administrative approval, an eligible zone, an accepted agreement/policy version, a supported Android device, approved hours, and active operational readiness before receiving new orders.

Actors: guest, customer, vendor owner, vendor manager, vendor order operator, vendor menu operator, vendor finance viewer, rider applicant, approved rider, support agent, onboarding reviewer, zone dispatcher, finance reviewer, payout approver, compliance reviewer, regional administrator, and super-admin. One user may hold several approved memberships; selecting a role never creates a membership or bypasses tenant/zone scope.

Create `docs/feature-catalogue.md` with stable feature IDs, actor, platform, workflow, security scope, state dependencies, API/database implementation, tests, evidence, and status. Use `not_started`, `in_progress`, `implemented_unverified`, `verified_in_test_environment`, `blocked_external`, `disabled_not_configured`, and `excluded`. Disabled configuration adapters are not verified integrations. Do not fabricate a 2,000-feature count.

## B. Customer journeys

### CUST-01 — Location, serviceability, discovery

- Guest users can browse approved public content without creating an account. Location setup offers manual address search, current-device location, and movable map pin; request permission only after explanation. Handle denial, approximate permission, timeout, unavailable GPS and out-of-zone addresses.
- Store address label, recipient name/contact, address lines, house/flat/floor, landmark, delivery notes, latitude/longitude, accuracy/source, zone version, and consent timestamps where appropriate. Written address and map pin must agree sufficiently for delivery; user corrections are explicit.
- Resolve serviceability using server-side zone geometry and vendor fulfillment policy. A client cannot bypass a closed zone by changing a flag. Show why an area/vendor is unavailable and whether pickup is supported.
- Food home includes in-zone cuisine/category collections, organic vendor discovery, reorder for authenticated users, fair new-vendor exploration, genuine discounts and favorites. Do not show empty campaign slots, fake restaurants, invented ratings, or retail tabs.
- Search vendors, dishes, cuisines and categories with bilingual text normalization, safe length limits, indexed matching, debounced requests, stable pagination, query cancellation, clear filters and recent-query privacy controls. Do not send every keystroke to a public geocoder.
- Filters may include delivery/pickup, cuisine, rating with sample size, price band, availability, dietary declarations, discount eligibility, distance and ETA. Each visible filter must actually affect results and persist predictably on back navigation. Dietary labels are vendor declarations, not medical guarantees.
- Curate at least 100 meaningful food taxonomy category/subcategory entries with stable IDs, Bangla/English labels, search synonyms, hierarchy validation and provenance. Taxonomy is reference configuration, not demo vendor/menu data; no duplicate spelling variants solely to reach a count.

### CUST-02 — Vendor, menu, items and carts

- Vendor page: authorized cover/logo, brand/type, public approximate location for home chefs, applicable opening hours, eligibility, ETA range, route/fee information, service modes, food categories, verified-review summary, support and policy disclosures.
- Menu supports categories, ordered items, simple products, size variants, modifier groups, bundles, required/optional selection, min/max choices, repeated options where permitted, quantities, price adjustments, localized descriptions, dietary/allergen declarations, preparation constraints and stock/availability.
- Product detail validates every combination. Do not accept a modifier from another vendor/item/variant, a negative quantity, a stale price, an unavailable bundle component, or an arbitrary client subtotal. Quantity controls and special notes must be accessible and bounded.
- Maintain multiple vendor-scoped saved carts, but one vendor and one fulfillment mode per order. Prompt before replacing an active vendor cart; never silently merge vendors. Customer carts are not rider batches.
- Cart shows item/variant/modifier breakdown, quantities, vendor-funded and platform-funded discounts, any lawful packaging charge, customer delivery fee, applicable disclosed charges and total COD. Cutlery is a meaningful opt-in setting. Do not add platform fees, priority delivery, tips, or taxes that lack an approved policy and accounting path.
- Safe reorder copies selections, not historical prices or invalid discounts. Report removed/unavailable/changed items before quote confirmation. An empty cart and a cart whose items all became unavailable are different states.

### CUST-03 — Account and authentication

- Support real Supabase email/password signup/sign-in, verified-email recovery/change flows, password reset, logout/all-device revocation, session refresh and profile management. Explain email delivery limits and fail with a real actionable error when provider setup is missing.
- Email is the recoverable identity. Collect E.164-normalized Bangladesh phone contact without SMS OTP; display it as unverified. A secure optional phone-login alias can resolve server-side to the existing email identity, with generic errors, anti-enumeration controls, collision rules, throttling and verified-email recovery. Never create fake email aliases or bypass Supabase token verification.
- Implement provider adapters/registry for `google`, `github`, `gitlab`, `bitbucket`, `discord`, `facebook`, `twitch`, `spotify`, `azure`, `linkedin_oidc`, and `keycloak`, subject to current Supabase support and provider terms. Google is the intended initial social provider; the other ten start disabled. Do not enable an integration just because its button exists.
- Provider readiness requires Supabase-side configuration, callback/redirect allowlists, browser OAuth consent and actual successful integration tests. Admin plugin toggles must correspond to backend enforcement and provider capability, not UI-only hiding. Free-only policy forbids silently provisioning paid identity products.
- Multi-step signup covers identity, consent, contact/address and serviceability, with resume support and no loss of validated input. Browsing does not require unnecessary identity documents or location access.

### CUST-04 — Quote, placement and fulfillment

- Issue a server-owned, expiring quote bound to customer/session, vendor, cart fingerprint, fulfillment mode, address/zone version, menu/promotion/pricing-policy versions and currency. Display all amounts before confirmation. A route failure cannot be hidden as an invented delivery distance.
- Checkout requires supported serviceability, reachable contact, approved vendor/device readiness, capacity admission, valid menu/options, applicable campaign budget and COD limits. Disabled action explains missing input; no stuck spinner or always-success fallback.
- Place with a unique idempotency key and transactional inventory/promotion checks. Repeated taps/retries return the same committed order. A timeout must not encourage a second charge/order without checking the first key.
- Track distinct order lifecycle, dispatch, cash, settlement and dispute states. Timeline uses authoritative events and freshness. Pending vendor acknowledgement has a server deadline of two minutes; customer UI must distinguish “request received,” “vendor accepted,” and “delivery assigned.”
- Live tracking opens only for authorized active orders and within realtime admission capacity. Show last-updated time, accuracy/approximation and network state; interpolation must never be presented as new GPS evidence. Batch UI can say “another stop” without exposing another customer's personal data.
- Customer pickup uses restaurant eligibility, no rider assignment/payout/delivery charge, a short-lived authorized handover code/QR, explicit cash-received confirmation and a receipt. Never let possession of an enumerable order number complete pickup.
- Cancellation before/after vendor acceptance, stock failures, unreachable vendor, missing rider, late preparation, customer unavailable, invalid address and support intervention each have reasons, permission checks, communications and financially defined outcomes. After physical delivery, complaints create dispute/adjustment states instead of erasing fulfillment history.

### CUST-05 — Communication, history and rights

- Order-scoped chat supports customer↔assigned rider and permitted customer/vendor/support threads; staff access requires case/role scope. Text delivery has persisted IDs, sent/delivered/read distinctions, retry deduplication, bounded pages, report/block behavior and retention. Images/files in support/private chat are private Cloudflare R2 evidence with authenticated existing-Worker delivery and metadata/permissions in Supabase, never imgbb public images.
- Expose only necessary contacts for the active assignment/order. Without a free permitted telephony relay, do not advertise masked calling; use consented, time-limited direct contact or in-app chat and explain the limitation.
- Show current/past orders, price snapshots, receipts, approved refunds/adjustments, support cases and safe reorder. COD refunds are reviewed manual cash/mobile-wallet/bank settlements with references, not fictional gateway chargebacks or automatically spendable balances.
- Verified-purchase reviews require an eligible completed order, bounded edit window, moderation/reporting, vendor reply and appeal. Rating reminders, reorder prompts, “try new” suggestions and discount messages have consent, quiet hours, frequency caps and opt-out; transactional alerts remain separately classified.
- Account export/deletion, marketing preferences, saved-address removal, location/privacy controls and help must work. Legal financial retention may override immediate ledger erasure; explain what is anonymized, retained and why.

## C. Vendor onboarding and operations

### VEND-01 — Restaurant application

Require clear scanned/digital documents: valid local-government trade license; owner NID or passport; TIN and BIN/tax/VAT registration where applicable; bank proof showing bank, holder, account, branch/routing details **or** bKash/Nagad account number plus private account screenshot; digital menu.

Collect official brand/name; owner/representative full legal name, active contact phone and email; searchable cuisine/category selections; authorized storefront and kitchen photos; full private business address with search/current-location/OSM pin options; zone eligibility; preparation capacity; supported service modes; weekly/special hours. Require at least four open hours/day on at least five days/week unless a documented approved exception applies.

Distinguish public storefront/marketing imagery on imgbb from private KYC kitchen photographs/documents on Cloudflare R2; Supabase stores file metadata and review permissions only. Validate issuer, identity consistency, document expiry and completeness through a real review workflow. Do not claim an official NID/identity database integration without lawful access and evidence.

### VEND-02 — Home/cloud-kitchen application

Require owner/chef NID or passport; recent utility bill proving the kitchen address; bank or bKash/Nagad proof as above; digital menu; private preparation-area hygiene photographs. Collect public kitchen brand, legal contact, cuisines, full private residential address including unit/floor, exact coordinates and service-zone check.

Trade license/TIN/BIN requirements are determined by applicable law and approved regional onboarding policy, not by a competitor's promotional exception. A missing legally required document blocks approval. Default on-demand delivery only; no pre-order or pickup. Maintain the same opening-availability minimum unless an approved exception exists. Public listings must not expose precise residential details unnecessarily.

### VEND-03 — Application lifecycle and access

Use draft → submitted → under_review → changes_requested → approved/rejected, plus expired/suspended/reverification states where appropriate. Applicants can resume drafts, see specific requested corrections and submit replacements; reviewers audit decisions. Approval, document review and operational activation are separate events.

Vendor owners may invite staff with approved resource permissions. Menu operators cannot change bank details; order operators cannot see identity documents or export payouts; finance viewers cannot grant roles. Critical owner/payout-account changes require MFA/re-authentication and review. Never assign ownership from a client-provided role field.

### VEND-04 — New orders, preparation and handover

- Device onboarding includes notification/GMS/network/sound/readiness diagnostics and explicit check-in. Store open state derives from approval, hours/exceptions, zone status, pause state, capacity and a fresh device lease. Reconnection does not silently reopen a paused/unreachable store.
- New-order queue separates new, acknowledged, accepted/preparing, ready, picked-up, completed and exception views. Data-only FCM is an alert transport, not the source of order truth. Persist receipt acknowledgement separately from commercial acceptance.
- Suggested preparation time uses documented history/queue/item complexity/capacity and a bounded fallback when history is insufficient. Show why it was suggested. Provide accessible plus/minus controls, manual input validation and range 1–200 minutes; large-order choices can need confirmation/customer ETA warning.
- Accept/reject is server-authorized and idempotent. Rejection has structured reason, stock follow-up and correct cancellation accounting. Cannot accept an expired/cancelled order just because the alert is still visible.
- Mark ready, report delay, contact support and display a single-use rider handover QR. Redemption checks current rider assignment, order state, expiry and replay protection. Customer pickup uses a separate flow; vendor “ready” alone is not proof of handover.
- Operational tablet dashboard must make pending alerts obvious without hiding current work. Offline mode may show cached queues with a stale label; it must not falsely confirm server acceptance or QR redemption.

### VEND-05 — Menus, campaigns, reporting and finance

Implement complete menu/category/variant/modifier/bundle CRUD with validation, reorder, availability windows, manual restore, soft deletion, image replacement and audit. Historical orders retain snapshots. Prevent unavailable ingredients/components from remaining orderable through a bundle or variant bypass.

Allow honest vendor-funded full-menu/item discounts, minimum basket, time windows, usage/budget caps, eligibility, opt-in 25% Undal Flash, versioned terms and non-stacking defaults. Show preview economics, actual funding cost and real performance. No CPC, ads, paid ranking, subscription fee, compulsory discount or invented ROI.

Provide scoped order history, metrics, date comparisons, item/hour sales, ratings/replies/disputes, downloadable reports, policy documents, support and Saturday invoice statements. Every KPI defines period, timezone, source and denominator. Missing data is labelled, not fabricated.

## D. Rider onboarding and operations

### RIDER-01 — Eligibility and documents

All riders: age ≥18, supported Android device (proposed minimum Android 8/API 26), working front camera, reliable location/network and a payout account in their own name. Collect DOB, legal name, identity document, contact/email, private face selfie for reviewed identity matching, service-zone pin/search/current location and agreement/consents.

Motorbike: NID or birth certificate per lawful policy, valid driving license, registration certificate, tax token, personal functioning motorbike and document-expiry checks. Bicycle: NID or birth certificate per lawful policy and a personal functioning bicycle. Do not require paid external biometric services or claim automatic government verification. Provide a reviewed alternative for inaccessible camera/document workflows where lawful.

Bank proof needs holder/account/routing details; bKash/Nagad payout proof is private. A selfie is sensitive identity evidence stored in private Cloudflare R2, not a public profile photo by default; NID/license/vehicle/bank/mobile-wallet evidence and remittance screenshots use the same authorized private pipeline. Android-only is explicit for rider/vendor operations; iOS applicants may read informational web pages but cannot pretend to operate an unsupported rider client.

### RIDER-02 — Shift/readiness and offers

- States include off_shift, checking_in, available, reserved_offer, assigned, carrying, paused, location_stale, cash_due and suspended, modeled without contradictory flags. Going online validates approval, current documents, permissions, location/zone, device lease, active assignments and cash cap.
- Display offer vendor, food items/handling needs, approximate dropoff area before assignment, vehicle route distance/time, pickup count, batch stops/detour, COD exposure and guaranteed payout breakdown. Reveal exact private contact/address only to the accepted assignee.
- Accept/reject/expire are atomic. Decline always remains possible; reason capture must not delay safety. No other rider availability condition may trap a rider. Repeated decline policy is transparent and appealable, not automatic undisclosed punishment.
- A rider gets at most two compatible active orders in the initial release. Show the whole proposed batch and earnings before acceptance, or require separate consent before adding a later order. No silent detour/earnings reduction after acceptance.

### RIDER-03 — Pickup, delivery, incidents

Provide vendor navigation and item/handover summary; camera QR scanning with permission fallback; server-confirmed pickup; vehicle-specific customer route; scoped chat/contact; customer-unavailable workflow; cash due and exact COD amount; explicit delivery/cash collection confirmation; dispute/emergency/support access.

For multiple orders, show separate bags/order codes/customer stops and separate COD amounts; never aggregate away responsibility. Prevent collecting cash for the wrong order and scanning a QR from a cancelled or previous assignment. No default delivery photo exposing customer faces or home interiors; use a lawful minimized proof method.

Handle restaurant delay, wrong bag, customer relocation, route failure, breakdown, unsafe weather, injury, accident, app restart, battery loss and lost connectivity with clear escalation and authorized transitions. Store local drafts/queues only where reconciliation is safe; offline state must not fabricate completed handover/payment.

### RIDER-04 — COD remittance and earnings

At shift end/cash threshold show a cash-due workflow with amount breakdown, private Undal remittance destination fetched from backend, sender name/number, transaction ID, optional screenshot and required reviewed selfie where lawful. Audible reminders must be bounded and policy-compliant, never a hostile OS overlay.

Submission state is `submitted`, not `verified` or `paid`. Block new work according to approved policy while keeping existing deliveries, support, emergency, evidence resubmission and disputes accessible. Reject duplicate transaction references and forged amounts; finance verifies actual receipt separately. Do not scrape personal bKash/Nagad applications or private APIs.

Friday earnings statements itemize guaranteed fares, distance/traffic/weather/surge components, batch allocation, approved 3% bonus interpretation, tips if enabled, reviewed adjustments/penalties and payout fees. Cash held, cash remitted and earnings owed are distinct balances. No automatic punitive deduction for stale GPS or missing telemetry.

## E. Super-admin control plane

| Domain / IDs | Required working capabilities |
| --- | --- |
| ADMIN-GOV | Mandatory TOTP MFA; scoped staff roles; invite/revoke; session timeout; step-up for critical actions; immutable application audit trail; safe administrative reason capture and permission review. |
| ADMIN-ZONE | OSM polygon drawing/editing, valid templates, vertices/holes validation, overlap policy, versioned boundaries, dry-run impact, service modes, radius/pricing/closure controls and bilingual zone notices. No unreviewed polygon change strands active orders. |
| ADMIN-ONBOARD | Separate vendor/rider review queues, private R2 documents with metadata-based Worker authorization, completeness/expiry, correction requests, approvals, suspension/reverification and audited decision reasons. No arbitrary sensitive-image export or public bucket access. |
| ADMIN-ORDER | Live order tower with indexed filters, authoritative timeline, receipt/acceptance deadlines, assignment/pickup/delivery visibility, manual reassign/cancel/pause with preconditions, incident/case links and compensation consequences. |
| ADMIN-FLEET | Bounded zone fleet map/list, availability/freshness, demand aggregates, deterministic dispatch/batch settings, safe reassignment, versioned fee rules and route/provider health. No full nationwide GPS dump to every staff browser. |
| ADMIN-VENDOR | Store readiness/hours, menu moderation, food-only restricted-item policy, authorized profile edits, campaign review, rating moderation and no monthly listing/advertising charges. |
| ADMIN-FINANCE | Balanced ledger inspection, COD custody, vendor-retained pickup cash, remittance review, invoice generation/reconciliation, independent verify/pay steps, transfer reference/evidence, reversals/credit notes, CSV/PDF and aged balances. |
| ADMIN-SUPPORT | Scoped live/order chat, support queues, item/late/quality complaints, evidence access, reviewed refunds/adjustments, escalation, appeal and contact safeguards. No fake automatic gateway refunds. |
| ADMIN-GROWTH | Consent-based organic recommendations, genuine vendor/platform-funded promotions with budgets, referral/loyalty only if a real lawful funding model is approved, frequency caps and quiet hours. No paid subscription/ads/CPC. |
| ADMIN-INSIGHT | SQL-backed GMV/net revenue, order/service metrics, vendor/rider performance, costs, quota usage and bounded exports. CAC/LTV/forecast fields are absent or labelled unavailable until valid inputs/model evaluation exist. |
| ADMIN-CONFIG | Plugin/OAuth readiness, feature/zone flags, policy version publication, public origins, operational thresholds, secrets-present indicators without revealing values, deployment status, privacy/retention and incident controls. |
| ADMIN-OPS | Alarm/outbox/dead-letter inspection, reconciliation, quota safe mode, backup/restore workflow links, release fingerprints, health/freshness diagnostics, audit review and browser-operated recovery. |

A manual override must never bypass balanced accounting, tenant authorization, assignment uniqueness or statutory obligations. Require reason, actor, before/after state, timestamp and where appropriate a second approver. MFA and verified role membership are server requirements, not just hidden routes.

## F. Shared nonfunctional acceptance

Every visible control has a real enabled behavior or is intentionally absent/clearly configuration-disabled. Every page has loading, empty, error, expired-session, permission-denied and offline behavior where applicable. Transactional screens distinguish pending from confirmed. Critical finance/safety copy is translated.

Provide accessible keyboard/screen-reader use on web, large targets on Android, reduced motion, usable high text scaling, meaningful headings and focus handling. Test 200/320/360/390/414/768/1024/1440/1920px web layouts plus realistic Android density/font sizes. A 50px viewport gets a minimal fallback, not a fabricated full usability claim.

No production business demo seeds. Supported OAuth provider definitions, food taxonomy, zone templates, RBAC permission definitions and versioned policy schemas are legitimate reference configuration; they must not include fake customers, vendors, orders, payout accounts or funds.

All integrations must be wired through real API/data flows before being marked complete. Missing external credentials, provider permissions, email deliverability, routing service, legal approval, physical-device tests or free capacity are explicit blockers, not reasons to ship always-success simulations.
