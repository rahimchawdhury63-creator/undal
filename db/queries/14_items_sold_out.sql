-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- Items that ran out today and how long they were dark.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT i.`name_en`, s.`sold_out_minutes`, s.`orders_count`
FROM `item_stats` s
JOIN `menu_items` i ON i.`id` = s.`item_id`
WHERE s.`stat_date` = CURDATE() AND s.`sold_out_minutes` > 0
ORDER BY s.`sold_out_minutes` DESC;
