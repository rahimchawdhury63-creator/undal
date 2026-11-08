-- Undal — a reviewer can claim an open cash case. Licensed under PASVL-1.0.
-- NULL means unclaimed, including existing cases; the declaration remains the case record.
ALTER TABLE `rider_cash_declarations`
    ADD COLUMN `owner_id` BINARY(16) NULL AFTER `resolution_note`,
    ADD COLUMN `claimed_at` DATETIME(6) NULL AFTER `owner_id`;
