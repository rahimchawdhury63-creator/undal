<!--
  Undal — Plan: migrate the specification from CockroachDB to TiDB Cloud Starter
  Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
  SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# Plan — Migrate the specification from CockroachDB to TiDB Cloud Starter

**Status: proposal. Nothing in the corpus has been edited.** This document is Step 0. It exists so a
human can read the whole shape of the change before a single line of the specification moves, and
reject or redirect any part of it while that is still cheap.

Everything below is either (a) verified against the corpus with a line reference, (b) verified
against PingCAP's documentation, or (c) explicitly labelled an **estimate** or an **open question**.
Nothing is asserted that has not been checked.

---

## 1. Why this migration happens

CockroachDB Cloud's free cluster is a trial that expires. TiDB Cloud Starter is free in perpetuity
within quota. Undal's binding constraint is cost permanence — a specification that stops deploying
in ninety days is not a specification. That is the whole reason. There is no other.

So the rule that governs every decision in this document:

> **Change the database. Change nothing else.**

No feature, no screen, no endpoint, no fee, no formula, no weight, no threshold, no rounding rule,
no pixel, no millisecond of motion, no word of user-facing copy. Where the database forces a
behavioural change, the change is named, measured, written into the document that owns it, and
logged as a risk in [`39`](../39-risk-register-and-truths.md). Nothing diverges silently.

### 1.1 The invariant counts

These are stated in [`37 §6`](../37-feature-register.md). If any changes, the migration is wrong:

412 endpoints · 412 permissions · 283 screens · 2,147 admin features · 4,055 platform features ·
184 error codes · 44 empty states · 147 config keys · 46 SSE events · 94 reason codes ·
179 acceptance criteria · 40 fare vectors · 64 property suites · 50 breakpoints · 118 cuisines ·
22 exception triggers · 23 workflows · 7 system roles.

Three counts **do** change, and each is justified in §9: secrets 44 → 43, mandatory secrets 12 → 11,
guardrails 28 → 30, tables 96 → 99.

### 1.2 The corpus gets longer

Replacement designs are **added**. Nothing is deleted and left as a hole. When `GEOGRAPHY` goes, a
full integer-and-cell geospatial design takes its place, with its parity test. When the WORM trigger
goes, a four-layer design takes its place, with the loss stated. The corpus is 133,014 words today
and will be longer when this is finished.

---

## 2. What I actually verified in the corpus

The prompt estimated the blast radius. I measured it. Three findings change the plan.

### 2.1 `docs/06` declares 96 tables but writes DDL for 26

`grep -c "CREATE TABLE"` on [`06`](../06-data-model-tidb.md) returns **26**. The §2 inventory
table names **96**. The other 70 are named with a one-line purpose and no columns.

**Decision: convert both surfaces, expand neither.** The 26 written `CREATE TABLE` blocks are
rewritten in MySQL dialect, completely. The §2 inventory keeps exactly its current rows and gains no
new ones except the three infrastructure tables in §9.4. Writing DDL for the missing 70 would be
scope growth disguised as thoroughness, and it is not what this migration is for.

The 26 blocks, with their current line numbers:

`users`(58) `sessions`(92) `devices`(109) `device_tokens`(130) `permissions`(152) `admin_roles`(159)
`admin_role_permissions`(168) `admin_user_roles`(174) `zones`(200) `zone_pricing`(228)
`addresses`(259) `vendors`(296) `menu_items`(355) `modifier_groups`(390) `riders`(413)
`rider_shifts`(452) `orders`(482) `order_state_events`(576) `order_offers`(634)
`ledger_accounts`(669) `ledger_entries`(683) `ledger_postings`(699) `payout_periods`(760)
`invoices`(775) `audit_log`(820) `brain_traces`(848).

Plus one more outside `06`: the `audit_log` DDL is **duplicated** in
[`27 §4.1`](../27-security-rbac-audit.md) at line 170. Both copies must be converted identically, and
a CI check should assert they stay identical — see §10.6.

### 2.2 The trigger ban already exists, and it helps

[`06 §1`](../06-data-model-tidb.md) rule 3 already forbids triggers for `updated_at`,
mandating a "trigger-free convention" enforced by a CI grep. TiDB's lack of trigger support
therefore costs the schema **nothing**. The only trigger in the entire corpus is the WORM guard in
[`27 §4.2`](../27-security-rbac-audit.md), and that one is a real loss (§6).

This is worth saying plainly in the migration PR, because "TiDB has no triggers" sounds alarming
until you check, and the check says one trigger, in one place.

### 2.3 There is a second point-in-polygon case the prompt missed

[`13 §3`](../13-ranking-personalization.md) lines 127–140 runs the ranking geo-filter against
**`vendors.service_area`**, a per-vendor polygon, with `ST_Contains`, on the hot path, `LIMIT 300`,
budgeted sub-10 ms. The prompt's spatial design covered zone polygons and radius search. It did not
cover per-vendor service areas. The replacement design in §5 now does.

Same section exposes a **pre-existing inconsistency**: `13` calls the vendor's point
`vendors.location`, `06 §5` calls it `vendors.point`. One of them is wrong today. See §11.

---

## 3. Scope — the three lists

### 3.1 Files that change

| File | Hits | What changes |
| --- | --- | --- |
| [`06-data-model-tidb.md`](../06-data-model-tidb.md) | 186 | Everything: renamed, all 26 DDL blocks converted, §1 principles rewritten, §4 geography replaced, §10 migrations rewritten, §11 queries rewritten, §12 scaling recomputed |
| [`05-system-architecture.md`](../05-system-architecture.md) | 35 | §3.3 isolation, §4.2 coordinator, §6.1 driver, §9 latency, §10 ladder, §11 metrics, §12 environments |
| [`27-security-rbac-audit.md`](../27-security-rbac-audit.md) | 11 | §4.1 DDL, §4.2 WORM redesign, §5 data classification wording, §6 rate-limit wording |
| [`29-secrets-and-configuration.md`](../29-secrets-and-configuration.md) | 11 | §2.1 secret table, §3 the 44→43 block, §5 rotation, §7 environments |
| [`39-risk-register-and-truths.md`](../39-risk-register-and-truths.md) | 8 | §2.1 free tier, §2.2 coordination modes, §3.4 R4 rewritten, §4 thresholds, §6 compromised creds, plus **new risks R29–R32** |
| [`.env.example`](../../.env.example) | 9 | Secret block and `features.coordination_mode` |
| [`01-mission-and-non-negotiables.md`](../01-mission-and-non-negotiables.md) | 7 | §5 stack table (2 rows), §5.1 cost table, §4 secret-scan patterns, 3 link/prose fixes |
| [`00-INDEX.md`](../00-INDEX.md) | 6 | Doc 06 title + link, dependency graph label, glossary line, UUID v7 rationale |
| [`13-ranking-personalization.md`](../13-ranking-personalization.md) | 4 | §3 geo-filter rewritten — **heavier than the prompt assumed**, see §2.3 |
| [`21-admin-panel.md`](../21-admin-panel.md) | 6 | Health bar label `CRDB`→`TiDB`, 2 link fixes, zone pricing note |
| [`09-undal-brain-overview.md`](../09-undal-brain-overview.md) | 5 | Warm/cold tier latencies (estimates must be re-labelled), 2 links |
| [`35-execution-plan.md`](../35-execution-plan.md) | 5 | Open-questions list: PostGIS index params and `gen_random_uuid()` questions are resolved and replaced |
| [`28-cicd-github-actions.md`](../28-cicd-github-actions.md) | 3 | Secret-presence list, migration job, §3.1 guardrail register 28→30 |
| [`30-testing-and-verification.md`](../30-testing-and-verification.md) | 3 | Chaos rows, test isolation strategy, new `geo-parity` and `no-postgres-dialect` suites |
| [`34-repository-layout.md`](../34-repository-layout.md) | 3 | `CockroachCoordinator`→`TiDBCoordinator`, `db/` tree, geo module files |
| [`36-acceptance-criteria.md`](../36-acceptance-criteria.md) | 1 | **A3** rewritten, **A176** guardrail count — see open question **Q7** |
| [`11-dispatch-engine.md`](../11-dispatch-engine.md) | 2 | §6 free-tier coordinator semantics — **and the single-statement claim design, §7.2** |
| [`24-finance-payouts-invoices.md`](../24-finance-payouts-invoices.md) | 2 | §4.1 advisory lock → lock row; link fix. **No money arithmetic touched.** |
| [`37-feature-register.md`](../37-feature-register.md) | — | §6 register: secrets, guardrails, tables |
| [`38-glossary.md`](../38-glossary.md) | 2 | `COORDINATION_MODE` values, new terms: cell grid, UUIDv7-as-BINARY(16) |
| [`07`](../07-d1-live-tracking.md) `08` `14` `33` · [`02`](../02-reference-analysis.md) | 1 each | Name and link fixes only |
| [`README.md`](../../README.md) | 2 | Stack line, architecture diagram |
| [`PROMPT.md`](../../PROMPT.md) | 3 | Stack constraint, deliverable list, doc map |

### 3.2 Files that must not change

[`03`](../03-brand-and-design-system.md) [`04`](../04-motion-and-interaction.md) [`10`](../10-fare-engine-math.md)
[`12`](../12-batching-engine.md) [`15`](../15-wakeup-alarm-fcm.md)
[`16`](../16-android-foundation.md) [`17`](../17-customer-app.md) [`18`](../18-partner-app.md)
[`19`](../19-rider-app.md) [`20`](../20-web-storefront.md) [`22`](../22-admin-super-map.md)
[`23`](../23-onboarding-kyc.md) [`26`](../26-media-pipeline.md)
[`31`](../31-seo-prerender-deeplinks.md) [`32`](../32-localization-and-currency.md), plus `brand/`,
`assets/`, `LICENSE`.

If a diff appears in any of these, it is a mistake. Every one of them returns **zero** hits for
`cockroach|postgres|postgis|crdb`, so there is no mechanical reason for any of them to move. `10`'s
arithmetic in particular is the thing most likely to be damaged by an incautious find-and-replace,
and I will treat the money documents as read-only except for the two link fixes in `24`.

### 3.3 The rename

`git mv docs/06-data-model-tidb.md docs/06-data-model-tidb.md`

Inbound references to fix: [`00`](../00-INDEX.md) ×3, [`01`](../01-mission-and-non-negotiables.md) ×2,
[`02`](../02-reference-analysis.md) ×1, [`05`](../05-system-architecture.md) ×2,
[`08`](../08-api-contract.md) ×1, [`09`](../09-undal-brain-overview.md) ×2,
[`21`](../21-admin-panel.md) ×2, [`24`](../24-finance-payouts-invoices.md) ×1,
[`28`](../28-cicd-github-actions.md) ×1, plus `README.md` and `PROMPT.md`. The `link-check` guardrail
is the arbiter; it must pass with zero broken links, as it does today.

---

## 4. The complete type and dialect mapping

### 4.1 Types

| CockroachDB | TiDB | Count in `06` | Why, and what it costs |
| --- | --- | --- | --- |
| `UUID` | **`BINARY(16)`** | 79 | 16 bytes not 36; preserves UUIDv7 byte ordering so time-ordered insert locality survives. Costs two helpers, `uuidToBin()` / `binToUuid()`, applied at the driver boundary so no application code sees bytes. `CHAR(36)` was rejected: 2.25× the index size on every FK in the schema. |
| `STRING(n)` | `VARCHAR(n)` | 134 total | Direct. |
| `STRING` (bare) | `VARCHAR(n)` with a stated `n`, or `TEXT` | — | Every bare `STRING` must be given an explicit length during conversion. A bare `STRING` that becomes `TEXT` cannot be indexed without a prefix length, so each one is a decision, not a default. The conversion table will list each with its chosen length. |
| `INT8` | **`BIGINT`** | 59 | **The single most dangerous token in this migration.** In MySQL, `INT8` parses as `INT(8)` — a 4-byte integer with a display width, maximum 2,147,483,647. Every money column in Undal is paisa. 2,147,483,647 paisa is ৳21,474,836. A platform that takes ৳1 crore in a good month silently overflows. CI must fail on the literal token `INT8` anywhere under `db/` or in `06`. |
| `INT2` | `SMALLINT` | 2 | `order_offers.wave`, `order_offers.rank_in_wave`. |
| `BOOL` | `TINYINT(1)` | 15 | TiDB accepts `BOOLEAN` as an alias; the canonical form in DDL will be `TINYINT(1)` so the generated `expected.json` matches what `information_schema` reports. |
| `TIMESTAMPTZ` | **`DATETIME(6)` holding UTC** | 70 | **Never `TIMESTAMP`** — MySQL's `TIMESTAMP` is a 32-bit epoch that ends in 2038 and silently converts on the session time zone. `DATETIME(6)` stores exactly what is written. Correctness therefore depends on every connection pinning `time_zone = '+00:00'`, which becomes a connection-level invariant with its own test (§10.5). Microsecond precision is retained because `order_state_events` ordering depends on it. |
| `JSONB` | `JSON` | 12 | TiDB's `JSON` is a binary format equivalent in capability. Path extraction is `->` / `->>` / `JSON_EXTRACT`, not `#>`. Indexing a JSON field requires a generated column or a multi-valued index. |
| `BYTES` | `VARBINARY(n)` / `BLOB` | 3 | `schema_migrations.checksum` → `VARBINARY(32)`; `audit_log.hash` and `prev_hash` → `BINARY(32)` (SHA-256 is fixed-width, so fixed-width is correct and makes the chain scan cheaper). |
| `STRING[]` | `JSON` array + `CHECK (JSON_VALID(...))` | 1 | `menu_items.contains_allergens` (line 373). MySQL has no array type. Membership queries become `JSON_CONTAINS`; if they need an index, a multi-valued index on the array is available. The allergen list is read on item display and filtered in the client, so no index is required today. |
| `FLOAT8` | `DOUBLE` | 2 | `zones.area_sq_km`, `order_offers.score`. |
| `INET` | `VARBINARY(16)` | 1, in `27` | `audit_log.ip`. 16 bytes holds IPv4-mapped and IPv6 alike. MySQL's `INET6_ATON`/`INET6_NTOA` convert both directions and are available in TiDB. `VARCHAR(45)` was rejected: it makes two spellings of the same address compare unequal. |
| `DATE` | `DATE` | 3 | Direct. |
| `DECIMAL` / `NUMERIC` | — | 0 in DDL | Both appear only in prose at line 16 explaining why money is `INT8` and **not** decimal. That prose stays; only the type name in the sentence changes. |
| `INTERVAL` | `DATE_ADD(x, INTERVAL n UNIT)` | 1 | Expression rewrite, not a column type. |

### 4.2 Defaults and functions

| CockroachDB | TiDB | Sites |
| --- | --- | --- |
| `DEFAULT gen_random_uuid()` | **nothing — the application supplies a UUIDv7** | ~30 |
| `DEFAULT now()` | `DEFAULT CURRENT_TIMESTAMP(6)` | ~35 |
| `now()` in predicates | `CURRENT_TIMESTAMP(6)` or an app-supplied parameter | several |
| `x::TYPE` | `CAST(x AS TYPE)` | ~8 |
| `ON CONFLICT DO NOTHING` | `ON DUPLICATE KEY UPDATE id = id`, then inspect `affected_rows` | — |
| `ON CONFLICT (k) DO UPDATE` | `ON DUPLICATE KEY UPDATE col = VALUES(col)` | — |
| `INSERT ... RETURNING id` | insert the app-generated UUIDv7, then `SELECT` if the row is needed | — |
| `ILIKE` | `LIKE` under a `_ci` collation | — |
| `string_agg` | `GROUP_CONCAT` | — |

**`INSERT IGNORE` is forbidden.** It swallows data-truncation and FK errors alongside duplicate-key
errors, which is how a platform loses a ledger row and never finds out. The guardrail greps for it.

`DEFAULT gen_random_uuid()` is the removal with the widest consequence: [`06 §1`](../06-data-model-tidb.md)
rule 2 currently *mandates* it on every table. Rule 2 is rewritten to mandate an application-generated
UUIDv7 instead, which the corpus already requires anyway — [`00 §glossary`](../00-INDEX.md) line 225
and [`35 §5`](../35-execution-plan.md) line 188 both note that CockroachDB's `gen_random_uuid()`
returns **v4**, not v7, and list "the UUID v7 generation source" as an open question. **This
migration closes that open question** rather than inheriting it: v7 is generated in one place per
language, with a shared test vector.

### 4.3 Index and constraint features

| Feature | Status on TiDB | Replacement |
| --- | --- | --- |
| **Partial index** (`INDEX ... WHERE`) | Not supported | Generated column + plain index, or accept a wider index. 11 sites, enumerated in §4.4. |
| **`INVERTED INDEX`** | Not supported | Gone with the spatial types. 3 sites. §5. |
| **`CHECK`** | GA v7.2, **disabled by default** via `tidb_enable_check_constraint` | **Open question Q1.** If Starter permits enabling it, the ~30 CHECKs survive as written. If not, every one becomes an application-layer invariant plus a nightly integrity job, and [`06 §1`](../06-data-model-tidb.md) rule 5 loses its enforcement teeth. Must be tested against a real Starter instance before any schema work begins. |
| **Foreign keys** | GA v8.5.0, **parent row is locked exclusively** on child insert | **Open question Q2.** Every `order_items` insert would take an exclusive lock on the `orders` row, and every order would lock the `vendors` row. At a hot vendor during lunch this serialises. Measure first; if confirmed, drop FKs on the hot child tables only (`order_items`, `order_state_events`, `order_offers`), enforce in `undal-core`, and add a nightly orphan-detection job. Keep FKs everywhere cold. |
| **`AUTO_INCREMENT`** | Cache-allocated, **not monotonic** across TiDB nodes unless `AUTO_ID_CACHE 1` | Invoice and audit sequence numbers must be gapless and ordered. Neither uses `AUTO_INCREMENT`; both use a counter row read `FOR UPDATE`. §7.3. |
| **`AUTO_RANDOM`** | Supported | Available if UUIDv7 write locality turns out to hurt. Not adopted by default — see Q3. |
| **Generated columns** | Supported, indexable (virtual and stored) | The mechanism behind both the partial-index and the cell-grid replacements. |
| **Multi-valued index** | Supported, on JSON arrays | Available for `contains_allergens` if ever needed. |
| **TTL** | Supported, interval fixed at 15 minutes on Starter | Candidate for `sessions`, `brain_traces`, `ops_logs` retention — would replace part of the request-triggered sweep. **Does not violate the no-cron rule**: TTL is a database storage property, not a scheduled job the operator runs. Q4. |
| **`FULLTEXT`** | Starter only, certain AWS regions | **Not adopted.** Vendor and item search ranking is specified in [`13`](../13-ranking-personalization.md); switching to a different relevance engine would change results. Out of scope by the one rule. |
| **TiFlash columnar** | 5 GiB free, separate from row quota | Permitted for [`21`](../21-admin-panel.md) analytics **only** where output is proven byte-identical to the row-store query. Not adopted in this migration; recorded as available headroom. |
| **Transactional DDL** | Not supported — DDL auto-commits | Rewrites the migration model. §7.1. |
| **`SERIALIZABLE`** | **Not supported** | §7.2. The largest behavioural change in the migration. |

### 4.4 The eleven partial indexes, each with its replacement

| Line | Index | Replacement |
| --- | --- | --- |
| 76 | `idx_users_email (email_norm) WHERE email_norm IS NOT NULL` | Plain index. MySQL B-trees store NULLs but skip them for equality lookup; the only cost is index size, and `email_norm` is NULL only for phone-only accounts. **No behaviour change.** |
| 141 | `idx_device_tokens_device (device_id) WHERE valid` | Generated column `device_id_if_valid` = `IF(valid, device_id, NULL)`, indexed. Query rewrites to match. |
| 282 | `idx_addresses_user (user_id) WHERE deleted_at IS NULL` | Composite `(user_id, deleted_at)`. Soft-deleted addresses are a rounding error per user; a composite index is cheaper than a generated column here. |
| 344 | `uq_vendors_slug (slug) WHERE deleted_at IS NULL` | **Must be a generated column.** A composite unique index would let two live vendors share a slug if their `deleted_at` differed. Generated stored column `slug_active` = `IF(deleted_at IS NULL, slug, NULL)` with `UNIQUE` — NULLs are not compared for uniqueness in MySQL, so deleted rows drop out of the constraint exactly as the partial index intended. |
| 345 | `idx_vendors_zone_status (zone_id, status, open_state) WHERE deleted_at IS NULL` | Append `deleted_at` as a trailing column. The hot query (§11.1) already filters all four. |
| 382 | `idx_items_vendor_section (vendor_id, section_id, sort_order) WHERE deleted_at IS NULL` | Same treatment. |
| 383 | `idx_items_availability (vendor_id, availability) WHERE deleted_at IS NULL` | Same treatment. |
| 473 | `idx_shifts_open (zone_id) WHERE ended_at IS NULL` | Generated column `zone_id_if_open`. This index is read on every dispatch; keeping it tight matters more here than anywhere else. |
| 557 | `idx_orders_rider (rider_id, created_at DESC) WHERE rider_id IS NOT NULL` | Plain composite. `rider_id` is NULL only before assignment. |
| 558 | `idx_orders_zone_live (zone_id, state) WHERE state NOT IN ('SETTLED', ...)` | Generated column `live_zone_id` = `IF(state NOT IN (...), zone_id, NULL)`, indexed. **This one is load-bearing** — `06 §11.5` notes the index "stays small because settled orders fall out of it", and that property must survive or the command map degrades as history accumulates. |
| 560 | `idx_orders_settlement (zone_id, delivered_at) WHERE state = 'SETTLED'` | Generated column `settled_zone_id`. Drives weekly invoicing (§11.4); the half-open `[start, end)` interval semantics are unchanged. |

Each generated column is **stored**, not virtual, so the index is maintained on write rather than
computed on read. The cost is bytes; the benefit is that the plan is identical to CockroachDB's.

---

## 5. The geospatial replacement

TiDB has no spatial types, no spatial functions, and no spatial indexes. PingCAP has confirmed on
its own forum that GIS is **not on the roadmap** (issue #6347). This is not a gap to work around
with a flag; it is a redesign.

### 5.1 What is lost

| Site | Current |
| --- | --- |
| `06 §1` rule 8 | The principle "geography is a first-class type" |
| `06 §4` line 213 | `zones.boundary GEOGRAPHY(POLYGON, 4326) NOT NULL` |
| `06 §4` | `zones.centroid GEOGRAPHY(POINT, 4326) NOT NULL` |
| `06 §4` line 218 | `INVERTED INDEX idx_zones_boundary (boundary)` |
| `06 §4` | `addresses.point GEOGRAPHY(POINT, 4326) NOT NULL` |
| `06 §4` line 283 | `INVERTED INDEX idx_addresses_point (point)` |
| `06 §5` line 346 | `vendors.point` + `INVERTED INDEX idx_vendors_point (point)` |
| `06 §6` lines 463–464 | `rider_shifts.start_point`, `rider_shifts.end_point` |
| `06 §7` lines 499–500 | `orders.pickup_point`, `orders.delivery_point` |
| `06 §11.1` | `ST_Distance`, `ST_DWithin` |
| `06 §11.5` | `ST_AsGeoJSON` |
| `13 §3` | `ST_Contains` on `vendors.service_area`, `ST_Distance`, `ST_DWithin` |
| `09` 407 · `34` 221 · `35` 192 · `36` A3 | References to PostGIS behaviour |

[`07`](../07-d1-live-tracking.md) is **unaffected**. D1 is SQLite, stores rider positions as plain
`REAL` latitude and longitude columns, and never used a spatial type. The migration PR will say so
explicitly, because "the geo layer changed" naturally raises the question.

The `ST_IGNORE_BATTERY_OPTIMIZATIONS`, `ST_NOTIFICATIONS` and `ST_FIX` matches in `07`, `15` and `16`
are Android constants. They are false positives and must survive the guardrail's `ST_*` pattern —
the pattern is scoped to `db/` and `06`/`13` SQL blocks for exactly this reason.

### 5.2 Storage

```sql
-- Every point in the schema becomes two integers and one indexed cell.
lat_e7   INT    NOT NULL,   -- latitude  × 10^7, so 24.8949 → 248949000
lon_e7   INT    NOT NULL,   -- longitude × 10^7, so 91.8687 → 918687000
cell_id  BIGINT AS (FLOOR(lat_e7 / 44920) * 1000000 + FLOOR(lon_e7 / 49520)) STORED,
INDEX idx_<table>_cell (cell_id)
```

Degrees × 10⁷ gives ~1.1 cm resolution (1 ° of latitude ≈ 111,320 m, so 10⁻⁷ ° ≈ 0.011 m) and fits
`INT` comfortably: the extreme longitude ±1,800,000,000 is inside `INT`'s ±2,147,483,647. Integers
mean no floating-point drift in storage and exact equality comparison on coordinates, which `DOUBLE`
cannot give.

**The generated-column expression must be pure built-in arithmetic.** TiDB has no user-defined
functions, so `cell_id` cannot call a helper — the divisors are inlined constants. 44,920 is 500 m
of latitude in e7 units; 49,520 is 500 m of longitude at Sylhet's latitude
(500 ÷ (111,320 × cos 24.9°)). A fixed longitude divisor makes cells slightly non-square away from
that latitude, which is harmless: the grid only has to be *consistent*, because the cell filter is a
prefilter that is allowed to be loose and stage 2 computes the real distance. The constants are
frozen in one place and are part of the parity test — changing them silently would invalidate every
stored `cell_zone` row.

`cell_id` reuses the corpus's **existing 500 m cell grid** — already defined in
[`38`](../38-glossary.md) and used by [`09`](../09-undal-brain-overview.md) for demand forecasting.
This is deliberate: no new concept enters the system, no new dependency, and the forecasting grid
and the search grid are the same grid, which makes them comparable.

`cell_for()` is a pure function, implemented identically in TypeScript, Python and Kotlin, with a
shared test vector — the same discipline [`24 §2`](../24-finance-payouts-invoices.md) applies to
`apply_rate()`. Because it is also a TiDB generated column, a **fourth** implementation exists in
SQL, and the parity test must cover all four. That is a real cost of this design and it is stated
rather than hidden.

### 5.3 Radius search — `ST_DWithin` replacement

Two stages, and the split is the whole design:

**Stage 1, in SQL — a prefilter that is allowed to be loose.**

```sql
WHERE v.zone_id      = ?            -- unchanged, and still the most selective predicate
  AND v.status       = 'APPROVED'
  AND v.deleted_at IS NULL
  AND v.cell_id   IN (?, ?, ?, …)   -- cells_within(centre, radius), typically 9–25 cells
  AND v.lat_e7 BETWEEN ? AND ?      -- integer bounding box, belt and braces
  AND v.lon_e7 BETWEEN ? AND ?
LIMIT 200
```

**Stage 2, in the Worker — exact haversine**, computed on the ≤200 rows the prefilter returned, then
filtered to the true radius and sorted by distance.

The prefilter is a superset of the true result by construction: a point within *r* metres of the
centre is necessarily in a cell that intersects the *r*-radius disc, and `cells_within()` returns
every such cell. Nothing inside the radius can be missed. Rows outside it are discarded in stage 2.

Three properties are preserved exactly:

- **`LIMIT 200` is unchanged.** [`06 §11.1`](../06-data-model-tidb.md) justifies the cap on
  product grounds ("ranking more than 200 vendors in one zone is not a situation that improves the
  result"), not performance grounds, so it is behaviour and it stays.
- **Distances round to integer metres before any fare arithmetic.** [`10`](../10-fare-engine-math.md)
  consumes metres as integers. The rounding happens at one boundary, in one function, and the 40
  fare vectors are the test.
- **Zone equality is still evaluated before the spatial predicate**, which is what
  [`06 §12`](../06-data-model-tidb.md) relies on for selectivity. That row of the scaling
  table changes its index name and keeps its reasoning.

### 5.4 Point-in-polygon — `ST_Contains` replacement

**Two distinct cases**, and §2.3 is why there are two.

**Case A — which zone contains this point?** Called on every address save and every order placement.
Must be exact and must be fast.

```sql
zones.polygon        JSON   NOT NULL,   -- GeoJSON ring, [[lon,lat], …], the authoritative geometry
zones.bbox_min_lat_e7 INT   NOT NULL,
zones.bbox_max_lat_e7 INT   NOT NULL,
zones.bbox_min_lon_e7 INT   NOT NULL,
zones.bbox_max_lon_e7 INT   NOT NULL,
zones.polygon_version INT   NOT NULL,   -- bumped on every polygon edit

CREATE TABLE cell_zone (                -- materialised cell → zone map
  cell_id         BIGINT  NOT NULL,
  zone_id         BINARY(16) NOT NULL,
  coverage        TINYINT NOT NULL,     -- 1 = cell fully inside, 0 = cell straddles the edge
  polygon_version INT     NOT NULL,
  PRIMARY KEY (cell_id, zone_id)
);
```

Lookup is a single indexed read on `cell_zone`. If `coverage = 1`, the answer is immediate and no
geometry is evaluated. If `coverage = 0` the point is in an edge cell, and the Worker ray-casts
against the GeoJSON ring to decide. Sylhet's zone polygons are simple and few; the fraction of
points landing in edge cells is small, and the ray-cast is microseconds.

`cell_zone` is rebuilt **when a polygon is saved**, in the same request, inside the transaction that
writes the polygon. **Event-driven, no cron** — which the operator constraint requires and which is
also simply correct: a zone map that is stale for even a minute puts orders in the wrong zone, and
the wrong zone changes the fare.

**Case B — does this vendor's service area contain the customer?** ([`13 §3`](../13-ranking-personalization.md))
This one is per-vendor, and there can be hundreds of vendors. Materialising cell→vendor would be
large and would churn on every vendor edit.

Different design, and it is cheaper: the candidate set is **already bounded** by the time
`ST_Contains` runs. Stage 1 of §5.3 has already cut to ≤300 vendors in one zone within
`max_delivery_m`. So:

```sql
vendors.service_area        JSON NOT NULL,   -- GeoJSON ring
vendors.sa_bbox_min_lat_e7  INT  NOT NULL,   -- indexed with the zone/status composite
vendors.sa_bbox_max_lat_e7  INT  NOT NULL,
vendors.sa_bbox_min_lon_e7  INT  NOT NULL,
vendors.sa_bbox_max_lon_e7  INT  NOT NULL,
```

SQL filters on the bounding box — a cheap integer range test that eliminates most non-matching
vendors. The Worker ray-casts the survivors. `LIMIT 300` is unchanged. The sub-10 ms budget in
`13 §3` becomes an **estimate** pending measurement, and is re-labelled as such.

### 5.5 `ST_AsGeoJSON` — the command map

[`06 §11.5`](../06-data-model-tidb.md) returns pickup and dropoff as GeoJSON for the admin
map. With integer columns there is nothing to serialise: the query returns four integers and the
Worker assembles the GeoJSON the map already expects. **The wire format to the admin client does not
change**, which matters because [`21`](../21-admin-panel.md) is in the must-not-change list.

### 5.6 `zones.area_sq_km` — the CI invariant that must be re-specified

`06 §4` denormalises `area_sq_km` and asserts a CI invariant that it agrees with the polygon **to
0.1%**. That test currently calls PostGIS. It must be re-specified against the GeoJSON ring.

**Decision: spherical excess on the WGS-84 authalic sphere (R = 6,371,007.2 m), not a planar
approximation.** Sylhet's zones span a few kilometres, where planar error is well under 0.1% — but
the tolerance is the test's whole point, and a method whose error is a function of latitude makes
the tolerance meaningless the first time a zone is drawn somewhere else. Spherical excess is a
dozen lines, has no latitude dependence at Bangladesh's scale, and makes the 0.1% tolerance mean
what it says.

**The 0.1% tolerance is unchanged.** Only the computation behind it changes.

### 5.7 The parity gate: `geo-parity`

A new required CI check. Without it, this entire section is an assertion.

| Property | Cases | Pass condition |
| --- | --- | --- |
| Radius search | 10,000 random (centre, radius) pairs over the Sylhet bounding box, radii 200 m – 15 km | Candidate set **identical** to the reference implementation; every distance within **±1 m**; ordering identical after integer-metre rounding |
| Point-in-polygon | 10,000 random points against the real zone polygons, with **at least 2,000 deliberately placed within 5 m of an edge** | Exact agreement, including on-boundary cases, against the reference |
| Cell function parity | The shared test vector | TypeScript, Python, Kotlin **and the SQL generated column** all agree |
| Area | Every zone polygon | Spherical-excess area within 0.1% of the stored `area_sq_km` |

The reference implementation is a vetted geometry library used **in the test only**, never in
production — it exists to be the oracle, and depending on it at runtime would reintroduce the
dependency the design removes.

Boundary behaviour is defined, not discovered: **a point exactly on a polygon edge is inside.** The
ray-cast and the reference are both configured that way, and the 2,000 near-edge cases are what
proves they agree. Ties in distance sort break by `vendor_id` ascending, so ordering is total and
reproducible.

`geo-parity` runs on every PR. It is one of the two new guardrails.

---

## 6. WORM — what is lost, and the four layers that replace three

[`27 §4.2`](../27-security-rbac-audit.md) specifies three independent layers protecting `audit_log`.
Layer 1 is a `BEFORE UPDATE OR DELETE` trigger. TiDB has no triggers.

**Layer 1 is lost. It cannot be replaced, and the corpus will say so in those words.**

This is the one place in the migration where the platform is genuinely weaker afterwards. The
difference is concrete: today, an `UPDATE audit_log` issued by a connection that somehow holds write
privilege is **refused by the database**. Afterwards it succeeds at the storage layer and is
**detected** by the hash chain. Prevention becomes detection. That is worse, and no amount of
redesign makes it not worse.

What can be done is to make detection fast, routine, and itself auditable.

| Layer | Before | After |
| --- | --- | --- |
| 1 — Trigger | `BEFORE UPDATE OR DELETE` raises unconditionally | **Impossible. Removed and declared lost.** |
| 2 — Grants | App role has `INSERT`, `SELECT` only | **Promoted to primary defence**, with exact GRANTs written out |
| 3 — Hash chain | `SHA256(prev_hash ‖ canonical_json(row))` | **Unchanged** |
| 4 — Verification | `verify_audit_chain()` ran on deploy, on demand, nightly | **New: moved into `undal-core`, and its own runs are recorded** |

### 6.1 Layer 2, written out

TiDB does not support column-level privileges (issue #9766). It does support table-level `GRANT`,
which is all layer 2 ever needed.

```sql
-- undal_app: the Worker's identity. Cannot alter history, cannot alter schema.
GRANT INSERT, SELECT ON undal.audit_log TO 'undal_app'@'%';
-- and explicitly NOT: UPDATE, DELETE, DROP, ALTER, CREATE, INDEX, REFERENCES

-- undal_migrator: used only by migrate.yml. Holds DDL. Never used by a Worker.
GRANT ALL PRIVILEGES ON undal.* TO 'undal_migrator'@'%';
```

Two users, two secrets, two blast radii. This separation already exists in
[`29 §2.1`](../29-secrets-and-configuration.md) — `COCKROACH_DATABASE_URL` and
`COCKROACH_MIGRATION_URL` are separate secrets with separate privileges. The migration preserves the
structure and renames the secrets.

A CI job asserts the grants: connect as `undal_app`, attempt `UPDATE audit_log SET severity='INFO'
WHERE id = <nonexistent>`, require error 1142. **A permission test that never attempts the forbidden
operation is not a test**, and this one attempts it on every deploy.

### 6.2 Layer 4, new

`verify_audit_chain(from_seq, to_seq)` is specified today as a SQL function. TiDB has no stored
functions, so it moves into `undal-core` as TypeScript. It walks the chain in batches, recomputes
each hash, and returns the first break.

The addition is that **each run is recorded**:

```sql
CREATE TABLE audit_verifications (
  id          BINARY(16) PRIMARY KEY,
  ran_at      DATETIME(6) NOT NULL,
  from_seq    BIGINT NOT NULL,
  to_seq      BIGINT NOT NULL,
  result      VARCHAR(16) NOT NULL,   -- OK | BREAK | ERROR
  break_seq   BIGINT NULL,
  duration_ms INT NOT NULL,
  trigger     VARCHAR(16) NOT NULL    -- DEPLOY | ADMIN | NIGHTLY
);
```

Because each run records the range it covered, a **gap in verification coverage is itself
detectable**. Without this table, an attacker's best move is not to break the chain — it is to
ensure verification stops running. The table makes that visible.

The nightly run is a GitHub Actions `schedule` on the repository, not a cron job on
infrastructure — the operator constraint forbids cron on the platform, and this is CI, which the
corpus already uses for scheduled verification.

Unchanged: indefinite retention, the 94 reason codes, `AUDIT_CHAIN_BROKEN` at severity CRITICAL.

### 6.3 Logged as a risk

New entry in [`39 §3`](../39-risk-register-and-truths.md):

> **R29 — Audit WORM enforcement is detective, not preventive · High · Unlikely**
> TiDB has no triggers, so `audit_log` immutability can no longer be refused at the storage layer.
> Mitigation: table-level grants deny `UPDATE`/`DELETE` to the application role, verified on every
> deploy by a test that attempts the write; the SHA-256 chain detects any alteration; verification
> runs are themselves recorded so coverage gaps are visible.
> **Residual: real.** An actor holding the migration credential can alter history and recompute the
> chain. That was true under CockroachDB too — the trigger ran as the table owner and could be
> dropped by the same credential. What is genuinely lost is defence against an *application-level*
> compromise that does not hold DDL rights.

That last sentence is the honest measure of the loss. It is smaller than "WORM is gone", and it is
not zero.

---

## 7. Isolation, locking, and the things that must not race

### 7.1 Migrations — DDL auto-commits

[`06 §10`](../06-data-model-tidb.md) rule 4 says migrations apply "inside a transaction per
file". **On TiDB that statement is false.** DDL auto-commits; a file that fails halfway leaves half
its statements applied.

The model becomes statement-level:

1. Each migration file is a sequence of individually idempotent statements.
2. `schema_migrations` gains a `statement_index`; the primary key becomes `(version, statement_index)`.
3. The runner records each statement as it succeeds, so a failed run **resumes** rather than
   restarting.
4. `checksum` still refuses an edited-after-applied file. That protection is unchanged and is, as
   the current text says, the single most common way a team corrupts a schema.
5. Forward-only is unchanged. Idempotent is unchanged — and more important now.
6. Rule 3 ("online") is rewritten: the CockroachDB-specific justification is replaced with TiDB's
   online-DDL behaviour and the same practical check (no `SET NOT NULL` on a populated column
   without a preceding backfill migration).

This is a real change to `.github/workflows/migrate.yml` and to `scripts/db/verify_schema.py`, which
is rewritten against MySQL's `information_schema`. Note that CHECK constraints do **not** appear in
`information_schema.table_constraints` on TiDB — they are in `CHECK_CONSTRAINTS` and
`TIDB_CHECK_CONSTRAINTS` — so a verifier written against the obvious table silently reports zero
CHECKs and passes. The rewritten verifier reads the right tables, and its own fixture proves it
catches a dropped CHECK.

### 7.2 Isolation — the SERIALIZABLE claim is false on TiDB

[`05 §3.3`](../05-system-architecture.md) line 196: *"CockroachDB runs `SERIALIZABLE` by default.
That is the right isolation level for a ledger."* TiDB does not support `SERIALIZABLE` at all. Its
default is **pessimistic** transactions at `REPEATABLE READ`.

So the retry loop in `05 §3.3` changes meaning. Pessimistic locking means fewer serialization
failures and more lock waits; the `40001` retry ladder becomes a MySQL `1213` (deadlock) /
`1205` (lock wait timeout) ladder. The loop keeps its shape — 5 attempts, full-jitter exponential
backoff — and its error predicate changes. The two rules survive verbatim and matter more: **no
external HTTP call inside a transaction**, and **transaction bodies must be safe to run twice**.

Under REPEATABLE READ, correctness now depends on explicit locking at every read-then-write. Six
places in the corpus do read-then-write on contended rows, and each gets an explicit `FOR UPDATE`
and a 50-way concurrent property test:

| # | Site | What breaks without a lock |
| --- | --- | --- |
| 1 | Ledger balance read before posting | A posting computed from a stale balance; the ledger stops closing to zero |
| 2 | Rider cash-in-hand cap (৳3,500) | Two concurrent cash orders both pass the cap; the rider exceeds it |
| 3 | Dispatch claim | Two riders accept one order — **the exact failure `05 §4.2` exists to prevent** |
| 4 | Invoice period boundary | An order lands in two invoices, or none |
| 5 | bKash TrxID uniqueness | One transaction ID credited twice |
| 6 | Idempotency key lease | A duplicated order from a retried request |

Each already has a property suite in the 64; the suites gain concurrency. The count stays 64.

**And a design improvement that falls out of the constraint.** `05 §4.2` rejected
`SELECT ... FOR UPDATE` for dispatch partly because it costs "a distributed-SQL round trip per
offer, ~25 ms". Over the stateless HTTP driver an interactive transaction costs **four** round trips
(BEGIN, SELECT, UPDATE, COMMIT), which would be far worse. But the dispatch claim does not need a
transaction at all:

```sql
UPDATE dispatch_locks
   SET holder_rider_id = ?, acquired_at = ?, expires_at = ?
 WHERE order_id = ?
   AND (holder_rider_id IS NULL OR expires_at < ?);
-- exactly one caller gets affected_rows = 1
```

A single conditional `UPDATE` is atomic by itself. One round trip, not four. No lock to leak if a
Worker dies — the lease expiry already handles that. **Identical semantics, strictly better
mechanics.** The claim path gets *simpler* under TiDB than it was under CockroachDB, and
`05 §4.2`'s options table will be rewritten to say so rather than carrying a rejection that no
longer applies.

The mode is renamed `cockroach` → **`sql`**, and the class `CockroachCoordinator` →
**`TiDBCoordinator`**. `durable-object` is untouched. The 14-method `Coordinator` interface is
untouched.

### 7.3 Locks that no longer exist

| Mechanism | Used by | Replacement |
| --- | --- | --- |
| `pg_advisory_lock` | [`24 §4.1`](../24-finance-payouts-invoices.md) invoice generation | A `generation_locks` row claimed by the same single conditional `UPDATE` pattern, with lease expiry. MySQL's `GET_LOCK()` is session-scoped and the HTTP driver has no durable session, so it is unusable here — this must be stated, because `GET_LOCK()` is the obvious wrong answer. |
| `AUTO_INCREMENT` for invoice numbers | `24` | A counter row read `FOR UPDATE`. Invoice numbers must be gapless and monotonic for audit; TiDB's `AUTO_INCREMENT` is cache-allocated per node and is neither, unless `AUTO_ID_CACHE 1` — and relying on a table option for a legal-document numbering guarantee is the wrong trade. |
| `audit_log.seq` | `27` | Same counter-row pattern. "Monotonic, gapless" is in the column comment and is a requirement, not a nicety. |

### 7.4 Driver and connectivity

[`05 §6.1`](../05-system-architecture.md) currently specifies `connect()` from `cloudflare:sockets`,
the `postgres` driver, and a build-time-embedded `COCKROACH_CA_CERT`. All three go.

Replacement: **`@tidbcloud/serverless`**, a fetch-API HTTP driver built for Workers. No TCP socket,
no CA certificate, no connection pooling concern — which deletes a paragraph of explanation about
why a long-lived pool in an isolate is a leak waiting to happen. The 400-connection Starter limit
stops being a live risk on the HTTP path.

**Two things must be said honestly, because the ledger depends on them:**

1. **Interactive transactions on the serverless driver are experimental.** They are documented as
   not concurrency-safe, they auto-rollback after 10 minutes idle, and a dropped gateway TCP
   connection rolls the transaction back. For a ledger this is material. The mitigation is to
   minimise interactive-transaction use: single-statement atomic operations wherever the semantics
   allow (§7.2), and batch multi-statement work into a single round trip where it does not. Where an
   interactive transaction is genuinely required — ledger posting is the clear case — the corpus will
   say that it is experimental and what the failure mode looks like.
2. **Starter has no Mumbai region.** It runs in five AWS regions: `us-west-2`, `us-east-1`,
   `eu-central-1`, `ap-southeast-1` (Singapore), `ap-northeast-1` (Tokyo). CockroachDB was in
   `gcp-asia-south1` (Mumbai). **Singapore** is the choice — roughly 2,900 km from Dhaka against
   Mumbai's 1,700 km. Every latency number touching the database is therefore an estimate until
   measured. §8.

**And a recommendation that follows:** a Worker runs at the PoP that terminates the request, so a
Dhaka user's request runs in or near Dhaka and every database round trip crosses to Singapore.
Cloudflare **Smart Placement** relocates a Worker to run near its backend instead, paying the client
round trip once rather than once per query. For `undal-core`, which is database-heavy on every
request, this is likely a large net win — and it is free. It is a deployment-configuration change,
so it is **open question Q5** rather than a decision I will make alone.

---

## 8. Every number that must be recomputed

This is the section to read if you read nothing else. Each row is a published number in the corpus
that this migration invalidates.

### 8.1 Storage and quota

| Where | Today | After | Derivation |
| --- | --- | --- | --- |
| `01 §5`, `01 §5.1`, `39 §2.1` | CockroachDB "10 GiB storage" | **TiDB Starter: 5 GiB row + 5 GiB columnar** | Published Starter quota. Row storage **halves**. The columnar 5 GiB is a TiFlash replica quota, not extra primary capacity. |
| `06 §12` | "The 10 GiB free tier holds ~20 years" | **≈ 3.5 years** | The original divided 10 GiB by orders-and-items alone (400 MB/yr → 25 yr, stated as ~20). Honest arithmetic on 5 GiB must include everything: `brain_traces` capped ~2 GB + `ops_logs` capped ~0.4 GB + other tables ~0.2 GB ≈ 2.6 GB fixed; growth is orders+items 400 MB/yr + `order_state_events` 300 MB/yr = 700 MB/yr. (5,120 − 2,600) ÷ 700 ≈ **3.6 years**. **This is a significant downgrade and must be stated as one**, with the mitigation named: tightening `brain_traces` retention (already 7–90 days) reclaims most of the fixed cost. |
| `01 §5.1` | "~0.9 GiB, ~21 M RU, 58% headroom" | **Withdrawn pending measurement** | See below. |
| `39 §2.1` | "~1.4 GiB, ~31 M RU, 1.6× headroom" | **Withdrawn pending measurement** | See below. |

**On RU:** a TiDB Request Unit and a CockroachDB Request Unit are different units measuring
different work. The existing projections were derived against CockroachDB's model and **do not
transfer**. Carrying them over with the vendor name swapped would be exactly the silent-divergence
this migration forbids. Both are therefore replaced with: *"50 M RU/month. Undal's consumption
against TiDB's RU model is **unmeasured**. It will be recorded in the first week of production and
published here. The estimate is withdrawn rather than converted."*

Note also that `01 §5.1` and `39 §2.1` **already disagree** with each other (0.9 GiB/21 M RU versus
1.4 GiB/31 M RU) for the same 500 orders/day. That is a pre-existing defect; see §11.

### 8.2 Latency

Every one of these becomes an estimate with a stated basis, and every one gets a measurement task
in the PR's day-one list.

| Where | Today | After | Why |
| --- | --- | --- | --- |
| `05 §9` catalogue list | "300 ms = 40 edge + **120 Cockroach** + 60 rank + 80 transfer" | DB component **estimate ~150 ms** | ~+30 ms for Dhaka→Singapore over Dhaka→Mumbai. This pushes the total to ~330 ms and **breaks the 300 ms budget** — see **Q6**. |
| `05 §9` place-order ACK | "550 ms, of which **180 ms transaction**" | **Estimate, unresolved** | A multi-statement transaction over HTTP is several round trips. With Smart Placement (Q5) this likely holds; without it, it likely does not. Cannot be resolved on paper. |
| `05 §4.2`, `39 §2.2` | SQL-mode claim latency **31 ms p50** | **Estimate ~15 ms with Smart Placement, ~70 ms without** | The single conditional `UPDATE` (§7.2) is one round trip rather than four, which is what makes the optimistic figure possible. Must be measured. |
| `05 §4.2` | "`SELECT ... FOR UPDATE` … ~25 ms per offer" | **Rewritten** | The rejection no longer applies — see §7.2. |
| `09 §3` warm tier | "CockroachDB `vendor_stats` ~18 ms" | **Estimate ~45 ms** | Same regional basis. The Brain's 400 ms timeout has headroom; this is stated, not assumed. |
| `09 §3` cold tier | "CockroachDB base tables ~40 ms" | **Estimate ~70 ms** | Same. |
| `05 §4` presence p95 | SQL mode **1.9 s** | **Estimate, must be re-measured** | The 2-second acceptance criterion depends on it. This is the number with the least headroom in the corpus and the one most likely to force Workers Paid. Flagged in the PR as day-one measurement #1. |
| `13 §3` geo-filter | "sub-10 ms at city scale" | **Estimate** | New two-stage design, new region. |
| `21 §2` health bar | "🟢 CRDB 23ms" | "🟢 TiDB — ms" | Illustrative, but it should not illustrate a number that is now wrong. |

### 8.3 Scale thresholds — `39 §4`

| Orders/day | Today | After |
| --- | --- | --- |
| 1,500 | "CockroachDB RU → paid tier ~$25/month" | **Unknown until RU is measured.** The threshold may move in either direction. Honest entry: *"TiDB Starter quota — threshold unmeasured; paid tier starts around $25/month."* |
| 3,000 | "`dispatch_locks` contention → Workers Paid $5/month" | **Likely moves.** The single-statement claim removes three of four round trips, which pushes contention *up*; the longer RTT to Singapore pushes it *down*. Net effect unknown. Must be load-tested before the number is republished. |
| 500 / 5,000 / 10,000 / 25,000 / 50,000 | Unchanged | Unchanged — none depends on the database vendor |

`39 §3.4` (R4) is rewritten from "CockroachDB free-tier limits" to TiDB Starter's, with the storage
arithmetic from §8.1 and the RU honesty from §8.1. Its "Residual: real" verdict stands, and the
storage half makes it slightly worse.

### 8.4 Counts that change

| Count | Today | After | Why |
| --- | --- | --- | --- |
| Secrets | 44 | **43** | −3 (`COCKROACH_DATABASE_URL`, `COCKROACH_CA_CERT`, `COCKROACH_MIGRATION_URL`), +2 (`TIDB_DATABASE_URL`, `TIDB_MIGRATION_URL`). The CA cert has no successor: the HTTP driver uses public TLS. |
| Mandatory secrets | 12 | **11** | −2 mandatory (URL + CA), +1 mandatory (`TIDB_DATABASE_URL`). |
| Guardrails | 28 | **30** | +`no-postgres-dialect`, +`geo-parity`. |
| Tables | 96 | **99** | +`cell_zone`, +`audit_verifications`, +`generation_locks`. |
| Config keys | 147 | **147** | `features.coordination_mode` keeps its name; only its value changes, `"cockroach"` → `"sql"`, and its comment block. |

The secret count appears in `29 §3`, `37 §6`, `README.md` and `.env.example`'s header; the
`env-example-complete` guardrail is the arbiter and must pass. The table count appears in `05 §6.1`,
`05 §12`, `06 §2`, `01 §5` and `README.md`.

---

## 9. New CI guardrails

### 9.1 `no-postgres-dialect`

Fails the build on any of these tokens in `db/`, `docs/06-data-model-tidb.md`, or SQL fenced blocks
elsewhere in `docs/`:

`INT8` · `STRING(` · `TIMESTAMPTZ` · `JSONB` · `BYTES` · `UUID` as a column type · `gen_random_uuid`
· `ON CONFLICT` · `RETURNING` · `ST_` · `GEOGRAPHY` · `GEOMETRY` · `INVERTED` · `pg_` · `::` casts ·
`INDEX ... WHERE` · `ILIKE` · `string_agg` · `INSERT IGNORE` · `SERIALIZABLE`

It ships with a **failing fixture** — a small SQL file containing one of each token, which the test
asserts the guard rejects. A linter nobody has watched fail is not a linter.

The `ST_` pattern is scoped to SQL contexts so the Android constants `ST_IGNORE_BATTERY_OPTIMIZATIONS`,
`ST_NOTIFICATIONS` and `ST_FIX` in `07`, `15` and `16` continue to pass, and the fixture includes one
of them as a **must-not-fire** case.

### 9.2 `geo-parity`

Specified in §5.7. Required on every PR.

### 9.3 Registration

Both must be added to [`28 §3.1`](../28-cicd-github-actions.md) (guardrail register),
[`30`](../30-testing-and-verification.md) (test taxonomy), [`36`](../36-acceptance-criteria.md)
(A176's count) and [`37 §6`](../37-feature-register.md). A guardrail that exists in a workflow file
but not in the register is invisible to the corpus, and the register is what makes the count
meaningful.

---

## 10. Work order

Seven commits, each independently reviewable, each leaving the corpus internally consistent.

| # | Commit | Contents |
| --- | --- | --- |
| 1 | Rename `06` and fix inbound links | `git mv` + 15 link fixes. `link-check` green. No content change. |
| 2 | Convert the schema | `06` §1 principles, all 26 DDL blocks, §2 inventory +3 tables, type mapping, partial-index replacements. The largest commit. |
| 3 | Replace the geospatial layer | `06` §4/§11.1/§11.5, `13` §3, the cell-grid design, `geo-parity` specification |
| 4 | Isolation, locking, migrations, driver | `05` §3.3/§4.2/§6.1, `06` §10, `11` §6, `24` §4.1, `34` |
| 5 | WORM redesign | `27` §4.1/§4.2, `audit_verifications`, the grant test |
| 6 | Secrets, config, environments | `29`, `.env.example`, `28`, `05` §12 |
| 7 | Numbers, risks, registers, surface | `39` (incl. R29–R32), `01`, `00`, `09`, `21`, `30`, `35`, `36`, `37`, `38`, `README.md`, `PROMPT.md` |

Every file keeps its HTML-comment licence header, SPDX line, italic footer and "Reading on" pointer.
Every commit carries the fixed footer:

```
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
```

Then one PR: **"Migrate the specification from CockroachDB to TiDB Cloud Starter"**, whose body
states what changed, what did not, what got worse, and what must be measured on day one.

---

## 11. Pre-existing defects found while surveying

Not caused by this migration. Found because converting a schema means reading it closely. Each needs
a decision — **open question Q8**.

| # | Defect | Where |
| --- | --- | --- |
| 1 | The vendor point column is `vendors.point` in `06 §5` and `vendors.location` in `13 §3`. One is wrong. | `06` 346, `13` 131 |
| 2 | The spatial index is called **GIN** in `01 §5` and `06 §12`, and **GIST** in `13 §3`. CockroachDB calls it `INVERTED`. All three are loose. | `01` 304, `06` §12, `13` 130 |
| 3 | Free-tier projections disagree: `01 §5.1` says 0.9 GiB / 21 M RU / 58%; `39 §2.1` says 1.4 GiB / 31 M RU / 1.6×. Same platform, same 500 orders/day. | `01` 326, `39` 41 |
| 4 | Workers request projections disagree: `01 §5.1` ~62,000/day; `39 §2.1` ~42,000/day. | `01` 320, `39` 36 |
| 5 | `audit_log` DDL is duplicated verbatim in `06 §9` and `27 §4.1` with no stated authority. | `06` 820, `27` 170 |

**Recommendation:** fix 1, 2 and 5 inside this migration — 1 and 2 are spatial, so they are in the
blast radius anyway, and 5 becomes a CI check that the two copies match. Leave 3 and 4 alone: they
are quota projections, both are being withdrawn pending measurement (§8.1), and the measurement will
replace both with one number. Fixing them now would mean inventing a third estimate.

---

## 12. Open questions — ANSWERED 2026-11-01

All eight are resolved. The operator answered Q1 and Q7 directly, and answered Q2 and Q6 with a
standing rule that also settles Q3, Q4, Q5 and Q8:

> *"Proceed with the system that doesn't lose any features or functionality from the Undal app and
> keeps working as well as CockroachDB Cloud, but using TiDB Cloud free. The whole of Undal must be
> free."*

**Resolutions, binding on all seven commits:**

| # | Decision | Basis |
| --- | --- | --- |
| **Q1** | **Application-layer enforcement + nightly integrity job**, if `tidb_enable_check_constraint` cannot be set on Starter. `06 §1` rule 5 is rewritten to state plainly that enum enforcement is application-level and weaker. CHECK is still declared in the DDL so it takes effect the day Starter permits it. | Operator choice |
| **Q2** | **Drop FKs on `order_items`, `order_state_events`, `order_offers` only.** Enforce in `undal-core` on the write path, add nightly orphan detection, keep FKs on every cold table. | Standing rule: this is the only option that loses no integrity *and* does not serialise dispatch at a busy vendor. Keeping all FKs would make lunch-hour dispatch worse than CockroachDB; dropping all FKs would lose integrity. |
| **Q3** | **Accept the UUIDv7 write hotspot.** No `SHARD_ROW_ID_BITS`, no non-clustered PK. Revisit above 5,000 orders/day. | Standing rule: sharding would destroy the range-scan locality that is the stated reason `00` chose v7 — a functional regression. 12 writes/minute is far below where the hotspot bites. |
| **Q4** | **Adopt TiDB TTL** for `sessions`, `brain_traces`, `ops_logs`, keeping the request-triggered sweep as a fallback. | Standing rule + free: TTL is a storage property, not a cron job, and it materially protects the 5 GiB ceiling that §8.1 shows is now the tightest constraint. |
| **Q5** | **Enable Cloudflare Smart Placement on `undal-core`.** Measure with and without; publish both. | Standing rule + free: Smart Placement costs nothing and pays the Dhaka→Singapore round trip once per request instead of once per query. It is the main reason the latency budgets can hold. |
| **Q6** | **Cache harder; hold the published 300 ms.** Extend the existing 60 s KV caching to the zone's vendor list. Publish the cache-miss path separately and honestly. | Operator standing rule: the published budget is specified behaviour and does not change. KV is already in the stack and already free. |
| **Q7** | **Hold at 179 acceptance criteria.** A3 is rewritten as the TiDB criterion with `geo-parity` as its proof; A176's guardrail count goes 28 → 30. | Operator choice |
| **Q8** | **Fix pre-existing defects 1, 2 and 5** (`vendors.point`/`location`, GIN/GIST/INVERTED, duplicated `audit_log` DDL). **Leave 3 and 4** — both are quota projections being withdrawn pending measurement. | Standing rule: 1 and 2 are naming errors inside the spatial blast radius; 5 becomes a CI equality check. |

**Nothing in this table changes platform behaviour.** Q2 is the only one that removes a database
mechanism, and it replaces it with an equivalent enforced one layer up plus a detector — which is
the same trade §6 makes for WORM, for the same reason, and it is logged the same way.

The original questions, as asked, are preserved below for the record.

---

Numbered so they can be answered by reference. **Q1, Q2 and Q6 block work; the rest do not.**

| # | Question | Why it needs you | My recommendation |
| --- | --- | --- | --- |
| **Q1** | **Does TiDB Cloud Starter allow `tidb_enable_check_constraint = ON`?** | CHECK is GA but off by default, and Starter restricts some system variables. If it cannot be enabled, ~30 constraints — including every enum in the schema — move to the application layer, and `06 §1` rule 5 loses its enforcement. **Blocks commit 2.** | Test on a real Starter instance before schema work starts. If unavailable: application-layer enforcement plus a nightly integrity job, stated plainly as weaker. |
| **Q2** | **Do we keep foreign keys on hot child tables?** | FKs are GA on v8.5, but the parent row is locked exclusively on child insert. Every `order_items` insert locks its `orders` row; every order locks its `vendors` row. At a busy vendor this serialises. Conflicts directly with `06 §1` rule 6, "all FKs are declared". **Blocks commit 2.** | Measure with a 50-concurrent-order load test. If contention is confirmed: drop FKs on `order_items`, `order_state_events`, `order_offers` only; enforce in `undal-core`; nightly orphan detection; keep FKs everywhere else. Rewrite rule 6 to say exactly which tables and why. |
| **Q3** | **`SHARD_ROW_ID_BITS` / non-clustered PK, or accept the UUIDv7 write hotspot?** | Time-ordered keys concentrate writes on one region. Sharding spreads them and destroys range-scan locality — which is the *reason* the corpus chose v7 (`00` line 225). | Accept the hotspot at 500 orders/day; 12 writes/minute is three orders of magnitude below where this matters. Record the decision and the trigger for revisiting it. |
| **Q4** | **Adopt TiDB TTL for `sessions`, `brain_traces`, `ops_logs`?** | It is a storage property, not a scheduled job, so I read it as compatible with the no-cron rule — but that rule is yours and the reading is mine. | Adopt, because it makes the 5 GiB storage ceiling (§8.1) materially safer, and keep the request-triggered sweep as a belt-and-braces fallback. |
| **Q5** | **Enable Cloudflare Smart Placement on `undal-core`?** | It likely rescues the latency budgets (§8.2) by paying the client round trip once instead of once per query. But it is a deployment-configuration change, it is free, and it affects every published latency number. | Enable, measure both ways, publish both. If it works, several budgets hold unchanged — which is the best possible outcome for the one rule. |
| **Q6** | **The catalogue-list budget: raise it, or cache harder?** | `05 §9` publishes 300 ms. The new DB estimate pushes it to ~330 ms. Either the published budget changes — a visible spec change — or the zone's vendor list gets KV-cached to keep the hot path off the database. **Blocks commit 7.** | Cache harder. Extend the existing per-vendor KV caching (60 s TTL, already specified) to the zone vendor list, hold 300 ms on the cache-hit path, and publish the cache-miss path honestly as a separate, slower number. |
| **Q7** | **Acceptance criteria: hold at 179, or go to 181?** | The invariant list fixes 179. But two new guardrails arguably deserve their own criteria. I will not silently break a stated invariant. | **Hold at 179.** Rewrite A3 to be the TiDB criterion and make `geo-parity` its proof; A176's guardrail count goes 28 → 30. Geo-parity is migration verification, not a new platform capability, so extending A3 is the honest modelling, not a dodge. |
| **Q8** | **Fix the five pre-existing defects in §11?** | They are out of scope by the one rule, but three are directly in the blast radius. | Fix 1, 2 and 5. Leave 3 and 4 to be replaced by measurement. |

---

## 13. What I will not do

Stated so that its absence is a decision rather than an oversight.

- **Not touch money.** `apply_rate()` byte-identical across three languages; BIGINT paisa; banker's
  rounding; 275,001 differential vectors; the ledger closing to zero. The only change in `24` is an
  advisory lock becoming a lock row, and two link fixes.
- **Not adopt `FULLTEXT`.** It would change search relevance, and relevance is specified behaviour.
- **Not adopt TiFlash** in this migration. Recorded as available free headroom for `21`'s analytics,
  behind a proof of identical output.
- **Not write DDL for the 70 named-only tables.** Scope growth.
- **Not fix the known tax-base defect** in `10 §12` / `06 §8.2`. It is carried deliberately,
  `ledger-closure` CI is its arbiter, and it is logged as `39` R16. Fixing it here would hide a
  behaviour change inside a database migration, which is precisely the thing the one rule forbids.
- **Not change a single word of user-facing copy**, including the degradation-ladder strings in
  `05 §10`. "Undal is having trouble. Your cart is saved." is what the customer sees whichever
  database is unreachable. Only the row label in the table's left-hand column changes.

---

## 14. The honest summary

Undal after this migration is the same platform on a database that does not expire. Four things are
genuinely worse and all four are stated in the corpus rather than buried here: **audit WORM becomes
detective instead of preventive**; **free row storage halves from 10 GiB to 5 GiB, cutting the
runway from a claimed twenty years to about three and a half**; **the database moves ~1,200 km
further from Dhaka and every latency figure in the corpus becomes an estimate until measured**; and
**interactive transactions run on an experimental driver path that the ledger depends on**.

Two things are better: the dispatch claim becomes a single atomic statement instead of a four-round-trip
transaction, and the connection layer loses a CA certificate, a TCP socket and a pooling concern.

Everything else is a type name.

---

*This document is a plan, not a change. No file in the corpus has been modified. Nothing proceeds
until the eight open questions in §12 are answered — Q1, Q2 and Q6 block the first line of work.*

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
*SPDX-License-Identifier: LicenseRef-PASVL-1.0*
