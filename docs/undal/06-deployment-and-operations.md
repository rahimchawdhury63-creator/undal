# 06 — Browser-only setup, Actions deployment, and signed releases

## A. Owner experience and automation boundary

The owner operates from an Android tablet browser. No local terminal, desktop, ADB connection, SDK installation, keystore command, Firebase CLI or Wrangler command is required from the owner. The agent and GitHub-hosted runners may use documented CLIs internally. All normal build/deploy/recovery tasks have named manual-dispatch Actions workflows with understandable inputs, validation and status summaries.

One-time browser tasks are real requirements: create/own service accounts/projects, accept provider terms, establish lawful payout practices, grant least-privilege deploy permissions, configure OAuth consent, enroll MFA, configure DNS/domain verification where owned, approve Android permissions and review actual payments. Do not claim that GitHub Actions can accept legal terms or create all cloud accounts without owner interaction.

The implementation must publish `docs/setup/browser-only.md`, provider-specific console guides, a secret-to-consumer matrix, default-domain guide, signing backup guide, release guide, incident/restore runbooks and a configuration-readiness report. Link actual provider screens without embedding credentials. Missing required configuration fails preflight with a safe field name, not a secret value.

## B. Browser-only setup sequence

1. **Repository and environments:** owner opens GitHub, enables Actions, reviews repository visibility, creates protected production environment/approvals and adds secrets/variables from the configuration example. Explain if repository/account plan limits environment-protection capabilities; provide an honest approved alternative rather than relying on a paid feature silently.
2. **Supabase:** owner creates a free project and records URL, project ref and public publishable/anon key; enables appropriate auth/email settings; configures redirect allowlists; obtains scoped management/deploy credentials and a DB migration credential through the console. Use separate runtime and CI credentials. Confirm free database/API-egress/email/MFA and inactivity behavior. Supabase stores private-file metadata/permissions/audit only; do not create Supabase Storage buckets for sensitive files.
3. **Firebase:** create a project/database on the intended free plan/region without enabling paid dependencies; register the three Android packages and web app; enable Firebase Auth bridge/custom-token prerequisites, RTDB and FCM HTTP v1; create restricted service credentials or supported identity federation for CI. Confirm region URL, quotas, authorized domains and compatible Android config files. Do not deploy Cloud Functions by default.
4. **Cloudflare:** create/identify the account, two Pages projects and exactly three Worker scripts; configure SQLite DO migrations/bindings, service bindings and scoped secret injection. Enable the owner-approved R2 subscription through the browser checkout and verify any account billing/payment requirement before proceeding. Create private R2 Standard evidence/invoice buckets with both `r2.dev` and direct bucket custom domains disabled; bind them to existing Workers only. Confirm Workers/DO Free entitlements and R2 included storage/operation allowances. Do not promise R2 activation needs no billing setup or offers a zero-spend hard cap; refuse unsupported paid upgrades and document any setup blocker.
5. **Public images/maps:** rotate the exposed imgbb key and add only the replacement as a backend secret. Select permitted free tile/routing/geocoder adapters and record terms/limits. If no lawful adequate route source exists, block delivery quoting rather than silently use a public demo endpoint as production infrastructure.
6. **OAuth:** configure Google first with the correct provider console consent/client settings and Supabase callback. Other ten adapters remain disabled until backend config, callbacks, provider terms and integration tests pass. Secrets go through protected configuration workflows; the admin UI shows readiness and toggles, not plaintext provider secrets.
7. **Legal/business policy:** approve commission/5% classification/3% funding, fares, zones, eligibility, cutoffs, fee reimbursement, retention, safety, cash exposure and personal/mobile-wallet usage. Policy approval does not change provider quotas.
8. **Signing bootstrap:** run the protected one-time workflow described below; record certificate fingerprints and retain encrypted offline backup. Configure Firebase/Google/package fingerprints and website App Links as required.
9. **Preflight and deploy:** run workflow validation, migrations/rules tests, emulator integrations, public prerender and security checks. Publish static sites and three Workers in a compatible sequence with health checks. Register/recover operations-clock/weekly alarms and test recovery, not just deployment success.
10. **Admin and device enrollment:** bootstrap first admin once; enroll TOTP; approve real operational accounts via KYC; install signed apps; test notification/location/camera/channel readiness. Physical checks are recorded by the person/device that actually performed them.
11. **Controlled launch:** use legitimate consenting test operations in a separate test environment or a carefully approved real operational pilot; no fake production customers/vendors/orders or fabricated payments. Enable only zones/capabilities that passed launch gates and fit quotas.

Some settings can be configured through provider Management APIs and workflow inputs; others require console ownership/consent. The setup guide must distinguish these and include a browser recovery path. Do not advertise complete unattended provisioning where provider APIs do not allow it.

## C. Workflow catalogue and triggers

| Workflow | Trigger | Required result |
| --- | --- | --- |
| Validate | Push/PR, no production secrets for untrusted code | Format/lint/types, ≤500-line policy, docs links, contracts, unit/property tests, secret/dependency/license checks, production-fixture exclusion. |
| Integration | Trusted branch/manual, budgeted | Disposable SQL/Supabase-compatible stack, Firebase emulators/rules tests, three local Worker runtimes, local R2 bindings/private-media gateway tests, web/Flutter integration, concurrency/negative tests and clear reports. Local tests must not read/write live evidence buckets. Owner uses browser only. |
| Preflight | Manual protected | Validate required secrets/vars by presence/shape, account entitlements, service APIs, callback origins, policy readiness and free-budget calculator; no secret output. |
| Provision/configure | Manual protected/idempotent | Supported provider resources, SQL migrations/metadata RLS, private R2 Standard buckets/public-access denial/lifecycle, Firebase rules/indexes, DO migrations, existing-Worker R2 bindings, public configuration and capability report. Never destructively recreate existing live resources. |
| Bootstrap admin | One-time protected manual | Create/link intended admin once, record required MFA enrollment, do not reset existing credentials on repeat. |
| Bootstrap signing | One-time protected manual | Generate/persist three signing identities, secret installation, fingerprints and encrypted backup; refuse accidental overwrite. |
| Deploy web/APIs | Trusted push or manual with approval | Compatible three-Worker deployment and two Pages uploads, real prerender content, rules checks, smoke tests, version manifest and rollback/forward-fix information. |
| Publish catalog | Approved event/manual, coalesced | Rebuild real public routes/sitemaps after approved vendor/catalog changes, publish revision only after successful upload; stay within build/minute budgets. |
| Build Android release | Protected manual/versioned release | Signed release APK+AAB for customer, partner and rider; verify certificate/version/package and attach controlled artifacts/checksums/reports. |
| Render invoice PDFs | Authorized event/manual, bounded queue | Render canonical invoice snapshots, licensed fonts and branded layouts; upload to the private R2 invoice bucket with restricted CI or gateway authority and quota reservation; update Supabase PDF metadata/status/hash without changing financial invoice data. |
| Recover/reconcile | Protected manual plus runtime alarm recovery | Outbox/deadline/invoice/projection cleanup, safe missing-period catch-up and audit; never duplicate assignments, invoices or payment journals. |
| Backup/restore drill | Protected manual | Encrypted, bounded-retention backup and an isolated restore/reconciliation report; no raw public artifact containing private customer/KYC/finance data. |

No workflow uses `schedule:` cron for weekly invoices; runtime DO alarms provide the time trigger. Manual Actions recovery is a fallback, not a claim of punctual automated invoices when alarms are broken. Do not invoke Actions for every GPS fix, chat message or dispatch calculation.

Exactly three **production** Worker scripts are the baseline. CI uses disposable local runtimes/emulators rather than silently deploying three more permanent Workers. If an external staging deployment requires additional scripts/resources, document and obtain approval; do not hide the extra footprint or consume production quotas without accounting for it.

## D. Actions security, configuration, and deploy behavior

Pin actions by reviewed commit SHA and dependencies/CLIs by compatible versions. Use minimal workflow `permissions`, protected trusted refs, scoped environments and concurrency groups. Do not use `pull_request_target` with untrusted checkout while exposing production secrets. Third-party actions never receive broad credentials unnecessarily. Redact secrets, sign/verify where appropriate and avoid shell interpolation of untrusted input.

Runtime secret injection is per Worker responsibility, not one giant public environment file. Browser `VITE_*`, Firebase public client config, Supabase publishable/anon key and origin variables are public; service-role keys, DB passwords, Firebase private keys, imgbb key, optional R2 CI S3 credentials, signing keys and management tokens are not. Public keys still require correct RLS/rules/abuse controls.

Use the [configuration example](github-actions.env.example) as a naming contract. It is documentation, not an executable production `.env`; blank secret values and `.invalid` URLs are deliberate setup markers. The future setup guide must explain scope, required/optional status, validation, rotation and consumer for every entry. Never invent live credentials or tell the user to paste them into chat.

Use schema evolution that supports old signed clients and new server versions. Dry-run/test migrations; back up before risky changes; apply additive schema, compatible policies/rules, backend and client in a reasoned order; run smoke checks; only then retire old fields. Rollback does not mean deleting ledger events or destructively reversing a live migration.

Preview deployments never use public wildcard authorization. Bind local servers to `0.0.0.0`, permit the actual preview host/origin and proxy relative `/api` paths. Production browser code uses configured HTTPS origins or same-origin custom-domain routes, never localhost/127.0.0.1.

### Private R2 provisioning and owner checks

Use the existing `CLOUDFLARE_ACCOUNT_ID` and narrowly scoped deployment token to provision/configure the two named private Standard buckets where supported. Generate `PRIVATE_EVIDENCE` and `PRIVATE_INVOICES` native R2 bindings in the existing Workers that require them; a binding name is configuration, not a credential to ship in an app. Runtime access uses bindings, not stored S3 keys. Separate application metadata authorization from R2 object access; Supabase RLS alone cannot protect these blobs.

Preflight must inspect both raw public-access paths: managed `r2.dev` disabled and no public bucket custom domains. Deny shared caching, configure safe lifecycle/abandoned-upload cleanup, record retention/legal holds, and test anonymous/cross-tenant/expired-role access through the actual gateway. Browser-based ownership/reviewer checks must work from the website and all three apps without exposing private object keys or tokens in URLs. Local CI uses emulated R2 bindings and explicit test fixtures, never production remote bindings.

Invoice/PDF CI uploads may use a supported authenticated gateway or short-lived supported R2 credentials. If S3 keys are necessary, configure the optional invoice-writer-only credentials as protected Actions secrets scoped to the invoice bucket and minimum permitted operations. No account-wide R2 key in React/Dart/native resources, no keystore/signing-key storage in evidence buckets, no secret output. CI writes must reserve the same storage/operation budget and finalize authorized Supabase file metadata as other trusted uploads.

Record current R2 subscription/checkout requirements, free Standard GB-month/Class A/Class B account allowances, usage-monitoring delay and all other account consumers. Configure conservative allocations/headroom, serialized upload-byte reservations, request throttles and safe upload refusal; monitor list/head/retry/cleanup/PDF job consumption too. R2 may bill usage beyond included allowances; application guards/alerts are not a provider-enforced billing stop. If the account cannot satisfy the free-only launch policy, mark private uploads blocked; never silently fall back to public imgbb, database SVG blobs, Supabase Storage or paid storage classes.

## E. Persistent Android signing bootstrap

Generate a separate persistent signing identity for each application, unless the owner explicitly approves a documented shared-key tradeoff. Use current supported keytool/Android signing algorithms and validity, secure random passwords and a protected runner. Package names and upload-key identities remain stable. Fail bootstrap when a signing secret already exists unless a deliberate key-rotation/recovery procedure is approved.

A GitHub workflow's ordinary `GITHUB_TOKEN` must **not be assumed** to have repository Secrets API write permission. To automate installation of newly generated keystores/passwords into GitHub secrets, use a browser-created, short-lived, repository-scoped GitHub App/fine-grained credential with the required Secrets permission, stored as the dedicated bootstrap secret. Review its permissions, seal each value using GitHub's repository public key, mask outputs before use, then revoke/remove the bootstrap credential after success. No token is requested in chat or committed to Git.

If this permission is not available, document the honest alternative: owner installs signing material through a secure browser-only protected workflow/console mechanism. Do not give a desktop/CLI-only workaround or pretend secret-write succeeded. Signing readiness remains blocked until durable storage and backup are verified.

Store each keystore as a masked base64 secret or another explicitly verified free secure mechanism, with store/key passwords and alias in protected secrets. Verify GitHub value-size limits. Never print base64/private material or publish plaintext keystores as Actions artifacts. An encrypted backup uses authenticated encryption and an independently protected strong passphrase; document key format/restore and keep an owner-controlled offline encrypted copy. Artifact retention is finite and is not the sole backup.

Use runner temporary paths and secret-safe build configuration; delete temporary keystores afterward. No `.jks`, `.keystore`, plaintext signing properties, APK/AAB or secret JSON belongs in source control. Never regenerate production keys on a clean build or silently fall back to debug signing.

## F. Android build/release outputs

Build each app independently in release mode with versionCode/versionName, stable application ID, pinned Flutter/JDK/Gradle/Android toolchain, environment configuration and persistent key. Validate current target SDK/Play policy before publishing; proposed min SDK is 26, not an unresolved `NEEDED_OS_FOR_UNDAL` literal.

Required outputs per app: installable signed release APK; signed AAB for store submission; SHA-256 checksums; package/version/min/target SDK; signing certificate SHA-256; artifact provenance/build commit; dependency/license/SBOM report; test status and supported-device notes. Run signature verification, APK install/launch smoke where possible and bundle validation. A successful compile alone is not proof of a working backend or correct notifications.

Provide browser-downloadable versioned release artifacts with appropriate access and retention. Debug APKs are never labelled release. AAB is not directly installed as an APK. Play App Signing may use a different certificate from the upload key; include the distribution certificate fingerprints in OAuth/App Links/provider settings as needed. Store enrollment/review/cost is outside an all-free source-build promise and must be disclosed.

Location/notification/camera permissions are contextual; declare only required services/permissions. Keep native symbols/mapping files and crash diagnostics controlled, without uploading private business payloads. Do not bake service credentials or API secrets into `google-services.json`, Dart defines or Android resources.

## G. Domains, SEO publication, and App Links

Default origins work without buying a domain: customer/admin Pages hosts and three Worker hosts. Build public URLs from validated configuration, not a hardcoded future domain. `workers.dev` APIs may require explicit HTTPS origins/CORS; a Worker route cannot simply be attached to someone else's `pages.dev` zone. Do not depend on third-party cross-site cookies.

For an owned custom domain, automate supported Pages domain/Worker route/DNS changes after owner verification and expose explicit remaining browser tasks. Update Supabase email/OAuth redirects, Firebase authorized domains, CORS, canonical/sitemap/OG URLs, CSP, downloads and app links together; retain old approved hosts/redirects through a migration period.

Serve correct `/.well-known/assetlinks.json` on each supported customer-link host with the real customer application ID and release/distribution certificate fingerprints, correct MIME/HTTPS and no inappropriate redirects. Android manifest intent filters list verified allowed hosts and relevant paths. Generate them from reviewed build configuration; adding an arbitrary new host can require an app update and verification, not merely changing a runtime secret.

Route only customer content/order/share links intended for the customer app. Admin, partner, rider, support-private and API paths do not all launch the customer app. Preserve web fallback when uninstalled, verification incomplete, user disabled link handling, browser policy intervenes or iOS is used. Test installation, update, no-app, expired/private link and domain-transition cases; never claim the OS must open every link.

Public prerendered HTML must include real approved vendor content without JavaScript; private routes are noindex and never contain KYC/orders/GPS. Verify 404s, canonical host, redirects and structured data on both default and custom origins. Catalogue builds use safe coalescing and revision publication, not unbounded per-item CI runs.

## H. Browser operations and incident readiness

Provide named runbooks for provider quota/suspension, alarm retry exhaustion, stuck outbox, projection divergence, stale devices, route outage, imgbb failures, email/OAuth failure, cash dispute, invoice mismatch, leaked key, compromised admin and signing-key recovery. Each runbook states symptoms, authority needed, browser workflow/button, validation, rollback/escalation and audit evidence.

Enforce finite artifact/backup retention and private access. Account for Actions minutes and emulator/Flutter build duration; public-repository free treatment is not a permanent guarantee and private repositories may have different allowances. Batch jobs and manual release triggers keep the free envelope explicit. Never upload production database dumps, bank proof or signing material unencrypted to a public repository/release.

A release summary reports deployed versions, schema/rules/policy versions, known unsupported device states, physical tests not run, actual configured origins, signing fingerprints, quota headroom and go/no-go status. Deployment completion is not a blanket production-readiness certificate.
