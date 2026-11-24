-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- Payouts waiting to be sent, oldest first.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT `id`, `payee_kind`, `amount_paisa`, `method`, `status`, `attempt_count`, `created_at`
FROM `payout_transactions`
WHERE `status` IN ('QUEUED','FAILED')
ORDER BY `created_at`;
