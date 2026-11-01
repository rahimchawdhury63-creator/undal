-- Undal — allowlisted read-only query. Licensed under PASVL-1.0.
--
-- Vendors whose paperwork is blocking approval.
-- Used by `db-query.yml`: one SELECT, no parameters, 200 rows maximum.

SELECT v.`id`, v.`name_en`, d.`kind`, d.`status`, d.`expires_on`
FROM `vendor_documents` d
JOIN `vendors` v ON v.`id` = d.`vendor_id`
WHERE d.`status` IN ('PENDING','REJECTED')
ORDER BY d.`created_at`;
