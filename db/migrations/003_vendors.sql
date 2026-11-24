-- Undal — 003 vendors.sql
-- Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
--
-- Statement-level idempotent: every statement carries IF NOT EXISTS, so TiDB's
-- auto-committing DDL can be re-run after a failure without a rollback story.
-- Applied in filename order; recorded in `schema_migrations`.
--
-- Vendors own menus, hours and bank accounts. A vendor cannot be approved without a verified trade licence.

CREATE TABLE IF NOT EXISTS `vendors` (
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
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `vendor_profiles` (
  `id`                BINARY(16)   NOT NULL,
  `vendor_id`         BINARY(16)   NOT NULL REFERENCES vendors(id),
  `about_en`          VARCHAR(500)     NULL,
  `about_bn`          VARCHAR(500)     NULL,
  `cuisine_en`        VARCHAR(120)     NULL,
  `cuisine_bn`        VARCHAR(120)     NULL,
  `cover_media_id`    BINARY(16)       NULL,
  `logo_media_id`     BINARY(16)       NULL,
  `avg_prep_minutes`  INT          NOT NULL DEFAULT 25 CHECK (`avg_prep_minutes` BETWEEN 5 AND 120),
  `created_at`        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_profiles_vendor` (`vendor_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `vendor_documents` (
  `id`            BINARY(16)   NOT NULL,
  `vendor_id`     BINARY(16)   NOT NULL REFERENCES vendors(id),
  `kind`          VARCHAR(24)  NOT NULL CHECK (`kind` IN ('TRADE_LICENSE','TIN_CERTIFICATE','NID','BANK_STATEMENT','FSSAI')),
  `media_id`      BINARY(16)   NOT NULL,
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'PENDING' CHECK (`status` IN ('PENDING','VERIFIED','REJECTED','EXPIRED')),
  `expires_on`    DATE             NULL,
  `reviewed_by`   BINARY(16)       NULL,
  `reviewed_at`   DATETIME(6)      NULL,
  `reject_reason` VARCHAR(255)     NULL,
  `created_at`    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_documents_vendor` (`vendor_id`, `kind`, `status`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `vendor_hours` (
  `id`         BINARY(16)  NOT NULL,
  `vendor_id`  BINARY(16)  NOT NULL REFERENCES vendors(id),
  `weekday`    TINYINT     NOT NULL CHECK (`weekday` BETWEEN 0 AND 6),
  `opens_at`   TIME        NOT NULL,
  `closes_at`  TIME        NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_hours` (`vendor_id`, `weekday`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `vendor_holidays` (
  `id`          BINARY(16)  NOT NULL,
  `vendor_id`   BINARY(16)  NOT NULL REFERENCES vendors(id),
  `holiday_date` DATE       NOT NULL,
  `reason`      VARCHAR(120)    NULL,
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_holiday` (`vendor_id`, `holiday_date`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `vendor_contacts` (
  `id`         BINARY(16)   NOT NULL,
  `vendor_id`  BINARY(16)   NOT NULL REFERENCES vendors(id),
  `name`       VARCHAR(80)  NOT NULL,
  `phone`      VARCHAR(20)  NOT NULL,
  `role`       VARCHAR(24)  NOT NULL DEFAULT 'OWNER' CHECK (`role` IN ('OWNER','MANAGER','KITCHEN','ACCOUNTS')),
  `is_primary` TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at` DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_contacts_vendor` (`vendor_id`, `is_primary` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `vendor_bank_accounts` (
  `id`             BINARY(16)   NOT NULL,
  `vendor_id`      BINARY(16)   NOT NULL REFERENCES vendors(id),
  `account_name`   VARCHAR(120) NOT NULL,
  `account_number` VARBINARY(255) NOT NULL,   -- encrypted: an account number is not a public key
  `bank_name`      VARCHAR(80)  NOT NULL,
  `branch`         VARCHAR(80)      NULL,
  `routing_number` VARCHAR(20)      NULL,
  `verified_at`    DATETIME(6)      NULL,
  `created_at`     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_bank_vendor` (`vendor_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `categories` (
  `id`          BINARY(16)   NOT NULL,
  `slug`        VARCHAR(60)  NOT NULL,
  `name_en`     VARCHAR(80)  NOT NULL,
  `name_bn`     VARCHAR(80)  NOT NULL,
  `icon_media_id` BINARY(16)     NULL,
  `sort_order`  INT          NOT NULL DEFAULT 0,
  `active`      TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categories_slug` (`slug`),
  KEY `idx_categories_active_order` (`active`, `sort_order`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `vendor_stats` (
  `id`                  BINARY(16)  NOT NULL,
  `vendor_id`           BINARY(16)  NOT NULL REFERENCES vendors(id),
  `stat_date`           DATE        NOT NULL,
  `orders_completed`    INT         NOT NULL DEFAULT 0 CHECK (`orders_completed` >= 0),
  `orders_rejected`     INT         NOT NULL DEFAULT 0 CHECK (`orders_rejected` >= 0),
  `gmv_paisa`           BIGINT      NOT NULL DEFAULT 0 CHECK (`gmv_paisa` >= 0),
  `avg_prep_minutes`    INT         NOT NULL DEFAULT 0,
  `rating_sum`          BIGINT      NOT NULL DEFAULT 0,
  `rating_count`        INT         NOT NULL DEFAULT 0,
  `created_at`          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_stats_day` (`vendor_id`, `stat_date`),
  KEY `idx_vendor_stats_date` (`stat_date`, `gmv_paisa` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `vendor_pause_log` (
  `id`          BINARY(16)  NOT NULL,
  `vendor_id`   BINARY(16)  NOT NULL REFERENCES vendors(id),
  `paused_at`   DATETIME(6) NOT NULL,
  `resumes_at`  DATETIME(6)     NULL,
  `reason`      VARCHAR(120) NOT NULL CHECK (`reason` IN ('KITCHEN_BACKLOG','STAFF_SHORTAGE','ITEM_UNAVAILABLE','CLOSING','MANUAL')),
  `actor_id`    BINARY(16)      NULL,
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_pause_vendor_time` (`vendor_id`, `paused_at` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `vendor_commission_overrides` (
  `id`            BINARY(16)  NOT NULL,
  `vendor_id`     BINARY(16)  NOT NULL REFERENCES vendors(id),
  `commission_bps` INT        NOT NULL CHECK (`commission_bps` BETWEEN 0 AND 3000),
  `effective_from` DATETIME(6) NOT NULL,
  `effective_to`   DATETIME(6)     NULL,
  `reason`        VARCHAR(255) NOT NULL,   -- a rate change without a reason is unauditable
  `created_by`    BINARY(16)  NOT NULL,
  `created_at`    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_commission_override_vendor` (`vendor_id`, `effective_from` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `vendor_categories` (
  `id`         BINARY(16)  NOT NULL,
  `vendor_id`  BINARY(16)  NOT NULL REFERENCES vendors(id),
  `category_id` BINARY(16) NOT NULL REFERENCES categories(id),
  `is_primary` TINYINT(1)  NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_category` (`vendor_id`, `category_id`),
  KEY `idx_vendor_categories_category` (`category_id`, `is_primary` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
