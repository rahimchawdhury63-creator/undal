# ADR-0006 — Zero Supabase Storage & 100% Free-Tier Cloudinary Architecture

- **Status:** Accepted (Explicit Founder Directive — `2026-10-23`, replacing Supabase Storage in `D-02` & `ADR-0002`)
- **Deciders:** Founder (`rahimchawdhury63-creator`) & Agent Builder
- **Enforced Automatically By:** `infra/scripts/verify-gates.mjs` (`[NO-SUPABASE-STORAGE]` constitutional check)

---

## 1. Context & Problem Statement

Supabase Free Tier limits Storage to **1 GB total** and **5 GB uncached monthly egress**, which becomes a bottleneck once 3-track vendor KYC packs (`NID`, `Trade Licence`, `TIN/BIN`, `utility_bill`, `kitchen_hygiene_photo`), rider KYC & daily shift selfies, `bKash`/`Nagad` cash-remittance screenshots, order/chat dispute evidence, and weekly settlement invoice PDFs accumulate across thousands of orders.

The Founder explicitly directed:
1. **Eliminate Supabase Storage completely (`0` buckets, `0` bytes — no Supabase Storage anywhere in the codebase).**
2. **Use Cloudinary Free Tier (`25` monthly credits = up to `25 GB` managed storage / CDN / transformations) for ALL secure & important images/PDFs as well as primary smart image optimization, using Cloudinary Unsigned Upload Presets plus all free Cloudinary security & optimization services** (with optional server-proxied `ImgBB` fallback retained for public food photos).

---

## 2. Architecture Decision

### A. Zero Supabase Storage Law (`Enforced in CI`)
- `[storage] enabled = false` in `supabase/config.toml`; zero `storage.buckets` or `storage.objects` rows or client calls anywhere in `supabase/`, `packages/`, `workers/`, or `apps/`.
- Enforced permanently by `infra/scripts/verify-gates.mjs` (`[NO-SUPABASE-STORAGE]`).

### B. Two Strictly Isolated Cloudinary Trees (`packages/shared_ts/src/cloudinary.ts`)

| Tier | Asset Categories | Cloudinary Folder & Delivery Type | Upload Path (`0 ms` Worker CPU) | Read / Delivery Path |
|---|---|---|---|---|
| **Tier S — Secure / Private** | `vendor_kyc`, `rider_kyc`, `rider_shift_selfie`, `cash_remittance_proof`, `dispute_evidence`, `chat_attachment`, `invoice_pdf` | `undal/private/{category}/{entity_id}/*` · **`type = authenticated`** | Restricted **Unsigned Preset (`CLOUDINARY_UNSIGNED_PRESET_SECURE`)** with randomized 128-bit IDs + automatic Worker promotion/verification **OR** Worker-minted SHA-256 **`signCloudinaryUploadTicket(...)`** | **Raw URLs return HTTP `401`**. Viewed **only** via Worker-minted `s--XXXXXXXX--` time-expiring URLs (`signCloudinaryAuthenticatedUrl`, `<= 600s` TTL) + mandatory `public.audit_logs` entry! |
| **Tier P — Public CDN** | `menu_item`, `vendor_logo`, `vendor_cover`, `profile_avatar`, `banner`, `review_photo` | `undal/public/{category}/{entity_id}/*` · `type = upload` | **Unsigned Upload Preset (`CLOUDINARY_UNSIGNED_PRESET_PUBLIC`)** (`jpg,png,webp,avif`, max `8 MB`, no overwrite, forced `fl_strip_profile`) + optional `W1` `ImgBB` dual-CDN mirror | Global CDN with `fl_strip_profile,f_auto,q_auto,c_fill,g_auto`, `< 500B` `e_blur:1000,w_40,q_10,f_webp` LQIP placeholders, and `pg_1,f_webp` PDF previews |

### C. Security & Privacy Gains Over Original `D-02`
1. **25× Larger Free Storage Headroom (`25 GB` vs `1 GB`)** with zero credit card required.
2. **Automatic EXIF GPS Stripping (`fl_strip_profile`) on 100% of Uploads:** Eliminates accidental camera GPS latitude/longitude leakage from `HOME_KITCHEN` dishes (`D-24`).
3. **Zero Cloudflare Worker 10ms CPU Pressure:** Multi-megabyte photos stream directly between client and Cloudinary edge; Workers only sign/verify compact JSON metadata (`< 0.2 ms` CPU).
4. **Full Database Audit & Lifecycle Registry (`public.media_assets` in `0015_ops_caches_and_telemetry.sql`):** Tracks every asset's `provider ('cloudinary' | 'imgbb')`, `cloudinary_public_id`, `delivery_type ('upload' | 'authenticated')`, `bytes`, `sha256_etag`, and retention expiry.
