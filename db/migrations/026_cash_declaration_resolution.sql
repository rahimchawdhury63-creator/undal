--
-- Undal — how a case ends. Licensed under PASVL-1.0.
--
-- D154 gave a reviewer a list of the declarations `25 §7` opens, and every one of them was a dead end: a robbery could be
-- read and not closed, and a dispute could be answered only by approving or rejecting a *settlement*, neither of which
-- says "the rider was right and our arithmetic was wrong".
--
-- These three columns are that ending. `resolved_at` is when a human finished with the case, `resolved_by` is who, and
-- `resolution_note` is what they did about it — the sentence the next reviewer reads instead of reopening a closed
-- argument. A declaration is resolved by writing off the amount in dispute (`POST /v1/finance/cash/riders/{id}/write-off`,
-- D155), which is also why the columns sit on the declaration rather than in a case table: the adjustment is the ending,
-- and the ledger entry is where the money moved.
--
-- Nullable, and null means "still open" rather than "closed silently". A declaration written before this migration is
-- open, which is the safe reading — an unclosed dispute is a thing to look at, and a closed one is not.
--
-- The declaration's `kind` and `routed_to_review` stay as they were: resolving a case does not rewrite what the rider
-- said or whether it ever reached a queue, and a reviewer's decision must never look like the rider's claim.

ALTER TABLE `rider_cash_declarations`
    ADD COLUMN `resolved_at` DATETIME(6) NULL AFTER `snapshot_difference_paisa`,
    ADD COLUMN `resolved_by` BINARY(16) NULL AFTER `resolved_at`,
    ADD COLUMN `resolution_note` VARCHAR(280) NULL AFTER `resolved_by`;
