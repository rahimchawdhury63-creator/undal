-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- Cash each rider still owes after a shift.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT r.`id`, r.`phone`, b.`collected_paisa`, b.`deposited_paisa`, b.`outstanding_paisa`
FROM `rider_cash_balances` b
JOIN `riders` r ON r.`id` = b.`rider_id`
WHERE b.`outstanding_paisa` > 0
ORDER BY b.`outstanding_paisa` DESC;
