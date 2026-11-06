--
-- Undal — a settlement for less than the balance, on purpose. Licensed under PASVL-1.0.
--
-- `25 §7`'s fourth button is "I'll settle part of it now", and its promise is the one path in that section that does not
-- need a human: "The rider settles what they can; the remainder stays in `RIDER_CASH`; the rider can go online with a
-- reduced cash limit equal to their remaining headroom."
--
-- The platform could already *record* a claim smaller than the balance — `amount_paisa` has no lower bound — but
-- `POST /rider/cash/settle` refuses one with `CASH_UNDERPAYMENT`, and that refusal is right for the ordinary case: a
-- rider who typed ৳1 140 instead of ৳2 140 has made a mistake, and accepting the smaller figure would silently forgive a
-- thousand taka. So the difference between a typo and a choice has to be visible, which is what this column is.
--
-- `is_partial` is set only when the rider says so (`partial: true` in the body). It is not derivable from the numbers:
-- `amount_paisa < outstanding_paisa` is true both of a deliberate part-payment and of a mistyped full one, and the whole
-- point of the column is that those two need different answers. The reviewer's queue shows it, the approval uses it to
-- decide whether to lift the block, and the audit row records it.
--
-- A partial claim that a reviewer approves releases the rider (`§7` promises they may go online), and the remainder stays
-- outstanding for the weekly invoice gate to collect. Defaulted to 0 so every existing row reads as a full settlement,
-- which is what it was.

ALTER TABLE `rider_cash_settlements`
    ADD COLUMN `is_partial` TINYINT(1) NOT NULL DEFAULT 0 AFTER `approved_paisa`;
