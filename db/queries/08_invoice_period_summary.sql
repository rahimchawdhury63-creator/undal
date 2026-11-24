-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- What a payout period looks like before it is generated.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT `period_id`, `party_type`, COUNT(*) AS parties,
       SUM(`gross_paisa`) AS gross_paisa, SUM(`net_payable_paisa`) AS net_paisa
FROM `invoices`
GROUP BY `period_id`, `party_type`
ORDER BY `period_id` DESC;
