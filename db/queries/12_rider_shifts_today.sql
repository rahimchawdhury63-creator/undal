-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- Who is on shift, how long they have been on, and what they have delivered.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT s.`id`, s.`rider_id`, s.`zone_id`, s.`started_at`,
       COALESCE(s.`ended_at`, NOW()) - s.`started_at` AS duration,
       r.`shift_state`
FROM `rider_shifts` s
JOIN `riders` r ON r.`id` = s.`rider_id`
WHERE s.`started_at` >= CURDATE()
ORDER BY s.`started_at` DESC;
