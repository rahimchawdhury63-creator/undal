-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- The audit chain walked in SQL: any row whose prev_hash is not its predecessor's hash.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT a.`seq`, a.`hash`, prev.`hash` AS previous_hash
FROM `audit_log` a
LEFT JOIN `audit_log` prev ON prev.`seq` = a.`seq` - 1
WHERE a.`seq` > 1 AND (prev.`hash` IS NULL OR a.`prev_hash` <> prev.`hash`)
ORDER BY a.`seq`;
