# 04 · Partner & Rider Operator Surface Analysis (`PARTNER_APP` + `RIDER_APP`)

> **Plan Response 2 Deliverable (`UNDAL-MASTER-GUIDE/27-builder-protocol-32-responses.md`)**  
> **Visual Inspection Coverage:** **107 / 107 operator reference files (`100.0%`)** visually inspected via `read_file` across `reference-images/PARTNER_APP/` (`63` files) and `reference-images/RIDER_APP/` (`44` files). Combined with Plan Response 1 (`65` customer files), **all 172 / 172 files across the entire repository have been visually examined.**  
> **Companion Per-Image Catalogues (`≤ 500` lines rule):**
> - [`04a-partner-screens-01-32.md`](./04a-partner-screens-01-32.md) — `PARTNER_APP` `#01–#32` (Live Orders, Overview, Analytics, Hours, Reviews, Disputes, Redacted Branch Settings, Menu Categories/Products/Options)
> - [`04b-partner-screens-33-63.md`](./04b-partner-screens-33-63.md) — `PARTNER_APP` `#33–#63` (Sizes/Bundles/Availability Timers, Real Golden Orders `ewf1` & `#155`, Invoice `#200072968311`, Store Status Modes, Play Store Cards)
> - [`04c-rider-screens-01-44.md`](./04c-rider-screens-01-44.md) — `RIDER_APP` `#R01–#R44` (Zone Polygon, Selfie Liveness, Cash-Wallet Suspensions, Offer Ring, Pickup Feedback, COD Change Request, H3 Heatmap, Wallet vs Earnings)

---

## 1. File-Count & Format Reconciliation Audit (`107` Total Files)

| Directory | Count in `00-START-HERE.md` | Actual Files on Disk | Exact Explanation Verified Visually |
|---|---:|---:|---|
| `reference-images/PARTNER_APP` | `58` | **`63`** (`+5`) | Contains `55` authentic Partner screenshots (`53` tablet captures + `2` late-session store-status captures `155525.png` & `155538.png`), `2` Partner Play Store promo cards (`unnamed (1).webp`, `unnamed.webp`), and **`6` mis-filed Uber Driver Play Store mockups** (`unnamed (2..6).webp`, `unnamed (9).webp`). Every single file was inspected and classified. |
| `reference-images/RIDER_APP` | `44` | **`44`** (`0` delta) | Contains `1` `.avif` frame (`Screenshot-2022-10-13-at-11_55_26-AM.avif`, converted via ImageMagick for full visual inspection) + `28` real Bangladesh rider shift/pickup/chat/navigation captures + `15` Play Store / help-centre reference frames. |
| **Operator Subtotal** | `102` | **`107`** | **100% visually opened and mapped (`0` skipped files).** |
| **Grand Repo Total** | `167` | **`172`** | **172 / 172 visually inspected across Plan Responses 1 & 2.** |

**Privacy & PII Compliance (`File 09 §9.3`):** Screenshots `#24–#27` (`130227.png`–`130302.png`), `#43` (`142135.png`), and `#R07` (`153238.png`) display real owner/rider personal names, emails, street house numbers, and Bangladeshi mobile numbers. All personal identifiers are strictly **redacted (`[REDACTED]`)** across all Undal repository documentation and **never** copied into seed fixtures or tests.

---

## 2. Empirical Discoveries from Live Bangladesh Operator Screenshots

### 2.1 Real Bangladesh Orders Confirm Undal's Exact Golden Math Vectors (`File 10`, `Appendix F`)
1. **Live Order `#155 · cdo6-2643-bb0v` (`#46–#53`, `143532.png`–`144016.png` → Golden Vector `M-1`):**
   - Items: `1× Crispy Fried Chicken ৳141.00 + 1× Fried Rice ৳176.00 + 1× Chicken Bhuna ৳224.00 = ৳541.00`.
   - 20% Vendor Promo: `-৳108.20` → Food Subtotal **`৳432.80`**. With `৳0` delivery promo + **`৳5.00` Undal Platform Fee (`500` poisha)** → Customer COD = **`43,780` poisha (`৳437.80`)** — matching `Appendix F` Vector `M-1` to the single poisha.
   - **Operational Failure Caught Live (`#46` → `#53`):** Kitchen marked `#155` **Ready at `14:21`**, yet at `14:35` rider was still `6 mins` away, `14:37` `2 mins` away, and finally picked up at **`14:40` (`19 minutes` food cooling on counter!)** with **zero button for the kitchen to call/chat the assigned rider**. Undal `p-11` adds a live rider ETA badge + **1-tap Call / In-App Chat Rider** button + dispatch escalation alert if pickup lags ready-time by `> 8 min`.
2. **Completed Order `cdo6-2642-ewf1` (`#39`, `190131.png` → Golden Vector `M-5`):**
   - Gross Subtotal `৳2,705.00`, 20% Vendor Discount `-৳541.00` → Net Food `৳2,164.00`.
   - **Competitor Predatory Math Caught Red-Handed:** Competitor charged `-৳676.25` commission — **25% calculated on the pre-discount `৳2,705.00` gross** rather than the `৳2,164.00` actually paid! After `-৳101.44` VAT on commission, vendor kept only `৳1,386.31` (**`51.2%`**).
   - **Undal Fair Math (`File 10 §10.2`):** Commission (`15%`) applies strictly to **discounted food payable (`216,400 × 15% = 32,460` poisha = `৳324.60`)** with zero surprise commission-VAT add-on → Vendor receives **`৳1,839.40` (`+৳453.09` higher payout on the exact same order!)**.
3. **Weekly Payout Statement `#200072968311` (`#43–#44`, `142135.png`–`142141.png`):**
   - On `৳7,350.00` gross food sales (`৳5,880.00` after vendor promos), competitor deducted `-৳1,865.59` commissions + **`-৳730.33` unitemised `"Additional charges"`** + `-৳316.36` tax, paying out just **`৳2,967.72` (`49.5%` effective take-rate)**.
   - **Undal Law (`D-12`, `File 23`):** Zero CPC ad deductions, zero mystery `"Additional charges"` — every single poisha on an Undal invoice links 1:1 to an immutable `invoice_lines` order row or reason-coded `penalties_adjustments` entry with evidence.

### 2.2 Counter Handover & COD Cash-Gate Empirical Proof (`#R08`, `#R14–#R20`, `#R32`)
1. **`Payment: No payment at vendor` (`#R14–#R15`, `153731.png`–`153746.png`):** Confirms our exact Question #1 default directly from live Dhaka/Sylhet rider screens — riders exchange **zero cash at restaurant counters**, verifying handover exclusively via **HMAC QR scan (`D-22`)**, keeping lines moving fast.
2. **Real Suspension History `"Exceeding cash in wallet"` (`#R08`, `153301.png`):** Real Bangladesh rider screenshot shows automatic suspension `From 11.02.2024 until 12.02.2024` for exceeding COD cash ceiling! Undal (`File 23 §23.4`) makes this proactive and humane: a persistent **Cash-in-Hand gauge (`৳X / ৳5,000 ceiling`)** warns at `75%` (`৳3,750`) and guides instant `bKash/Nagad TrxID` submission before lockout strikes.
3. **COD Change Denomination Request (`#R20`, `154059.png`):** Live rider drop-off screen displays `(Customer requested change for X Tk)`. Added to `orders.change_for_poisha` (`ADR-0005`) so customers paying with a `৳500` or `৳1,000` note notify the rider before arrival (`"Bring ৳562 change"`).

---

## 3. Operator Anti-Patterns Eliminated (`AP-O1` → `AP-O10`)

| Code | Anti-Pattern Observed in Reference Screenshots | Evidence | Undal Architectural Fix |
|---|---|---|---|
| **AP-O1** | **Web-Tab Inactivity Auto-Closing Live Kitchens** (`"Ready to reopen? You were inactive..."`) | `#54` (`155525.png`) | Native Android `UndalAlarmService` + data-only FCM (`File 07`); kitchens stay open across screen-off and loud kitchen noise. |
| **AP-O2** | **Commission Charged on Pre-Discount Gross Food Price** | `#39` (`190131.png`) | `File 10 §10.2`: commission applies strictly to `food_payable = items - discount_vendor` (and `Flash Box` protects vendor net). |
| **AP-O3** | **Opaque CPC Ad Tax (`pandaclicks` 6% budget push + mystery invoice deductions)** | `#10–#12`, `#43` | `D-12`: **Zero paid ads anywhere in Undal.** Organic transparent `rank_v1` (`File 13`) shows partners exact operational tips to rank higher for free. |
| **AP-O4** | **Out-of-Order Timeline Events & Retroactive Post-Delivery Full Zero-Out (`৳0.00`)** | `#42` (`190424.png`) | Monotonic `order_events.id` sequence (`Picked up 11:04` can never appear before `Arrived store 11:14`!), strict state machine (`DELIVERED` never mutates to `CANCELLED`), and 48h evidence-backed Partner Dispute window (`p-16`, `8.disputes`). |
| **AP-O5** | **7 Identical Unlabelled `"Choose one of the following"` Option Groups** | `#32` (`130618.png`) | `option_groups.internal_label` + inline `"Used in: [Chicken Bhuna] [Combo 1]"` dish pills (`p-21`). |
| **AP-O6** | **Punitive Pre-Booked Shift Lockouts (`"You are late! Your booked shift started 6 min ago"`)** | `#R03` (`153058.png`) | Flexible on-demand **`Go Online` / `Go Offline`** (`r-06`, `File 18`) gated only by safety/selfie readiness and COD cash gate — zero shift-booking bureaucracy on free tier. |
| **AP-O7** | **Unexplained Low Offer Payout (`30.34 Tk` / `41.72 Tk` with zero formula transparency)** | `#R10`, `#R28` | Every offer card (`r-09`) displays total poisha/Taka **plus `"Why this fare? ⓘ"`** itemising base, km, zone SDR surge, weather %, traffic block, and 3% food bonus (`File 11`). |
| **AP-O8** | **Solo-Rider Hard `"Decline"` Stranding Active Kitchen Orders** | `#R10` (`153433.png`) | `D-23` Solo-Rider Guard: when `candidates_count == 1`, `Decline` becomes **`Request Dispatch Reassignment`** while notifying Ops immediately (`OFFER_NOT_REJECTABLE`). |
| **AP-O9** | **Weak Modal Tap `"Confirm pickup?"` Causing Wrong-Bag Handovers** | `#R19` (`154022.png`) | Mandatory **HMAC QR scan (`D-22`)** on counter tablet/receipt (`POST /v1/orders/{id}/pickup-verify`) with audited 4-digit fallback. |
| **AP-O10** | **Confusing Mixed-Sign `"Wallet"` Combining COD Debt (`-481 Tk`) with Earnings (`+1378 Tk`)** | `#R32` (`images (1).png`) | Split cleanly in `r-21..r-24` into **(1) COD Cash Held (`Owed to Undal`)**, **(2) Your Earned Delivery Fares + Tips**, and **(3) Net Friday Payout / Remittance Due**. |

---

## 4. Mapping Summary to Canonical `Appendix A` Operator Screens (`66` Screens)

- **`apps/partner_app` (`37` screens `p-01` → `p-37`, built in `Build Responses 16–19`):**
  - **Auth & 3-Track KYC (`p-01..p-05`):** Splash/lang → Phone/Email login → Track chooser (`Restaurant` / `Home Kitchen` / `Cloud Kitchen` per `D-14`) → Step-saved KYC wizard (`private` bucket uploads) → Verification status tracker.
  - **Device Alarm Readiness (`p-06..p-07`):** Mandatory battery/overlay/sound checklist + **Play Live Test Alarm** button (`/v1/alerts/test`) proving `STREAM_ALARM` audio + full-screen wake before kitchen can open.
  - **Live Kitchen Console (`p-08..p-16`):** Bottom nav **`Orders | Menu | Finance | Performance | Store`**; full-screen incoming COD order ring (`Accept +15/+25/+35m` or guarded `Reject`), active stage tabs (`Preparing` / `Ready` / `Handed Over`), live Rider ETA + Call/Chat CTA, **HMAC Pickup QR screen (`p-13`)**, order detail waterfall + timeline (`p-15`), 1-tap Partner Dispute drawer (`p-16`).
  - **Menu Studio (`p-17..p-24`):** Category manager (`Regular` vs `Combo` + daypart schedule), item list with 1-tap availability timer (`Until tomorrow` / `2h` / `Indefinite` per `#38`), duplicate-dish warning guard (`AP-9`), sized variants, labelled option groups, bundle slot builder, kitchen photo quality guide + ImgBB upload via `W1`.
  - **Store Operations, Promos & Weekly Settlement (`p-25..p-37`):** 3-mode Store Status (`Open` / **`Busy +10/+15/+20m`** / `Paused`), split-shift weekly hours + Ramadan/Eid overrides, Flash Box opt-in (`D-11`), transparent organic ranking tips (`D-12` replacement for Ads!), sales & prep analytics, line-by-line weekly Saturday invoices + PDF download + payout account setup (`bKash/Nagad/Bank`), staff roles (`Owner` vs `Kitchen Staff`), EN/বাংলা toggle.
- **`apps/rider_app` (`29` screens `r-01` → `r-29`, built in `Build Responses 20–22`):**
  - **Auth & Vehicle/Age KYC (`r-01..r-05`):** Splash/lang → Login / `Apply Now` → `Motorbike` (`Track A`: DL + Reg + Tax Token) vs `Bicycle` (`Track B`: NID/Birth Cert **hard age ≥ 18 gate**) → Document/selfie capture → Application status.
  - **Pre-Flight Session Gate & Online Heatmap (`r-06..r-08`):** Pre-shift checklist (GPS accuracy, battery whitelist, live alarm test, thermal bag + vehicle check, periodic selfie liveness, **Cash Gate clear check**) → `Go Online` OSM map showing active zone polygon + green/amber H3 demand hexagons (`60s` cache).
  - **Incoming Offer & Active Delivery (`r-09..r-19`):** Full-screen `STREAM_ALARM` offer card (`৳` payout + `"Why this fare? ⓘ"` + pickup/drop km & min + `D-23` solo guard) → Navigate to kitchen (`geo:` intent) → Arrived Vendor → Pickup item checklist + **Scan HMAC QR (`r-13`)** + optional anonymous 2-tap Pickup Feedback (`#R16`) → Navigate to customer + COD `Collect ৳X (Change for ৳Y)` banner + Banglish/Photo in-app chat (`r-16`) → Confirm COD Collected & Delivered (`r-18`) OR **Customer Unreachable Protocol (`r-19`: 2 call logs + `≥120s` GPS dwell timer + doorstep/gate photo)**.
  - **Cash Gate, Earnings & Support (`r-20..r-29`):** Real-time COD Cash Ceiling gauge (`r-20`), `bKash/Nagad TrxID` + screenshot remittance submission (`r-21`), remittance verification history (`r-22`), daily/weekly fare breakdown + Friday settlement invoices (`r-23..r-25`), batch sequence view (`r-26`), performance & safety centre (`r-27..r-29`).
