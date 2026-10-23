# 09 · Authentication, RBAC & Security Engineering

## 9.1 Identity (Supabase Auth)

- **Customers:** email+password, phone+password (phone stored as verified-by-possession-of-password identifier; password
  reset via email *or* admin-assisted phone reset with KYC-lite checks — documented, since no SMS OTP on free tier, D-09),
  Google OAuth. Multi-step signup: credentials → name/phone → default address pin (skippable → prompted at first checkout).
- **Vendors/Riders:** separate app flavours, same Auth pool, `profiles.role` gated: an account becomes vendor/rider only via
  onboarding approval (file `21`); Partner/Rider apps refuse customer-role logins with a helpful deep-link.
- **Plugin OAuth (D-09):** provider buttons render from `platform_settings.auth_providers` (Admin-toggled); enabling requires
  founder to paste provider client ID/secret in Supabase Dashboard (runbook with tablet screenshots steps) — code ships ready for:
  google(on), facebook, apple, github, discord, twitter, azure, spotify, twitch, linkedin_oidc, gitlab.
- **Admins:** email+password + **mandatory TOTP 2FA** (Supabase MFA), founder super-admin seeded from Actions secrets
  (`SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` → one-time bootstrap job, forces rotation on first login), session 8 h, step-up
  re-auth for payout/role changes.
- Sessions: Supabase JWT (1 h) + refresh rotation; apps store tokens in secure storage (Keystore-backed); single active
  vendor-outlet session policy optional per Admin (prevents outlet credential sharing); device list + revoke in Admin/customer settings.

## 9.2 RBAC matrix (enforced in 3 layers: UI hide → Worker check → Postgres RLS/RPC)

Roles: `customer`, `vendor_owner`, `vendor_staff` (sub-permissions: orders, menu, promos, finance-view — owner-granted),
`rider`, and admin roles: `super_admin`, `ops_manager`, `dispatcher`, `vendor_onboarding`, `finance`, `support`, `compliance_auditor` (read-only+audit).
Permissions catalogue = Appendix C column set; every W3 endpoint declares its required permission; RLS mirrors it for direct reads.
SoD (segregation): KYC approver ≠ payout payer for same entity (configurable), invoice verifier ≠ payer above threshold.

## 9.3 API & platform hardening

- **Rate limiting:** Cloudflare rules + Worker token-buckets (Appendix E per-route); auth endpoints + Turnstile after 3 fails;
  credential-stuffing lockout (progressive delay), breached-password check (Supabase/leaked-password protection where available).
- **Input discipline:** schema validation on every field (lengths, enums, BD phone, coords in BD bbox warning), SQL via
  parameterised RPC only, stored-XSS impossible by output encoding (React default + no `dangerouslySetInnerHTML` without sanitiser),
  image uploads: magic-byte sniff, pixel-bomb caps, EXIF strip (privacy: GPS in food photos!), private docs never through ImgBB.
- **Secrets:** only in GitHub/Worker/Pages secret stores; `.env.example` files contain names only; CI secret-scanning gate
  (gitleaks) blocks merges; APKs contain only public keys (Supabase anon key, Firebase config — both public-by-design, guarded by rules).
- **Transport:** HTTPS everywhere, HSTS via Cloudflare, certificate pinning in apps (with backup pin + kill-switch config),
  `assetlinks.json` App Links verified (file `19`).
- **Abuse & fraud (COD-specific):** fake-order defence — new-account COD limits (max order value until N successful deliveries),
  device/phone velocity rules, address-pin sanity (impossible travel), vendor self-order detection, rider GPS spoof signals
  (mock-location flag, teleport detection → score + review, not auto-ban), voucher farming rules (device+phone+payment-identity graph in Postgres).
- **Privacy:** phone numbers masked in cross-actor UIs until order-active (then call via system dialer; number visible only
  to assigned parties), customer exact pin visible to rider only post-pickup-assignment, home-kitchen pickup privacy (D-24),
  data-minimised RTDB (file `06`), retention schedule (chat 12 mo, telemetry raw 7 d, KYC docs while account active + legal hold),
  account deletion = anonymise PII, retain money ledger (legal), documented in Privacy Policy page (EN/BN).

## 9.4 Audit & forensics

`audit_logs`: actor, role, IP (CF header), action, entity, before/after JSON diff, request_id — append-only (revoke
update/delete, monthly export to private bucket). Admin “who changed this commission?” answered in one search.
Security events (failed logins, token reuse, permission denials) stream to Admin Health with alert thresholds.
Pre-launch checklist (file `26`): OWASP ASVS-L1 self-assessment, RTDB rules tests, RLS penetration test scripts
(cross-tenant read attempts must all fail), Play Data-Safety declarations drafted from this file.
