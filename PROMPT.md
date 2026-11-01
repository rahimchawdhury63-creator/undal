# The Undal Build Prompt

Copy the fenced block below and paste it to your AI coding agent as the first message of the build.
Everything else it needs is already in this repository.

---

```text
You are building UNDAL — a production-grade, on-demand, real-time, cash-on-delivery, multi-vendor
food-delivery and pick-up platform for Bangladesh. The complete specification already exists in this
repository. Your job is to read it, internalise it, and build it.

STEP 0 — READ BEFORE YOU TYPE
Read every file in docs/ in the order given by docs/00-INDEX.md. All 40 documents. Do not skim.
Read brand/ (four logos) and assets/reference/ (two motion videos — extract frames and study them).
Read assets/audio/undal_order_alert_loop.wav (8.000 s seamless alarm loop — ship it, do not regenerate).

STEP 1 — RESPONSE 1 AND RESPONSE 2 ARE PLANNING ONLY. WRITE NO APPLICATION CODE.
  Response 1: Write docs/_plan/UNDERSTANDING.md — prove you understand the platform. Cover the five
  actors, the complete order lifecycle state machine, the money model to the paisa, the Undal Brain's
  five engines, the wake-up alarm stack including the one case Android forbids, the D1 tracking
  economics, and the free-tier budget per service. Quote specific section numbers from docs/.
  Response 2: Write docs/_plan/BUILD-PLAN.md — the file-by-file manifest for all 20 build responses,
  with module boundaries, the dependency order, and the CI gates each response must leave green.

STEP 2 — RESPONSES 3 THROUGH 22 ARE THE BUILD. TWENTY RESPONSES. MAXIMUM OUTPUT EVERY TIME.
Follow docs/35-execution-plan.md exactly. It assigns each response its deliverables. Finish every
response with the repository in a state where CI is green. Stop at the end of each response and wait
for the user to say continue.

ABSOLUTE RULES — violating any one of these fails the build
  1. No CLI, no local commands, no local machine. Everything deploys from GitHub Actions. The
     maintainer works from an Android tablet in a browser. Every workflow must be runnable from the
     Actions tab with workflow_dispatch.
  2. No placeholders. No TODO. No "implement this later". No stub that returns a fixed value. No mock
     service standing in for a real one. Every function you write is the real one.
  3. No demo data, no seed data, no fixtures in production paths, no sample vendors, no fake riders.
     The platform boots empty and tells the user "no vendors here yet" in a beautiful empty state.
     Test fixtures live only under test directories and never ship.
  4. No secrets in code. Ever. Every credential is a GitHub Actions secret, named exactly as
     docs/29-secrets-and-configuration.md specifies. Commit .env.example only.
  5. No file over 700 lines. CI enforces it. Split by responsibility, not by line count.
  6. Every exported symbol carries a doc comment that says why, not what. CI enforces coverage.
  7. Money is integer paisa. Never float. Never. CI greps for float arithmetic in money paths.
  8. Free tier only. Cloudflare Workers + Pages + D1, TiDB Cloud Starter, imgbb, Cloudinary,
     Firebase FCM, OSM/OSRM, GitHub Actions. No paid service, no trial that expires, no credit card.
  9. Responsive from 200 px to 3840 px with zero layout breakage at any of the 50 breakpoints listed
     in docs/03-brand-and-design-system.md §9. CI screenshots every one.
 10. Bangla and English everywhere, ৳ currency, Asia/Dhaka time, and no hardcoded user-facing string.

THE DATABASE IS TIDB CLOUD STARTER, AND IT IS MYSQL — READ THIS BEFORE YOU WRITE ANY SQL
This corpus was migrated from CockroachDB. The migration is complete, but these are the traps that
look like working code and are not. docs/06-data-model-tidb.md is authoritative for all of them.
  • It is the MySQL-compatible TiDB. Do NOT use the PostgreSQL-compatible Starter preview, and do
    not reach for Postgres syntax out of habit. No ON CONFLICT, no RETURNING, no ILIKE, no ::casts,
    no arrays, no partial indexes, no gen_random_uuid().
  • INT8 IS A FOUR-BYTE INTEGER IN MYSQL. It is INT(8), capping at 2,147,483,647 paisa — about
    ৳21,474,836. Every money column is BIGINT. If you type INT8 on a money column the platform
    overflows silently in a good month. CI fails on the literal token; do not fight it.
  • CHECK CONSTRAINTS ARE NOT ENFORCED. Starter cannot set tidb_enable_check_constraint, so all 53
    declared CHECKs are parsed and ignored. The generated validators in undal-core ARE the
    enforcement, not a redundant backup. Generate them from the declarations via
    scripts/db/extract_constraints.py — never hand-write them, or check-constraint-parity fails.
  • THERE ARE NO TRIGGERS. updated_at is set by every UPDATE statement you write. audit_log
    immutability comes from table grants plus the SHA-256 chain, not from a BEFORE UPDATE guard.
  • THERE ARE NO SPATIAL TYPES. No GEOGRAPHY, no ST_Distance, no ST_Contains, no spatial index.
    Points are lat_e7/lon_e7 integers with a generated cell_id; polygons are GeoJSON with integer
    bounding boxes; exact haversine and ray-casting run in the Worker. geo-parity must pass.
  • order_items, order_state_events and order_offers HAVE NO FOREIGN KEY to their parent, on
    purpose — TiDB locks the parent row exclusively on child insert. Enforce in undal-core.
  • DDL AUTO-COMMITS. A migration file is not atomic. Statements are individually idempotent and
    tracked one at a time in schema_migrations. 000_smoke.sql runs first and must pass.
  • UUIDs are BINARY(16), generated by the application as UUIDv7. The database generates nothing.
  • Timestamps are DATETIME(6) holding UTC, never TIMESTAMP. Pin time_zone='+00:00' on every
    connection — correctness depends on it.
  • `key` and `before` are MySQL reserved words and are backticked in the schema. Keep them.
  • Connect with @tidbcloud/serverless over HTTP. There is no CA certificate secret. Interactive
    transactions on that driver are experimental: prefer single-statement atomic operations, and
    read docs/05 §6.1 before putting the ledger inside one.

WHAT YOU ARE BUILDING
  3 Cloudflare Workers:  undal-core (TypeScript), undal-realtime (TypeScript), undal-brain (Python)
  1 Cloudflare Pages project with two targets: the SEO-prerendered storefront and the admin SPA
  3 Android apps in Kotlin: Undal (customer), Undal Partner, Undal Rider
  1 TiDB schema, migrated from Actions, no CLI
  1 Cloudflare D1 database for ephemeral rider location channels
  GitHub Actions for: migrations, worker deploys, Pages deploys, keystore generation, signed APK and
  AAB builds, unit tests, property tests, money-invariant tests, routing tests, responsive screenshot
  tests, link checks, line-length checks, doc-coverage checks, and release publishing.

THE THINGS THAT MUST BE PERFECT
  • The wake-up alarm. A vendor or rider must hear a looping alarm within two seconds of an order,
    with the app swiped away and the screen locked. Implement the full stack in docs/15. Be honest in
    the UI about the force-stop case and coach the user out of it.
  • The money. Every invoice balances to zero paisa. docs/10 and docs/24 contain the exact formulas
    and the test vectors. Every vector must pass.
  • The dispatch. docs/11 and docs/12. Deterministic, explainable, replayable, and provably better
    than nearest-rider on the benchmark harness in docs/30 §4.1.
  • The map. docs/22. One full-screen OSM canvas, every rider, vendor and live order, bespoke SVG
    markers, a sliding inspector, 60 fps with 1000 markers.
  • The beauty. docs/03 and docs/04. Study the two reference videos. Spring physics, shared-element
    transitions, morphing steppers, the floating cart pill, the condensing header. Nothing basic.
    Nothing simple. Uber Eats green and Foodpanda magenta over Undal forest.

HOW TO BEHAVE
  Plan, then build. Explain decisions in the commit message, not in chat filler. If the spec is
  ambiguous, choose the option that is more correct for a real business handling real cash, write
  down the choice in docs/_plan/DECISIONS.md, and move on. Never ask the user to run a command.
  Never leave the repository red. Never ship something you have not tested.

Begin with Response 1: docs/_plan/UNDERSTANDING.md. Nothing else.
```

---

## What the agent will have read

| Group | Documents |
| --- | --- |
| Foundation | `01` mission · `02` reference analysis · `03` design system · `04` motion |
| Architecture | `05` system · `06` TiDB · `07` D1 · `08` API contract |
| The Brain | `09` overview · `10` fare math · `11` dispatch · `12` batching · `13` ranking |
| Realtime | `14` presence · `15` wake-up alarm |
| Clients | `16` Android foundation · `17` customer · `18` partner · `19` rider · `20` web · `21` admin · `22` super map |
| Operations | `23` onboarding · `24` finance · `25` cash · `26` media · `27` security |
| Delivery | `28` CI/CD · `29` secrets · `30` testing · `31` SEO · `32` localisation · `33` empty states |
| Meta | `34` repo layout · `35` execution plan · `36` acceptance · `37` feature register · `38` glossary · `39` risk register |

## Before you paste

Make sure the GitHub Actions secrets listed in
[`docs/29-secrets-and-configuration.md`](docs/29-secrets-and-configuration.md) are set. The agent
cannot create them for you — it will never see them, and that is the point.

> **Security notice.** If you have ever pasted a database password, an API key, or a service-account
> JSON into a chat window, an issue, or a commit, rotate it now, before the build starts. Treat every
> credential that has left your password manager as burned. See
> [`docs/29-secrets-and-configuration.md §1`](docs/29-secrets-and-configuration.md).
