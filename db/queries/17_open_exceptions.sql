-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- What the ops strip on the admin home screen would show.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT `kind`, `severity`, COUNT(*) AS n, MIN(`created_at`) AS oldest
FROM `exceptions`
WHERE `status` = 'OPEN'
GROUP BY `kind`, `severity`
ORDER BY n DESC;
