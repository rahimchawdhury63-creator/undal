-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- Orders that have sat in a non-terminal state for more than an hour.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT `id`, `code`, `state`, `placed_at`, TIMESTAMPDIFF(MINUTE, `placed_at`, NOW()) AS minutes
FROM `orders`
WHERE `state` IN ('PLACED','RIDER_SEARCH','RIDER_ASSIGNED','PICKED_UP','ARRIVED','REASSIGNING')
  AND `placed_at` < NOW() - INTERVAL 60 MINUTE
ORDER BY minutes DESC;
