<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 23 — Onboarding and KYC

> Four onboarding tracks — restaurant, home/cloud kitchen, motorbike rider, bicycle rider — each
> exactly as the brief enumerated them. This document specifies every field, every document, every
> validation, the review queue, and the rejection paths. Getting supply onto the platform is the
> hardest problem a marketplace has; a confusing signup form is how it fails.

---

## 1. Principles

| Principle | Consequence |
| --- | --- |
| **Save at every step** | Progress persists server-side. Closing the app loses nothing, ever |
| **Ask once** | A field captured in step 2 is never re-asked in step 7 |
| **Explain every request** | Every document says why it is needed and who will see it |
| **Never block on a judgement call** | An applicant who fails an automated check goes to human review, not to a dead end |
| **Honest timelines** | "Most applications are reviewed within 24 hours" — and the SLA is measured and published in the panel |
| **Bilingual throughout** | Every label, hint, error and rejection reason in English and Bengali |
| **Work on a cheap phone** | Documents are captured with the camera, compressed on-device, and upload over 3G |

---

## 2. Where documents go

Per the brief, two destinations with a hard rule:

| Destination | Contents | Access |
| --- | --- | --- |
| **imgbb** | Everything public: vendor cover and logo, menu item photos, rider profile photo, **shift selfies** | Public URLs; no personal document ever goes here |
| **Cloudinary** | Everything sensitive: NID front and back, driving licence, vehicle registration, trade licence, bank statements, invoices, dispute evidence | Unsigned upload preset into a restricted folder; delivery through signed, expiring URLs only |

[`26`](26-media-pipeline.md) specifies the pipeline. The rule is enforced by a code-level
constraint: the imgbb client refuses any upload whose `MediaKind` is marked sensitive, and a test
asserts that every sensitive kind routes to Cloudinary.

---

## 3. Track A — Restaurant

Eleven steps. Estimated completion time: 18 minutes with documents to hand.

### Step 1 — Account
Name · phone (`+880`, operator-prefix validated) · email (optional) · password · language.
No OTP, no email verification.

### Step 2 — Business identity
| Field | Validation |
| --- | --- |
| Restaurant name (English) | 2–60 chars; duplicate-name warning within 2 km |
| Restaurant name (Bengali) | Optional; auto-transliteration offered |
| Business type | Restaurant / Fast food / Café / Bakery / Sweet shop / Juice bar / Tea stall |
| Year established | Optional |
| Owner's full name | As on NID |
| Owner's NID number | 10, 13 or 17 digits — all three real Bangladeshi formats |
| Owner's date of birth | ≥ 18 years |

### Step 3 — Location
OSM map with a draggable pin, a search box (Nominatim, attributed), and "use my current location".
Then: street address, area, city, postcode (optional), and a landmark — **the landmark field is
required**, because in Sylhet a landmark finds a door faster than an address.

The pin is validated to be inside an active delivery zone. If it is not, the applicant is told
honestly: *"Undal isn't live in your area yet. We'll save your application and contact you when we
are."* — and the application is genuinely saved and genuinely surfaced in the panel's waitlist.

### Step 4 — Service area
Default: the intersection of the zone and a 5 km radius. The vendor may shrink it — freehand, a
radius slider, or by deselecting areas — but never grow it beyond the zone.

### Step 5 — Cuisines
> *"100+ cuisine categories with search."*

A searchable, multi-select grid of **118 categories** across 9 families:

| Family | Examples |
| --- | --- |
| Bangladeshi (24) | Kacchi biriyani, tehari, morog polao, bhuna khichuri, shutki, bhorta, panta-ilish, mezban beef, Sylheti satkora, haleem, chui jhal, kala bhuna |
| Indian subcontinental (14) | North Indian, Mughlai, Hyderabadi, Punjabi, tandoori, South Indian, Kolkata street |
| Chinese & East Asian (13) | Chinese, Thai, Korean, Japanese, sushi, ramen, momo, Indo-Chinese |
| Fast food & Western (17) | Burgers, pizza, fried chicken, sandwiches, pasta, steak, shawarma, hot dogs |
| Middle Eastern (8) | Arabian, Turkish, Lebanese, kebab, mandi, kabsa |
| Breakfast & bakery (13) | Paratha-bhaji, luchi, bakery, cake, pastry, bread, donuts, croissant |
| Snacks & street (12) | Singara, samosa, fuchka, chotpoti, jhalmuri, chop, rolls, pitha |
| Sweets & desserts (10) | Mishti, roshogolla, firni, falooda, ice cream, kheer, jilapi |
| Drinks (7) | Tea, coffee, juice, lassi, borhani, smoothies, shakes |

Search matches English, Bengali, and transliteration variants from the 340-entry synonym table
([`13 §5`](13-ranking-personalization.md)). Minimum 1, maximum 6 — a restaurant claiming twelve
cuisines is claiming none.

### Step 6 — Hours
The weekly grid from [`18 §6`](18-partner-app.md), with a "same as Monday" copy action.

### Step 7 — Documents
| Document | Required | Destination |
| --- | --- | --- |
| NID front | **Yes** | Cloudinary |
| NID back | **Yes** | Cloudinary |
| Owner's photo (selfie holding NID) | **Yes** | Cloudinary |
| Trade licence | If the business is registered | Cloudinary |
| TIN certificate | Optional | Cloudinary |
| Food safety / BSTI certificate | Optional; raises the trust score | Cloudinary |
| Restaurant exterior photo | **Yes** | imgbb |
| Kitchen photo | **Yes** | Cloudinary (it can contain staff) |
| Cover photo | **Yes** | imgbb |
| Logo | Optional | imgbb |

Each capture screen has a framing guide, an on-device quality gate (blur, glare, all four corners
visible, minimum resolution), and a retake loop. A document failing the gate three times is
accepted anyway and flagged for manual review — the gate is an assistant, not a gatekeeper.

### Step 8 — Payout account
bKash (recommended) / Nagad / bank. Account name must match the owner's NID name; a mismatch is
allowed but flagged for review with the reason captured.

### Step 9 — Menu
Minimum 5 items to go live. Add items inline, or import a CSV, or — the path most vendors take —
photograph a printed menu and let an admin transcribe it, which is offered explicitly with a
24-hour turnaround.

Each item: name, price, category, optional photo and description.

### Step 10 — Device setup
The alarm permission checklist, OEM coaching, and the live self-test from
[`15 §7`](15-wakeup-alarm-fcm.md). **This step cannot be skipped.** An approved vendor whose device
cannot ring is a vendor who will miss orders in week one.

### Step 11 — Review and submit
A full summary, every section editable, the commission structure in plain numbers
(15% commission + 3% rider bonus + 5% tax on the platform's own fees, with a worked example on a
৳500 order), the agreement, and submit.

---

## 4. Track B — Home / cloud kitchen

Nine steps. Differences from Track A:

| Step | Difference |
| --- | --- |
| Business identity | No trade licence required. "Kitchen name" rather than restaurant name |
| Location | The home address is captured but **never shown to customers** — only the area name is public. This is stated prominently, because it is the single biggest hesitation a home cook has |
| Service area | Default 3 km, maximum 5 km |
| Cuisines | Same 118, maximum 4 |
| Capacity | Orders per hour (1–20) and a daily cap — home kitchens need a real ceiling, and the dispatch engine respects it as a hard filter |
| Documents | NID front/back and selfie-with-NID required. Kitchen photo required. **No** trade licence, **no** BSTI |
| Food safety | A short, genuinely useful guide — storage temperatures, separate boards, packaging for transport — with an acknowledgement |
| Menu | Minimum 3 items |
| Device setup | Identical and equally mandatory |

Home kitchens get the same cold-start ranking boost, the same commission, and the same payout
schedule. The only structural differences are the capacity cap and the address privacy.

---

## 5. Track C — Motorbike rider

Thirteen steps.

### Steps 1–3 — Account, personal, address
Name, phone, email (optional), password · father's/mother's name, date of birth (**≥ 18**,
enforced by a database CHECK), gender, blood group (optional, genuinely useful in an accident),
emergency contact name and number · present and permanent address.

### Step 4 — NID
Number and both sides photographed. The number is validated for format and checked for an existing
account — a duplicate NID blocks registration and routes to support, which is the primary defence
against the "delete and re-register to reset my stats" attack
([`09 §12`](09-undal-brain-overview.md)).

### Step 5 — Driving licence
> Required for motorbike riders.

Number, category, issue and expiry dates, both sides photographed. **An expired licence blocks
approval.** The expiry is stored and the rider is reminded at 60, 30 and 7 days; at expiry, the
account moves to `DOCUMENT_EXPIRED` and cannot start a shift until renewed. This is not
negotiable — an unlicensed rider is a liability the platform cannot carry.

### Step 6 — Vehicle
Make, model, year, engine capacity, colour, registration number (Bangladeshi plate format
validated), and photos of the vehicle and the plate.

### Step 7 — Registration and insurance
Registration document required. Insurance optional but recorded, with its expiry tracked the same
way.

### Step 8 — Photo
A clear face photo for the customer-facing profile. imgbb, since it is public. The guide explains
it will be shown to customers, which is why it should be a real photo of their face.

### Step 9 — Zone and availability
Preferred zone, preferred hours, and the commitment: **minimum 4 hours a day, 5 days a week**,
shown as a calculator — *"4 hours × 5 days ≈ ৳4,000–6,000 a week at current rates in your zone"* —
using real recent data from that zone rather than an invented figure.

### Step 10 — Payout account
bKash recommended. The brief's note is surfaced here: *"We send money to bKash. Cash-out charges
are included in what we send, so you receive the full amount."*

### Step 11 — Cash settlement agreement
An explanation of the COD flow before they ever face it: cash collected belongs to Undal, the
৳3 500 limit, end-of-shift settlement, the blocking screen, and the admin approval step. With a
worked example. A rider surprised by the blocking screen on day one is a rider who quits on day
one.

### Step 12 — Device setup
Permissions, OEM coaching, the alarm self-test, and a battery-optimisation check. Mandatory.

### Step 13 — Review and submit

---

## 6. Track D — Bicycle rider

Eleven steps. Differences from Track C:

| Step | Difference |
| --- | --- |
| **No driving licence** | Not applicable |
| **No registration or insurance** | Not applicable |
| Vehicle | Bicycle type (city / mountain / hybrid / delivery), colour, a photo |
| Delivery box | Required: an insulated box or bag, photographed. The onboarding explains why — food temperature is the product |
| Radius | **Locked to 3–4 km**, stated clearly with a map showing the actual area they will serve |
| Earnings calculator | Uses the bicycle rate of 8৳/km and real zone data |
| Age | ≥ 18, same as motorbike |
| Fitness acknowledgement | A short, non-medical acknowledgement that the work is physical |

Everything else — NID, photo, zone, commitment, payout, cash agreement, device setup — is
identical.

---

## 7. Validation

| Field | Rule |
| --- | --- |
| Phone | `+880` + `1[3-9]` + 8 digits. Uniqueness across all roles |
| NID | 10, 13 or 17 digits. Uniqueness within role. Checksum where the format defines one |
| Date of birth | ≥ 18 years, ≤ 80 years |
| Licence expiry | Must be in the future at submission |
| Plate | `[A-Z]{2,3}-[A-Z]{1,4}-\d{2}-\d{4}` with the common Bangladeshi variants accepted |
| Email | RFC-shaped; optional everywhere |
| Password | ≥ 8 chars, not in the bundled 10 000-common list |
| Location pin | Inside an active zone, or routed to the waitlist |
| Document images | ≥ 800 px on the short edge, < 8 MB before compression, JPEG/PNG/HEIC |
| Bank account | Length and format by bank; bKash and Nagad validated as 11-digit numbers |

Validation is **both** client-side (immediate, inline, in the user's language) and server-side
(authoritative). The client never shows a rule the server does not enforce, and the server never
enforces a rule the client did not warn about.

---

## 8. The review queue

```
  KYC QUEUE                                    14 pending · SLA 24h
  ┌─────────────────────────────────────────────────────────────────┐
  │ ⏱ 3h   Rahman's Biriyani House   Restaurant   Sylhet   [Review] │
  │ ⏱ 7h   Karim Rahman              Motorbike    Sylhet   [Review] │
  │ ⏱ 19h  Nasrin's Kitchen          Home kitchen Sylhet   [Review] │
  │ 🔴 26h Shahin Ahmed              Bicycle      Sylhet   [Review] │  ← SLA breached
  └─────────────────────────────────────────────────────────────────┘
```

### 8.1 The review screen

A three-pane layout: the document viewer (zoom, rotate, side-by-side comparison), the extracted
field values, and the decision panel. Each field is individually approved or rejected with a
reason, so an application is never rejected wholesale for one bad photograph.

Automated pre-checks run before a human sees it and are shown as advisory flags:

| Check | Flag |
| --- | --- |
| Duplicate NID | **Blocking** |
| Duplicate phone | **Blocking** |
| Duplicate bank account | Advisory — families share accounts |
| Licence expired | **Blocking** for motorbike |
| Age under 18 | **Blocking** |
| Document quality below threshold | Advisory |
| Name mismatch between NID and payout account | Advisory |
| Location outside any zone | Routes to waitlist |
| Address clustering with existing accounts | Advisory, with the cluster shown |
| Device failed the alarm self-test | Advisory, with a strong recommendation to resolve first |

### 8.2 Decisions

| Decision | Effect |
| --- | --- |
| **Approve** | Account activated, welcome notification, first-order guidance. Vendors appear in ranking within 60 seconds |
| **Approve with conditions** | Active but limited — e.g. a home kitchen capped at 5 orders/day until the first 20 complete |
| **Request changes** | Specific fields marked, with a reason per field. The applicant gets a notification and resumes at exactly those fields, keeping everything else |
| **Reject** | A reason from a controlled vocabulary plus free text. Re-application allowed after 30 days, or immediately if the reason is correctable |

Every decision is audited with the reviewer, the timestamp, the reason, and a snapshot of what
they saw.

### 8.3 Rejection reasons

`DOCUMENT_ILLEGIBLE` · `DOCUMENT_EXPIRED` · `DOCUMENT_MISMATCH` · `IDENTITY_UNVERIFIED` ·
`DUPLICATE_ACCOUNT` · `UNDERAGE` · `OUTSIDE_SERVICE_AREA` · `PROHIBITED_BUSINESS` ·
`INSUFFICIENT_MENU` · `VEHICLE_UNSUITABLE` · `NO_DELIVERY_BOX` · `FAILED_BACKGROUND_CHECK` ·
`APPLICANT_WITHDREW` · `OTHER`

Each has a bilingual customer-facing explanation and, where applicable, a "how to fix this"
paragraph. A rejection that does not tell someone how to succeed is a rejection that wastes
everyone's time.

---

## 9. After approval

| Audience | First-week experience |
| --- | --- |
| **Vendor** | A guided first-order walkthrough; a simulated order in a sandbox mode so the first real alarm is not the first alarm they have heard; the 21-day cold-start boost explained; a day-3 check-in; a day-7 performance review with the single highest-impact improvement |
| **Rider** | A first-shift walkthrough; the first offer annotated with what each number means; a day-1 cash-settlement rehearsal before real money is involved; a day-7 earnings review |

The **sandbox order** is worth specifying: a vendor's very first alarm should happen when they are
expecting it, sitting down, with nothing at stake. It uses the real FCM path, the real alarm, and
the real accept flow against a synthetic order that never reaches a customer. It is the single
highest-value onboarding step, and it is not seed data — it is created on demand, by the vendor,
and deleted immediately after.

---

## 10. Document lifecycle

| Stage | Behaviour |
| --- | --- |
| Upload | Compressed on-device to ≤ 1 600 px long edge, ≤ 85% JPEG quality, EXIF stripped except orientation |
| Storage | Cloudinary, restricted folder, `access_mode: authenticated` |
| Delivery | Signed URLs, 5-minute expiry, generated per view, audited |
| Retention | Held while the account is active; 90 days after offboarding, then deleted |
| Shift selfies | **30 days**, then deleted. A rolling deletion runs on request-triggered housekeeping |
| Expiry tracking | Licence, registration and insurance expiries are tracked with 60/30/7-day reminders |
| Re-verification | Annual re-submission of NID and licence, with a 30-day grace |
| Access | Viewing any document writes an audit row with the viewer, the subject, and the reason |

---

## 11. Testing

| Test | Count |
| --- | --- |
| Field validation, every field, valid and invalid | 184 |
| Step persistence — kill the app at every step and resume | 44 |
| Document upload routing (sensitive → Cloudinary, public → imgbb) | 22 |
| On-device quality gates against a 200-image fixture set | 18 |
| Duplicate detection (NID, phone, account, address cluster) | 16 |
| Age and expiry enforcement | 12 |
| Zone containment and the waitlist path | 9 |
| Cuisine search, all 118 categories, both scripts | 48 |
| Review queue, all four decisions, all 14 rejection reasons | 37 |
| Partial rejection and resume-at-those-fields | 14 |
| Sandbox order | 7 |
| Audit coverage on every document view | 1 CI job |
| Responsive, 50 widths | 33 onboarding screens |

---

## 12. Reading on

Next: [`24-finance-payouts-invoices.md`](24-finance-payouts-invoices.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
