# Runbook 01 · Android Tablet Browser Setup — Keystore, Super Admin, Unlimited ImgBB & Sensitive-Only Cloudinary (`ADR-0006`)

> **Designed 100% for Chrome on an Android Tablet — Zero PC or CLI Required (`File 24 §24.2–24.3`, `ADR-0006`).**

## 1. Mint Your Android Release Keystore (`5 taps`)

1. Open `https://github.com/rahimchawdhury63-creator/undal/actions` in Chrome on your tablet.
2. Tap **Keystore Generate (Android Signing Ceremony)** in the left workflow list.
3. Tap **Run workflow ▾**, uncheck **`dry_run` (`false`)** when minting your real Play Store key, and tap **Run workflow**.
4. Copy **`KEY_ALIAS`**, **`KEYSTORE_PASSWORD`**, **`KEY_PASSWORD`**, and **`KEYSTORE_BASE64`** into **Settings → Secrets and variables → Actions → Secrets**, copy **`ANDROID_CERT_SHA256`** into **Variables**, and save an offline backup in your password manager.

## 2. Bootstrap Your Initial Super Admin Account (`3 taps`)

1. In **Settings → Secrets and variables → Actions → Secrets**, save `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPER_ADMIN_EMAIL`, and `SUPER_ADMIN_PASSWORD` (`>= 16` chars).
2. Run **Actions → Bootstrap Super Admin → Run workflow (`dry_run = false`)**. Re-running is 100% safe and idempotent.

## 3. Configure Dual `$0/mo` Media Storage (`Zero Supabase Storage — ADR-0006`)

### 3A. Unlimited Public & Platform Images -> **ImgBB (`1 minute`, Unlimited Free Storage)**
All dishes, logos, covers, banners, avatars, and review photos go **exclusively to ImgBB** (Edge EXIF/GPS-stripped automatically by `W1`):
1. Open `https://api.imgbb.com/` in Chrome on your tablet and tap **Get API Key**.
2. Save the key as **Cloudflare Worker Secret & GitHub Secret `IMGBB_API_KEY`** (**never** place `IMGBB_API_KEY` in client variables).

### 3B. Sensitive Compliance Images & PDFs ONLY -> **Cloudinary Private Vault (`4 minutes`, `25 GB` Dedicated Free Quota)**
Cloudinary is reserved **100% exclusively** for sensitive compliance files (`KYC`, `TrxID` cash remittances, shift selfies, disputes, chat attachments, weekly invoice PDFs — **zero public images touch Cloudinary**):
1. Sign up free (no card) at `https://cloudinary.com/users/register_free`.
2. Copy **`Cloud Name`** into Repository/Worker Variable **`UNDAL_CLOUDINARY_CLOUD_NAME`**, and save **`CLOUDINARY_API_KEY`** + **`CLOUDINARY_API_SECRET`** strictly in Worker & GitHub **Secrets**.
3. In **Settings → Upload → Upload Presets → Add upload preset**, create **ONLY ONE restricted private preset**:
   - **Name:** `undal_secure_unsigned`
   - **Signing Mode:** `Unsigned`
   - **Folder:** `undal/private` · **Unique filename:** `Enabled` · **Overwrite:** `Disabled`
   - **Incoming Transformation:** `fl_strip_profile`
   - Save → set variable **`UNDAL_CLOUDINARY_UNSIGNED_PRESET_SECURE=undal_secure_unsigned`**.
