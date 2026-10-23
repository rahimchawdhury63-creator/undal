# Runbook 01 · Android Tablet Browser Setup — Keystore, Super Admin & Free Cloudinary (`ADR-0006`)

> **Designed 100% for Chrome on an Android Tablet — Zero PC or CLI Required (`File 24 §24.2–24.3`, `ADR-0006`).**

## 1. Mint Your Android Release Keystore (`5 taps`)

1. Open `https://github.com/rahimchawdhury63-creator/undal/actions` in Chrome on your tablet.
2. Tap **Keystore Generate (Android Signing Ceremony)** in the left workflow list.
3. Tap **Run workflow ▾** on the right:
   - Leave **`dry_run` checked (`true`)** first if you want a test check;
   - Uncheck **`dry_run` (`false`)** when you are ready to mint your real permanent Play Store signing key, then tap the green **Run workflow** button.
4. Wait ~25 seconds for the green checkmark `✓`, tap the run, and scroll down to **Summary**:
   - Copy **`KEY_ALIAS`**, **`KEYSTORE_PASSWORD`**, **`KEY_PASSWORD`**, and **`KEYSTORE_BASE64`** into **Settings → Secrets and variables → Actions → New repository secret**.
   - Copy **`ANDROID_CERT_SHA256`** into **Settings → Secrets and variables → Actions → Variables → `ANDROID_CERT_SHA256`**.
   - **Save an offline copy in your password manager immediately** (losing your release keystore permanently prevents updating the same Play Store listing).

## 2. Bootstrap Your Initial Super Admin Account (`3 taps`)

1. In **Settings → Secrets and variables → Actions**, ensure these 4 secrets are saved:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPER_ADMIN_EMAIL`
   - `SUPER_ADMIN_PASSWORD` *(minimum 16 characters — rotate after first login + TOTP 2FA enrolment)*
2. Open **Actions → Bootstrap Super Admin → Run workflow ▾**, uncheck **`dry_run` (`false`)**, and tap **Run workflow**.
3. Re-running **Bootstrap Super Admin** later is 100% safe and idempotent — it never duplicates users.

## 3. Configure Free Cloudinary Storage (`Zero Supabase Storage — ADR-0006`, `5 minutes`, `$0/mo`)

Undal stores **zero files in Supabase Storage**. All public dishes (`AVIF/WebP` auto-optimized) and all private compliance files (`KYC`, `TrxID` cash remittances, shift selfies, dispute evidence, weekly invoice PDFs) run on **Cloudinary Free Plan (`25` free credits every month = up to `25 GB`)**:

1. Sign up free (no credit card) at `https://cloudinary.com/users/register_free` on Chrome on your tablet.
2. On your **Dashboard → Programmable Media**, copy:
   - **`Cloud Name`** → add as GitHub Repository Variable **`UNDAL_CLOUDINARY_CLOUD_NAME`** (and Worker variable `CLOUDINARY_CLOUD_NAME`).
   - **`API Key`** & **`API Secret`** → add strictly as GitHub Actions Secrets & Cloudflare Worker Secrets **`CLOUDINARY_API_KEY`** and **`CLOUDINARY_API_SECRET`** (**never** commit or paste into client variables).
3. Tap **Settings (gear icon) → Upload → Upload Presets → Add upload preset** twice:
   - **Preset 1 (`undal_public_unsigned`):**
     - **Signing Mode:** `Unsigned`
     - **Folder:** `undal/public`
     - **Allowed formats:** `jpg,png,webp,avif`
     - **Incoming Transformation:** `c_limit,w_1600,h_1600/q_auto:good,fl_strip_profile` *(automatically strips EXIF GPS location from home-chef dishes!)*
     - Save → set variable **`UNDAL_CLOUDINARY_UNSIGNED_PRESET_PUBLIC=undal_public_unsigned`**.
   - **Preset 2 (`undal_secure_unsigned`):**
     - **Signing Mode:** `Unsigned`
     - **Folder:** `undal/private`
     - **Unique filename:** `Enabled` · **Overwrite:** `Disabled`
     - **Incoming Transformation:** `fl_strip_profile`
     - Save → set variable **`UNDAL_CLOUDINARY_UNSIGNED_PRESET_SECURE=undal_secure_unsigned`**.
   - In **Settings → Security**, enable **Strict transformations / Signed URL SHA-256 (`8` chars)** so all `type = authenticated` KYC, remittance, and invoice files require short-lived Worker `s--XXXXXXXX--` signatures.
