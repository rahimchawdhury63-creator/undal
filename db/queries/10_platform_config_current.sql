-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- The configuration actually in force, one row per key and zone.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT c.`key`, c.`zone_id`, c.`value`, c.`version`, c.`effective_at`
FROM `platform_config` c
JOIN (
  SELECT `key`, `zone_id`, MAX(`effective_at`) AS latest
  FROM `platform_config`
  WHERE `effective_at` <= NOW()
  GROUP BY `key`, `zone_id`
) t ON t.`key` = c.`key` AND t.`zone_id` = c.`zone_id` AND t.`latest` = c.`effective_at`
ORDER BY c.`key`;
