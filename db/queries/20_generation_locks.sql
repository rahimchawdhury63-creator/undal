-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- Invoice generation locks currently held, and by whom.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT `lock_key`, `holder`, `lease_until`, `created_at`
FROM `generation_locks`
WHERE `lease_until` > NOW()
ORDER BY `created_at`;
