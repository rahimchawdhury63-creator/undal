--
-- Undal — a settlement under review, and the rider who must not wait for it. Licensed under PASVL-1.0.
--
-- `25 §6.1` names four decisions and the fourth is the one the others exist to avoid: **escalate**. "Routes to a senior
-- reviewer; the rider is released from the block and told a human is looking into it — because an escalation is the
-- platform's problem, not the rider's." That sentence needs three facts the table could not hold: whether the claim was
-- escalated, when, and by whom.
--
-- The claim stays `PENDING`. An escalation is not a verdict — nobody has decided whether the money arrived — so
-- `status` is untouched and the settlement is still waiting for the decision the queue lists it under. What changes is
-- `escalated_at`: from that instant the rider is not blocked (`routes/cash.ts` computes the lift, the same way D142's
-- two-hour rule is computed), and the debt stays on the books as outstanding rather than being written off. Releasing a
-- rider is not forgiving a debt, and this build has no route that forgives one.
--
-- `escalated_by` is the admin who made the call and `escalation_note` is why, bounded at the same 280 characters as a
-- rejection note. The note is not decoration: the next reviewer reads it to know whether the claim is waiting on a bank
-- statement, a phone call, or a police report, and the audit row alone does not survive a shift handover as well as a
-- sentence on the claim itself.

ALTER TABLE `rider_cash_settlements`
    ADD COLUMN `escalated_at` DATETIME(6) NULL AFTER `rejection_note`,
    ADD COLUMN `escalated_by` BINARY(16) NULL AFTER `escalated_at`,
    ADD COLUMN `escalation_note` VARCHAR(280) NULL AFTER `escalated_by`;
