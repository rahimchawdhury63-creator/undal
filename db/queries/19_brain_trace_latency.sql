-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- How long dispatch decisions actually take.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT `decision_kind`, COUNT(*) AS n,
       ROUND(AVG(`latency_ms`), 1) AS avg_ms, MAX(`latency_ms`) AS max_ms
FROM `brain_traces`
WHERE `created_at` >= NOW() - INTERVAL 1 DAY
GROUP BY `decision_kind`
ORDER BY n DESC;
