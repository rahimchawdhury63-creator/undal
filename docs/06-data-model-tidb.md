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

1. **Money is `INT8` paisa.** There is no `DECIMAL`, no `NUMERIC`, no `FLOAT` on any money column.
   A CI check parses the schema and fails on any column whose name ends in `_paisa` that is not
   `INT8`, and on any money-shaped column that is not named `*_paisa`.
2. **Every table has `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`** except join tables with a
   natural composite key, and append-only log tables that use `(partition, seq)`.
3. **Every table has `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.** Mutable tables also have
   `updated_at`, maintained by a trigger-free convention: every `UPDATE` statement in the codebase
   sets it, and a CI check greps for `UPDATE` statements that do not.
4. **Soft delete only where it is needed.** `deleted_at TIMESTAMPTZ` exists on vendors, menu items,
   and addresses, because those are referenced by historical orders. Everything else is hard
   deleted. Soft-deleting everything is how a schema becomes unreadable.
5. **Enums are `STRING` with a `CHECK`,** not PostgreSQL `ENUM` types. Adding a value to a check
   constraint is an online operation in CockroachDB; altering an enum type is not.
6. **Foreign keys are declared.** Every one of them. The performance argument against FKs does not
   apply at Undal's scale, and the correctness argument for them always applies.
7. **No nullable booleans.** A tri-state boolean is a design error. Use an explicit status column.
8. **Spatial data uses `GEOGRAPHY(POINT, 4326)` and `GEOGRAPHY(POLYGON, 4326)`,** which gives
   metre-accurate `ST_Distance` and `ST_DWithin` without a projection step.

---

## 2. Table inventory

| Group | Tables | Count |
| --- | --- | --- |
| Identity and access | `users`, `user_profiles`, `sessions`, `devices`, `device_tokens`, `password_history`, `login_attempts`, `oauth_identities`, `totp_secrets`, `recovery_codes`, `admin_roles`, `admin_role_permissions`, `admin_user_roles`, `permissions` | 14 |
| Geography | `zones`, `zone_polygons`, `zone_pricing`, `zone_hours`, `addresses`, `address_labels`, `geocode_cache` | 7 |
| Vendors | `vendors`, `vendor_profiles`, `vendor_documents`, `vendor_hours`, `vendor_holidays`, `vendor_contacts`, `vendor_bank_accounts`, `vendor_categories`, `categories`, `vendor_stats`, `vendor_pause_log`, `vendor_commission_overrides` | 12 |
| Catalogue | `menus`, `menu_sections`, `menu_items`, `item_variants`, `modifier_groups`, `modifiers`, `item_modifier_groups`, `item_availability`, `item_tags`, `tags`, `item_stats`, `item_media` | 12 |
| Riders | `riders`, `rider_profiles`, `rider_documents`, `rider_vehicles`, `rider_shifts`, `rider_shift_selfies`, `rider_stats`, `rider_penalties`, `rider_suspensions`, `rider_cash_balances`, `rider_cash_settlements`, `rider_zone_assignments` | 12 |
| Orders | `orders`, `order_items`, `order_item_modifiers`, `order_state_events`, `order_fees`, `order_discounts`, `order_assignments`, `order_offers`, `order_batches`, `order_batch_members`, `order_proofs`, `order_cancellations`, `order_ratings`, `order_disputes`, `order_dispute_messages` | 15 |
| Money | `ledger_accounts`, `ledger_entries`, `ledger_postings`, `payout_periods`, `invoices`, `invoice_lines`, `invoice_documents`, `payout_transactions`, `platform_config`, `config_audit`, `tax_records`, `rounding_adjustments` | 12 |
| Marketing | `promo_codes`, `promo_redemptions`, `campaigns`, `campaign_budgets`, `campaign_redemptions`, `referrals`, `loyalty_tiers`, `customer_loyalty`, `reminders`, `reminder_sends` | 10 |
| Operations | `audit_log`, `ops_errors`, `ops_metrics`, `ops_logs`, `effect_dead_letters`, `brain_traces`, `dispatch_locks`, `exceptions`, `support_tickets`, `support_messages`, `weather_observations`, `notification_log` | 12 |
| **Total** | | **96** |

---

## 3. Identity and access

```sql
-- 001_identity.sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           STRING(20)  NOT NULL,
    phone_norm      STRING(20)  NOT NULL,   -- E.164, +8801XXXXXXXXX
    email           STRING(254),
    email_norm      STRING(254),            -- lowercased, dots preserved
    password_hash   STRING(255),            -- Argon2id; NULL only for OAuth-only accounts
    actor_type      STRING(16)  NOT NULL
        CHECK (actor_type IN ('CUSTOMER','VENDOR_OWNER','RIDER','ADMIN')),
    status          STRING(24)  NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','SUSPENDED','PENDING_REVIEW','DEACTIVATED','BANNED')),
    locale          STRING(5)   NOT NULL DEFAULT 'bn',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,

    CONSTRAINT uq_users_phone UNIQUE (phone_norm),
    INDEX idx_users_email (email_norm) WHERE email_norm IS NOT NULL,
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
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      BYTES       NOT NULL,   -- SHA-256 of the opaque bearer token
    device_id       UUID        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    ip_created      STRING(45)  NOT NULL,
    ua_created      STRING(512) NOT NULL,
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    last_used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    revoked_reason  STRING(64),

    INDEX idx_sessions_user (user_id, revoked_at),
    UNIQUE INDEX uq_sessions_token (token_hash)
);

CREATE TABLE devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform        STRING(16)  NOT NULL CHECK (platform IN ('ANDROID','WEB')),
    fingerprint     STRING(128) NOT NULL,   -- stable per install, not an advertising id
    model           STRING(128),
    os_version      STRING(32),
    app_version     STRING(32),
    app_flavour     STRING(16)  CHECK (app_flavour IN ('CUSTOMER','PARTNER','RIDER')),
    -- Battery-optimisation posture, needed by the alarm coaching flow (doc 15 §9)
    battery_opt_exempt      BOOL,
    notifications_allowed   BOOL,
    exact_alarm_allowed     BOOL,
    full_screen_intent_allowed BOOL,
    oem_autostart_prompted  BOOL        NOT NULL DEFAULT false,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE INDEX uq_devices_user_fp (user_id, fingerprint)
);

CREATE TABLE device_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id       UUID        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    fcm_token       STRING(512) NOT NULL,
    valid           BOOL        NOT NULL DEFAULT true,
    invalidated_at  TIMESTAMPTZ,
    invalid_reason  STRING(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    refreshed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE INDEX uq_device_tokens_token (fcm_token),
    INDEX idx_device_tokens_device (device_id) WHERE valid
);
```

The device columns recording battery-optimisation posture are not decoration — they drive the
coaching flow in [`15 §9`](15-wakeup-alarm-fcm.md) and the admin panel's "riders at risk of missing
orders" report, which is a genuinely useful operational tool that no competitor exposes.

### 3.1 RBAC tables

```sql
CREATE TABLE permissions (
    key         STRING(64) PRIMARY KEY,     -- 'order.reassign', 'finance.invoice.mark_paid'
    domain      STRING(32) NOT NULL,
    description STRING(256) NOT NULL,
    risk        STRING(8)  NOT NULL CHECK (risk IN ('LOW','MEDIUM','HIGH','CRITICAL'))
);

CREATE TABLE admin_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key         STRING(48) NOT NULL UNIQUE,
    name        STRING(96) NOT NULL,
    name_bn     STRING(96) NOT NULL,
    is_system   BOOL NOT NULL DEFAULT false,   -- system roles cannot be deleted
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_role_permissions (
    role_id         UUID   NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    permission_key  STRING(64) NOT NULL REFERENCES permissions(key),
    PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE admin_user_roles (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     UUID NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    zone_scope  UUID[] ,                     -- NULL = global; otherwise limited to these zones
    granted_by  UUID NOT NULL REFERENCES users(id),
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ,
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
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            STRING(24)  NOT NULL UNIQUE,   -- 'SYL-CENTRAL'
    name            STRING(96)  NOT NULL,
    name_bn         STRING(96)  NOT NULL,
    country         STRING(2)   NOT NULL DEFAULT 'BD',
    city            STRING(64)  NOT NULL,
    currency        STRING(3)   NOT NULL DEFAULT 'BDT',
    timezone        STRING(48)  NOT NULL DEFAULT 'Asia/Dhaka',
    status          STRING(16)  NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','ACTIVE','PAUSED','RETIRED')),
    boundary        GEOGRAPHY(POLYGON, 4326) NOT NULL,
    centroid        GEOGRAPHY(POINT, 4326)   NOT NULL,
    area_sq_km      FLOAT8      NOT NULL,
    created_by      UUID        NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    INVERTED INDEX idx_zones_boundary (boundary),
    INDEX idx_zones_status (status)
);
```

`area_sq_km` is denormalised because it is read on every ranking pass and computing it from the
polygon each time is wasteful. It is recomputed in the same statement that updates `boundary`, and a
CI invariant test asserts they agree to 0.1%.

```sql
CREATE TABLE zone_pricing (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id                 UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    vehicle                 STRING(16) NOT NULL CHECK (vehicle IN ('MOTORBIKE','BICYCLE')),
    base_fare_paisa         INT8 NOT NULL CHECK (base_fare_paisa >= 0),
    base_distance_m         INT8 NOT NULL DEFAULT 2000,
    per_km_paisa            INT8 NOT NULL CHECK (per_km_paisa >= 0),
    max_radius_m            INT8 NOT NULL,
    min_payout_paisa        INT8 NOT NULL,
    surge_cap_bps           INT8 NOT NULL DEFAULT 22000,   -- 2.2x
    effective_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to            TIMESTAMPTZ,
    created_by              UUID NOT NULL REFERENCES users(id),

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
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label           STRING(32)  NOT NULL DEFAULT 'OTHER'
        CHECK (label IN ('HOME','WORK','OTHER')),
    custom_label    STRING(48),
    recipient_name  STRING(96),
    recipient_phone STRING(20),
    line1           STRING(256) NOT NULL,
    line2           STRING(256),
    landmark        STRING(128),
    floor_flat      STRING(64),
    area            STRING(96),
    city            STRING(64)  NOT NULL,
    postcode        STRING(12),
    point           GEOGRAPHY(POINT, 4326) NOT NULL,
    zone_id         UUID        REFERENCES zones(id),
    delivery_note   STRING(280),
    is_default      BOOL        NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,

    INDEX idx_addresses_user (user_id) WHERE deleted_at IS NULL,
    INVERTED INDEX idx_addresses_point (point)
);
```

`floor_flat` and `landmark` are separate fields and both prominent in the UI because in Bangladesh
a street address alone frequently does not locate a door. The rider's screen shows landmark above
line1, which is the opposite of Western convention and correct here.

---

## 5. Vendors and catalogue

```sql
CREATE TABLE vendors (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id       UUID        NOT NULL REFERENCES users(id),
    kind                STRING(16)  NOT NULL
        CHECK (kind IN ('RESTAURANT','HOME_KITCHEN','CLOUD_KITCHEN','GROCERY')),
    slug                STRING(96)  NOT NULL,
    name                STRING(128) NOT NULL,
    name_bn             STRING(128),
    tagline             STRING(160),
    description         STRING(1200),
    phone               STRING(20)  NOT NULL,
    email               STRING(254),

    zone_id             UUID        NOT NULL REFERENCES zones(id),
    point               GEOGRAPHY(POINT, 4326) NOT NULL,
    address_line        STRING(256) NOT NULL,
    landmark            STRING(128),

    status              STRING(24)  NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','NEEDS_INFO',
                          'APPROVED','SUSPENDED','REJECTED','RETIRED')),
    open_state          STRING(16)  NOT NULL DEFAULT 'CLOSED'
        CHECK (open_state IN ('OPEN','BUSY','PAUSED','CLOSED','UNREACHABLE')),
    busy_level          INT2        NOT NULL DEFAULT 0 CHECK (busy_level BETWEEN 0 AND 3),
    busy_until          TIMESTAMPTZ,
    paused_until        TIMESTAMPTZ,
    pause_reason        STRING(128),

    commission_bps      INT8        NOT NULL DEFAULT 1500
        CHECK (commission_bps BETWEEN 0 AND 5000),
    rider_bonus_bps     INT8        NOT NULL DEFAULT 300
        CHECK (rider_bonus_bps BETWEEN 0 AND 2000),
    supports_pickup     BOOL        NOT NULL DEFAULT true,
    supports_delivery   BOOL        NOT NULL DEFAULT true,
    min_order_paisa     INT8        NOT NULL DEFAULT 0,
    prep_time_default_s INT8        NOT NULL DEFAULT 1200,

    cover_url           STRING(512),
    cover_blurhash      STRING(48),
    logo_url            STRING(512),
    logo_blurhash       STRING(48),

    approved_at         TIMESTAMPTZ,
    approved_by         UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,

    UNIQUE INDEX uq_vendors_slug (slug) WHERE deleted_at IS NULL,
    INDEX idx_vendors_zone_status (zone_id, status, open_state) WHERE deleted_at IS NULL,
    INVERTED INDEX idx_vendors_point (point)
);
```

Note `open_state` has five values, not a boolean. `UNREACHABLE` is distinct from `CLOSED` because
the former is the presence engine's automatic verdict ([`14`](14-presence-and-heartbeat.md)) and the
latter is the vendor's own choice; conflating them loses the information the operator needs.

```sql
CREATE TABLE menu_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id           UUID        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    section_id          UUID        NOT NULL REFERENCES menu_sections(id) ON DELETE CASCADE,
    name                STRING(128) NOT NULL,
    name_bn             STRING(128),
    description         STRING(600),
    description_bn      STRING(600),
    price_paisa         INT8        NOT NULL CHECK (price_paisa >= 0),
    compare_at_paisa    INT8        CHECK (compare_at_paisa IS NULL OR compare_at_paisa > price_paisa),
    image_url           STRING(512),
    image_blurhash      STRING(48),
    image_is_cutout     BOOL        NOT NULL DEFAULT false,  -- drives the overflow treatment (doc 03 §10)
    prep_time_s         INT8        NOT NULL DEFAULT 600,
    calories            INT8,
    spice_level         INT2        CHECK (spice_level BETWEEN 0 AND 3),
    is_vegetarian       BOOL        NOT NULL DEFAULT false,
    is_halal            BOOL        NOT NULL DEFAULT true,
    contains_allergens  STRING[]    NOT NULL DEFAULT ARRAY[]::STRING[],
    availability        STRING(16)  NOT NULL DEFAULT 'AVAILABLE'
        CHECK (availability IN ('AVAILABLE','SOLD_OUT','HIDDEN','SCHEDULED')),
    sold_out_until      TIMESTAMPTZ,
    sort_order          INT8        NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,

    INDEX idx_items_vendor_section (vendor_id, section_id, sort_order) WHERE deleted_at IS NULL,
    INDEX idx_items_availability (vendor_id, availability) WHERE deleted_at IS NULL
);
```

Modifier groups follow the standard required/optional, min/max model:

```sql
CREATE TABLE modifier_groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id       UUID        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    name            STRING(96)  NOT NULL,
    name_bn         STRING(96),
    selection       STRING(16)  NOT NULL CHECK (selection IN ('SINGLE','MULTIPLE')),
    min_select      INT2        NOT NULL DEFAULT 0 CHECK (min_select >= 0),
    max_select      INT2        NOT NULL DEFAULT 1 CHECK (max_select >= 1),
    is_required     BOOL        NOT NULL DEFAULT false,
    sort_order      INT8        NOT NULL DEFAULT 0,
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
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL UNIQUE REFERENCES users(id),
    code                STRING(12)  NOT NULL UNIQUE,     -- 'RDR-4K2M'
    full_name           STRING(128) NOT NULL,
    date_of_birth       DATE        NOT NULL,
    vehicle             STRING(16)  NOT NULL CHECK (vehicle IN ('MOTORBIKE','BICYCLE')),
    home_zone_id        UUID        NOT NULL REFERENCES zones(id),
    status              STRING(24)  NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','NEEDS_INFO',
                          'APPROVED','SUSPENDED','REJECTED','RETIRED')),
    shift_state         STRING(16)  NOT NULL DEFAULT 'OFFLINE'
        CHECK (shift_state IN ('OFFLINE','VERIFYING','ONLINE','ON_ORDER','BREAK','CASH_LOCKED')),
    photo_url           STRING(512),
    payout_method       STRING(16)  NOT NULL DEFAULT 'BKASH'
        CHECK (payout_method IN ('BKASH','NAGAD','BANK')),
    payout_number       STRING(20),
    payout_name         STRING(128),
    bank_name           STRING(128),
    bank_account        STRING(48),
    bank_routing        STRING(24),
    approved_at         TIMESTAMPTZ,
    approved_by         UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (date_of_birth <= (now()::DATE - INTERVAL '18 years')::DATE),
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
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id            UUID        NOT NULL REFERENCES riders(id),
    zone_id             UUID        NOT NULL REFERENCES zones(id),
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at            TIMESTAMPTZ,
    end_reason          STRING(32)
        CHECK (end_reason IS NULL OR end_reason IN
               ('RIDER_ENDED','AUTO_OFFLINE','ADMIN_ENDED','CASH_OVERDUE','APP_CRASH')),
    selfie_url          STRING(512) NOT NULL,
    selfie_verified     BOOL        NOT NULL DEFAULT false,
    start_point         GEOGRAPHY(POINT, 4326) NOT NULL,
    end_point           GEOGRAPHY(POINT, 4326),
    orders_completed    INT8        NOT NULL DEFAULT 0,
    orders_rejected     INT8        NOT NULL DEFAULT 0,
    distance_m          INT8        NOT NULL DEFAULT 0,
    online_seconds      INT8        NOT NULL DEFAULT 0,
    cash_collected_paisa INT8       NOT NULL DEFAULT 0,
    earnings_paisa      INT8        NOT NULL DEFAULT 0,

    INDEX idx_shifts_rider (rider_id, started_at DESC),
    INDEX idx_shifts_open (zone_id) WHERE ended_at IS NULL
);
```

---

## 7. Orders — the core

```sql
CREATE TABLE orders (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                    STRING(16)  NOT NULL UNIQUE,  -- 'UND-7K2M9QX4'
    customer_user_id        UUID        NOT NULL REFERENCES users(id),
    vendor_id               UUID        NOT NULL REFERENCES vendors(id),
    zone_id                 UUID        NOT NULL REFERENCES zones(id),

    fulfilment              STRING(16)  NOT NULL CHECK (fulfilment IN ('DELIVERY','PICKUP')),
    state                   STRING(24)  NOT NULL
        CHECK (state IN ('DRAFT','PLACED','ACCEPTED','REJECTED','RIDER_SEARCH',
                         'RIDER_ASSIGNED','PICKED_UP','ARRIVED','DELIVERED','SETTLED',
                         'AUTO_CANCELLED','CANCELLED_BY_CUSTOMER','CANCELLED_BY_VENDOR',
                         'CANCELLED_BY_ADMIN','REASSIGNING','DISPUTED')),

    -- Addresses are snapshotted, never referenced, so a later edit cannot rewrite history.
    delivery_address_id     UUID        REFERENCES addresses(id),
    delivery_snapshot       JSONB,
    delivery_point          GEOGRAPHY(POINT, 4326),
    pickup_point            GEOGRAPHY(POINT, 4326) NOT NULL,

    -- Money. Every one of these is paisa. Every one.
    subtotal_paisa          INT8 NOT NULL DEFAULT 0 CHECK (subtotal_paisa >= 0),
    discount_paisa          INT8 NOT NULL DEFAULT 0 CHECK (discount_paisa >= 0),
    delivery_fee_paisa      INT8 NOT NULL DEFAULT 0 CHECK (delivery_fee_paisa >= 0),
    small_order_fee_paisa   INT8 NOT NULL DEFAULT 0 CHECK (small_order_fee_paisa >= 0),
    tax_paisa               INT8 NOT NULL DEFAULT 0 CHECK (tax_paisa >= 0),
    tip_paisa               INT8 NOT NULL DEFAULT 0 CHECK (tip_paisa >= 0),
    rounding_paisa          INT8 NOT NULL DEFAULT 0,          -- may be negative
    total_paisa             INT8 NOT NULL DEFAULT 0 CHECK (total_paisa >= 0),

    commission_paisa        INT8 NOT NULL DEFAULT 0,
    rider_bonus_paisa       INT8 NOT NULL DEFAULT 0,
    rider_payout_paisa      INT8 NOT NULL DEFAULT 0,
    vendor_payout_paisa     INT8 NOT NULL DEFAULT 0,
    platform_revenue_paisa  INT8 NOT NULL DEFAULT 0,

    -- Fare provenance, so an invoice can always explain itself.
    fare_source             STRING(16) NOT NULL DEFAULT 'BRAIN'
        CHECK (fare_source IN ('BRAIN','FALLBACK','ADMIN_OVERRIDE')),
    fare_trace_id           UUID,
    surge_bps               INT8 NOT NULL DEFAULT 10000,
    weather_condition       STRING(16) NOT NULL DEFAULT 'CLEAR',
    route_distance_m        INT8,
    route_duration_s        INT8,
    traffic_delay_s         INT8 NOT NULL DEFAULT 0,
    distance_source         STRING(16) NOT NULL DEFAULT 'OSRM'
        CHECK (distance_source IN ('OSRM','ESTIMATED')),

    -- Timing
    placed_at               TIMESTAMPTZ,
    accepted_at             TIMESTAMPTZ,
    prep_time_s             INT8,
    prep_time_source        STRING(16) CHECK (prep_time_source IS NULL OR
                                prep_time_source IN ('SUGGESTED','VENDOR_SET','DEFAULT')),
    ready_at_estimate       TIMESTAMPTZ,
    assigned_at             TIMESTAMPTZ,
    picked_up_at            TIMESTAMPTZ,
    arrived_at              TIMESTAMPTZ,
    delivered_at            TIMESTAMPTZ,
    settled_at              TIMESTAMPTZ,
    eta_min_at_placement    TIMESTAMPTZ,
    eta_max_at_placement    TIMESTAMPTZ,

    rider_id                UUID REFERENCES riders(id),
    batch_id                UUID REFERENCES order_batches(id),

    customer_note           STRING(280),
    payment_method          STRING(16) NOT NULL DEFAULT 'COD' CHECK (payment_method = 'COD'),
    cash_collected_paisa    INT8,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    INDEX idx_orders_customer (customer_user_id, created_at DESC),
    INDEX idx_orders_vendor_state (vendor_id, state, created_at DESC),
    INDEX idx_orders_rider (rider_id, created_at DESC) WHERE rider_id IS NOT NULL,
    INDEX idx_orders_zone_live (zone_id, state) WHERE state NOT IN ('SETTLED','DRAFT'),
    INDEX idx_orders_code (code),
    INDEX idx_orders_settlement (zone_id, delivered_at) WHERE state = 'SETTLED'
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
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    seq             INT8        NOT NULL,
    from_state      STRING(24),
    to_state        STRING(24)  NOT NULL,
    actor_type      STRING(16)  NOT NULL
        CHECK (actor_type IN ('CUSTOMER','VENDOR','RIDER','ADMIN','SYSTEM')),
    actor_user_id   UUID REFERENCES users(id),
    reason_code     STRING(48),
    reason_text     STRING(512),
    metadata        JSONB       NOT NULL DEFAULT '{}'::JSONB,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

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

### 7.4 Offers and assignments

```sql
CREATE TABLE order_offers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    rider_id        UUID        NOT NULL REFERENCES riders(id),
    wave            INT2        NOT NULL,        -- cascade wave number, 1-based
    rank_in_wave    INT2        NOT NULL,
    score           FLOAT8      NOT NULL,        -- the dispatch score, for audit
    trace_id        UUID        NOT NULL,        -- links to brain_traces
    payout_paisa    INT8        NOT NULL,
    offered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    responded_at    TIMESTAMPTZ,
    response        STRING(16)
        CHECK (response IS NULL OR response IN ('ACCEPTED','REJECTED','EXPIRED','WITHDRAWN')),
    reject_reason   STRING(48),
    reject_note     STRING(280),

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
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        STRING(48) NOT NULL UNIQUE,
    kind        STRING(16) NOT NULL
        CHECK (kind IN ('ASSET','LIABILITY','REVENUE','EXPENSE','EQUITY')),
    owner_type  STRING(16) NOT NULL
        CHECK (owner_type IN ('PLATFORM','VENDOR','RIDER','CUSTOMER')),
    owner_id    UUID,
    currency    STRING(3)  NOT NULL DEFAULT 'BDT',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE INDEX uq_ledger_owner (owner_type, owner_id, code)
);

CREATE TABLE ledger_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_type      STRING(48)  NOT NULL,   -- 'ORDER_DELIVERED', 'PAYOUT_PAID', ...
    order_id        UUID REFERENCES orders(id),
    invoice_id      UUID,
    settlement_id   UUID,
    description     STRING(256) NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID REFERENCES users(id),
    reverses_id     UUID REFERENCES ledger_entries(id),

    INDEX idx_entries_order (order_id),
    INDEX idx_entries_occurred (occurred_at)
);

CREATE TABLE ledger_postings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id    UUID NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
    account_id  UUID NOT NULL REFERENCES ledger_accounts(id),
    amount_paisa INT8 NOT NULL,             -- signed: debit positive, credit negative
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

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
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_type      STRING(8)  NOT NULL CHECK (party_type IN ('VENDOR','RIDER')),
    iso_year        INT2       NOT NULL,
    iso_week        INT2       NOT NULL CHECK (iso_week BETWEEN 1 AND 53),
    window_start    TIMESTAMPTZ NOT NULL,   -- Asia/Dhaka boundaries, stored as UTC
    window_end      TIMESTAMPTZ NOT NULL,
    generate_after  TIMESTAMPTZ NOT NULL,   -- Friday 00:00 Dhaka for riders, Saturday for vendors
    status          STRING(16) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','GENERATING','GENERATED','CLOSED')),
    generated_at    TIMESTAMPTZ,

    UNIQUE INDEX uq_period (party_type, iso_year, iso_week)
);

CREATE TABLE invoices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number              STRING(32) NOT NULL UNIQUE,    -- UND/V/2026/44/00017
    period_id           UUID NOT NULL REFERENCES payout_periods(id),
    party_type          STRING(8)  NOT NULL CHECK (party_type IN ('VENDOR','RIDER')),
    party_id            UUID NOT NULL,
    order_count         INT8 NOT NULL,
    gross_paisa         INT8 NOT NULL,
    commission_paisa    INT8 NOT NULL DEFAULT 0,
    tax_paisa           INT8 NOT NULL DEFAULT 0,
    discount_paisa      INT8 NOT NULL DEFAULT 0,
    campaign_paisa      INT8 NOT NULL DEFAULT 0,
    bonus_paisa         INT8 NOT NULL DEFAULT 0,
    penalty_paisa       INT8 NOT NULL DEFAULT 0,
    adjustment_paisa    INT8 NOT NULL DEFAULT 0,
    cash_offset_paisa   INT8 NOT NULL DEFAULT 0,       -- riders: cash already settled
    net_payable_paisa   INT8 NOT NULL,
    status              STRING(16) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','GENERATED','VERIFIED','PAID','DISPUTED','VOID')),
    pdf_url             STRING(512),
    pdf_bytes           INT8,
    content_hash        BYTES NOT NULL,                -- SHA-256 of the canonical line set
    verified_by         UUID REFERENCES users(id),
    verified_at         TIMESTAMPTZ,
    paid_by             UUID REFERENCES users(id),
    paid_at             TIMESTAMPTZ,
    paid_method         STRING(16),
    paid_reference      STRING(64),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

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
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id   UUID REFERENCES users(id),
    actor_type      STRING(16)  NOT NULL,
    action          STRING(64)  NOT NULL,       -- 'vendor.commission.update'
    resource_type   STRING(48)  NOT NULL,
    resource_id     UUID,
    before          JSONB,
    after           JSONB,
    delta           JSONB,                      -- computed diff, for fast rendering
    ip              STRING(45)  NOT NULL,
    user_agent      STRING(512),
    request_id      STRING(64)  NOT NULL,
    zone_id         UUID REFERENCES zones(id),
    risk            STRING(8)   NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

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
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            STRING(16) NOT NULL
        CHECK (kind IN ('FARE','DISPATCH','BATCH','RANK','FORECAST','PREPTIME')),
    order_id        UUID REFERENCES orders(id),
    zone_id         UUID REFERENCES zones(id),
    inputs          JSONB NOT NULL,
    features        JSONB NOT NULL,
    intermediates   JSONB NOT NULL,
    output          JSONB NOT NULL,
    engine_version  STRING(16) NOT NULL,
    duration_ms     INT8 NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

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
3. **Online.** No statement may take an exclusive lock on a large table. CockroachDB's schema
   changes are online by default; the check is that no migration does `ALTER TABLE ... SET NOT NULL`
   on a populated column without a preceding backfill migration.
4. **Applied by Actions.** `.github/workflows/migrate.yml` connects with the `COCKROACH_DATABASE_URL`
   secret, reads `schema_migrations`, and applies what is missing inside a transaction per file.
5. **Verified.** After applying, the workflow runs `scripts/db/verify_schema.py`, which compares the
   live schema against `docs/schema/expected.json` (generated from this document) and fails on
   drift.

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     STRING(16) PRIMARY KEY,
    checksum    BYTES       NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_by  STRING(128) NOT NULL          -- the Actions run URL
);
```

`checksum` means an edited migration file that has already been applied is detected and refused,
which is the single most common way a team corrupts a schema.

---

## 11. Query patterns

The five hot queries, with their indexes:

### 11.1 Nearby open vendors

```sql
SELECT v.id, v.name, v.cover_url, v.logo_url, v.open_state,
       ST_Distance(v.point, $1::GEOGRAPHY) AS distance_m,
       vs.rating_avg, vs.rating_count, vs.prep_time_p50_s, vs.accept_rate
FROM vendors v
JOIN vendor_stats vs ON vs.vendor_id = v.id
WHERE v.deleted_at IS NULL
  AND v.status = 'APPROVED'
  AND v.zone_id = $2
  AND ST_DWithin(v.point, $1::GEOGRAPHY, $3)
ORDER BY distance_m
LIMIT 200;
```

Uses `idx_vendors_zone_status` for the equality predicates and `idx_vendors_point` for the spatial
filter. The 200-row cap is deliberate: the Brain re-ranks within the candidate set, and ranking more
than 200 vendors in one zone is not a situation that improves the result.

### 11.2 A vendor's live order board

```sql
SELECT o.*, (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
FROM orders o
WHERE o.vendor_id = $1
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
  AND s.zone_id = $1
  AND NOT EXISTS (
      SELECT 1 FROM rider_suspensions sus
      WHERE sus.rider_id = r.id AND sus.active AND sus.until > now()
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
WHERE o.vendor_id = $1
  AND o.state = 'SETTLED'
  AND o.delivered_at >= $2 AND o.delivered_at < $3
ORDER BY o.delivered_at;
```

Uses `idx_orders_settlement`. The half-open interval `[start, end)` is deliberate and is the single
most common source of double-counted or missing rows in weekly billing.

### 11.5 Live orders for the command map

```sql
SELECT o.id, o.code, o.state, o.vendor_id, o.rider_id, o.zone_id,
       ST_AsGeoJSON(o.pickup_point) AS pickup,
       ST_AsGeoJSON(o.delivery_point) AS dropoff,
       o.placed_at, o.ready_at_estimate
FROM orders o
WHERE o.zone_id = ANY($1)
  AND o.state IN ('PLACED','ACCEPTED','RIDER_SEARCH','RIDER_ASSIGNED','PICKED_UP','ARRIVED');
```

Uses `idx_orders_zone_live`, a partial index that stays small because settled orders fall out of it.

---

## 12. Scaling considerations

| Concern | Mitigation |
| --- | --- |
| UUID v7 primary keys create a write hotspot on the latest range | Accepted. CockroachDB splits ranges automatically, and Undal's write rate (≈12 orders/minute at 500/day peak) is three orders of magnitude below the point where this matters. The read benefit of time-ordered keys is realised today; the write cost is theoretical. |
| `orders` grows unboundedly | At 500 orders/day the table reaches ~180 k rows/year, ~400 MB with items. The 10 GiB free tier holds ~20 years. No partitioning needed. |
| `order_state_events` grows ~8× faster | ~1.5 M rows/year, ~300 MB. Still fine. Events older than 2 years for `SETTLED` orders are archived to a compressed JSONB column on the order and deleted, by a request-triggered sweep. |
| `brain_traces` is the largest table by bytes | Retention policy (§9) caps it at ~2 GB. |
| `ops_logs` sampling | 1% of successes, 100% of errors, 7-day retention, hard row cap of 2 M enforced by the sweep. |
| Spatial index selectivity | Zone equality is checked before the spatial predicate, so the GIN index operates on a few hundred rows, not the whole table. |
| Read amplification from `vendor_stats` joins | `vendor_stats` is a narrow table updated by the post-order effect, so it stays in cache. |

---

## 13. Reading on

Next: [`07-d1-live-tracking.md`](07-d1-live-tracking.md) — the ephemeral channel.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
