-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- Any ledger entry whose postings do not sum to zero. Must always be empty.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT e.`id`, e.`entry_type`, SUM(p.`amount_paisa`) AS sum_paisa
FROM `ledger_entries` e
JOIN `ledger_postings` p ON p.`entry_id` = e.`id`
GROUP BY e.`id`, e.`entry_type`
HAVING SUM(p.`amount_paisa`) <> 0;
