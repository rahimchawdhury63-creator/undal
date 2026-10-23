# 23 · Payouts & Rider Cash Reconciliation (manual rails, system-perfect books)

## 23.1 Weekly rhythm (founder law, Asia/Dhaka)

**Riders paid Fridays** (review Thu night), **Vendors paid Saturdays**. Generation per file `10` §5 (Cron + lazy).
Admin flow: GENERATED → Finance verifies (spot-recompute button replays ledger → must equal invoice totals, else hard stop)
→ VERIFIED → execute bKash Send Money / Nagad / Bank manually → record TrxID/UTR + proof screenshot (private) → PAID →
payee notified + PDF finalised. bKash recommended everywhere in UI; **cash-out charge added on top** of the payout amount
(setting per rail: bKash Send Money fee table/charge borne by Undal — riders/vendors receive full net + charge cover line shown).

## 23.2 Cash-in-hand accounting (COD float control)

Rider liability = Σ COD_COLLECT on delivered orders − Σ verified remittances − approved adjustments. Live meter (Rider app
+ Admin). Zone ceiling (default ৳3,000 bicycle / ৳5,000 motorbike, settings): at 80% warn, 100% no new COD offers (pickup-only
offers don't exist for riders — so: finish current, remit to unlock). End-of-shift gate per file `18` §18.5. Vendor-side: pickup
cash is vendor's directly; Undal's commission on pickup settles in Saturday invoice (netting against delivery payables; if
net-negative, vendor remit flow mirrors rider gate-lite: invoice shows “Amount payable to Undal” + bKash instructions + due date).

## 23.3 Remittance review (Admin)

Queue: selfie + screenshot + TrxID + claimed amount vs system liability; TrxID globally unique (duplicate = auto-flag);
approve full/partial (partial leaves remainder gated), reject with reason templates; SLA 12 h; every action audit-logged.
Undal receiving number(s): GitHub secret `UNDAL_BKASH_NUMBER` (+ optional Nagad) surfaced **only** inside authenticated
Rider/Vendor cash screens via W2 config endpoint (never in repo/APK strings/web).

## 23.4 Penalties, bonuses, adjustments (due process)

Reason-coded catalogue (late remittance, proven fake-delivery, damage negligence / festival bonus, referral bonus,
goodwill): amount or % rules, evidence attach, **rider/vendor sees + can dispute before it hits an invoice** (pending →
confirmed lifecycle), Finance approval for >threshold. The 3% rider order bonus is automatic (file `10`) — not in this manual system.

## 23.5 Books & exports

Daily cash-position snapshot (expected float with riders per zone), weekly settlement pack (invoices zip + ledger CSV +
remittance register) generated to private bucket for the founder/accountant, VAT-pool report (collected extraction,
rider-bonus allocation, remittable remainder). Financial year lock: closed periods immutable (corrections via next-period adjustments only).
