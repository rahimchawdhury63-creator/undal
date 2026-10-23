# ADR-0006 · Strict Zero-Supabase-Storage Dual Free Media Law (`ImgBB Unlimited Public` + `Cloudinary Sensitive Private ONLY`)

- **Status:** Accepted (`Supersedes D-02 Supabase Storage Backend`)
- **Date:** `2026-10-23`
- **Owner:** Founder + Builder AI (`Build Responses 5–6`)
- **Enforced By:**
  1. `infra/scripts/verify-gates.mjs` (`Gate 6 [NO-SUPABASE-STORAGE]`)
  2. PostgreSQL `CHECK` constraint `media_assets_dual_provider_law` (`supabase/migrations/0015_ops_caches_and_telemetry.sql`)
  3. Runtime TS & Dart guards (`packages/shared_ts/src/{imgbb.ts,cloudinary.ts}`, `packages/undal_core/lib/src/cloudinary_url.dart`)
  4. `W1 undal-api` routes (`POST /v1/images/public`, `POST /v1/images/private-upload-url`, `POST /v1/images/private-view-url`)

---

## Context

1. Supabase Free Tier provides only **1 GB Storage** (`5 GB` egress), which is far too small for Undal's scale -> **Supabase Storage is permanently `enabled = false` (`0` buckets, `0` bytes forever).**
2. **Public catalog & platform images** (`menu_item`, `vendor_logo`, `vendor_cover`, `profile_avatar`, `banner`, `review_photo`) represent **> 99% of public storage volume & CDN impressions**. Hosting them on **ImgBB (`https://api.imgbb.com/1/upload`)** gives Undal **UNLIMITED free storage + UNLIMITED global CDN bandwidth (`i.ibb.co`)** (`full` + `medium` + `thumb` URLs), consuming **zero Cloudinary monthly credits**.
3. **Sensitive compliance media ONLY** (`vendor_kyc`, `rider_kyc`, `rider_shift_selfie`, `cash_remittance_proof`, `dispute_evidence`, `chat_attachment`, `invoice_pdf`) is low-bandwidth, high-security compliance evidence. Dedicating **100% of Cloudinary's Free Plan (`25` credits/month = up to `25 GB` private storage)** exclusively to sensitive compliance assets ensures **years of `$0/mo` private KYC/remittance/invoice archival with zero credit contention**!

---

## Decision (Hard Architectural Law)

| Asset Class | Categories (`13` Total — Disjoint & Complete) | Mandatory Provider | Access & Privacy Mechanism |
|---|---|---|---|
| **All Public & Platform Images** | `menu_item`, `vendor_logo`, `vendor_cover`, `profile_avatar`, `banner`, `review_photo` | **`ImgBB` ONLY** (`provider = 'imgbb'`, **unlimited free storage**) | Uploaded solely via `W1 POST /v1/images/public` using server secret `IMGBB_API_KEY`; magic-byte verified (`JPEG/PNG/WebP <= 5 MB`); **JPEG `APP1` EXIF/GPS & PNG `eXIf`/`tEXt` stripped in Worker RAM (`< 0.3ms`) before upload** so Home-Chef (`HOME_KITCHEN`) GPS never leaks; `imgbb_delete_url` kept strictly server-side. |
| **Sensitive Compliance Media ONLY** | `vendor_kyc`, `rider_kyc`, `rider_shift_selfie`, `cash_remittance_proof`, `dispute_evidence`, `chat_attachment`, `invoice_pdf` | **`Cloudinary` ONLY** (`provider = 'cloudinary'`, `undal/private/*`) | **Public categories are forbidden on Cloudinary (`RangeError` + DB `CHECK`).** Uploaded via `W1 POST /v1/images/private-upload-url` (`type = authenticated` + `fl_strip_profile` or scoped `UNDAL_CLOUDINARY_UNSIGNED_PRESET_SECURE`); viewed strictly via `120s` SHA-256 `s--XXXXXXXX--` signed URLs (`POST /v1/images/private-view-url`) writing a mandatory `audit_logs` entry. |
| **Supabase Storage** | *None* | **DISABLED (`0` bytes)** | Blocked permanently by CI `Gate 6 [NO-SUPABASE-STORAGE]`. |
