-- Undal — 008 ledger.sql
-- Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
--
-- Statement-level idempotent: every statement carries IF NOT EXISTS, so TiDB's
-- auto-committing DDL can be re-run after a failure without a rollback story.
-- Applied in filename order; recorded in `schema_migrations`.
--
-- Double-entry money. Every posting set closes to zero; the one floor adjustment is recorded, not lost.

CREATE TABLE IF NOT EXISTS `ledger_accounts` (
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
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `ledger_entries` (
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
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `ledger_postings` (
    id          BINARY(16) PRIMARY KEY,
    entry_id    BINARY(16) NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
    account_id  BINARY(16) NOT NULL REFERENCES ledger_accounts(id),
    amount_paisa BIGINT NOT NULL,             -- signed: debit positive, credit negative
    created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX idx_postings_entry (entry_id),
    INDEX idx_postings_account (account_id, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `platform_config` (
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

CREATE TABLE IF NOT EXISTS `rounding_adjustments` (
  `id`             BINARY(16)  NOT NULL,
  `order_id`       BINARY(16)      NULL,
  `payout_period_id` BINARY(16)    NULL,
  `raw_paisa`      BIGINT      NOT NULL,   -- before the single floor
  `floored_paisa`  BIGINT      NOT NULL,   -- what the customer actually pays
  `delta_paisa`    BIGINT      NOT NULL CHECK (`delta_paisa` <= 0 AND `delta_paisa` > -100),
  `created_at`     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_rounding_order` (`order_id`),
  KEY `idx_rounding_period` (`payout_period_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `tax_records` (
  `id`             BINARY(16)  NOT NULL,
  `order_id`       BINARY(16)  NOT NULL,
  `tax_kind`       VARCHAR(16) NOT NULL CHECK (`tax_kind` IN ('VAT','AIT')),
  `taxable_paisa`  BIGINT      NOT NULL CHECK (`taxable_paisa` >= 0),
  `rate_bps`       INT         NOT NULL CHECK (`rate_bps` >= 0),
  `amount_paisa`   BIGINT      NOT NULL CHECK (`amount_paisa` >= 0),
  `period`         VARCHAR(7)  NOT NULL,   -- '2026-11'
  `created_at`     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_tax_records_order` (`order_id`),
  KEY `idx_tax_records_period` (`period`, `tax_kind`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `config_audit` (
  `id`           BINARY(16)   NOT NULL,
  `key`          VARCHAR(120) NOT NULL,
  `zone_id`      BINARY(16)   NOT NULL DEFAULT 0x00000000000000000000000000000000,
  `before_value` JSON             NULL,
  `after_value`  JSON         NOT NULL,
  `effective_at` DATETIME(6)  NOT NULL,
  `actor_id`     BINARY(16)   NOT NULL,
  `reason`       VARCHAR(255) NOT NULL,
  `created_at`   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_config_audit_key` (`key`, `created_at` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
