# GitHub Actions — Secrets & Variables Registry (EXAMPLE NAMES ONLY — no values here, ever)

Set in: GitHub repo → Settings → Secrets and variables → Actions. Rotate anything ever pasted in chat/issues (esp. ImgBB).

## Secrets
| Name | Where it comes from | Used by |
|---|---|---|
| `SUPABASE_URL` | Supabase → Settings → API | all |
| `SUPABASE_ANON_KEY` | Supabase API (public-by-design, still injected) | apps/web builds |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase API (**highly sensitive**) | Workers, migrations, bootstrap |
| `SUPABASE_DB_URL` | Supabase → Database → connection string | migrate-db |
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens | Supabase CLI in CI |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase → Project settings → Service accounts (whole JSON) | W2 (FCM/RTDB), firebase-rules |
| `FIREBASE_RTDB_URL` | Firebase → Realtime Database URL | W2, apps |
| `GOOGLE_SERVICES_CUSTOMER_B64` | base64 of customer app `google-services.json` | android-release |
| `GOOGLE_SERVICES_PARTNER_B64` | same, partner | android-release |
| `GOOGLE_SERVICES_RIDER_B64` | same, rider | android-release |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → API Tokens (Workers+Pages scoped) | deploys |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard | deploys |
| `IMGBB_API_KEY` | **newly rotated** imgbb API key | W1 only |
| `KEYSTORE_BASE64` / `KEYSTORE_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD` | `keystore-generate.yml` one-time output | android-release |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | founder-chosen (password ≥16 chars) | bootstrap-admin (rotate after first login) |
| `UNDAL_BKASH_NUMBER` | Undal personal bKash (rider cash receiving) | W2 config endpoint |
| `UNDAL_NAGAD_NUMBER` | optional | W2 |
| `INTERNAL_HMAC_SECRET` | generate 64-char random | inter-Worker calls, QR HMAC seed rotation |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile | W1/W3 |
| `PAGES_DEPLOY_HOOK_WEB` | Pages → Settings → Deploy hooks | W3 rebuild nudges |

## Variables (non-secret)
`UNDAL_WEB_DOMAIN` (e.g. `undal.pages.dev` → later your domain) · `UNDAL_ADMIN_DOMAIN` · `UNDAL_APP_ID_PREFIX`
(e.g. `com.undal`) · `TURNSTILE_SITE_KEY` · `DEFAULT_ZONE_NAME` · `APP_MIN_SUPPORTED_VERSION`.

## Per-app `.env.example` (builder creates real ones beside code; pattern)
Flutter (via `--dart-define` from CI): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `API_BASE_URL`, `RTDB_URL`, `WEB_DOMAIN`.
React (Vite, `VITE_` prefix — **public values only**): same five + `VITE_TURNSTILE_SITE_KEY`.
Workers (`wrangler secret`): service-role, Firebase SA, ImgBB (W1 only), HMAC, payout numbers (W2 only) — least privilege per worker.
