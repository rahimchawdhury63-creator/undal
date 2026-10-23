# 24 · GitHub Actions — Total Automation (tablet-only operations, zero local CLI)

**Founder reality:** you work from an Android tablet. Everything below runs from `github.com` in the browser.
The builder AI creates all workflow files; you only create accounts + paste secrets (§24.2) + tap buttons.

## 24.1 Workflow catalogue (`.github/workflows/`)

| Workflow | Trigger | Does | Founder output |
|---|---|---|---|
| `ci.yml` | Every PR/push | Lint+types, ≤500-line & placeholder gates, secret scan, unit/widget/SQL/rules tests, build web+workers dry-run | Green/red checks |
| `deploy-web.yml` | `main` push (paths: customer_web/shared) + nightly 03:00 + manual | Build + prerender + sitemap → Cloudflare Pages `undal-web` | Live website |
| `deploy-admin.yml` | `main` push (admin paths) + manual | Build → Pages `undal-admin` | Live admin |
| `deploy-workers.yml` | `main` push (worker paths) | `wrangler deploy` ×3 (secrets via `wrangler secret bulk` from GH secrets), cron verify | APIs live |
| `migrate-db.yml` | `main` push (supabase/migrations) + manual w/ confirm | Supabase CLI `db push` to prod (staging first on PR), post-migration smoke SQL | Schema live |
| `firebase-rules.yml` | `main` push (firebase/) | Firebase CLI deploy RTDB rules (service-account), emulator tests first | Rules live |
| `android-release.yml` | Manual (choose app) + tag `v*` | Flutter build **signed APK + AAB** per app (keystore from secrets), upload to GitHub Release with notes + QR-friendly links | **Download APKs** |
| `keystore-generate.yml` | Manual ONCE | Generates release keystore in-runner, prints **base64 + passwords once** in masked workflow summary for founder to save into Secrets (§24.3) | Signing identity |
| `bootstrap-admin.yml` | Manual ONCE | Creates super-admin from secrets via Supabase Admin API (idempotent) | Admin login |
| `health-ping.yml` | Hourly | Hits `/healthz` ×3 Workers + web; opens/updates a GitHub Issue on failure | Free monitoring |

All workflows: path filters, concurrency guards, dependency caches, pinned action versions (SHA), least-privilege `permissions:`.

## 24.2 One-time founder setup (tablet browser click-paths — builder writes these as illustrated runbooks)

1. **GitHub:** repo (public recommended for free Actions minutes — secrets remain encrypted/never in code).
2. **Supabase:** create project (region Singapore) → copy URL, anon key, service-role key, DB password → enable Email + Google auth.
3. **Firebase:** create project → RTDB (locked mode, region asia-southeast1) → 3 Android apps (package IDs) →
   download `google-services.json` ×3 (base64 → secrets) → service account JSON (FCM + RTDB admin) → secret.
4. **Cloudflare:** account → Pages projects ×2 (Git-connected or direct-upload via Actions — prefer Actions `wrangler pages deploy`),
   Workers ×3 names, API token (scoped) + account ID → secrets; custom domains attached later via same dashboard.
5. **ImgBB:** **rotate the burned key first (D-03)** → new key → secret.
6. Paste every secret from `env/github-actions-secrets.example.md` (exact names), set Variables (domains, zone defaults),
   run `keystore-generate` → save outputs to secrets → run `bootstrap-admin` → merge the builder's PRs. Done — system live.

## 24.3 Android signing (no PC ever)

`keystore-generate.yml`: `keytool` in runner (alias `undal-release`, validity 9125 d, RSA 2048) → outputs base64 keystore +
passwords **once** (founder saves: GitHub Secrets `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` +
offline backup note — losing this = new Play identity, runbook warns thrice). `android-release.yml` decodes to runner temp,
builds `app-release.apk` + `app-release.aab` per flavour with version from tag/`pubspec`, verifies signature (`apksigner`),
extracts SHA-256 → feeds `assetlinks.json` generation for web deploy. Play upload itself = founder uploads AAB via Play
Console browser (tablet-doable) — optional later automation via Play service account documented as phase-2.

## 24.4 Secrets & variables registry (names — values never in repo)

Complete annotated list: `env/github-actions-secrets.example.md`. Groups: Supabase (URL/anon/service-role/db-url),
Firebase (service account, RTDB URL, 3× google-services base64), Cloudflare (token/account/pages projects),
ImgBB key, Android signing ×4, Super-admin bootstrap ×2, Undal payout numbers (bKash/Nagad), W-internal HMAC,
Turnstile keys, optional OAuth providers (set in Supabase UI, not GH). Rotation runbook per secret (esp. ImgBB + service-role).

## 24.5 Environments & safety

GitHub Environments `staging`/`production` (production requires founder approval tap for DB/worker deploys — phone-friendly).
PR previews: Pages preview URLs commented on PR. Rollback: Pages “rollback deployment” (1 tap), Workers version rollback,
DB migrations forward-only with compensating migration template. Dependabot (free) weekly PRs. Branch protection on `main`
(CI required, no force-push) configured by builder via documented `gh` steps/Actions-safe API calls.
