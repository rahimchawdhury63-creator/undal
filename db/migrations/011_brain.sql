-- Undal — 011 brain.sql
-- Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
--
-- Statement-level idempotent: every statement carries IF NOT EXISTS, so TiDB's
-- auto-committing DDL can be re-run after a failure without a rollback story.
-- Applied in filename order; recorded in `schema_migrations`.
--
-- Observability, the audit chain and the locks that replace advisory locks.

CREATE TABLE IF NOT EXISTS `audit_log` (
  id            BINARY(16) PRIMARY KEY,           -- application-generated UUIDv7
  seq           BIGINT NOT NULL,                  -- monotonic, gapless
  occurred_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  actor_id      BINARY(16),
  actor_type    VARCHAR(16) NOT NULL,             -- ADMIN|VENDOR|RIDER|CUSTOMER|SYSTEM
  actor_role    VARCHAR(48),
  ip            VARBINARY(16),                    -- INET6_ATON; holds IPv4 and IPv6 alike
  user_agent    VARCHAR(512),
  request_id    BINARY(16) NOT NULL,
  action        VARCHAR(64) NOT NULL,
  resource_type VARCHAR(48) NOT NULL,
  resource_id   VARCHAR(64),
  subject_id    BINARY(16),                       -- whose data was affected
  `before`      JSON,
  `after`       JSON,
  reason        VARCHAR(512),
  severity      VARCHAR(8) NOT NULL,              -- INFO|NOTICE|WARNING|CRITICAL
  prev_hash     BINARY(32),
  hash          BINARY(32) NOT NULL,

  UNIQUE INDEX uq_audit_seq (seq),
  INDEX idx_audit_actor (actor_id, occurred_at),
  INDEX idx_audit_resource (resource_type, resource_id, occurred_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `audit_verifications` (
  id          BINARY(16) PRIMARY KEY,
  ran_at      DATETIME(6) NOT NULL,
  from_seq    BIGINT NOT NULL,
  to_seq      BIGINT NOT NULL,
  result      VARCHAR(16) NOT NULL,      -- OK | BREAK | ERROR
  break_seq   BIGINT NULL,
  duration_ms INT NOT NULL,
  trigger_by  VARCHAR(16) NOT NULL,      -- DEPLOY | ADMIN | NIGHTLY
  INDEX idx_audit_ver_ran (ran_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `brain_traces` (
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
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `ops_errors` (
  `id`          BINARY(16)  NOT NULL,
  `request_id`  VARCHAR(64) NOT NULL,
  `worker`      VARCHAR(32) NOT NULL,
  `route`       VARCHAR(160) NOT NULL,
  `code`        VARCHAR(48) NOT NULL,
  `status`      INT         NOT NULL,
  `fingerprint` BINARY(32)  NOT NULL,
  `detail`      JSON            NULL,
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_ops_errors_fingerprint` (`fingerprint`, `created_at` DESC),
  KEY `idx_ops_errors_request` (`request_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `ops_metrics` (
  `id`          BINARY(16)  NOT NULL,
  `metric`      VARCHAR(64) NOT NULL,
  `bucket_start` DATETIME(6) NOT NULL,
  `bucket_seconds` INT      NOT NULL DEFAULT 60,
  `value_x1000` BIGINT      NOT NULL,
  `labels`      JSON            NULL,
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ops_metric_bucket` (`metric`, `bucket_start`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `ops_logs` (
  `id`          BINARY(16)  NOT NULL,
  `level`       VARCHAR(8)  NOT NULL CHECK (`level` IN ('DEBUG','INFO','WARN','ERROR')),
  `worker`      VARCHAR(32) NOT NULL,
  `request_id`  VARCHAR(64)     NULL,
  `message`     VARCHAR(1000) NOT NULL,
  `fields`      JSON            NULL,
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_ops_logs_time` (`created_at` DESC),
  KEY `idx_ops_logs_request` (`request_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `effect_dead_letters` (
  `id`           BINARY(16)  NOT NULL,
  `effect_kind`  VARCHAR(32) NOT NULL,
  `entity_id`    BINARY(16)  NOT NULL,
  `payload`      JSON        NOT NULL,
  `attempts`     INT         NOT NULL DEFAULT 0,
  `last_error`   VARCHAR(500)    NULL,
  `status`       VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (`status` IN ('PENDING','REPLAYED','ABANDONED')),
  `next_attempt_at` DATETIME(6) NULL,
  `created_at`   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_dead_letters_retry` (`status`, `next_attempt_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `generation_locks` (
  `id`          BINARY(16)  NOT NULL,
  `lock_key`    VARCHAR(80) NOT NULL,
  `holder`      VARCHAR(64) NOT NULL,
  `lease_until` DATETIME(6) NOT NULL,
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_generation_lock_key` (`lock_key`),
  KEY `idx_generation_lock_lease` (`lease_until`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
