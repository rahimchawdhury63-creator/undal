--
-- Undal — how much of a claim the platform actually accepted. Licensed under PASVL-1.0.
--
-- `25 §6.1`'s second decision is "approve a different amount": "For a partial or over-payment. Requires a reason. The
-- difference stays in `RIDER_CASH` and the rider is told clearly what remains." That sentence has three parts and the
-- table could hold none of them: `amount_paisa` is the rider's *claim*, `status` says whether anything was accepted, and
-- nothing recorded what was actually credited.
--
-- `approved_paisa` is that number. It differs from `amount_paisa` only when a reviewer accepted a partial payment — the
-- ordinary approval stores the same figure, so a reader never has to ask "was this one the full amount?" twice — and it
-- is what the ledger entry and the `deposited_paisa` credit are built from. Storing the claim beside the settlement is
-- what makes the rider's screen able to say "৳1 000 of ৳2 140 accepted, ৳1 140 still owed" instead of only "confirmed".
--
-- Nullable, and null means "this claim was not accepted at all": a rejected or escalated row has no approved amount,
-- and a `CONFIRMED` row written before this migration has none either. The reader treats null as "not stated" rather
-- than as zero, because a zero approval would read like the platform accepted nothing while releasing the rider.

ALTER TABLE `rider_cash_settlements`
    ADD COLUMN `approved_paisa` BIGINT NULL AFTER `amount_paisa`,
    ADD CONSTRAINT `chk_cash_settlement_approved` CHECK (`approved_paisa` IS NULL OR (`approved_paisa` >= 0 AND `approved_paisa` <= `amount_paisa`));
