-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- Which zones are live right now, and how big is each one's catalogue?
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT z.`id`, z.`name_en`, z.`status`,
       COUNT(DISTINCT v.`id`) AS vendors
FROM `zones` z
LEFT JOIN `vendors` v ON v.`zone_id` = z.`id` AND v.`status` = 'APPROVED' AND v.`deleted_at` IS NULL
WHERE z.`status` = 'ACTIVE'
GROUP BY z.`id`, z.`name_en`, z.`status`
ORDER BY vendors DESC;
