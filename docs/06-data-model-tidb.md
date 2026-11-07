<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 06 — Data Model (TiDB)

> The system of record. 96 tables, serializable isolation, integer-paisa money, spatial types for
> zones and proximity. Migrations are numbered SQL files applied by a GitHub Actions workflow — no
> CLI, no ORM migration runner, no drift.

---

## 1. Principles

1. **Money is `BIGINT` paisa.** There is no `DECIMAL`, no `NUMERIC`, no `FLOAT` on any money column.
   A CI check parses the schema and fails on any column whose name ends in `_paisa` that is not
   `BIGINT`, and on any money-shaped column that is not named `*_paisa`.

   > **`INT8` is a trap in MySQL and the guardrail exists because of it.** CockroachDB's `INT8` is a
   > 64-bit integer. MySQL and TiDB parse `INT8` as `INT(8)` — a **4-byte** integer with a display
   > width, maximum 2,147,483,647. That is ৳21,474,836. A platform taking ৳1 crore in a good month
   > would overflow silently. The `no-postgres-dialect` guardrail fails the build on the literal
   > token `INT8` anywhere in `db/` or in this document.

2. **Every table has `id BINARY(16) PRIMARY KEY`, supplied by the application as a UUIDv7**, except
   join tables with a natural composite key, and append-only log tables that use `(partition, seq)`.

   > TiDB has no `gen_random_uuid()`, so the default is gone and the application must supply the
   > key. This is an improvement rather than a loss: CockroachDB's `gen_random_uuid()` returned
   > **v4**, so the time-ordered keys this schema depends on were already generated in application
   > code. `35 §5` listed "the UUID v7 generation source" as an open question; it is now closed —
   > one generator per language, one shared test vector. `BINARY(16)` is chosen over `CHAR(36)`
   > because it is 16 bytes rather than 36, it preserves v7's byte ordering so insert locality
   > survives, and every foreign key in the schema pays the difference. Conversion happens at the
   > driver boundary via `uuidToBin()` / `binToUuid()`; no handler ever sees bytes.

3. **Every table has `created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`.** Mutable
   tables also have `updated_at`, maintained by a trigger-free convention: every `UPDATE` statement
   in the codebase sets it, and a CI check greps for `UPDATE` statements that do not.

   > The convention was a style choice under CockroachDB. Under TiDB it is the only option, because
   > TiDB has no triggers at all — and because this document already banned them, the schema loses
   > nothing. **`DATETIME(6)`, never `TIMESTAMP`.** MySQL's `TIMESTAMP` is a 32-bit epoch that ends
   > in 2038 and silently rewrites values according to the session time zone. `DATETIME(6)` stores
   > exactly what is written, which makes correctness depend on every connection pinning
   > `time_zone = '+00:00'`. That pin is a connection-level invariant with its own test (§10).

4. **Soft delete only where it is needed.** `deleted_at DATETIME(6)` exists on vendors, menu items,
   and addresses, because those are referenced by historical orders. Everything else is hard
   deleted. Soft-deleting everything is how a schema becomes unreadable.

5. **Enums are `VARCHAR` with a `CHECK`,** not MySQL `ENUM` types. A MySQL `ENUM` stores an ordinal
   and reorders badly under `ALTER`; a `VARCHAR` stores what it says.

   > **None of the 53 `CHECK` constraints in this document are enforced by the database, and this
   > is now a confirmed fact rather than an open question.** TiDB has supported `CHECK` since
   > v7.2, but the feature is gated behind `tidb_enable_check_constraint`, which **TiDB Cloud
   > Starter does not permit modifying**. It is `OFF` and it stays `OFF`. TiDB parses the clauses
   > and ignores them without raising an error, which is MySQL 5.7 behaviour.
   >
   > **They stay declared anyway, for two reasons that are not sentimentality.** They are the
   > generated source of the application validators (§1.2), so deleting them would delete the
   > specification the validators are built from. And they begin enforcing automatically on the
   > day Undal outgrows Starter, with no schema change. A constraint that is declared, validated
   > at the write path and swept nightly is a specification. A constraint that is deleted is a gap
   > nobody can see.
   >
   > Note what is deliberately **not** claimed: whether an ignored `CHECK` survives into
   > `SHOW CREATE TABLE` or `information_schema` is unverified, and it probably does not, because
   > a clause parsed and discarded is not table metadata. The schema verifier therefore does not
   > depend on reading them back (§10), and the smoke test in §1.2 records the answer rather than
   > assuming one.
   >
   > What this costs is stated honestly in §1.2 and logged in `39` as R31, and it is **not uniform
   > across the 53** — thirteen of them guard money, and money cannot wait for a nightly sweep.

6. **Foreign keys are declared, except on three hot child tables.** The correctness argument for
   FKs always applies; at Undal's scale the performance argument almost never does.

   > The exception is forced by mechanics, not preference. TiDB's foreign keys reached GA in v8.5
   > and are real — but a child insert takes an **exclusive lock on the parent row**. Every
   > `order_items` insert would lock its `orders` row and every order would lock its `vendors` row,
   > so a single busy vendor at lunch would serialise its own order flow. `order_items`,
   > `order_state_events` and `order_offers` therefore declare no FK to their parent. They are
   > enforced in `undal-core`, which is the sole relational writer (`05 §3`), and a nightly orphan
   > detection job reports any row whose parent is missing. Every other table in the schema keeps
   > its foreign keys. The three exceptions are named here, in the DDL, and in `39` R32 — never
   > inferred from their absence.

7. **No nullable booleans.** A tri-state boolean is a design error. Use an explicit status column.

8. **Spatial data is two integers and a cell.** `lat_e7` and `lon_e7` hold degrees × 10⁷; a stored
   generated `cell_id` buckets them into the platform's existing 500 m grid; polygons are GeoJSON
   rings in `JSON` with indexed integer bounding boxes.

   > TiDB has no spatial types, no spatial functions and no spatial indexes, and PingCAP has
   > confirmed GIS is not on its roadmap (issue #6347). This is the largest redesign in the
   > migration and it is specified in full in §4.1, including the `geo-parity` CI gate that proves
   > the replacement returns identical results to the geometry it replaces.

### 1.1 Reserved words

MySQL's reserved-word list is longer than CockroachDB's, and three column names in this schema
collide with it. They are **quoted, not renamed** — `permissions.key`, `admin_roles.key` and
`audit_log.before` keep exactly the names they had, because renaming a column to satisfy a parser
would change the surface that [`27 §5`](27-security-rbac-audit.md) and the RBAC middleware read:

```sql
`key`      VARCHAR(64) PRIMARY KEY
`before`   JSON
`after`    JSON        -- not reserved, but quoted alongside `before` so the pair reads as one
```

Every one of the 292 column names in this document was checked against the MySQL 8.0 reserved-word
list, and every DDL statement here is parsed as MySQL by CI as part of the `no-postgres-dialect`
guardrail. A schema that only fails at `migrate.yml` time has already wasted a deploy.

### 1.2 The constraint registry

Because TiDB Cloud Starter cannot enforce `CHECK`, the 53 constraints declared in this document are
enforced one layer up. The mechanism matters more than the intention: an application that is
*supposed* to validate is not a constraint, it is a hope. So the declarations are not duplicated by
hand into validator code — they are **the single source from which that code is generated**.

```
docs/06-data-model-tidb.md        the declarations (authoritative)
        │
        ├─► scripts/db/extract_constraints.py
        │       parses every CHECK out of the DDL
        │
        ▼
packages/contracts/constraints.json     53 entries: table, column, kind, expression
        │
        ├─► undal-core   generated validators, run on the write path
        ├─► integrity job   generated SQL, finds rows that already violate
        └─► check-constraint-parity   CI: registry must match the DDL exactly
```

`check-constraint-parity` is the guardrail that keeps this honest. It re-extracts the constraints
from this document, compares them to `constraints.json`, and fails if a single one is missing,
extra or altered. Adding a `CHECK` here without regenerating the registry fails the build; writing
a validator with no matching declaration fails the build. **Drift is the only real failure mode of
an application-layer constraint, and this is the thing that detects it.**

#### The 53, and what each tier actually costs

| Tier | Count | What they guard | Enforcement | Honest residual |
| --- | --- | --- | --- | --- |
| **Money** | **13** | `*_paisa >= 0`, `commission_bps` 0–5000, `rider_bonus_bps` 0–2000, `compare_at_paisa > price_paisa` | Write-path validator **plus** the existing `ledger-closure` and `money-integrity` CI jobs **plus** the 40 fare vectors | Lowest of the three, and deliberately so |
| **Enums** | **32** | `state`, `status`, `actor_type`, `open_state`, `availability`, `kind`, `vehicle`, and the rest | Write-path validator; consumers switch on known values and fail closed on an unknown one | A bad value is a bug that surfaces at the next read, not silent corruption |
| **Ranges and shape** | **8** | `busy_level` 0–3, `spice_level` 0–3, `iso_week` 1–53, `max_select >= min_select`, `payment_method = 'COD'` | Write-path validator, nightly sweep | A bad value persists until the sweep |

**The thirteen money constraints do not rely on the nightly sweep, and must not.** A negative
`total_paisa` discovered twenty-three hours later has already been invoiced and may already have
been paid out. Three things stand in front of them, all of which exist in this corpus already:

1. Every one of those values is **computed**, never accepted from a client. `subtotal_paisa`,
   `delivery_fee_paisa`, `tax_paisa` and `total_paisa` come out of `apply_rate()`
   ([`24 §2`](24-finance-payouts-invoices.md)), which operates on `BIGINT` paisa and cannot produce
   a negative from non-negative inputs. A negative here means a fare-engine defect, and the 40 fare
   vectors are the test that catches it before deploy, not after.
2. **`ledger-closure`** fails CI and alerts in production on any posting set that does not sum to
   zero. A negative money column that reached the ledger breaks closure.
3. The write-path validator refuses the write and raises the error code the API already defines.

The sweep is the fourth line, not the first. For the other forty constraints it is the second.

#### The integrity job

Generated from the same registry, so it cannot test something different from what is declared. It
runs on every deploy and nightly as a GitHub Actions `schedule` — CI, not a cron job on the
platform, which is where this corpus already puts scheduled verification.

For each registry entry it runs `SELECT count(*) FROM <table> WHERE NOT (<expression>)` and records
the result. A non-zero count raises `SCHEMA_INVARIANT_VIOLATED` at severity **CRITICAL** when the
constraint is in the money tier and **WARNING** otherwise, writes an `audit_log` row, and surfaces
in the admin panel's exceptions list. Results are retained so that a violation appearing between
two runs can be bracketed in time.

A constraint whose sweep has never run is reported as unverified rather than passing, for the same
reason `audit_verifications` exists ([`27 §4.2`](27-security-rbac-audit.md)): the dangerous state is
not a failed check, it is a check that quietly stopped happening.

#### One constraint that cannot be declared at all

The 18-year age floor on `riders.date_of_birth` is not among the 53. It needs `CURRENT_DATE`, and
MySQL forbids non-deterministic functions inside `CHECK` regardless of whether the feature is
enabled. It is a validator and a sweep entry with no declaration behind it, which is why it is
logged separately as `39` R30. See §6.

#### What must be confirmed on the first migration run

TiDB's documented behaviour is to parse and ignore `CHECK` when the feature is off, and PingCAP's
own compatibility notes describe exactly that — "TiDB ignores the `CHECK` constraint without
reporting any error". **This has not been observed on a live Starter instance**, and if it were
wrong, every `CREATE TABLE` in this document would fail outright rather than degrade.

So migration `000_smoke.sql` runs first and answers it in four statements, against a throwaway
table that is dropped immediately:

1. `CREATE TABLE _smoke (n INT, CONSTRAINT c CHECK (n > 0));` — **must succeed.** If it does not,
   the runner stops before touching the real schema, and the fallback is mechanical: the extractor
   already holds every expression, so the `CHECK` clauses move into SQL comments and
   `constraints.json` is unchanged. Nothing half-applies.
2. `INSERT INTO _smoke VALUES (-1);` — **must succeed**, which is what proves parse-and-ignore
   rather than enforcement. If it *fails*, then this instance does enforce `CHECK`, and the
   workflow records that happy surprise rather than ignoring it.
3. `SHOW CREATE TABLE _smoke` and a read of `information_schema.CHECK_CONSTRAINTS` — **recorded,
   not asserted.** This is how the corpus learns whether an ignored constraint is still visible in
   the live schema. The answer is written into the workflow summary and this section is updated
   with it.
4. `DROP TABLE _smoke;`

The outcome is written to `audit_verifications` like any other verification run, so "we never
actually checked" is not a state the platform can be in.

---

## 2. Table inventory

| Group | Tables | Count |
| --- | --- | --- |
| Identity and access | `users`, `user_profiles`, `sessions`, `devices`, `device_tokens`, `password_history`, `login_attempts`, `oauth_identities`, `totp_secrets`, `recovery_codes`, `admin_roles`, `admin_role_permissions`, `admin_user_roles`, `permissions`, `refresh_tokens`, `security_events` | 16 |
| Geography | `zones`, `zone_polygons`, `zone_pricing`, `zone_hours`, `addresses`, `address_labels`, `geocode_cache`, `cell_zone` | 8 |
| Vendors | `vendors`, `vendor_profiles`, `vendor_documents`, `vendor_hours`, `vendor_holidays`, `vendor_contacts`, `vendor_bank_accounts`, `vendor_categories`, `categories`, `vendor_stats`, `vendor_pause_log`, `vendor_commission_overrides` | 12 |
| Catalogue | `menus`, `menu_sections`, `menu_items`, `item_variants`, `modifier_groups`, `modifiers`, `item_modifier_groups`, `item_availability`, `item_tags`, `tags`, `item_stats`, `item_media` | 12 |
| Riders | `riders`, `rider_profiles`, `rider_documents`, `rider_vehicles`, `rider_shifts`, `rider_shift_selfies`, `rider_stats`, `rider_penalties`, `rider_suspensions`, `rider_cash_balances`, `rider_cash_settlements`, `rider_cash_declarations`, `rider_zone_assignments` | 13 |
| Orders | `orders`, `order_items`, `order_item_modifiers`, `order_state_events`, `order_fees`, `order_discounts`, `order_assignments`, `order_offers`, `order_batches`, `order_batch_members`, `order_proofs`, `order_cancellations`, `order_ratings`, `order_disputes`, `order_dispute_messages` | 15 |
| Money | `ledger_accounts`, `ledger_entries`, `ledger_postings`, `payout_periods`, `invoices`, `invoice_lines`, `invoice_documents`, `payout_transactions`, `platform_config`, `config_audit`, `tax_records`, `rounding_adjustments` | 12 |
| Marketing | `promo_codes`, `promo_redemptions`, `campaigns`, `campaign_budgets`, `campaign_redemptions`, `referrals`, `loyalty_tiers`, `customer_loyalty`, `reminders`, `reminder_sends` | 10 |
| Operations | `audit_log`, `audit_verifications`, `ops_errors`, `ops_metrics`, `ops_logs`, `effect_dead_letters`, `brain_traces`, `dispatch_locks`, `generation_locks`, `exceptions`, `support_tickets`, `support_messages`, `weather_observations`, `notification_log`, `fcm_dispatches`, `coordination_state` | 16 |
| **Total** | | **114** |

> The rows above sum to 109, not the 99 this table used to claim: the per-group counts were
> always right and the total was an arithmetic slip, recorded as D43 in `_plan/DECISIONS.md`.
> The migrations implement the 112 names, and `check_schema_parity` fails the build if the two
> lists ever disagree again. `refresh_tokens` and `security_events` joined the identity group with
> the auth foundation (D48): the specification requires rotation with family reuse detection and
> the event reuse raises, and neither behaviour is implementable without a row to hold it.
> `fcm_dispatches` joined Operations with the push log (D86): `15 §8` requires a row per send so the
> delivery matrix is built from data rather than from the absence of complaints, and the rows are
> written by `undal-core` on `undal-realtime`'s behalf because only core may write TiDB.
> `rider_cash_declarations` joined Riders with `25 §7`'s four buttons (D148): a rider who was robbed or has an emergency
> needs to be heard before they are unblocked, and "limited to once per 30 days" is a query over declarations rather than
> a column that can only remember the last one.
> Migration `026` gave it an ending (D155): `resolved_at`, `resolved_by` and `resolution_note`, so a case written off or
> otherwise settled can say who decided and why, and the reviewer's list can filter on `resolved_at IS NULL` instead of
> guessing from a balance that happens to be zero.
> `coordination_state` joined Operations with the free coordination backend (D90): the wave plan, the
> zone counter and the presence row need a key, a value and an expiry, and D89's arithmetic rules out
> Workers KV for them. Its rows are written by core on realtime's behalf for the same single-writer
> reason — the coordinator composes the statement, and `POST /internal/coordination/statements` runs it.

Three tables are new, and all three exist because a database mechanism went away rather than
because a feature arrived:

| Table | Replaces | Specified in |
| --- | --- | --- |
| `cell_zone` | The `INVERTED INDEX` on `zones.boundary` — a materialised cell → zone map that makes point-in-polygon a single indexed read | §4.1 |
| `audit_verifications` | Nothing — it is new. It records every run of the audit-chain verifier so that a **gap in verification** is itself detectable, which matters more now that the WORM trigger is gone | [`27 §4.2`](27-security-rbac-audit.md) |
| `generation_locks` | `pg_advisory_lock`, used by invoice generation. MySQL's `GET_LOCK()` is session-scoped and the HTTP driver has no durable session, so the lock becomes a row with a lease | [`24 §4.1`](24-finance-payouts-invoices.md) |

No business table was added, renamed or removed. The 106 tables that modelled the platform still
model the platform.

---

## 3. Identity and access

```sql
-- 001_identity.sql
CREATE TABLE users (
    id              BINARY(16) PRIMARY KEY,
    phone           VARCHAR(20)  NOT NULL,
    phone_norm      VARCHAR(20)  NOT NULL,   -- E.164, +8801XXXXXXXXX
    email           VARCHAR(254),
    email_norm      VARCHAR(254),            -- lowercased, dots preserved
    password_hash   VARCHAR(255),            -- Argon2id; NULL only for OAuth-only accounts
    actor_type      VARCHAR(16)  NOT NULL
        CHECK (actor_type IN ('CUSTOMER','VENDOR_OWNER','RIDER','ADMIN')),
    status          VARCHAR(24)  NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','SUSPENDED','PENDING_REVIEW','DEACTIVATED','BANNED')),
    locale          VARCHAR(5)   NOT NULL DEFAULT 'bn',
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_seen_at    DATETIME(6),
    deleted_at      DATETIME(6),

    CONSTRAINT uq_users_phone UNIQUE (phone_norm),
    INDEX idx_users_email (email_norm),
    INDEX idx_users_type_status (actor_type, status)
);
```

**Why `phone_norm` separate from `phone`.** Bangladeshi users type `01712345678`, `+8801712345678`,
`8801712345678`, and `01712-345678`. The display column keeps what they typed; the normalised column
is the unique key. Normalisation is one function, `normalisePhoneBd()`, with 40 test cases.

**Why no email uniqueness constraint.** Email is optional and unverified (no email verification on
the free tier — see [`01 §8`](01-mission-and-non-negotiables.md)). An unverified unique email is an
account-takeover vector: register with someone's email first, and they can never sign up. Email is
indexed for lookup, not constrained for uniqueness, and the login path requires phone + password or
a verified OAuth identity.

```sql
CREATE TABLE sessions (
    id              BINARY(16) PRIMARY KEY,
    user_id         BINARY(16)        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      BINARY(32)  NOT NULL,   -- SHA-256 of the opaque bearer token
    device_id       BINARY(16)        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    ip_created      VARCHAR(45)  NOT NULL,
    ua_created      VARCHAR(512) NOT NULL,
    issued_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at      DATETIME(6) NOT NULL,
    last_used_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    revoked_at      DATETIME(6),
    revoked_reason  VARCHAR(64),

    INDEX idx_sessions_user (user_id, revoked_at),
    UNIQUE INDEX uq_sessions_token (token_hash)
);

CREATE TABLE devices (
    id              BINARY(16) PRIMARY KEY,
    user_id         BINARY(16)        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform        VARCHAR(16)  NOT NULL CHECK (platform IN ('ANDROID','WEB')),
    fingerprint     VARCHAR(128) NOT NULL,   -- stable per install, not an advertising id
    model           VARCHAR(128),
    os_version      VARCHAR(32),
    app_version     VARCHAR(32),
    app_flavour     VARCHAR(16)  CHECK (app_flavour IN ('CUSTOMER','PARTNER','RIDER')),
    -- Battery-optimisation posture, needed by the alarm coaching flow (doc 15 §9)
    battery_opt_exempt      TINYINT(1),
    notifications_allowed   TINYINT(1),
    exact_alarm_allowed     TINYINT(1),
    full_screen_intent_allowed TINYINT(1),
    oem_autostart_prompted  TINYINT(1)        NOT NULL DEFAULT false,
    first_seen_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_seen_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX uq_devices_user_fp (user_id, fingerprint)
);

CREATE TABLE device_tokens (
    id              BINARY(16) PRIMARY KEY,
    device_id       BINARY(16)        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    fcm_token       VARCHAR(512) NOT NULL,
    valid           TINYINT(1)        NOT NULL DEFAULT true,
    invalidated_at  DATETIME(6),
    invalid_reason  VARCHAR(64),
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    refreshed_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    -- Partial-index replacement. TiDB has no `INDEX ... WHERE`, so the predicate
    -- moves into a stored generated column and the index stays exactly as small.
    device_id_if_valid BINARY(16) AS (IF(valid, device_id, NULL)) STORED,

    UNIQUE INDEX uq_device_tokens_token (fcm_token),
    INDEX idx_device_tokens_device (device_id_if_valid)
);
```

The device columns recording battery-optimisation posture are not decoration — they drive the
coaching flow in [`15 §9`](15-wakeup-alarm-fcm.md) and the admin panel's "riders at risk of missing
orders" report, which is a genuinely useful operational tool that no competitor exposes.

### 3.1 RBAC tables

```sql
CREATE TABLE permissions (
    `key`       VARCHAR(64) PRIMARY KEY,     -- 'order.reassign', 'finance.invoice.mark_paid'
    domain      VARCHAR(32) NOT NULL,
    description VARCHAR(256) NOT NULL,
    risk        VARCHAR(8)  NOT NULL CHECK (risk IN ('LOW','MEDIUM','HIGH','CRITICAL'))
);

CREATE TABLE admin_roles (
    id          BINARY(16) PRIMARY KEY,
    `key`       VARCHAR(48) NOT NULL UNIQUE,
    name        VARCHAR(96) NOT NULL,
    name_bn     VARCHAR(96) NOT NULL,
    is_system   TINYINT(1) NOT NULL DEFAULT false,   -- system roles cannot be deleted
    created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

CREATE TABLE admin_role_permissions (
    role_id         BINARY(16)   NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    permission_key  VARCHAR(64) NOT NULL REFERENCES permissions(`key`),
    PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE admin_user_roles (
    user_id     BINARY(16) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     BINARY(16) NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    zone_scope  JSON ,                     -- NULL = global; otherwise limited to these zones
    granted_by  BINARY(16) NOT NULL REFERENCES users(id),
    granted_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at  DATETIME(6),
    PRIMARY KEY (user_id, role_id)
);
```

The seven system roles and the full permission list (214 keys) are in
[`27 §5`](27-security-rbac-audit.md). Note `zone_scope`: a Regional Dispatcher for Sylhet cannot
touch a Dhaka order, and the constraint is enforced in the RBAC middleware, not in each handler.

> **These are not seed data.** The permission keys and the seven system roles are *schema*, created
> by migration `002_rbac.sql` as part of the structure, exactly like a `CHECK` constraint. The
> distinction that matters for non-negotiable 3 is that no *business* data — no vendor, no menu
> item, no order, no customer — is ever created by a migration. A permission key with no row would
> make the RBAC middleware undefined; a demo restaurant would make the platform a lie.

---

## 4. Geography

```sql
CREATE TABLE zones (
    id              BINARY(16) PRIMARY KEY,
    code            VARCHAR(24)  NOT NULL UNIQUE,   -- 'SYL-CENTRAL'
    name            VARCHAR(96)  NOT NULL,
    name_bn         VARCHAR(96)  NOT NULL,
    country         VARCHAR(2)   NOT NULL DEFAULT 'BD',
    city            VARCHAR(64)  NOT NULL,
    currency        VARCHAR(3)   NOT NULL DEFAULT 'BDT',
    timezone        VARCHAR(48)  NOT NULL DEFAULT 'Asia/Dhaka',
    status          VARCHAR(16)  NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','ACTIVE','PAUSED','RETIRED')),
    -- Geometry. TiDB has no spatial types, so a zone's shape is a GeoJSON ring and
    -- every hot predicate is an integer comparison. Design and parity test: §4.1.
    polygon         JSON        NOT NULL,   -- closed ring, [[lon_e7, lat_e7], ...]
    polygon_version BIGINT      NOT NULL DEFAULT 1,
    bbox_min_lat_e7 INT         NOT NULL,
    bbox_max_lat_e7 INT         NOT NULL,
    bbox_min_lon_e7 INT         NOT NULL,
    bbox_max_lon_e7 INT         NOT NULL,
    centroid_lat_e7 INT         NOT NULL,
    centroid_lon_e7 INT         NOT NULL,
    area_sq_km      DOUBLE      NOT NULL,
    created_by      BINARY(16)        NOT NULL REFERENCES users(id),
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX idx_zones_bbox (bbox_min_lat_e7, bbox_max_lat_e7, bbox_min_lon_e7, bbox_max_lon_e7),
    INDEX idx_zones_status (status)
);
```

`area_sq_km` is denormalised because it is read on every ranking pass and computing it from the
polygon each time is wasteful. It is recomputed in the same statement that updates `polygon`, and a
CI invariant test asserts they agree **to 0.1%**.

The tolerance is unchanged. What changed is the computation behind it: PostGIS is no longer there to
produce the reference figure, so the test computes area by **spherical excess on the WGS-84 authalic
sphere, R = 6,371,007.2 m**. A planar approximation would be accurate enough for Sylhet — its error
at this latitude and these distances is far inside 0.1% — but its error is a function of latitude,
which would make the tolerance mean something different the first time a zone is drawn somewhere
else. Spherical excess is a dozen lines and has no such dependence, so 0.1% keeps meaning 0.1%.

### 4.1 Geospatial without spatial types

TiDB has no `GEOGRAPHY`, no `ST_Distance`, no `ST_Contains`, no spatial index, and PingCAP has
stated on its own forum that GIS is not on the roadmap. Every spatial predicate in this document is
therefore re-expressed in integer arithmetic. **No behaviour changes**: the same vendors come back,
in the same order, at the same distances, under the same `LIMIT`. That claim is not an assertion —
it is a required CI check, specified in §4.1.4.

#### 4.1.1 Storage

```sql
lat_e7   INT    NOT NULL,   -- latitude  x 10^7:  24.8949 -> 248949000
lon_e7   INT    NOT NULL,   -- longitude x 10^7:  91.8687 -> 918687000
cell_id  BIGINT AS (FLOOR(lat_e7 / 44920) * 1000000 + FLOOR(lon_e7 / 49520)) STORED,
INDEX idx_<table>_cell (cell_id)
```

Degrees × 10⁷ gives roughly 1.1 cm of resolution — one degree of latitude is about 111,320 m, so
10⁻⁷ of a degree is about 0.011 m — and the extreme value ±1,800,000,000 sits comfortably inside
`INT`'s ±2,147,483,647. Integers mean no floating-point drift in storage and exact equality on
coordinates, which `DOUBLE` cannot offer.

`cell_id` buckets a point into the platform's **existing 500 m cell grid**, already defined in
[`38`](38-glossary.md) and already used by [`09`](09-undal-brain-overview.md) for demand
forecasting. Reusing it is deliberate: no new concept enters the system, no dependency is added, and
the forecasting grid and the search grid are the same grid, so their outputs are comparable.

The divisors are inlined constants rather than a function call because **TiDB has no user-defined
functions**, and a generated column may only use built-in arithmetic. 44,920 is 500 m of latitude in
e7 units; 49,520 is 500 m of longitude at Sylhet's latitude, 500 ÷ (111,320 × cos 24.9°). A fixed
longitude divisor makes cells slightly non-square away from that latitude, which is harmless — the
grid only has to be *consistent*, because it is a prefilter and the true distance is computed
afterwards. The two constants are frozen, are part of the parity test, and cannot be changed without
rebuilding every `cell_zone` row.

#### 4.1.2 Radius search — what `ST_DWithin` did

Two stages, and the split is the design.

**Stage 1, in SQL, deliberately loose:**

```sql
WHERE v.zone_id      = ?            -- unchanged, and still the most selective predicate
  AND v.status       = 'APPROVED'
  AND v.deleted_at IS NULL
  AND v.cell_id   IN (?, ?, ?, ...)  -- cellsWithin(centre, radius): typically 9-25 cells
  AND v.lat_e7 BETWEEN ? AND ?       -- integer bounding box, belt and braces
  AND v.lon_e7 BETWEEN ? AND ?
LIMIT 200
```

**Stage 2, in the Worker:** exact haversine over the rows stage 1 returned, filtered to the true
radius, sorted by distance, ties broken by `vendor_id` ascending so the ordering is total.

The prefilter cannot miss a row. A point within *r* metres of the centre necessarily lies in a cell
that intersects the *r*-radius disc, and `cellsWithin()` returns every such cell. Rows outside the
true radius survive stage 1 and are discarded in stage 2; that is the cost, and it is bounded by the
cell size.

Three properties are preserved exactly, and each for a stated reason:

- **`LIMIT 200` is unchanged.** §11.1 caps the candidate set on product grounds, not performance
  grounds — "ranking more than 200 vendors in one zone is not a situation that improves the result".
  That is behaviour, so it stays.
- **Distances round to integer metres before any fare arithmetic**, in one function, at one
  boundary. [`10`](10-fare-engine-math.md) consumes integer metres and the 40 fare vectors are the
  test that this is still true.
- **Zone equality is still evaluated before the spatial predicate.** §12 depends on that ordering
  for selectivity, and it still holds — the cell filter operates on the few hundred rows the zone
  equality already selected.

#### 4.1.3 Point-in-polygon — what `ST_Contains` did

There are **two** cases, and they get different designs because their shapes differ.

**Case A — which zone contains this point?** Called on every address save and every order placement.
Must be exact, must be fast, and the answer changes the fare.

```sql
CREATE TABLE cell_zone (
    cell_id         BIGINT     NOT NULL,
    zone_id         BINARY(16) NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    coverage        TINYINT(1) NOT NULL,   -- 1 = cell lies wholly inside, 0 = cell straddles an edge
    polygon_version BIGINT     NOT NULL,
    PRIMARY KEY (cell_id, zone_id),
    INDEX idx_cell_zone_zone (zone_id)
);
```

Lookup is one indexed read. If `coverage = 1` the answer is immediate and no geometry is evaluated
at all. If `coverage = 0` the point is in an edge cell, and the Worker ray-casts it against the
GeoJSON ring in `zones.polygon`. Sylhet's zone polygons are few and simple, so the fraction of
points landing in edge cells is small and the ray-cast is microseconds.

`cell_zone` is rebuilt **in the same transaction that writes the polygon**, keyed by
`polygon_version`. Event-driven, no cron — which the operator constraint requires and which is also
simply correct: a zone map that is stale even briefly puts orders in the wrong zone, and the wrong
zone changes the fare.

**Case B — does this vendor's service area contain the customer?** This is the ranking geo-filter in
[`13 §3`](13-ranking-personalization.md). Materialising cell → vendor would be large and would churn
on every vendor edit, so it gets a cheaper design — and it can, because the candidate set is
**already bounded**: stage 1 of §4.1.2 has cut to at most 300 vendors in one zone.

SQL filters on `sa_bbox_*`, four indexed integer comparisons that eliminate most non-matching
vendors. The Worker ray-casts the survivors against `vendors.service_area`. `LIMIT 300` is
unchanged. The sub-10 ms figure quoted in `13 §3` becomes an **estimate** until it is measured on a
real Starter instance.

#### 4.1.4 The parity gate

Everything above is an assertion until something proves it. `geo-parity` is a required CI check on
every pull request, and it is one of the two guardrails this migration adds (28 → 30).

| Property | Cases | Pass condition |
| --- | --- | --- |
| Radius search | 10,000 random (centre, radius) pairs over the Sylhet bounding box, radii 200 m – 15 km | Candidate set **identical** to the reference; every distance within **±1 m**; identical ordering after integer-metre rounding |
| Point-in-polygon | 10,000 random points against the real zone polygons, **at least 2,000 of them within 5 m of an edge** | Exact agreement, including on-boundary cases |
| Cell function | The shared test vector | TypeScript, Python, Kotlin **and the SQL generated column** all agree |
| Area | Every zone polygon | Spherical-excess area within 0.1% of the stored `area_sq_km` |

The reference implementation is a vetted geometry library used **only in the test**. Depending on it
at runtime would reintroduce exactly the dependency this design removes.

Boundary behaviour is defined rather than discovered: **a point lying exactly on a polygon edge is
inside.** Both the ray-caster and the reference are configured that way, and the 2,000 near-edge
cases are what proves they agree rather than merely both being plausible.

```sql
CREATE TABLE zone_pricing (
    id                      BINARY(16) PRIMARY KEY,
    zone_id                 BINARY(16) NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    vehicle                 VARCHAR(16) NOT NULL CHECK (vehicle IN ('MOTORBIKE','BICYCLE')),
    base_fare_paisa         BIGINT NOT NULL CHECK (base_fare_paisa >= 0),
    base_distance_m         BIGINT NOT NULL DEFAULT 2000,
    per_km_paisa            BIGINT NOT NULL CHECK (per_km_paisa >= 0),
    max_radius_m            BIGINT NOT NULL,
    min_payout_paisa        BIGINT NOT NULL,
    surge_cap_bps           BIGINT NOT NULL DEFAULT 22000,   -- 2.2x
    effective_from          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    effective_to            DATETIME(6),
    created_by              BINARY(16) NOT NULL REFERENCES users(id),

    INDEX idx_zone_pricing_lookup (zone_id, vehicle, effective_from DESC)
);
```

Pricing is **temporal**, not mutable. Changing a rate inserts a new row and closes the old one.
This is non-negotiable for finance: an invoice generated for week 44 must be reproducible in week 52
even though the rate changed in week 48. Every money calculation reads the row effective at the
order's `placed_at`, never "the current row".

Defaults, inserted by migration as structure (matching [`01 §3.7`](01-mission-and-non-negotiables.md)):

| vehicle | base_fare_paisa | per_km_paisa | max_radius_m | min_payout_paisa |
| --- | --- | --- | --- | --- |
| `MOTORBIKE` | 4000 (৳40) | 1400 (৳14) | 12000 | 4000 |
| `BICYCLE` | 2500 (৳25) | 800 (৳8) | 4000 | 2500 |

```sql
CREATE TABLE addresses (
    id              BINARY(16) PRIMARY KEY,
    user_id         BINARY(16)        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label           VARCHAR(32)  NOT NULL DEFAULT 'OTHER'
        CHECK (label IN ('HOME','WORK','OTHER')),
    custom_label    VARCHAR(48),
    recipient_name  VARCHAR(96),
    recipient_phone VARCHAR(20),
    line1           VARCHAR(256) NOT NULL,
    line2           VARCHAR(256),
    landmark        VARCHAR(128),
    floor_flat      VARCHAR(64),
    area            VARCHAR(96),
    city            VARCHAR(64)  NOT NULL,
    postcode        VARCHAR(12),
    lat_e7          INT          NOT NULL,
    lon_e7          INT          NOT NULL,
    cell_id         BIGINT AS (FLOOR(lat_e7 / 44920) * 1000000 + FLOOR(lon_e7 / 49520)) STORED,
    zone_id         BINARY(16)        REFERENCES zones(id),
    delivery_note   VARCHAR(280),
    is_default      TINYINT(1)        NOT NULL DEFAULT false,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    deleted_at      DATETIME(6),

    INDEX idx_addresses_user (user_id, deleted_at),
    INDEX idx_addresses_cell (cell_id)
);
```

`floor_flat` and `landmark` are separate fields and both prominent in the UI because in Bangladesh
a street address alone frequently does not locate a door. The rider's screen shows landmark above
line1, which is the opposite of Western convention and correct here.

---

## 5. Vendors and catalogue

```sql
CREATE TABLE vendors (
    id                  BINARY(16) PRIMARY KEY,
    owner_user_id       BINARY(16)        NOT NULL REFERENCES users(id),
    kind                VARCHAR(16)  NOT NULL
        CHECK (kind IN ('RESTAURANT','HOME_KITCHEN','CLOUD_KITCHEN','GROCERY')),
    slug                VARCHAR(96)  NOT NULL,
    name                VARCHAR(128) NOT NULL,
    name_bn             VARCHAR(128),
    tagline             VARCHAR(160),
    description         VARCHAR(1200),
    phone               VARCHAR(20)  NOT NULL,
    email               VARCHAR(254),

    zone_id             BINARY(16)        NOT NULL REFERENCES zones(id),
    lat_e7              INT          NOT NULL,
    lon_e7              INT          NOT NULL,
    cell_id             BIGINT AS (FLOOR(lat_e7 / 44920) * 1000000 + FLOOR(lon_e7 / 49520)) STORED,
    -- The vendor's own delivery polygon, and the radius beyond which it will not
    -- deliver. Both are read by the ranking geo-filter in `13 §3`, which referenced
    -- them before this document declared them. See §4.4.
    service_area        JSON         NOT NULL,   -- closed ring, [[lon_e7, lat_e7], ...]
    sa_bbox_min_lat_e7  INT          NOT NULL,
    sa_bbox_max_lat_e7  INT          NOT NULL,
    sa_bbox_min_lon_e7  INT          NOT NULL,
    sa_bbox_max_lon_e7  INT          NOT NULL,
    max_delivery_m      BIGINT       NOT NULL DEFAULT 8000,
    address_line        VARCHAR(256) NOT NULL,
    landmark            VARCHAR(128),

    status              VARCHAR(24)  NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','NEEDS_INFO',
                          'APPROVED','SUSPENDED','REJECTED','RETIRED')),
    open_state          VARCHAR(16)  NOT NULL DEFAULT 'CLOSED'
        CHECK (open_state IN ('OPEN','BUSY','PAUSED','CLOSED','UNREACHABLE')),
    busy_level          SMALLINT        NOT NULL DEFAULT 0 CHECK (busy_level BETWEEN 0 AND 3),
    busy_until          DATETIME(6),
    paused_until        DATETIME(6),
    pause_reason        VARCHAR(128),

    commission_bps      BIGINT        NOT NULL DEFAULT 1500
        CHECK (commission_bps BETWEEN 0 AND 5000),
    rider_bonus_bps     BIGINT        NOT NULL DEFAULT 300
        CHECK (rider_bonus_bps BETWEEN 0 AND 2000),
    supports_pickup     TINYINT(1)        NOT NULL DEFAULT true,
    supports_delivery   TINYINT(1)        NOT NULL DEFAULT true,
    min_order_paisa     BIGINT        NOT NULL DEFAULT 0,
    prep_time_default_s BIGINT        NOT NULL DEFAULT 1200,

    cover_url           VARCHAR(512),
    cover_blurhash      VARCHAR(48),
    logo_url            VARCHAR(512),
    logo_blurhash       VARCHAR(48),

    approved_at         DATETIME(6),
    approved_by         BINARY(16) REFERENCES users(id),
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    deleted_at          DATETIME(6),

    -- Partial-UNIQUE replacement, and the one case where a composite index would be
    -- wrong: `(slug, deleted_at)` would let two live vendors share a slug if their
    -- `deleted_at` differed. MySQL does not compare NULLs for uniqueness, so a NULL
    -- for deleted rows reproduces `WHERE deleted_at IS NULL` exactly.
    slug_active         VARCHAR(96) AS (IF(deleted_at IS NULL, slug, NULL)) STORED,

    UNIQUE INDEX uq_vendors_slug (slug_active),
    INDEX idx_vendors_zone_status (zone_id, status, open_state, deleted_at),
    INDEX idx_vendors_cell (cell_id),
    INDEX idx_vendors_sa_bbox (sa_bbox_min_lat_e7, sa_bbox_max_lat_e7)
);
```

Note `open_state` has five values, not a boolean. `UNREACHABLE` is distinct from `CLOSED` because
the former is the presence engine's automatic verdict ([`14`](14-presence-and-heartbeat.md)) and the
latter is the vendor's own choice; conflating them loses the information the operator needs.

```sql
CREATE TABLE menu_items (
    id                  BINARY(16) PRIMARY KEY,
    vendor_id           BINARY(16)        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    section_id          BINARY(16)        NOT NULL REFERENCES menu_sections(id) ON DELETE CASCADE,
    name                VARCHAR(128) NOT NULL,
    name_bn             VARCHAR(128),
    description         VARCHAR(600),
    description_bn      VARCHAR(600),
    price_paisa         BIGINT        NOT NULL CHECK (price_paisa >= 0),
    compare_at_paisa    BIGINT        CHECK (compare_at_paisa IS NULL OR compare_at_paisa > price_paisa),
    image_url           VARCHAR(512),
    image_blurhash      VARCHAR(48),
    image_is_cutout     TINYINT(1)        NOT NULL DEFAULT false,  -- drives the overflow treatment (doc 03 §10)
    prep_time_s         BIGINT        NOT NULL DEFAULT 600,
    calories            BIGINT,
    spice_level         SMALLINT        CHECK (spice_level BETWEEN 0 AND 3),
    is_vegetarian       TINYINT(1)        NOT NULL DEFAULT false,
    is_halal            TINYINT(1)        NOT NULL DEFAULT true,
    contains_allergens  JSON        NOT NULL,   -- array of allergen codes; '[]' when none
    availability        VARCHAR(16)  NOT NULL DEFAULT 'AVAILABLE'
        CHECK (availability IN ('AVAILABLE','SOLD_OUT','HIDDEN','SCHEDULED')),
    sold_out_until      DATETIME(6),
    sort_order          BIGINT        NOT NULL DEFAULT 0,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    deleted_at          DATETIME(6),

    INDEX idx_items_vendor_section (vendor_id, section_id, sort_order, deleted_at),
    INDEX idx_items_availability (vendor_id, availability, deleted_at)
);
```

Modifier groups follow the standard required/optional, min/max model:

```sql
CREATE TABLE modifier_groups (
    id              BINARY(16) PRIMARY KEY,
    vendor_id       BINARY(16)        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    name            VARCHAR(96)  NOT NULL,
    name_bn         VARCHAR(96),
    selection       VARCHAR(16)  NOT NULL CHECK (selection IN ('SINGLE','MULTIPLE')),
    min_select      SMALLINT        NOT NULL DEFAULT 0 CHECK (min_select >= 0),
    max_select      SMALLINT        NOT NULL DEFAULT 1 CHECK (max_select >= 1),
    is_required     TINYINT(1)        NOT NULL DEFAULT false,
    sort_order      BIGINT        NOT NULL DEFAULT 0,
    CHECK (max_select >= min_select),
    CHECK (NOT is_required OR min_select >= 1)
);
```

The last two `CHECK`s are the entire class of "the vendor configured a group that cannot be
satisfied" bugs, removed at the schema level.

---

## 6. Riders

```sql
CREATE TABLE riders (
    id                  BINARY(16) PRIMARY KEY,
    user_id             BINARY(16)        NOT NULL UNIQUE REFERENCES users(id),
    code                VARCHAR(12)  NOT NULL UNIQUE,     -- 'RDR-4K2M'
    full_name           VARCHAR(128) NOT NULL,
    date_of_birth       DATE        NOT NULL,
    vehicle             VARCHAR(16)  NOT NULL CHECK (vehicle IN ('MOTORBIKE','BICYCLE')),
    home_zone_id        BINARY(16)        NOT NULL REFERENCES zones(id),
    status              VARCHAR(24)  NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','NEEDS_INFO',
                          'APPROVED','SUSPENDED','REJECTED','RETIRED')),
    shift_state         VARCHAR(16)  NOT NULL DEFAULT 'OFFLINE'
        CHECK (shift_state IN ('OFFLINE','VERIFYING','ONLINE','ON_ORDER','BREAK','CASH_LOCKED')),
    photo_url           VARCHAR(512),
    payout_method       VARCHAR(16)  NOT NULL DEFAULT 'BKASH'
        CHECK (payout_method IN ('BKASH','NAGAD','BANK')),
    payout_number       VARCHAR(20),
    payout_name         VARCHAR(128),
    bank_name           VARCHAR(128),
    bank_account        VARCHAR(48),
    bank_routing        VARCHAR(24),
    approved_at         DATETIME(6),
    approved_by         BINARY(16) REFERENCES users(id),
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    -- The 18-year age floor was a CHECK under CockroachDB. MySQL and TiDB forbid
    -- non-deterministic functions inside CHECK, so `CURRENT_DATE` cannot appear here
    -- and this constraint cannot be expressed in the schema. It is enforced in
    -- `undal-core` on every write to `date_of_birth`, and by the nightly integrity
    -- job, which reports any rider row that violates it. This is a real downgrade
    -- from a database guarantee to an application guarantee, and it is listed in
    -- `39` as R30.
    INDEX idx_riders_zone_state (home_zone_id, shift_state, status)
);
```

The `CHECK` on `date_of_birth` encodes the 18-year eligibility rule from the brief's rider
checklist. It is a constraint rather than an application validation because an under-age rider in
the database is a legal problem, not a UX problem.

`shift_state` includes `CASH_LOCKED` — the state the rider enters when the end-of-shift settlement
screen is up and they cannot work. See [`25`](25-rider-cash-settlement.md).

```sql
CREATE TABLE rider_shifts (
    id                  BINARY(16) PRIMARY KEY,
    rider_id            BINARY(16)        NOT NULL REFERENCES riders(id),
    zone_id             BINARY(16)        NOT NULL REFERENCES zones(id),
    started_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    ended_at            DATETIME(6),
    end_reason          VARCHAR(32)
        CHECK (end_reason IS NULL OR end_reason IN
               ('RIDER_ENDED','AUTO_OFFLINE','ADMIN_ENDED','CASH_OVERDUE','APP_CRASH')),
    selfie_url          VARCHAR(512) NOT NULL,
    selfie_verified     TINYINT(1)        NOT NULL DEFAULT false,
    start_lat_e7        INT          NOT NULL,
    start_lon_e7        INT          NOT NULL,
    end_lat_e7          INT,
    end_lon_e7          INT,
    orders_completed    BIGINT        NOT NULL DEFAULT 0,
    orders_rejected     BIGINT        NOT NULL DEFAULT 0,
    distance_m          BIGINT        NOT NULL DEFAULT 0,
    online_seconds      BIGINT        NOT NULL DEFAULT 0,
    cash_collected_paisa BIGINT       NOT NULL DEFAULT 0,
    earnings_paisa      BIGINT        NOT NULL DEFAULT 0,

    -- Partial-index replacement. Read on every dispatch, so keeping it tight
    -- matters more here than anywhere else in the schema.
    zone_id_if_open     BINARY(16) AS (IF(ended_at IS NULL, zone_id, NULL)) STORED,

    INDEX idx_shifts_rider (rider_id, started_at DESC),
    INDEX idx_shifts_open (zone_id_if_open)
);
```

---

## 7. Orders — the core

```sql
CREATE TABLE orders (
    id                      BINARY(16) PRIMARY KEY,
    code                    VARCHAR(16)  NOT NULL UNIQUE,  -- 'UND-7K2M9QX4'
    customer_user_id        BINARY(16)        NOT NULL REFERENCES users(id),
    vendor_id               BINARY(16)        NOT NULL REFERENCES vendors(id),
    zone_id                 BINARY(16)        NOT NULL REFERENCES zones(id),

    fulfilment              VARCHAR(16)  NOT NULL CHECK (fulfilment IN ('DELIVERY','PICKUP')),
    state                   VARCHAR(24)  NOT NULL
        CHECK (state IN ('DRAFT','PLACED','ACCEPTED','REJECTED','RIDER_SEARCH',
                         'RIDER_ASSIGNED','PICKED_UP','ARRIVED','DELIVERED','SETTLED',
                         'AUTO_CANCELLED','CANCELLED_BY_CUSTOMER','CANCELLED_BY_VENDOR',
                         'CANCELLED_BY_ADMIN','REASSIGNING','DISPUTED')),

    -- Addresses are snapshotted, never referenced, so a later edit cannot rewrite history.
    delivery_address_id     BINARY(16)        REFERENCES addresses(id),
    delivery_snapshot       JSON,
    delivery_lat_e7         INT,
    delivery_lon_e7         INT,
    pickup_lat_e7           INT          NOT NULL,
    pickup_lon_e7           INT          NOT NULL,

    -- Money. Every one of these is paisa. Every one.
    subtotal_paisa          BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_paisa >= 0),
    discount_paisa          BIGINT NOT NULL DEFAULT 0 CHECK (discount_paisa >= 0),
    delivery_fee_paisa      BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_paisa >= 0),
    small_order_fee_paisa   BIGINT NOT NULL DEFAULT 0 CHECK (small_order_fee_paisa >= 0),
    tax_paisa               BIGINT NOT NULL DEFAULT 0 CHECK (tax_paisa >= 0),
    tip_paisa               BIGINT NOT NULL DEFAULT 0 CHECK (tip_paisa >= 0),
    rounding_paisa          BIGINT NOT NULL DEFAULT 0,          -- may be negative
    total_paisa             BIGINT NOT NULL DEFAULT 0 CHECK (total_paisa >= 0),

    commission_paisa        BIGINT NOT NULL DEFAULT 0,
    rider_bonus_paisa       BIGINT NOT NULL DEFAULT 0,
    rider_payout_paisa      BIGINT NOT NULL DEFAULT 0,
    vendor_payout_paisa     BIGINT NOT NULL DEFAULT 0,
    platform_revenue_paisa  BIGINT NOT NULL DEFAULT 0,

    -- Fare provenance, so an invoice can always explain itself.
    fare_source             VARCHAR(16) NOT NULL DEFAULT 'BRAIN'
        CHECK (fare_source IN ('BRAIN','FALLBACK','ADMIN_OVERRIDE')),
    fare_trace_id           BINARY(16),
    surge_bps               BIGINT NOT NULL DEFAULT 10000,
    weather_condition       VARCHAR(16) NOT NULL DEFAULT 'CLEAR',
    route_distance_m        BIGINT,
    route_duration_s        BIGINT,
    traffic_delay_s         BIGINT NOT NULL DEFAULT 0,
    distance_source         VARCHAR(16) NOT NULL DEFAULT 'OSRM'
        CHECK (distance_source IN ('OSRM','ESTIMATED')),

    -- Timing
    placed_at               DATETIME(6),
    accepted_at             DATETIME(6),
    prep_time_s             BIGINT,
    prep_time_source        VARCHAR(16) CHECK (prep_time_source IS NULL OR
                                prep_time_source IN ('SUGGESTED','VENDOR_SET','DEFAULT')),
    ready_at_estimate       DATETIME(6),
    assigned_at             DATETIME(6),
    picked_up_at            DATETIME(6),
    arrived_at              DATETIME(6),
    delivered_at            DATETIME(6),
    settled_at              DATETIME(6),
    eta_min_at_placement    DATETIME(6),
    eta_max_at_placement    DATETIME(6),

    rider_id                BINARY(16) REFERENCES riders(id),
    batch_id                BINARY(16) REFERENCES order_batches(id),

    customer_note           VARCHAR(280),
    payment_method          VARCHAR(16) NOT NULL DEFAULT 'COD' CHECK (payment_method = 'COD'),
    cash_collected_paisa    BIGINT,

    created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX idx_orders_customer (customer_user_id, created_at DESC),
    INDEX idx_orders_vendor_state (vendor_id, state, created_at DESC),
    -- Three partial-index replacements, two of which are load-bearing.
    -- `live_zone_id` is what keeps the command map's index small as history
    -- accumulates; `settled_zone_id` is what keeps weekly invoicing off a scan.
    live_zone_id    BINARY(16) AS (IF(state NOT IN ('SETTLED','DRAFT'), zone_id, NULL)) STORED,
    settled_zone_id BINARY(16) AS (IF(state = 'SETTLED', zone_id, NULL)) STORED,

    INDEX idx_orders_rider (rider_id, created_at DESC),
    INDEX idx_orders_zone_live (live_zone_id, state),
    INDEX idx_orders_code (code),
    INDEX idx_orders_settlement (settled_zone_id, delivered_at)
);
```

### 7.1 The snapshot principle

`delivery_snapshot JSONB` holds a frozen copy of the address at the moment of placement. So does
`order_items.item_snapshot`. A customer who renames "Home" to "Office" next month must not change
what an old order says, and a vendor who raises a price must not change what a customer was charged.

The rule: **anything that appears on an invoice is snapshotted into the order at placement.** The FK
is kept for navigation; the snapshot is kept for truth.

### 7.2 The state event log

```sql
CREATE TABLE order_state_events (
    id              BINARY(16) PRIMARY KEY,
    order_id        BINARY(16)        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    seq             BIGINT        NOT NULL,
    from_state      VARCHAR(24),
    to_state        VARCHAR(24)  NOT NULL,
    actor_type      VARCHAR(16)  NOT NULL
        CHECK (actor_type IN ('CUSTOMER','VENDOR','RIDER','ADMIN','SYSTEM')),
    actor_user_id   BINARY(16) REFERENCES users(id),
    reason_code     VARCHAR(48),
    reason_text     VARCHAR(512),
    metadata        JSON        NOT NULL,   -- undal-core always writes at least '{}'
    occurred_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX uq_order_events_seq (order_id, seq),
    INDEX idx_order_events_order (order_id, occurred_at)
);
```

Append-only. There is no `UPDATE` or `DELETE` statement in the codebase targeting this table, and a
CI check enforces that. The current `orders.state` is a materialisation of the last event; a
consistency test replays every order's events and asserts the final state matches.

### 7.3 The transition table

Implemented in `workers/core/src/domain/order/state-machine.ts`. Reproduced here as the
specification.

| From | To | Allowed actors | Guards |
| --- | --- | --- | --- |
| `DRAFT` | `PLACED` | Customer | Cart non-empty · vendor `APPROVED` and `open_state IN ('OPEN','BUSY')` · every item available · address in an `ACTIVE` zone · customer not banned · fare quote present |
| `PLACED` | `ACCEPTED` | Vendor | `prep_time_s` between 300 and 12000 · vendor owns the order |
| `PLACED` | `REJECTED` | Vendor | `reason_code` present |
| `PLACED` | `AUTO_CANCELLED` | System | 120 s elapsed · vendor unreachable per [`14 §7`](14-presence-and-heartbeat.md) |
| `PLACED` | `CANCELLED_BY_CUSTOMER` | Customer | Always allowed, no fee |
| `ACCEPTED` | `RIDER_SEARCH` | System | `fulfilment = 'DELIVERY'` · dispatch opened |
| `ACCEPTED` | `PICKED_UP` | Customer | `fulfilment = 'PICKUP'` · QR scanned by vendor |
| `ACCEPTED` | `CANCELLED_BY_CUSTOMER` | Customer | Cancellation fee applies after 60 s |
| `ACCEPTED` | `CANCELLED_BY_VENDOR` | Vendor | `reason_code` present · affects reliability score |
| `RIDER_SEARCH` | `RIDER_ASSIGNED` | System | A rider claimed the offer |
| `RIDER_SEARCH` | `CANCELLED_BY_ADMIN` | Admin | No rider after the cascade exhausts; admin decides |
| `RIDER_ASSIGNED` | `PICKED_UP` | Rider | QR scan matches `order.code` · rider within 150 m of vendor |
| `RIDER_ASSIGNED` | `REASSIGNING` | Rider, Admin, System | Rider cancelled, went offline, or was force-unassigned |
| `REASSIGNING` | `RIDER_SEARCH` | System | Always |
| `PICKED_UP` | `ARRIVED` | Rider, System | Within 80 m of `delivery_point`, or manual |
| `PICKED_UP` | `DISPUTED` | Admin | Exception raised |
| `ARRIVED` | `DELIVERED` | Rider | `cash_collected_paisa` recorded · equals `total_paisa` or a variance reason given |
| `DELIVERED` | `SETTLED` | System | 15 min elapsed, no dispute |
| `DELIVERED` | `DISPUTED` | Customer, Admin | Within 24 h |
| `DISPUTED` | `SETTLED` | Admin | Resolution recorded with cost attribution |
| any live | `CANCELLED_BY_ADMIN` | Admin | `reason_code` + cost attribution required |

Every transition writes an `order_state_events` row, emits an SSE event, and may emit FCM. The
effects table is in [`08 §6`](08-api-contract.md).

`seq` is allocated per order (`MAX(seq) + 1`) and the row is appended by `appendEvent`
(`workers/core/src/repositories/orders.ts`, D102). Two transitions on one order can read the same maximum,
and `uq_order_events_seq (order_id, seq)` then refuses the second insert — *after* its `UPDATE … WHERE
state = ?` already won and moved the order. A `DUPLICATE` is therefore retried with the next number (up to
five attempts) instead of failing: the index saying "somebody took that number" is a reason to take another,
not a reason to hand a customer an error about a change that happened. Any other database error is rethrown
on its first attempt.

### 7.4 Offers and assignments

```sql
CREATE TABLE order_offers (
    id              BINARY(16) PRIMARY KEY,
    order_id        BINARY(16)        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    rider_id        BINARY(16)        NOT NULL REFERENCES riders(id),
    wave            SMALLINT        NOT NULL,        -- cascade wave number, 1-based
    rank_in_wave    SMALLINT        NOT NULL,
    score           DOUBLE      NOT NULL,        -- the dispatch score, for audit
    trace_id        BINARY(16)        NOT NULL,        -- links to brain_traces
    payout_paisa    BIGINT        NOT NULL,
    offered_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at      DATETIME(6) NOT NULL,
    responded_at    DATETIME(6),
    response        VARCHAR(16)
        CHECK (response IS NULL OR response IN ('ACCEPTED','REJECTED','EXPIRED','WITHDRAWN')),
    reject_reason   VARCHAR(48),
    reject_note     VARCHAR(280),

    INDEX idx_offers_order (order_id, wave, rank_in_wave),
    INDEX idx_offers_rider (rider_id, offered_at DESC),
    UNIQUE INDEX uq_offers_order_rider_wave (order_id, rider_id, wave)
);
```

Every offer is recorded, including the ones that expired. This is what makes the dispatch engine
auditable: a rider who claims they never got an offer can be shown the exact timestamp, and a rider
whose acceptance rate is low can be shown which offers they let expire.

---

## 8. Money — the ledger

Undal uses **double-entry bookkeeping**. Every money movement is a balanced set of postings. This is
the single design decision that makes "no invoice is ever wrong" achievable rather than aspirational.

```sql
CREATE TABLE ledger_accounts (
    id          BINARY(16) PRIMARY KEY,
    code        VARCHAR(48) NOT NULL UNIQUE,
    kind        VARCHAR(16) NOT NULL
        CHECK (kind IN ('ASSET','LIABILITY','REVENUE','EXPENSE','EQUITY')),
    owner_type  VARCHAR(16) NOT NULL
        CHECK (owner_type IN ('PLATFORM','VENDOR','RIDER','CUSTOMER')),
    owner_id    BINARY(16),
    currency    VARCHAR(3)  NOT NULL DEFAULT 'BDT',
    created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX uq_ledger_owner (owner_type, owner_id, code)
);

CREATE TABLE ledger_entries (
    id              BINARY(16) PRIMARY KEY,
    entry_type      VARCHAR(48)  NOT NULL,   -- 'ORDER_DELIVERED', 'PAYOUT_PAID', ...
    order_id        BINARY(16) REFERENCES orders(id),
    invoice_id      BINARY(16),
    settlement_id   BINARY(16),
    description     VARCHAR(256) NOT NULL,
    occurred_at     DATETIME(6) NOT NULL,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    created_by      BINARY(16) REFERENCES users(id),
    reverses_id     BINARY(16) REFERENCES ledger_entries(id),

    INDEX idx_entries_order (order_id),
    INDEX idx_entries_occurred (occurred_at)
);

CREATE TABLE ledger_postings (
    id          BINARY(16) PRIMARY KEY,
    entry_id    BINARY(16) NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
    account_id  BINARY(16) NOT NULL REFERENCES ledger_accounts(id),
    amount_paisa BIGINT NOT NULL,             -- signed: debit positive, credit negative
    created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX idx_postings_entry (entry_id),
    INDEX idx_postings_account (account_id, created_at)
);
```

### 8.1 The closure invariant

> **For every `ledger_entries` row, the sum of its `ledger_postings.amount_paisa` is exactly zero.**

This is asserted three ways:

1. **At write time**, in `postEntry()`, which refuses to insert an unbalanced entry.
2. **At invoice time**, in the reconciliation gate, which refuses to render a PDF if any entry in
   the period is unbalanced.
3. **In CI**, by a property test that generates 10 000 random order lifecycles including
   cancellations, disputes, partial refunds and reversals, and asserts closure after every one.

There is no fourth way, because three is enough and the first one makes the other two redundant in
practice. They exist because "in practice" is not a guarantee.

### 8.2 Postings for a delivered order

This is **Vector 01**, the canonical worked example used throughout the corpus. A ৳450 subtotal,
3 800 m routed, motorbike, clear weather, no traffic delay, supply sufficient (surge 1.0×), 15%
commission, 3% rider bonus, no discount, no tip. The fare derivation is
[`10 §12.1`](10-fare-engine-math.md); the figures are:

| Quantity | Paisa | ৳ |
| --- | --- | --- |
| Subtotal | 45 000 | 450.00 |
| Delivery fee | 7 042 | 70.42 |
| Small-order fee | 2 500 | 25.00 |
| Tax (5% of the ৳87.72 platform base) | 439 | 4.39 |
| Pre-rounding total | 54 981 | 549.81 |
| **Cash collected (floored to the taka)** | **54 900** | **549.00** |

| Account | Amount (paisa) | Meaning |
| --- | --- | --- |
| `RIDER:{id}:CASH_IN_HAND` | `+54 900` | The rider is holding ৳549 that is not theirs |
| `VENDOR:{id}:PAYABLE` | `−37 400` | ৳450 − ৳67.50 commission − ৳13.50 rider-bonus funding + ৳5 fee share |
| `RIDER:{id}:PAYABLE` | `−8 370` | ৳65.20 fare + ৳13.50 bonus + ৳5 fee share |
| `PLATFORM:REVENUE_COMMISSION` | `−6 750` | 15% of ৳450 |
| `PLATFORM:REVENUE_SMALL_ORDER` | `−1 500` | ৳15 of the ৳25 fee |
| `PLATFORM:REVENUE_DELIVERY` | `−522` | The 8% delivery margin over the rider's fare |
| `PLATFORM:TAX_PAYABLE` | `−439` | 5% of ৳87.72 |
| `PLATFORM:EXPENSE_ROUNDING` | `+81` | The 81 paisa the platform absorbed by flooring |
| **Sum** | **`0`** | |

Every figure is derived, step by step, in [`10 §12.1`](10-fare-engine-math.md), alongside 39 more
vectors including rain surge, bicycle radius limits, pick-up with no rider, and a two-order bundle.

### 8.3 Invoices

```sql
CREATE TABLE payout_periods (
    id              BINARY(16) PRIMARY KEY,
    party_type      VARCHAR(8)  NOT NULL CHECK (party_type IN ('VENDOR','RIDER')),
    iso_year        SMALLINT       NOT NULL,
    iso_week        SMALLINT       NOT NULL CHECK (iso_week BETWEEN 1 AND 53),
    window_start    DATETIME(6) NOT NULL,   -- Asia/Dhaka boundaries, stored as UTC
    window_end      DATETIME(6) NOT NULL,
    generate_after  DATETIME(6) NOT NULL,   -- Friday 00:00 Dhaka for riders, Saturday for vendors
    status          VARCHAR(16) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','GENERATING','GENERATED','CLOSED')),
    generated_at    DATETIME(6),

    UNIQUE INDEX uq_period (party_type, iso_year, iso_week)
);

CREATE TABLE invoices (
    id                  BINARY(16) PRIMARY KEY,
    number              VARCHAR(32) NOT NULL UNIQUE,    -- UND/V/2026/44/00017
    period_id           BINARY(16) NOT NULL REFERENCES payout_periods(id),
    party_type          VARCHAR(8)  NOT NULL CHECK (party_type IN ('VENDOR','RIDER')),
    party_id            BINARY(16) NOT NULL,
    order_count         BIGINT NOT NULL,
    gross_paisa         BIGINT NOT NULL,
    commission_paisa    BIGINT NOT NULL DEFAULT 0,
    tax_paisa           BIGINT NOT NULL DEFAULT 0,
    discount_paisa      BIGINT NOT NULL DEFAULT 0,
    campaign_paisa      BIGINT NOT NULL DEFAULT 0,
    bonus_paisa         BIGINT NOT NULL DEFAULT 0,
    penalty_paisa       BIGINT NOT NULL DEFAULT 0,
    adjustment_paisa    BIGINT NOT NULL DEFAULT 0,
    cash_offset_paisa   BIGINT NOT NULL DEFAULT 0,       -- riders: cash already settled
    net_payable_paisa   BIGINT NOT NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','GENERATED','VERIFIED','PAID','DISPUTED','VOID')),
    pdf_url             VARCHAR(512),
    pdf_bytes           BIGINT,
    content_hash        BINARY(32) NOT NULL,           -- SHA-256 of the canonical line set
    verified_by         BINARY(16) REFERENCES users(id),
    verified_at         DATETIME(6),
    paid_by             BINARY(16) REFERENCES users(id),
    paid_at             DATETIME(6),
    paid_method         VARCHAR(16),
    paid_reference      VARCHAR(64),
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX uq_invoice_party_period (party_type, party_id, period_id),
    INDEX idx_invoices_status (status, created_at DESC)
);
```

`content_hash` makes the invoice tamper-evident: if anyone changes an underlying order after
generation, regenerating produces a different hash and the admin panel flags the discrepancy.
`pdf_bytes` is checked against the 1 MB ceiling from the brief, and generation fails loudly rather
than silently shipping a 3 MB file.

---

## 9. Operations tables

```sql
CREATE TABLE audit_log (
    id              BINARY(16) PRIMARY KEY,
    actor_user_id   BINARY(16) REFERENCES users(id),
    actor_type      VARCHAR(16)  NOT NULL,
    action          VARCHAR(64)  NOT NULL,       -- 'vendor.commission.update'
    resource_type   VARCHAR(48)  NOT NULL,
    resource_id     BINARY(16),
    `before`          JSON,
    `after`           JSON,
    delta           JSON,                      -- computed diff, for fast rendering
    ip              VARCHAR(45)  NOT NULL,
    user_agent      VARCHAR(512),
    request_id      VARCHAR(64)  NOT NULL,
    zone_id         BINARY(16) REFERENCES zones(id),
    risk            VARCHAR(8)   NOT NULL,
    occurred_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX idx_audit_actor (actor_user_id, occurred_at DESC),
    INDEX idx_audit_resource (resource_type, resource_id, occurred_at DESC),
    INDEX idx_audit_action (action, occurred_at DESC)
);
```

Append-only, enforced by a CI check plus a database role: the application's SQL user is granted
`INSERT` and `SELECT` on `audit_log` and nothing else. Even a SQL-injection bug cannot delete an
audit row, because the grant does not exist.

```sql
CREATE TABLE brain_traces (
    id              BINARY(16) PRIMARY KEY,
    kind            VARCHAR(16) NOT NULL
        CHECK (kind IN ('FARE','DISPATCH','BATCH','RANK','FORECAST','PREPTIME')),
    order_id        BINARY(16) REFERENCES orders(id),
    zone_id         BINARY(16) REFERENCES zones(id),
    inputs          JSON NOT NULL,
    features        JSON NOT NULL,
    intermediates   JSON NOT NULL,
    output          JSON NOT NULL,
    engine_version  VARCHAR(16) NOT NULL,
    duration_ms     BIGINT NOT NULL,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX idx_traces_order (order_id),
    INDEX idx_traces_kind_time (kind, created_at DESC)
);
```

A trace stores **everything needed to recompute the decision**: the inputs, the feature values read
from KV at that moment, the intermediate calculations, the output, and the engine version. Replaying
a trace through the current engine and getting a different answer is how a regression is detected,
and that replay is a CI job (`brain-replay`) that runs against the last 500 production traces
exported nightly.

Retention: 14 days for `FARE` and `RANK`, 90 days for `DISPATCH` and `BATCH` (they can be disputed),
pruned by the same request-triggered sweep that handles other housekeeping.

---

## 10. Migrations

```
workers/core/src/db/migrations/
├── 000_smoke.sql           CHECK parse-and-ignore probe, §1.2; drops its own table
├── 001_identity.sql
├── 002_rbac.sql
├── 003_geography.sql
├── 004_vendors.sql
├── 005_catalog.sql
├── 006_riders.sql
├── 007_orders.sql
├── 008_money.sql
├── 009_marketing.sql
├── 010_operations.sql
├── 011_indexes_secondary.sql
└── 012_constraints_deferred.sql
```

Rules:

1. **Forward-only.** No `down` migrations. A mistake is corrected by a new migration, which is what
   actually happens in production anyway.
2. **Idempotent.** Every statement uses `IF NOT EXISTS` / `IF EXISTS`, so a partially-applied
   migration can be re-run.
3. **Online.** No statement may take an exclusive lock on a large table. TiDB's schema changes are
   online by default; the check is that no migration does `ALTER TABLE ... MODIFY COLUMN ... NOT
   NULL` on a populated column without a preceding backfill migration.
4. **Statement-level, not file-level.** `.github/workflows/migrate.yml` connects with the
   `TIDB_MIGRATION_URL` secret, reads `schema_migrations`, and applies what is missing **one
   statement at a time**, recording each as it succeeds.
5. **Verified.** After applying, the workflow runs `scripts/db/verify_schema.py`, which compares the
   live schema against `docs/schema/expected.json` (generated from this document) and fails on
   drift.

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version         VARCHAR(16)  NOT NULL,
    statement_index INT          NOT NULL,
    checksum        VARBINARY(32) NOT NULL,   -- SHA-256 of the whole file
    applied_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    applied_by      VARCHAR(128) NOT NULL,    -- the Actions run URL
    PRIMARY KEY (version, statement_index)
);
```

`checksum` means an edited migration file that has already been applied is detected and refused,
which is the single most common way a team corrupts a schema. That protection is unchanged.

**Why rule 4 changed, and why it is not cosmetic.** This document previously said migrations were
applied "inside a transaction per file". **On TiDB that sentence is false.** DDL auto-commits — it
cannot be rolled back and it cannot be wrapped. A migration file that fails on its seventh statement
leaves the first six applied and the database in a state no transaction will undo.

The response is to stop pretending the file is atomic and make the **statement** the unit. Each
statement is individually idempotent (rule 2, which was good practice before and is now load-bearing),
each is recorded in `schema_migrations` as it succeeds, and a failed run **resumes** from the first
unrecorded statement rather than restarting. A re-run after a partial failure is therefore safe,
which is the property the per-file transaction used to provide and the only honest way to provide it
here.

`verify_schema.py` is rewritten against MySQL's `information_schema`, and the way it handles
`CHECK` is the part worth naming. On TiDB, `CHECK` constraints never appear in
`information_schema.table_constraints`; where they appear at all it is in `CHECK_CONSTRAINTS` and
`TIDB_CHECK_CONSTRAINTS`. **On Starter, where the feature cannot be enabled (§1.2), they may not
appear anywhere at all.**

So the verifier does not try to read them back and compare. A verifier that queried the obvious
table would find zero checks, report no drift, and pass forever — a green light that means nothing.
Instead, `CHECK` is verified by a different mechanism entirely: `check-constraint-parity` compares
the declarations in this document against `constraints.json`, and the integrity job tests the
constraints against live data. The schema verifier covers what `information_schema` genuinely
reports — tables, columns, types, nullability, defaults, indexes, generated-column expressions and
foreign keys — and ships a fixture for each that proves it catches a drop.

Splitting it this way means no part of the system reports success on evidence it does not have.

---

## 11. Query patterns

The five hot queries, with their indexes:

### 11.1 Nearby open vendors

```sql
-- Stage 1. Cell list and bounding box come from cellsWithin(centre, radius_m),
-- computed in the Worker before the query opens. See §4.1.2.
SELECT v.id, v.name, v.cover_url, v.logo_url, v.open_state,
       v.lat_e7, v.lon_e7,
       vs.rating_avg, vs.rating_count, vs.prep_time_p50_s, vs.accept_rate
FROM vendors v
JOIN vendor_stats vs ON vs.vendor_id = v.id
WHERE v.deleted_at IS NULL
  AND v.status = 'APPROVED'
  AND v.zone_id = ?
  AND v.cell_id IN (?, ?, ?, ?, ?, ?, ?, ?, ?)
  AND v.lat_e7 BETWEEN ? AND ?
  AND v.lon_e7 BETWEEN ? AND ?
LIMIT 200;
```

Uses `idx_vendors_zone_status` for the equality predicates and `idx_vendors_cell` for the cell
filter. **Stage 2 happens in the Worker:** exact haversine from the centre to each
`(lat_e7, lon_e7)`, rounded to integer metres, filtered to the true radius, sorted ascending with
ties broken by `vendor_id`. The distance the client sees is identical to the one `ST_Distance`
returned, and `geo-parity` is what proves it (§4.1.4).

The 200-row cap is deliberate and unchanged: the Brain re-ranks within the candidate set, and
ranking more than 200 vendors in one zone is not a situation that improves the result.

### 11.2 A vendor's live order board

```sql
SELECT o.*, (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
FROM orders o
WHERE o.vendor_id = ?
  AND o.state IN ('PLACED','ACCEPTED','RIDER_SEARCH','RIDER_ASSIGNED')
ORDER BY o.placed_at
LIMIT 50;
```

Uses `idx_orders_vendor_state`.

### 11.3 Candidate riders for dispatch

```sql
SELECT r.id, r.vehicle, r.code, rs.accept_rate, rs.completion_rate,
       rs.rating_avg, rs.deliveries_total, s.id AS shift_id
FROM riders r
JOIN rider_shifts s ON s.rider_id = r.id AND s.ended_at IS NULL
JOIN rider_stats rs ON rs.rider_id = r.id
WHERE r.status = 'APPROVED'
  AND r.shift_state IN ('ONLINE','ON_ORDER')
  AND s.zone_id = ?
  AND NOT EXISTS (
      SELECT 1 FROM rider_suspensions sus
      WHERE sus.rider_id = r.id AND sus.active AND sus.until > CURRENT_TIMESTAMP(6)
  );
```

Positions come from D1, not from this query — see [`07`](07-d1-live-tracking.md). Joining positions
here would mean a cross-database join, which does not exist; the Brain assembles them.

### 11.4 Invoice line assembly

```sql
SELECT o.id, o.code, o.delivered_at, o.subtotal_paisa, o.discount_paisa,
       o.commission_paisa, o.tax_paisa, o.vendor_payout_paisa,
       o.small_order_fee_paisa, o.rider_bonus_paisa
FROM orders o
WHERE o.vendor_id = ?
  AND o.state = 'SETTLED'
  AND o.delivered_at >= ? AND o.delivered_at < ?
ORDER BY o.delivered_at;
```

Uses `idx_orders_settlement`. The half-open interval `[start, end)` is deliberate and is the single
most common source of double-counted or missing rows in weekly billing.

### 11.5 Live orders for the command map

```sql
SELECT o.id, o.code, o.state, o.vendor_id, o.rider_id, o.zone_id,
       o.pickup_lat_e7, o.pickup_lon_e7,
       o.delivery_lat_e7, o.delivery_lon_e7,
       o.placed_at, o.ready_at_estimate
FROM orders o
WHERE o.live_zone_id IN (?, ?, ?)
  AND o.state IN ('PLACED','ACCEPTED','RIDER_SEARCH','RIDER_ASSIGNED','PICKED_UP','ARRIVED');
```

Uses `idx_orders_zone_live` on the generated `live_zone_id`, which stays small for the same reason
the partial index did: settled orders evaluate to `NULL` and fall out of it.

There is nothing left to serialise — the four integers go to the Worker, which assembles the same
GeoJSON the admin map already consumes. **The wire format to the client is unchanged**, which
matters because [`21`](21-admin-panel.md) is not a document this migration is allowed to alter.

---

## 12. Scaling considerations

| Concern | Mitigation |
| --- | --- |
| UUID v7 primary keys create a write hotspot on the latest region | Accepted, deliberately. TiDB splits regions automatically, and Undal's write rate (≈12 orders/minute at 500/day peak) is three orders of magnitude below the point where this matters. `AUTO_RANDOM` and `SHARD_ROW_ID_BITS` would spread the writes and **destroy the range-scan locality that is the entire reason this schema chose v7 over v4** (`00 §glossary`). Revisit above 5,000 orders/day, not before. |
| `orders` grows unboundedly | At 500 orders/day the table reaches ~180 k rows/year, ~400 MB with items. **See the storage note below — the runway is shorter than it was.** No partitioning needed. |
| `order_state_events` grows ~8× faster | ~1.5 M rows/year, ~300 MB. Still fine. Events older than 2 years for `SETTLED` orders are archived to a compressed `JSON` column on the order and deleted, by a request-triggered sweep. |
| `brain_traces` is the largest table by bytes | Retention policy (§9) caps it at ~2 GB. TiDB TTL can now enforce that cap at the storage layer, with the request-triggered sweep kept as a fallback. |
| `ops_logs` sampling | 1% of successes, 100% of errors, 7-day retention, hard row cap of 2 M enforced by the sweep. |
| Spatial prefilter selectivity | Zone equality is checked before the cell predicate, so `idx_vendors_cell` operates on a few hundred rows, not the whole table. The ordering that made this true under the inverted index still makes it true. |
| Read amplification from `vendor_stats` joins | `vendor_stats` is a narrow table updated by the post-order effect, so it stays in cache. |
| Stored generated columns add write cost | Eleven partial indexes became generated columns (§4.3), each computed on write rather than read. The cost is bytes and a few microseconds per insert; the benefit is that the query plans are the ones this document already specified. |

### 12.1 Storage: the runway is about three and a half years, not twenty

This document used to say the free tier held "~20 years". **That figure does not survive the move
and the replacement is materially worse.** It is stated here rather than quietly dropped.

CockroachDB's free tier gave 10 GiB. TiDB Cloud Starter gives **5 GiB of row storage** plus 5 GiB of
columnar storage — and the columnar half is a TiFlash replica quota for analytics, not extra primary
capacity. Row storage halves.

The old figure was also generous with its arithmetic: it divided 10 GiB by orders-and-items alone.
Counting everything:

| | Size |
| --- | --- |
| `brain_traces`, capped by retention | ~2.0 GB |
| `ops_logs`, capped at 2 M rows | ~0.4 GB |
| All other tables at steady state | ~0.2 GB |
| **Fixed subtotal** | **~2.6 GB** |
| `orders` + `order_items`, per year | ~0.4 GB |
| `order_state_events`, per year | ~0.3 GB |
| **Growth** | **~0.7 GB/year** |

(5,120 − 2,600) ÷ 700 ≈ **3.6 years** at 500 orders/day.

That is a real constraint rather than a comfortable one, and it is the tightest limit in the
platform's free-tier budget. Two levers exist before any money is spent, and both are already
specified rather than invented here: tightening `brain_traces` retention from 90 days toward 7
reclaims most of the 2 GB fixed cost, and archiving `order_state_events` at one year instead of two
halves the largest growth term. Applying both extends the runway past ten years. Neither changes
platform behaviour; both change a retention number in [`29`](29-secrets-and-configuration.md).

Logged in [`39 §3.4`](39-risk-register-and-truths.md) as R4, rewritten.

### 12.2 Request units cannot be carried across

The old figures — ~21 M RU/month in [`01 §5.1`](01-mission-and-non-negotiables.md), ~31 M RU/month
in [`39 §2.1`](39-risk-register-and-truths.md), against a 50 M limit — were computed against
**CockroachDB's** definition of a request unit. TiDB's RU measures different work under a different
formula. The two numbers are not convertible, and renaming the vendor on an unconverted figure would
be exactly the silent divergence this migration refuses.

So the estimate is **withdrawn, not translated**. The limit is 50 M RU/month. Undal's consumption
against TiDB's model is **unmeasured**, it will be recorded during the first week of production, and
it will be published here with its measurement date. Until then, any claim about RU headroom in this
corpus is marked unknown.

This also means the 1,500-orders/day threshold in [`39 §4`](39-risk-register-and-truths.md) is
unknown rather than merely uncertain. It may move in either direction.

---

## 13. Reading on

Next: [`07-d1-live-tracking.md`](07-d1-live-tracking.md) — the ephemeral channel.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
