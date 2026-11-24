--
-- Undal — the index the settlement queue reads once it can ask. Licensed under PASVL-1.0.
--
-- `005` gave this table `idx_cash_settlement_rider (rider_id, status, created_at DESC)`, built for the question support
-- asks — "what has this rider settled" — and it still answers that. It cannot answer the reviewer's, because the
-- reviewer does not know the rider: the queue is `WHERE status = 'PENDING' ORDER BY created_at ASC`, and with the
-- rider first in the index every page of it is a scan of the whole table plus a sort. The table grows by one row per
-- settlement attempt and never shrinks, so that sort gets slower every month in the one place where slowness means a
-- claim is auto-released (D142) before anybody reads it.
--
-- The column order is the statement's: the equality on `status` first, then the two columns the keyset cursor compares
-- and the sort reads. `ASC` is written out rather than left implicit — this queue's order is oldest-first on purpose
-- (the top of the list is the claim closest to the door, D145) and an index that disagreed with it would be a trap for
-- whoever reads the migration next.
--
-- `method`, `is_partial` and `rider_id` are filters, not keys (D158). They narrow a page that the first two columns have
-- already made small, and four index variants to save a residual filter on a queue of tens is paid for by every write.

ALTER TABLE `rider_cash_settlements`
    ADD INDEX `idx_cash_settlement_queue` (`status`, `created_at` ASC, `id` ASC);
