-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- The day's order book, by state.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT `state`, COUNT(*) AS n, SUM(`total_paisa`) AS total_paisa
FROM `orders`
WHERE `placed_at` >= CURDATE()
GROUP BY `state`
ORDER BY n DESC;
