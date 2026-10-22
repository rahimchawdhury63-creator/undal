# 05 — Security, Android alerts, privacy, and operational safety

## A. Security objectives and threat model

Protect customer identity/address, private home-kitchen locations, rider GPS, owner/rider KYC, payout accounts, COD custody, order integrity, administrative authority, signing keys and provider credentials. Define adversaries: unauthenticated scraper; abusive customer; malicious vendor employee; dishonest rider; compromised device/session; overprivileged staff; stolen backend secret; hostile dependency; forged upload; replaying client; provider outage and accidental operator error.

Use a documented STRIDE-style threat model and abuse cases for each trust boundary: app↔Worker; Worker↔Supabase; Supabase↔outbox consumer; Worker↔Firebase; Worker↔private R2 binding; privileged staff↔private evidence; Actions↔cloud providers; imgbb URL↔public browser; signing key↔release artifact. “Non-breakable” is not a security control. Record residual risks and incident/recovery procedures.

Release blockers include cross-tenant access, unauthorized role assignment, accepted-order price manipulation, duplicate cash/payment effects, exposed private documents, hardcoded secrets, bypassable admin MFA, insecure signing artifacts, replayable handover, fake payment verification or unresolved critical/high findings without an approved documented disposition.

## B. Identity, sessions, RBAC, and administrative control

- Validate Supabase JWT cryptographically with expected issuer/audience, algorithm restrictions, expiry, subject and appropriate assurance level. Cache/rotate official JWKS safely; do not merely decode a JWT. Never trust a client role field or writable user metadata as authority.
- Store approved resource memberships/permissions in authoritative tables. All objects are scoped by owner/vendor/order/zone/region and action. Default deny; test allow and deny for every role. A super-admin UI route is not the security boundary.
- Use email/password with real recovery/delivery configuration, optional supported OAuth and explicitly unverified phone alias policy. Rate-limit signup/login/reset/alias lookup and use generic responses to reduce enumeration. A phone claim without OTP is not verified ownership.
- Admin accounts require TOTP enrollment and a verified `aal2` session before sensitive APIs. Enforce idle/max session limits, revocation, step-up/re-authentication, recovery and a protected audited break-glass procedure. Do not substitute a six-digit client-side comparison for Supabase MFA verification.
- Bootstrap the first admin once through a protected idempotent Actions job using a configured email/initial password. Do not reset the password or recreate elevated users on every deployment. Require password change/MFA, then remove/rotate unnecessary bootstrap secrets. Never log the initial password.
- Separate finance verification, payout approval, KYC review, support, menu operations and dispatch scopes. Require maker/checker for configured high-risk payments/account changes. Staff cannot approve their own promotion to higher privilege.
- Native tokens use maintained Android Keystore-backed secure storage and clear on logout/revocation. Document rooted/compromised-device limitations. Browser sessions use a documented strategy: short-lived tokens, minimal persistence, strict CSP and no reliance on third-party cookies across `pages.dev`/`workers.dev`. If a custom-domain HttpOnly-cookie BFF is used, implement CSRF protection and secure cookie attributes.
- Logout removes device-token association, realtime participants as appropriate, cached sensitive data and active subscriptions. Account suspension/role change must affect already-connected clients, not only the next login. Test revocation windows and stale-token behavior.

## C. API, database, rules, and abuse protection

Use typed request schemas, bounded bodies, parameterized SQL, fixed-purpose RPCs, explicit errors, idempotency/version checks and timeouts. Reject unknown/forbidden fields for sensitive mutations. Do not expose generic privileged SQL execution, arbitrary URL fetch, unrestricted storage signing, or unconstrained admin settings.

RLS applies to all exposed PostgreSQL tables, including private-file metadata; it does not apply to R2 objects. Private R2 access requires independently enforced Worker authorization. Database functions have narrow execution grants and fixed `search_path`. SQL constraints protect assignment uniqueness, balance, valid transitions and ownership even when two Workers race. Service-role keys bypass RLS; restrict their usage to audited server paths with independent actor/resource checks.

RTDB rules are default-deny, membership-scoped, shape-validating and query-bounded where supported. No `.read: true` private roots and no `.write: auth != null` broad trees. Trusted backend writes participants/roles/order truth; clients cannot self-add to an order or give themselves a staff flag. GPS/presence observations never become financial authority.

Rate-limit by endpoint cost plus account/device/vendor/zone/IP where appropriate. Mobile NATs mean IP-only rules can unfairly block many Bangladesh users. Sensitive login, public-image uploads, quote creation, checkout, chat, QR redemption, evidence access, admin exports and payout actions need distinct limits/retry semantics. Use free-plan DO/SQL-backed coordination where strict distributed limits are needed and account for its own rows/requests; an isolate-local map is not a globally strict limiter.

Use exact configured origins and server-side authorization. No wildcard credentialed CORS, reflected arbitrary Origin, production localhost callbacks or user-controlled redirect URL. Development preview origins are environment-specific; do not make every `*.e2b.app` or every internet origin a permanent production allowlist. Prefer bearer authentication for the default cross-origin deployment; cookie variants need CSRF defenses.

Harden headers: CSP without broad unsafe script sources, HSTS where appropriate, no MIME sniffing, safe referrer policy, frame restrictions, least-permission policy and no-store for private API/documents. Keep service workers from caching auth, private order/chat, admin, payout or KYC responses. Never put credentials or private fields in URL query strings, SEO metadata, analytics events or error reports.

App Check/Play Integrity may be added if current free quotas/availability and device coverage support it, but it is abuse defense, not authorization or proof of identity/GPS. No unsupported-device silent lockout without disclosure and safe support path.

## D. Public image upload and private evidence

### Public imgbb pipeline

1. Authenticate uploader and verify vendor/item/application authority and allowed public purpose. Capture a public-visibility declaration; do not rely on an automated classifier to guarantee no identity document was selected.
2. Normalize supported formats in a maintained client/native codec where appropriate; cap input bytes, pixel count/dimensions and output quality. Reject unsupported corrupt files with an explicit error. “Any extension” does not imply every codec/file can safely be accepted.
3. Revalidate server-side MIME/magic bytes, bounded dimensions/size, purpose and rate/budget. Permit only approved raster image formats such as JPEG/PNG/WebP. Reject SVG/HTML and active content; renaming a file is not conversion or validation.
4. Strip EXIF/location metadata using a method actually implemented and tested. If server verification/transformation is too CPU-heavy for Free, select bounded supported formats and prove the alternative; do not claim metadata was removed when only the file extension changed.
5. Worker sends `POST https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}` with base64 `image` in an accepted form body, not a client-supplied remote URL. The secret is available only in backend/Actions environments. Suppress upstream request URLs/query secrets in logs and exceptions.
6. Validate provider status/schema and returned HTTPS host/path; record provider image ID, purpose/owner, checksum, content type/dimensions, public URL and upload lifecycle. Keep deletion credentials private. Deduplicate/retry idempotently and handle abandoned uploads/broken links under provider terms.
7. Public image URLs are genuinely public. Do not promise authorization/privacy after upload; explain this in uploader UI. Rotate the exposed original API key before any real use.

### Private Cloudflare R2 evidence pipeline

Use **private Cloudflare R2 Standard** buckets for all sensitive image/file bytes: NID/passport/license, tax/bank/mobile-wallet proof, utility bills, private kitchen photographs, face selfies, cash-remittance/payment screenshots, private chat/support/dispute attachments and invoice PDFs. Store only ownership/association, opaque bucket/key references, classification, verified type/size/checksum, lifecycle/retention and audit metadata in Supabase. No Supabase Storage bucket or database image/blob fallback is part of this design.

Disable managed `r2.dev` access and all direct public bucket custom domains. The private bucket must remain inaccessible through anonymous direct object URLs. Native Worker R2 bindings run within the existing three Worker scripts; they do not create a fourth Worker and require no S3 access keys in mobile/web clients. Restrict bindings/CI credentials to necessary buckets and operations; verify these settings during deployment, not only in documentation.

**Supabase RLS protects metadata only; R2 authorization is enforced by Workers.** A verified JWT alone is insufficient: resolve file metadata server-side and check current owner/application/vendor/order/case association, allowed action, lifecycle state, suspension/revocation and scoped reviewer role. Review/export by staff requires appropriate MFA. Deny cross-tenant object guessing, arbitrary key selection/listing, path traversal, unauthorized purpose changes and reads of quarantined/deleted/expired files. Repeat authorization for GET, HEAD, Range, conditional access and deletion; do not authorize only an initial metadata request.

Uploads require an authorized expiring intent, server-generated random object key, per-file/per-user/account quota reservation and actual streamed byte limits. Preserve evidence legibility while validating allowed raster/PDF types, magic bytes and supported dimensions/checksum, stripping metadata only where safely implemented. Do not trust Content-Length, MIME or filename alone; abort oversize streams and clean staged objects. Do not claim universal conversion/malware sanitization within free Worker CPU limits. Ready metadata is finalized only after verified storage; retries and SQL/R2 partial failures reconcile idempotently. Bucket/key references, ownership, sensitivity, verified size and ready/review/deletion states are server-controlled metadata fields; clients cannot rewrite them to expose or substitute another object.

Prefer authenticated Worker streaming for downloads, with `Cache-Control: private, no-store`, safe content type/disposition, no sniffing and no shared CDN/Cache API/service-worker/private-disk persistence. Web preview uses an authenticated fetch and short-lived in-memory blob URL revoked on close/logout; do not append Supabase JWTs to image URLs. Native previews use protected requests and clear sensitive caches. A public bucket must never be enabled merely to make previews work.

If direct S3 presigned access is explicitly approved as an exception, require object/method scope, a very short lifetime, careful client handling and access audit at issuance. These URLs are bearer tokens usable by anyone who receives them and can be reused until expiry; they do not re-check Supabase roles on each read. Do not label them single-use, instantly revocable on logout, equivalent to the authenticated gateway, or valid for arbitrary custom domains. R2 credentials remain server/CI-only.

No base64/SVG database wrappers, public imgbb copies, permanently exposed object links or broad shared staff download tokens. PDFs need their own type/size/sandbox/download policy; an extension does not make active content safe. Keep names/NID/phone/account data out of object keys and transport logs. R2 does not recognize which images are sensitive: the explicit upload-purpose/authorization policy must choose the correct private pipeline before any bytes reach a public service.

Collect only required evidence, restrict raw access to authorized reviewers/owners, mask account identifiers in lists and prohibit unauthorized bulk exports. Define retention/legal hold and data-residency obligations. Tombstone/revoke metadata first, then delete objects and abandoned uploads with audited outbox/alarm retries; test failed delete, object-without-metadata, metadata-without-object and restore access. Revocation blocks later gateway access but cannot recall bytes already downloaded. Provider-managed at-rest encryption/TLS and optional separately managed application encryption are not an E2EE claim; document actual implemented protections and limits.

Use Standard storage only within verified included R2 storage/Class A/Class B allowances; budget across both buckets and other account consumers. Check current subscription/checkout/payment requirements rather than claiming no enrollment/billing setup. Reserve headroom and bytes/operations before accepting concurrent uploads; throttle reads/exports and stop new uploads safely near allocation exhaustion. Free egress is not unlimited free storage/operations, and application quota controls are not a provider-guaranteed zero-bill cap. Never silently enable paid features, change to Infrequent Access or send sensitive files to public imgbb when capacity is exhausted.

## E. Data-only FCM protocol

Partner and rider messages must have **no `notification` object** at top level or under the Android payload. Use HTTP v1 from the trusted coordinator with legitimate service-account OAuth credentials. Payload values in `data` are strings and fit documented limits. Example shape, not an emitted production message:

```json
{
  "message": {
    "token": "DEVICE_TOKEN_FROM_PROTECTED_REGISTRY",
    "android": {"priority": "HIGH", "ttl": "120s"},
    "data": {
      "schema": "1",
      "event_id": "PERSISTED_EVENT_ID",
      "type": "vendor_order_offer",
      "resource_id": "AUTHORIZED_ORDER_ID",
      "aggregate_version": "7",
      "issued_at_ms": "SERVER_TIME",
      "expires_at_ms": "SERVER_DEADLINE"
    }
  }
}
```

The all-caps values above explain configuration/runtime fields; they must be replaced by real validated records in the implementation, never hardcoded demo delivery logic. Minimal IDs/times are sufficient; do not include full customer address, phone, chat text, KYC, signing material or API credentials.

Use high priority only for genuinely urgent user-visible order/offer events. Delivery priority can be downgraded by FCM; handle actual received priority, not only requested/original priority. Do not use high-priority silent bulk heartbeats to evade battery policies. Separate ordinary marketing and transactional channels/consent.

Choose collapse behavior explicitly: do not collapse distinct pending orders into one lost alert. Collapse stale updates for the same resource only when it cannot hide required actions. TTL and server expiry both apply; stale messages never restart a cancelled/expired offer. Backoff retries must check current order state before resending.

Device-token registry binds token, user, app flavor, device session, platform/version, capability/readiness, last refresh and revocation state. Handle token rotation, invalid/unregistered response, logout, account change and stale multi-device ownership. Tokens are sensitive routing identifiers, not user identity or proof of receipt.

Persist notification intent/outbox/attempt separately from device receipt acknowledgement and user acceptance. A successful FCM send response means acceptance by FCM, not a displayed notification, audible loop or order acceptance. Device acknowledgement is authenticated and idempotent; only an explicit authorized order command changes business acceptance.

## F. Native alert implementation contract

Use a single clearly owned Android message entrypoint. If using FlutterFire plus a native service/plugin, document manifest/service ownership and prevent duplicate callbacks or one plugin suppressing another. Critical initial notification handling cannot depend on a Flutter screen/isolate already being alive.

On a data message: validate schema/resource/expiry; deduplicate persistently; create an appropriate user-visible notification promptly where permitted; schedule only allowed bounded work; fetch authoritative state before presenting sensitive details or accepting the order. Network failure shows “sync required,” not invented item/customer data. Never block the short FCM processing window with unbounded HTTP retries.

Implement notification channels, channel importance/sound education, Android runtime notification permission, version-specific background limits and a readiness screen. Channel settings remain user-controlled. A channel cannot be silently elevated after the user changes it; do not repeatedly create new channels to defeat a user's mute choice.

If looping alert audio requires a foreground service, use a genuinely appropriate current Android service type, permissions, user-visible notification and allowed start exemption. Do not relabel order audio as a call/alarm or media session solely to bypass restrictions. Check runtime FCM priority/eligibility, catch start-not-allowed errors, respect duration limits/timeouts and degrade to a lawful notification. An unsupported/denied service path is a reported capability gap, not an exception to hide.

Loop only while an alert is actionable: vendor acknowledgement deadline, rider offer expiry or other explicitly bounded pending state. Stop on receipt/user acknowledgement according to policy, acceptance/rejection, cancellation, reassignment, timeout, logout, permission/capability loss or authoritative state change. Release wake/audio resources and support multiple concurrent orders without overlapping uncontrolled audio or losing queue visibility.

Use only bounded wake locks if justified. Do not request unrestricted overlays/accessibility/device-admin/full-screen intent/DND bypass as a general delivery-app privilege. Locked-screen notifications depend on user privacy settings; do not promise arbitrary activities will open while locked. A genuine reboot receiver can restore permitted local readiness diagnostics but cannot resurrect force-stopped delivery or silently start unlawful services.

Rider on-shift location uses an explicit permitted location foreground service with ongoing disclosure, permissions, sampling/accuracy adaptation and battery controls. Stop tracking off shift; background/approximate/denied location must affect dispatch eligibility truthfully. A push wake-up is not a substitute for a lawful continuous on-shift location lifecycle.

## G. Required Android lifecycle/device matrix

Record device model/OEM, Android/API/target SDK, app version/signing identity, Play-services version, channel/permission state, battery setting, network, exact kill action, send/receipt/display/audio/ack timestamps and observed result. Use real physical devices for OEM/background behavior; emulator-only runs are labelled accordingly.

| State | Required behavior and honest limit |
| --- | --- |
| Foreground, network available | Native/Flutter queue and alert consistent; one event one active alert; receipt and acceptance distinct. |
| Background, process alive | Correct visible notification and permitted alert lifecycle, no duplicate order acceptance. |
| Process reclaimed by OS | Attempt supported native FCM handling; restore persisted alert/dedup state without needing a running Flutter UI. Record actual result. |
| Swiped from recents | Test separately per OEM; do not equate it universally with force-stop or claim identical behavior. |
| Screen off/locked | Respect notification privacy, audio/channel/DND policy and foreground-service restrictions; record visibility/audio behavior. |
| Doze/battery saver/background restricted | Test priority/deprioritization/delay and fallback; no “instant under all conditions” claim. |
| Settings → Force stop / package stopped | Delivery/looping is **not guaranteed** and must not be faked. Explicit reopening may be needed; server marks readiness stale and stops admitting orders based on the device lease. |
| Device powered off / no network | No instantaneous delivery possible; TTL expiry, stale readiness and server cancellation/reassignment apply. |
| Notifications denied/channel muted/DND | Explain actual readiness/limitations and respect the choice; do not secretly override. |
| Google Play services unavailable/unsupported | FCM capability absent/degraded; offer supported connected-app behavior only if genuinely implemented; no always-working claim. |
| Logout/account switch/token rotation | Old account cannot receive usable private events or accept new work; clear/rebind state securely. |
| Reboot / app update / permission revocation | Recover only through supported lifecycle, re-check readiness, preserve order dedup and do not silently assume online state. |
| Two simultaneous orders and duplicate/out-of-order pushes | Both remain visible; queue order/version logic prevents lost events, duplicate effects and uncontrolled overlapping sounds. |

Cover minimum supported Android, representative intermediate APIs, current target/latest stable available, a stock Android device and relevant Samsung/Xiaomi/Realme/Oppo/Vivo/Tecno/Infinix families when devices are actually available. Do not mark unavailable devices tested; use a release blocker/risk acceptance with clear supported-device policy.

Measure latency as separate intervals: SQL commit→outbox claimed; outbox→FCM accepted; accepted→device callback; callback→notification/audio; notification→human acknowledgement. Report p50/p95/p99 with sample size/state/network, not a blended “zero latency” headline.

## H. Handover, remittance, audits, and incident controls

Handover QR uses a high-entropy opaque/signed short-lived token bound to order, assignment/rider, purpose, expiry and nonce; store hashed token/nonce and single-use redemption in SQL. Validate current state/version and authorization in the redemption transaction. Never embed full PII or a reusable static restaurant code. Test replay, screenshots from earlier assignments, wrong rider/order, expired token, forged signature and cancellation/scan race. A non-QR fallback requires reviewed authorization and audit, not a public bypass code.

Remittance destination is a server secret/config value revealed only to approved authorized riders when needed; a number that riders must use is not hidden from those riders, but must not leak into public bundles. Track expected amount, sender fields, provider/reference scope, submitted evidence, manual receipt verification, discrepancies, rejections and appeals. Screenshot/selfie recognition is not proof of settled funds.

Cash-due restrictions block new work according to policy while preserving emergency, support, dispute, evidence correction and existing delivery access. Bounded reminders follow the same Android restrictions; no permanent hostile lock-screen takeover or indefinite forced audio. Penalties require approved policy, evidence, human review where required and appeal; never infer misconduct solely from network/GPS gaps.

Audit admin/financial transitions with actor/scope, MFA context, timestamp, correlation ID, reason, object version and minimized before/after deltas. Restrict mutation by normal application roles; chain canonical record hashes and optionally publish separately protected signed checkpoints. This is tamper-evident application logging, **not WORM against a database owner/service-key compromise**. State that limitation and keep sensitive values out of audit exports/checkpoints.

Maintain runbooks for leaked key, stolen admin session, compromised rider device, private-upload exposure, COD shortfall, duplicate payment attempt, routing outage, Firebase/SQL projection divergence, failed alarm, quota exhaustion and signing-key compromise. Preserve evidence securely, revoke capabilities, reconcile authoritative records, notify affected parties as required and document recovery before reopening service.
