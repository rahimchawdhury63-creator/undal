--
-- Undal — what the rider was looking at when they said "I disagree". Licensed under PASVL-1.0.
--
-- `25 §7`'s third button: "A dispute is opened with the order list shown line by line; the block is lifted while the
-- dispute is open; the amount stays outstanding." The declaration table already holds the kind, the rider's sentence and
-- the lift; what it could not hold is the arithmetic the rider objected to.
--
-- It has to be a snapshot rather than a pointer. The delivery list is live: a rider who disputes ৳2 140 on Tuesday and
-- delivers four more cash orders on Wednesday has a breakdown that now adds up to something else, so a reviewer opening
-- the dispute on Thursday would be reading yesterday's argument against today's numbers — and concluding, reasonably,
-- that the rider was wrong. These two columns freeze what the platform claimed at the moment of the objection, which is
-- the only figure a dispute can be about.
--
-- `snapshot_lines_paisa` is the sum of the deliveries (`GET /v1/rider/cash/breakdown`'s `linesPaisa`, D150) and
-- `snapshot_difference_paisa` is the gap between that and the balance (`differencePaisa`) — the number that should be
-- zero and is the whole reason this button exists when it is not. Both nullable: an emergency or a robbery has no
-- arithmetic to record, and a null means "this declaration was not about a number" rather than zero.
--
-- No new status and no new table: a dispute is a declaration that lifts the block with no expiry and routes to a human,
-- which is exactly the shape a robbery already has. The difference between the two is what the reviewer reads, and these
-- two columns are the part of that difference which is a number.

ALTER TABLE `rider_cash_declarations`
    ADD COLUMN `snapshot_lines_paisa` BIGINT NULL AFTER `routed_to_review`,
    ADD COLUMN `snapshot_difference_paisa` BIGINT NULL AFTER `snapshot_lines_paisa`;
