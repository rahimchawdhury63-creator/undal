<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 28 — CI/CD with GitHub Actions

> The hardest constraint in the brief: *"strictly no CLI, no commands, no local machine, no manual
> deploy — I work from an Android tablet, browser only."* Everything — tests, migrations, Workers,
> Pages, signed APKs and AABs, the release keystore itself — must be producible from
> github.com in a browser. This document specifies the twenty-three workflows that make that true.

---

## 1. The rule

**If an operation cannot be performed by clicking a button on github.com, it does not exist in
this platform.**

Consequences that follow from taking that literally:

| Normally done locally | Here |
| --- | --- |
| `npm install && npm test` | Push, or click *Run workflow* |
| `wrangler deploy` | The `deploy-workers` workflow |
| Running a migration | The `migrate` workflow with a typed confirmation input |
| `keytool -genkey` for a release keystore | The `generate-keystore` workflow, which prints the base64 for the developer to paste into secrets |
| `./gradlew assembleRelease` | The `android-release` workflow, producing downloadable artifacts |
| Inspecting the database | The `db-query` workflow with a read-only allowlisted query input |
| Rotating a secret | The `rotate-secret` workflow plus the repository settings UI |
| Checking a log | The `tail-logs` workflow, writing to the job summary |

The `no-local-tooling` CI job enforces the spirit of this: it fails the build if any documentation
or script instructs the reader to run a command on their own machine, and it checks that every
`package.json` script is invoked by some workflow.

---

## 2. The workflows

| # | File | Trigger | Purpose |
| --- | --- | --- | --- |
| 1 | `ci.yml` | push, PR | The gate. Everything in §3 |
| 2 | `deploy-workers.yml` | push to `main`, manual | Deploy the three Workers |
| 3 | `deploy-web.yml` | push to `main`, manual | Build and deploy the storefront to Pages |
| 4 | `deploy-admin.yml` | push to `main`, manual | Build and deploy the admin panel to Pages |
| 5 | `migrate.yml` | manual, typed confirmation | Forward-only schema migrations |
| 6 | `verify-schema.yml` | after migrate, nightly | Compare live schema to `db/expected.json` |
| 7 | `d1-migrate.yml` | manual | D1 schema for live tracking |
| 8 | `android-debug.yml` | push, PR | Debug APKs for all three apps |
| 9 | `android-release.yml` | tag, manual | **Signed `.apk` and `.aab` for all three apps** |
| 10 | `generate-keystore.yml` | manual, once | Create the release keystore and emit base64 |
| 11 | `android-test.yml` | push, PR | Unit, Robolectric and screenshot tests |
| 12 | `android-instrumented.yml` | nightly, manual | Firebase Test Lab matrix including the alarm |
| 13 | `e2e.yml` | PR, nightly | Playwright against a preview deployment |
| 14 | `money-math.yml` | push touching money code | Cross-language differential tests |
| 15 | `brain-replay.yml` | nightly | Replay the last 500 traces against current weights |
| 16 | `lighthouse.yml` | PR, nightly | Performance and accessibility budgets |
| 17 | `responsive-matrix.yml` | PR | 50 widths × 2 themes × 2 languages |
| 18 | `security-scan.yml` | push, weekly | Secrets, dependencies, CodeQL |
| 19 | `rotate-secret.yml` | manual | Guided rotation with a blast-radius summary |
| 20 | `db-query.yml` | manual | Read-only allowlisted queries, results in the summary |
| 21 | `tail-logs.yml` | manual | Worker tail into the job summary |
| 22 | `release.yml` | tag | GitHub Release with APKs, AABs, notes and checksums |
| 23 | `housekeeping.yml` | manual / nightly | Read-only retention candidates, orphan and chain checks; retention deletion disabled (D168) |

Nothing in this list is a cron. `nightly` entries use `workflow_dispatch` plus a
`schedule` trigger — and `schedule` on GitHub Actions is **CI infrastructure**, not application
logic. The brief's no-cron rule is about the running platform: no scheduled compute may be
required for an order to be invoiced, a rider to be checked, or a notification to be sent. The
`no-cron` CI job enforces that precisely: it forbids `[triggers] crons` in any `wrangler.toml` and
any `schedule` in a Worker, while permitting repository maintenance workflows.

---

## 3. The CI gate

`ci.yml` runs on every push and pull request. A merge to `main` is impossible while it is red.

```yaml
name: CI
on:
  push: { branches: ["**"] }
  pull_request:
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  guardrails:        # 14 repo-wide invariant checks, ~40s, fails fast
  typecheck:         # tsc --noEmit across every package
  lint:              # eslint, ktlint, detekt, ruff
  test-workers:      # vitest, @cloudflare/vitest-pool-workers
  test-brain:        # pytest
  test-web:          # vitest + testing-library
  test-android:      # JUnit5 + Robolectric
  money-math:        # the three-language differential test
  ledger-closure:    # 10,000 generated posting sets
  responsive:        # screenshot matrix
  a11y:              # axe-core
  build:             # every artifact, proving it compiles
  summary:           # one job that requires all of the above
```

### 3.1 The guardrail jobs

Thirty-one named checks, each implementing a rule stated somewhere in this corpus. They run
first because they are fast and because a repository-level violation makes everything downstream
irrelevant.

| Job | Fails when |
| --- | --- |
| `no-local-tooling` | Documentation instructs a local command; a script is never invoked by a workflow |
| `no-placeholders` | `TODO`, `FIXME`, `XXX`, `lorem ipsum`, `coming soon`, `not implemented`, `placeholder`, `dummy` appear in shipped code |
| `no-seed-data` | An `INSERT` of business data appears in a migration (RBAC keys and roles are allowlisted as schema) |
| `secret-scan` | High-entropy strings or known secret patterns are committed |
| `line-budget` | Any file exceeds **700 lines**; warns at 600 |
| `doc-coverage` | A public module has no doc comment; a documented feature has no code reference |
| `money-integrity` | A float appears in any money path; an AST walk forbids `number` arithmetic on paisa |
| `dependency-licence-and-cost` | A dependency is non-permissively licensed or implies a paid service |
| `lockfile-drift` | A lockfile changes without a corresponding manifest change |
| `anti-ad-invariant` | A monetary field name is reachable from `RankInput`; `rank/` imports a money module |
| `customer-bill-purity` | A customer-facing total includes a line the customer did not cause |
| `ledger-closure` | Any posting set sums to non-zero |
| `i18n-completeness` | A string key is missing in `en` or `bn`; an error code has no localised message |
| `osm-attribution` | A map component lacks the attribution element |
| `latency-budget` | A declared endpoint budget is exceeded in the benchmark |
| `fcm-payload-purity` | A `notification` key exists; `priority: high` missing on a CRITICAL message; the legacy endpoint appears |
| `no-cron` | `[triggers] crons` in a `wrangler.toml`; a `scheduled` handler in a Worker |
| `responsive-matrix` | Overflow, clipping, or a sub-44 px target at any tested width |
| `perf-budget` | Startup, frame time or bundle size regress beyond threshold |
| `lighthouse-budget` | Any category below 95 |
| `prerender-verify` | A pre-rendered route's HTML lacks real content with JS disabled |
| `a11y` | Any serious or critical axe violation |
| `audit-coverage` | A mutating handler writes no audit row |
| `license-headers` | A source file lacks the PASVL header |
| `token-purity` | A hard-coded colour, dimension or duration in a feature module |
| `contrast` | A used token pair fails 4.5:1 (or 3:1 for large/UI) |
| `no-fixed-width` | A fixed pixel width above 64 outside the allowlist |
| `no-layout-animation` | An animation drives a layout property (3 documented exemptions) |
| `no-postgres-dialect` | A CockroachDB or PostgreSQL construct appears in `db/` or in a SQL block in the corpus |
| `geo-parity` | The integer geospatial layer disagrees with the reference geometry |
| `check-constraint-parity` | `constraints.json` and the `CHECK` declarations in [`06`](06-data-model-tidb.md) disagree by one entry |

The last three are new, added by the move to TiDB.

**`no-postgres-dialect`** fails on any of: `INT8`, `STRING(`, `TIMESTAMPTZ`, `JSONB`, `BYTES`,
`UUID` as a column type, `gen_random_uuid`, `ON CONFLICT`, `RETURNING`, `ST_`, `GEOGRAPHY`,
`GEOMETRY`, `INVERTED`, `pg_`, `::` casts, `INDEX ... WHERE`, `ILIKE`, `string_agg`,
`INSERT IGNORE`, `SERIALIZABLE`. It also parses every `CREATE TABLE` in
[`06`](06-data-model-tidb.md) as MySQL and fails if any statement does not parse.

`INT8` is the reason this job exists rather than being a style rule. MySQL reads `INT8` as `INT(8)`,
a 4-byte integer capping at ৳21,474,836, so a schema that merely *looks* converted would overflow
money silently. `INSERT IGNORE` is forbidden for the same shape of reason: it swallows truncation
and foreign-key errors alongside duplicate-key ones, which is how a ledger row disappears without a
log line.

Two patterns are deliberately **not** matched. `ST_IGNORE_BATTERY_OPTIMIZATIONS`, `ST_NOTIFICATIONS`
and `ST_FIX` are Android constants in [`07`](07-d1-live-tracking.md),
[`15`](15-wakeup-alarm-fcm.md) and [`16`](16-android-foundation.md); the `ST_` rule is scoped to SQL
contexts, and the fixture includes one of them as a must-not-fire case.

**`geo-parity`** is specified in [`06 §4.1.4`](06-data-model-tidb.md): 10,000 radius cases and
10,000 point-in-polygon cases over the Sylhet bounding box, at least 2,000 of the latter within 5 m
of an edge, requiring identical candidate sets, distances within ±1 m, and exact boundary
agreement against a reference geometry library used only in the test.

**`check-constraint-parity`** exists because TiDB Cloud Starter cannot enforce `CHECK` at all —
the `tidb_enable_check_constraint` variable is not modifiable on the free tier, so all 53
constraints declared in [`06`](06-data-model-tidb.md) are parsed and ignored. They are enforced in
`undal-core` instead, and this job is what stops that from decaying into a comment.

It re-extracts every `CHECK` from `06`, compares the result to `packages/contracts/constraints.json`,
and fails on any entry that is missing, extra or altered. A new `CHECK` without a regenerated
registry fails the build; a validator with no matching declaration fails the build. **Drift is the
only real failure mode of an application-layer constraint**, so drift is what the job detects.

Its fixtures are the usual pair plus one more: a registry with an entry deleted, a registry with an
expression subtly altered (`>= 0` changed to `> 0`), and the clean case. The altered-expression
fixture is the one that matters — a missing entry is obvious, a wrong one is not.

### 3.2 The nightly integrity workflow

Not a guardrail, because it runs against production data rather than the repository, but it is the
other half of the `CHECK` fallback and it is specified in [`06 §1.2`](06-data-model-tidb.md).

```yaml
# .github/workflows/integrity.yml
on:
  schedule:    [{ cron: "0 20 * * *" }]   # 02:00 Asia/Dhaka
  workflow_dispatch:
  workflow_run:
    workflows: [deploy]
    types: [completed]
```

It reads `constraints.json`, runs `SELECT count(*) FROM <table> WHERE NOT (<expression>)` for each
of the 53 entries plus the rider age floor, and writes every result — including the zeroes — to
`audit_verifications`. A non-zero count raises `SCHEMA_INVARIANT_VIOLATED`, CRITICAL for the
thirteen money constraints and WARNING for the rest.

**This is CI, not a cron job on the platform.** The no-cron rule in
[`01`](01-mission-and-non-negotiables.md) governs the running system; scheduled verification has
always lived in Actions, alongside the audit-chain walk. The `no-cron` guardrail checks
`wrangler.toml` and Worker `scheduled` handlers, and is unaffected by a workflow schedule.

### 3.3 Action runtime compatibility (D172)

All workflows now reference action majors that declare the Node 24 runtime, replacing the
Node 20-targeted versions that produced deprecation annotations. This action runtime is separate
from `NODE_VERSION` (still 22.22.3), which selects Node for Undal's own tests and builds. The
workflow examples below use the same current action majors. The CodeQL matrix now passes the
published `languages` input rather than the previously misspelled singular `language` input.

`gradle/actions/setup-gradle@v5` is intentionally used instead of v6: v5 supports Node 24, while
v6 introduces a separately licensed caching component. Upgrading the runtime does not imply
acceptance of new commercial terms. The main CI workflow is covered by CI; Android, GCP, release
and other credential-dependent workflows still require their own configured environments and
end-to-end runs. These references use major tags, not immutable commit-SHA pins.

---

## 4. The release keystore

> *"the release keystore should be generated by GitHub Actions and stored in secrets by the
> developer."*

```yaml
name: Generate release keystore
on:
  workflow_dispatch:
    inputs:
      confirm:
        description: 'Type GENERATE-KEYSTORE to confirm. This can only be done once.'
        required: true

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - name: Refuse unless confirmed
        if: inputs.confirm != 'GENERATE-KEYSTORE'
        run: exit 1

      - name: Refuse if a keystore secret already exists
        env: { EXISTING: '${{ secrets.ANDROID_KEYSTORE_BASE64 }}' }
        run: |
          if [ -n "$EXISTING" ]; then
            echo "::error::A keystore already exists. Generating a new one would"
            echo "::error::make every published app un-updatable. Refusing."
            exit 1
          fi

      - name: Generate passwords and the keystore
        run: |
          STORE_PW=$(openssl rand -base64 33 | tr -d '\n')
          KEY_PW=$(openssl rand -base64 33 | tr -d '\n')
          keytool -genkeypair -v \
            -keystore undal-release.jks -storetype JKS \
            -keyalg RSA -keysize 4096 -validity 10000 \
            -alias undal \
            -storepass "$STORE_PW" -keypass "$KEY_PW" \
            -dname "CN=Undal, OU=Engineering, O=Undal, L=Sylhet, C=BD"
          echo "STORE_PW=$STORE_PW" >> "$GITHUB_ENV"
          echo "KEY_PW=$KEY_PW"     >> "$GITHUB_ENV"

      - name: Print what to paste into repository secrets
        run: |
          {
            echo "## Copy these into Settings -> Secrets -> Actions"
            echo ""
            echo "Do this now, in this browser tab. This output is visible only"
            echo "to you, only while this run's logs exist, and it is the ONLY"
            echo "time these values will ever be shown."
            echo ""
            echo '### ANDROID_KEYSTORE_BASE64'
            echo '```'; base64 -w0 undal-release.jks; echo; echo '```'
            echo '### ANDROID_KEYSTORE_PASSWORD'
            echo '```'; echo "$STORE_PW"; echo '```'
            echo '### ANDROID_KEY_ALIAS'
            echo '```'; echo "undal"; echo '```'
            echo '### ANDROID_KEY_PASSWORD'
            echo '```'; echo "$KEY_PW"; echo '```'
            echo ""
            echo "### SHA-256 fingerprint (for assetlinks.json)"
            echo '```'
            keytool -list -v -keystore undal-release.jks -storepass "$STORE_PW" \
              | grep 'SHA256:' | head -1
            echo '```'
            echo ""
            echo "**After pasting, delete this workflow run from the Actions tab.**"
          } >> "$GITHUB_STEP_SUMMARY"

      - name: Destroy the keystore file
        if: always()
        run: shred -u undal-release.jks || rm -f undal-release.jks
```

Four safety properties: it refuses without the typed confirmation, it refuses if a keystore
already exists, it never writes the keystore as an artifact, and it tells the developer to delete
the run afterwards. Losing the keystore means never being able to update a published app, so the
summary also includes a sentence telling the developer to store a copy somewhere safe outside
GitHub.

---

## 5. Signed Android builds

```yaml
name: Android release
on:
  workflow_dispatch:
    inputs:
      apps:     { type: choice, options: [all, customer, partner, rider], default: all }
      track:    { type: choice, options: [internal, none], default: none }
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        app: [customer, partner, rider]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v6
        with: { distribution: temurin, java-version: '17', cache: gradle }

      - name: Restore keystore
        run: echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > app/undal-release.jks

      - name: Build AAB and APK
        env:
          UNDAL_STORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          UNDAL_KEY_ALIAS:      ${{ secrets.ANDROID_KEY_ALIAS }}
          UNDAL_KEY_PASSWORD:   ${{ secrets.ANDROID_KEY_PASSWORD }}
          UNDAL_API_BASE:       ${{ secrets.PUBLIC_API_BASE }}
          UNDAL_WEB_HOST:       ${{ secrets.PUBLIC_WEB_HOST }}
          UNDAL_FCM_SENDER_ID:  ${{ secrets.FCM_SENDER_ID }}
        run: |
          ./gradlew :app:${{ matrix.app }}:bundleRelease \
                    :app:${{ matrix.app }}:assembleRelease \
                    -Pundal.signing=release --no-daemon

      - name: Verify the signature
        run: |
          $ANDROID_HOME/build-tools/36.0.0/apksigner verify --verbose --print-certs \
            app/${{ matrix.app }}/build/outputs/apk/release/*.apk

      - name: Shred the keystore
        if: always()
        run: shred -u app/undal-release.jks || true

      - uses: actions/upload-artifact@v7
        with:
          name: undal-${{ matrix.app }}-${{ github.ref_name }}
          path: |
            app/${{ matrix.app }}/build/outputs/apk/release/*.apk
            app/${{ matrix.app }}/build/outputs/bundle/release/*.aab
            app/${{ matrix.app }}/build/outputs/mapping/release/mapping.txt
          retention-days: 90
```

The `release.yml` workflow then attaches all six binaries to a GitHub Release with SHA-256
checksums, so the developer downloads them from a release page on their tablet — the brief's
*"easy to download"*.

ProGuard mapping files are uploaded as artifacts and attached to the release, because without them
a production crash report is unreadable.

### 5.1 Play Store upload

Optional. When `PLAY_SERVICE_ACCOUNT_JSON` is configured, the workflow offers the `internal`
track. When it is not, the step is skipped — no failure, no error, just an absent capability.

### 5.2 The `specialUse` justification

Google Play requires a written justification for `FOREGROUND_SERVICE_TYPE_SPECIAL_USE`. The text,
kept in `android/PLAY_DECLARATIONS.md` and surfaced in the release job summary:

> *Undal Partner and Undal Rider are food-delivery operations apps. When an order arrives, the app
> must play a continuous, loud, alarm-category alert and keep the device awake until a restaurant
> operator or courier responds, including when the screen is locked. No existing foreground
> service type describes an operational alert of this kind: it is not media playback, not
> location-only, not a phone call, and not a short task. The service runs only while an unanswered
> order alert is active, for a maximum of 120 seconds, and terminates immediately on response.*

---

## 6. Workers deployment

```yaml
jobs:
  deploy:
    strategy: { matrix: { worker: [core, realtime, brain] }, max-parallel: 1 }
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - name: Push secrets
        run: |
          for s in TIDB_DATABASE_URL IMGBB_API_KEY \
                   CLOUDINARY_CLOUD_NAME CLOUDINARY_UPLOAD_PRESET \
                   FIREBASE_SERVICE_ACCOUNT_JSON ORDER_QR_SECRET \
                   UNDAL_BKASH_PAYOUT_NUMBER OSRM_BASE_URL WEATHER_BASE_URL \
                   JWT_SIGNING_KEY GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET; do
            v="${!s}"
            [ -n "$v" ] && printf '%s' "$v" | npx wrangler secret put "$s" \
              --name undal-${{ matrix.worker }} || true
          done
        env: { ... all secrets ... }
      - run: npx wrangler deploy --name undal-${{ matrix.worker }}
      - name: Smoke test
        run: |
          for i in 1 2 3 4 5; do
            code=$(curl -s -o /dev/null -w '%{http_code}' \
              "https://undal-${{ matrix.worker }}.$CF_SUBDOMAIN.workers.dev/health")
            [ "$code" = "200" ] && exit 0
            sleep 4
          done
          echo "::error::Health check failed"; exit 1
      - name: Roll back on failure
        if: failure()
        run: npx wrangler rollback --name undal-${{ matrix.worker }} --yes
```

`max-parallel: 1` with the order `core → realtime → brain`, because `realtime` and `brain` have
service bindings to `core`. Deployment is sequential and each stage is health-checked before the
next begins. A failure rolls back automatically.

---

## 7. Migrations

```yaml
name: Migrate database
on:
  workflow_dispatch:
    inputs:
      target:  { description: 'Migration number, or "latest"', default: 'latest' }
      confirm: { description: 'Type MIGRATE-PRODUCTION', required: true }
      dry_run: { type: boolean, default: true }
```

| Property | Behaviour |
| --- | --- |
| Direction | **Forward only.** There are no down-migrations; a mistake is corrected by a new forward migration |
| Dry run | Default. Prints the plan, the statements and the estimated lock impact, and changes nothing |
| Advisory lock | Taken for the run; a second concurrent run blocks rather than racing |
| Idempotent | Each migration records itself in `schema_migrations`; re-running is a no-op |
| Online | Every migration must be non-blocking: `ADD COLUMN` nullable, backfill in batches, then constrain. The validator rejects a migration containing a blocking statement |
| Verification | `verify-schema.yml` runs afterwards and compares the live schema against `db/expected.json`, failing on detected table/column/type drift; it does not check all schema properties |
| Summary | Statements executed, rows affected, duration, and the new schema hash, all in the job summary |

The twelve migrations are listed in [`06`](06-data-model-tidb.md), preceded by `000_smoke.sql`, which probes `CHECK` behaviour and stops the run before the real schema if the probe fails.

**The runner applies statements, not files.** TiDB auto-commits DDL, so a migration file is not
atomic and cannot be wrapped in a transaction. `migrate.yml` records each statement in
`schema_migrations` as it succeeds and resumes from the first unrecorded statement after a failure.
See [`06 §10`](06-data-model-tidb.md) for why this replaced the per-file transaction.

---

## 8. Observability from a browser

| Need | Workflow |
| --- | --- |
| See Worker logs | `tail-logs.yml` — takes a worker name and a duration, runs `wrangler tail`, writes the output to the job summary |
| Run a query | `db-query.yml` — a named query from an allowlist in `scripts/db/queries/`, parameters as inputs, results rendered as a markdown table. **No free-form SQL**, because a free-form SQL input on a public repository is a catastrophe waiting for a misconfigured permission |
| Check health | `health.yml` — pings every service and renders a status table |
| Verify the audit chain | `housekeeping.yml` |
| Inspect a Brain decision | The admin panel's trace explorer ([`21 §11`](21-admin-panel.md)) |

Everything lands in `$GITHUB_STEP_SUMMARY`, which renders as formatted markdown on a phone
browser. This is the developer's console.

---

## 9. Environments and protection

| Environment | Branch | Protection |
| --- | --- | --- |
| `preview` | any PR | None; ephemeral Pages preview + preview Workers |
| `production` | `main` | Required reviewers; all CI green; a 5-minute wait timer on `migrate` and `deploy-workers` |

The wait timer is a small, genuinely useful safety net: five minutes is long enough to cancel a
deployment you realise was a mistake, and short enough not to be an obstacle.

---

## 10. Caching and cost

GitHub Actions' free tier is 2 000 minutes/month for private repositories and unlimited for
public ones. Undal's repository is public (PASVL-1.0 requires source visibility), so minutes are
not a constraint — but build time still matters for feedback speed.

| Cache | Effect |
| --- | --- |
| Gradle (`actions/setup-java` cache) | Android build 11 min → **3.5 min** |
| npm (`actions/setup-node` cache) | Install 70 s → 9 s |
| Playwright browsers | 90 s → 6 s |
| Robolectric jars | 120 s → 4 s |
| Turbo remote cache (self-hosted on R2 free tier, optional) | Monorepo rebuild 6 min → 50 s |

Full CI on a typical PR: **8–11 minutes**. The guardrail job alone finishes in 40 seconds, so an
obvious violation fails fast.

---

## 11. Branch protection

| Rule | Value |
| --- | --- |
| `main` | No direct pushes. PR only |
| Required checks | `ci / summary`, `security-scan`, `money-math` |
| Required reviews | 1 |
| Dismiss stale reviews | On |
| Linear history | Required |
| Signed commits | Encouraged; not required, because a tablet-only workflow makes signing awkward |
| Force push | Disabled |
| Deletion | Disabled |

---

## 12. Testing the CI itself

| Test | Method |
| --- | --- |
| Every guardrail catches its violation | A fixture repository per rule, each containing exactly one violation; the job must fail on it |
| Every guardrail passes clean code | The same fixtures with the violation removed |
| The keystore workflow refuses twice | Simulated with a dummy secret |
| Migrations are idempotent | Run `latest` twice; the second is a no-op |
| Rollback works | A deliberately broken Worker deploy must roll back and leave the previous version serving |
| Artifacts are downloadable and valid | `apksigner verify` plus an install test in Test Lab |

A CI rule that has never been shown to fail on a violation is a CI rule nobody should trust, so
each one ships with its own failing fixture.

---

## 13. Reading on

Next: [`29-secrets-and-configuration.md`](29-secrets-and-configuration.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
