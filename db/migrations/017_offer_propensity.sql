--
-- Undal — the acceptance model's features, recorded when the offer is written. Licensed under PASVL-1.0.
--
-- `09 §7.4` trains its logistic model on the features that were true when the offer was made: the payout, the distance
-- to the vendor, the trip, the rider's idle time, the hour, the weather and whether it was a batch. Three of those are
-- facts about the *moment* and none of them is recoverable afterwards — a rider's idle time at 12:04 is not in any table
-- once the shift moves on, and the vendor distance was a routing snapshot that was never stored.
--
-- So the offer carries its own feature vector. Eight numbers, in the order `PROPENSITY_FEATURES` fixes, exactly as
-- `domain/order/propensity.ts` built them. JSON rather than eight columns because the model's shape is the model's
-- business: a ninth feature is a code change and a re-train, not a migration, and nothing indexes into this column.
--
-- Nullable, and null is meaningful: an offer written before this column existed, or by a planner with no acceptance
-- model, has no vector and must not be trained on as if its features were zeroes.
--
-- The outcome is already recorded next door — `response` is `ACCEPTED`, `REJECTED` or `EXPIRED` — so one row is one
-- training sample, and the training loop reads `offered_at` to know how far it has got.

ALTER TABLE `order_offers`
    ADD COLUMN `propensity_features` JSON NULL AFTER `payout_paisa`;
