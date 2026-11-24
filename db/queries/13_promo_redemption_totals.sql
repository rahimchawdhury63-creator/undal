-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- What each promo code has cost so far this month.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT p.`code`, COUNT(*) AS redemptions, SUM(r.`discount_paisa`) AS discount_paisa
FROM `promo_redemptions` r
JOIN `promo_codes` p ON p.`id` = r.`promo_id`
WHERE r.`created_at` >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
GROUP BY p.`code`
ORDER BY discount_paisa DESC;
