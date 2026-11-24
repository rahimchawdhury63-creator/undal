--
-- Undal — why a settlement was refused. Licensed under PASVL-1.0.
--
-- `25 §6.2` requires a rejection to carry a reason from a controlled list, and requires the rider
-- to see it: "the rider returns to the blocking screen with the specific reason displayed and a
-- correction path". The table has recorded `status = 'REJECTED'` since the first migration and the
-- audit log records the reason for the reviewer, but the rider cannot read the audit log — so the
-- one person the reason is *for* could not see it. These two columns are that sentence.
--
-- `rejection_reason` holds a code from `audit/reasons.ts`, not free text: the codes are what the
-- rider's screen translates into Bangla, what the review dashboard groups by, and what lets
-- "how many claims were refused for a reused transaction ID" be a query rather than an opinion.
-- `rejection_note` is the reviewer's own sentence, which `§6.2` also asks for and which no closed
-- list can replace — bounded at 280 characters so the rider's screen has a shape to lay out.
--
-- Both nullable: an approval has neither, and `status` is what decides which of the two verdicts a
-- row carries. A rejected row with a null reason is a row written by some path that did not go
-- through the review route, and it is better for the screen to show "refused, no reason recorded"
-- than for the column to invent one.

ALTER TABLE `rider_cash_settlements`
    ADD COLUMN `rejection_reason` VARCHAR(32) NULL AFTER `confirmed_at`,
    ADD COLUMN `rejection_note` VARCHAR(280) NULL AFTER `rejection_reason`;
