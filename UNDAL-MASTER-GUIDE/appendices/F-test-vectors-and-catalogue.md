# Appendix F · Golden Vectors (computed) + Test Catalogue (seeds for file 26)

Money/fare tables below were **computed by executing the guide formulas** (files 10/11) during guide generation.
Builder encodes every row as automated tests in SQL + TypeScript + Dart; all three must agree poisha-for-poisha.

## Money waterfall vectors (৳) — commission 15%, tax 5/105 extraction, rider bonus 3%

| Case | Items | Discount V/P | Food payable | Tax extr. | Commission | Rider bonus | Vendor net | COD collect |
|---|---|---|---|---|---|---|---|---|
| M-1 reference #155 mirror | 541.00 | 108.20/0.00 | 432.80 | 20.61 | 64.92 | 12.98 | 367.88 | 437.80 |
| M-2 no discount delivery | 300.00 | 0.00/0.00 | 300.00 | 14.29 | 45.00 | 9.00 | 255.00 | 365.00 |
| M-3 Flash Box 25% platform-funded half | 400.00 | 50.00/50.00 | 300.00 | 14.29 | 45.00 | 9.00 | 305.00 | 325.00 |
| M-4 pickup (no fee) | 250.00 | 25.00/0.00 | 225.00 | 10.71 | 33.75 | 6.75 | 191.25 | 225.00 |
| M-5 big order ৳2,705 disc 541 vendor | 2,705.00 | 541.00/0.00 | 2,164.00 | 103.05 | 324.60 | 64.92 | 1,839.40 | 2,299.00 |
| M-6 tiny order | 99.00 | 0.00/0.00 | 99.00 | 4.71 | 14.85 | 2.97 | 84.15 | 154.00 |
| M-7 voucher platform 100% 110 cap | 350.00 | 0.00/110.00 | 240.00 | 11.43 | 36.00 | 7.20 | 314.00 | 295.00 |
| M-8 free-delivery promo | 180.00 | 18.00/0.00 | 162.00 | 7.71 | 24.30 | 4.86 | 137.70 | 167.00 |

## Rider fare vectors — base incl. 2 km, deadhead 50%, traffic block ৳4/5 min

| Case | Billable | Surge | Weather | Traffic | Batch | Fare |
|---|---|---|---|---|---|---|
| F-1 motorbike rain busy (guide ex.) | 2.4 km | x1.675 | rain | delay 12m | batch 1 | **৳135.84** |
| F-2 bicycle short clear calm | 0.3 km | x1.0 | clear | delay 0m | batch 1 | **৳30.00** |
| F-3 motorbike storm severe shortage | 5.5 km | x1.967 | storm | delay 16m | batch 1 | **৳306.61** |
| F-4 batch 2nd order | 2.4 km | x1.675 | rain | delay 12m | batch 2 | **৳111.72** |
| F-5 bicycle heat moderate | 1.7 km | x1.333 | extreme_heat | delay 7m | batch 1 | **৳60.61** |
| F-6 free supply long motorbike | 9.5 km | x1.0 | clear | delay 3m | batch 1 | **৳163.00** |

## Test catalogue (seed set — builder expands per Build Response)

| ID | Area | Case | Expected |
|---|---|---|---|
| ORD-01 | Orders | Place COD order -> PLACED + vendor FCM + RTDB room exist | event ledger has 1 entry |
| ORD-02 | Orders | Vendor unreachable 120s with stale presence | auto-cancel VENDOR_UNREACHABLE, customer notified |
| ORD-03 | Orders | Double-tap place order (same Idempotency-Key) | exactly 1 order |
| ORD-04 | Orders | Cancel after PREPARING by customer | request flow, no instant cancel |
| DSP-01 | Dispatch | Best-score rider rejects with backup present | next rider offered, reason stored |
| DSP-02 | Dispatch | Solo rider attempts reject | button = Request reassign path (D-23) |
| DSP-03 | Dispatch | Two orders same vendor close drops | single bundled offer (batch economics F-4) |
| DSP-04 | Dispatch | Bicycle + 5km loaded leg | never offered (radius guard) |
| MNY-01 | Money | Golden vectors M-1..M-8 in SQL+TS+Dart | poisha-identical |
| MNY-02 | Money | Invoice double generation same period | one invoice, totals stable |
| MNY-03 | Money | Ledger conservation fuzz 10k random baskets | identities hold (file 26) |
| MNY-04 | Money | Duplicate bKash TrxID remittance | rejected unique violation |
| ALM-01 | Alarm | FCM payload builder snapshot | no notification key, high priority |
| ALM-02 | Alarm | Device: swiped/locked/DND whitelisted | loop starts <=5s (evidence sheet) |
| ALM-03 | Alarm | alert_cancel after accept-other-device | loop stops <2s |
| RT-01 | Realtime | 30-order simulation connection audit | within file-06 budget; polling fallback engages on kill |
| SEC-01 | Security | Customer reads vendor KYC doc URL | denied (RLS + signed URL gate) |
| SEC-02 | Security | ImgBB key absent from APK strings/repo scan | gitleaks clean |
| QR-01 | QR | Replay used pickup QR nonce | rejected |
| QR-02 | QR | Wrong rider scans QR | rejected loudly |
| WEB-01 | Web | View-source /r/{slug} | menu HTML present (no empty shell) |
| WEB-02 | Web | 240px width all key pages | no horizontal scroll |
| KYC-01 | KYC | Home kitchen without trade license | submittable (D-track), restaurant blocked |
| KYC-02 | KYC | Rider age 17 from NID DOB | hard block |
| RNK-01 | Ranking | Paid-boost attempt via settings | no such lever exists (D-12) |
| RNK-02 | Ranking | New vendor cold start | prior = zone median, New slot eligible |
| OFF-01 | Offline | Partner accept while offline -> reconnect | outbox replay succeeds once |
| OFF-02 | Offline | Offline delivered-mark on cancelled order | reconciled with human message, not applied |
| CSH-01 | Cash gate | Shift end with cash>0 | gate blocks new session; support path visible |
| CSH-02 | Cash gate | Partial remittance verified | remainder still gated |