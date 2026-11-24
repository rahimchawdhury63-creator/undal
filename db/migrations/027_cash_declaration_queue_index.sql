--
-- Undal — the index the declarations queue reads through, once it learned to filter. Licensed under PASVL-1.0.
--
-- `023` created `idx_cash_declaration_review` for the one query the queue ran: `routed_to_review = 1 ORDER BY
-- created_at DESC`. D155 then gave a case an ending (`resolved_at`) and D157 taught the queue to ask about it, and
-- neither column was in that index. The morning's list is the open cases, so the statement is now
-- `resolved_at IS NULL AND routed_to_review = 1 [AND kind = ?] ORDER BY created_at DESC` — and a queue that scanned
-- every declaration a rider has ever made to answer it would get slower every month, in exactly the place where
-- slowness costs a robbery victim a call back.
--
-- The column order follows the statement. `resolved_at` first because the open cases are the tiny partition and the
-- equality on NULL is the first thing the planner can use; `routed_to_review` next, for the same reason; `created_at
-- DESC` last, so the sort is read rather than performed. `kind` is deliberately *not* in this index: it is a filter a
-- reviewer applies occasionally, and four kind-prefixed copies of the same index would be paid for by every write to
-- the table to save one sort on a screen that already returns a page of fifty.
--
-- The old index stays. `resolved_at IS NOT NULL` — the "handled" half of the queue — is served by the new one, and the
-- audit and the cooldown in `§7` ("limited to once per 30 days") read the table by rider, not by review state.

ALTER TABLE `rider_cash_declarations`
    ADD INDEX `idx_cash_declaration_queue` (`resolved_at`, `routed_to_review`, `created_at` DESC);
