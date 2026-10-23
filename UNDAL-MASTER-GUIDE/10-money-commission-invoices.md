# 10 · Money — Commission, Tax, Discounts, Ledger & Invoices (zero-math-error system)

## 10.1 Iron rules

1. **Integer poisha only** (`bigint`). Display format `৳1,234.50` (en-IN grouping, BN numerals when locale=bn).
2. **Server recomputes everything** at cart-validate and again inside `place_order`. Client totals are display-only;
   mismatch → `CART_STALE` refresh, never silent acceptance.
3. **Every order stores an immutable money snapshot** (rates valid at order time). Later rate changes never rewrite history.
4. Rounding: each computed component rounds **half-up to nearest poisha once**, in the documented order below — invoice =
   sum of order snapshots, so invoice math is addition only (provably exact; property tests in file `26`).

## 10.2 Order money waterfall (delivery; pickup drops delivery rows)

```
items_gross        = Σ (unit_price + options) × qty                      [VAT-inclusive menu prices]
discount_total     = vendor_promo + flashbox + voucher (capped, §10.3)
  split → discount_vendor_funded / discount_platform_funded (per promotion funding rule)
food_payable       = items_gross − discount_total
tax_extracted      = round(food_payable × 5 / 105)                       [5% VAT included — D-08]
delivery_fee       = customer fee from zone matrix (may be 0 by promo/first-order)
platform_fee       = setting (default ৳5 = 500 poisha)
tip                = customer-chosen (cash, 100% rider)
COD_COLLECT        = food_payable + delivery_fee + platform_fee + tip    [what rider collects / pickup pays]
── settlement side ──
commission         = round(food_payable × 15%)                           [vendor → Undal]
rider_bonus        = round(food_payable × 3%)                            [Undal tax-stream → rider — D-07]
vendor_net         = food_payable − discount_vendor_funded… (see note) − commission
```

**Funding note (must implement exactly):** `food_payable` already subtracts *all* discounts. Vendor-funded portion is
borne by the vendor, platform-funded portion is reimbursed by Undal. Therefore:
`vendor_net = food_payable + discount_platform_funded − commission`
(customer paid less; Undal tops up its funded share). Tax extracted is remitted share reporting: of the 5% stream,
`rider_bonus` (3% of food_payable) is allocated to riders; remainder stays in Undal's tax pool for remittance —
both shown as explicit ledger lines so Finance sees the full 5%.

**Worked example (payment verification test vector #1):** items ৳541.00, voucher vendor-funded ৳108.20 (mirrors reference order #155):
food_payable ৳432.80 · tax_extracted = 432.80×5/105 = **৳20.61** · commission = **৳64.92** · rider_bonus = **৳12.98** ·
vendor_net = 432.80 + 0 − 64.92 = **৳367.88** · with delivery_fee ৳0 (first-order), platform ৳5, tip ৳0 → **COD ৳437.80**.
Builder encodes ≥12 such golden vectors as SQL + Dart + TS tests (Appendix F seeds).

## 10.3 Discount engine (precedence, no stacking surprises)

Order of application: item-level (BOGO/bundle price) → vendor menu/category % → Flash Box campaign % (capped) →
voucher (one per order; % with cap or flat; min-order; new-user/zone/vendor scoping) → delivery-fee waivers (first-order,
over-৳X free delivery). Every layer records its funding split. Rules in `campaigns`/`vouchers` tables, evaluated by one
pure function `price_order()` shared (SQL canonical; TS/Dart mirrors for display *only*, parity-tested against golden vectors).

## 10.4 Ledger

`ledger_entries(kind, actor_type, actor_id, order_id, amount_poisha signed, memo, created_at)` written by
`finalize_delivery` (+ pickup completion + cancel-refund adjustments): vendor payable +, commission −, Undal commission +,
rider fare +, rider bonus +, tip +, COD collected by rider (liability − until remitted), platform-funded discount −/+.
Balances are sums — invoices select an actor's entries in-period; disputes replay entries, never re-derive from orders.

## 10.5 Weekly invoices (D-06 dual-path generation)

- **Riders: Friday 00:05** — period = previous Fri 00:00 → Thu 23:59 (Asia/Dhaka). **Vendors: Saturday 00:05** — period Sat→Fri.
  (pay-on-off-days exactly as founder specified.) Cron (W3) + lazy idempotent generation on first read after close.
- Content: per-order lines (code, datetime, food/fare components → net), subtotals, adjustments/penalties with reason codes,
  previous cash-liability (riders: COD collected − remitted), **net payable / net receivable**, payout account masked.
  Negative rider net (owes cash) blocks “PAID” until remittance verified (interlocks file `23`).
- States: `GENERATED → VERIFIED → PAID` (+ `DISPUTED` branch with ticket link). Admin list with filters, bulk-verify,
  per-invoice PDF (Undal-branded, BN+EN, QR verifying invoice id), payout execution record (bKash TrxID + screenshot private).
- PDF spec: A4, logo, vendor/rider legal details, period, line table (paginated, repeating header), totals box,
  “15% commission · 5% VAT-incl.” explainer footer — *designed, not plain text* (template in admin_web, file `20`).

## 10.6 Cancellations & COD edge money

Cancel before vendor-accept: no money moves. After prep started: Admin policy matrix (who bears food cost) → adjustment lines
with reason + evidence (photos). Customer no-show at door (rider waited ≥8 min, 2 calls logged): order
`FAILED_DELIVERY` → rider still paid fare, food cost per policy, customer trust-score hit (future COD limits tighten).
Partial/missing items: customer reports in-app → vendor-funded refund as *adjustment on next invoice* (COD has no digital
refund rail; alternatively goodwill voucher — customer's choice, Admin-audited).
