<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 25 — Rider Cash Settlement

> The brief: *"at the end of the shift there will be a fixed screen with tick tick sound where the
> rider will send money to Undal's bKash number, no cash-out charge for the rider, and submit a
> selfie, bKash TrxID, screenshot, number and name. The screen will not be removable until the
> admin approves."* This is the most coercive screen in the platform. It is specified carefully,
> because a blocking screen that traps somebody unfairly is indefensible.

---

## 1. The problem

Undal is cash-on-delivery. A rider finishing an eight-hour shift is carrying ৳2 000–3 500 of the
platform's money. That cash has to come back, reliably, from people who are tired and want to go
home, with no card rails and no automated collection.

The mechanism is social and procedural rather than technical: the rider sends the money by bKash,
submits proof, and the app does not let them do anything else until an admin confirms it arrived.
It works because it is unambiguous.

The two figures the screen is built from are now readable without being blocked on (D140). `GET /v1/rider/cash`
answers `{ cashInHandPaisa, dueAt, locked, settlementRequired, shiftState }`, and the `SHIFT_CASH_OVERDUE` refusal that
starts the next shift carries the same pair — `{ outstanding, due_at }`, which is the shape `08 §6` fixes for it.
`due_at` is **not a future deadline**: this document sets none, because the block is immediate. It is the moment the
obligation began — the `ended_at` of the shift that collected the cash — which is what lets the screen say "you have been
carrying ৳2 140 since 22:14" instead of "settle your cash".

---

## 2. The design constraints this screen must respect

A blocking screen is a serious thing. Four constraints bound it:

| Constraint | Why |
| --- | --- |
| **It can never block an emergency** | SOS, emergency calls and the phone's dialler are always reachable. The screen is not a kiosk-mode lockdown and it does not use `startLockTask()` |
| **It can never block an active delivery** | Settlement is only reachable with zero active orders. A rider mid-delivery is never shown it |
| **It must be escapable when the platform is at fault** | If the server is unreachable, if admin review stalls past the SLA, or if the rider has a genuine dispute, there is a documented path out (§8) |
| **It must be known in advance** | Explained at onboarding ([`23 §5`](23-onboarding-kyc.md), step 11), rehearsed on day one, and summarised at the start of every shift. Nobody meets this screen for the first time at 11 pm |

A screen that ignores any of these stops being a settlement mechanism and becomes a hostage
situation. The implementation must respect all four.

---

## 3. When it appears

```
  Rider taps "End shift"
        │
        ├─ Active orders?  ──YES──▶  Blocked: "Finish your deliveries first"
        │
        ├─ cash_in_hand == 0?  ──YES──▶  Shift ends normally. Summary. Done.
        │
        └─ cash_in_hand > 0
                 │
                 ▼
         shift_state = CASH_PENDING
         Shift summary shown (earnings, distance, deliveries)
                 │
                 ▼
         [ SETTLE CASH & FINISH ]
                 │
                 ▼
         shift_state = CASH_LOCKED
         ══ THE BLOCKING SCREEN ══
```

It also appears, unprompted, when:

| Trigger | Behaviour |
| --- | --- |
| Cash reaches 100% of the limit mid-shift | Blocking, but the rider stays online and resumes receiving offers the moment the submission is recorded — admin approval happens afterwards |
| The rider has been online > 13 hours | The fatigue limit ([`19 §10`](19-rider-app.md)) ends the shift, which triggers settlement |
| An admin force-ends a shift | Same |
| The app is reopened while `CASH_LOCKED` | Straight to the screen, no home screen in between |

Mid-shift settlement is deliberately **non-blocking after submission**. A rider who hits the cap
at 7 pm should not lose their evening to an admin queue.

---

## 4. The screen

```
╔═══════════════════════════════════════════════╗
║                                               ║
║              SETTLE YOUR CASH                 ║
║                                               ║
║                 ৳ 2,140.00                    ║
║                                               ║
║      Send this amount to Undal's bKash        ║
║                                               ║
║   ┌─────────────────────────────────────┐     ║
║   │   01XXX-XXXXXX              📋 Copy │     ║
║   │   Undal Technologies                │     ║
║   │   Send Money  (not Payment)         │     ║
║   └─────────────────────────────────────┘     ║
║                                               ║
║   Send ৳2,159.00 — the extra ৳19.00 covers    ║
║   the cash-out charge, so it costs you        ║
║   nothing. Undal receives ৳2,140.00.          ║
║                                               ║
║        [ OPEN bKash ]                         ║
║                                               ║
║   ─────────── then come back ───────────      ║
║                                               ║
║   1️⃣  Transaction ID                          ║
║       ┌─────────────────────────────┐         ║
║       │ 9H5K2M8P1Q                  │         ║
║       └─────────────────────────────┘         ║
║   2️⃣  Your bKash number                       ║
║       ┌─────────────────────────────┐         ║
║       │ 018XXXXXXXX                 │         ║
║       └─────────────────────────────┘         ║
║   3️⃣  Name on the account                     ║
║       ┌─────────────────────────────┐         ║
║       │ Karim Rahman                │         ║
║       └─────────────────────────────┘         ║
║   4️⃣  Screenshot of the confirmation          ║
║       [ 📷 Attach ]              ✓ attached   ║
║   5️⃣  Selfie                                  ║
║       [ 📷 Take ]                ✓ taken      ║
║                                               ║
║   ┌─────────────────────────────────────┐     ║
║   │             SUBMIT                  │     ║
║   └─────────────────────────────────────┘     ║
║                                               ║
║   Need help?  [ Call support ]  [ SOS ]       ║
╚═══════════════════════════════════════════════╝
```

### 4.1 The cash-out charge

> *"no cash out charge for the rider."*

The rider sends the settlement amount **plus** the bKash cash-out charge, and the charge is
reimbursed in their next payout. The arithmetic is shown explicitly on the screen so there is no
ambiguity about what number to type into bKash.

```kotlin
/**
 * bKash's charge for "Send Money" to a personal account is currently 1.85%
 * for agent cash-out and is free or fixed for several send-money paths,
 * and the exact tariff changes. We therefore do not hard-code it: the rate
 * table lives in platform_config, is editable by finance, is versioned,
 * and is displayed on the screen with the resulting figure.
 *
 * The rider sends `settlement + charge`. Undal receives `settlement`. The
 * charge is posted to PLATFORM:EXPENSE_PAYOUT_FEES and reimbursed to the
 * rider on their weekly invoice, so their net cost is exactly zero.
 */
fun amountToSend(settlement: Paisa, tariff: BkashTariff): Paisa =
    settlement + tariff.chargeFor(settlement)
```

The bKash number itself is **`UNDAL_BKASH_PAYOUT_NUMBER`**, a GitHub Actions secret pushed to the
Worker as an environment variable and served to the app at runtime. It never appears in the
repository, in the APK, or in any log.

### 4.2 The tick

> *"with tick tick sound."*

```kotlin
/**
 * A single 1-second synthesised tick every 4 seconds. Not the order alarm —
 * that sound means "money is waiting for you" and must never be diluted.
 *
 * Deliberately low-key: this is a reminder, not an emergency. It is loud
 * enough to notice and quiet enough to live with. It uses USAGE_NOTIFICATION
 * rather than USAGE_ALARM, so it respects silent mode, and it stops the
 * moment the rider starts typing in any field.
 */
private const val TICK_INTERVAL_MS = 4_000L
private const val TICK_DURATION_MS = 1_000L
```

The tick stops permanently once the submission is made. It does not continue through the review
wait, because punishing somebody for waiting on an admin is exactly the kind of thing that makes a
mechanism feel punitive rather than procedural.

### 4.3 What the screen blocks

| Blocked | Not blocked |
| --- | --- |
| Going online | Emergency SOS |
| Receiving offers | The phone's dialler and emergency calls |
| Navigating to any other app screen | Calling Undal support |
| The system back gesture within the app | The home button and switching apps — Android allows it and Undal does not fight the OS |
| | Viewing the shift summary and earnings in a read-only sheet |
| | Reading the help guide |
| | Language switching |

On reopening the app, the screen returns. That is the real mechanism — not an unbreakable
foreground lock, which would be both hostile and impossible to guarantee.

---

## 5. Submission

| Field | Validation |
| --- | --- |
| Transaction ID | 10 alphanumeric characters, bKash format, uppercase-normalised, **unique across all settlements ever** — a reused TrxID is rejected immediately with a specific message |
| Rider's bKash number | 11 digits, `01[3-9]…`; must match the number on file, or a mismatch reason is required |
| Account name | Non-empty; compared to the NID name with a similarity check; a mismatch is allowed but flagged |
| Screenshot | Required. Compressed on-device, uploaded to **Cloudinary** (it shows a financial transaction — sensitive) |
| Selfie | Required. Face detected on-device. Uploaded to **imgbb**, per the brief |
| Amount | Pre-filled, read-only. A partial settlement requires an explicit "I'm settling less" path with a reason (§7) |

> **What the API now does with those five fields (D141).** `POST /v1/rider/cash/settle` takes
> `{ trxId, bkashNumber, accountName, screenshotUrl, selfieUrl, amountPaisa, method? }` and writes one `PENDING` row.
> The transaction ID is uppercased before anything else, because `9h5k2m8p1q` and `9H5K2M8P1Q` are one transfer and
> `uq_cash_settlement_trx` can only enforce uniqueness over one spelling. The two comparisons in §6 are made at
> submission and stored beside the claim — `number_matches` against the rider's `payout_number`, `name_matches` as the
> Dice similarity of character bigrams against the payout or legal name, at a 0.75 threshold — so a reviewer sees what
> the platform saw, and so a later change to the rules cannot rewrite history. **Neither comparison refuses the rider**,
> which §6 already says: a flag is a hint for a human. Null means *not checked* — a rider who never gave a payout number
> is not accused of a mismatch.
>
> The refusals are the six states the screen has a message for: `CASH_TRXID_INVALID` for ten characters that are not
> ten bKash characters, `CASH_SELFIE_REQUIRED` for the missing selfie, `CASH_TRXID_DUPLICATE` when the ID belongs to
> somebody else's claim (one payment must not settle two debts), `CASH_ALREADY_SETTLED` when nothing is owed or a claim
> is already under review, and `CASH_OVERPAYMENT` / `CASH_UNDERPAYMENT` (+`short_by`) because the amount is pre-filled
> and read-only. **A retry is not a refusal**: the same claim from the same rider answers with the first one and writes
> nothing, which is what makes the offline outbox safe.
>
> **Nothing unlocks at submission.** §5 has the rider's state become `CASH_SUBMITTED`; `riders.shift_state` has six
> values and none of them is that, and the block is released by *approval*, not by a claim. A rider who could pass the
> gate by typing ten characters would make the gate decorative. What changes is that the screen stops asking, and
> `GET /v1/rider/cash` starts reporting the submission with its status.

Submission is **idempotent** and queued in the outbox if offline, with the screen showing
*"Waiting for connection — your settlement is saved and will be sent automatically."* The rider is
never trapped by their own network.

On success: `shift_state = CASH_SUBMITTED`, the tick stops, and the screen becomes a calm waiting
state:

```
        ✓ Submitted at 20:41

        Waiting for Undal to confirm.
        Usually under 30 minutes.

        TrxID       9H5K2M8P1Q
        Amount      ৳2,140.00

        You can close the app.
        We'll notify you.

        [ View earnings ]   [ Call support ]
```

Note the last line: once submitted, the rider **can** leave. The block is on going back online,
not on living their life.

---

## 6. Admin review

```
  CASH SETTLEMENTS                       7 pending · SLA 30 min
  ┌───────────────────────────────────────────────────────────────────┐
  │  Karim Rahman          ৳2,140.00      ⏱ 4 min       [ Review ]    │
  │  Shahin Ahmed          ৳1,820.00      ⏱ 11 min      [ Review ]    │
  │  Rafiq Islam             ৳940.00      🔴 38 min     [ Review ]    │
  └───────────────────────────────────────────────────────────────────┘
```

> **The list is a route now (D145).** `GET /v1/finance/cash/settlements` returns the pending claims **oldest first**,
> each with the two automated flags and both evidence URLs, plus the three numbers the header shows: how many are waiting,
> how old the oldest is, and how many are past the two-hour deadline they will be released at anyway. Oldest first is not
> a display preference — it is the fairness rule, because the top of the list is the claim closest to auto-lifting
> unreviewed. The ceiling is 100 rows: a queue longer than that is an incident, not a page to scroll.

The review screen puts everything side by side: the selfie, the bKash screenshot (zoomable), the
typed TrxID, the amount expected versus claimed, the rider's recent settlement history, and the
orders that generated the cash.

| Automated check | Result |
| --- | --- |
| TrxID format | Pass / fail |
| TrxID previously used | **Blocking** |
| Amount matches `cash_in_hand` | Pass / mismatch with the delta |
| Number matches the account on file | Pass / flag |
| Selfie contains a face and resembles the KYC photo | Advisory — never decisive. Face comparison is a hint for a human, not an authority |
| Screenshot OCR extracts a matching TrxID and amount | Advisory, and genuinely useful: it catches transposed digits |
| Rider's settlement history | Shown: on-time rate, past mismatches, past rejections |

### 6.1 Decisions

| Decision | Effect |
| --- | --- |
| **Approve** | `RIDER_CASH −amount`, `PLATFORM:BANK +amount`. `shift_state = OFFLINE`. Screen releases. Notification. The rider can go online again immediately |
| **Approve a different amount** | For a partial or over-payment. Requires a reason. The difference stays in `RIDER_CASH` and the rider is told clearly what remains. **Implemented (D147)**, partial only |
| **Reject** | Reason required from a controlled list. The rider returns to the blocking screen with the specific reason displayed and a correction path |
| **Escalate** | Routes to a senior reviewer; the rider is released from the block and told a human is looking into it — because an escalation is the platform's problem, not the rider's |

Every decision is audited with the reviewer, the evidence they saw, and the reason.

> **Approve is built; the other three are not (D143).** `POST /v1/finance/cash/settlements/{id}/approve` is the row
> above with a route attached: it requires `finance.cash.approve_settlement`, which is one of the twenty-three step-up
> keys, so a reviewer must have entered a TOTP code within the last five minutes. It takes the claim with
> `UPDATE ... WHERE status = 'PENDING'` — one affected row, one poster — credits `deposited_paisa`, posts
> `CASH_SETTLED` to the ledger, releases the rider to `OFFLINE` if the balance is now zero, and writes one audit row that
> carries the ledger entry's id. A clean approval cites **no** reason code, because the register has none for "the money
> arrived as claimed"; a reviewer who is approving despite a discrepancy may cite `CASH_COUNTED_SHORT` or
> `CASH_NOT_HANDED_OVER`, and anything outside the register is refused before a row is read. **Reject, escalate and
> approve-a-different-amount are still screens with no route behind them.**
>
> **Reject is built, and its reason has a reader (D144).** `POST /v1/finance/cash/settlements/{id}/reject` requires one
> of the nine codes above, stores it on the settlement (`020` adds `rejection_reason` and `rejection_note`), and
> `GET /v1/rider/cash` returns both under the rejected row — because the reason exists for a rider who cannot read the
> audit log. `OTHER` must arrive with a sentence: the one code that explains nothing is the one that cannot be sent
> bare. The refusal posts no ledger entry, credits no deposit and leaves the rider `CASH_LOCKED`, because "not this
> evidence" is not "never mind". The audit row records the *register's* nearest word instead — `CASH_COUNTED_SHORT` for
> `AMOUNT_MISMATCH`, `SETTLEMENT_DISPUTED` otherwise — so the audit list groups on one closed vocabulary rather than
> nine that only this route uses.
>
> **Escalate is built, and it is the one decision that forgives nothing (D146).**
> `POST /v1/finance/cash/settlements/{id}/escalate` sets `escalated_at`, keeps the claim `PENDING` and the debt
> outstanding, and releases the rider from that moment — because the escalation is the platform's problem. The release is
> *computed*, not written: `liftStateOf` treats an escalated pending claim the way it treats a two-hour-old one, so
> `GET /v1/rider/cash` answers `locked: false, escalated: true` and `POST /v1/rider/shift/start` opens the door on the
> rider's next request. It takes the approver's key and therefore the approver's step-up code: releasing a rider against
> cash the platform has not seen is precisely the consequence step-up exists to guard, and a lesser permission for the
> same consequence would be the wrong direction. The end of a *later* shift does not re-block an escalated rider either,
> so the door does not make them prove the same promise twice.
>
> **Approve-a-different-amount is built, for the partial case only (D147).** Approval takes an optional `amountPaisa`;
> when it differs from the claim it **must** arrive with a reason, it cannot exceed what the rider claimed
> (`MONEY_REFUND_EXCEEDS_PAID`) and it cannot be zero — accepting nothing is a refusal wearing an approval's clothes. The
> accepted figure is stored in `approved_paisa` (`022`), and the ledger entry and the deposit credit are both built from
> it, so the books and the claim cannot disagree about how much moved. The difference stays in `RIDER_CASH` and
> `GET /v1/rider/cash` returns both numbers, because "confirmed" beside an unchanged balance is exactly the confusion
> `§6.1` promises to prevent. Over-payment is *not* built: a claim cannot exceed what was owed in the first place, so
> there is nothing above it to accept until `§7`'s disputed paths exist.

### 6.2 Rejection reasons

`TRXID_NOT_FOUND` · `TRXID_ALREADY_USED` · `AMOUNT_MISMATCH` · `SCREENSHOT_UNREADABLE` ·
`SCREENSHOT_MISMATCH` · `SELFIE_UNCLEAR` · `NUMBER_MISMATCH` · `PAYMENT_NOT_RECEIVED` · `OTHER`

Each carries a bilingual explanation and a specific instruction. `PAYMENT_NOT_RECEIVED` triggers a
support call rather than a silent rejection, because the most likely explanation is a delay at
bKash rather than dishonesty.

> **Why these nine are not the audit register's codes (D144).** The register in `audit/reasons.ts` holds two words for
> settlements — `CASH_COUNTED_SHORT` and `SETTLEMENT_DISPUTED` — and both describe the *reviewer's* situation rather than
> the rider's. A rider refused for `SELFIE_UNCLEAR` needs to be told to retake a photo; "settlement disputed" tells them
> nothing they can act on. So the settlement row carries the borrower's word and the audit row carries the platform's,
> and the mapping between them lives in one function (`auditReasonFor`) rather than in a reviewer's memory.

---

## 7. Partial and disputed settlements

A rider may be unable to settle the full amount — robbery, a lost wallet, an emergency, a genuine
accounting disagreement.

```
        Can't settle the full amount?

        [ I was robbed or lost the money ]
        [ I have an emergency ]
        [ I disagree with this amount ]
        [ I'll settle part of it now ]
```

| Path | Behaviour |
| --- | --- |
| **Robbed / lost** | Immediate escalation to a human, the block is **lifted**, a case is opened, and a police-report upload is offered. The amount stays outstanding as a debt, handled case by case. Nobody is locked out of their livelihood over a theft at 11 pm |
| **Emergency** | The block is lifted for 24 hours with a single tap. Logged. Limited to once per 30 days. A second use in the window routes to a human instead of being refused |
| **Disagree** | A dispute is opened with the order list shown line by line; the block is lifted while the dispute is open; the amount stays outstanding |
| **Partial** | The rider settles what they can; the remainder stays in `RIDER_CASH`; the rider can go online with a reduced cash limit equal to their remaining headroom. **Submission implemented (D151)**; the reduced ceiling is not yet read by dispatch |

Every one of these paths lifts the block. The block exists to collect money from people who have
it and are about to go home — not to punish people who do not.

> **"I'll settle part of it now" is the fourth button, and it is a flag rather than a number (D151).**
> `POST /v1/rider/cash/settle` still refuses a figure below the balance with `CASH_UNDERPAYMENT`, because the commonest
> cause of a short amount is a mistyped one and accepting it silently would forgive a thousand taka. `partial: true` is
> how the rider says this one is a choice: the claim is stored with `is_partial`, the remainder stays in `RIDER_CASH`, the
> reviewer's queue shows it as a part-payment, and approving it **releases the rider** — `§7` promises they may go online.
> The remainder is collected the slower way, by the weekly invoice gate ([`24 §6`](24-finance-payouts-invoices.md)).
> *Still open:* the "reduced cash limit equal to their remaining headroom". The dispatch ceiling of ৳3 500 exists
> (`DEFAULT_CASH_LIMIT_PAISA`) but reads a shift's collected cash, not the outstanding balance, so a part-paid rider is
> currently offered work at the full ceiling rather than a reduced one.

> **Two of the four buttons are built (D148–D149), and the two others are not.** `POST /v1/rider/cash/declare` with
> `{kind:"EMERGENCY", note?}` writes a `rider_cash_declarations` row with `lifted_until = now + 24 h` and **lifts the
> block for a day**; the debt is untouched, and the rider's next request opens the door the same way an escalation does.
> A second use inside thirty days still lifts — `§7` says it "routes to a human instead of being refused" — and marks the
> row `routed_to_review` with a `WARNING` audit so the morning's list has it first. `kind:"ROBBED"` and `kind:"DISPUTE"`
> `kind:"ROBBED"` is the same route with the opposite expiry (D149): the lift has **no end** (`lifted_until` null, which
> the read treats as "lifted" rather than "not lifted"), it always routes to a human, its audit row is `CRITICAL`, and it
> requires a sentence — somebody will ring the rider back, and "robbed" alone says nothing about when or where.
> `kind:"DISPUTE"` answers `501 NOT_IMPLEMENTED`: a disputed amount needs the order-by-order list `§7` describes, and
> that is a different rung. A rider who owes nothing gets `409` rather than a lift, because there is nothing to be unable
> to settle.
>
> Still open on this path: the **police-report upload** `§7` offers beside a robbery, and the case record a human would
> own. The declaration is the case's first row — `routed_to_review` is how a reviewer finds it — and the rest of that
> object does not exist yet.

---

## 8. Platform-fault escape hatches

| Situation | Behaviour |
| --- | --- |
| The server is unreachable at submission | Queued offline; the screen says so; the rider may close the app; it re-presents on reconnect |
| Review exceeds the **2-hour SLA** | The block **auto-lifts**. The settlement stays pending and the rider is told: *"We're taking too long. You can go back online; we'll confirm when we've checked."* An admin exception is raised |
| Review exceeds 12 hours | Escalated to `SUPER_ADMIN`, and the rider is called |
| The app crashes on the screen | State is persisted; it re-presents on relaunch with everything the rider already typed still filled in |
| A bug produces a wrong `cash_in_hand` | The "I disagree" path exists precisely for this, and the order-by-order list makes the error visible to both sides |

> **The "I disagree" path has its fuel (D150).** `GET /v1/rider/cash/breakdown` lists the deliveries that produced
> `cash_in_hand` — newest first, attributed by `order_assignments.end_reason = 'DELIVERED'` rather than by
> `orders.rider_id`, which is whoever holds the order *now* — and reports three numbers: `linesPaisa` (the deliveries,
> over the whole history), `collectedPaisa` (the balance) and `differencePaisa`. A non-zero difference is `§8`'s "a bug
> produces a wrong `cash_in_hand`", and it is shown to the rider rather than hidden: a screen that conceals a
> disagreement it already knows about is how a support call becomes an accusation. The declaration button for `DISPUTE`
> is still `501` — this route is what it will read from.

> **The two-hour rule is a rule about state, and the door applies it (D142).** There is no cron in this platform, so a
> deadline cannot *fire* anything: what a deadline can do is change what a door decides. `riders.shift_state` stays
> `CASH_LOCKED` until the rider next presents themselves, and at that moment `POST /v1/rider/shift/start` asks whether
> their pending claim has waited `AUTO_LIFT_MS`. If it has, the block lifts on the spot — one state write, one audit row
> with actor `SYSTEM` and the action `rider.cash.auto_lift`, severity `WARNING`, and the start proceeds. If it has not,
> the refusal is the ordinary `SHIFT_CASH_OVERDUE`. A rider who never submitted is blocked however long it has been,
> because the rule is about the platform's slowness and not about the rider's.
>
> `GET /v1/rider/cash` applies the same rule **without writing**: it answers `locked: false` and `autoLiftDue: true`, so
> the blocking screen never shows a rider a wall the platform has already dropped. Reads compute, doors write, and the
> first request after the deadline is the moment the lift becomes a fact. An unparseable `created_at` is treated as *not*
> due: releasing a block on the strength of a clock nobody could read is the one mistake this rule must not make, since
> the block is the platform's only collection mechanism and a rider's livelihood is on the other side of it.

The 2-hour auto-lift is the most important rule in this document. It converts the block from an
open-ended detention into a bounded procedure with the platform carrying the cost of its own
slowness.

---

## 9. Ledger

| Event | Postings |
| --- | --- |
| Order delivered | `RIDER_CASH:{id} +total` ([`24 §2.2`](24-finance-payouts-invoices.md)) |
| Settlement approved | `RIDER_CASH:{id} −amount`, `PLATFORM:BANK +amount`. Implemented (D143) — the first live caller of `postEntry` |
| Cash-out charge reimbursed | `PLATFORM:EXPENSE_PAYOUT_FEES +charge`, `RIDER:{id} −charge` |
| Shortfall written off | `PLATFORM:EXPENSE_CASH_LOSS +amount`, `RIDER_CASH:{id} −amount`. Requires `SUPER_ADMIN` and a reason |
| Shortfall recovered from a payout | `RIDER:{id} +amount`, `RIDER_CASH:{id} −amount`. Capped at 25% of a single payout, so a recovery never takes somebody's whole week |

`RIDER_CASH` is the live outstanding figure. A rider's weekly invoice cannot reach `VERIFIED`
while it is non-zero ([`24 §6`](24-finance-payouts-invoices.md)), which is the second, slower
collection mechanism behind the blocking screen.

---

## 10. Monitoring

| Metric | Target |
| --- | --- |
| Median time to settle after shift end | < 10 min |
| Median review time | < 15 min |
| SLA breaches (> 2 h) | 0 |
| Rejection rate | < 3% |
| Outstanding cash across the fleet | < ৳15 000 at any time |
| Settlements per rider with a mismatch | tracked; 3 in 30 days triggers a conversation |
| Auto-lifts | tracked as a **platform failure metric**, not a rider metric |
| Emergency declarations | counted, and *two per rider per 30 days* is a conversation rather than a statistic |

The last row matters: an auto-lift means admin review was too slow, and it is counted against the
operations team.

> **An escalation is not an auto-lift (D146).** Both release the rider, and only one is a failure. `autoLiftDue` is
> counted because nobody answered in two hours; `escalated` is a reviewer who answered and said "I need to look closer",
> which is the system working. The two are separate fields on the read for exactly that reason, and an escalated claim is
> never also counted as a breach even when it is three hours old.

---

## 11. Testing

| Test | Count |
| --- | --- |
| Trigger conditions | 14 |
| Block scope — every blocked and non-blocked action in §4.3 | 19 |
| Emergency reachability (SOS and dialler always work) | 6 |
| Tick timing, start, stop on typing, permanent stop on submit | 9 |
| Field validation, including TrxID uniqueness across history | 21 |
| Offline submission and replay | 11 |
| Idempotency — double submit produces one settlement | 5 |
| Admin decisions, all four, with ledger assertions | 24 |
| Rejection reasons, all nine, with the correction path | 18 |
| Partial and disputed paths, all four | 16 |
| **Auto-lift at 2 hours** | 4 |
| Crash recovery with field persistence | 7 |
| Ledger closure for every settlement path | 12 |
| Cash-out charge arithmetic against the tariff table | 10 |

---

## 12. Reading on

Next: [`26-media-pipeline.md`](26-media-pipeline.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
