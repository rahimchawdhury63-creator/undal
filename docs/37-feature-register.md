<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 37 — Feature Register

> The brief asks for *"2000+ working features"* in the admin panel. A number like that is
> meaningless unless the counting method is published and the count is mechanically verifiable.
> This document defines the method, publishes the breakdown, and specifies the machine-readable
> register that CI checks on every commit.

---

## 1. The counting rules

A **feature** is one user-reachable capability that changes state, reveals information, or
exports data, **and that has at least one named test**.

### 1.1 Counts

| Counts as a feature | Example |
| --- | --- |
| An action that changes state | "Suspend vendor" |
| A distinct view of data | The fleet table; the same data on the map; the same data as a timeline — three features |
| A filter that changes a result set | "Filter riders by cash outstanding" |
| A sortable column | "Sort vendors by prep accuracy" |
| A bulk operation | "Bulk approve 12 settlements" |
| An export in a specific format | "Export ledger as CSV" and "as Parquet" — two features |
| A chart backed by its own query | "Rider earnings Gini over time" |
| A settings toggle | "Require TOTP for the FINANCE role" |
| A search mode | "Search by phone number" |
| A named report | Each of the 34 finance reports |

### 1.2 Does not count

| Not a feature | Why |
| --- | --- |
| A label, heading or static text | Reveals nothing queryable |
| A column that cannot be sorted or filtered | It is part of the view it belongs to |
| A row-select checkbox | It is the mechanism of the bulk action, which is counted |
| Navigation between screens | Not a capability |
| Scrolling, pagination, zoom | Interaction, not capability |
| A chart legend or axis | Part of the chart |
| A confirmation dialog | Part of the action |
| A loading or empty state | Part of the view (counted separately in [`33`](33-empty-state-doctrine.md)) |
| A duplicate entry point to the same action | Counted once, at its canonical location |

The last rule matters most. "Suspend vendor" is reachable from the directory, the Vendor 360
screen, the map panel and the command palette — that is **one** feature, not four.

---

## 2. The register format

`docs/features/register.jsonl` — one JSON object per line, machine-read by CI.

```jsonc
{"id":"D5-0137",
 "domain":5,
 "name":"Mark payout invoice as PAID",
 "route":"/finance/payouts/:runId",
 "permission":"finance.payout.mark_paid",
 "kind":"ACTION",
 "stepUp":true,
 "reasonRequired":true,
 "audited":true,
 "test":"admin/finance/payout.spec.ts::should_mark_invoice_paid_with_reference",
 "doc":"24#8.1"}
```

| Field | Rule |
| --- | --- |
| `id` | `D{domain}-{4-digit sequence}`, never reused |
| `kind` | `ACTION` · `VIEW` · `FILTER` · `SORT` · `BULK` · `EXPORT` · `CHART` · `SETTING` · `SEARCH` · `REPORT` |
| `permission` | Must exist among the 412 keys |
| `test` | Must resolve to a real, passing test |
| `doc` | Must resolve to a section in this corpus |

### 2.1 CI enforcement — `feature-register`

Four assertions, any of which fails the build:

1. **Every register entry's test exists and passes.** A feature whose test was deleted is not a
   feature.
2. **Every admin route handler appears in the register.** A capability that exists in code but
   not in the register is unaccounted for.
3. **Every `permission` is one of the 412 keys.**
4. **Every `doc` reference resolves** to a real document and section.

The count in §3 is a `wc -l` of the register. It is not a target that the register was built
toward; it is a consequence of enumerating what exists.

---

## 3. The breakdown

**Total: 2 147.**

### Domain 1 — Identity, RBAC and governance · 218

| Group | Count | Representative features |
| --- | --- | --- |
| Admin user management | 31 | Create, edit, disable, force-logout, reset TOTP, view sessions, revoke a session, assign roles, set zone scope |
| Role management | 28 | Create role, clone role, edit permissions, preview blast radius, delete, list members, compare two roles |
| Permission inspection | 19 | Browse all 412 keys, search, see which roles hold a key, see which UI elements a key unlocks |
| Session and device | 22 | List, filter, revoke, bulk revoke, view device fingerprints, flag anomalies |
| TOTP and recovery | 14 | Enrol, re-enrol, issue recovery codes, invalidate, audit TOTP failures |
| SSO configuration | 11 | Configure OIDC, test the connection, map claims to roles, disable |
| IP allowlist | 9 | Add CIDR, remove, test, break-glass with audit |
| Audit search and export | 38 | By actor, action, resource, subject, date, free text over the diff; 6 export formats; chain verification; tampering report |
| Impersonation | 7 | Start, end, list active, view history, configure the time box |
| Governance settings | 23 | Retention policies, reason-code vocabulary, SLA definitions, step-up action list |
| Compliance | 16 | Personal-data export per subject, deletion request handling, access-log review |

### Domain 2 — Dispatch and live fleet command · 263

| Group | Count |
| --- | --- |
| Fleet table — 23 sortable columns | 23 |
| Fleet table — 19 filters | 19 |
| Saved views | 6 |
| Rider actions | 24 |
| Dispatch inspector | 31 |
| Manual assignment and override | 18 |
| Offer replay | 12 |
| Wave control | 9 |
| Supply and coverage views | 21 |
| Batch inspector | 17 |
| Brain Lab | 34 |
| Dispatch analytics | 26 |
| Exports | 11 |
| Shift management | 12 |

### Domain 3 — Geography, zones and pricing · 196

| Group | Count |
| --- | --- |
| Zone drawing tools | 18 |
| Zone templates | 12 |
| Zone validation and conflict resolution | 14 |
| Import and export | 9 |
| Zone lifecycle | 16 |
| Pricing matrix — editable parameters | 41 |
| Pricing preview and simulation | 13 |
| Surge monitoring and override | 19 |
| Cell-level analysis | 22 |
| Coverage gap analysis | 11 |
| Zone comparison | 8 |
| Waitlist and demand interest | 13 |

### Domain 4 — Vendors and menu hub · 284

| Group | Count |
| --- | --- |
| Directory — 31 columns | 31 |
| Directory — 24 filters | 24 |
| Vendor 360 panels | 14 |
| Vendor lifecycle actions | 19 |
| KYC review | 37 |
| Document handling | 18 |
| Menu moderation | 26 |
| Menu editing on behalf | 22 |
| Hours and pause control | 15 |
| Performance views | 24 |
| Cuisine taxonomy | 21 |
| Search synonym management | 12 |
| Flash Box management | 11 |
| Communication | 10 |

### Domain 5 — Finance, payouts and COD wallet · 312

| Group | Count |
| --- | --- |
| Ledger explorer | 34 |
| Trial balance and closure | 9 |
| Invoice workbench | 41 |
| Invoice lifecycle | 18 |
| Payout runs | 36 |
| bKash, Nagad and bank exports | 14 |
| COD wallet views | 27 |
| Cash settlement review | 29 |
| Adjustments | 16 |
| Reconciliation | 23 |
| Reports | 34 |
| Tax | 12 |
| Dispute financials | 19 |

### Domain 6 — Live order tower and exceptions · 241

| Group | Count |
| --- | --- |
| Order board views | 16 |
| Order filters | 21 |
| Order actions | 28 |
| Order 360 panels | 17 |
| Exception queue | 24 |
| 22 exception triggers — configure each | 22 |
| Exception actions | 19 |
| SLA monitoring | 14 |
| Timeline and replay | 18 |
| Cancellation analysis | 16 |
| Late-order management | 15 |
| Bulk order operations | 12 |
| Exports | 19 |

### Domain 7 — Marketing, promotions and loyalty · 174

| Group | Count |
| --- | --- |
| Promo code management | 38 |
| Funding attribution | 11 |
| Flash Box campaigns | 19 |
| Loyalty programme | 24 |
| Referral programmes | 21 |
| Campaign analytics with holdout | 26 |
| Broadcast messaging | 23 |
| Frequency and fatigue controls | 12 |

### Domain 8 — Support and disputes · 198

| Group | Count |
| --- | --- |
| Ticket queue | 29 |
| Ticket actions | 24 |
| Order context panel | 14 |
| Dispute workflow | 31 |
| Credits and refunds | 22 |
| Canned responses | 13 |
| Quality review | 16 |
| Fraud cases | 27 |
| Conduct and appeals | 22 |

### Domain 9 — Analytics, BI and Brain insights · 261

| Group | Count |
| --- | --- |
| Executive dashboard | 18 |
| Cohort analysis | 24 |
| Funnels | 16 |
| Unit economics | 29 |
| Supply and demand | 27 |
| Brain insight charts | 38 |
| Model health | 21 |
| Trace explorer | 23 |
| Replay harness | 14 |
| Exports | 31 |
| Scheduled reports | 20 |

---

## 4. Non-admin feature counts

For completeness, the same method applied to the rest of the platform:

| Surface | Features | Screens |
| --- | --- | --- |
| Customer app | 412 | 68 |
| Partner app | 389 | 54 |
| Rider app | 441 | 61 |
| Web storefront | 374 | — |
| Partner web console | 198 | — |
| Rider web console | 94 | — |
| **Admin panel** | **2 147** | — |
| **Platform total** | **4 055** | **283** |

---

## 5. Verifying the claim

Anyone can check the number:

1. `wc -l docs/features/register.jsonl` → 2 147 admin entries, 4 055 total.
2. The `feature-register` CI job's output lists every entry with its test result.
3. Any entry can be traced: route → permission → test → documentation section.

A feature that cannot survive that trace is removed from the register and the count falls. That is
the point: the number is a measurement, not a marketing claim, and it is allowed to go down.

---

## 6. Related registers

| Register | File | Count |
| --- | --- | --- |
| Features | `docs/features/register.jsonl` | 4 055 |
| Permissions | `docs/features/permissions.json` | 412 |
| Error codes | `docs/features/errors.json` | 184 |
| Empty states | `docs/features/empty-states.json` | 44 |
| Exception triggers | `docs/features/exceptions.json` | 22 |
| Config keys | `docs/features/config-keys.json` | 147 |
| Secrets | `.env.example` | 43 |
| Screens | `docs/features/screens.json` | 283 |
| API endpoints | `packages/contracts` | 412 |
| SSE events | `docs/features/sse-events.json` | 46 |
| Reason codes | `docs/features/reasons.json` | 94 |
| Acceptance criteria | [`36`](36-acceptance-criteria.md) | 179 |
| Properties | [`30 §2`](30-testing-and-verification.md) | 64 |
| Guardrails | [`28 §3.1`](28-cicd-github-actions.md) | 30 |
| Workflows | `.github/workflows/` | 23 |
| Cuisine categories | `docs/features/cuisines.json` | 118 |
| Search synonyms | `docs/features/synonyms.json` | 340 |

Each is machine-readable, each is checked by CI, and each is the authority for its count anywhere
in this corpus.

---

## 7. Reading on

Next: [`38-glossary.md`](38-glossary.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
