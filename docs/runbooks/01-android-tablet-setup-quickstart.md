# Runbook 01 · Android Tablet Browser Setup — Signing Keystore & Super Admin Bootstrap

> **Designed 100% for Chrome on an Android Tablet — Zero PC or CLI Required (`File 24 §24.2–24.3`).**

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
