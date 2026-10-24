# ADR-0007 · Customer Rewards, Referrals, and Account Closure

- **Status:** Proposed — founder decision required; no unapproved policy is enabled.
- **Date:** `2026-10-24`
- **Owner:** Founder
- **Raised by:** Builder AI, Build Response 15
- **Affected customer screens:** `c-33` Rewards, `c-34` Invite Friends, `c-40` Delete Account

---

## Context

The customer-screen specification describes spend-based rewards, referrals, and account deletion. The current repository does not define a customer points ledger or an approved earning/redemption/referral policy. Existing Admin values `growth.referral_customer_poisha = 5000` and `growth.referral_rider_poisha = 10000` do not establish customer invitation eligibility, trigger, fraud controls, or reversal behavior. W1 has no customer account-deletion endpoint, retention schedule, or completed deletion/anonymization procedure.

Guessing these rules would create fake balances/codes, financial liabilities, privacy claims, or exploitable referral rewards. Build Response 15 therefore leaves rewards and invitations explicitly gated and implements `c-40` as a private support request only. The request screen clearly states that the account stays active and records are not immediately erased.

## Founder decisions requested

### 1. Customer rewards (`c-33`)

Please approve or replace the following **before enabling points**:

- Eligible order states and minimum net food spend for earning points.
- Integer earn rate and rounding rule (all value remains integer poisha; points are not stored or displayed as cash).
- Redemption conversion into vouchers, minimum/maximum redemption, per-order caps, expiry, and zone/vendor exclusions.
- Refund, cancellation, failed-delivery, chargeback, and support-adjustment reversals.
- Admin roles allowed to adjust balances, evidence/audit requirements, and customer-visible history.

**Safest interim behavior:** keep the screen gated and show no balance, transaction, or redeem action.

### 2. Customer referrals (`c-34`)

Please specify:

- Who can invite whom, and how phone/email identity deduplication works.
- When the referred customer and inviter become eligible (for example, after a verified first delivered order).
- Reward amounts/types, expiry, caps, issuance timing, cancellation/refund reversal, and whether the referrer can be a rider/partner.
- Abuse controls for self-referral, shared devices/payment details, duplicate accounts, and support/admin overrides.

**Safest interim behavior:** keep the screen gated; generate no code or reward status.

### 3. Account closure (`c-40`)

Please approve a deletion/retention policy covering:

- Identity verification and open-order, dispute, cash-remittance, tax, and financial-record holds.
- Data categories erased versus pseudonymized, retention periods, and treatment of immutable/audited records.
- Media deletion and third-party processor handling for ImgBB public assets and Cloudinary private evidence.
- Supabase Auth revocation, session/device-token revocation, support confirmation, and backups/log retention.
- Any legally required customer notice, completion SLA, and appeal/recovery process.

**Safest interim behavior:** accept a private support request; do not claim immediate deletion, close the account, or erase financial evidence.

## Decision rule

This ADR remains **Proposed** until the founder responds. Do not infer approval from the existing referral amounts or from a support-ticket submission. Once approved, record the resulting policy as a new accepted ADR, implement database constraints/RLS/W1 operations and customer UI, and add abuse/retention tests before enabling the screens.
