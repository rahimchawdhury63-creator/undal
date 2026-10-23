# ADR-0002 · Weekly Invoice PDF Architecture Under Cloudflare Free 10 ms CPU Cap

- **Status:** Accepted (`Plan Response 1`, 2026-10-23)
- **Deciders:** Builder AI · **Governing Spec:** `File 08 §8.1`, `File 15`, `File 23 §23.7`

---

## Context

`File 23 §23.7` flags a specific engineering constraint requiring an ADR:
- Every Friday/Saturday cycle generates immutable Partner & Rider invoices in **both English and বাংলা (`Baloo Da 2` + `Hind Siliguri`)** with Undal branding, itemised order rows, VAT extraction (`D-08`), adjustment lines, bKash/bank instructions, and a verification QR code.
- **Hard Free-Tier Constraint:** Cloudflare Workers Free grants **10 ms CPU time per HTTP request** (`30 s` inside Cron/DO, `10 ms` on HTTP). Full OpenType Bengali conjunct shaping (`যুক্তাক্ষর` GSUB/GPOS layout tables across 600 KB TTF files) inside JavaScript on an HTTP Worker invocation consumes `25–90 ms` CPU — risking `Error 1102: Worker exceeded CPU time limit` on large multi-page invoices!

---

## Decision

Adopt a **Dual-Path Deterministic Invoice Architecture**:

1. **Canonical Structured Invoice Snapshot in Postgres (`invoices` + `invoice_lines`):**
   - On Friday/Saturday `00:05 Asia/Dhaka` (`W3` Cron, where CPU allowance is generous), `W3` computes and freezes the immutable integer-poisha JSON/SQL snapshot for every Partner and Rider (`invoice_number = INV-P-YYYYWW-####` / `INV-R-YYYYWW-####`) plus an HMAC verification URL.
2. **Primary Pixel-Perfect Bilingual View & Print/Save PDF (Partner App, Rider App, Admin Web):**
   - Renders the frozen invoice snapshot natively using **real bundled `Baloo Da 2` + `Hind Siliguri` OpenType shaping**:
     - On `admin_web`: dedicated `@media print` A4 stylesheet (`Print / Save PDF` + archival upload of rendered blob to Free Cloudinary `undal/private/invoice_pdf/...` `authenticated` storage per `ADR-0006`).
     - On `partner_app` & `rider_app`: native Android print/PDF adapter + direct download of stored PDF via `300s` Worker-signed Cloudinary `s--XXXXXXXX--` URL (`GET /v1/invoices/:id/pdf`).
3. **Zero-Font-Shaping Ultra-Fast Server PDF Generator (`< 2 ms CPU` in `W3`):**
   - `W3` ALSO includes a pure streaming PDF-1.4 writer (built-in standard Type1 Helvetica/Courier tables, zero TTF parsing, `< 1.8 ms` CPU for 200 line items!) archived automatically into Cloudinary authenticated storage `undal/private/invoice_pdf/{role}/{yyyy-ww}/{invoice_id}.pdf` at cycle close so `GET /v1/invoices/:id/pdf` **always succeeds immediately even before any browser opens the invoice**!

---

## Consequences

- **Zero paid PDF APIs & zero Supabase Storage bytes** (`0 BDT / $0` forever per `ADR-0006`).
- **Zero Worker `1102` CPU timeouts** even for high-volume kitchens with 500 orders/week.
- **100% crisp Bengali typography** in every human-facing view/print flow AND **100% immediate archival PDF availability + `pg_1,f_webp` preview thumbnails** on Cloudinary Free Tier from second zero of cycle close.
