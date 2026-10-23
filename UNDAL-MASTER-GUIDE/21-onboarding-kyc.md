# 21 · Onboarding & KYC — Vendors and Riders (founder checklists, made into flows)

Shared pattern (all tracks): in-app multi-step wizard (Partner/Rider app “Apply” mode before approval — app installs and
runs pre-approval in applicant shell), autosave drafts, per-field validation EN/BN, private-lane document capture
(file `15` §3), map pin step (search / current location / OSM pin + zone-availability verdict “We serve this area ✓” /
waitlist capture when outside), submit → Admin queue (stage board) → per-document approve / request-fix (reason + guidance) →
approved → account activation + training checklist (alarm test, first-menu/session) → go-live.
SLA targets shown to applicants (“review within 48 h”); every state change notifies via FCM data + inbox + email.

## 21.1 RESTAURANT track

**Documents (private lane, each: front photo/PDF, ≤5 MB):** ① Trade License (expiry captured → renewal alerts 30/7 days)
② Owner NID/Passport (front+back) ③ TIN + BIN certificates ④ Bank proof (statement header / cancelled cheque / passbook:
bank, holder, account, routing-branch) **or** bKash/Nagad (app screenshot + number) ⑤ Menu (photo/PDF — used by onboarding
team to pre-build the digital menu with vendor confirmation).
**Profile ops:** official name + brand name, owner/rep legal name + mobile + email, cuisines picker (**searchable 100+
taxonomy Appendix D**, max 5 primary), storefront + kitchen photos (public lane after approval), precise address + OSM pin,
hours builder enforcing **≥4 h/day × ≥5 days/week**, pickup opt-in + counter instructions, payout account (+ bKash recommended).
**Verification:** document clarity + name-match (licence↔NID↔bank holder, mismatch workflow), address-pin sanity vs zone,
test-order readiness call script (Admin checklist), agreement acceptance (15% + 5% terms, versioned e-sign checkbox + timestamp).

## 21.2 HOME KITCHEN / CLOUD KITCHEN track

**Documents:** ① NID/Passport (front+back) ② Utility bill (gas/electric/water, ≤3 months, address match) ③ Bank proof or
bKash/Nagad (as above) ④ Digital menu list (structured entry in wizard: dish, price, photo optional-at-apply).
Trade License/TIN-BIN: **recommended, optional-at-start** (founder note) — wizard nudges + Admin can require per zone policy.
**Profile ops:** brand/chef name, chef legal name + mobile + email, cuisine styles (taxonomy incl. Homemade Deshi,
Baking & Pastries…), kitchen photos (prep area), exact address (flat/house) + pin (privacy: exact address never customer-facing;
pickup default OFF D-24 with optional pickup-point label), hours ≥4×5, **on-demand declaration** (items cook-to-order;
typical prep self-estimate seeds file-`12` priors), hygiene self-checklist (water, storage, packaging — photo-evidenced,
badge “Hygiene checklist completed” after Admin spot-review).
**Extra safety:** first-2-weeks order cap ramp (setting), mandatory packaging standard acknowledgement.

## 21.3 RIDER track (Motorbike + Bicycle)

**Eligibility gate:** age ≥18 (DOB from NID, hard check), Android smartphone (min SDK 26), front camera present (device check),
bank/bKash payout ready. **Category A Motorbike:** NID/Birth Certificate, Driving License (expiry alerts), Vehicle
Registration + Tax Token, bike photos (plate visible). **Category B Bicycle:** NID/Birth Certificate, bicycle photo with rider.
**Common:** live selfie (liveness-lite) matched by reviewer to NID photo, address + home zone pin + availability check,
emergency contact, payout account (account name must match rider name), training modules (in-app: safe riding, food handling,
cash protocol, app alarm setup — quiz-gated), bag issuance record, agreement (fare transparency, cash-remittance duty,
weekly Friday payout) e-accepted. Approval → first-session supervised checklist + test alarm ARMED (file `07` §6).

## 21.4 Admin pipeline mechanics

Queues by track/stage/zone/age; document viewer (signed URLs, zoom, side-by-side data compare, audit-viewed stamps);
decision templates EN/BN (“licence photo blurry — retake in daylight”); partial-fix loops keep approved docs locked;
fraud flags (duplicate NID/phone/bank detection across accounts); expiry watchlist auto-tasks; onboarding funnel analytics
(start→submit→approve conversion per track) in BI. Rejected applicants see reasons + reapply path (30-day cool-off for fraud).
