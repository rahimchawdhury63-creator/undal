-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- Locks whose lease expired: a coordinator died mid-dispatch.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT `order_id`, `holder`, `expires_at`
FROM `dispatch_locks`
WHERE `expires_at` < NOW()
ORDER BY `expires_at`;
