-- Undal — 007 dispatch.sql
-- Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
--
-- Statement-level idempotent: every statement carries IF NOT EXISTS, so TiDB's
-- auto-committing DDL can be re-run after a failure without a rollback story.
-- Applied in filename order; recorded in `schema_migrations`.
--
-- Offers, assignments and batches: the rows a dispatcher reads at 60 orders a minute.

CREATE TABLE IF NOT EXISTS `order_offers` (
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
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `order_assignments` (
  `id`          BINARY(16)  NOT NULL,
  `order_id`    BINARY(16)  NOT NULL,
  `rider_id`    BINARY(16)  NOT NULL REFERENCES riders(id),
  `assigned_at` DATETIME(6) NOT NULL,
  `ended_at`    DATETIME(6)     NULL,
  `end_reason`  VARCHAR(24)     NULL CHECK (`end_reason` IN ('DELIVERED','REASSIGNED','CANCELLED','ABANDONED')),
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_assignments_order` (`order_id`, `ended_at`),
  KEY `idx_assignments_rider` (`rider_id`, `ended_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `order_batches` (
  `id`           BINARY(16)  NOT NULL,
  `rider_id`     BINARY(16)  NOT NULL REFERENCES riders(id),
  `zone_id`      BINARY(16)  NOT NULL REFERENCES zones(id),
  `state`        VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (`state` IN ('OPEN','DISPATCHED','COMPLETED','CANCELLED')),
  `max_members`  TINYINT     NOT NULL DEFAULT 3 CHECK (`max_members` BETWEEN 1 AND 5),
  `opened_at`    DATETIME(6) NOT NULL,
  `closed_at`    DATETIME(6)     NULL,
  `created_at`   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_batches_rider_state` (`rider_id`, `state`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `order_batch_members` (
  `id`         BINARY(16)  NOT NULL,
  `batch_id`   BINARY(16)  NOT NULL REFERENCES order_batches(id),
  `order_id`   BINARY(16)  NOT NULL,
  `pickup_seq` INT         NOT NULL DEFAULT 1,
  `added_at`   DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_batch_member_order` (`batch_id`, `order_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `dispatch_locks` (
  `id`         BINARY(16)  NOT NULL,
  `order_id`   BINARY(16)  NOT NULL,
  `holder`     VARCHAR(64) NOT NULL,   -- coordinator instance id, not a session id
  `expires_at` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dispatch_lock_order` (`order_id`),
  KEY `idx_dispatch_lock_expiry` (`expires_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `weather_observations` (
  `id`            BINARY(16)  NOT NULL,
  `observed_at`   DATETIME(6) NOT NULL,
  `zone_id`       BINARY(16)      NULL,
  `condition`     VARCHAR(32) NOT NULL CHECK (`condition` IN ('CLEAR','CLOUDY','RAIN','HEAVY_RAIN','STORM','FOG','HEAT_WAVE')),
  `precip_mm`     INT         NOT NULL DEFAULT 0,
  `temp_c_x10`    INT         NOT NULL DEFAULT 0,
  `surge_multiplier_bps` INT  NOT NULL DEFAULT 10000,
  `source`        VARCHAR(32) NOT NULL,
  `created_at`    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_weather_zone_time` (`zone_id`, `observed_at` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
