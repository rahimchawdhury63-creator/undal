--
-- Undal — what the rider claimed when they settled their cash. Licensed under PASVL-1.0.
--
-- `25 §5` asks the rider for five things: the bKash transaction ID, their bKash number, the name on the account, a
-- screenshot of the confirmation, and a selfie. The table has held the transaction ID, an amount, a method, a media id
-- and a status since the first migration; the other three fields had nowhere to go, so `25 §6`'s review screen — the one
-- that puts "amount expected versus claimed" and "number matches the account on file" side by side — had nothing to
-- compare against.
--
-- The columns are the *claim*, not the verdict. `number_matches` and `name_matches` are the automated checks run at
-- submission time and stored beside the claim so a reviewer does not have to re-run them (and so a later change to the
-- matching rules cannot rewrite what the reviewer was shown). They are nullable rather than defaulted: null means "not
-- checked", which is different from false, and a rider whose payout number was never recorded on file gets null rather
-- than an accusation.
--
-- The two images are URLs, not `media` rows. `proof_media_id` stays for a future pipeline that promotes the screenshot
-- into `26`'s media table with its retention rules; the settlement screen must work while that pipeline is cold, and a
-- rider standing in the street at 11 pm cannot be told to wait for an upload job. The screenshot shows a financial
-- transaction, so it is the one document in the platform that is *both* evidence and a secret: the URL is stored, the
-- reviewer opens it through the admin surface, and nothing serves it to the customer or vendor side.
--
-- All nullable, because a `CASH_TO_OPS` settlement — a rider handing cash to an operations officer — has no bKash
-- number and no transaction ID at all, and a column that says "not applicable" must not read as "withheld".

ALTER TABLE `rider_cash_settlements`
    ADD COLUMN `bkash_number` VARCHAR(16) NULL AFTER `trx_id`,
    ADD COLUMN `account_name` VARCHAR(96) NULL AFTER `bkash_number`,
    ADD COLUMN `screenshot_url` VARCHAR(512) NULL AFTER `account_name`,
    ADD COLUMN `selfie_url` VARCHAR(512) NULL AFTER `proof_media_id`,
    ADD COLUMN `number_matches` TINYINT(1) NULL AFTER `selfie_url`,
    ADD COLUMN `name_matches` TINYINT(1) NULL AFTER `number_matches`;
