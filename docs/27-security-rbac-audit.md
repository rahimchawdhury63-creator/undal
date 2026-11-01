<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 27 — Security, RBAC and Audit

> A platform that holds national ID cards, home addresses, phone numbers and cash owes its users a
> serious security posture. This document specifies authentication, authorisation, the audit
> trail, the threat model, and the things Undal deliberately does not do.

---

## 1. Threat model

| # | Threat | Likelihood | Impact | Primary control |
| --- | --- | --- | --- | --- |
| T1 | Credential stuffing against customer accounts | High | Medium | Argon2id, rate limiting, breach-list checks |
| T2 | Admin account takeover | Low | **Critical** | Mandatory TOTP, step-up auth, IP allowlist, session binding |
| T3 | Rider account takeover to redirect payouts | Medium | High | 72-hour payout-account cooling-off, multi-channel alerts |
| T4 | Vendor enumeration / menu scraping | High | Low | Rate limits; the data is public anyway |
| T5 | Customer PII exfiltration via the admin panel | Low | **Critical** | RBAC, audited reveals, export limits, step-up auth |
| T6 | SQL injection | Low | Critical | Parameterised queries only; a lint rule bans string-built SQL |
| T7 | Order tampering (client-set prices) | Medium | High | Server re-prices everything; the client's numbers are never trusted |
| T8 | QR replay to fake a pickup | Medium | Medium | HMAC + 150 m geofence + 4-hour window + state check |
| T9 | GPS spoofing for fake deliveries | Medium | High | Mock-location detection, speed plausibility, route conformance |
| T10 | Fake accounts for promo farming | High | Medium | Device + address + phone keying, velocity checks |
| T11 | Cash settlement fraud (fake TrxID) | Medium | High | TrxID uniqueness, OCR cross-check, human review |
| T12 | Malicious file upload | Medium | High | Magic bytes, re-encoding, no SVG, no executables |
| T13 | XSS in the web apps | Low | High | React escaping, strict CSP with no `unsafe-inline`, no `dangerouslySetInnerHTML` |
| T14 | CSRF | Low | High | `SameSite=Lax` + double-submit tokens |
| T15 | Secret leakage into the repo or an APK | Medium | **Critical** | `secret-scan` in CI, no secrets in client code, pre-commit hooks |
| T16 | Insider misuse of admin powers | Low | **Critical** | WORM audit with a hash chain, reason codes, impersonation restrictions |
| T17 | Denial of service | Medium | Medium | Cloudflare's edge, rate limits, bounded queries |
| T18 | Supply-chain compromise via a dependency | Medium | Critical | Lockfiles, `lockfile-drift`, licence and provenance checks, minimal dependencies |

---

## 2. Authentication

### 2.1 Passwords

```
Argon2id, m = 19456 KiB, t = 2, p = 1, 32-byte salt, 32-byte output.
```

Those parameters are OWASP's current recommendation and are tuned to run in **under 90 ms** inside
a Cloudflare Worker using a WASM build. A per-password `params` column stores the cost used, so
parameters can be raised later and hashes upgraded transparently on next login.

| Rule | Value |
| --- | --- |
| Minimum length | 8 |
| Maximum length | 128 (then rejected, never silently truncated) |
| Composition rules | **None.** Length and a breach-list check beat character-class rules |
| Breach list | The 10 000 most common passwords, bundled, checked client- and server-side |
| Reuse | The previous 3 hashes are kept for admins and rejected on change |
| Rotation | Never forced. Forced rotation produces worse passwords |

### 2.2 No OTP, no email verification

The brief forbids both, and the implementation contains no code path for either. The consequences
are faced honestly:

| Consequence | Mitigation |
| --- | --- |
| A phone number cannot be proven | It is validated for format and uniqueness; a delivery failure to a bad number is handled operationally |
| Password reset has no self-service channel | Admin-mediated single-use 15-minute tokens ([`08`](08-api-contract.md)), delivered through support |
| Account recovery is slower | Stated plainly at registration, so nobody is surprised |

### 2.3 Sessions

| Actor | Access token | Refresh | Notes |
| --- | --- | --- | --- |
| Customer | 15 min | 30 days sliding | Multi-device allowed |
| Partner | 15 min | 12 hours | Device-bound; 5 devices max |
| Rider | 15 min | 12 hours | Device-bound; **1 device** — a rider account on two phones is a fraud signal |
| Admin | 10 min | 4 hours absolute, 30 min idle | TOTP at login, step-up for sensitive actions |

Access tokens are JWTs signed with EdDSA, carrying `sub`, `role`, `scope`, `deviceId`, `sid` and
`exp`. Refresh tokens are opaque 256-bit values, hashed in the database, **rotated on every use**
with reuse detection: presenting a previously-used refresh token invalidates the entire family and
raises a `TOKEN_REUSE` security event.

### 2.4 TOTP

RFC 6238, SHA-1 (for authenticator compatibility), 6 digits, 30-second step, ±1 step drift.
Secrets stored encrypted with a key held in a Worker secret, never in the database in plaintext.
Ten single-use recovery codes, shown once, hashed at rest.

Mandatory for every admin. Optional for vendors and riders, and encouraged for vendor owners who
can see finance.

### 2.5 Google OAuth

Authorization-code flow with PKCE. Present in the UI **only** when both
`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are configured; the server advertises
`features.googleAuth` and the clients render accordingly. An unconfigured provider is absent, not
broken.

---

## 3. Authorisation

### 3.1 The permission model

**412 permission keys**, shaped `domain.resource.action`:

```
finance.payout.mark_paid
finance.invoice.void
dispatch.order.force_assign
kyc.document.view.nid_front
vendors.vendor.suspend
support.credit.issue
brain.weights.edit
analytics.export.personal_data
```

Roles are sets of keys. Users have roles, optionally scoped to zones. Every API handler declares
its required key in a decorator, and a CI job asserts that **every** handler declares one — a
handler with no declared permission fails the build.

```ts
export const markPayoutPaid = handler({
  permission: "finance.payout.mark_paid",
  stepUp: true,                        // requires fresh TOTP
  reasonRequired: true,
  rateLimit: { perMinute: 10 },
  async run(ctx, input) { /* … */ },
});
```

### 3.2 Scoping

A zone-scoped `DISPATCHER` sees and acts only within their zones. Scoping is applied in the data
layer as a mandatory predicate, not as a UI filter: the query builder refuses to construct a
zone-scoped query without the predicate, so there is no path by which a forgotten `WHERE` clause
leaks another zone's data.

### 3.3 Step-up authentication

Twenty-three actions require TOTP re-entry within the last 5 minutes:

marking a payout paid · voiding an invoice · a manual ledger adjustment · issuing a credit above
the role cap · changing RBAC · creating or deleting an admin · exporting personal data · viewing
an NID · force-cancelling an order · editing Brain weights · changing the pricing matrix ·
changing zone geometry · lifting a suspension · writing off cash · changing a payout account on
behalf of a user · bulk messaging above 500 recipients · deleting a vendor · approving a
settlement above ৳10 000 · break-glass IP bypass · impersonation · changing retention policy ·
rotating the QR secret · disabling an exception trigger.

### 3.4 Impersonation

Read-only, 15-minute maximum, requiring a reason, with a permanent banner on every screen, and a
notification to the impersonated user. **Write actions are structurally impossible**: the
impersonation session carries a token with an empty write scope, so the authorisation layer
rejects every mutation regardless of what the UI offers.

---

## 4. The audit trail

### 4.1 What is recorded

Every mutation, without exception. The `audit-coverage` CI job walks every handler marked as
mutating and asserts it writes an audit row; a handler that mutates without auditing fails the
build.

```sql
CREATE TABLE audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           INT8 NOT NULL,                    -- monotonic, gapless
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id      UUID,
  actor_type    STRING NOT NULL,                  -- ADMIN|VENDOR|RIDER|CUSTOMER|SYSTEM
  actor_role    STRING,
  ip            INET,
  user_agent    STRING,
  request_id    UUID NOT NULL,
  action        STRING NOT NULL,
  resource_type STRING NOT NULL,
  resource_id   STRING,
  subject_id    UUID,                             -- whose data was affected
  before        JSONB,
  after         JSONB,
  reason        STRING,
  severity      STRING NOT NULL,                  -- INFO|NOTICE|WARNING|CRITICAL
  prev_hash     BYTES,
  hash          BYTES NOT NULL
);
```

### 4.2 WORM

Three independent layers:

1. **Trigger**: `BEFORE UPDATE OR DELETE ON audit_log` raises an exception, unconditionally.
2. **Grants**: the application database role has `INSERT` and `SELECT` only. No `UPDATE`, no
   `DELETE`, no `TRUNCATE`.
3. **Hash chain**: `hash = SHA256(prev_hash || canonical_json(row_without_hash))`. Any alteration
   breaks the chain from that point forward.

`verify_audit_chain(from_seq, to_seq)` walks the chain and returns the first break. It runs on
every deploy, on demand from the admin panel, and as part of the nightly verification workflow.
A break raises `AUDIT_CHAIN_BROKEN`, severity CRITICAL.

### 4.3 Reason codes

Ninety-four actions require a reason, chosen from a controlled vocabulary with optional free text.
The vocabulary exists so reasons are *analysable* — "how many orders did we force-cancel for
`VENDOR_NONRESPONSIVE` last month?" is a question with an answer.

### 4.4 Retention

Audit rows are kept **indefinitely**. They are small (~1.2 KB), they are the record of what the
platform did to people, and deleting them is not a cost saving worth making.

---

## 5. Data protection

### 5.1 Classification

| Class | Examples | At rest | In transit | In logs |
| --- | --- | --- | --- | --- |
| **Public** | Vendor names, menus, prices, ratings | Plain | TLS | Allowed |
| **Internal** | Order contents, ETAs, dispatch traces | Plain | TLS | Allowed |
| **Personal** | Names, phones, addresses, positions | Plain in CRDB (encrypted at rest by the provider) | TLS | **Redacted** |
| **Sensitive** | NID, licence, bank details, documents | Cloudinary authenticated; NID numbers encrypted column-level | TLS | **Never** |
| **Secret** | Tokens, keys, password hashes | Hashed or encrypted | TLS | **Never** |

### 5.2 Log redaction

A single redaction function is applied to every log line in every service:

```ts
/**
 * Redaction is applied at the SINK, not at the call site, because a call
 * site can be forgotten. Anything matching these shapes is replaced before
 * a line is written, in every environment including development.
 */
const PATTERNS = [
  /\b01[3-9]\d{8}\b/g,                     // Bangladeshi mobile
  /\b\d{10}\b|\b\d{13}\b|\b\d{17}\b/g,     // NID formats
  /\bey[A-Za-z0-9_-]{10,}\./g,             // JWTs
  /\bBearer\s+\S+/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /"password"\s*:\s*"[^"]*"/g,
  /\b[0-9a-f]{32,}\b/gi,                   // keys, hashes, tokens
];
```

A test feeds 200 realistic log lines containing personal data through the sink and asserts none of
it survives.

### 5.3 Rights

| Right | Implementation |
| --- | --- |
| Access | A self-service export in the account screen: every piece of personal data, as JSON, delivered by a signed one-hour URL |
| Rectification | Self-service for name, phone, email, addresses; admin-mediated for documents |
| **Erasure** | A real two-step deletion. Personal data removed within 24 hours; orders anonymised (customer replaced by a tombstone) rather than deleted, because the vendor's and rider's financial records depend on them. The retained set is listed explicitly on the deletion screen |
| Portability | The same export, in a documented schema |
| Objection | Personalisation can be cleared in one tap and stays cleared ([`13 §13`](13-ranking-personalization.md)) |

---

## 6. Application security

| Control | Implementation |
| --- | --- |
| SQL | Parameterised only. A lint rule fails the build on template-literal SQL containing `${` outside an allowlisted query builder |
| Input validation | Zod schemas at every boundary, shared with the client, rejecting unknown keys |
| Output encoding | React escapes by default; `dangerouslySetInnerHTML` is banned by lint with zero exemptions |
| CSP | [`20 §10`](20-web-storefront.md). No `unsafe-inline`, no `unsafe-eval` |
| CSRF | Double-submit tokens on cookie-authenticated mutations |
| Clickjacking | `frame-ancestors 'none'` |
| Rate limiting | Per-route, per-actor and per-IP, in a Durable Object or CRDB depending on the coordination mode. 38 distinct limits |
| Idempotency | [`08`](08-api-contract.md); prevents duplicate orders and duplicate payouts |
| Mass assignment | Explicit field allowlists on every update; a DTO never maps directly to a model |
| IDOR | Every resource fetch carries an ownership predicate in the query, not an `if` after the fetch |
| Timing | Constant-time comparison for tokens, HMACs and TOTP codes |
| Dependency | Lockfiles committed; `lockfile-drift` fails on an unexplained change; `dependency-licence-and-cost` fails on a non-permissive licence or any dependency implying a paid service |

### 6.1 Secrets

| Rule | Enforcement |
| --- | --- |
| No secret in the repository | `secret-scan` with entropy and pattern detection on every push, plus a pre-commit hook |
| No secret in a client binary | A build-time check greps the compiled APK and the web bundle for every secret name and for high-entropy strings |
| All secrets in GitHub Actions | [`29`](29-secrets-and-configuration.md) |
| Rotation | Documented procedure per secret, with the blast radius of each stated |
| The QR HMAC key | Rotatable without invalidating in-flight orders: two keys are accepted during a 24-hour overlap |

---

## 7. Anti-fraud

| Vector | Control |
| --- | --- |
| **Fake vendor self-orders** | Wilson bounds cap the ranking benefit; an anomaly exception fires at 12 self-matched orders; vendor stats are keyed to the owner's NID hash so a delete-and-recreate inherits history |
| **Prep-time gaming** | Promising 5 minutes collapses `prep_accuracy` within 20 orders, and that term is weighted second-highest in the performance score |
| **Rider reject gaming** | Rejections lower `acceptance`, which lowers dispatch rank. Net-negative by construction |
| **GPS spoofing** | `isMock` flag, speed plausibility (>40 m/s motorbike, >15 m/s bicycle), teleport detection, route conformance, and bounding-box checks. A detection suspends the shift and raises CRITICAL |
| **Promo farming** | Keyed on device ID + normalised address + phone; a velocity check on new accounts per device and per address cluster |
| **Fake settlements** | TrxID uniqueness across all history, OCR cross-check, human review |
| **Payout redirection** | 72-hour cooling-off, multi-channel alerts, name matching |
| **Review manipulation** | Only customers with a `DELIVERED` order may rate; one rating per order; velocity and device-cluster checks |
| **Referral abuse** | Device, address and phone keying; the reward pays only after the referee's first `DELIVERED` order |

---

## 8. What Undal deliberately does not do

| Not done | Reason |
| --- | --- |
| Background location tracking | `ACCESS_BACKGROUND_LOCATION` is never requested. Riders are tracked only during an active foreground shift |
| Track off-shift riders | Their position is not stored anywhere; the D1 channel is erased at shift end |
| Store customer location history | Only saved addresses the customer chose to save, and the drop point of active orders |
| Third-party analytics | No SDK, no tag manager, no session recording. The event log is first-party and stays on Undal's own infrastructure |
| Sell or share data | Not with advertisers, not with data brokers, not with "partners" |
| Advertising identifiers | Not collected, not used, not present in any build |
| Contact-list access | Never requested |
| Microphone | Never requested |
| Read SMS to auto-fill an OTP | There is no OTP, and this permission is a notorious abuse vector |
| Shadow profiles | No data is collected about people who are not users |

---

## 9. Incident response

| Phase | Actions |
| --- | --- |
| **Detect** | Exception triggers ([`21 §8.1`](21-admin-panel.md)), the audit chain verifier, error-rate alarms, the `TOKEN_REUSE` signal |
| **Contain** | A documented kill switch per subsystem: disable new orders, disable payouts, force-logout all admins, revoke a token family, rotate a secret |
| **Assess** | The audit log is the authoritative record; the trace log provides decision context |
| **Notify** | Affected users within 72 hours, in plain language, stating what happened, what data was involved, and what has been done |
| **Recover** | Documented procedures per scenario in [`39`](39-risk-register-and-truths.md) |
| **Learn** | A written post-incident review, published internally, with the resulting control added to this document |

Kill switches are real, tested features with their own admin screen and their own tests — not
commented-out code or a runbook that says "edit the config and redeploy".

---

## 10. Testing

| Test | Count |
| --- | --- |
| RBAC matrix — 412 keys × 7 roles | 2 884 |
| Every handler declares a permission | 1 CI job |
| Every mutating handler audits | 1 CI job (`audit-coverage`) |
| Step-up enforcement on all 23 actions | 23 |
| Zone scoping cannot be bypassed | 18 |
| Impersonation cannot write | 11 |
| WORM — update, delete, truncate all rejected | 6 |
| Hash chain detects a tampered row at any position | 9 |
| Password hashing parameters and upgrade path | 8 |
| Refresh-token rotation and reuse detection | 12 |
| TOTP, including drift and replay | 10 |
| Log redaction over 200 realistic lines | 1 |
| IDOR — 64 resource endpoints probed with another actor's IDs | 64 |
| SQL-injection fuzzing on every text input | 1 suite |
| XSS payload corpus against every rendered field | 1 suite |
| Rate limits, all 38 | 38 |
| `secret-scan` | 1 CI job |
| Anti-fraud scenarios | 9 — [`09 §12`](09-undal-brain-overview.md) |
| Kill switches | 7 |

---

## 11. Reading on

Next: [`28-cicd-github-actions.md`](28-cicd-github-actions.md) — how all of this ships from a
browser.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
