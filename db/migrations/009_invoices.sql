-- Undal — 009 invoices.sql
-- Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
--
-- Statement-level idempotent: every statement carries IF NOT EXISTS, so TiDB's
-- auto-committing DDL can be re-run after a failure without a rollback story.
-- Applied in filename order; recorded in `schema_migrations`.
--
-- Invoices and payout periods. Deterministic documents with a content hash, so a re-run is provable.

CREATE TABLE IF NOT EXISTS `payout_periods` (
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
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `payout_transactions` (
  `id`             BINARY(16)  NOT NULL,
  `payout_period_id` BINARY(16) NOT NULL REFERENCES payout_periods(id),
  `payee_kind`     VARCHAR(16) NOT NULL CHECK (`payee_kind` IN ('VENDOR','RIDER','PLATFORM')),
  `payee_id`       BINARY(16)      NULL,
  `amount_paisa`   BIGINT      NOT NULL CHECK (`amount_paisa` >= 0),
  `method`         VARCHAR(16) NOT NULL CHECK (`method` IN ('BKASH','NAGAD','BANK','CASH')),
  `destination`    VARBINARY(255)  NULL,   -- encrypted payout destination
  `reference`      VARCHAR(64)     NULL,   -- bKash trxID or bank reference
  `status`         VARCHAR(16) NOT NULL DEFAULT 'QUEUED' CHECK (`status` IN ('QUEUED','SENT','FAILED','REVERSED','PAID')),
  `attempt_count`  INT         NOT NULL DEFAULT 0,
  `last_error`     VARCHAR(255)    NULL,
  `sent_at`        DATETIME(6)     NULL,
  `created_at`     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payout_reference` (`reference`),
  KEY `idx_payout_period_status` (`payout_period_id`, `status`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `invoices` (
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
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `invoice_lines` (
  `id`           BINARY(16)   NOT NULL,
  `invoice_id`   BINARY(16)   NOT NULL REFERENCES invoices(id),
  `seq`          INT          NOT NULL,
  `kind`         VARCHAR(24)  NOT NULL CHECK (`kind` IN ('ORDER_COMMISSION','DELIVERY_MARGIN','SUBVENTION','PENALTY','ADJUSTMENT','TAX','PAYOUT')),
  `ref_order_id` BINARY(16)       NULL,
  `description_en` VARCHAR(200) NOT NULL,
  `description_bn` VARCHAR(200) NOT NULL,
  `amount_paisa` BIGINT       NOT NULL,   -- signed: a subvention is negative
  `created_at`   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoice_lines_seq` (`invoice_id`, `seq`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `invoice_documents` (
  `id`          BINARY(16)  NOT NULL,
  `invoice_id`  BINARY(16)  NOT NULL REFERENCES invoices(id),
  `media_id`    BINARY(16)      NULL,
  `content_hash` BINARY(32) NOT NULL,   -- SHA-256 of the PDF: determinism is provable
  `size_bytes`  INT         NOT NULL CHECK (`size_bytes` > 0 AND `size_bytes` <= 1048576),
  `storage`     VARCHAR(16) NOT NULL DEFAULT 'CLOUDINARY' CHECK (`storage` IN ('CLOUDINARY','IMGBB','D1')),
  `generated_at` DATETIME(6) NOT NULL,
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoice_document_hash` (`invoice_id`, `content_hash`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
