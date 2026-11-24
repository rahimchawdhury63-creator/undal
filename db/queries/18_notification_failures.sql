-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- Push and SMS that did not land, grouped by kind.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT `channel`, `kind`, `outcome`, COUNT(*) AS n
FROM `notification_log`
WHERE `created_at` >= NOW() - INTERVAL 1 DAY AND `outcome` <> 'DELIVERED'
GROUP BY `channel`, `kind`, `outcome`
ORDER BY n DESC;
