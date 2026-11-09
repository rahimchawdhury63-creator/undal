-- Undal — durable operation identities for future transactional cash writes.
-- Licensed under PASVL-1.0. This table does not enable any cash-write route.
-- The unique key arbitrates retries for one actor and action; request_hash includes
-- the target and canonical business input. A complete receipt and the money writes
-- must commit in the same transaction. No expiry or automatic deletion is defined.
CREATE TABLE IF NOT EXISTS `cash_financial_operations` (
    `id`               BINARY(16) NOT NULL,
    `actor_user_id`    BINARY(16) NOT NULL,
    `action`           VARCHAR(32) NOT NULL,
    `key_hash`         BINARY(32) NOT NULL,
    `request_hash`     BINARY(32) NOT NULL,
    `target_id`        BINARY(16) NOT NULL,
    `ledger_entry_id`  BINARY(16) NULL,
    `response_json`    JSON NULL,
    `created_at`       DATETIME(6) NOT NULL,
    `completed_at`     DATETIME(6) NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_cash_financial_operation_key` (`actor_user_id`, `action`, `key_hash`),
    KEY `idx_cash_financial_operation_target` (`target_id`, `created_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
