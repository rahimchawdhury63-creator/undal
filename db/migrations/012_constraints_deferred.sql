-- Undal — 012 constraints (deferred). Licensed under PASVL-1.0.
--
-- TiDB parses `CHECK` and does not enforce it, so these statements are the
-- *declaration* of each invariant, not its enforcement. Enforcement is the
-- generated validators in `packages/contracts/src/constraints/`, produced from
-- this DDL by `scripts/db/extract_constraints.py`; `check-constraint-parity`
-- fails the build if the two lists disagree by one entry.
--
-- They live in their own migration because each one names a column on a table
-- that must already exist, and because a reader looking for "what does the
-- database promise" should find all of it in one file.

ALTER TABLE `orders`
  ADD CONSTRAINT `chk_orders_total_whole_taka` CHECK (MOD(`total_paisa`, 100) = 0);

ALTER TABLE `orders`
  ADD CONSTRAINT `chk_orders_rounding_bounded` CHECK (`rounding_paisa` BETWEEN -99 AND 99);

ALTER TABLE `orders`
  ADD CONSTRAINT `chk_orders_total_covers_subtotal` CHECK (`total_paisa` >= `subtotal_paisa` - `discount_paisa`);

ALTER TABLE `orders`
  ADD CONSTRAINT `chk_orders_delivery_has_point` CHECK (`fulfilment` = 'PICKUP' OR `delivery_lat_e7` IS NOT NULL);

ALTER TABLE `order_items`
  ADD CONSTRAINT `chk_order_items_line_total` CHECK (`line_total_paisa` = `unit_price_paisa` * `quantity`);

ALTER TABLE `order_fees`
  ADD CONSTRAINT `chk_order_fees_tip_has_no_rate` CHECK (NOT (`kind` = 'TIP' AND `rate_bps` IS NOT NULL));

ALTER TABLE `ledger_postings`
  ADD CONSTRAINT `chk_ledger_postings_nonzero` CHECK (`amount_paisa` <> 0);

ALTER TABLE `ledger_entries`
  ADD CONSTRAINT `chk_ledger_entries_reversal_not_self` CHECK (`reverses_id` IS NULL OR `reverses_id` <> `id`);

ALTER TABLE `invoices`
  ADD CONSTRAINT `chk_invoices_net_not_negative` CHECK (`net_payable_paisa` >= 0);

ALTER TABLE `invoices`
  ADD CONSTRAINT `chk_invoices_pdf_bounded` CHECK (`pdf_bytes` IS NULL OR (`pdf_bytes` > 0 AND `pdf_bytes` <= 1048576));

ALTER TABLE `audit_log`
  ADD CONSTRAINT `chk_audit_log_hash_len` CHECK (OCTET_LENGTH(`hash`) = 32);

ALTER TABLE `audit_log`
  ADD CONSTRAINT `chk_audit_log_prev_hash_len` CHECK (`prev_hash` IS NULL OR OCTET_LENGTH(`prev_hash`) = 32);

ALTER TABLE `generation_locks`
  ADD CONSTRAINT `chk_generation_lock_lease_after_creation` CHECK (`lease_until` > `created_at`);

ALTER TABLE `rider_cash_settlements`
  ADD CONSTRAINT `chk_cash_settlement_reference` CHECK (`method` = 'CASH_TO_OPS' OR `trx_id` IS NOT NULL);

ALTER TABLE `payout_transactions`
  ADD CONSTRAINT `chk_payout_sent_has_time` CHECK (`status` NOT IN ('SENT','PAID') OR `sent_at` IS NOT NULL);

ALTER TABLE `vendor_commission_overrides`
  ADD CONSTRAINT `chk_commission_window_ordered` CHECK (`effective_to` IS NULL OR `effective_to` > `effective_from`);
