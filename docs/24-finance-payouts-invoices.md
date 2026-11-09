<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 24 — Finance, Payouts and Invoices

> **Implementation safety (D163–D166):** Existing financial posting and audit paths are not
> atomic. Cash approval and write-off remain blocked in production. A transaction-only ledger
> posting foundation exists but is not wired to routes or verified against real TiDB; it does
> not by itself make balances, case closure, audit, replay, payouts or other money flows safe.
> Reconcile existing data and complete isolated concurrency/failure testing before rollout.

> The brief: *"auto generated 100% accurate invoices ... never fails and never mismatches ... no
> cron ... manual admin review ... riders paid Friday, vendors Saturday ... branded graphic-rich
> PDF under 1 MB on Cloudinary ... admin states VERIFIED then PAID."* This document specifies the
> double-entry ledger that makes "never mismatches" a provable property rather than an aspiration.

---

## 1. Why double-entry

A single-column money system — a `balance` field that gets incremented — cannot tell you *why* a
number is what it is, and it cannot detect its own corruption. Undal uses double-entry
bookkeeping, where every transaction is a set of postings that **must sum to exactly zero**.

The consequence: a bug that loses money makes the ledger fail to balance, and the system notices
immediately rather than at the end of the month when somebody complains.

```
  ledger_accounts        one row per real economic party + platform accounts
  ledger_entries         one row per economic event (an order, a payout, an adjustment)
  ledger_postings        N rows per entry; SUM(amount_paisa) = 0, asserted three times
```

Closure is asserted:
1. In `postEntry()`, before the transaction commits. A non-zero sum throws and rolls back.
2. At invoice generation, over every entry in the period.
3. By a property test over 10 000 randomly generated transaction sets.

Plus a `LEDGER_IMBALANCE` exception trigger ([`21 §8.1`](21-admin-panel.md)) that fires CRITICAL
if a trial balance ever returns non-zero.

### 1.1 Account types

| Account | Type | Sign convention |
| --- | --- | --- |
| `VENDOR:{id}` | Liability | Credit (negative) = Undal owes the vendor |
| `RIDER:{id}` | Liability | Credit = Undal owes the rider |
| `RIDER_CASH:{id}` | Asset | Debit (positive) = the rider holds Undal's cash |
| `PLATFORM:REVENUE_COMMISSION` | Revenue | Credit |
| `PLATFORM:REVENUE_DELIVERY_MARGIN` | Revenue | Credit |
| `PLATFORM:REVENUE_SMALL_ORDER` | Revenue | Credit |
| `PLATFORM:TAX_PAYABLE` | Liability | Credit |
| `PLATFORM:EXPENSE_RIDER_BONUS` | Expense | Debit |
| `PLATFORM:EXPENSE_WEATHER_SUBSIDY` | Expense | Debit |
| `PLATFORM:EXPENSE_ROUNDING` | Expense | Debit |
| `PLATFORM:EXPENSE_PROMO` | Expense | Debit |
| `PLATFORM:EXPENSE_COMPENSATION` | Expense | Debit |
| `PLATFORM:BANK` | Asset | Debit |
| `PLATFORM:LOYALTY_LIABILITY` | Liability | Credit |

---

## 2. The canonical order posting

Vector 01 from [`10 §12.1`](10-fare-engine-math.md): a motorbike delivery, 3 800 m, SDR 1.272,
clear weather, subtotal ৳450.00.

### 2.1 Derivation

```
subtotal                     45 000
ride_core                     6 520      base 4 000 x 1.272 surge, + 1 800 m at 1 400/km
platform_delivery_margin        522      = apply_rate(6 520, 800)
delivery_fee                  7 042      = 6 520 + 522
commission                    6 750      = apply_rate(45 000, 1 500)
rider_bonus                   1 350      = apply_rate(45 000, 300)   [vendor-funded]
taxable_base                  7 272      = commission + delivery_margin + small_order_platform
tax                             364      = apply_rate(7 272, 500)
raw_total                    52 406      = subtotal + delivery_fee + tax + tip
total                        52 400      = floor_to_taka(raw_total), delta -6
```

### 2.2 The postings

| # | Account | Amount (paisa) | Meaning |
| --- | --- | --- | --- |
| 1 | `RIDER_CASH:karim` | **+52 400** | The rider now holds ৳524.00 of Undal's money |
| 2 | `VENDOR:rahmans` | **−36 900** | 45 000 − 6 750 commission − 1 350 bonus |
| 3 | `RIDER:karim` | **−7 870** | 6 520 fare + 1 350 bonus |
| 4 | `PLATFORM:REVENUE_COMMISSION` | **−6 750** | 15% of the subtotal |
| 5 | `PLATFORM:REVENUE_DELIVERY_MARGIN` | **−522** | 800 bps of `ride_core` |
| 6 | `PLATFORM:TAX_PAYABLE` | **−364** | 5% of the taxable base |
| 7 | `PLATFORM:EXPENSE_ROUNDING` | **+6** | The floor-to-taka delta |
| | **Sum** | **0** ✓ | `52 400 − 36 900 − 7 870 − 6 750 − 522 − 364 + 6 = 0` |

Customer pays **৳524.00** in cash. Vendor is owed **৳369.00**. Rider is owed **৳78.70**. The
platform keeps **৳72.72** gross, of which **৳3.64** is tax payable, leaving **৳69.08** net, less
**৳0.06** absorbed into rounding.

### 2.3 Three invariants that govern every posting set

1. **The rider bonus is vendor-funded and is therefore never a platform expense.** It is deducted
   from the vendor's line and added to the rider's line. A `PLATFORM:EXPENSE_RIDER_BONUS` posting
   on an ordinary order would double-count it and break closure. That account exists only for the
   rare case of a platform-funded promotional bonus, which is a different event with its own
   reason code.
2. **`taxable_base = commission + platform_delivery_margin + small_order_platform`, and nothing
   else.** Not the subtotal, not the rider bonus, not the rider's fare, not the tip. The tax is
   levied on the platform's own fee revenue.
3. **Every posting set sums to exactly zero**, asserted by `postEntry()` before commit, at invoice
   generation, and by the `ledger-closure` property test.

> **Note for the building agent.** This section is the authority for order postings. Where a
> worked figure elsewhere in the corpus disagrees — in particular the tax lines in the forty fare
> vectors of [`10 §12`](10-fare-engine-math.md) and the example in
> [`06 §8.2`](06-data-model-tidb.md), some of which were drafted with a taxable base that
> wrongly included the rider bonus — recompute from the formulas in
> [`10 §3`–`§10`](10-fare-engine-math.md) under the three invariants above and treat the printed
> figure as prose error, not as a rule. The implementation must make `ledger-closure` pass; a
> vector that cannot close is a typo in a document, and the test is the arbiter.

## 3. Every posting set

| Event | Postings |
| --- | --- |
| **Order delivered (COD)** | §2.2 |
| **Order delivered (pickup)** | No rider postings; no delivery fee; small-order fee is ৳20 with the ৳5 rider share not collected |
| **Tip** | `RIDER_CASH +tip`, `RIDER:{id} −tip`. The platform takes nothing and the ledger proves it |
| **Weather premium** | `PLATFORM:EXPENSE_WEATHER_SUBSIDY +w`, `RIDER:{id} −w`. The customer line is untouched |
| **Bundle credit** | `PLATFORM:EXPENSE_PROMO +c`, and the customer's cash collected is reduced by `c` |
| **Promo (platform-funded)** | `PLATFORM:EXPENSE_PROMO +p`, cash collected reduced by `p` |
| **Promo (vendor-funded)** | `VENDOR:{id} +p` (reducing what is owed), cash collected reduced by `p` |
| **Flash Box 25%** | Vendor-funded: the discount reduces the subtotal, so commission falls too. The vendor's net is shown live in the partner app before they opt in |
| **Cash settlement** | `RIDER_CASH:{id} −amount`, `PLATFORM:BANK +amount` |
| **Rider payout** | `RIDER:{id} +amount`, `PLATFORM:BANK −amount` |
| **Vendor payout** | `VENDOR:{id} +amount`, `PLATFORM:BANK −amount` |
| **Customer credit** | `PLATFORM:EXPENSE_COMPENSATION +c`, `PLATFORM:LOYALTY_LIABILITY −c` |
| **Order cancelled after preparation** | `PLATFORM:EXPENSE_COMPENSATION +cost`, `VENDOR:{id} −cost`. The cost is borne by the platform, never the customer and never the rider |
| **Rider penalty** | Rare, admin-only, requires a reason: `RIDER:{id} +p`, `PLATFORM:REVENUE_PENALTY −p` |
| **Manual adjustment** | Always two postings, always with a reason code and step-up auth |

---

## 4. Invoicing without cron

> *"auto generated ... no cron ... never fails and never mismatches."*

### 4.1 The trigger

A **period-boundary check** runs on specific, frequent, naturally-occurring events:

| Event | Check |
| --- | --- |
| Any admin request to the finance domain | Is there a closed, un-invoiced period? |
| Any order reaching `SETTLED` | Did that settlement close a period? |
| Any rider cash settlement approval | Same |
| Any partner or rider app open | Same, cheaply, from a KV flag |

The check is a single indexed query: `SELECT 1 FROM invoice_periods WHERE state = 'CLOSED' AND
invoiced_at IS NULL LIMIT 1`. If it returns nothing — the overwhelmingly common case — the cost is
under a millisecond. If it returns a row, generation is enqueued, guarded by an advisory lock so
twenty simultaneous requests produce exactly one generation.

This is strictly better than a cron for the platform's purposes: it cannot fire while the system
is down, it cannot be missed, it self-heals (the next request retries), and it requires no
always-on compute. The trade is latency — an invoice might be generated minutes rather than
seconds after the boundary — which does not matter for a weekly payout.

### 4.2 Periods

| Party | Period | Closes | Invoiced | Paid |
| --- | --- | --- | --- | --- |
| Rider | Mon 00:00 – Sun 23:59 (`Asia/Dhaka`) | Sun 23:59 | Mon | **Friday** |
| Vendor | Mon 00:00 – Sun 23:59 | Sun 23:59 | Mon | **Saturday** |

The gap between closing and paying is the manual review window the brief requires.

### 4.3 Determinism

```python
def generate_invoice(party_id: str, period_id: str) -> Invoice:
    """Pure function of (party, period, ledger state at period close).

    - Reads only postings whose entry occurred inside the period.
    - Never reads `now()`.
    - Produces a canonical JSON representation.
    - Hashes it with SHA-256 into `content_hash`.

    Regenerating an invoice MUST produce an identical content_hash. If it
    does not, something changed in a closed period, which is itself a
    CRITICAL exception (`INVOICE_MISMATCH`) — because a closed period must
    be immutable.
    """
```

Immutability of closed periods is enforced by a database trigger: a posting whose entry timestamp
falls in a closed, invoiced period cannot be inserted. Corrections are made as **new postings in
the current period**, referencing the original, which is how real accounting works and how an
audit trail survives.

---

## 5. The vendor invoice

```
  UND/V/2026/44/00017                      Rahman's Biriyani House
  Period: 27 Oct – 2 Nov 2026                      Zindabazar, Sylhet

  ORDERS                                              142 completed
  ─────────────────────────────────────────────────────────────────
  Gross order value                                      ৳ 48,320.00
  Flash Box discounts (25%, 18 orders)                  −৳  2,140.00
  ─────────────────────────────────────────────────────────────────
  Net order value                                        ৳ 46,180.00

  DEDUCTIONS
  Commission (15%)                                      −৳  6,927.00
  Rider bonus (3%)                                      −৳  1,385.40
  ─────────────────────────────────────────────────────────────────
  ADDITIONS
  Small-order fee share (12 orders × ৳5)                 ৳     60.00
  ─────────────────────────────────────────────────────────────────
  ADJUSTMENTS
  Dispute UND-4F2K: missing item refund                 −৳    180.00
  ─────────────────────────────────────────────────────────────────

  NET PAYABLE                                            ৳ 37,747.60

  Payment method: bKash  ·  017XXXXXXXX  ·  Md. Rahman
  Scheduled: Saturday 7 November 2026

  Every line above links to the orders behind it in your app.
```

Note what is **not** on a vendor invoice: tax. The 5% tax is levied on the platform's own fee
revenue, not on the vendor's sales. The invoice says so in a footnote, because vendors ask.

---

## 6. The rider invoice

```
  UND/R/2026/44/00093                               Karim Rahman
  Period: 27 Oct – 2 Nov 2026                Motorbike · Sylhet Central

  DELIVERIES                                          68 completed
  ─────────────────────────────────────────────────────────────────
  Delivery fares                                         ৳  5,784.00
  Order bonuses (3%)                                     ৳  1,102.40
  Small-order fee shares (14 × ৳5)                       ৳     70.00
  Weather premiums                                       ৳    312.00
  Traffic compensation                                   ৳    184.00
  Recovery bonuses (2)                                   ৳     30.00
  Tips                                                   ৳    640.00
  ─────────────────────────────────────────────────────────────────
  Gross earnings                                         ৳  8,122.40

  PENALTIES
  (none)                                                 ৳      0.00
  ─────────────────────────────────────────────────────────────────

  NET PAYABLE                                            ৳  8,122.40

  CASH RECONCILIATION                                    (informational)
  Cash collected                                         ৳ 41,280.00
  Cash settled                                          −৳ 41,280.00
  Outstanding                                            ৳      0.00   ✓

  Payment method: bKash  ·  018XXXXXXXX  ·  Karim Rahman
  Cash-out charge covered by Undal.
  Scheduled: Friday 6 November 2026
```

The cash reconciliation block is informational and must always show zero outstanding before an
invoice can reach `VERIFIED`. A rider with outstanding cash has their payout held and is told
exactly why.

---

## 7. The PDF

> *"branded graphic-rich PDF under 1 MB hosted on Cloudinary."*

| Property | Value |
| --- | --- |
| Generator | `pdf-lib` inside `undal-core` — no headless browser, no external service, no cost |
| Fonts | Poppins and Hind Siliguri, **subsetted to the glyphs actually used**, typically 38 KB total |
| Branding | The Undal mark, a forest-green header band, a subtle watermark, the party's logo where available |
| Graphics | A per-day earnings bar chart, a deductions donut, and a sparkline of the period against the previous one — all drawn as vectors, not images |
| Size | **Typically 180–340 KB; hard-capped at 1 MB.** If a generated PDF exceeds the cap, charts degrade to tables and the build retries |
| Hosting | Cloudinary, `access_mode: authenticated`, delivered by a signed 15-minute URL |
| Verification | The `content_hash` is printed in the footer and embedded in the PDF metadata, so a disputed invoice can be verified byte-for-byte against the ledger |
| Languages | Generated in the party's chosen language |

---

## 8. The payout run

```
  PAYOUT RUN · RIDERS · Friday 6 November 2026

  Status      VERIFIED → ready to pay
  Invoices    47
  Total       ৳ 312,840.00

  By method
    bKash      41 riders    ৳ 268,120.00    [ Export bKash file ]
    Nagad       4 riders    ৳  28,400.00    [ Export ]
    Bank        2 riders    ৳  16,320.00    [ Export ]

  ⚠ 3 invoices held
    Shahin Ahmed    outstanding cash ৳1,240       [ Review ]
    Rafiq Islam     payout account changed 2d ago [ Review ]
    Jamal Uddin     open dispute UND-9K3M         [ Review ]

  ┌──────────────────────────────────────────────┐
  │   MARK 44 INVOICES PAID     (requires TOTP)  │
  └──────────────────────────────────────────────┘
```

### 8.1 The lifecycle

| State | Meaning | Who |
| --- | --- | --- |
| `DRAFT` | Generated, not yet reviewed | System |
| `GENERATED` | Complete and hash-stable | System |
| `VERIFIED` | A human has reviewed and approved it | `FINANCE` role, audited |
| `PAID` | Money has actually been sent | `FINANCE` role, step-up TOTP, reference captured |
| `HELD` | Blocked, with a reason | Any finance role |
| `VOID` | Cancelled with a reason; a replacement must be issued | `SUPER_ADMIN` |

`VERIFIED → PAID` requires the transaction reference for each payment, entered or imported from
the bKash export. Marking paid without a reference is impossible.

### 8.2 The bKash file

A CSV in bKash's bulk-disbursement format: receiver number, amount, reference. The amount sent is
the **net payable plus the cash-out charge**, so the recipient receives the full invoice figure.
The charge is computed from the current bKash tariff table held in `platform_config`, is shown on
the run, and is posted to `PLATFORM:EXPENSE_PAYOUT_FEES`.

This directly implements the brief: *"bKash is recommended, send money with cash-out charges."*

---

## 9. Reconciliation

After a run, a bKash statement is imported and matched against expected payments by amount,
number, and reference. Mismatches are surfaced in four categories: not-sent, wrong-amount,
duplicate, and unexpected. Each requires a resolution with a reason before the run can close.

A run that cannot fully reconcile stays open. There is no "close anyway" button.

---

## 10. Cost attribution

Who pays when something goes wrong:

| Situation | Customer | Vendor | Rider | Platform |
| --- | --- | --- | --- | --- |
| Vendor rejects before preparation | — | — | — | — |
| Vendor unreachable, auto-cancelled | ৳50 credit | ranking effect | — | **credit + any rider cost** |
| No rider found | ৳50 credit | preparation cost reimbursed | — | **both** |
| Rider drops before pickup | — | — | completion-rate effect | **recovery bonus** |
| Rider drops after pickup | replacement or credit | — | fare for completed legs only | **the rest** |
| Food quality dispute, upheld | refund of the item | **item cost** | — | delivery cost |
| Missing item, vendor fault | refund | **item cost** | — | — |
| Missing item, rider fault | refund | — | **item cost, capped at ৳300/week** | remainder |
| Late delivery, vendor fault | ৳30 credit | **credit** | — | — |
| Late delivery, rider fault | ৳30 credit | — | — | **credit** |
| Late delivery, traffic or weather | ৳30 credit | — | **compensated** | **both** |
| Customer refuses the order at the door | — | **food cost** | **full fare paid** | remainder |
| Fraudulent customer order | — | — | **full fare paid** | **everything** |

The cap on rider liability is deliberate and important: a rider earning ৳8 000 a week cannot
absorb a ৳2 000 loss, and a platform that lets them is not a platform anyone will ride for.

---

## 11. Payout account changes

A changed payout account is the highest-risk event in the finance domain, because it is how
account-takeover fraud extracts money.

| Control | Rule |
| --- | --- |
| Cooling-off | A changed account cannot receive a payout for **72 hours** |
| Notification | The old number, the email on file, and the app all receive an alert |
| Re-verification | The new account name must match the NID name, or a document is required |
| Audit | Full before/after with the actor, IP and device |
| Admin review | Every change appears in a review queue; the payout run holds any invoice whose account changed within 72 hours |

---

## 12. Testing

| Test | Count | Asserts |
| --- | --- | --- |
| `ledger-closure` | 10 000 generated cases | Every posting set sums to zero |
| Posting sets | 34 | Every row of §3, hand-verified |
| Trial balance | 1 | Zero over a 100 000-posting fixture |
| Invoice determinism | 1 000 | Regeneration produces an identical `content_hash` |
| Period immutability | 9 | A posting into a closed period is rejected by the trigger |
| Boundary trigger | 14 | Fires exactly once per period across 50 concurrent requests |
| Invoice arithmetic | 200 | Against hand-computed fixtures for both parties |
| PDF | 24 | Under 1 MB for a 500-order period; fonts subsetted; hash in metadata; both languages |
| Payout lifecycle | 22 | Every transition, every guard, TOTP enforcement |
| bKash export | 11 | Format, cash-out charge arithmetic, rounding |
| Reconciliation | 18 | All four mismatch categories; a run cannot close unresolved |
| Cost attribution | 13 | Every row of §10 |
| Account change | 8 | Cooling-off holds the payout; notifications fire |
| Cash reconciliation | 12 | Outstanding cash blocks `VERIFIED` |

---

## 13. Reading on

Next: [`25-rider-cash-settlement.md`](25-rider-cash-settlement.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
