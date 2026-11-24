-- Undal — 005 riders.sql
-- Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
--
-- Statement-level idempotent: every statement carries IF NOT EXISTS, so TiDB's
-- auto-committing DDL can be re-run after a failure without a rollback story.
-- Applied in filename order; recorded in `schema_migrations`.
--
-- Riders, their documents, their shifts and the cash they carry.

CREATE TABLE IF NOT EXISTS `riders` (
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
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `rider_shifts` (
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
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `rider_profiles` (
  `id`             BINARY(16)  NOT NULL,
  `rider_id`       BINARY(16)  NOT NULL REFERENCES riders(id),
  `full_name`      VARCHAR(120) NOT NULL,
  `full_name_bn`   VARCHAR(120)     NULL,
  `date_of_birth`  DATE             NULL,
  `photo_media_id` BINARY(16)       NULL,
  `blood_group`    VARCHAR(4)       NULL,
  `emergency_name` VARCHAR(80)      NULL,
  `emergency_phone` VARCHAR(20)     NULL,
  `created_at`     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rider_profiles_rider` (`rider_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `rider_documents` (
  `id`            BINARY(16)  NOT NULL,
  `rider_id`      BINARY(16)  NOT NULL REFERENCES riders(id),
  `kind`          VARCHAR(24) NOT NULL CHECK (`kind` IN ('NID_FRONT','NID_BACK','DRIVING_LICENSE','VEHICLE_REGISTRATION','SELFIE','POLICE_CLEARANCE')),
  `media_id`      BINARY(16)  NOT NULL,
  `status`        VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (`status` IN ('PENDING','VERIFIED','REJECTED','EXPIRED')),
  `expires_on`    DATE            NULL,
  `reviewed_by`   BINARY(16)      NULL,
  `reviewed_at`   DATETIME(6)     NULL,
  `reject_reason` VARCHAR(255)    NULL,
  `created_at`    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_rider_documents_rider` (`rider_id`, `kind`, `status`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `rider_vehicles` (
  `id`             BINARY(16)  NOT NULL,
  `rider_id`       BINARY(16)  NOT NULL REFERENCES riders(id),
  `vehicle_type`   VARCHAR(16) NOT NULL CHECK (`vehicle_type` IN ('MOTORCYCLE','BICYCLE','ON_FOOT')),
  `registration_no` VARCHAR(24)    NULL,
  `model`          VARCHAR(60)     NULL,
  `approved`       TINYINT(1)  NOT NULL DEFAULT 0,
  `approved_at`    DATETIME(6)     NULL,
  `retired_at`     DATETIME(6)     NULL,
  `created_at`     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_rider_vehicles_rider` (`rider_id`, `approved`, `retired_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `rider_shift_selfies` (
  `id`         BINARY(16)  NOT NULL,
  `shift_id`   BINARY(16)  NOT NULL REFERENCES rider_shifts(id),
  `media_id`   BINARY(16)  NOT NULL,
  `taken_at`   DATETIME(6) NOT NULL,
  `lat_e7`     INT             NULL,
  `lon_e7`     INT             NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_shift_selfies_shift` (`shift_id`, `taken_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `rider_stats` (
  `id`                BINARY(16)  NOT NULL,
  `rider_id`          BINARY(16)  NOT NULL REFERENCES riders(id),
  `stat_date`         DATE        NOT NULL,
  `deliveries`        INT         NOT NULL DEFAULT 0 CHECK (`deliveries` >= 0),
  `offers_sent`       INT         NOT NULL DEFAULT 0,
  `offers_accepted`   INT         NOT NULL DEFAULT 0,
  `distance_m`        BIGINT      NOT NULL DEFAULT 0 CHECK (`distance_m` >= 0),
  `online_seconds`    INT         NOT NULL DEFAULT 0,
  `earnings_paisa`    BIGINT      NOT NULL DEFAULT 0 CHECK (`earnings_paisa` >= 0),
  `created_at`        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rider_stats_day` (`rider_id`, `stat_date`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `rider_penalties` (
  `id`            BINARY(16)  NOT NULL,
  `rider_id`      BINARY(16)  NOT NULL REFERENCES riders(id),
  `kind`          VARCHAR(32) NOT NULL CHECK (`kind` IN ('LATE_PICKUP','NO_ACCEPT','CASH_SHORT','CUSTOMER_COMPLAINT','PROOF_MISSING','OFF_ROUTE')),
  `order_id`      BINARY(16)      NULL,
  `amount_paisa`  BIGINT      NOT NULL DEFAULT 0 CHECK (`amount_paisa` >= 0),
  `notes`         VARCHAR(255)    NULL,
  `created_by`    BINARY(16)      NULL,
  `created_at`    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_rider_penalties_rider` (`rider_id`, `created_at` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `rider_suspensions` (
  `id`          BINARY(16)  NOT NULL,
  `rider_id`    BINARY(16)  NOT NULL REFERENCES riders(id),
  `reason`      VARCHAR(255) NOT NULL,
  `starts_at`   DATETIME(6) NOT NULL,
  `ends_at`     DATETIME(6)     NULL,
  `lifted_by`   BINARY(16)      NULL,
  `lifted_at`   DATETIME(6)     NULL,
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_rider_suspensions_rider` (`rider_id`, `starts_at` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `rider_cash_balances` (
  `id`               BINARY(16)  NOT NULL,
  `rider_id`         BINARY(16)  NOT NULL REFERENCES riders(id),
  `collected_paisa`  BIGINT      NOT NULL DEFAULT 0 CHECK (`collected_paisa` >= 0),
  `deposited_paisa`  BIGINT      NOT NULL DEFAULT 0 CHECK (`deposited_paisa` >= 0),
  `outstanding_paisa` BIGINT GENERATED ALWAYS AS (`collected_paisa` - `deposited_paisa`) STORED,
  `updated_at`       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_at`       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rider_cash_balance` (`rider_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `rider_cash_settlements` (
  `id`              BINARY(16)  NOT NULL,
  `rider_id`        BINARY(16)  NOT NULL REFERENCES riders(id),
  `shift_id`        BINARY(16)      NULL,
  `amount_paisa`    BIGINT      NOT NULL CHECK (`amount_paisa` >= 0),
  `method`          VARCHAR(16) NOT NULL CHECK (`method` IN ('BKASH','NAGAD','CASH_TO_OPS')),
  `trx_id`          VARCHAR(40)     NULL,
  `proof_media_id`  BINARY(16)      NULL,
  `status`          VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (`status` IN ('PENDING','CONFIRMED','REJECTED')),
  `confirmed_by`    BINARY(16)      NULL,
  `confirmed_at`    DATETIME(6)     NULL,
  `created_at`      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cash_settlement_trx` (`trx_id`),
  KEY `idx_cash_settlement_rider` (`rider_id`, `status`, `created_at` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `rider_zone_assignments` (
  `id`          BINARY(16)  NOT NULL,
  `rider_id`    BINARY(16)  NOT NULL REFERENCES riders(id),
  `zone_id`     BINARY(16)  NOT NULL REFERENCES zones(id),
  `assigned_at` DATETIME(6) NOT NULL,
  `ended_at`    DATETIME(6)     NULL,
  `created_by`  BINARY(16)      NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rider_zone_rider` (`rider_id`, `ended_at`),
  KEY `idx_rider_zone_zone` (`zone_id`, `ended_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
