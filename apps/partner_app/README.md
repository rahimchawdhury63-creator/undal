# `apps/partner_app` — Undal Kitchen Partner Android App (`com.undal.partner`)

## Response 16 applicant/onboarding scope

Appendix N screen IDs are preserved: applicant shell/profile `p-01`, restaurant documents `p-02`, home/cloud-kitchen documents `p-03`, OSM pin and authoritative zone check `p-04`, opening hours `p-05`, payout and agreement `p-06`, KYC status `p-07`, and the separate document vault `p-35`. These IDs do not renumber the remaining Partner screens.

- Three real application tracks: `RESTAURANT`, `HOME_KITCHEN`, and `CLOUD_KITCHEN`; active cuisines come from W1's Appendix D taxonomy (maximum five).
- Draft profile fields autosave through the owner-scoped W1 endpoint after an application exists. A first-time draft is created only after W1 confirms its pin lies in an active service zone. Outside-zone interest is stored separately without the exact street address.
- Address search uses the configured W2 geocoding proxy; OSM tiles use W1. Exact kitchen address remains owner/admin-private; home and cloud kitchens default customer pickup off, while restaurant pickup starts on under D-24. Public pickup labels are separate from the private address.
- KYC attachments (JPEG, PNG, PDF; maximum 5 MiB each) use the W1 signed Cloudinary authenticated `vendor_kyc` lane, are owner-bound, and are opened only with a short-lived W1-audited URL. Public imagery remains ImgBB-only; Supabase Storage is not used.
- Home/cloud forms collect a real structured menu at exact integer-poisha precision, cook-to-order declaration, 5–200 minute prep estimate, water/storage/surface/food-grade hygiene attestations, a required kitchen hygiene photo, and packaging-standard acceptance.
- Hours, trade-licence expiry, utility-bill issue date, alternative NID/passport pairs, alternative bank/bKash/Nagad proofs, encrypted payout setup, versioned agreement acceptance, and server-authoritative submission checks are represented in the UI.
- Supabase GoTrue session credentials stay in memory. W1 encrypts payout identifiers using its public key; the matching private RSA key is W3-only. No server secrets are included in Dart defines or APK assets.

## Configuration and verification

Public build values come from GitHub Actions Repository Variables passed with `--dart-define`: `UNDAL_API_BASE_URL`, `UNDAL_REALTIME_BASE_URL`, `UNDAL_SUPABASE_URL`, `UNDAL_SUPABASE_ANON_KEY`, `UNDAL_APP_ENV`, and `UNDAL_OSM_TILES_ENABLED`. Keep private keys and provider secrets exclusively in the designated Worker/GitHub secret stores. The founder is not asked to run local Flutter or migration commands; CI and deployment actions are operated through GitHub Actions.

The wider product surface remains governed by `UNDAL-MASTER-GUIDE/17-partner-app-flutter.md` and ships in later ordered responses: alarm-first live orders/Kotlin foreground alarm service, menu studio, overview, growth, finance, support, and settings. No order-control or finance buttons are shown as implemented in this applicant-only response.
