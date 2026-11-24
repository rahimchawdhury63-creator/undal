-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- Rejection rate per vendor, the number that drives the ranking penalty.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT v.`id`, v.`name_en`, s.`orders_completed`, s.`orders_rejected`,
       ROUND(100 * s.`orders_rejected` / NULLIF(s.`orders_completed` + s.`orders_rejected`, 0), 2) AS reject_pct
FROM `vendor_stats` s
JOIN `vendors` v ON v.`id` = s.`vendor_id`
WHERE s.`stat_date` >= CURDATE() - INTERVAL 7 DAY
ORDER BY reject_pct DESC;
