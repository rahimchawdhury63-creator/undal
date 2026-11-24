--
-- Undal — the cell an order was delivered into. Licensed under PASVL-1.0.
--
-- `11 §5` factor 8 (`area_familiarity`) asks whether this rider has delivered into this cell before, because the last
-- hundred metres of a Sylhet delivery are the part nobody can route: which gate, which stairwell, which of the three
-- buildings with the same number. Factor 7 already credits a rider who knows a *vendor*; factor 8 credits the side of
-- the road. D125 recorded it as the one factor with no evidence, on the grounds that `orders` had no cell column.
--
-- It had the coordinates all along. `delivery_lat_e7` and `delivery_lon_e7` are snapshotted at placement so a later
-- address edit cannot rewrite history, and the cell is a pure function of them — the same function `addresses` and
-- `vendors` already use. So nothing new is recorded: the derived column is the same formula, in the schema instead of in
-- a query, and that is the whole point. A cell computed in TypeScript would be a second copy of `44920` and `49520` and
-- a second chance for the two to disagree; a generated column cannot disagree with itself, and the index on it is what
-- makes "how many times has this rider delivered into this cell" an indexed count rather than a scan.
--
-- Nullable, because the two coordinates are: a `PICKUP` order has no delivery point and a vendor-arranged delivery may
-- have been placed without one. A null cell is not zero deliveries — it is no evidence, which the loader scores as zero
-- and the trace shows as missing rather than as a fact.
--
-- The bounds are aliased because `orders` is a wide table and a generated expression that names two columns reads more
-- clearly in `SHOW CREATE TABLE` when the aliases say which two.

ALTER TABLE `orders`
    ADD COLUMN `delivery_cell`
        BIGINT AS (FLOOR(`delivery_lat_e7` / 44920) * 1000000 + FLOOR(`delivery_lon_e7` / 49520)) STORED
        AFTER `delivery_lon_e7`,
    ADD INDEX `idx_orders_delivery_cell` (`delivery_cell`);
