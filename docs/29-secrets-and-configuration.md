<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 29 — Secrets and Configuration

> Every secret lives in GitHub Actions. Nothing is hard-coded, nothing is in the repository, and
> the platform is domain-agnostic: the same code deploys to any domain by changing one secret.
> This document is the complete register, with the blast radius and rotation procedure for each.

---

## 1. The three layers

| Layer | Holds | Where | Changed by |
| --- | --- | --- | --- |
| **Secrets** | Credentials, keys, tokens, the bKash number, the domain | GitHub Actions repository secrets → pushed to Worker secrets by the deploy workflow | Repository Settings in a browser |
| **Config** | Business rules: rates, weights, thresholds, feature flags | `platform_config` table in TiDBhDB | The admin panel, versioned and audited |
| **Constants** | Things that are not configurable: state-machine transitions, the paisa base, the posting rules | Code | A pull request |

The boundary matters. A value in the wrong layer is a problem: a commission rate in code requires
a deploy to change, and a JWT signing key in the database is a breach waiting to happen.

---

## 2. The secret register

### 2.1 Database

| Secret | Example shape | Used by | Blast radius if leaked |
| --- | --- | --- | --- |
| `TIDB_DATABASE_URL` | `mysql://user:pw@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/undal?ssl={"rejectUnauthorized":true}` | `undal-core` | **Total.** Full read/write on every business table |
| `TIDB_MIGRATION_URL` | A separate, higher-privilege user | `migrate.yml` only | Total, plus DDL |

**One secret disappeared rather than being renamed.** `COCKROACH_CA_CERT` has no successor:
`@tidbcloud/serverless` speaks HTTPS to a gateway with a publicly trusted certificate, so there is
no cluster CA to embed at build time. That is one fewer secret to rotate, one fewer build step, and
one fewer way for a deploy to fail at 2 a.m. The count goes **44 → 43** and the mandatory count
goes **12 → 11**; `env-example-complete` is the arbiter and fails the build on any drift.

The application user and the migration user are **different database roles**. The application
role has `SELECT`, `INSERT`, `UPDATE`, `DELETE` on business tables, `INSERT`/`SELECT` only on
`audit_log`, and **no DDL**. This is what makes the WORM guarantee in
[`27 §4.2`](27-security-rbac-audit.md) real rather than aspirational.

### 2.2 Cloudflare

| Secret | Used by | Blast radius |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | All deploy workflows | High — can deploy arbitrary code. Scoped to Workers Scripts Edit + Pages Edit + D1 Edit only, never Account-wide |
| `CLOUDFLARE_ACCOUNT_ID` | Same | None alone |
| `D1_DATABASE_ID` | `undal-realtime`, `d1-migrate.yml` | Low — ephemeral position data |
| `KV_NAMESPACE_ID` | `undal-core` | Medium — cached features and tokens |

### 2.3 Media

| Secret | Used by | Blast radius |
| --- | --- | --- |
| `IMGBB_API_KEY` | `undal-core` media proxy | Medium — an attacker could upload to the account. Never shipped to a client |
| `CLOUDINARY_CLOUD_NAME` | `undal-core` | None — it is public by design |
| `CLOUDINARY_UPLOAD_PRESET` | `undal-core` | Medium — unsigned upload into the restricted folder |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | `undal-core` for signed delivery and deletion | **High** — signs URLs to every stored identity document |

### 2.4 Notifications

| Secret | Used by | Blast radius |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | `undal-realtime` only | **High** — can send any push to every device. Scoped to the `firebase.messaging` role only |
| `FCM_SENDER_ID` | Android builds | None — public |
| `FCM_SIG_KEY` | `undal-realtime` + Android builds | Medium — allows forging a payload that passes the client signature check |

### 2.5 External services

| Secret | Used by | Blast radius |
| --- | --- | --- |
| `OSRM_BASE_URL` | `undal-core`, `undal-brain` | Low; may reveal a private routing host |
| `WEATHER_BASE_URL` | `undal-brain` | None |
| `TILE_BASE_URL` | Web + Android | None — public |
| `NOMINATIM_BASE_URL` | Web + Android | None |

Each has a documented fallback: OSRM → haversine × detour factor; weather → rider-speed inference;
tiles → the public OSM tile server with its usage policy respected; Nominatim → manual address
entry.

### 2.6 Auth

| Secret | Used by | Blast radius |
| --- | --- | --- |
| `JWT_SIGNING_KEY` | `undal-core` | **Critical** — forge any session. Ed25519 private key |
| `JWT_PREVIOUS_KEY` | `undal-core` | Used during rotation; accepted for verification only |
| `ORDER_QR_SECRET` | `undal-core` | High — forge a pickup QR. Mitigated by the geofence |
| `ORDER_QR_PREVIOUS_SECRET` | Rotation overlap | |
| `TOTP_ENCRYPTION_KEY` | `undal-core` | **Critical** — decrypt every admin TOTP seed |
| `GOOGLE_OAUTH_CLIENT_ID` | `undal-core`, clients | None — public |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `undal-core` | High |
| `ADMIN_OIDC_*` | `undal-core` | High, when SSO is configured |
| `JWT_PUBLIC_KEY` | `undal-realtime` | None — the public half. `undal-realtime` verifies a session and cannot mint one. An optional secret: absent, realtime refuses rather than trusting (D79) |
| `INTERNAL_TOKEN` | `undal-core` → `undal-realtime` | Medium — reaches the internal surface (`/internal/presence`, `/internal/broadcast`, `/internal/coordination/statements`). Optional: absent, that surface answers `403`. Rotating it degrades presence, not money |

### 2.7 Finance

| Secret | Used by | Blast radius |
| --- | --- | --- |
| `UNDAL_BKASH_PAYOUT_NUMBER` | `undal-core` → rider app | **Operationally critical.** A substituted number diverts every rider's cash settlement. Changes require two approvals and notify every rider |

That last row is the single most dangerous secret in the platform from a fraud perspective, and it
is the one the brief specifically asks to be an Actions secret. Its change procedure is
correspondingly strict: a change triggers an immediate in-app notice to every rider showing the
old and new numbers, and settlements against the old number are accepted for 48 hours.

### 2.8 Public configuration (secrets for domain-agnosticism)

| Secret | Purpose |
| --- | --- |
| `PUBLIC_WEB_HOST` | `undal.example` — the storefront domain |
| `PUBLIC_API_BASE` | `https://api.undal.example` |
| `PUBLIC_ADMIN_HOST` | `admin.undal.example` |
| `PUBLIC_BRAND_NAME` | `Undal` — used in titles, emails and PDFs |
| `PUBLIC_SUPPORT_PHONE` | Shown throughout the apps |
| `PUBLIC_SUPPORT_EMAIL` | |
| `PUBLIC_DEFAULT_CITY` | `Sylhet` — the map's initial centre |
| `PUBLIC_DEFAULT_LAT` / `_LON` | |
| `PUBLIC_DEFAULT_ZOOM` | |

> *"the domain should not be fixed, it should be an Actions secret."*

These are not secret in the cryptographic sense; they live in the secret store because that is the
only configuration channel the brief permits, and because it makes the repository genuinely
deployable by anyone to any domain without editing a line of code. The build injects them at
compile time for the clients and at deploy time for the Workers.

### 2.9 Android signing

| Secret | Purpose |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | **Irreplaceable.** Losing it means no published app can ever be updated |
| `ANDROID_KEYSTORE_PASSWORD` | |
| `ANDROID_KEY_ALIAS` | |
| `ANDROID_KEY_PASSWORD` | |
| `ANDROID_SHA256_FINGERPRINT` | Used to generate `assetlinks.json` |
| `PLAY_SERVICE_ACCOUNT_JSON` | Optional; enables Play track upload |

### 2.10 Bootstrap admin

| Secret | Purpose |
| --- | --- |
| `BOOTSTRAP_ADMIN_EMAIL` | The first `SUPER_ADMIN` |
| `BOOTSTRAP_ADMIN_PASSWORD` | Used **once**, on first boot, then the account must change it |

The bootstrap admin is created by the first request to a fresh database, not by a seed migration —
it is identity infrastructure, not business data. The account is forced through a password change
and TOTP enrolment before it can do anything else, and the secret is then meaningless.

---

## 3. Total count

**45 secrets**, of which **11 are mandatory** for a working deployment:

```
TIDB_DATABASE_URL           TIDB_MIGRATION_URL         CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID       D1_DATABASE_ID             KV_NAMESPACE_ID
IMGBB_API_KEY               FIREBASE_SERVICE_ACCOUNT_JSON
JWT_SIGNING_KEY             ORDER_QR_SECRET            PUBLIC_WEB_HOST
PUBLIC_API_BASE
```

Everything else degrades gracefully. The `health.yml` workflow reports which optional capabilities
are unavailable and why, as a table:

```
  ✓ Database              connected, 12 migrations applied
  ✓ Workers               core 41ms · realtime 18ms · brain 6ms
  ✓ Media                 imgbb ok · Cloudinary ok
  ✓ Notifications         FCM v1 ok, token cached
  ✓ Routing               OSRM ok, 42ms
  ⚠ Weather               WEATHER_BASE_URL not set — using rider-speed inference only
  ⚠ Google sign-in        not configured — the button is hidden
  ⚠ Play upload           not configured — artifacts available from Releases
  ✓ Android signing       keystore present, SHA-256 matches assetlinks.json
```

---

## 4. `platform_config`

Business rules live in the database so they can be changed without a deploy — which, for a
browser-only developer, is the difference between a 10-second change and an 11-minute one.

```sql
CREATE TABLE `platform_config` (
  `key`          VARCHAR(120) NOT NULL,
  `zone_id`      BINARY(16)   NOT NULL DEFAULT 0x00000000000000000000000000000000,
                               -- all-zero UUID = the global default. MySQL keys cannot
                               -- hold NULL, so the sentinel replaces the old nullable row.
  `value`        JSON         NOT NULL,
  `version`      VARCHAR(32)  NOT NULL,      -- 'r10.3.1'
  `effective_at` DATETIME(6)  NOT NULL,      -- UTC; connections pin time_zone='+00:00'
  `created_by`   BINARY(16)   NOT NULL,
  `reason`       VARCHAR(255) NOT NULL,
  -- Ascending, because a primary key column cannot be DESC. "Latest value for this key"
  -- is a backward index scan on the same key, which TiDB serves without a second index.
  PRIMARY KEY (`key`, `zone_id`, `effective_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
```

| Property | Rule |
| --- | --- |
| Temporal | A change inserts a new row. Nothing is ever mutated, so any past decision can be replayed against the configuration that was actually in force |
| Scoped | A zone row overrides the global default |
| Versioned | Every value carries a semantic version used in traces |
| Audited | `created_by` and `reason` are mandatory |
| Propagation | ≤ 60 seconds, via a KV cache with a 60-second TTL and an explicit invalidation on write |
| Validated | Every key has a JSON Schema and a range; an out-of-range value is rejected at write time, not discovered at runtime |

### 4.1 The key register

| Group | Keys | Examples |
| --- | --- | --- |
| Fare | 24 | `base_fare_motorbike_paisa`, `per_km_bicycle_paisa`, `included_distance_m`, `min_delivery_fee_paisa` |
| Surge | 9 | `surge_bands`, `surge_max_bps`, `surge_publish_interval_s` |
| Commission | 7 | `commission_bps`, `rider_bonus_bps`, `tax_bps`, `small_order_threshold_paisa` |
| Dispatch | 21 | The 14 weights, wave sizing, TTLs, radii |
| Batch | 11 | `max_detour_s`, `ready_window_s`, capacities |
| Rank | 16 | The 11 weights, caps, cold-start parameters |
| Presence | 6 | `presence_grace_ms`, `heartbeat_interval_ms`, `vendor_unreachable_cancel_s` |
| Tracking | 12 | Cadence ladder, accuracy thresholds, anti-spoof limits |
| Finance | 14 | Payout days, cash limits, the bKash tariff table |
| Alarm | 8 | Ceilings, re-pulse intervals |
| Features | 19 | Feature flags, each with an owner and a removal date |
| **Total** | **147** | |

Every key appears in `.env.example` with its default, its range, and a one-line description.

---

## 5. Rotation

| Secret | Procedure | Downtime |
| --- | --- | --- |
| `JWT_SIGNING_KEY` | Set `JWT_PREVIOUS_KEY` to the current value, generate a new one, deploy. Both are accepted for verification for 24 h; only the new one signs. Remove the previous after 24 h | **None** |
| `ORDER_QR_SECRET` | Identical dual-key pattern | None |
| `TIDB_DATABASE_URL` | Create a new database user, update the secret, deploy, verify, drop the old user | None |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Create a new service-account key in the Firebase console, update, deploy, delete the old key | None |
| `IMGBB_API_KEY` | Generate a new key, update, deploy. Existing URLs are unaffected | None |
| `CLOUDINARY_API_SECRET` | Rotate in the Cloudinary console, update, deploy. In-flight signed URLs expire within 5 minutes anyway | None |
| `CLOUDFLARE_API_TOKEN` | Create a new scoped token, update, delete the old | None |
| `UNDAL_BKASH_PAYOUT_NUMBER` | **Two approvals required.** Every rider notified; the old number accepted for 48 hours | None |
| `ANDROID_KEYSTORE_*` | **Cannot be rotated** for a published app. Documented as irreversible |
| `TOTP_ENCRYPTION_KEY` | Re-encrypt every seed in a migration; admins are not affected | None |

The `rotate-secret.yml` workflow takes a secret name and prints the exact procedure, the blast
radius, and a checklist — so the developer does not have to remember any of this.

---

## 6. `.env.example`

A complete, committed, annotated file covering every secret and every config key. It is the file
somebody reads to understand what the platform needs, and the `env-example-complete` CI job fails
if a secret or config key referenced in code is missing from it.

It contains **no real values** — every entry is a shape, a range, or an obviously-fake example —
and `secret-scan` runs over it like any other file.

---

## 7. Local development

There is none, by the brief's constraint. But the repository must still be comprehensible to
someone who clones it, so:

- `.env.example` documents everything.
- `docs/34` explains the layout.
- Every workflow can be run against a preview environment from the Actions tab.
- A `preview` environment with its own secrets exists, so a PR deploys to real infrastructure and
  can be exercised end to end from a browser.

The PR preview is the substitute for a local machine, and it is a better one: it runs on the same
infrastructure as production.

---

## 8. Compromise response

If a secret is believed exposed:

| Step | Action |
| --- | --- |
| 1 | Rotate immediately using the §5 procedure — do not wait for confirmation of a breach |
| 2 | Run `security-scan.yml` with a full-history scan to find every commit containing it |
| 3 | If it reached a commit, consider the secret permanently burned even after rotation, because forks and clones retain it |
| 4 | Review `audit_log` for the exposure window |
| 5 | For `JWT_SIGNING_KEY`: force-expire every session |
| 6 | For `FIREBASE_SERVICE_ACCOUNT_JSON`: audit FCM sends in the Firebase console |
| 7 | For `UNDAL_BKASH_PAYOUT_NUMBER`: notify every rider immediately and reconcile all settlements in the window |
| 8 | Write the incident up in `docs/39` |

### 8.1 A standing note

Any credential that has ever been typed into a chat window, a ticket, an email, or a commit
message must be treated as public and rotated before launch. This includes database connection
strings, API keys, and payout numbers shared during development. The platform's security posture
starts at the moment every such value has been replaced.

---

## 9. Testing

| Test | Count |
| --- | --- |
| `.env.example` completeness | 1 CI job |
| Every config key has a schema and a range | 147 |
| Out-of-range config is rejected at write | 42 |
| Temporal config resolution (past decisions replay against past config) | 14 |
| Propagation within 60 s | 3 |
| Dual-key rotation for JWT and QR | 8 |
| Missing optional secret degrades gracefully | 19 — one per optional capability |
| Missing mandatory secret fails the deploy with a clear message | 11 |
| No secret appears in any built artifact | 1 CI job over the APKs and web bundles |
| Bootstrap admin is created once and forced through a password change | 5 |

---

## 10. Reading on

Next: [`30-testing-and-verification.md`](30-testing-and-verification.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
