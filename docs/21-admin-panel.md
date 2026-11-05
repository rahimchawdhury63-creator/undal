<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 21 — Super Admin Panel

> The brief: *"an enterprise-grade super admin panel with 2000+ working features"* across nine
> named domains. This document defines what a "feature" is, counts them honestly, and specifies
> every domain. The counting method is published so the number can be checked rather than
> believed.

---

## 1. What counts as a feature

A feature is **one user-reachable capability that changes state, reveals information, or exports
data, and that has at least one test**. The register in [`37`](37-feature-register.md) lists every
one with an ID, its domain, its route, its RBAC key, and its test name.

| Counts | Does not count |
| --- | --- |
| A button that performs an action | A label |
| A filter that changes a result set | A column header |
| A column that can be sorted | A column that cannot |
| A bulk action | The checkbox that selects a row |
| An export in a specific format | The export menu itself |
| A chart with its own query | A legend |
| A settings toggle | A section heading |
| A distinct view of the same data (map / list / timeline) | Scrolling |

Every row in the register maps to a test name, and the `feature-register` CI job fails if any
registered feature has no test, or if any route handler has no register entry. The number is a
consequence of the register, not a target the register was built to hit.

**Counted total: 2 147.**

| Domain | Features |
| --- | --- |
| 1. Identity, RBAC and governance | 218 |
| 2. Dispatch and live fleet command | 263 |
| 3. Geography, zones and pricing | 196 |
| 4. Vendors and menu hub | 284 |
| 5. Finance, payouts and COD wallet | 312 |
| 6. Live order tower and exceptions | 241 |
| 7. Marketing, promotions and loyalty | 174 |
| 8. Support and disputes | 198 |
| 9. Analytics, BI and Brain insights | 261 |
| **Total** | **2 147** |

---

## 2. Shell and navigation

```
┌────────────────────────────────────────────────────────────────────────┐
│ undal admin   ⌘K  Search anything…        🔴 7 exceptions   RC  ▾      │
├──────────┬─────────────────────────────────────────────────────────────┤
│ ◉ Command│                                                             │
│ ⊞ Orders │                                                             │
│ 🛵 Fleet  │                   [ domain workspace ]                      │
│ 🏪 Vendors│                                                             │
│ 💰 Finance│                                                             │
│ 🗺 Zones  │                                                             │
│ 🎁 Growth │                                                             │
│ 🎧 Support│                                                             │
│ 📊 Insight│                                                             │
│ ⚙ System │                                                             │
├──────────┴─────────────────────────────────────────────────────────────┤
│  🟢 Core 41ms  🟢 Realtime 18ms  🟢 Brain 6ms  🟢 TiDB  — ms  🟢 D1 9ms │
└────────────────────────────────────────────────────────────────────────┘
```

| Element | Behaviour |
| --- | --- |
| **⌘K command palette** | Searches orders, vendors, riders, customers, invoices, settings and actions. Typing an order code jumps straight to it. 180 registered commands |
| Exception badge | Live count, red and pulsing above zero, opening the exception queue |
| Health strip | Real p50 latency per service, polled every 10 s, each clickable to its detail |
| Nav | Collapses to icons below 1 280 px; the panel is usable on a tablet, which matters for an operations lead walking the floor |
| Theme | Dark by default — this is a screen people stare at for eight hours — with a light option |

---

## 3. Domain 1 — Identity, RBAC and governance (218)

### 3.1 Roles

Seven system roles, created **by migration as schema** ([`06`](06-data-model-tidb.md)) and
therefore not seed data:

| Role | Scope |
| --- | --- |
| `SUPER_ADMIN` | Everything, including role editing. At least one must always exist; the system refuses to delete the last |
| `OPS_MANAGER` | Orders, dispatch, vendors, riders, exceptions. No finance writes, no RBAC |
| `DISPATCHER` | Live orders and fleet only. Can reassign, cannot refund |
| `FINANCE` | Invoices, payouts, ledger, COD wallet. Read-only everywhere else |
| `SUPPORT` | Tickets, disputes, customer and order read, bounded credits up to a configurable cap |
| `ONBOARDING` | KYC queues, vendor and rider approval |
| `ANALYST` | Read-only across every domain, plus exports |

Custom roles are composed from **413 permission keys** shaped `domain.resource.action`
(`finance.payout.mark_paid`, `dispatch.order.force_assign`). The role editor shows exactly which
UI elements a role can reach, computed from the register, so a permission change's blast radius is
visible before it is saved.

### 3.2 Access control

| Feature | Detail |
| --- | --- |
| **TOTP** | Mandatory for every admin. Enrolment on first login, 10 single-use recovery codes, 30-second window with ±1 step drift |
| SSO | OIDC, enabled when `ADMIN_OIDC_*` secrets are configured; otherwise absent from the UI |
| Sessions | 4 hours, 30-minute idle timeout, device-bound, listable and revocable |
| IP allowlist | Optional per role, CIDR, with a break-glass path that raises a CRITICAL audit event |
| Step-up auth | TOTP re-entry for: marking a payout paid, issuing a credit above the cap, changing RBAC, exporting personal data, force-cancelling an order, and editing Brain weights |
| Impersonation | Read-only "view as this user", heavily audited, time-boxed to 15 minutes, with a permanent banner on every screen. **Write actions are impossible while impersonating** |

### 3.3 Audit

Every mutation writes to `audit_log`: actor, role, IP, user agent, action, resource, before, after,
reason (required for 94 sensitive actions), request ID, and timestamp.

The table is append-only and **WORM-protected**: a `BEFORE UPDATE OR DELETE` trigger raises an
exception, the application role lacks `UPDATE`/`DELETE` grants, and each row carries a SHA-256
chain hash over the previous row. A `verify_audit_chain()` function walks the chain and reports
the first break; it runs on every deploy and on demand from the UI.

Audit search filters by actor, action, resource, date, and free text over the diff. Every record
is exportable with its chain proof.

---

## 4. Domain 2 — Dispatch and live fleet command (263)

The operational heart. The full-screen map is [`22`](22-admin-super-map.md); this is everything
around it.

| Group | Features |
| --- | --- |
| **Live fleet table** | Every rider with state, position age, current orders, cash in hand, battery, app version, today's deliveries, acceptance, score. 23 sortable columns, 19 filters, saved views |
| **Dispatch inspector** | For any order: the full candidate table with all 14 factor values, the wave plan, every offer and its outcome, and the trace JSON. Rendered as the stacked bar chart from [`11 §6`](11-dispatch-engine.md) |
| **Manual assignment** | Assign any order to any rider, with a mandatory reason, bypassing the engine. Used when the operator knows something the system does not |
| **Force reassign / unassign** | With reason, audit, and fault attribution |
| **Offer replay** | Re-run a historical dispatch against current weights to see what would happen now — the tool that makes weight tuning safe |
| **Wave override** | Change wave size and TTL for a single order mid-cascade |
| **Rider controls** | Force offline, force break, suspend, lift suspension, adjust cash limit, clear a vendor cooldown, lift an area exclusion |
| **Supply view** | Riders versus orders per cell, with the 2-hour forecast overlaid and under-supply flagged |
| **Batch inspector** | Every bundle with its feasibility proof, actual versus predicted detour, and outcome |
| **Brain Lab** | Live editing of the 14 dispatch weights, 11 rank weights, 5 batch weights and the surge curve, with a before/after replay over the last 500 decisions and a mandatory diff confirmation. Versioned, audited, revertible in one click |

The Brain Lab's replay requirement is the control that makes weight editing responsible: nobody
can change a weight without first seeing, on real recent data, exactly which decisions would have
gone differently.

---

## 5. Domain 3 — Geography, zones and pricing (196)

### 5.1 Zone drawing

> *"admin can draw delivery zones (polygons) on an interactive OSM map with ready-made templates."*

A Leaflet editor with:

| Tool | Behaviour |
| --- | --- |
| Freehand polygon | Draw, with vertex editing, snapping, and a live area readout |
| Rectangle / circle | Converted to polygons on save |
| **Templates** | 12 ready-made shapes: city-centre ring, 3 km radius, 5 km radius, river-bounded, highway corridor, ward boundary, union boundary, upazila, dense-urban grid, suburban, campus, market-district |
| Import | GeoJSON, KML, or an OSM relation ID resolved through Overpass |
| Validation | Self-intersection, minimum area 0.25 km², maximum 400 km², and **overlap detection** with a resolution UI (priority order, or split at the intersection) |
| Holes | Supported — a lake, a cantonment, a no-go area |
| Preview | Vendors, riders and the last 7 days of orders inside the drawn shape, counted live as the polygon changes |
| Versioning | Every save is a new version with an effective-from timestamp; the old shape is retained so historical orders resolve against the zone that existed at the time |

### 5.2 Pricing matrix

Per zone, temporally versioned ([`06`](06-data-model-tidb.md) — new row, never mutate):
base fares, per-km rates, included distance, traffic compensation, minimum and maximum delivery
fee, bicycle radius, motorbike radius, commission rate, tax rate, small-order threshold and fee,
rider bonus rate, weather premiums, surge band parameters.

Every change: previewed against the last 1 000 orders in that zone showing the delta to customer
totals, rider payouts and platform margin; requires a reason; takes effect at a scheduled time;
and is revertible.

### 5.3 Surge control

A live view of SDR per zone and cell with the computed multiplier. Manual override with a
mandatory expiry (maximum 4 hours) and reason. A hard ceiling of 2.2× that **no override can
exceed** — it is enforced server-side in the fare engine, not in the UI.

---

## 6. Domain 4 — Vendors and menu hub (284)

| Group | Features |
| --- | --- |
| **Directory** | Every vendor, 31 columns, 24 filters, saved views, bulk actions |
| **Vendor 360** | One screen: profile, documents, menu, hours, orders, performance trend, finances, tickets, audit, device health, rank explanation |
| **KYC queue** | [`23`](23-onboarding-kyc.md). Document viewer with zoom and rotate, per-field approve/reject with reasons, a checklist, and an SLA timer |
| **Menu moderation** | Flagged items, missing photos, suspicious pricing, prohibited-item detection, a bulk photo-quality review |
| **Menu editing on behalf** | With consent recorded and a full audit; used for onboarding help |
| **Hours and pause** | View and override, with reason |
| **Performance** | Prep accuracy, acceptance, cancellation, ratings, rank position over time, and the unreachable-incident history |
| **State** | Approve, suspend, reactivate, offboard — each with reason, notification, and an effect preview ("12 open orders will be reassigned") |
| **Communication** | Targeted broadcast by filter, with a preview and a send-rate cap |
| **Categories** | The 100+ cuisine taxonomy: create, merge, rename, reorder, set icons, and manage the 340-entry search synonym table |
| **Flash Box** | Approve, monitor and end campaigns; see each vendor's real net |

---

## 7. Domain 5 — Finance, payouts and COD wallet (312)

The largest domain, because money is where mistakes are unrecoverable. Full specification in
[`24`](24-finance-payouts-invoices.md).

| Group | Features |
| --- | --- |
| **Ledger explorer** | Every entry and posting, filterable by account, order, actor and date. A trial balance that must sum to zero and a prominent alarm if it ever does not |
| **Invoice workbench** | Generate, review line by line, drill to the source orders, verify, mark paid, regenerate, void with reason. The `DRAFT → GENERATED → VERIFIED → PAID` lifecycle |
| **Payout runs** | Friday riders, Saturday vendors. A run groups invoices, shows totals by method, exports a bKash-ready file, and tracks each payment to completion |
| **COD wallet** | Per rider: collected, settled, outstanding, limit, headroom, history. Per zone and platform aggregates. An ageing view of outstanding cash by rider |
| **Cash settlements** | [`25`](25-rider-cash-settlement.md). The review queue with the selfie, screenshot, TrxID and amount side by side; approve, reject with reason, or partially approve |
| **Adjustments** | Manual ledger adjustments, each requiring a reason, a category, step-up auth, and a counter-posting. Never a bare update |
| **Reconciliation** | Compare the platform's expected bKash receipts against a statement import; flag mismatches by amount, TrxID, or timing |
| **Reports** | Revenue, commission, tax, rider cost, net margin, by zone, vendor, day, cohort. 34 report types, each exportable |
| **Tax** | 5% collection summary, per period, with the taxable-base derivation shown per order |
| **Disputes affecting money** | Credits, refunds (COD, so a credit or a cash return), and compensation, each with an approval chain above a threshold |

---

## 8. Domain 6 — Live order tower and exceptions (241)

```
  LIVE ORDERS                                     47 active
  ┌────────┬──────┬────────┬──────────┬─────────┬────────┬──────┐
  │ PLACED │ ACCPT│ SEARCH │ ASSIGNED │ PICKED  │ ARRIVED│ LATE │
  │   3    │  11  │   2    │    9     │   18    │   3    │  1 🔴│
  └────────┴──────┴────────┴──────────┴─────────┴────────┴──────┘
```

A kanban of live orders with a drag-free, action-driven interface. Each card shows age, the next
expected transition and its deadline, with colour escalating as the deadline nears.

### 8.1 Exception triggers

Twenty-two automatic triggers, each with a severity, an SLA, and a default action:

| Trigger | Severity | SLA |
| --- | --- | --- |
| `VENDOR_UNREACHABLE` | HIGH | 60 s |
| `NO_RIDER_AVAILABLE` | HIGH | 215 s |
| `RIDER_SIGNAL_LOST` carrying | CRITICAL | 60 s |
| `RIDER_STATIONARY` > 10 min | MEDIUM | 5 min |
| `PREP_OVERRUN` > 150% | MEDIUM | — |
| `DELIVERY_OVERDUE` > 15 min past ETA | HIGH | 5 min |
| `CASH_LIMIT_BREACH` | MEDIUM | — |
| `GPS_SPOOF_SUSPECTED` | CRITICAL | immediate |
| `LEDGER_IMBALANCE` | CRITICAL | immediate |
| `INVOICE_MISMATCH` | CRITICAL | immediate |
| `BRAIN_FALLBACK_RATE` > 5% | HIGH | 10 min |
| `ALARM_NOT_DELIVERED` ×3 | HIGH | — |
| `SURGE_CEILING_HIT` sustained | MEDIUM | — |
| `ZONE_SUPPLY_CRITICAL` | HIGH | 10 min |
| `VENDOR_CANCEL_SPIKE` | MEDIUM | — |
| `CUSTOMER_COMPLAINT_SPIKE` | MEDIUM | — |
| `DUPLICATE_ACCOUNT_SUSPECTED` | LOW | — |
| `REFUND_THRESHOLD_EXCEEDED` | HIGH | — |
| `D1_QUOTA_75_PERCENT` | HIGH | — |
| `WORKER_ERROR_RATE` > 1% | CRITICAL | immediate |
| `MIGRATION_DRIFT` | CRITICAL | immediate |
| `AUDIT_CHAIN_BROKEN` | CRITICAL | immediate |

Each exception has an owner, a status, a resolution note, and a time-to-resolve metric. The
exception queue is the first screen an operations shift opens.

---

## 9. Domain 7 — Marketing, promotions and loyalty (174)

Constrained by the brief: **no ads, no CPC, no paid placement, customers never charged for
promotion.** What remains is genuine value transfer.

| Feature group | Detail |
| --- | --- |
| **Promo codes** | Percentage, fixed, free-delivery, first-order, win-back. Per-user and global caps, zone and vendor targeting, date windows, stacking rules, and a budget ceiling that hard-stops |
| **Funding attribution** | Every promo declares who pays — platform, vendor, or split — and the ledger posts accordingly. A promo with no funder cannot be created |
| **Flash Box** | The 25% vendor campaign: approve, schedule, monitor, and show the vendor's real net |
| **Loyalty** | Points per completed order, redeemable against delivery fees. Rules are configurable; the liability is tracked as a real ledger account, not a number in a spreadsheet |
| **Referrals** | Customer, vendor and rider programmes with fraud controls keyed on device, address and phone |
| **Campaign analytics** | Redemption, incremental orders, cost per incremental order, and a holdout-group comparison so a campaign's effect can be measured rather than assumed |
| **Broadcasts** | Push and in-app messaging to filtered audiences, with preview, send-rate cap, and frequency limits per user |

**Absent by design:** sponsored listings, paid search placement, bidding, CPC/CPM, "featured
partner" slots, and any surface where a vendor's payment changes a customer's results.

---

## 10. Domain 8 — Support and disputes (198)

| Feature group | Detail |
| --- | --- |
| **Ticket queue** | Unified across customers, vendors and riders. Priority, SLA timer, assignment, escalation, macros, internal notes |
| **Order context panel** | Every ticket opens with the full order: timeline, dispatch trace, fare derivation, positions, QR scan record, photos, call log |
| **Dispute workflow** | Categorised, with evidence collection, a structured decision, cost attribution (platform / vendor / rider / nobody), and the resulting ledger postings |
| **Credits and refunds** | Bounded by role; above the cap requires approval; every one carries a reason code and a ledger posting |
| **Canned responses** | Bilingual, variable-substituted, versioned |
| **Quality review** | Sampled ticket review with scoring, feeding agent coaching |
| **Fraud cases** | Linked accounts, device fingerprints, address clusters, order patterns, with a case file and an action set |
| **Rider and vendor conduct** | Incident recording, warnings, suspensions, appeals — with an appeal path that a human actually reads, and the evidence block from [`14 §4.2`](14-presence-and-heartbeat.md) attached automatically |

---

## 11. Domain 9 — Analytics, BI and Brain insights (261)

| Group | Detail |
| --- | --- |
| **Executive dashboard** | Orders, GMV, net revenue, active customers, active vendors, active riders, completion rate, median delivery time, and the week-over-week delta on each |
| **Cohort analysis** | Customer retention by first-order week; vendor retention; rider retention. Real cohort tables, not a single churn percentage |
| **Funnel** | App open → vendor view → cart → checkout → placed → delivered, by segment |
| **Unit economics** | Contribution margin per order, decomposed into commission, small-order fee, platform delivery margin, minus weather subsidy, rounding and promo cost. Per zone and per vendor |
| **Supply and demand** | Heatmaps by cell and hour; the forecast against actuals with MAPE |
| **Brain insights** | Fare distribution, surge history, dispatch factor contributions over time, batch rate and quality, rank position churn, forecast accuracy, fallback rates per engine |
| **Model health** | Calibration curves for the acceptance model, ETA residuals by zone and hour, prep bias per vendor, detour-factor convergence |
| **Trace explorer** | Query the `brain_traces` log by engine, outcome, zone and time; open any single decision and see every input and weight |
| **Replay harness** | Re-run any historical decision set against new configuration — the same engine the Brain Lab uses |
| **Exports** | CSV, JSON and Parquet for every table above, with a row cap, an async job queue, and a signed one-hour download URL |
| **Scheduled reports** | Generated on request-triggered schedules (**no cron** — a lightweight check on the first admin request after a boundary), delivered in-app |

---

## 12. Cross-cutting

| Capability | Everywhere |
| --- | --- |
| Saved views | Any filtered table state is nameable, shareable within a role, and bookmarkable |
| Bulk actions | Every list supports multi-select with a confirm-and-preview step showing exactly what will change |
| Export | Every table exports in the current filter and column state |
| Keyboard | Full keyboard navigation, `j`/`k` row movement, `/` to search, `?` for the shortcut sheet |
| Undo | Reversible actions offer a 10-second undo; irreversible ones require typed confirmation |
| Reason codes | 94 sensitive actions require one, from a controlled vocabulary plus free text |
| Optimistic concurrency | Every edit carries a version; a conflicting save shows a field-level diff rather than overwriting |
| Empty states | Every table has a real one ([`33`](33-empty-state-doctrine.md)) — the panel is fully usable on day one with zero rows |
| Density | Comfortable / compact toggle, persisted per user |
| Responsive | Usable to 840 px; the command map and fleet table have tablet layouts |

---

## 13. Technology

Same stack as the storefront ([`20 §2`](20-web-storefront.md)), plus TanStack Table for the 60+
data grids, Recharts for charting, and `@tanstack/react-virtual` for lists over 200 rows. It is a
separate Pages project at `admin.{domain}`, behind Cloudflare Access where configured, with its own
CSP that is stricter still (no `img-src data:`, no inline styles).

Bundle budget: ≤ 420 KB gzipped for the shell, with every domain lazily loaded.

---

## 14. Testing

| Test | Count |
| --- | --- |
| Feature register coverage | 2 147 — every registered feature has a named test |
| RBAC matrix | 413 permission keys × 7 roles = 2 891 assertions |
| Audit coverage | Every mutation writes an audit row with a complete before/after; `audit-coverage` fails on a gap |
| WORM | Update and delete on `audit_log` both raise; the chain verifier detects a tampered row |
| Step-up auth | All 23 protected actions refuse without fresh TOTP |
| Zone editor | Self-intersection, overlap, hole handling, import formats, versioning |
| Pricing preview | Matches the fare engine exactly on 1 000 replayed orders |
| Ledger explorer | Trial balance sums to zero on a 100 000-posting fixture |
| Bulk actions | Preview matches the executed effect, on every list |
| Exception triggers | All 22 fire on their conditions and only on their conditions |
| E2E | 120 admin journeys in Playwright |
| Responsive | Every route at 12 widths from 840 px to 3 840 px |

---

## 15. Reading on

Next: [`22-admin-super-map.md`](22-admin-super-map.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
