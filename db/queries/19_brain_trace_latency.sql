-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- How long dispatch decisions actually take.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT `kind`, COUNT(*) AS n,
       ROUND(AVG(`duration_ms`), 1) AS avg_ms, MAX(`duration_ms`) AS max_ms
FROM `brain_traces`
WHERE `created_at` >= NOW() - INTERVAL 1 DAY
GROUP BY `kind`
ORDER BY n DESC;
