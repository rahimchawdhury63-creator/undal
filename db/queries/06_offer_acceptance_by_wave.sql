-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- How each dispatch wave converts, the number the wave sizer is tuned against.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT `wave`, COUNT(*) AS offers, SUM(`state` = 'ACCEPTED') AS accepted
FROM `order_offers`
WHERE `offered_at` >= NOW() - INTERVAL 1 DAY
GROUP BY `wave`
ORDER BY `wave`;
